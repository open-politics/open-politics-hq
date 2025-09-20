import logging
from app.core.celery_app import celery
from sqlmodel import Session
from app.core.db import engine

logger = logging.getLogger(__name__)

@celery.task(name="execute_monitor_task")
def execute_monitor_task(monitor_id: int):
    """
    Celery task to execute a specific monitor.
    This is a thin dispatcher that calls the MonitorService.
    """
    logger.info(f"Task: Executing monitor {monitor_id}")
    with Session(engine) as session:
        try:
            # Lazy import services to avoid circular dependencies at module load time
            from app.api.services.monitor_service import MonitorService
            from app.api.services.annotation_service import AnnotationService
            from app.api.services.task_service import TaskService
            from app.api.providers.factory import create_model_registry, create_storage_provider
            from app.api.services.asset_service import AssetService
            from app.core.config import settings

            storage_provider = create_storage_provider(settings)
            asset_service = AssetService(session, storage_provider)
            model_registry = create_model_registry(settings)
            # Note: In a task context, we need to ensure async initializations are handled correctly.
            # For now, we assume initialize_providers can be called synchronously if it's idempotent and safe.
            try:
                import asyncio
                asyncio.run(model_registry.initialize_providers())
            except RuntimeError: # If a loop is already running
                # This is a simple fix for nested loops, but a more robust solution
                # might be needed for complex async scenarios in Celery.
                loop = asyncio.get_event_loop()
                loop.run_until_complete(model_registry.initialize_providers())

            annotation_service = AnnotationService(session, model_registry, asset_service)
            task_service = TaskService(session, annotation_service)
            monitor_service = MonitorService(session, annotation_service, task_service)
            
            monitor_service.execute_monitor(monitor_id)
            logger.info(f"Task: Successfully completed execution for monitor {monitor_id}")
        except Exception as e:
            logger.error(f"Task: Failed to execute monitor {monitor_id}: {e}", exc_info=True)
            # Potentially update monitor status to ERROR
            from app.models import Monitor
            monitor = session.get(Monitor, monitor_id)
            if monitor:
                monitor.status = "ERROR"
                session.add(monitor)
                session.commit()
            raise 