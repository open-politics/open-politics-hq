import logging
from typing import List, Optional
from sqlmodel import Session, select
from app.core.celery_app import celery
from app.core.db import engine
from app.models import Task, TaskType, TaskStatus
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
                    elif task.type == TaskType.ANNOTATE:
                        _dispatch_annotate_task(task)
                    elif task.type == TaskType.FLOW:
                        _dispatch_flow_task(task)
                    elif task.type == TaskType.SOURCE_POLL:
                        _dispatch_source_poll_task(task)
                    elif task.type == TaskType.EMBED:
                        _dispatch_embed_task(task)
                    # Legacy types - log deprecation warning
                    elif task.type == TaskType.MONITOR:
                        logger.warning(f"Task {task.id} uses deprecated MONITOR type. Migrate to FLOW.")
                    elif task.type == TaskType.PIPELINE:
                        logger.warning(f"Task {task.id} uses deprecated PIPELINE type. Migrate to FLOW.")
                    else:
                        logger.warning(f"Unknown task type '{task.type}' for task {task.id}")
                        
                except Exception as e:
                    logger.error(f"Failed to dispatch task {task.id}: {e}", exc_info=True)
                    _update_task_status(task.id, "error", f"Dispatch failed: {str(e)}")
                    
        except Exception as e:
            logger.error(f"Error in check_recurring_tasks: {e}", exc_info=True)

def _dispatch_ingest_task(task: Task):
    """Dispatch an INGEST task to process_source with user context."""
    target_source_id = task.configuration.get("target_source_id")
    if target_source_id:
        from app.api.tasks.ingest import process_source
        # Pass task.user_id for credential lookup
        process_source.delay(target_source_id, user_id=task.user_id)
        logger.info(f"Dispatched INGEST task {task.id} for source {target_source_id} (user {task.user_id})")
        _update_task_status(task.id, "running", "Task dispatched to process_source")
    else:
        logger.error(f"INGEST task {task.id} missing target_source_id")
        _update_task_status(task.id, "error", "Missing target_source_id in configuration")

def _dispatch_flow_task(task: Task):
    """Dispatch a FLOW task to trigger_flow_by_task."""
    from app.api.tasks.flow_tasks import trigger_flow_by_task
    trigger_flow_by_task.delay(task.id)
    logger.info(f"Dispatched FLOW task {task.id}")
    _update_task_status(task.id, "running", "Task dispatched to trigger_flow_by_task")

def _dispatch_source_poll_task(task: Task):
    """Dispatch a SOURCE_POLL task to poll a source for new content."""
    source_id = task.configuration.get("source_id") or task.configuration.get("target_source_id")
    if source_id:
        from app.api.tasks.ingest import process_source
        process_source.delay(source_id, user_id=task.user_id)
        logger.info(f"Dispatched SOURCE_POLL task {task.id} for source {source_id}")
        _update_task_status(task.id, "running", "Task dispatched to process_source")
    else:
        logger.error(f"SOURCE_POLL task {task.id} missing source_id")
        _update_task_status(task.id, "error", "Missing source_id in configuration")

def _dispatch_embed_task(task: Task):
    """Dispatch an EMBED task to generate embeddings."""
    from app.api.tasks.embed import embed_infospace_task
    
    infospace_id = task.configuration.get("infospace_id") or task.infospace_id
    if infospace_id:
        embed_infospace_task.delay(
            infospace_id=infospace_id,
            user_id=task.user_id,
            overwrite=task.configuration.get("overwrite", False),
            task_id=task.id
        )
        logger.info(f"Dispatched EMBED task {task.id} for infospace {infospace_id}")
        _update_task_status(task.id, "running", "Task dispatched to embed_infospace_task")
    else:
        logger.error(f"EMBED task {task.id} missing infospace_id")
        _update_task_status(task.id, "error", "Missing infospace_id in configuration")

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