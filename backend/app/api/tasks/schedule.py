import logging
from typing import List, Optional
from sqlmodel import Session, select
from app.core.celery_app import celery
from app.core.db import engine
from app.models import Task, TaskType, TaskStatus, IntelligencePipeline
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

@celery.task(name="check_recurring_tasks")
def check_recurring_tasks():
    """
    Celery Beat task that runs every minute to check for recurring tasks that need execution.
    This dispatches the appropriate task type to its specific handler.
    """
    logger.info("Checking for recurring tasks to execute...")
    
    with Session(engine) as session:
        try:
            # Get all active tasks (this should be handled by celery beat dynamic scheduling in production)
            # For now, we'll implement a simple check
            active_tasks = session.exec(
                select(Task).where(
                    Task.status == TaskStatus.ACTIVE,
                    Task.is_enabled == True
                )
            ).all()
            
            logger.info(f"Found {len(active_tasks)} active tasks")
            
            for task in active_tasks:
                try:
                    # Dispatch based on task type
                    if task.type == TaskType.INGEST:
                        _dispatch_ingest_task(task)
                    elif task.type == TaskType.MONITOR:
                        _dispatch_monitor_task(task)
                    elif task.type == TaskType.ANNOTATE:
                        _dispatch_annotate_task(task)
                    elif task.type == TaskType.PIPELINE:
                        _dispatch_pipeline_task(task)
                    else:
                        logger.warning(f"Unknown task type '{task.type}' for task {task.id}")
                        
                except Exception as e:
                    logger.error(f"Failed to dispatch task {task.id}: {e}", exc_info=True)
                    _update_task_status(task.id, "error", f"Dispatch failed: {str(e)}")
                    
        except Exception as e:
            logger.error(f"Error in check_recurring_tasks: {e}", exc_info=True)

def _dispatch_ingest_task(task: Task):
    """Dispatch an INGEST task to process_source"""
    target_source_id = task.configuration.get("target_source_id")
    if target_source_id:
        from app.api.tasks.ingest import process_source
        process_source.delay(target_source_id)
        logger.info(f"Dispatched INGEST task {task.id} for source {target_source_id}")
        _update_task_status(task.id, "running", "Task dispatched to process_source")
    else:
        logger.error(f"INGEST task {task.id} missing target_source_id")
        _update_task_status(task.id, "error", "Missing target_source_id in configuration")

def _dispatch_monitor_task(task: Task):
    """Dispatch a MONITOR task to execute_monitor_task"""
    monitor_id = task.configuration.get("monitor_id")
    if monitor_id:
        from app.api.tasks.monitor_tasks import execute_monitor_task
        execute_monitor_task.delay(monitor_id)
        logger.info(f"Dispatched MONITOR task {task.id} for monitor {monitor_id}")
        _update_task_status(task.id, "running", "Task dispatched to execute_monitor_task")
    else:
        logger.error(f"MONITOR task {task.id} missing monitor_id")
        _update_task_status(task.id, "error", "Missing monitor_id in configuration")

def _dispatch_annotate_task(task: Task):
    """Dispatch an ANNOTATE task to annotation processing"""
    try:
        from app.api.services.annotation_service import AnnotationService
        from app.api.services.asset_service import AssetService
        from app.api.providers.factory import create_model_registry, create_storage_provider
        from app.core.config import settings
        from app.schemas import AnnotationRunCreate
        import asyncio
        
        async def run_annotation_task():
            with Session(engine) as session:
                storage_provider = create_storage_provider(settings)
                asset_service = AssetService(session, storage_provider)
                model_registry = create_model_registry(settings)
                await model_registry.initialize_providers()
                annotation_service = AnnotationService(session, model_registry, asset_service)
                
                run_config = task.configuration or {}
                
                create_run_payload = AnnotationRunCreate(
                    name=f"Scheduled execution of Task: {task.name} - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
                    schema_ids=run_config.get("schema_ids", []),
                    target_asset_ids=run_config.get("target_asset_ids"),
                    target_bundle_id=run_config.get("target_bundle_id"),
                    configuration=run_config.get("run_specific_config", {}),
                    include_parent_context=run_config.get("include_parent_context", False),
                    context_window=run_config.get("context_window", 0)
                )
                
                if not create_run_payload.schema_ids:
                    logger.error(f"ANNOTATE task {task.id} missing schema_ids")
                    _update_task_status(task.id, "error", "Missing schema_ids in configuration")
                    return
                    
                new_run = annotation_service.create_run(
                    user_id=task.user_id,
                    infospace_id=task.infospace_id,
                    run_in=create_run_payload
                )
                logger.info(f"Dispatched ANNOTATE task {task.id}, created run {new_run.id}")
        
        # Run the async function
        asyncio.run(run_annotation_task())
        _update_task_status(task.id, "running", "Annotation task dispatched")
            
    except Exception as e:
        logger.error(f"Failed to dispatch ANNOTATE task {task.id}: {e}", exc_info=True)
        _update_task_status(task.id, "error", f"Failed to create annotation run: {str(e)}")

def _dispatch_pipeline_task(task: Task):
    """Dispatch a PIPELINE task. This requires a pipeline_id in configuration.
    For now, this logs an error if missing; a full implementation would create an execution and start step 1.
    """
    pipeline_id = task.configuration.get("pipeline_id") if task.configuration else None
    if not pipeline_id:
        logger.error(f"PIPELINE task {task.id} missing pipeline_id")
        _update_task_status(task.id, "error", "Missing pipeline_id in configuration")
        return
    try:
        from app.api.services.pipeline_service import PipelineService
        from app.api.services.annotation_service import AnnotationService
        from app.api.services.analysis_service import AnalysisService
        from app.api.services.bundle_service import BundleService
        from app.api.services.asset_service import AssetService
        from app.api.providers.factory import create_classification_provider, create_storage_provider
        from app.core.config import settings

        with Session(engine) as session:
            storage_provider = create_storage_provider(settings)
            asset_service = AssetService(session, storage_provider)
            classification_provider = create_classification_provider(settings)
            annotation_service = AnnotationService(session, classification_provider, asset_service)
            analysis_service = AnalysisService(session, classification_provider, annotation_service, asset_service)
            bundle_service = BundleService(session)
            pipeline_service = PipelineService(session, annotation_service, analysis_service, bundle_service)

            # Resolve delta to determine triggering assets
            pipeline = session.get(IntelligencePipeline, pipeline_id)
            if not pipeline:
                _update_task_status(task.id, "error", f"Pipeline {pipeline_id} not found")
                return
            # Reuse service's helper via protected access for now
            delta = pipeline_service._resolve_start_assets_delta(pipeline)
            triggering_assets = sorted({aid for ids in delta.values() for aid in ids})
            execution = pipeline_service.trigger_pipeline(pipeline_id=pipeline_id, asset_ids=triggering_assets, trigger_type="SCHEDULED_FULL_RUN")
            _update_task_status(task.id, "running", f"Started pipeline execution {execution.id}")
    except Exception as e:
        logger.error(f"Failed to dispatch PIPELINE task {task.id}: {e}", exc_info=True)
        _update_task_status(task.id, "error", f"Failed to start pipeline: {str(e)}")

def _update_task_status(task_id: int, status: str, message: Optional[str] = None):
    """Update task status and message"""
    try:
        with Session(engine) as session:
            task = session.get(Task, task_id)
            if task:
                task.last_run_status = status
                task.last_run_message = message
                task.last_run_at = datetime.now(timezone.utc)
                
                if status == "success":
                    task.last_successful_run_at = task.last_run_at
                    task.consecutive_failure_count = 0
                elif status == "error":
                    task.consecutive_failure_count = (task.consecutive_failure_count or 0) + 1
                    
                session.add(task)
                session.commit()
                logger.debug(f"Updated task {task_id} status to {status}")
    except Exception as e:
        logger.error(f"Failed to update task {task_id} status: {e}", exc_info=True) 