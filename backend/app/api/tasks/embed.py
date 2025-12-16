"""
Celery tasks for embedding generation
"""
import logging
from typing import List, Optional, Dict
from sqlmodel import Session

from app.core.celery_app import celery
from app.core.db import engine
from app.api.services.embedding_service import EmbeddingService
from app.api.tasks.utils import update_task_status, run_async_in_celery
from app.models import AssetKind

logger = logging.getLogger(__name__)


@celery.task(name="embed_asset")
def embed_asset_task(
    asset_id: int, 
    infospace_id: int,
    user_id: int,
    overwrite: bool = False,
    api_keys: Optional[Dict[str, str]] = None
):
    """
    Celery task to generate embeddings for a single asset.
    
    Uses runtime API keys if provided, otherwise falls back to user's stored encrypted credentials.
    
    Args:
        asset_id: Asset ID to embed
        infospace_id: Infospace ID (for configuration)
        user_id: User ID (for credential lookup)
        overwrite: Whether to regenerate existing embeddings
        api_keys: Optional runtime API keys for cloud providers (openai, voyage, jina)
    """
    logger.info(f"Starting embedding task for asset {asset_id} (user {user_id})")
    if api_keys:
        logger.info(f"Using runtime API keys for providers: {list(api_keys.keys())}")
    
    async def _embed_asset():
        with Session(engine) as session:
            # Service uses runtime API keys if provided, otherwise falls back to stored credentials
            service = EmbeddingService(session, user_id=user_id, runtime_api_keys=api_keys)
            result = await service.generate_embeddings_for_asset(
                asset_id=asset_id,
                infospace_id=infospace_id,
                overwrite=overwrite
            )
            return result
    
    try:
        result = run_async_in_celery(_embed_asset)
        logger.info(
            f"Asset {asset_id} embedded successfully: "
            f"{result['chunks_created']} chunks created, "
            f"{result['embeddings_generated']} embeddings generated"
        )
        return result
    except Exception as e:
        logger.error(f"Failed to embed asset {asset_id}: {e}", exc_info=True)
        raise


@celery.task(name="embed_infospace")
def embed_infospace_task(
    infospace_id: int,
    user_id: int,
    overwrite: bool = False,
    asset_kinds: Optional[List[str]] = None,
    task_id: Optional[int] = None,
    api_keys: Optional[Dict[str, str]] = None
):
    """
    Celery task to generate embeddings for all assets in an infospace.
    
    Uses runtime API keys if provided, otherwise falls back to user's stored encrypted credentials.
    
    Args:
        infospace_id: Infospace ID
        user_id: User ID (for credential lookup)
        overwrite: Whether to regenerate existing embeddings
        asset_kinds: Optional filter for specific asset types
        task_id: Optional recurring task ID for status updates
        api_keys: Optional runtime API keys for cloud providers (openai, voyage, jina)
    """
    logger.info(f"Starting infospace embedding task for infospace {infospace_id} (user {user_id})")
    if api_keys:
        logger.info(f"Using runtime API keys for providers: {list(api_keys.keys())}")
    
    if task_id:
        update_task_status(task_id, "running", "Generating embeddings for infospace")
    
    async def _embed_infospace():
        with Session(engine) as session:
            # Service uses runtime API keys if provided, otherwise falls back to stored credentials
            service = EmbeddingService(session, user_id=user_id, runtime_api_keys=api_keys)
            
            # Convert asset_kinds strings to enum
            kinds = None
            if asset_kinds:
                kinds = [AssetKind(kind) for kind in asset_kinds]
            
            result = await service.generate_embeddings_for_infospace(
                infospace_id=infospace_id,
                overwrite=overwrite,
                asset_kinds=kinds
            )
            return result
    
    try:
        result = run_async_in_celery(_embed_infospace)
        
        message = (
            f"Infospace {infospace_id} embedding complete: "
            f"{result['assets_processed']} assets processed, "
            f"{result['chunks_created']} chunks created, "
            f"{result['embeddings_generated']} embeddings generated"
        )
        
        if result['failed_assets']:
            message += f", {len(result['failed_assets'])} assets failed"
        
        logger.info(message)
        
        if task_id:
            status = "success" if not result['failed_assets'] else "completed_with_errors"
            update_task_status(task_id, status, message)
        
        return result
        
    except Exception as e:
        error_message = f"Failed to embed infospace {infospace_id}: {str(e)}"
        logger.error(error_message, exc_info=True)
        
        if task_id:
            update_task_status(task_id, "failed", error_message)
        
        raise


@celery.task(name="embed_batch_assets")
def embed_batch_assets_task(
    asset_ids: List[int],
    infospace_id: int,
    overwrite: bool = False
):
    """
    Celery task to embed a batch of assets.
    Useful for bulk operations.
    
    Args:
        asset_ids: List of asset IDs to embed
        infospace_id: Infospace ID (for configuration)
        overwrite: Whether to regenerate existing embeddings
    """
    logger.info(f"Starting batch embedding for {len(asset_ids)} assets")
    
    results = {
        "total_assets": len(asset_ids),
        "successful": 0,
        "failed": 0,
        "failed_asset_ids": []
    }
    
    for asset_id in asset_ids:
        try:
            embed_asset_task(asset_id, infospace_id, overwrite)
            results["successful"] += 1
        except Exception as e:
            logger.error(f"Failed to embed asset {asset_id}: {e}")
            results["failed"] += 1
            results["failed_asset_ids"].append(asset_id)
    
    logger.info(
        f"Batch embedding complete: {results['successful']} successful, "
        f"{results['failed']} failed"
    )
    
    return results

