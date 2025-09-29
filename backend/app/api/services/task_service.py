import logging
from typing import Optional, List, Dict, Any, Union, Tuple
from sqlmodel import Session, select, func
from croniter import croniter
from datetime import datetime, timezone
from fastapi import HTTPException

from app.models import (
    Task,
    TaskStatus,
    TaskType,
    Source,
    AnnotationSchema,
    Asset,
    Bundle,
    IntelligencePipeline,
)
from app.api.services.annotation_service import AnnotationService
from app.core.beat_utils import add_or_update_schedule, remove_schedule
from app.api.services.service_utils import validate_infospace_access
from app.api.tasks.ingest import process_source
from app.schemas import AnnotationRunCreate, TaskCreate, TaskUpdate


logger = logging.getLogger(__name__)

def _validate_task_input_config(
    task_in: "TaskCreate",
    session: Session,
    infospace_id: int,
    annotation_service: "AnnotationService",
):
    """Validate task configuration based on task type."""
    if task_in.type == TaskType.INGEST:
        # Check for source_id on the task itself now
        if not task_in.source_id:
            raise ValueError("INGEST task requires a `source_id`.")

        if not isinstance(task_in.source_id, int):
            raise ValueError("INGEST task requires an integer `source_id`.")

        # Check if source exists and belongs to the infospace
        source = session.get(Source, task_in.source_id)
        if not source or source.infospace_id != infospace_id:
            raise ValueError(
                f"Source with ID {task_in.source_id} not found in this infospace."
            )

        if "target_bundle_id" not in task_in.configuration:
            raise ValueError(
                "INGEST task configuration requires an integer 'target_bundle_id'."
            )

        bundle_id = task_in.configuration.get("target_bundle_id")
        if not isinstance(bundle_id, int):
            raise ValueError(
                "INGEST task configuration requires an integer 'target_bundle_id'."
            )

        bundle = session.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise ValueError(
                f"Bundle with ID {bundle_id} not found in this infospace."
            )

    elif task_in.type == TaskType.ANNOTATE:
        config = task_in.configuration
        if not isinstance(config, dict):
            raise ValueError("Configuration must be a dictionary.")

        schema_ids = config.get("schema_ids")
        if not schema_ids or not (
            isinstance(schema_ids, list) and all(isinstance(i, int) for i in schema_ids)
        ):
            raise ValueError(
                "ANNOTATE task configuration requires a list of integer 'schema_ids'."
            )

        for schema_id in schema_ids:
            schema = annotation_service.get_schema(
                schema_id=schema_id, infospace_id=infospace_id, user_id=-1
            )  # user_id=-1 to bypass ownership check for system validation
            if not schema:
                raise ValueError(
                    f"Target AnnotationSchema ID {schema_id} not found in infospace {infospace_id}."
                )

        target_asset_ids = config.get("target_asset_ids")
        target_bundle_id = config.get("target_bundle_id")

        if not (target_asset_ids or target_bundle_id):
            raise ValueError(
                "ANNOTATE task must specify target_asset_ids or target_bundle_id."
            )
        if target_asset_ids and target_bundle_id:
            raise ValueError(
                "Specify either target_asset_ids or target_bundle_id for ANNOTATE task, not both."
            )

        if target_asset_ids:
            for asset_id in target_asset_ids:
                asset = session.get(Asset, asset_id)
                if not asset or asset.infospace_id != infospace_id:
                    raise ValueError(
                        f"Target Asset ID {asset_id} not found in infospace {infospace_id}."
                    )
        if target_bundle_id:
            bundle = session.get(Bundle, target_bundle_id)
            if not bundle or bundle.infospace_id != infospace_id:
                raise ValueError(
                    f"Target Bundle ID {target_bundle_id} not found in infospace {infospace_id}."
                )

    elif task_in.type == TaskType.MONITOR:
        # Check for source_id on the task itself
        if not task_in.source_id:
            raise ValueError("MONITOR task requires a `source_id`.")

        if not isinstance(task_in.source_id, int):
            raise ValueError("MONITOR task requires an integer `source_id`.")

        # Check if source exists and belongs to the infospace
        source = session.get(Source, task_in.source_id)
        if not source or source.infospace_id != infospace_id:
            raise ValueError(
                f"Source with ID {task_in.source_id} not found in this infospace."
            )

        # Validate source-specific configuration
        if source.kind == "search":
            search_config = source.details.get("search_config")
            if not search_config or not isinstance(search_config, dict):
                raise ValueError("Search source requires a 'search_config' dictionary in details.")
            if not search_config.get("query"):
                raise ValueError("Search source requires a 'query' in search_config.")

    elif task_in.type == TaskType.PIPELINE:
        config = task_in.configuration
        if not isinstance(config, dict):
            raise ValueError("Configuration must be a dictionary.")

        pipeline_id = config.get("pipeline_id")
        if not pipeline_id or not isinstance(pipeline_id, int):
            raise ValueError(
                "PIPELINE task configuration requires an integer 'pipeline_id'."
            )
        pipeline = session.get(IntelligencePipeline, pipeline_id)
        if not pipeline or pipeline.infospace_id != infospace_id:
            raise ValueError(
                f"Target Pipeline ID {pipeline_id} not found in infospace {infospace_id}."
            )


class TaskService:
    def __init__(self, session: Session, annotation_service: AnnotationService):
        self.session = session
        self.annotation_service = annotation_service
        logger.info("TaskService initialized.")

    def create_task(
        self,
        user_id: int,
        infospace_id: int,
        task_in: TaskCreate
    ) -> Task:
        """Create a new task."""
        logger.info(f"TaskService: Creating Task '{task_in.name}' in infospace {infospace_id}")
        try:
            # Validate task-specific configuration before proceeding
            _validate_task_input_config(task_in, self.session, infospace_id, self.annotation_service)

            # Combine the input schema with user and infospace IDs before validation
            task_data = task_in.model_dump()
            task_data['user_id'] = user_id
            task_data['infospace_id'] = infospace_id
            
            db_task = Task.model_validate(task_data)

            self.session.add(db_task)
            self.session.commit()
            self.session.refresh(db_task)

            # Add the task to the scheduler
            add_or_update_schedule(
                recurring_task_id=db_task.id,
                schedule_str=db_task.schedule,
                is_enabled=db_task.is_enabled,
            )

            return db_task
        except ValueError as ve:
            self.session.rollback()
            logger.error(f"TaskService: Validation error creating task: {ve}", exc_info=True)
            raise ve
        except Exception as e:
            self.session.rollback()
            logger.exception(f"TaskService: Unexpected error creating task: {e}")
            raise ValueError(f"Failed to create task due to an unexpected error: {str(e)}")


    def get_task(
        self,
        task_id: int,
        user_id: int,
        infospace_id: int
    ) -> Optional[Task]:
        logger.debug(f"TaskService: Getting task {task_id} for infospace {infospace_id}, user {user_id}")
        validate_infospace_access(self.session, infospace_id, user_id)
        
        task = self.session.get(Task, task_id)
        if not task or task.infospace_id != infospace_id:
            return None
        if task.user_id != user_id:
             logger.warning(f"Task {task_id} found, but user {user_id} is not the owner (owner: {task.user_id}). Denying access.")
             return None
        return task

    def list_tasks(
        self,
        user_id: int,
        infospace_id: int,
        skip: int = 0,
        limit: int = 100,
        status_filter: Optional[TaskStatus] = None,
        type_filter: Optional[TaskType] = None,
        is_enabled_filter: Optional[bool] = None
    ) -> Tuple[List[Task], int]:
        logger.debug(f"TaskService: Listing tasks for infospace {infospace_id}, user {user_id}")
        validate_infospace_access(self.session, infospace_id, user_id)

        statement = select(Task).where(Task.infospace_id == infospace_id, Task.user_id == user_id)

        if status_filter:
            statement = statement.where(Task.status == status_filter)
        if type_filter:
            statement = statement.where(Task.type == type_filter)
        if is_enabled_filter is not None:
            statement = statement.where(Task.is_enabled == is_enabled_filter)
            
        count_statement = select(func.count(Task.id)).select_from(statement.with_only_columns(Task.id).subquery())
        total_count = self.session.exec(count_statement).one_or_none() or 0
        
        tasks_query = statement.order_by(Task.created_at.desc()).offset(skip).limit(limit)
        tasks = self.session.exec(tasks_query).all()
        
        return list(tasks), total_count

    def update_task(
        self,
        task_id: int,
        user_id: int,
        infospace_id: int,
        task_in: TaskUpdate
    ) -> Optional[Task]:
        logger.info(f"TaskService: Updating Task {task_id} in infospace {infospace_id}")
        validate_infospace_access(self.session, infospace_id, user_id)

        db_task = self.session.get(Task, task_id)
        if not db_task or db_task.infospace_id != infospace_id or db_task.user_id != user_id:
            logger.warning(f"Task {task_id} not found in infospace {infospace_id} for user {user_id} or access denied.")
            return None

        update_data = task_in.model_dump(exclude_unset=True)
        if not update_data:
            logger.info(f"TaskService: No update data provided for Task {task_id}. Returning current task.")
            return db_task

        if 'configuration' in update_data or 'type' in update_data or 'schedule' in update_data:
            _validate_task_input_config(task_in, self.session, infospace_id, self.annotation_service)

        schedule_changed = 'schedule' in update_data and db_task.schedule != update_data['schedule']
        
        # Check for changes that affect the schedule's enabled state
        new_is_enabled = update_data.get('is_enabled', db_task.is_enabled)
        is_enabled_changed = new_is_enabled != db_task.is_enabled
        
        for key, value in update_data.items():
            setattr(db_task, key, value)
        
        db_task.updated_at = datetime.now(timezone.utc)

        self.session.add(db_task)
        self.session.commit()
        self.session.refresh(db_task)

        if schedule_changed or is_enabled_changed:
            logger.info(f"TaskService: Updating Celery Beat schedule for task {task_id} due to change.")
            try:
                add_or_update_schedule(
                    recurring_task_id=db_task.id,
                    schedule_str=db_task.schedule,
                    is_enabled=db_task.is_enabled,
                    task_type=str(db_task.type.value)
                )
            except Exception as beat_error:
                 logger.error(f"TaskService: Failed to update Celery Beat schedule for task {task_id}: {beat_error}", exc_info=True)

        logger.info(f"TaskService: Task {task_id} updated successfully.")
        return db_task

    def delete_task(
        self,
        task_id: int,
        user_id: int,
        infospace_id: int
    ) -> bool:
        logger.info(f"TaskService: Attempting to delete Task {task_id} from infospace {infospace_id}")
        validate_infospace_access(self.session, infospace_id, user_id)
        
        db_task = self.session.get(Task, task_id)
        if not db_task or db_task.infospace_id != infospace_id or db_task.user_id != user_id:
            logger.warning(f"TaskService: Delete request for non-existent/mismatched task {task_id} in infospace {infospace_id} by user {user_id}")
            return False

        task_id_to_remove = db_task.id
        task_name_to_log = db_task.name

        try:
            if task_id_to_remove is not None:
                logger.info(f"TaskService: Removing Celery Beat schedule for task {task_id_to_remove}.")
                remove_schedule(recurring_task_id=task_id_to_remove)
            else:
                logger.error("TaskService: Task ID was None during delete, cannot remove Celery Beat schedule.")

            self.session.delete(db_task)
            self.session.commit()
            logger.info(f"TaskService: Task '{task_name_to_log}' ({task_id_to_remove}) deleted successfully.")
            return True
        except Exception as e:
            self.session.rollback()
            logger.error(f"TaskService: Error deleting task {task_id_to_remove}: {e}", exc_info=True)
            raise ValueError(f"Failed to delete task: {str(e)}")

    async def execute_task(self, task_id: int, user_id: int, infospace_id: int) -> bool:
        """
        Manually triggers the execution of a specific task.
        """
        logger.info(f"TaskService: Attempting to manually execute Task {task_id} by user {user_id} in infospace {infospace_id}")
        task = self.get_task(task_id, user_id, infospace_id)
        if not task:
            logger.warning(f"TaskService: Task {task_id} not found or not accessible for manual execution.")
            return False

        logger.info(f"TaskService: Manually executing task '{task.name}' (ID: {task.id}, Type: {task.type})")

        try:
            if task.type == TaskType.INGEST:
                # The 'target_source_id' is required and validated in the config
                target_source_id = task.source_id
                if target_source_id:
                    process_source.delay(target_source_id)
                    logger.info(f"TaskService: Dispatched process_source for Task {task.id} targeting Source {target_source_id}")
                else:
                    logger.error(f"TaskService: Cannot execute INGEST task {task.id}. Missing 'source_id' on the task.")
                    # Update task status to reflect this configuration error
                    task.last_run_status = "error"
                    task.last_run_message = "Manual execution failed: Missing 'source_id' on the task."
                    self.session.add(task)
                    self.session.commit()
                    return False
            
            elif task.type == TaskType.ANNOTATE:
                run_config = task.configuration or {}
                
                create_run_payload = AnnotationRunCreate(
                    name=f"Manual execution of Task: {task.name} - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
                    schema_ids=run_config.get("schema_ids", []),
                    target_asset_ids=run_config.get("target_asset_ids"),
                    target_bundle_id=run_config.get("target_bundle_id"),
                    configuration=run_config.get("run_specific_config", {}),
                    include_parent_context=run_config.get("include_parent_context", False),
                    context_window=run_config.get("context_window", 0)
                )
                
                if not create_run_payload.schema_ids:
                    logger.error(f"TaskService: Cannot execute ANNOTATE task {task.id}. Missing 'schema_ids' in configuration.")
                    task.last_run_status = "error"
                    task.last_run_message = "Manual execution failed: Missing 'schema_ids' in configuration."
                    task.last_run_at = datetime.now(timezone.utc)
                    self.session.add(task)
                    self.session.commit()
                    return False

                new_run = self.annotation_service.create_run(
                    user_id=user_id,
                    infospace_id=infospace_id,
                    run_in=create_run_payload
                )
                logger.info(f"TaskService: Created AnnotationRun {new_run.id} from Task {task.id} for manual execution. Celery task for run processing should be queued by AnnotationService.")

            elif task.type == TaskType.MONITOR:
                # Handle MONITOR task type by dispatching to appropriate monitoring task
                if task.source_id:
                    # Get the source to determine which monitoring task to use
                    source = self.session.get(Source, task.source_id)
                    if not source:
                        logger.error(f"TaskService: Source {task.source_id} not found for MONITOR task {task.id}")
                        task.last_run_status = "error"
                        task.last_run_message = f"Manual execution failed: Source {task.source_id} not found."
                        task.last_run_at = datetime.now(timezone.utc)
                        self.session.add(task)
                        self.session.commit()
                        return False
                    
                    # Dispatch to appropriate monitoring task based on source kind
                    if source.kind == "rss_feed":
                        from app.api.tasks.source_monitoring import monitor_rss_source
                        monitor_rss_source.delay(task.source_id)
                        logger.info(f"TaskService: Dispatched RSS monitoring task {task.id} for source {task.source_id}")
                    elif source.kind == "search":
                        from app.api.tasks.source_monitoring import monitor_search_source
                        monitor_search_source.delay(task.source_id)
                        logger.info(f"TaskService: Dispatched search monitoring task {task.id} for source {task.source_id}")
                    elif source.kind in ["news_source_monitor", "site_discovery"]:
                        from app.api.tasks.source_monitoring import monitor_news_source
                        monitor_news_source.delay(task.source_id)
                        logger.info(f"TaskService: Dispatched news source monitoring task {task.id} for source {task.source_id}")
                    else:
                        logger.error(f"TaskService: Unsupported source kind '{source.kind}' for MONITOR task {task.id}")
                        task.last_run_status = "error"
                        task.last_run_message = f"Manual execution failed: Unsupported source kind '{source.kind}'."
                        task.last_run_at = datetime.now(timezone.utc)
                        self.session.add(task)
                        self.session.commit()
                        return False
                else:
                    # Legacy monitor task handling
                    monitor_id = task.configuration.get("monitor_id")
                    if monitor_id:
                        from app.api.tasks.monitor_tasks import execute_monitor_task
                        execute_monitor_task.delay(monitor_id)
                        logger.info(f"TaskService: Dispatched MONITOR task {task.id} for monitor {monitor_id}")
                    else:
                        logger.error(f"TaskService: Cannot execute MONITOR task {task.id}. Missing 'source_id' or 'monitor_id'.")
                        task.last_run_status = "error"
                        task.last_run_message = "Manual execution failed: Missing 'source_id' or 'monitor_id'."
                        task.last_run_at = datetime.now(timezone.utc)
                        self.session.add(task)
                        self.session.commit()
                        return False

            elif task.type == TaskType.PIPELINE:
                pipeline_id = task.configuration.get("pipeline_id") if task.configuration else None
                if not pipeline_id:
                    logger.error(f"TaskService: Cannot execute PIPELINE task {task.id}. Missing 'pipeline_id' in configuration.")
                    task.last_run_status = "error"
                    task.last_run_message = "Manual execution failed: Missing 'pipeline_id' in configuration."
                    task.last_run_at = datetime.now(timezone.utc)
                    self.session.add(task)
                    self.session.commit()
                    return False
                from app.api.services.pipeline_service import PipelineService
                from app.api.services.annotation_service import AnnotationService
                from app.api.services.analysis_service import AnalysisService
                from app.api.services.bundle_service import BundleService
                from app.api.services.asset_service import AssetService
                from app.api.providers.factory import create_model_registry, create_storage_provider
                from app.core.config import settings

                storage_provider = create_storage_provider(settings)
                asset_service = AssetService(self.session, storage_provider)
                model_registry = create_model_registry(settings)
                await model_registry.initialize_providers()
                annotation_service = AnnotationService(self.session, model_registry, asset_service)
                analysis_service = AnalysisService(self.session, model_registry, annotation_service, asset_service)
                bundle_service = BundleService(self.session)
                pipeline_service = PipelineService(self.session, annotation_service, analysis_service, bundle_service)

                pipeline = self.session.get(IntelligencePipeline, pipeline_id)
                if not pipeline or pipeline.infospace_id != infospace_id:
                    logger.error(f"TaskService: Pipeline {pipeline_id} not found in infospace {infospace_id}.")
                    task.last_run_status = "error"
                    task.last_run_message = f"Manual execution failed: Pipeline {pipeline_id} not found."
                    task.last_run_at = datetime.now(timezone.utc)
                    self.session.add(task)
                    self.session.commit()
                    return False
                delta = pipeline_service._resolve_start_assets_delta(pipeline)
                triggering_assets = sorted({aid for ids in delta.values() for aid in ids})
                execution = pipeline_service.trigger_pipeline(pipeline_id=pipeline_id, asset_ids=triggering_assets, trigger_type="MANUAL_ADHOC")
                logger.info(f"TaskService: Started pipeline execution {execution.id} for Task {task.id}")

            else:
                logger.warning(f"TaskService: Manual execution for task type '{task.type}' is not implemented for Task {task.id}.")
                task.last_run_status = "error"
                task.last_run_message = f"Manual execution failed: Task type '{task.type}' not supported for manual trigger."
                task.last_run_at = datetime.now(timezone.utc)
                self.session.add(task)
                self.session.commit()
                return False

            task.last_run_at = datetime.now(timezone.utc)
            self.session.add(task)
            self.session.commit()
            return True

        except Exception as e:
            logger.error(f"TaskService: Error during manual execution of Task {task.id}: {e}", exc_info=True)
            task_to_fail = self.session.get(Task, task_id)
            if task_to_fail:
                task_to_fail.last_run_status = "error"
                task_to_fail.last_run_message = f"Manual execution failed: {str(e)}"
                task_to_fail.last_run_at = datetime.now(timezone.utc)
                self.session.add(task_to_fail)
                self.session.commit()
            return False 