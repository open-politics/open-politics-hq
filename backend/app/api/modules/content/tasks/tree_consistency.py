"""Belt-and-suspenders consistency check for the bundle/asset tree.

Runs daily behind the validation trigger. Detects orphaned bundles
(parent_bundle_id references a non-existent bundle) and logs warnings.
Does not auto-fix — human review required.
"""

import logging

from sqlalchemy import text
from sqlmodel import select

from app.api.modules.content.models import Bundle
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)


@task(
    "tree_consistency_check",
    check=lambda iid: select(Bundle.id).where(Bundle.infospace_id == iid).limit(1),
    schedule=86400,  # daily
    tags=frozenset({"maintenance"}),
)
def tree_consistency_check(ctx: TaskContext, bundle_ids: list[int]) -> None:
    """Check for orphaned bundles and log warnings."""
    with ctx.session() as session:
        # Orphaned bundles: parent_bundle_id != 0 but parent doesn't exist
        orphans = session.execute(text("""
            SELECT b.id, b.name, b.parent_bundle_id, b.infospace_id
            FROM bundle b
            WHERE b.parent_bundle_id != 0
            AND NOT EXISTS (SELECT 1 FROM bundle p WHERE p.id = b.parent_bundle_id)
        """)).fetchall()

        if orphans:
            logger.warning(
                f"Tree consistency: {len(orphans)} orphaned bundles detected. "
                f"IDs: {[r[0] for r in orphans]}"
            )
            for row in orphans:
                logger.warning(
                    f"  Orphan: bundle {row[0]} ({row[1]!r}) claims parent {row[2]} "
                    f"in infospace {row[3]}, but parent does not exist"
                )
            ctx.stat("orphaned_bundles", len(orphans))
        else:
            logger.info("Tree consistency: no orphaned bundles")
