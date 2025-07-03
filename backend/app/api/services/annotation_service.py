"""Service for handling annotations."""
import logging
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timezone
from sqlmodel import Session, select, func
from fastapi import Depends

from app.models import (
    Annotation,
    AnnotationSchema,
    AnnotationSchemaTargetLevel,
    Asset,
    RunStatus,
    AnnotationRun,
    ResultStatus,
)
from app.schemas import AnnotationCreate
from app.api.services.service_utils import validate_infospace_access
from app.api.tasks.annotate import process_annotation_run, retry_failed_annotations
from app.api.providers.base import ClassificationProvider
from app.api.services.asset_service import AssetService

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

class AnnotationService:
    """Service for handling annotations."""
    
    def __init__(self, session: Session, classification_provider: ClassificationProvider, asset_service: AssetService):
        """Initialize the service with a database session and dependencies."""
        self.session = session
        self.classification_provider = classification_provider
        self.asset_service = asset_service
    
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
        
        # Validate infospace access
        validate_infospace_access(self.session, infospace_id, user_id)
        
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
        
        # Validate infospace access
        validate_infospace_access(self.session, infospace_id, user_id)
        
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
        self.session.flush()  # Get ID
        
        # Queue the run for processing
        try:
            process_annotation_run.delay(run.id)
            logger.info(f"Queued annotation task for run {run.id}")
            return True, run.id
        except Exception as e:
            logger.error(f"Failed to queue annotation task for run {run.id}: {e}")
            self.session.rollback()
            return False, None
    
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
        
        # Validate infospace access
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Get the run
        run = self.session.get(AnnotationRun, run_id)
        if not run:
            raise ValueError(f"Run with ID {run_id} not found")
        if run.infospace_id != infospace_id:
            raise ValueError(f"Run with ID {run_id} does not belong to infospace {infospace_id}")
        
        # Check run status
        if run.status != RunStatus.COMPLETED_WITH_ERRORS:
            raise ValueError(f"Run {run_id} is not in a state that can be retried (status: {run.status})")
        
        # Queue the retry task
        try:
            retry_failed_annotations.delay(run.id)
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
            if user_id:
                validate_infospace_access(self.session, infospace_id, user_id)
        
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
            if user_id:
                validate_infospace_access(self.session, infospace_id, user_id)
        
        query = (
            select(Annotation)
            .where(Annotation.schema_id == schema_id)
            .offset(skip)
            .limit(limit)
        )
        
        return list(self.session.exec(query))
    
    def get_annotations_for_run(
        self,
        run_id: int,
        user_id: int,
        infospace_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[Annotation]:
        """
        Get all annotations for a specific run.
        
        Args:
            run_id: ID of the run
            user_id: ID of the user requesting the annotations
            infospace_id: ID of the infospace
            skip: Number of records to skip
            limit: Maximum number of records to return
            
        Returns:
            List of annotations
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Getting annotations for run {run_id}")

        # Validate infospace access
        validate_infospace_access(self.session, infospace_id, user_id)

        # Optional: Validate run exists and belongs to infospace
        run = self.session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != infospace_id:
            raise ValueError("Run not found in this infospace.")

        query = (
            select(Annotation)
            .where(Annotation.run_id == run_id)
            .offset(skip)
            .limit(limit)
        )
        annotations = self.session.exec(query).all()
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
        
        # Validate infospace access
        validate_infospace_access(self.session, infospace_id, user_id)
        
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
        
        # Validate infospace access
        validate_infospace_access(self.session, infospace_id, user_id)
        
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
        
        # Validate infospace access
        validate_infospace_access(self.session, infospace_id, user_id)
        
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
        
        # Validate infospace access
        validate_infospace_access(self.session, infospace_id, user_id)
        
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
        
        # Validate infospace access
        validate_infospace_access(self.session, infospace_id, user_id)
        
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
        field_specific_justification_configs: Optional[Dict[str, Any]] = None
    ) -> AnnotationSchema:
        """
        Create a new Annotation Schema.
        
        Args:
            name: Name of the schema
            output_contract: JSON schema defining the output
            user_id: ID of the user creating the schema
            infospace_id: ID of the infospace
            description: Optional description
            instructions: Optional instructions for the LLM
            version: Schema version
            field_specific_justification_configs: Optional dict for field-specific justification settings
            
        Returns:
            The created AnnotationSchema
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Creating annotation schema '{name}' in infospace {infospace_id}")
        
        # Validate infospace access
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Check for existing schema with the same name and version in the infospace
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
            field_specific_justification_configs=field_specific_justification_configs or {},
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
        run_in: Any
    ) -> AnnotationRun:
        """
        Create a new Annotation Run and trigger its processing.
        
        Args:
            user_id: ID of the user creating the run
            infospace_id: ID of the infospace
            run_in: AnnotationRunCreate object containing run details
            
        Returns:
            The created AnnotationRun
            
        Raises:
            ValueError: If validation fails (e.g., schema not found)
        """
        logger.info(f"Service: Creating annotation run '{run_in.name}' in infospace {infospace_id}")

        # Validate infospace access (already done in route, but good practice)
        validate_infospace_access(self.session, infospace_id, user_id)

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
        if not run_in.target_asset_ids and not run_in.target_bundle_id:
            raise ValueError("Either target_asset_ids or target_bundle_id must be provided.")
        if run_in.target_asset_ids and run_in.target_bundle_id:
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
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )

        self.session.add(db_run)
        self.session.commit()
        self.session.refresh(db_run)

        # Trigger the Celery task
        try:
            process_annotation_run.delay(db_run.id)
            logger.info(f"Service: Annotation task for run {db_run.id} ('{db_run.name}') queued successfully.")
        except Exception as e_celery:
            logger.error(f"Service: Failed to queue annotation task for run {db_run.id}: {e_celery}")
            # Potentially mark run as failed or requiring manual trigger
            db_run.status = RunStatus.FAILED
            db_run.error_message = f"Failed to queue Celery task: {e_celery}"
            self.session.add(db_run)
            self.session.commit()
            self.session.refresh(db_run)
            # Re-raise or handle appropriately depending on desired behavior
            raise ValueError(f"Failed to queue annotation task: {e_celery}") from e_celery

        return db_run 