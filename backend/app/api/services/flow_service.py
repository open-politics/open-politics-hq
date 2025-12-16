"""
Flow Service
============

Unified service for managing Flows - the core abstraction that replaces
Monitor and IntelligencePipeline with a single, composable workflow model.

Flows define:
- What to watch (input: stream/bundle/manual)
- What processing to apply (steps: annotate, filter, curate, route, etc.)
- When to run (trigger: on_arrival, scheduled, manual)
"""

import logging
from typing import Dict, Any, List, Optional, Set, Tuple
from datetime import datetime, timezone
from sqlmodel import Session, select, func

from app.models import (
    Flow,
    FlowExecution,
    FlowStatus,
    FlowInputType,
    FlowTriggerMode,
    FlowStepType,
    RunStatus,
    RunType,
    AnnotationRun,
    AnnotationSchema,
    Annotation,
    Asset,
    Bundle,
    Source,
    User,
)
from app.schemas import FlowCreate, FlowUpdate, FlowExecutionCreate
from app.api.services.service_utils import validate_infospace_access
from app.api.services.annotation_service import AnnotationService
from app.api.services.bundle_service import BundleService
from app.api.services.filter_service import FilterService, FilterExpression

logger = logging.getLogger(__name__)


class FlowService:
    """
    Service for managing Flows and their executions.
    
    Replaces:
    - MonitorService (single-step annotation on bundle watch)
    - PipelineService (multi-step processing workflows)
    """
    
    def __init__(
        self,
        session: Session,
        annotation_service: Optional[AnnotationService] = None,
        bundle_service: Optional[BundleService] = None,
    ):
        self.session = session
        self.annotation_service = annotation_service
        self.bundle_service = bundle_service
        self.filter_service = FilterService()
        
        logger.info("FlowService initialized")
    
    # ═══════════════════════════════════════════════════════════════════════════
    # FLOW CRUD OPERATIONS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def create_flow(
        self,
        flow_in: FlowCreate,
        user_id: int,
        infospace_id: int,
    ) -> Flow:
        """
        Create a new Flow.
        
        Args:
            flow_in: Flow creation data
            user_id: User creating the flow
            infospace_id: Target infospace
            
        Returns:
            Created Flow
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Validate input configuration
        self._validate_flow_input(flow_in, infospace_id)
        
        # Validate steps
        self._validate_flow_steps(flow_in.steps, infospace_id)
        
        flow = Flow(
            name=flow_in.name,
            description=flow_in.description,
            infospace_id=infospace_id,
            user_id=user_id,
            status=FlowStatus.DRAFT,
            input_type=FlowInputType(flow_in.input_type),
            input_source_id=flow_in.input_source_id,
            input_bundle_id=flow_in.input_bundle_id,
            trigger_mode=FlowTriggerMode(flow_in.trigger_mode),
            steps=flow_in.steps,
            views_config=flow_in.views_config or [],
            tags=flow_in.tags or [],
            cursor_state={},
        )
        
        self.session.add(flow)
        self.session.commit()
        self.session.refresh(flow)
        
        logger.info(f"Created Flow {flow.id}: '{flow.name}'")
        return flow
    
    def get_flow(
        self,
        flow_id: int,
        user_id: int,
        infospace_id: int,
    ) -> Optional[Flow]:
        """Get a Flow by ID."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        flow = self.session.get(Flow, flow_id)
        if flow and flow.infospace_id == infospace_id:
            return flow
        return None
    
    def list_flows(
        self,
        user_id: int,
        infospace_id: int,
        skip: int = 0,
        limit: int = 100,
        status_filter: Optional[FlowStatus] = None,
        input_type_filter: Optional[FlowInputType] = None,
        tags_filter: Optional[List[str]] = None,
    ) -> Tuple[List[Flow], int]:
        """List Flows with optional filtering."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        query = select(Flow).where(Flow.infospace_id == infospace_id)
        count_query = select(func.count(Flow.id)).where(Flow.infospace_id == infospace_id)
        
        if status_filter:
            query = query.where(Flow.status == status_filter)
            count_query = count_query.where(Flow.status == status_filter)
        
        if input_type_filter:
            query = query.where(Flow.input_type == input_type_filter)
            count_query = count_query.where(Flow.input_type == input_type_filter)
        
        # Note: Tag filtering would require JSONB contains operator
        # For now, we filter in Python (can be optimized later)
        
        total_count = self.session.exec(count_query).one()
        
        query = query.order_by(Flow.updated_at.desc()).offset(skip).limit(limit)
        flows = list(self.session.exec(query))
        
        # Filter by tags if provided
        if tags_filter:
            flows = [f for f in flows if any(tag in f.tags for tag in tags_filter)]
        
        return flows, total_count
    
    def update_flow(
        self,
        flow_id: int,
        flow_in: FlowUpdate,
        user_id: int,
        infospace_id: int,
    ) -> Optional[Flow]:
        """Update a Flow."""
        flow = self.get_flow(flow_id, user_id, infospace_id)
        if not flow:
            return None
        
        update_data = flow_in.model_dump(exclude_unset=True)
        
        # Validate steps if being updated
        if "steps" in update_data:
            self._validate_flow_steps(update_data["steps"], infospace_id)
        
        # Validate input config if being updated
        if "input_type" in update_data or "input_source_id" in update_data or "input_bundle_id" in update_data:
            # Create a temporary object for validation
            temp = FlowCreate(
                name=flow.name,
                input_type=update_data.get("input_type", flow.input_type.value),
                input_source_id=update_data.get("input_source_id", flow.input_source_id),
                input_bundle_id=update_data.get("input_bundle_id", flow.input_bundle_id),
            )
            self._validate_flow_input(temp, infospace_id)
        
        for key, value in update_data.items():
            if key == "status":
                value = FlowStatus(value)
            elif key == "input_type":
                value = FlowInputType(value)
            elif key == "trigger_mode":
                value = FlowTriggerMode(value)
            setattr(flow, key, value)
        
        flow.updated_at = datetime.now(timezone.utc)
        self.session.add(flow)
        self.session.commit()
        self.session.refresh(flow)
        
        logger.info(f"Updated Flow {flow_id}")
        return flow
    
    def delete_flow(
        self,
        flow_id: int,
        user_id: int,
        infospace_id: int,
    ) -> bool:
        """Delete a Flow and its executions."""
        flow = self.get_flow(flow_id, user_id, infospace_id)
        if not flow:
            return False
        
        # Delete executions first
        executions = self.session.exec(
            select(FlowExecution).where(FlowExecution.flow_id == flow_id)
        ).all()
        for execution in executions:
            self.session.delete(execution)
        
        self.session.delete(flow)
        self.session.commit()
        
        logger.info(f"Deleted Flow {flow_id} and {len(executions)} executions")
        return True
    
    def activate_flow(
        self,
        flow_id: int,
        user_id: int,
        infospace_id: int,
    ) -> Optional[Flow]:
        """Activate a Flow for processing."""
        flow = self.get_flow(flow_id, user_id, infospace_id)
        if not flow:
            return None
        
        # Validate flow is ready to be activated
        if not flow.steps:
            raise ValueError("Flow has no steps defined")
        
        if flow.input_type == FlowInputType.BUNDLE and not flow.input_bundle_id:
            raise ValueError("Bundle input type requires input_bundle_id")
        
        if flow.input_type == FlowInputType.STREAM and not flow.input_source_id:
            raise ValueError("Stream input type requires input_source_id")
        
        flow.status = FlowStatus.ACTIVE
        flow.updated_at = datetime.now(timezone.utc)
        self.session.add(flow)
        self.session.commit()
        self.session.refresh(flow)
        
        logger.info(f"Activated Flow {flow_id}")
        return flow
    
    def pause_flow(
        self,
        flow_id: int,
        user_id: int,
        infospace_id: int,
    ) -> Optional[Flow]:
        """Pause a Flow."""
        flow = self.get_flow(flow_id, user_id, infospace_id)
        if not flow:
            return None
        
        flow.status = FlowStatus.PAUSED
        flow.updated_at = datetime.now(timezone.utc)
        self.session.add(flow)
        self.session.commit()
        self.session.refresh(flow)
        
        logger.info(f"Paused Flow {flow_id}")
        return flow
    
    # ═══════════════════════════════════════════════════════════════════════════
    # FLOW EXECUTION
    # ═══════════════════════════════════════════════════════════════════════════
    
    def trigger_execution(
        self,
        flow_id: int,
        user_id: int,
        infospace_id: int,
        execution_in: Optional[FlowExecutionCreate] = None,
        triggered_by: str = "manual",
        triggered_by_task_id: Optional[int] = None,
        triggered_by_source_id: Optional[int] = None,
    ) -> FlowExecution:
        """
        Trigger a Flow execution.
        
        Args:
            flow_id: Flow to execute
            user_id: User triggering the execution
            infospace_id: Infospace context
            execution_in: Optional execution configuration
            triggered_by: What triggered this (manual, task, on_arrival, source_poll)
            triggered_by_task_id: Task ID if triggered by task
            triggered_by_source_id: Source ID if triggered by source poll
            
        Returns:
            Created FlowExecution
        """
        flow = self.get_flow(flow_id, user_id, infospace_id)
        if not flow:
            raise ValueError(f"Flow {flow_id} not found")
        
        # Get input assets
        if execution_in and execution_in.asset_ids:
            # Manual trigger with explicit assets
            input_asset_ids = execution_in.asset_ids
        else:
            # Get delta assets based on flow input config
            input_asset_ids = self._get_delta_assets(flow)
        
        if not input_asset_ids:
            logger.info(f"Flow {flow_id}: No new assets to process")
            # Still create an execution record for tracking
        
        # Create execution record
        execution = FlowExecution(
            flow_id=flow_id,
            triggered_by=triggered_by,
            triggered_by_task_id=triggered_by_task_id,
            triggered_by_source_id=triggered_by_source_id,
            trigger_context={
                "user_id": user_id,
                "infospace_id": infospace_id,
            },
            status=RunStatus.PENDING,
            input_asset_ids=input_asset_ids,
            output_asset_ids=[],
            step_outputs={},
            tags=execution_in.tags if execution_in else [],
        )
        
        self.session.add(execution)
        self.session.commit()
        self.session.refresh(execution)
        
        # Queue the execution for processing
        from app.api.tasks.flow_tasks import execute_flow
        execute_flow.delay(execution.id)
        
        logger.info(f"Triggered Flow {flow_id} execution {execution.id} with {len(input_asset_ids)} assets")
        return execution
    
    def get_execution(
        self,
        execution_id: int,
        user_id: int,
        infospace_id: int,
    ) -> Optional[FlowExecution]:
        """Get a FlowExecution by ID."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        execution = self.session.get(FlowExecution, execution_id)
        if not execution:
            return None
        
        # Verify flow belongs to infospace
        flow = self.session.get(Flow, execution.flow_id)
        if not flow or flow.infospace_id != infospace_id:
            return None
        
        return execution
    
    def list_executions(
        self,
        flow_id: int,
        user_id: int,
        infospace_id: int,
        skip: int = 0,
        limit: int = 50,
        status_filter: Optional[RunStatus] = None,
    ) -> Tuple[List[FlowExecution], int]:
        """List FlowExecutions for a Flow."""
        flow = self.get_flow(flow_id, user_id, infospace_id)
        if not flow:
            return [], 0
        
        query = select(FlowExecution).where(FlowExecution.flow_id == flow_id)
        count_query = select(func.count(FlowExecution.id)).where(FlowExecution.flow_id == flow_id)
        
        if status_filter:
            query = query.where(FlowExecution.status == status_filter)
            count_query = count_query.where(FlowExecution.status == status_filter)
        
        total_count = self.session.exec(count_query).one()
        
        query = query.order_by(FlowExecution.created_at.desc()).offset(skip).limit(limit)
        executions = list(self.session.exec(query))
        
        return executions, total_count
    
    # ═══════════════════════════════════════════════════════════════════════════
    # STEP EXECUTION (called by Celery task)
    # ═══════════════════════════════════════════════════════════════════════════
    
    def run_execution(self, execution_id: int) -> FlowExecution:
        """
        Execute a FlowExecution (called by Celery task).
        
        Runs each step in sequence, updating step_outputs as it goes.
        """
        execution = self.session.get(FlowExecution, execution_id)
        if not execution:
            raise ValueError(f"FlowExecution {execution_id} not found")
        
        flow = self.session.get(Flow, execution.flow_id)
        if not flow:
            raise ValueError(f"Flow {execution.flow_id} not found")
        
        # Update execution status
        execution.status = RunStatus.RUNNING
        execution.started_at = datetime.now(timezone.utc)
        self.session.add(execution)
        self.session.commit()
        
        try:
            # Get current asset set
            current_asset_ids = set(execution.input_asset_ids)
            
            if not current_asset_ids:
                logger.info(f"FlowExecution {execution_id}: No assets to process")
                execution.status = RunStatus.COMPLETED
                execution.completed_at = datetime.now(timezone.utc)
                self.session.add(execution)
                self.session.commit()
                self._update_flow_stats(flow, execution)
                return execution
            
            # Execute each step
            for step_index, step_config in enumerate(flow.steps):
                step_type = step_config.get("type", "").upper()
                
                logger.info(f"FlowExecution {execution_id}: Running step {step_index} ({step_type})")
                
                step_output = self._execute_step(
                    step_type=step_type,
                    step_config=step_config,
                    asset_ids=list(current_asset_ids),
                    execution=execution,
                    flow=flow,
                )
                
                # Store step output
                execution.step_outputs[str(step_index)] = step_output
                
                # Update current asset set based on step output
                if "passed_asset_ids" in step_output:
                    current_asset_ids = set(step_output["passed_asset_ids"])
                elif "routed_asset_ids" in step_output:
                    current_asset_ids = set(step_output["routed_asset_ids"])
                
                self.session.add(execution)
                self.session.commit()
            
            # Update cursor state with processed assets
            self._update_cursor(flow, list(execution.input_asset_ids))
            
            # Mark execution as complete
            execution.status = RunStatus.COMPLETED
            execution.completed_at = datetime.now(timezone.utc)
            execution.output_asset_ids = list(current_asset_ids)
            
        except Exception as e:
            logger.error(f"FlowExecution {execution_id} failed: {e}", exc_info=True)
            execution.status = RunStatus.FAILED
            execution.completed_at = datetime.now(timezone.utc)
            execution.error_message = str(e)
            flow.consecutive_failures += 1
            flow.status = FlowStatus.ERROR if flow.consecutive_failures >= 3 else flow.status
        
        self.session.add(execution)
        self.session.add(flow)
        self.session.commit()
        
        self._update_flow_stats(flow, execution)
        
        return execution
    
    def _execute_step(
        self,
        step_type: str,
        step_config: Dict[str, Any],
        asset_ids: List[int],
        execution: FlowExecution,
        flow: Flow,
    ) -> Dict[str, Any]:
        """Execute a single step and return the output."""
        
        if step_type == "ANNOTATE":
            return self._execute_annotate_step(step_config, asset_ids, execution, flow)
        elif step_type == "FILTER":
            return self._execute_filter_step(step_config, asset_ids, execution)
        elif step_type == "CURATE":
            return self._execute_curate_step(step_config, asset_ids, execution)
        elif step_type == "ROUTE":
            return self._execute_route_step(step_config, asset_ids, execution, flow)
        elif step_type == "EMBED":
            return self._execute_embed_step(step_config, asset_ids, execution, flow)
        elif step_type == "ANALYZE":
            return self._execute_analyze_step(step_config, asset_ids, execution)
        else:
            raise ValueError(f"Unknown step type: {step_type}")
    
    def _execute_annotate_step(
        self,
        step_config: Dict[str, Any],
        asset_ids: List[int],
        execution: FlowExecution,
        flow: Flow,
    ) -> Dict[str, Any]:
        """
        Execute an ANNOTATE step.
        
        This step creates an AnnotationRun and processes it inline (synchronously)
        to ensure annotations are available for subsequent FILTER/CURATE steps.
        """
        schema_ids = step_config.get("schema_ids", [])
        config = step_config.get("config", {})
        
        if not schema_ids:
            raise ValueError("ANNOTATE step requires schema_ids")
        
        # Create an AnnotationRun for this step
        from app.schemas import AnnotationRunCreate
        
        run_in = AnnotationRunCreate(
            name=f"{flow.name} - Step Annotation",
            description=f"Annotation run for FlowExecution {execution.id}",
            schema_ids=schema_ids,
            target_asset_ids=asset_ids,
            configuration=config,
        )
        
        # Initialize annotation service if needed
        if not self.annotation_service:
            from app.api.services.asset_service import AssetService
            from app.api.providers.model_registry import ModelRegistryService
            asset_service = AssetService(self.session)
            model_registry = ModelRegistryService()
            self.annotation_service = AnnotationService(
                self.session, model_registry, asset_service
            )
        
        # Create the run with flow_step type, but DON'T queue Celery task
        # We'll process inline to ensure completion before next step
        annotation_run = self.annotation_service.create_run(
            user_id=flow.user_id,
            infospace_id=flow.infospace_id,
            run_in=run_in,
            queue_task=False,  # Don't queue - we'll process inline
        )
        
        # Mark as flow_step run and link to execution
        annotation_run.run_type = RunType.FLOW_STEP
        annotation_run.flow_execution_id = execution.id
        self.session.add(annotation_run)
        self.session.commit()
        
        # Process the annotation run inline (synchronously)
        # This ensures annotations exist before FILTER/CURATE steps run
        logger.info(f"FlowExecution {execution.id}: Processing annotation run {annotation_run.id} inline")
        
        try:
            from app.api.tasks.annotate import process_annotation_run
            # Call the task function directly (not .delay()) for synchronous execution
            process_annotation_run(annotation_run.id)
            
            # Refresh to get updated status
            self.session.refresh(annotation_run)
            
            if annotation_run.status not in [RunStatus.COMPLETED, RunStatus.COMPLETED_WITH_ERRORS]:
                logger.warning(
                    f"FlowExecution {execution.id}: Annotation run {annotation_run.id} "
                    f"finished with status {annotation_run.status}"
                )
        except Exception as e:
            logger.error(
                f"FlowExecution {execution.id}: Annotation run {annotation_run.id} failed: {e}",
                exc_info=True
            )
            # Update run status
            annotation_run.status = RunStatus.FAILED
            annotation_run.error_message = str(e)
            self.session.add(annotation_run)
            self.session.commit()
            raise
        
        return {
            "type": "ANNOTATE",
            "run_id": annotation_run.id,
            "run_status": annotation_run.status.value if annotation_run.status else None,
            "schema_ids": schema_ids,
            "asset_count": len(asset_ids),
            "passed_asset_ids": asset_ids,  # All assets pass through
        }
    
    def _execute_filter_step(
        self,
        step_config: Dict[str, Any],
        asset_ids: List[int],
        execution: FlowExecution,
    ) -> Dict[str, Any]:
        """
        Execute a FILTER step.
        
        FILTER can be used at any point in the pipeline:
        
        1. **Pre-annotation filtering** (before ANNOTATE):
           Filter on asset metadata, text content, source info.
           Use for high-volume streams where annotation is expensive.
           
        2. **Post-annotation filtering** (after ANNOTATE):
           Filter on annotation values + all the above.
           Use for semantic filtering based on LLM analysis.
        
        Available filter context fields:
        - asset_id, title, kind, url, source_identifier
        - text_content (full text for keyword matching)
        - source_id, source_metadata.*
        - created_at, updated_at
        - fragments.* (previously curated data)
        - tags[]
        - [annotation fields] (if preceded by ANNOTATE)
        """
        expression_config = step_config.get("expression", {})
        
        if not expression_config:
            # No filter = pass all
            return {
                "type": "FILTER",
                "mode": "passthrough",
                "passed": len(asset_ids),
                "rejected": 0,
                "passed_asset_ids": asset_ids,
            }
        
        # Build filter expression
        filter_expr = self.filter_service.create_from_config({"expression": expression_config})
        
        # Collect ALL annotation run IDs from previous steps (not just immediate predecessor)
        # This allows FILTER to access annotations from any prior ANNOTATE step
        annotation_run_ids = self._collect_annotation_run_ids(execution)
        
        passed_ids = []
        rejected_ids = []
        filter_mode = "pre_annotation" if not annotation_run_ids else "post_annotation"
        
        for asset_id in asset_ids:
            asset = self.session.get(Asset, asset_id)
            if not asset:
                rejected_ids.append(asset_id)
                continue
            
            # Build comprehensive filter context
            context = self._build_filter_context(asset, annotation_run_ids)
            
            try:
                if filter_expr.evaluate(context):
                    passed_ids.append(asset_id)
                else:
                    rejected_ids.append(asset_id)
            except Exception as e:
                logger.warning(f"Filter evaluation error for asset {asset_id}: {e}")
                rejected_ids.append(asset_id)
        
        return {
            "type": "FILTER",
            "mode": filter_mode,
            "annotation_runs_used": annotation_run_ids,
            "passed": len(passed_ids),
            "rejected": len(rejected_ids),
            "passed_asset_ids": passed_ids,
        }
    
    def _collect_annotation_run_ids(self, execution: FlowExecution) -> List[int]:
        """Collect all annotation run IDs from previous steps in this execution."""
        run_ids = []
        for step_key, step_output in execution.step_outputs.items():
            if step_output.get("type") == "ANNOTATE" and step_output.get("run_id"):
                run_ids.append(step_output["run_id"])
        return run_ids
    
    def _build_filter_context(self, asset: Asset, annotation_run_ids: List[int]) -> Dict[str, Any]:
        """
        Build comprehensive filter context for an asset.
        
        This provides all available fields for filtering, whether pre or post annotation.
        """
        # Core asset fields
        context = {
            "asset_id": asset.id,
            "title": asset.title or "",
            "kind": asset.kind.value if asset.kind else None,
            "url": asset.url or "",
            "source_identifier": asset.source_identifier or "",
            "source_id": asset.source_id,
            "created_at": asset.created_at.isoformat() if asset.created_at else None,
            "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
            "tags": asset.tags or [],
        }
        
        # Text content for keyword/regex matching (truncate for performance)
        if asset.text_content:
            # Provide full text for matching, but also a preview
            context["text_content"] = asset.text_content
            context["text_preview"] = asset.text_content[:500] if len(asset.text_content) > 500 else asset.text_content
            context["text_length"] = len(asset.text_content)
        else:
            context["text_content"] = ""
            context["text_preview"] = ""
            context["text_length"] = 0
        
        # Source metadata (flattened for easy access)
        if asset.source_metadata:
            context["source_metadata"] = asset.source_metadata
            # Also flatten common fields for convenience
            for key in ["author", "published_date", "feed_title", "domain", "language"]:
                if key in asset.source_metadata:
                    context[f"source_{key}"] = asset.source_metadata[key]
        
        # Curated fragments (already promoted annotation values)
        if asset.fragments:
            for frag_key, frag_data in asset.fragments.items():
                # Extract just the value from fragment structure
                if isinstance(frag_data, dict) and "value" in frag_data:
                    context[frag_key] = frag_data["value"]
                else:
                    context[frag_key] = frag_data
        
        # Add annotation values from all previous ANNOTATE steps
        for run_id in annotation_run_ids:
            annotations = self.session.exec(
                select(Annotation).where(
                    Annotation.run_id == run_id,
                    Annotation.asset_id == asset.id
                )
            ).all()
            for ann in annotations:
                if ann.value:
                    context.update(ann.value)
        
        return context
    
    def _execute_curate_step(
        self,
        step_config: Dict[str, Any],
        asset_ids: List[int],
        execution: FlowExecution,
    ) -> Dict[str, Any]:
        """
        Execute a CURATE step - promote annotation fields to asset.fragments.
        
        CURATE looks at ALL previous ANNOTATE steps in the flow, not just the 
        immediately preceding one. This allows pipelines like:
        
            ANNOTATE (sentiment) → FILTER → ANNOTATE (entities) → CURATE (both)
        
        The `fields` list specifies which annotation fields to promote.
        Fields are searched across all annotation runs from this execution.
        """
        fields_to_curate = step_config.get("fields", [])
        
        if not fields_to_curate:
            return {
                "type": "CURATE",
                "promoted_count": 0,
                "passed_asset_ids": asset_ids,
            }
        
        # Collect ALL annotation run IDs from previous steps
        annotation_run_ids = self._collect_annotation_run_ids(execution)
        
        if not annotation_run_ids:
            logger.warning("CURATE step requires at least one preceding ANNOTATE step")
            return {
                "type": "CURATE",
                "promoted_count": 0,
                "error": "No preceding annotation runs found",
                "passed_asset_ids": asset_ids,
            }
        
        promoted_count = 0
        now = datetime.now(timezone.utc)
        
        for asset_id in asset_ids:
            asset = self.session.get(Asset, asset_id)
            if not asset:
                continue
            
            fragments = asset.fragments or {}
            
            # Search for fields across ALL annotation runs from this execution
            for run_id in annotation_run_ids:
                annotations = self.session.exec(
                    select(Annotation).where(
                        Annotation.run_id == run_id,
                        Annotation.asset_id == asset_id
                    )
                ).all()
                
                for annotation in annotations:
                    for field_name in fields_to_curate:
                        # Only promote if field exists and not already promoted
                        if field_name in (annotation.value or {}) and field_name not in fragments:
                            fragments[field_name] = {
                                "value": annotation.value[field_name],
                                "source_ref": f"flow_execution:{execution.id}",
                                "annotation_run_id": run_id,
                                "curated_at": now.isoformat(),
                            }
                            promoted_count += 1
            
            asset.fragments = fragments
            
            # Mark as modified for SQLAlchemy
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(asset, "fragments")
            
            self.session.add(asset)
        
        self.session.commit()
        
        return {
            "type": "CURATE",
            "fields": fields_to_curate,
            "annotation_runs_used": annotation_run_ids,
            "promoted_count": promoted_count,
            "passed_asset_ids": asset_ids,
        }
    
    def _execute_route_step(
        self,
        step_config: Dict[str, Any],
        asset_ids: List[int],
        execution: FlowExecution,
        flow: Flow,
    ) -> Dict[str, Any]:
        """Execute a ROUTE step - move/copy assets to bundles."""
        bundle_id = step_config.get("bundle_id")
        bundle_ids = step_config.get("bundle_ids", [])
        conditions = step_config.get("conditions", [])
        
        if bundle_id:
            bundle_ids = [bundle_id]
        
        # Initialize bundle service if needed
        if not self.bundle_service:
            self.bundle_service = BundleService(self.session)
        
        routed_count = 0
        routed_asset_ids = []
        
        if conditions:
            # Conditional routing
            for asset_id in asset_ids:
                asset = self.session.get(Asset, asset_id)
                if not asset:
                    continue
                
                context = {
                    "asset_id": asset_id,
                    "title": asset.title,
                    **asset.fragments,
                }
                
                for condition in conditions:
                    cond_expr = condition.get("if")
                    target_bundle_id = condition.get("bundle_id")
                    
                    if cond_expr and target_bundle_id:
                        filter_expr = self.filter_service.create_from_config({"expression": cond_expr})
                        if filter_expr.evaluate(context):
                            self.bundle_service.add_asset_to_bundle(
                                bundle_id=target_bundle_id,
                                asset_id=asset_id,
                                infospace_id=flow.infospace_id,
                                user_id=flow.user_id
                            )
                            routed_count += 1
                            routed_asset_ids.append(asset_id)
                            break
                    elif condition.get("else"):
                        # Default/else branch
                        else_bundle_id = condition.get("bundle_id")
                        if else_bundle_id:
                            self.bundle_service.add_asset_to_bundle(
                                bundle_id=else_bundle_id,
                                asset_id=asset_id,
                                infospace_id=flow.infospace_id,
                                user_id=flow.user_id
                            )
                            routed_count += 1
                            routed_asset_ids.append(asset_id)
        else:
            # Simple routing to bundle(s)
            for asset_id in asset_ids:
                for target_bundle_id in bundle_ids:
                    self.bundle_service.add_asset_to_bundle(
                        bundle_id=target_bundle_id,
                        asset_id=asset_id,
                        infospace_id=flow.infospace_id,
                        user_id=flow.user_id
                    )
                    routed_count += 1
                routed_asset_ids.append(asset_id)
        
        return {
            "type": "ROUTE",
            "bundle_ids": bundle_ids,
            "routed_count": routed_count,
            "routed_asset_ids": routed_asset_ids,
        }
    
    def _execute_embed_step(
        self,
        step_config: Dict[str, Any],
        asset_ids: List[int],
        execution: FlowExecution,
        flow: Flow,
    ) -> Dict[str, Any]:
        """
        Execute an EMBED step - create embeddings for assets.
        
        Uses the infospace's configured embedding model to generate embeddings
        for each asset, enabling semantic search capabilities.
        """
        from app.api.services.embedding_service import EmbeddingService
        from app.api.tasks.utils import run_async_in_celery
        
        overwrite = step_config.get("overwrite", False)
        
        logger.info(f"FlowExecution {execution.id}: Embedding {len(asset_ids)} assets")
        
        # Create embedding service with flow user context
        embedding_service = EmbeddingService(
            self.session,
            user_id=flow.user_id
        )
        
        total_chunks = 0
        total_embeddings = 0
        failed_assets = []
        
        async def embed_all():
            nonlocal total_chunks, total_embeddings, failed_assets
            
            for asset_id in asset_ids:
                try:
                    result = await embedding_service.generate_embeddings_for_asset(
                        asset_id=asset_id,
                        infospace_id=flow.infospace_id,
                        overwrite=overwrite
                    )
                    total_chunks += result.get("chunks_created", 0)
                    total_embeddings += result.get("embeddings_generated", 0)
                except Exception as e:
                    logger.warning(f"Failed to embed asset {asset_id}: {e}")
                    failed_assets.append(asset_id)
        
        try:
            run_async_in_celery(embed_all)
        except Exception as e:
            logger.error(f"FlowExecution {execution.id}: EMBED step failed: {e}", exc_info=True)
            return {
                "type": "EMBED",
                "asset_count": len(asset_ids),
                "status": "failed",
                "error": str(e),
                "passed_asset_ids": asset_ids,
            }
        
        return {
            "type": "EMBED",
            "asset_count": len(asset_ids),
            "chunks_created": total_chunks,
            "embeddings_generated": total_embeddings,
            "failed_assets": failed_assets,
            "status": "completed" if not failed_assets else "completed_with_errors",
            "passed_asset_ids": asset_ids,
        }
    
    def _execute_analyze_step(
        self,
        step_config: Dict[str, Any],
        asset_ids: List[int],
        execution: FlowExecution,
    ) -> Dict[str, Any]:
        """
        Execute an ANALYZE step - run analysis adapters on annotated assets.
        
        This step can invoke registered analysis adapters for aggregation,
        time series analysis, or other post-processing on annotation results.
        
        Step config:
            adapter_name: Name of the adapter to use (e.g., "time_series", "label_distribution")
            adapter_config: Configuration dict for the adapter
        """
        from app.api.tasks.utils import run_async_in_celery
        
        adapter_name = step_config.get("adapter_name")
        adapter_config = step_config.get("adapter_config", {})
        
        if not adapter_name:
            return {
                "type": "ANALYZE",
                "asset_count": len(asset_ids),
                "status": "skipped",
                "message": "No adapter_name specified",
                "passed_asset_ids": asset_ids,
            }
        
        # Map adapter names to classes
        adapter_map = {
            "time_series": "app.api.analysis.adapters.time_series_adapter.TimeSeriesAggregationAdapter",
            "label_distribution": "app.api.analysis.adapters.label_distribution.LabelDistributionAdapter",
            "graph_aggregator": "app.api.analysis.adapters.graph_aggregator_adapter.GraphAggregatorAdapter",
        }
        
        adapter_path = adapter_map.get(adapter_name)
        if not adapter_path:
            return {
                "type": "ANALYZE",
                "asset_count": len(asset_ids),
                "status": "error",
                "message": f"Unknown adapter: {adapter_name}. Available: {list(adapter_map.keys())}",
                "passed_asset_ids": asset_ids,
            }
        
        # Get flow context for adapter
        flow = self.session.get(Flow, execution.flow_id)
        user = self.session.get(User, flow.user_id) if flow else None
        
        # Get previous step's annotation run for context
        prev_step_key = str(len(execution.step_outputs) - 1)
        prev_output = execution.step_outputs.get(prev_step_key, {})
        
        # Build adapter config with context
        full_config = {
            **adapter_config,
            "target_run_id": prev_output.get("run_id"),
            "target_asset_ids": asset_ids,
        }
        
        logger.info(f"FlowExecution {execution.id}: Running {adapter_name} adapter")
        
        async def run_adapter():
            import importlib
            module_path, class_name = adapter_path.rsplit(".", 1)
            module = importlib.import_module(module_path)
            adapter_class = getattr(module, class_name)
            
            adapter = adapter_class(
                session=self.session,
                config=full_config,
                current_user=user,
                infospace_id=flow.infospace_id if flow else None
            )
            
            return await adapter.execute()
        
        try:
            result = run_async_in_celery(run_adapter)
            return {
                "type": "ANALYZE",
                "adapter": adapter_name,
                "asset_count": len(asset_ids),
                "result": result,
                "status": "completed",
                "passed_asset_ids": asset_ids,
            }
        except Exception as e:
            logger.error(f"FlowExecution {execution.id}: ANALYZE step failed: {e}", exc_info=True)
            return {
                "type": "ANALYZE",
                "adapter": adapter_name,
                "asset_count": len(asset_ids),
                "status": "failed",
                "error": str(e),
                "passed_asset_ids": asset_ids,
            }
    
    # ═══════════════════════════════════════════════════════════════════════════
    # DELTA TRACKING
    # ═══════════════════════════════════════════════════════════════════════════
    
    def _get_delta_assets(self, flow: Flow) -> List[int]:
        """
        Get assets that haven't been processed by this flow yet.
        
        Uses flow.cursor_state to track what's been processed.
        """
        if flow.input_type == FlowInputType.MANUAL:
            return []
        
        # Get processed asset IDs from cursor
        processed_ids = set(flow.cursor_state.get("processed_asset_ids", []))
        
        if flow.input_type == FlowInputType.BUNDLE:
            if not flow.input_bundle_id:
                return []
            
            bundle = self.session.get(Bundle, flow.input_bundle_id)
            if not bundle:
                return []
            
            all_asset_ids = {a.id for a in bundle.assets}
            delta_ids = list(all_asset_ids - processed_ids)
            
        elif flow.input_type == FlowInputType.STREAM:
            if not flow.input_source_id:
                return []
            
            source = self.session.get(Source, flow.input_source_id)
            if not source or not source.output_bundle_id:
                return []
            
            # Get assets from source's output bundle
            bundle = self.session.get(Bundle, source.output_bundle_id)
            if not bundle:
                return []
            
            # Only get assets from this source
            all_asset_ids = {a.id for a in bundle.assets if a.source_id == source.id}
            delta_ids = list(all_asset_ids - processed_ids)
        else:
            delta_ids = []
        
        logger.info(f"Flow {flow.id}: Found {len(delta_ids)} delta assets")
        return delta_ids
    
    def _update_cursor(self, flow: Flow, processed_asset_ids: List[int]) -> None:
        """
        Update the flow's cursor state with newly processed assets.
        
        Also prunes IDs that are no longer in the source bundle to prevent
        unbounded cursor growth.
        """
        cursor = flow.cursor_state or {}
        existing_ids = set(cursor.get("processed_asset_ids", []))
        existing_ids.update(processed_asset_ids)
        
        # Prune: only keep IDs that still exist in the source bundle
        # This prevents unbounded growth when assets are deleted
        valid_ids = self._prune_cursor_ids(flow, existing_ids)
        
        cursor["processed_asset_ids"] = list(valid_ids)
        cursor["last_processed_at"] = datetime.now(timezone.utc).isoformat()
        cursor["total_processed"] = cursor.get("total_processed", 0) + len(processed_asset_ids)
        
        flow.cursor_state = cursor
        
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(flow, "cursor_state")
        
        self.session.add(flow)
        self.session.commit()
    
    def _prune_cursor_ids(self, flow: Flow, cursor_ids: Set[int]) -> Set[int]:
        """
        Prune cursor IDs that are no longer valid (e.g., deleted assets).
        
        This keeps the cursor_state from growing unbounded.
        """
        if not cursor_ids:
            return cursor_ids
        
        # Get current valid asset IDs from the source
        valid_asset_ids: Set[int] = set()
        
        if flow.input_type == FlowInputType.BUNDLE and flow.input_bundle_id:
            bundle = self.session.get(Bundle, flow.input_bundle_id)
            if bundle:
                valid_asset_ids = {a.id for a in bundle.assets}
        
        elif flow.input_type == FlowInputType.STREAM and flow.input_source_id:
            source = self.session.get(Source, flow.input_source_id)
            if source and source.output_bundle_id:
                bundle = self.session.get(Bundle, source.output_bundle_id)
                if bundle:
                    valid_asset_ids = {a.id for a in bundle.assets if a.source_id == source.id}
        
        if not valid_asset_ids:
            # Can't validate - keep all IDs
            return cursor_ids
        
        # Keep only IDs that are still in the source
        pruned = cursor_ids.intersection(valid_asset_ids)
        
        if len(pruned) < len(cursor_ids):
            logger.info(f"Flow {flow.id}: Pruned {len(cursor_ids) - len(pruned)} stale asset IDs from cursor")
        
        return pruned
    
    def _update_flow_stats(self, flow: Flow, execution: FlowExecution) -> None:
        """Update flow statistics after an execution."""
        flow.total_executions += 1
        flow.total_assets_processed += len(execution.input_asset_ids)
        flow.last_execution_at = execution.completed_at or datetime.now(timezone.utc)
        flow.last_execution_status = execution.status.value if execution.status else None
        
        if execution.status == RunStatus.COMPLETED:
            flow.consecutive_failures = 0
        
        self.session.add(flow)
        self.session.commit()
    
    # ═══════════════════════════════════════════════════════════════════════════
    # VALIDATION HELPERS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def _validate_flow_input(self, flow_in: FlowCreate, infospace_id: int) -> None:
        """Validate flow input configuration."""
        input_type = flow_in.input_type
        
        if input_type == "bundle":
            if flow_in.input_bundle_id:
                bundle = self.session.get(Bundle, flow_in.input_bundle_id)
                if not bundle or bundle.infospace_id != infospace_id:
                    raise ValueError(f"Bundle {flow_in.input_bundle_id} not found in infospace")
        
        elif input_type == "stream":
            if flow_in.input_source_id:
                source = self.session.get(Source, flow_in.input_source_id)
                if not source or source.infospace_id != infospace_id:
                    raise ValueError(f"Source {flow_in.input_source_id} not found in infospace")
    
    def _validate_flow_steps(self, steps: List[Dict[str, Any]], infospace_id: int) -> None:
        """Validate flow step configurations."""
        for i, step in enumerate(steps):
            step_type = step.get("type", "").upper()
            
            if step_type not in [e.value for e in FlowStepType]:
                raise ValueError(f"Unknown step type at index {i}: {step_type}")
            
            if step_type == "ANNOTATE":
                schema_ids = step.get("schema_ids", [])
                if not schema_ids:
                    raise ValueError(f"ANNOTATE step at index {i} requires schema_ids")
                
                for schema_id in schema_ids:
                    schema = self.session.get(AnnotationSchema, schema_id)
                    if not schema or schema.infospace_id != infospace_id:
                        raise ValueError(f"Schema {schema_id} not found in infospace")
            
            elif step_type == "ROUTE":
                bundle_id = step.get("bundle_id")
                bundle_ids = step.get("bundle_ids", [])
                conditions = step.get("conditions", [])
                
                if not bundle_id and not bundle_ids and not conditions:
                    raise ValueError(f"ROUTE step at index {i} requires bundle_id, bundle_ids, or conditions")
