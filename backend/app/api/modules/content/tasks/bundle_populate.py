"""Populate a bundle from an AQL query string stored in bundle_metadata."""

import logging

from sqlalchemy import text
from sqlmodel import select

from app.api.modules.content.models import Bundle
from app.api.modules.content.query import AssetQuery
from app.api.modules.content.query_parser import parse
from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)


@task(
    "populate_bundle_from_query",
    check=lambda iid: (
        select(Bundle.id).where(
            Bundle.infospace_id == iid,
            Bundle.asset_count == 0,
            Bundle.bundle_metadata["source_query"].as_string().isnot(None),
        )
    ),
    schedule=None,  # direct invocation only
    tags=frozenset({"content", "bundle"}),
    queue="default",
)
def populate_bundle_from_query(ctx: TaskContext, bundle_ids: list[int]):
    with ctx.session() as session:
        for bundle_id in bundle_ids:
            bundle = session.get(Bundle, bundle_id)
            if not bundle or not bundle.bundle_metadata:
                continue

            query_str = bundle.bundle_metadata.get("source_query")
            if not query_str:
                continue

            parsed = parse(query_str)
            if parsed.is_empty:
                continue

            aq = AssetQuery.from_aql(session, bundle.infospace_id, parsed).unlimited()

            if parsed.has_semantic:
                rows = run_async_in_celery(aq.execute_scored_async)
                asset_ids = [asset.id for asset, _, _ in rows]
            else:
                assets = aq.execute()
                asset_ids = [a.id for a in assets]

            if not asset_ids:
                continue

            from app.core.tree import copy as tree_copy
            result = tree_copy(session, asset_ids=asset_ids, to=bundle_id)
            bundle.asset_count = result.assets
            session.commit()

            ctx.stat("bundles_populated")
            ctx.stat("assets_assigned", len(asset_ids))
            logger.info("Bundle %d populated with %d assets from query: %s", bundle_id, len(asset_ids), query_str)
