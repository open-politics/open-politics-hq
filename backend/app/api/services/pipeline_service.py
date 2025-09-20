import logging
from typing import Dict, Any, List, Optional, Set, Tuple
import asyncio
from sqlmodel import Session, select
from app.models import (
    IntelligencePipeline,
    PipelineStep,
    PipelineExecution,
    Bundle,
    AnnotationRun,
    Annotation,
    PipelineProcessedAsset,
)
from app.schemas import IntelligencePipelineCreate, IntelligencePipelineUpdate
from app.api.services.annotation_service import AnnotationService
from app.api.services.analysis_service import AnalysisService
from app.api.services.bundle_service import BundleService
from app.api.services.service_utils import validate_infospace_access
from app.api.services.filter_service import FilterService, FilterExpression
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class PipelineService:
    def __init__(self, session: Session, annotation_service: AnnotationService, analysis_service: AnalysisService, bundle_service: BundleService):
        self.session = session
        self.annotation_service = annotation_service
        self.analysis_service = analysis_service
        self.bundle_service = bundle_service
        self.filter_service = FilterService()

    def create_pipeline(self, pipeline_in: IntelligencePipelineCreate, user_id: int, infospace_id: int) -> IntelligencePipeline:
        validate_infospace_access(self.session, infospace_id, user_id)
        
        pipeline_data = pipeline_in.model_dump(exclude={"steps"})
        db_pipeline = IntelligencePipeline(**pipeline_data, user_id=user_id, infospace_id=infospace_id)
        
        for step_data in pipeline_in.steps:
            db_pipeline.steps.append(PipelineStep(**step_data.model_dump()))
            
        self.session.add(db_pipeline)
        self.session.commit()
        self.session.refresh(db_pipeline)
        return db_pipeline

    def get_pipeline(self, pipeline_id: int, user_id: int) -> Optional[IntelligencePipeline]:
        pipeline = self.session.get(IntelligencePipeline, pipeline_id)
        if pipeline and pipeline.user_id == user_id:
            return pipeline
        return None

    def list_pipelines(self, user_id: int, infospace_id: int, skip: int = 0, limit: int = 100) -> List[IntelligencePipeline]:
        validate_infospace_access(self.session, infospace_id, user_id)
        pipelines = self.session.exec(
            select(IntelligencePipeline).where(IntelligencePipeline.infospace_id == infospace_id).offset(skip).limit(limit)
        ).all()
        return pipelines

    def update_pipeline(self, pipeline_id: int, pipeline_in: IntelligencePipelineUpdate, user_id: int) -> Optional[IntelligencePipeline]:
        db_pipeline = self.get_pipeline(pipeline_id, user_id)
        if not db_pipeline:
            return None
        
        update_data = pipeline_in.model_dump(exclude_unset=True, exclude={"steps"})
        for key, value in update_data.items():
            setattr(db_pipeline, key, value)

        if "steps" in pipeline_in.model_dump(exclude_unset=True):
            # Clear existing steps and add new ones
            db_pipeline.steps = []
            for step_data in pipeline_in.steps:
                db_pipeline.steps.append(PipelineStep(**step_data.model_dump()))

        self.session.add(db_pipeline)
        self.session.commit()
        self.session.refresh(db_pipeline)
        return db_pipeline

    def delete_pipeline(self, pipeline_id: int, user_id: int) -> bool:
        pipeline = self.get_pipeline(pipeline_id, user_id)
        if not pipeline:
            return False
        
        # Manually delete steps to ensure cascade works if not configured in DB
        for step in pipeline.steps:
            self.session.delete(step)
        
        self.session.delete(pipeline)
        self.session.commit()
        return True

    def trigger_pipeline(self, pipeline_id: int, asset_ids: List[int], trigger_type: str = "ON_NEW_ASSET") -> PipelineExecution:
        pipeline = self.session.get(IntelligencePipeline, pipeline_id)
        if not pipeline:
            raise ValueError("Pipeline not found")

        execution = PipelineExecution(
            pipeline_id=pipeline_id,
            status="RUNNING",
            trigger_type=trigger_type,
            triggering_asset_ids=asset_ids
        )
        self.session.add(execution)
        self.session.commit()
        self.session.refresh(execution)

        # Trigger the first step
        from app.api.tasks.pipeline_tasks import execute_pipeline_step
        execute_pipeline_step.delay(execution_id=execution.id, step_order=1)

        return execution

    def run_pipeline_step(self, execution_id: int, step_order: int):
        execution = self.session.get(PipelineExecution, execution_id)
        if not execution or execution.status != "RUNNING":
            return

        step = next((s for s in execution.pipeline.steps if s.step_order == step_order), None)
        if not step:
            execution.status = "FAILED"
            self.session.add(execution)
            self.session.commit()
            raise ValueError(f"Step {step_order} not found in pipeline {execution.pipeline_id}")

        # Determine input assets for this step
        input_asset_ids = self._get_input_assets_for_step(execution, step)

        if not input_asset_ids:
            logger.info(f"Step {step_order} for execution {execution_id} has no input assets. Skipping.")
            # Move to next step or complete if this was the last one
            self._continue_or_complete_pipeline(execution, step_order, {"status": "skipped", "reason": "no_input"})
            return

        # Execute step based on type
        output = None
        if step.step_type == "ANNOTATE":
            output = self._execute_annotate_step(step, input_asset_ids, execution)
        elif step.step_type == "FILTER":
            output = self._execute_filter_step(step, execution)
        elif step.step_type == "ANALYZE":
            output = self._execute_analyze_step(step, execution)
        elif step.step_type == "ROUTE":
            output = self._execute_route_step(step, execution)
        elif step.step_type == "CURATE":
            output = self._execute_curate_step(step, execution)
        elif step.step_type == "BUNDLE":
            output = self._execute_bundle_step(step, execution)
        
        # Save output and trigger next step
        self._continue_or_complete_pipeline(execution, step_order, output)

    def _get_input_assets_for_step(self, execution: PipelineExecution, step: PipelineStep) -> List[int]:
        input_source = step.input_source
        if input_source.get("source") == "PIPELINE_START":
            # Resolve delta assets from pipeline source bundles
            delta_assets = self._resolve_start_assets_delta(execution.pipeline)
            # Flatten to a unique list of asset ids
            unique_asset_ids: Set[int] = set()
            for asset_ids in delta_assets.values():
                unique_asset_ids.update(asset_ids)
            return list(unique_asset_ids)
        elif input_source.get("source") == "FROM_STEP":
            source_step_order = input_source.get("step_order")
            previous_output = execution.step_outputs.get(str(source_step_order))
            if previous_output and isinstance(previous_output.get("passed_asset_ids"), list):
                return previous_output["passed_asset_ids"]
        return []

    def _resolve_start_assets_delta(self, pipeline: IntelligencePipeline) -> Dict[int, List[int]]:
        """Return mapping of input_bundle_id -> list of unprocessed asset_ids for this pipeline.
        Delta = assets in bundle minus rows in PipelineProcessedAsset for (pipeline_id, bundle_id).
        """
        bundle_to_assets: Dict[int, Set[int]] = {}
        # Load all assets for each source bundle
        for bundle_id in pipeline.source_bundle_ids or []:
            bundle = self.session.get(Bundle, bundle_id)
            if not bundle:
                continue
            bundle_asset_ids: Set[int] = set(a.id for a in bundle.assets)
            bundle_to_assets[bundle_id] = bundle_asset_ids

        if not bundle_to_assets:
            return {}

        # Load processed asset ids for each input bundle
        processed_map: Dict[int, Set[int]] = {}
        rows = self.session.exec(
            select(PipelineProcessedAsset).where(PipelineProcessedAsset.pipeline_id == pipeline.id)
        ).all()
        for row in rows:
            processed_map.setdefault(row.input_bundle_id, set()).add(row.asset_id)

        # Compute delta
        delta: Dict[int, List[int]] = {}
        for b_id, aset in bundle_to_assets.items():
            already: Set[int] = processed_map.get(b_id, set())
            delta_ids = list(aset - already)
            if delta_ids:
                delta[b_id] = delta_ids
        return delta

    def _execute_annotate_step(self, step: PipelineStep, asset_ids: List[int], execution: PipelineExecution) -> Dict:
        from app.schemas import AnnotationRunCreate
        run_in = AnnotationRunCreate(
            name=step.configuration.get("run_name_template", f"Pipeline Step {step.step_order}"),
            schema_ids=step.configuration["schema_ids"],
            target_asset_ids=asset_ids
        )
        new_run = self.annotation_service.create_run(
            user_id=execution.pipeline.user_id,
            infospace_id=execution.pipeline.infospace_id,
            run_in=run_in
        )
        # NOTE: This assumes create_run is synchronous or we wait for its completion.
        # For a truly robust system, this step would need to wait for the Celery task
        # created by create_run to finish. This can be done with Celery Chords.
        return {"run_id": new_run.id, "processed_asset_ids": asset_ids}

    def _execute_filter_step(self, step: PipelineStep, execution: PipelineExecution) -> Dict:
        """
        Execute a filter step using the comprehensive filtering framework.
        
        Configuration options:
        - filter_name: Reference to a saved filter by name
        - filter_expression: Inline filter expression definition
        - rules: Legacy simple rules format (converted automatically)
        """
        prev_step_output = execution.step_outputs.get(str(step.input_source.get("step_order")))
        if not prev_step_output or "run_id" not in prev_step_output:
            raise ValueError("Filter step requires a preceding ANNOTATE step.")

        run_id = prev_step_output["run_id"]
        annotations = self.session.exec(select(Annotation).where(Annotation.run_id == run_id)).all()
        
        # Get the filter expression
        filter_expression = self._get_filter_expression(step.configuration)
        
        # Apply filter to annotations
        passed_asset_ids = set()
        filter_stats = {
            "total_annotations": len(annotations),
            "passed_annotations": 0,
            "failed_annotations": 0,
            "error_annotations": 0
        }
        
        for annotation in annotations:
            try:
                # Create data context for filtering - include annotation value and metadata
                filter_context = {
                    **annotation.value,  # All annotation fields at root level
                    "annotation_id": annotation.id,
                    "asset_id": annotation.asset_id,
                    "schema_id": annotation.schema_id,
                    "run_id": annotation.run_id,
                    "created_at": annotation.created_at.isoformat() if annotation.created_at else None,
                    # Add asset and schema info if available
                    "asset": {
                        "id": annotation.asset.id,
                        "title": annotation.asset.title,
                        "kind": annotation.asset.kind.value if annotation.asset.kind else None,
                        "created_at": annotation.asset.created_at.isoformat() if annotation.asset.created_at else None,
                    } if annotation.asset else {},
                    "schema": {
                        "id": annotation.schema.id,
                        "name": annotation.schema.name,
                    } if annotation.schema else {}
                }
                
                if filter_expression.evaluate(filter_context):
                    passed_asset_ids.add(annotation.asset_id)
                    filter_stats["passed_annotations"] += 1
                else:
                    filter_stats["failed_annotations"] += 1
                    
            except Exception as e:
                logger.error(f"Error evaluating filter for annotation {annotation.id}: {e}")
                filter_stats["error_annotations"] += 1
        
        logger.info(f"Filter step {step.step_order}: {filter_stats}")
        
        return {
            "passed_asset_ids": list(passed_asset_ids),
            "filter_stats": filter_stats,
            "filter_expression_used": filter_expression.to_dict()
        }
    
    def _get_filter_expression(self, config: Dict[str, Any]) -> FilterExpression:
        """Get filter expression from step configuration."""
        # Option 1: Reference to saved filter
        if "filter_name" in config:
            filter_name = config["filter_name"]
            saved_filter = self.filter_service.get_filter(filter_name)
            if saved_filter:
                logger.info(f"Using saved filter: {filter_name}")
                return saved_filter
            else:
                raise ValueError(f"Saved filter '{filter_name}' not found")
        
        # Option 2: Inline filter expression
        if "filter_expression" in config:
            return FilterExpression.from_dict(config["filter_expression"])
        
        # Option 3: Create from configuration (legacy and new formats)
        return self.filter_service.create_from_config(config)

    def _execute_analyze_step(self, step: PipelineStep, execution: PipelineExecution) -> Dict:
        prev_step_output = execution.step_outputs.get(str(step.input_source.get("step_order")))
        run_id = prev_step_output.get("run_id") if prev_step_output else None
        
        adapter_config = step.configuration.get("adapter_config", {})
        adapter_config["target_run_id"] = run_id # Inject the run_id
        
        # Ensure we await async execution
        async def _run_adapter():
            return await self.analysis_service.execute_adapter(
                adapter_name=step.configuration["adapter_name"],
                config=adapter_config,
                infospace_id=execution.pipeline.infospace_id
            )

        try:
            # In Celery sync context, no event loop should be running
            result = asyncio.run(_run_adapter())
        except RuntimeError:
            # Fallback if a loop is already running
            loop = asyncio.get_event_loop()
            result = loop.run_until_complete(_run_adapter())
        return {"analysis_result": result}

    def _execute_route_step(self, step: PipelineStep, execution: PipelineExecution) -> Dict:
        prev_step_output = execution.step_outputs.get(str(step.input_source.get("step_order")))
        if not prev_step_output or "run_id" not in prev_step_output:
            raise ValueError("ROUTE step requires a preceding ANNOTATE step.")
        run_id = prev_step_output["run_id"]

        # Determine which assets match via a filter expression (optional)
        filter_expression = None
        if "filter_expression" in step.configuration or "filter_name" in step.configuration or "rules" in step.configuration:
            filter_expression = self._get_filter_expression(step.configuration)

        annotations = self.session.exec(select(Annotation).where(Annotation.run_id == run_id)).all()
        matched_asset_ids: Set[int] = set()
        for annotation in annotations:
            if filter_expression is None:
                matched_asset_ids.add(annotation.asset_id)
            else:
                context = {**annotation.value, "asset_id": annotation.asset_id, "schema_id": annotation.schema_id, "run_id": annotation.run_id}
                try:
                    if filter_expression.evaluate(context):
                        matched_asset_ids.add(annotation.asset_id)
                except Exception:
                    continue

        target_bundle_ids: List[int] = step.configuration.get("bundle_ids", [])
        for asset_id in matched_asset_ids:
            for bundle_id in target_bundle_ids:
                self.bundle_service.add_asset_to_bundle(
                    bundle_id=bundle_id,
                    asset_id=asset_id,
                    infospace_id=execution.pipeline.infospace_id,
                    user_id=execution.pipeline.user_id
                )
        return {"routed_asset_ids": list(matched_asset_ids), "target_bundle_ids": target_bundle_ids}

    def _execute_curate_step(self, step: PipelineStep, execution: PipelineExecution) -> Dict:
        prev_step_output = execution.step_outputs.get(str(step.input_source.get("step_order")))
        if not prev_step_output or "run_id" not in prev_step_output:
            raise ValueError("CURATE step requires a preceding ANNOTATE step.")
        run_id = prev_step_output["run_id"]

        fields_to_curate: List[str] = step.configuration.get("fields", [])
        curated_count = 0

        annotations = self.session.exec(select(Annotation).where(Annotation.run_id == run_id)).all()
        now = datetime.now(timezone.utc)
        for annotation in annotations:
            asset = annotation.asset
            if not asset:
                continue
            fragments = asset.fragments or {}
            for field_name in fields_to_curate:
                if field_name in (annotation.value or {}):
                    fragments[field_name] = {
                        "value": annotation.value[field_name],
                        "source_ref": {"type": "run", "id": run_id},
                        "updated_at": now.isoformat(),
                    }
                    curated_count += 1
            asset.fragments = fragments
            self.session.add(asset)
        self.session.commit()
        return {"curated_fields": fields_to_curate, "curated_items": curated_count}

    def _execute_bundle_step(self, step: PipelineStep, execution: PipelineExecution) -> Dict:
        asset_ids_to_bundle = self._get_input_assets_for_step(execution, step)
        bundle_id = step.configuration["bundle_id"]
        
        for asset_id in asset_ids_to_bundle:
            self.bundle_service.add_asset_to_bundle(
                bundle_id=bundle_id,
                asset_id=asset_id,
                infospace_id=execution.pipeline.infospace_id,
                user_id=execution.pipeline.user_id
            )
        return {"bundled_asset_ids": asset_ids_to_bundle}

    def _continue_or_complete_pipeline(self, execution: PipelineExecution, current_step_order: int, output: Dict):
        execution.step_outputs[str(current_step_order)] = output
        
        next_step = next((s for s in execution.pipeline.steps if s.step_order == current_step_order + 1), None)
        
        if next_step:
            from app.api.tasks.pipeline_tasks import execute_pipeline_step
            execute_pipeline_step.delay(execution_id=execution.id, step_order=next_step.step_order)
        else:
            execution.status = "COMPLETED"
            execution.completed_at = datetime.now(timezone.utc)

            # Record processed assets for delta tracking
            try:
                first_output = execution.step_outputs.get("1", {})
                processed_asset_ids: List[int] = first_output.get("processed_asset_ids", [])
                if processed_asset_ids:
                    # Map assets to their input bundles
                    bundle_to_assets = self._resolve_start_assets_delta(execution.pipeline)
                    # The helper returns only delta assets; but now that we completed, treat any of processed_asset_ids
                    # For mapping, re-load actual bundle membership
                    for bundle_id in execution.pipeline.source_bundle_ids or []:
                        bundle = self.session.get(Bundle, bundle_id)
                        if not bundle:
                            continue
                        bundle_asset_ids = set(a.id for a in bundle.assets)
                        to_insert = [aid for aid in processed_asset_ids if aid in bundle_asset_ids]
                        for aid in to_insert:
                            self.session.add(PipelineProcessedAsset(
                                pipeline_id=execution.pipeline_id,
                                input_bundle_id=bundle_id,
                                asset_id=aid,
                                processed_at=datetime.now(timezone.utc)
                            ))
                    self.session.commit()
            except Exception as e:
                logger.error(f"Failed to record PipelineProcessedAsset rows for execution {execution.id}: {e}")
        
        self.session.add(execution)
        self.session.commit() 