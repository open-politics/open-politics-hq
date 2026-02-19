"""
Celery tasks for embedding generation
"""
import logging
from typing import List, Optional, Dict
from sqlmodel import Session

from app.core.celery_app import celery
from app.core.db import engine
from app.api.embedding.services.embedding_service import EmbeddingService
from app.core.task_utils import update_task_status, run_async_in_celery
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


EMBED_PARALLEL_BATCH_SIZE = 20
EMBED_PARALLEL_THRESHOLD = 50


@celery.task(name="embed_infospace")
def embed_infospace_task(
    infospace_id: int,
    user_id: int,
    overwrite: bool = False,
    asset_kinds: Optional[List[str]] = None,
    task_id: Optional[int] = None,
    api_keys: Optional[Dict[str, str]] = None,
    use_parallel_dispatch: bool = True,
):
    """
    Celery task to generate embeddings for all assets in an infospace.
    For large infospaces (>= EMBED_PARALLEL_THRESHOLD), dispatches batches to multiple workers.
    """
    logger.info(f"Starting infospace embedding task for infospace {infospace_id} (user {user_id})")
    if api_keys:
        logger.info(f"Using runtime API keys for providers: {list(api_keys.keys())}")

    if task_id:
        update_task_status(task_id, "running", "Generating embeddings for infospace")

    with Session(engine) as session:
        from app.models import Asset
        from sqlmodel import select
        query = select(Asset.id).where(Asset.infospace_id == infospace_id)
        if asset_kinds:
            query = query.where(Asset.kind.in_([AssetKind(k) for k in asset_kinds]))
        all_ids = [r for r in session.exec(query).all()]

    if use_parallel_dispatch and len(all_ids) >= EMBED_PARALLEL_THRESHOLD:
        batches = [
            all_ids[i : i + EMBED_PARALLEL_BATCH_SIZE]
            for i in range(0, len(all_ids), EMBED_PARALLEL_BATCH_SIZE)
        ]
        logger.info(f"Dispatching {len(batches)} embed batches to parallel workers")
        from celery import group
        job = group(
            embed_batch_assets_task.s(ids, infospace_id, overwrite, user_id, api_keys)
            for ids in batches
        )
        group_result = job.apply_async()
        group_result.get()
        total_ok = sum(r.get("successful", 0) for r in (group_result.results or []) if isinstance(r, dict))
        total_fail = sum(r.get("failed", 0) for r in (group_result.results or []) if isinstance(r, dict))
        result = {
            "assets_processed": len(all_ids),
            "chunks_created": 0,
            "embeddings_generated": 0,
            "failed_assets": total_fail,
        }
        message = f"Infospace {infospace_id}: {total_ok} embedded, {total_fail} failed (parallel)"
    else:
        async def _embed_infospace():
            with Session(engine) as session:
                service = EmbeddingService(session, user_id=user_id, runtime_api_keys=api_keys)
                kinds = [AssetKind(k) for k in asset_kinds] if asset_kinds else None
                return await service.generate_embeddings_for_infospace(
                    infospace_id=infospace_id,
                    overwrite=overwrite,
                    asset_kinds=kinds
                )
        result = run_async_in_celery(_embed_infospace)
        message = (
            f"Infospace {infospace_id} embedding complete: "
            f"{result['assets_processed']} assets processed, "
            f"{result['chunks_created']} chunks created, "
            f"{result['embeddings_generated']} embeddings generated"
        )

    if result.get("failed_assets"):
        message += f", {result['failed_assets']} assets failed"
    logger.info(message)
    if task_id:
        status = "success" if not result.get("failed_assets") else "completed_with_errors"
        update_task_status(task_id, status, message)
    return result


@celery.task(name="reactive_embed_pending_assets")
def reactive_embed_pending_assets_task(asset_ids: List[int]):
    """
    Reactive watcher task: embeds assets that are READY but not yet embedded.
    Accepts only asset_ids; looks up infospace_id from the first asset.
    Uses user_id=1 (system) for credential fallback.
    """
    if not asset_ids:
        return {"total_assets": 0, "successful": 0, "failed": 0}
    with Session(engine) as session:
        from app.models import Asset
        first = session.get(Asset, asset_ids[0])
        if not first:
            logger.warning(f"reactive_embed_pending: asset {asset_ids[0]} not found")
            return {"total_assets": len(asset_ids), "successful": 0, "failed": len(asset_ids)}
        infospace_id = first.infospace_id
    return embed_batch_assets_task(
        asset_ids, infospace_id, overwrite=False, user_id=1, api_keys=None
    )


@celery.task(name="embed_batch_assets")
def embed_batch_assets_task(
    asset_ids: List[int],
    infospace_id: int,
    overwrite: bool = False,
    user_id: Optional[int] = None,
    api_keys: Optional[Dict[str, str]] = None,
):
    """
    Celery task to embed a batch of assets. Useful for bulk and parallel dispatch.
    """
    if not asset_ids:
        return {"total_assets": 0, "successful": 0, "failed": 0, "failed_asset_ids": []}
    logger.info(f"Starting batch embedding for {len(asset_ids)} assets")
    user_id = user_id or 1
    results = {"total_assets": len(asset_ids), "successful": 0, "failed": 0, "failed_asset_ids": []}
    for asset_id in asset_ids:
        try:
            embed_asset_task(asset_id, infospace_id, user_id, overwrite, api_keys)
            results["successful"] += 1
        except Exception as e:
            logger.error(f"Failed to embed asset {asset_id}: {e}")
            results["failed"] += 1
            results["failed_asset_ids"].append(asset_id)
    logger.info(f"Batch embedding dispatched: {results['successful']} queued, {results['failed']} failed")
    return results
