"""
Graph maintenance @task functions.

Houses ``retire_superseded`` (asset-supersession bookkeeping) and
``embed_canon`` (embedding backfill). The previous ``re_resolve_singletons``
task was deleted in favor of ``propose_resolutions`` (in ``tasks/proposals.py``)
— user-invocable scan that proposes merges via streaming events; no automatic
dedup.
"""

import logging

from sqlalchemy import text as sa_text
from sqlmodel import select

from app.api.modules.graph.models import FragmentCuration, Canon, CanonEntry
from app.api.modules.content.models import Asset, get_embedding_column_for_dimension
from app.api.modules.graph.schemas import EmbedCanonParams
from app.models import Annotation
from app.core.task_utils import run_async_in_celery
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)


def _embed(session, infospace_id: int, texts: list[str]):
    """Embed a batch via the infospace's configured provider, or None if absent."""
    from app.api.modules.embedding.embed import embed_texts
    from app.api.modules.foundation_service_providers import get_configured_foundation_provider
    sel = get_configured_foundation_provider(session, infospace_id, "embedding")
    if not sel or not sel.model_name:
        return None
    vectors, _em = run_async_in_celery(embed_texts, session, infospace_id, texts)
    return vectors or None


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


def backfill_canon_embeddings(session, infospace_id: int, canon_id: int) -> int:
    """Embed every entry in a canon that lacks the current provider's embedding —
    the logic behind the ``embed_canon`` @task, callable directly. Idempotent and
    cursor-batched (forward progress guaranteed even if a row can't be written, so
    it scales to large canons without loading them whole). Returns the count
    embedded. No-op (returns 0) when no embedding provider is configured."""
    canon = session.get(Canon, canon_id)
    if not canon or canon.infospace_id != infospace_id:
        return 0
    # Probe the configured provider's embedding dimension via one tiny embed.
    probe = _embed(session, infospace_id, ["_"])
    if not probe or not probe[0]:
        logger.info("backfill_canon_embeddings: no provider for infospace %s — skipping", infospace_id)
        return 0
    dim = len(probe[0])
    col = get_embedding_column_for_dimension(dim)
    if not col:
        logger.warning("backfill_canon_embeddings: unsupported embedding dim %s", dim)
        return 0

    embedded = 0
    BATCH = 128
    after = 0
    while True:
        # Cursor by id guarantees forward progress even if a row can't be written
        # (wrong-dim vector); the col-IS-NULL filter skips entries already embedded
        # (e.g. by embed-on-create).
        rows = session.execute(
            sa_text(
                f"SELECT id, canonical FROM canon_entry "
                f"WHERE canon_id = :cid AND id > :after AND {col} IS NULL "
                f"ORDER BY id LIMIT :lim"
            ),
            {"cid": canon_id, "after": after, "lim": BATCH},
        ).all()
        if not rows:
            break
        after = rows[-1][0]
        vectors = _embed(session, infospace_id, [r[1] or "" for r in rows])
        if not vectors:
            break
        if len(vectors) != len(rows):
            # Provider returned a short batch; embed the paired prefix and let the
            # unpaired rows (still col-IS-NULL) come back on the next pass.
            logger.warning(
                "backfill_canon_embeddings: %d vectors for %d texts (canon %s) — embedding prefix",
                len(vectors), len(rows), canon_id,
            )
        for (eid, _canonical), vec in zip(rows, vectors):
            if vec and len(vec) == dim:
                entry = session.get(CanonEntry, eid)
                if entry is not None:
                    setattr(entry, col, vec)
                    session.add(entry)
                    embedded += 1
        session.commit()
    return embedded


@task("embed_canon",
      params_model=EmbedCanonParams,
      schedule=None,
      max_concurrency=2,
      timeout=1800,
      tags=frozenset({"graph", "embedding"}))
def embed_canon(ctx: TaskContext, _ids: list[int], params: EmbedCanonParams):
    """Backfill embeddings for a canon's entries — what embed-on-create doesn't
    cover (imported / pre-existing / post-model-change entries).

    Canon stays fully functional with zero embeddings; this is pure acceleration
    for fuzzy resolution + similarity suggestions, never a precondition of use.
    """
    with ctx.session() as session:
        embedded = backfill_canon_embeddings(session, ctx.infospace_id, params.canon_id)
    ctx.stat("embedded", embedded)
