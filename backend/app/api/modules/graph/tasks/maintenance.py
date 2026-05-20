"""
Graph maintenance @task functions.

Currently houses ``retire_superseded`` only. The previous
``re_resolve_singletons`` task was deleted in favor of
``propose_resolutions`` (in ``tasks/proposals.py``) — user-invocable scan
that proposes merges via streaming events; no automatic dedup.
"""

from sqlmodel import select

from app.api.modules.graph.models import FragmentCuration
from app.api.modules.content.models import Asset
from app.models import Annotation
from app.core.tasks import TaskContext, task


@task("superseded_entity_retire",
      check=lambda iid: (
          select(FragmentCuration.id)
          .join(Annotation, FragmentCuration.annotation_id == Annotation.id)
          .join(Asset, Annotation.asset_id == Asset.id)
          .where(Asset.infospace_id == iid)
          .where(FragmentCuration.source_asset_superseded == False)
          .where(Asset.is_superseded == True)
      ),
      schedule=21600,
      batch=50, tags=frozenset({"graph"}))
def retire_superseded(ctx: TaskContext, ids: list[int]):
    """Flag FragmentCuration entries whose source asset is superseded.

    This is asset-supersession bookkeeping, separate from entity dedup. It
    runs on a 6-hour beat — when assets are versioned, their old curations
    get a tombstone flag so query-time filters can exclude them.
    """
    with ctx.session() as session:
        for curation_id in ids:
            curation = session.get(FragmentCuration, curation_id)
            if curation and not curation.source_asset_superseded:
                curation.source_asset_superseded = True
        session.commit()
        ctx.stat("done", len(ids))
