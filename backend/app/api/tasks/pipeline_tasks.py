import logging
from app.core.celery_app import celery
from sqlmodel import Session
from app.core.db import engine
from app.api.services.pipeline_service import PipelineService
from app.api.services.annotation_service import AnnotationService
from app.api.services.analysis_service import AnalysisService
from app.api.services.bundle_service import BundleService
from app.api.services.asset_service import AssetService
from app.api.providers.factory import create_model_registry, create_storage_provider
from app.core.config import settings

logger = logging.getLogger(__name__)

@celery.task(name="execute_pipeline_step")
def execute_pipeline_step(execution_id: int, step_order: int):
    """
    Celery task to execute a single step of an Intelligence Pipeline.
    It acts as a dispatcher to the PipelineService.
    """
    logger.info(f"Task: Executing step {step_order} for pipeline execution {execution_id}")
    with Session(engine) as session:
        try:
            storage_provider = create_storage_provider(settings)
            asset_service = AssetService(session, storage_provider)
            
            # Asynchronously initialize the model registry
            model_registry = create_model_registry(settings)
            import asyncio
            try:
                asyncio.run(model_registry.initialize_providers())
            except RuntimeError: # If a loop is already running
                loop = asyncio.get_event_loop()
                loop.run_until_complete(model_registry.initialize_providers())

            annotation_service = AnnotationService(session, model_registry, asset_service)
            analysis_service = AnalysisService(session, model_registry, annotation_service, asset_service)
            bundle_service = BundleService(session)
            
            pipeline_service = PipelineService(
                session=session,
                annotation_service=annotation_service,
                analysis_service=analysis_service,
                bundle_service=bundle_service
            )
            
            pipeline_service.run_pipeline_step(execution_id, step_order)
            logger.info(f"Task: Successfully completed step {step_order} for execution {execution_id}")
            
        except Exception as e:
            logger.error(f"Task: Failed to execute pipeline step {step_order} for execution {execution_id}: {e}", exc_info=True)
            # The service should handle marking the execution as FAILED.
            raise 