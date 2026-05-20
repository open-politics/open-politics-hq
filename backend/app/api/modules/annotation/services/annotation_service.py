"""Service for handling annotations."""
import logging
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timezone
from sqlmodel import Session, select, func, and_, delete
from fastapi import Depends

from app.models import (
    Annotation,
    AnnotationSchema,
    AnnotationSchemaTargetLevel,
    Asset,
    RunStatus,
    AnnotationRun,
    ResultStatus,
    RunAggregate,
)
from app.schemas import AnnotationCreate
from app.api.modules.annotation.tasks.annotate import retry_failed_annotations
from app.core.events import emit
from collections import Counter
from math import sqrt
from app.schemas import AnnotationRunCreate, AnnotationSchemaCreate


def _flatten(prefix: str, obj: Any) -> List[Tuple[str, Any]]:
    items: List[Tuple[str, Any]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            new_prefix = f"{prefix}.{k}" if prefix else k
            items.extend(_flatten(new_prefix, v))
    elif isinstance(obj, list):
        for idx, v in enumerate(obj):
            new_prefix = f"{prefix}[{idx}]"
            items.extend(_flatten(new_prefix, v))
    else:
        items.append((prefix, obj))
    return items


def _value_kind(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return "number"
    if isinstance(value, str):
        # naive datetime detection
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            return "datetime"
        except Exception:
            return "string"
    if isinstance(value, list):
        return "array"
    return "object"

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

class AnnotationService:
    """Service for handling annotations."""
    
    def __init__(self, session: Session):
        """Initialize the service with a database session."""
        self.session = session
    
    def create_annotation(
        self,
        asset_id: int,
        schema_id: int,
        value: Dict[str, Any],
        status: ResultStatus = ResultStatus.SUCCESS,
        user_id: int = None,
        infospace_id: int = None,
        run_id: Optional[int] = None,
        region: Optional[Dict[str, Any]] = None,
        links: Optional[List[Dict[str, Any]]] = None,
        event_timestamp: Optional[datetime] = None
    ) -> Annotation:
        """
        Create a new annotation.
        
        Args:
            asset_id: ID of the asset to annotate
            schema_id: ID of the schema to use
            value: Annotation value (matching schema output_contract)
            status: Result status
            user_id: ID of the user creating the annotation
            infospace_id: ID of the infospace
            run_id: Optional ID of the annotation run
            region: Optional region for image/video annotations
            links: Optional links for graph relationships
            event_timestamp: Optional event timestamp
            
        Returns:
            The created annotation
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Creating annotation for asset {asset_id} with schema {schema_id}")
        
        # Validate asset exists and belongs to infospace
        asset = self.session.get(Asset, asset_id)
        if not asset:
            raise ValueError(f"Asset with ID {asset_id} not found")
        if asset.infospace_id != infospace_id:
            raise ValueError(f"Asset with ID {asset_id} does not belong to infospace {infospace_id}")
        
        # Validate schema exists and belongs to infospace
        schema = self.session.get(AnnotationSchema, schema_id)
        if not schema:
            raise ValueError(f"AnnotationSchema with ID {schema_id} not found")
        if schema.infospace_id != infospace_id:
            raise ValueError(f"AnnotationSchema with ID {schema_id} does not belong to infospace {infospace_id}")
        
        # Validate run if provided
        if run_id:
            run = self.session.get(AnnotationRun, run_id)
            if not run:
                raise ValueError(f"AnnotationRun with ID {run_id} not found")
            if run.infospace_id != infospace_id:
                raise ValueError(f"AnnotationRun with ID {run_id} does not belong to infospace {infospace_id}")
        
        # Create annotation
        annotation = Annotation(
            asset_id=asset_id,
            schema_id=schema_id,
            run_id=run_id,
            value=value,
            status=status,
            infospace_id=infospace_id,
            user_id=user_id,
            region=region,
            links=links,
            event_timestamp=event_timestamp,
            timestamp=datetime.now(timezone.utc),
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        
        self.session.add(annotation)
        self.session.commit()
        self.session.refresh(annotation)
        
        return annotation
    
    def create_batch_annotations(
        self,
        annotations: List[AnnotationCreate],
        user_id: int,
        infospace_id: int
    ) -> Tuple[bool, Optional[int]]:
        """
        Create multiple annotations in a batch.
        
        Args:
            annotations: List of annotations to create
            user_id: ID of the user creating the annotations
            infospace_id: ID of the infospace
            
        Returns:
            Tuple of (success, run_id)
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Creating batch of {len(annotations)} annotations")
        
        # Create a run to track the batch
        run = AnnotationRun(
            name=f"Batch Annotation Run - {datetime.now(timezone.utc).isoformat()}",
            description=f"Batch creation of {len(annotations)} annotations",
            configuration={
                "asset_ids": list(set(a.asset_id for a in annotations)),
                "schema_ids": list(set(a.schema_id for a in annotations))
            },
            status=RunStatus.PENDING,
            infospace_id=infospace_id,
            user_id=user_id,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        
        self.session.add(run)
        self.session.commit()
        self.session.refresh(run)

        # Trigger processing via event (process_annotation_run subscribes to annotation_run.created)
        from app.core.events import emit
        emit("annotation_run.created", {"infospace_id": infospace_id})
        logger.info(f"Queued annotation task for run {run.id}")
        return True, run.id
    
    def trigger_retry_failed_annotations(
        self,
        run_id: int,
        user_id: int,
        infospace_id: int
    ) -> bool:
        """
        Trigger a retry of failed annotations in a run.
        
        Args:
            run_id: ID of the run to retry
            user_id: ID of the user requesting the retry
            infospace_id: ID of the infospace
            
        Returns:
            True if successful
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Triggering retry of failed annotations for run {run_id}")
        
        # Get the run
        run = self.session.get(AnnotationRun, run_id)
        if not run:
            raise ValueError(f"Run with ID {run_id} not found")
        if run.infospace_id != infospace_id:
            raise ValueError(f"Run with ID {run_id} does not belong to infospace {infospace_id}")
        
        # Check run status
        if run.status not in [RunStatus.COMPLETED_WITH_ERRORS, RunStatus.FAILED]:
            raise ValueError(f"Run {run_id} is not in a state that can be retried (status: {run.status})")

        # Queue the retry task via direct invocation
        try:
            retry_failed_annotations.delay([run.id], infospace_id)
            logger.info(f"Queued retry task for run {run.id}")
            return True
        except Exception as e:
            logger.error(f"Failed to queue retry task for run {run.id}: {e}")
            return False
    
    def get_annotations_for_asset(
        self,
        asset_id: int,
        skip: int = 0,
        limit: int = 100,
        user_id: int = None,
        infospace_id: int = None
    ) -> List[Annotation]:
        """
        Get annotations for a specific asset.
        
        Args:
            asset_id: ID of the asset
            skip: Number of records to skip
            limit: Maximum number of records to return
            user_id: Optional user ID for access control
            infospace_id: Optional infospace ID for access control
            
        Returns:
            List of annotations
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Getting annotations for asset {asset_id}")
        
        # Validate asset exists
        asset = self.session.get(Asset, asset_id)
        if not asset:
            raise ValueError(f"Asset with ID {asset_id} not found")
        
        # If infospace_id is provided, validate access
        if infospace_id:
            if asset.infospace_id != infospace_id:
                raise ValueError(f"Asset with ID {asset_id} does not belong to infospace {infospace_id}")
        query = (
            select(Annotation)
            .where(Annotation.asset_id == asset_id)
            .offset(skip)
            .limit(limit)
        )
        
        return list(self.session.exec(query))
    
    def get_annotations_for_schema(
        self,
        schema_id: int,
        skip: int = 0,
        limit: int = 100,
        user_id: int = None,
        infospace_id: int = None
    ) -> List[Annotation]:
        """
        Get annotations for a specific schema.
        
        Args:
            schema_id: ID of the schema
            skip: Number of records to skip
            limit: Maximum number of records to return
            user_id: Optional user ID for access control
            infospace_id: Optional infospace ID for access control
            
        Returns:
            List of annotations
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Getting annotations for schema {schema_id}")
        
        # Validate schema exists
        schema = self.session.get(AnnotationSchema, schema_id)
        if not schema:
            raise ValueError(f"AnnotationSchema with ID {schema_id} not found")
        
        # If infospace_id is provided, validate access
        if infospace_id:
            if schema.infospace_id != infospace_id:
                raise ValueError(f"AnnotationSchema with ID {schema_id} does not belong to infospace {infospace_id}")
        query = (
            select(Annotation)
            .where(Annotation.schema_id == schema_id)
            .offset(skip)
            .limit(limit)
        )
        
        return list(self.session.exec(query))
    
    def get_annotations(
        self,
        asset_ids: List[int],
        infospace_id: int,
        schema_ids: Optional[List[int]] = None
    ) -> List[Annotation]:
        """Get annotations for multiple assets, with optional schema filtering."""
        query_conditions = [
            Annotation.infospace_id == infospace_id,
            Annotation.asset_id.in_(asset_ids)
        ]
        
        if schema_ids:
            query_conditions.append(Annotation.schema_id.in_(schema_ids))
        
        annotations = self.session.exec(
            select(Annotation).where(and_(*query_conditions))
        ).all()
        
        return list(annotations)

    def list_schemas(self, infospace_id: int) -> List[AnnotationSchema]:
        """List all active annotation schemas in an infospace."""
        schemas = self.session.exec(
            select(AnnotationSchema)
            .where(AnnotationSchema.infospace_id == infospace_id)
            .where(AnnotationSchema.is_active == True)
        ).all()
        return list(schemas)
    
    def get_annotations_for_run(
        self,
        run_id: int,
        user_id: int,
        infospace_id: int,
        skip: int = 0,
        limit: int = 100,
        include_descendants: bool = False,
    ) -> List[Annotation]:
        """
        Get all annotations for a specific run.

        Args:
            run_id: ID of the run
            user_id: ID of the user requesting the annotations
            infospace_id: ID of the infospace
            skip: Number of records to skip
            limit: Maximum number of records to return
            include_descendants: When True, also return annotations from
                child runs (``parent_run_id == run_id``). Use for family-aware
                exports / reads on a run that has been extended.

        Returns:
            List of annotations

        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Getting annotations for run {run_id}")

        # Optional: Validate run exists and belongs to infospace
        run = self.session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != infospace_id:
            raise ValueError("Run not found in this infospace.")

        # DEBUG: Check run's target schemas
        logger.info(f"DEBUG: Run {run_id} has {len(run.target_schemas) if run.target_schemas else 0} target schemas")
        if run.target_schemas:
            for schema in run.target_schemas:
                logger.info(f"DEBUG: Run {run_id} target schema: ID={schema.id}, Name='{schema.name}'")
        
        # DEBUG: Check total annotations in database for this run
        total_annotations_query = select(func.count(Annotation.id)).where(Annotation.run_id == run_id)
        total_count = self.session.exec(total_annotations_query).one()
        logger.info(f"DEBUG: Total annotations in DB for run {run_id}: {total_count}")
        
        # DEBUG: Check annotations by schema ID for this run
        schema_breakdown_query = select(
            Annotation.schema_id, 
            func.count(Annotation.id).label('count')
        ).where(Annotation.run_id == run_id).group_by(Annotation.schema_id)
        schema_breakdown = self.session.exec(schema_breakdown_query).all()
        for schema_id, count in schema_breakdown:
            logger.info(f"DEBUG: Run {run_id} has {count} annotations for schema_id {schema_id}")

        family_ids: List[int] = [run_id]
        if include_descendants:
            descendants = self.session.exec(
                select(AnnotationRun.id).where(
                    AnnotationRun.parent_run_id == run_id,
                    AnnotationRun.infospace_id == infospace_id,
                )
            ).all()
            family_ids.extend([d for d in descendants if d is not None])

        query = (
            select(Annotation)
            .where(Annotation.run_id.in_(family_ids))
            .offset(skip)
            .limit(limit)
        )
        annotations = self.session.exec(query).all()

        logger.info(
            "DEBUG: Returning %d annotations for run %d (family=%s, include_descendants=%s)",
            len(annotations), run_id, family_ids, include_descendants,
        )
        return list(annotations)
    
    def update_annotation(
        self,
        annotation_id: int,
        value: Dict[str, Any],
        user_id: int,
        infospace_id: int,
        status: Optional[ResultStatus] = None,
        event_timestamp: Optional[datetime] = None,
        region: Optional[Dict[str, Any]] = None,
        links: Optional[List[Dict[str, Any]]] = None
    ) -> Annotation:
        """
        Update an existing annotation.
        
        Args:
            annotation_id: ID of the annotation to update
            value: New annotation value
            user_id: ID of the user updating the annotation
            infospace_id: ID of the infospace
            status: Optional new status
            event_timestamp: Optional new event timestamp
            region: Optional new region data
            links: Optional new links data
            
        Returns:
            The updated annotation
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Updating annotation {annotation_id}")
        
        # Get and validate annotation
        annotation = self.session.get(Annotation, annotation_id)
        if not annotation:
            raise ValueError(f"Annotation with ID {annotation_id} not found")
        if annotation.infospace_id != infospace_id:
            raise ValueError(f"Annotation with ID {annotation_id} does not belong to infospace {infospace_id}")
        
        # Update annotation fields
        annotation.value = value
        if status is not None:
            annotation.status = status
        if event_timestamp is not None:
            annotation.event_timestamp = event_timestamp
        if region is not None:
            annotation.region = region
        if links is not None:
            annotation.links = links
        annotation.updated_at = datetime.now(timezone.utc)
        
        self.session.add(annotation)
        self.session.commit()
        self.session.refresh(annotation)
        
        return annotation
    
    def delete_annotation(
        self,
        annotation_id: int,
        user_id: int,
        infospace_id: int
    ) -> bool:
        """
        Delete an annotation.
        
        Args:
            annotation_id: ID of the annotation to delete
            user_id: ID of the user deleting the annotation
            infospace_id: ID of the infospace
            
        Returns:
            True if successful
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Deleting annotation {annotation_id}")
        
        # Get and validate annotation
        annotation = self.session.get(Annotation, annotation_id)
        if not annotation:
            raise ValueError(f"Annotation with ID {annotation_id} not found")
        if annotation.infospace_id != infospace_id:
            raise ValueError(f"Annotation with ID {annotation_id} does not belong to infospace {infospace_id}")
        
        # Delete annotation
        self.session.delete(annotation)
        self.session.commit()
        
        return True

    def retry_single_annotation(
        self,
        annotation_id: int,
        user_id: int,
        infospace_id: int,
        custom_prompt: Optional[str] = None
    ) -> Annotation:
        """
        Retry a single annotation with optional custom prompt override.
        
        Args:
            annotation_id: ID of the annotation to retry
            user_id: ID of the user requesting the retry
            infospace_id: ID of the infospace
            custom_prompt: Optional additional/override prompt for this specific retry
            
        Returns:
            The new annotation that replaces the failed one
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Retrying single annotation {annotation_id}")
        
        # Get and validate annotation
        annotation = self.session.get(Annotation, annotation_id)
        if not annotation:
            raise ValueError(f"Annotation with ID {annotation_id} not found")
        if annotation.infospace_id != infospace_id:
            raise ValueError(f"Annotation with ID {annotation_id} does not belong to infospace {infospace_id}")
        
        # Get related entities
        asset = self.session.get(Asset, annotation.asset_id)
        schema = self.session.get(AnnotationSchema, annotation.schema_id)
        run = self.session.get(AnnotationRun, annotation.run_id) if annotation.run_id else None
        
        if not asset or not schema:
            raise ValueError(f"Related asset or schema not found for annotation {annotation_id}")
        
        # Prepare retry configuration
        run_config = run.configuration if run else {}
        
        # Handle custom prompt if provided
        original_instructions = schema.instructions or ""
        final_instructions = original_instructions
        
        if custom_prompt:
            if original_instructions:
                final_instructions = f"{original_instructions}\n\n--- Additional Guidance for this Retry ---\n{custom_prompt}"
            else:
                final_instructions = f"--- Custom Instructions ---\n{custom_prompt}"
        
        # Create a temporary schema info for processing
        from app.api.modules.annotation.tasks.annotate import (
            validate_hierarchical_schema, 
            detect_schema_structure,
            process_single_asset_schema
        )
        from app.core.task_utils import create_pydantic_model_from_json_schema
        from app.core.config import settings
        import asyncio
        
        try:
            # Validate schema structure
            if not validate_hierarchical_schema(schema.output_contract):
                raise ValueError(f"Schema {schema.id} has invalid hierarchical structure")
            
            schema_structure = detect_schema_structure(schema.output_contract)
            
            # Create output model
            OutputModelClass = create_pydantic_model_from_json_schema(
                model_name=f"RetryOutput_{schema.name.replace(' ', '_')}_{schema.id}_{annotation_id}",
                json_schema=schema.output_contract,
                justifications_enabled=run_config.get("justifications_enabled", True),
            )
            
            if not OutputModelClass.model_fields:
                raise ValueError(f"Schema {schema.id} resulted in empty model")
            
            # Add system mapping prompt for per-modality fields if needed
            if schema_structure.get("per_modality_fields"):
                system_mapping_prompt = (
                    "\n\n--- System Data Mapping Instructions ---\n"
                    "For each item you generate that corresponds to a specific media input (e.g., an item in a 'per_image' list, 'per_audio' list, etc.), "
                    "you MUST include a field named '_system_asset_source_uuid'. "
                    "The value of this '_system_asset_source_uuid' field MUST be the exact UUID string that was provided to you in the input prompt for that specific media item. "
                    "This is critical for correctly associating your analysis with the source media."
                )
                final_instructions += system_mapping_prompt
            
            schema_info = {
                "schema": schema,
                "schema_structure": schema_structure,
                "output_model_class": OutputModelClass,
                "final_instructions": final_instructions
            }
            
            # Create a minimal run context for this retry
            retry_run = run if run else AnnotationRun(
                id=0,  # Temporary ID for processing
                infospace_id=infospace_id,
                user_id=user_id,
                configuration=run_config
            )
            
            # Run the async processing
            from app.core.task_utils import run_async_in_celery

            # Define the complete async workflow to avoid event loop conflicts
            async def complete_retry_workflow():
                from app.api.modules.foundation_service_providers import resolve

                fresh_storage_provider_instance = resolve("storage")

                run_cfg = run_config or {}
                type_key = run_cfg.get("provider") or run_cfg.get("ai_provider")
                runtime_api_keys = run_cfg.get("api_keys")
                runtime_key = (runtime_api_keys or {}).get(type_key) if type_key else None
                provider = resolve("language", type_key, infospace_id=retry_run.infospace_id, runtime_key=runtime_key) if type_key else None

                return await process_single_asset_schema(
                    asset=asset,
                    schema_info=schema_info,
                    run=retry_run,
                    run_config=run_config,
                    provider=provider,
                    storage_provider_instance=fresh_storage_provider_instance,
                    session=self.session
                )
            
            result = run_async_in_celery(complete_retry_workflow)
            
            if not result.get("success"):
                error_msg = result.get("error", "Unknown error during retry")
                raise ValueError(f"Retry failed: {error_msg}")
            
            # Delete the old annotation and add the new one
            self.session.delete(annotation)
            
            new_annotations = result.get("annotations", [])
            if not new_annotations:
                raise ValueError("Retry succeeded but no new annotations were created")
            
            # Take the first annotation (should be the main one for this asset)
            new_annotation = new_annotations[0]
            
            # Ensure it has the same run_id as the original if applicable
            if run:
                new_annotation.run_id = run.id
            
            self.session.add(new_annotation)
            
            # Add any justifications
            new_justifications = result.get("justifications", [])
            if new_justifications:
                # Set annotation_id for justifications after we have the new annotation ID
                self.session.flush()  # Get the new annotation ID
                for justification in new_justifications:
                    justification.annotation_id = new_annotation.id
                self.session.add_all(new_justifications)
            
            self.session.commit()
            self.session.refresh(new_annotation)
            
            logger.info(f"Service: Successfully retried annotation {annotation_id}, created new annotation {new_annotation.id}")
            return new_annotation
            
        except Exception as e:
            self.session.rollback()
            logger.error(f"Service: Error retrying annotation {annotation_id}: {e}", exc_info=True)
            raise ValueError(f"Failed to retry annotation: {str(e)}")

    def get_annotation_by_id(
        self,
        annotation_id: int,
        user_id: int,
        infospace_id: int
    ) -> Optional[Annotation]:
        """
        Get a specific annotation by ID.
        
        Args:
            annotation_id: ID of the annotation
            user_id: ID of the user requesting the annotation
            infospace_id: ID of the infospace
            
        Returns:
            The annotation if found and accessible
            
        Raises:
            ValueError: If validation fails
        """
        logger.debug(f"Service: Getting annotation {annotation_id} for infospace {infospace_id}")
        
        annotation = self.session.get(Annotation, annotation_id)
        if annotation and annotation.infospace_id == infospace_id:
            return annotation
        
        if annotation:
            logger.warning(f"Annotation {annotation_id} found but infospace_id mismatch")
            
        return None
    
    def get_annotation_stats(
        self,
        infospace_id: int,
        user_id: int
    ) -> Dict[str, Any]:
        """
        Get statistics about annotations in an infospace.
        
        Args:
            infospace_id: ID of the infospace
            user_id: ID of the user requesting stats
            
        Returns:
            Dictionary containing annotation statistics
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Getting annotation stats for infospace {infospace_id}")
        
        # Get total annotations
        total_annotations = self.session.exec(
            select(func.count(Annotation.id))
            .where(Annotation.infospace_id == infospace_id)
        ).first()
        
        # Get annotations by status
        status_counts = self.session.exec(
            select(Annotation.status, func.count(Annotation.id))
            .where(Annotation.infospace_id == infospace_id)
            .group_by(Annotation.status)
        ).all()
        
        # Get annotations by schema
        schema_counts = self.session.exec(
            select(Annotation.schema_id, func.count(Annotation.id))
            .where(Annotation.infospace_id == infospace_id)
            .group_by(Annotation.schema_id)
        ).all()
        
        return {
            "total_annotations": total_annotations,
            "status_counts": dict(status_counts),
            "schema_counts": dict(schema_counts)
        }
    
    def get_schema(
        self,
        schema_id: int,
        infospace_id: int,
        user_id: int
    ) -> Optional[AnnotationSchema]:
        """
        Get a specific annotation schema by ID.
        
        Args:
            schema_id: ID of the schema
            infospace_id: ID of the infospace
            user_id: ID of the user
            
        Returns:
            The annotation schema if found and accessible
            
        Raises:
            ValueError: If validation fails
        """
        logger.debug(f"Service: Getting schema {schema_id} for infospace {infospace_id}")
        
        schema = self.session.get(AnnotationSchema, schema_id)
        if schema and schema.infospace_id == infospace_id:
            return schema
        
        if schema:
            logger.warning(f"Schema {schema_id} found but infospace_id mismatch")
            
        return None
    
    def get_run_details(
        self,
        run_id: int,
        infospace_id: int,
        user_id: int
    ) -> Optional[AnnotationRun]:
        """
        Get detailed information about an annotation run.
        
        Args:
            run_id: ID of the run
            infospace_id: ID of the infospace
            user_id: ID of the user
            
        Returns:
            The annotation run if found and accessible
            
        Raises:
            ValueError: If validation fails
        """
        logger.debug(f"Service: Getting run details for run {run_id} in infospace {infospace_id}")
        
        run = self.session.get(AnnotationRun, run_id)
        if run and run.infospace_id == infospace_id:
            return run
            
        if run:
            logger.warning(f"Run {run_id} found but infospace_id mismatch")
            
        return None
    
    def create_annotation_schema(
        self,
        name: str,
        output_contract: Dict[str, Any],
        user_id: int,
        infospace_id: int,
        description: Optional[str] = None,
        instructions: Optional[str] = None,
        version: str = "1.0",
    ) -> AnnotationSchema:
        """
        Create a new Annotation Schema.

        Args:
            name: Name of the schema
            output_contract: JSON schema defining the output. Per-field
                justification opt-in lives inline as ``include_justification``
                on each property — the legacy ``field_specific_justification_configs``
                block is translated into inline keys at the route layer.
            user_id: ID of the user creating the schema
            infospace_id: ID of the infospace
            description: Optional description
            instructions: Optional instructions for the LLM
            version: Schema version

        Returns:
            The created AnnotationSchema

        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Creating annotation schema '{name}' in infospace {infospace_id}")

        existing_schema = self.session.exec(
            select(AnnotationSchema)
            .where(AnnotationSchema.infospace_id == infospace_id)
            .where(AnnotationSchema.name == name)
            .where(AnnotationSchema.version == version)
        ).first()

        if existing_schema:
            raise ValueError(f"AnnotationSchema with name '{name}' and version '{version}' already exists in infospace {infospace_id}")

        db_schema = AnnotationSchema(
            name=name,
            description=description,
            output_contract=output_contract,
            instructions=instructions,
            version=version,
            infospace_id=infospace_id,
            user_id=user_id,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        
        self.session.add(db_schema)
        self.session.commit()
        self.session.refresh(db_schema)
        
        logger.info(f"Service: Annotation schema '{name}' (ID: {db_schema.id}) created successfully.")
        return db_schema
    
    def create_run(
        self,
        user_id: int,
        infospace_id: int,
        run_in: Any,
        queue_task: bool = True
    ) -> AnnotationRun:
        """
        Create a new Annotation Run and optionally trigger its processing.

        Args:
            user_id: ID of the user creating the run
            infospace_id: ID of the infospace
            run_in: AnnotationRunCreate object containing run details
            queue_task: If True (default), queue Celery task for async processing.
                       If False, just create the run record (caller handles execution).

        Returns:
            The created AnnotationRun

        Raises:
            ValueError: If validation fails (e.g., schema not found)
        """
        logger.info(f"Service: Creating annotation run '{run_in.name}' in infospace {infospace_id}")

        # Validate schemas exist and belong to the infospace
        if not run_in.schema_ids:
            raise ValueError("At least one schema_id must be provided.")
        
        db_schemas = []
        for schema_id in run_in.schema_ids:
            schema = self.session.get(AnnotationSchema, schema_id)
            if not schema or schema.infospace_id != infospace_id:
                raise ValueError(f"AnnotationSchema with ID {schema_id} not found or not in infospace {infospace_id}.")
            db_schemas.append(schema)

        # Validate target assets or bundle
        # Allow empty target_asset_ids for continuous runs (source_bundle_id) or curation runs
        if run_in.target_asset_ids is None and run_in.target_bundle_id is None and run_in.source_bundle_id is None:
            raise ValueError("Either target_asset_ids, target_bundle_id, or source_bundle_id must be provided.")
        if run_in.target_asset_ids is not None and run_in.target_bundle_id is not None:
            raise ValueError("Provide either target_asset_ids or target_bundle_id, not both.")

        # The actual target asset IDs will be resolved by the task from configuration
        # Here we just ensure the input is valid.

        run_config = run_in.configuration or {}
        if run_in.target_asset_ids:
            run_config['target_asset_ids'] = run_in.target_asset_ids
        if run_in.target_bundle_id:
            run_config['target_bundle_id'] = run_in.target_bundle_id

        db_run = AnnotationRun(
            name=run_in.name,
            description=run_in.description,
            configuration=run_config,
            status=RunStatus.PENDING,
            infospace_id=infospace_id,
            user_id=user_id,
            target_schemas=db_schemas, # Link schemas to the run
            # include_parent_context and context_window are now part of run_in.configuration if needed by the Pydantic model
            # For SQLModel, if they are direct fields, they need to be set from run_in explicitly if defined there.
            # Current RunCreate from app.schemas has them as direct fields. Let's map them.
            include_parent_context=run_in.include_parent_context,
            context_window=run_in.context_window,
            views_config=run_in.views_config or [],
            # ═══ TRIGGER TRACKING ═══
            trigger_type=getattr(run_in, 'trigger_type', 'manual'),
            trigger_context=getattr(run_in, 'trigger_context', None) or {},
            pipeline_execution_id=getattr(run_in, 'pipeline_execution_id', None),
            triggered_by_source_id=getattr(run_in, 'triggered_by_source_id', None),
            # ═══ NEW: Continuous run support ═══
            source_bundle_id=getattr(run_in, 'source_bundle_id', None),
            follow_on_version_change=getattr(run_in, 'follow_on_version_change', False) or False,
            graph_config=getattr(run_in, 'graph_config', None),
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )

        self.session.add(db_run)
        self.session.commit()
        self.session.refresh(db_run)

        # Trigger the Celery task if requested
        if queue_task:
            from app.core.events import emit
            emit("annotation_run.created", {"infospace_id": infospace_id})
            logger.info(f"Service: Annotation task for run {db_run.id} ('{db_run.name}') queued successfully.")
        else:
            logger.info(f"Service: Annotation run {db_run.id} ('{db_run.name}') created without queuing task (caller handles execution).")

        return db_run

    def extend_run(
        self,
        *,
        run_id: int,
        user_id: int,
        infospace_id: int,
        asset_ids: Optional[List[int]] = None,
        bundle_id: Optional[int] = None,
        schema_ids: Optional[List[int]] = None,
        configuration_overrides: Optional[Dict[str, Any]] = None,
    ) -> AnnotationRun:
        """
        Extend an existing run with new assets and/or schemas.

        Creates a child run (parent_run_id = root) carrying the delta — the
        new (asset, schema) pairs that don't yet exist anywhere in the run's
        family. The parent run stays untouched; reads via ``/view`` walk
        descendants and surface the union transparently.

        ``parent_run_id`` always points to the *root* of the family. If the
        caller passes a child run id, this method walks up to the root so the
        family stays flat (single-level descendant lookup).

        Asset/schema delta semantics:
          - asset_ids only: same schemas as parent, new assets minus those
            already fully annotated for all parent schemas across the family.
          - schema_ids only: same assets as parent (resolved from family
            annotation history), new schemas only.
          - both: cross-product, family-deduped on (asset, schema).

        Gates:
          - parent must exist in the infospace.
          - parent must not be a flow_step / have flow_execution_id.
          - parent must not have source_bundle_id (continuous runs self-extend).
          - parent must be in a terminal state (COMPLETED / COMPLETED_WITH_ERRORS /
            FAILED) — extending mid-flight races with the parent's own cursor.

        Returns the new child run.
        """
        from app.api.modules.annotation.models import RunSchemaLink

        if not asset_ids and not bundle_id and not schema_ids:
            raise ValueError("Must provide asset_ids, bundle_id, or schema_ids to extend.")

        parent = self.session.get(AnnotationRun, run_id)
        if not parent or parent.infospace_id != infospace_id:
            raise ValueError(f"Run {run_id} not found in infospace {infospace_id}.")

        # Walk to root so the family stays flat.
        root = parent
        while root.parent_run_id:
            next_root = self.session.get(AnnotationRun, root.parent_run_id)
            if not next_root:
                break
            root = next_root

        # Gates
        if root.flow_execution_id is not None or (root.run_type or "one_off") != "one_off":
            raise ValueError("Cannot extend a flow-driven run.")
        if root.source_bundle_id is not None:
            raise ValueError("Continuous runs (source_bundle_id) self-extend on poll. Cannot extend manually.")
        if root.status not in (
            RunStatus.COMPLETED,
            RunStatus.COMPLETED_WITH_ERRORS,
            RunStatus.FAILED,
        ):
            raise ValueError(
                f"Cannot extend a run that is still in progress (status={root.status}). "
                "Wait for it to finish first."
            )

        # Resolve the family: root + existing descendants.
        descendant_ids = list(self.session.exec(
            select(AnnotationRun.id).where(AnnotationRun.parent_run_id == root.id)
        ).all())
        family_run_ids = [root.id] + descendant_ids

        # Resolve target schemas. If the caller passed schema_ids we use exactly
        # those (schema extension); otherwise we inherit the parent's schemas.
        if schema_ids:
            child_schemas = []
            for sid in schema_ids:
                schema = self.session.get(AnnotationSchema, sid)
                if not schema or schema.infospace_id != infospace_id:
                    raise ValueError(f"AnnotationSchema {sid} not found in infospace.")
                child_schemas.append(schema)
        else:
            child_schemas = list(root.target_schemas) if root.target_schemas else []
        if not child_schemas:
            raise ValueError("No schemas to run against. Parent has none and caller passed none.")
        child_schema_ids = [s.id for s in child_schemas]

        # Resolve target assets.
        target_asset_ids: List[int] = []
        target_bundle_id: Optional[int] = None

        if asset_ids:
            target_asset_ids = list(asset_ids)
        elif bundle_id:
            target_bundle_id = bundle_id
        elif schema_ids:
            # Schema-only extension: re-run all assets the family has touched.
            family_assets = self.session.exec(
                select(Annotation.asset_id)
                .where(Annotation.run_id.in_(family_run_ids))
                .distinct()
            ).all()
            target_asset_ids = [aid for aid in family_assets if aid is not None]
            if not target_asset_ids:
                raise ValueError("Schema extension requested but parent run has no annotated assets to re-run.")

        # Family-scoped delta: drop (asset, schema) pairs that are already
        # successfully annotated within the family. We keep an asset only if it
        # is missing at least one of the target schemas across the family.
        if target_asset_ids:
            existing_pairs = self.session.exec(
                select(Annotation.asset_id, Annotation.schema_id)
                .where(
                    Annotation.run_id.in_(family_run_ids),
                    Annotation.asset_id.in_(target_asset_ids),
                    Annotation.schema_id.in_(child_schema_ids),
                    Annotation.status != ResultStatus.FAILED,
                )
                .distinct()
            ).all()
            done_per_asset: Dict[int, set] = {}
            for asset_id, schema_id in existing_pairs:
                done_per_asset.setdefault(asset_id, set()).add(schema_id)
            target_set = set(child_schema_ids)
            delta_asset_ids = [
                aid for aid in target_asset_ids
                if done_per_asset.get(aid, set()) != target_set
            ]
            target_asset_ids = delta_asset_ids

        # If the delta is empty there is nothing to do — surface as a no-op
        # instead of creating an empty run that completes instantly.
        if not target_asset_ids and not target_bundle_id:
            raise ValueError(
                "Nothing to extend — every (asset, schema) pair is already annotated "
                "in this run's family."
            )

        # Build the child run.
        merged_config = dict(root.configuration or {})
        # Strip self-chain cursor state from parent — child starts fresh.
        merged_config.pop("_cursor", None)
        merged_config.pop("_chained_asset_ids", None)
        # Strip credentials. ``api_keys`` is a transient per-session snapshot
        # (from the dock at submission time) — carrying it forward would pin
        # the extension to whatever key was active when the parent ran, even
        # if the user has since rotated keys in infospace settings or has a
        # fresh BYOK in their browser. The runner's ``resolve()`` falls back
        # to current infospace credentials when ``runtime_key`` is None;
        # callers wanting BYOK pass fresh keys via ``configuration_overrides``.
        merged_config.pop("api_keys", None)
        if configuration_overrides:
            merged_config.update(configuration_overrides)
        if target_asset_ids:
            merged_config["target_asset_ids"] = target_asset_ids
        if target_bundle_id:
            merged_config["target_bundle_id"] = target_bundle_id

        child = AnnotationRun(
            name=f"{root.name} (extension)",
            description=(
                f"Extension of run {root.id}: "
                + (f"{len(target_asset_ids)} new assets" if target_asset_ids else f"bundle {target_bundle_id}")
                + (f" × {len(child_schema_ids)} schemas" if schema_ids else "")
            ),
            configuration=merged_config,
            status=RunStatus.PENDING,
            infospace_id=infospace_id,
            user_id=user_id,
            target_schemas=child_schemas,
            include_parent_context=root.include_parent_context,
            context_window=root.context_window,
            views_config=[],  # Children have no dashboards — parent owns the view.
            parent_run_id=root.id,
            run_type="one_off",
            trigger_type="extension",
            trigger_context={
                "parent_run_id": root.id,
                "extended_by_user_id": user_id,
                "delta_asset_count": len(target_asset_ids),
                "delta_schema_count": len(child_schema_ids) if schema_ids else 0,
            },
            tags=list(root.tags or []),
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.session.add(child)
        self.session.commit()
        self.session.refresh(child)

        emit("annotation_run.created", {"infospace_id": infospace_id})
        logger.info(
            "Service: Extension run %d created (parent=%d, %d assets × %d schemas).",
            child.id, root.id, len(target_asset_ids), len(child_schema_ids),
        )
        return child

    def _get_or_create_curation_schema(self, infospace_id: int, user_id: int) -> AnnotationSchema:
        """Get or create the schema for manual curations."""
        schema_name = "Manual Curation"
        schema = self.session.exec(
            select(AnnotationSchema).where(AnnotationSchema.name == schema_name, AnnotationSchema.infospace_id == infospace_id)
        ).first()
        if not schema:
            schema_create = AnnotationSchemaCreate(
                name=schema_name,
                description="A generic schema for manual curation of facts and fragments.",
                output_contract={
                    "type": "object",
                    "properties": {},
                    "additionalProperties": True,
                },
                instructions="This is a system schema for recording manually curated data.",
            )
            schema = self.create_annotation_schema(
                name=schema_create.name,
                description=schema_create.description,
                output_contract=schema_create.output_contract,
                instructions=schema_create.instructions,
                user_id=user_id,
                infospace_id=infospace_id,
            )
        return schema

    def _get_or_create_curation_run(self, infospace_id: int, user_id: int, schema_id: int) -> AnnotationRun:
        """Get or create the run for manual curations."""
        run_name = "Manual Curation Run"
        run = self.session.exec(
            select(AnnotationRun).where(AnnotationRun.name == run_name, AnnotationRun.infospace_id == infospace_id)
        ).first()
        if not run:
            run_create = AnnotationRunCreate(
                name=run_name,
                description="A run for all manual curation actions.",
                schema_ids=[schema_id],
                target_asset_ids=[]
            )
            run = self.create_run(user_id, infospace_id, run_create)
        elif schema_id not in [s.id for s in run.target_schemas]:
            run.target_schemas.append(self.session.get(AnnotationSchema, schema_id))
            self.session.add(run)
            self.session.commit()
            self.session.refresh(run)
        return run

    def curate_fragment(
        self, user_id: int, infospace_id: int, asset_id: int, field_name: str, value: Any,
        source_run_id: Optional[int] = None
    ) -> Annotation:
        """
        Creates an auditable record for a manual curation action.
        
        If source_run_id is provided, uses that run for source tracking (recommended).
        Otherwise, creates/uses a "Manual Curation Run" (legacy behavior).
        """
        if source_run_id:
            # NEW: Use the provided source run (fragments point to original annotation run)
            run = self.session.get(AnnotationRun, source_run_id)
            if not run:
                raise ValueError(f"Source run {source_run_id} not found")
            if run.infospace_id != infospace_id:
                raise ValueError(f"Source run {source_run_id} does not belong to infospace {infospace_id}")
            
            # Use the schema from the source run
            schema = run.target_schemas[0] if run.target_schemas else self._get_or_create_curation_schema(infospace_id, user_id)
        else:
            # LEGACY: Create/use Manual Curation Run
            schema = self._get_or_create_curation_schema(infospace_id, user_id)
            run = self._get_or_create_curation_run(infospace_id, user_id, schema.id)

        # Create the annotation that represents the curated fact
        annotation = self.create_annotation(
            asset_id=asset_id,
            schema_id=schema.id,
            run_id=run.id,
            user_id=user_id,
            infospace_id=infospace_id,
            value={field_name: value},
        )

        # Promote the fragment to the asset metadata
        asset = self.session.get(Asset, asset_id)
        if asset:
            fragments = asset.fragments or {}
            
            fragments[field_name] = {
                "value": value,
                "source_ref": f"annotation_run:{run.id}",  # Now points to ORIGINAL run!
                "curated_by_ref": f"user:{user_id}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "schema_id": schema.id,
            }
            asset.fragments = fragments
            
            # Mark as modified for SQLAlchemy
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(asset, "fragments")
            
            self.session.add(asset)
            self.session.commit()

        return annotation

    def delete_fragment(
        self, user_id: int, infospace_id: int, asset_id: int, fragment_key: str
    ) -> bool:
        """
        Deletes a fragment from an asset's curated fragments.
        Returns True if deletion was successful, False if fragment wasn't found.
        """
        from sqlalchemy.orm.attributes import flag_modified
        
        asset = self.session.get(Asset, asset_id)
        if not asset:
            raise ValueError(f"Asset {asset_id} not found")
        
        if asset.infospace_id != infospace_id:
            raise ValueError(f"Asset {asset_id} does not belong to infospace {infospace_id}")
        
        fragments = asset.fragments or {}
        
        if fragment_key not in fragments:
            return False
        
        # Remove the fragment
        del fragments[fragment_key]
        asset.fragments = fragments
        
        # Mark as modified for SQLAlchemy
        flag_modified(asset, "fragments")
        
        self.session.add(asset)
        self.session.commit()
        
        logger.info(f"Deleted fragment '{fragment_key}' from asset {asset_id} by user {user_id}")
        return True

    def compute_run_aggregates(
        self, run_id: int, replace_existing: bool = True, include_followups: bool = False
    ) -> List[RunAggregate]:
        """
        Compute RunAggregate from all annotations.
        If replace_existing, delete existing first.
        If include_followups, also include annotations from runs with parent_run_id=run_id.
        """
        if replace_existing:
            self.session.exec(delete(RunAggregate).where(RunAggregate.run_id == run_id))
            self.session.commit()
        run_ids = [run_id]
        if include_followups:
            followups = self.session.exec(
                select(AnnotationRun.id).where(AnnotationRun.parent_run_id == run_id)
            ).all()
            run_ids.extend(followups)
        annotations = self.session.exec(
            select(Annotation).where(Annotation.run_id.in_(run_ids))
        ).all()
        field_stats: Dict[str, Dict[str, Any]] = {}

        for ann in annotations:
            for field_path, value in _flatten("", ann.value or {}):
                kind = _value_kind(value)
                stats = field_stats.setdefault(field_path, {"kind": kind, "count": 0, "nulls": 0})
                stats["count"] += 1
                if value is None:
                    stats["nulls"] += 1
                if kind == "number":
                    s = stats.setdefault("num", {"sum": 0.0, "sum_sq": 0.0, "min": None, "max": None})
                    try:
                        x = float(value)
                        s["sum"] += x
                        s["sum_sq"] += x * x
                        s["min"] = x if s["min"] is None else min(s["min"], x)
                        s["max"] = x if s["max"] is None else max(s["max"], x)
                    except Exception:
                        pass
                elif kind == "string":
                    c: Counter[str] = stats.setdefault("topk", Counter())
                    c[str(value)] += 1
                elif kind == "bool":
                    b = stats.setdefault("bool", {"true": 0, "false": 0})
                    if bool(value):
                        b["true"] += 1
                    else:
                        b["false"] += 1
                elif kind == "datetime":
                    dt = stats.setdefault("dt", {"min": None, "max": None})
                    try:
                        t = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
                        dt["min"] = t.isoformat() if dt["min"] is None else min(dt["min"], t.isoformat())
                        dt["max"] = t.isoformat() if dt["max"] is None else max(dt["max"], t.isoformat())
                    except Exception:
                        pass

        created: List[RunAggregate] = []
        for path, stats in field_stats.items():
            kind = stats.get("kind", "unknown")
            payload: Dict[str, Any] = {"count": stats.get("count", 0), "nulls": stats.get("nulls", 0)}
            sketch_kind = "count"
            if kind == "number" and "num" in stats:
                n = max(1, stats["count"] - stats["nulls"])
                s = stats["num"]
                mean = s["sum"] / n
                var = max(0.0, (s["sum_sq"] / n) - mean * mean)
                payload.update({"min": s["min"], "max": s["max"], "mean": mean, "var": var})
                sketch_kind = "number_summary"
            elif kind == "string" and "topk" in stats:
                topk_list = stats["topk"].most_common(10)
                payload.update({"topk": topk_list})
                sketch_kind = "topk"
            elif kind == "bool" and "bool" in stats:
                payload.update(stats["bool"])  # true/false counts
                sketch_kind = "bool_counts"
            elif kind == "datetime" and "dt" in stats:
                payload.update(stats["dt"])  # min/max
                sketch_kind = "datetime_minmax"

            agg = RunAggregate(
                run_id=run_id,
                field_path=path,
                value_kind=kind,
                sketch_kind=sketch_kind,
                payload=payload,
            )
            self.session.add(agg)
            created.append(agg)

        self.session.commit()
        return created
