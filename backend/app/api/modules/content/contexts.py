"""The contexts the content domain injects — every one of them lives here.

Each phase of the cascade hands its worker a resolved environment instead of
letting it resolve providers/sessions itself:

  SourceContext      acquire   — what a Source's ``read``/``view``/``fetch`` runs in
  ProcessingContext  process   — what a ContentType's ``process`` runs in
  EnrichmentContext  enrich    — the @enricher runtime (a TaskContext with the
                                 done/fail/skip verbs over ``enrichment_resolved``)

The first two are plain environments (dataclasses built per job/asset from
``resolve()``/``ctx.provider``); the third extends the @task substrate's
TaskContext. Standing rule: a new injected context goes in this file.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlmodel import Session

from app.api.modules.foundation_service_providers.base import (
    ScrapingProvider, StorageProvider, WebSearchProvider,
)
from app.core.config import AppSettings
from app.core.tasks import TaskContext

logger = logging.getLogger(__name__)


# ── SourceContext (acquire) ────────────────────────────────────────────────────

@dataclass
class SourceContext:
    """The resolved environment a source operates in. Sources enumerate and
    realize items; they never place assets (the ``ingest`` task owns the build
    loop), so there is no tree/bundle access here."""

    session: Session
    user_id: int
    infospace_id: int
    settings: AppSettings
    storage_provider: Optional[StorageProvider] = None
    scraping_provider: Optional[ScrapingProvider] = None
    search_provider: Optional[WebSearchProvider] = None
    options: Dict[str, Any] = field(default_factory=dict)


# ── ProcessingContext (process) ────────────────────────────────────────────────

@dataclass
class ProcessingContext:
    """What a ``ContentType.process`` receives: a session + resolved providers +
    ids + limits, plus ``persist_children`` (build first time, reconcile-in-place
    on reprocess). Built per asset from ``ctx.provider``."""

    session: Session
    user_id: int
    infospace_id: int
    storage_provider: StorageProvider
    scraping_provider: Optional[ScrapingProvider] = None
    options: Dict[str, Any] = None
    max_rows: int = 50000
    max_pages: int = 0     # 0 = no limit
    max_images: int = 8
    timeout: int = 30

    def __post_init__(self):
        if self.options is None:
            self.options = {}
        self.max_rows = self.options.get("max_rows", self.max_rows)
        self.max_pages = self.options.get("max_pages", self.max_pages)
        self.max_images = self.options.get("max_images", self.max_images)
        self.timeout = self.options.get("timeout", self.timeout)

    async def persist_children(self, parent_id, children, *, match_key="part_index"):
        from app.api.modules.content.asset_builder import persist_children as _persist
        return await _persist(
            self.session, parent_id, children,
            user_id=self.user_id, infospace_id=self.infospace_id, match_key=match_key,
        )


# ── EnrichmentContext (enrich) ─────────────────────────────────────────────────

class EnrichmentContext(TaskContext):
    """Extended context for enrichment domain.

    ``provider()`` is inherited from TaskContext unchanged — the enrichment_config
    lookup is handled inside resolve() itself, keyed by infospace_id.
    """

    def __init__(self, enricher_name: str = "", enrichment_config=None, **kwargs):
        super().__init__(**kwargs)
        self._enricher_name = enricher_name
        self.enrichment_config = enrichment_config

    def _mark_resolved(self, session: Session, asset_id: int):
        """Add enricher name to enrichment_resolved (idempotent, dedup guard)."""
        session.execute(text(
            "UPDATE asset SET enrichment_resolved = "
            "array_append(COALESCE(enrichment_resolved, ARRAY[]::text[]), :name) "
            "WHERE id = :id "
            "AND NOT (COALESCE(enrichment_resolved, ARRAY[]::text[]) @> ARRAY[:name]::text[])"
        ), {"name": self._enricher_name, "id": asset_id})

    def done(self, session: Session, asset_id: int, facets: dict | None = None):
        """Mark enrichment complete for one asset. Event emitted once per batch by wrapper."""
        self._mark_resolved(session, asset_id)
        if facets:
            from app.api.modules.content.facets import merge_facets
            merge_facets(session, asset_id, facets)
        self.stat("done")

    def fail(self, session: Session, asset_id: int, reason: str):
        """Mark failed. Prevents re-dispatch + records diagnostics."""
        self._mark_resolved(session, asset_id)
        now_iso = datetime.now(timezone.utc).isoformat()
        session.execute(text(
            "UPDATE asset SET enrichment_errors = "
            "CASE WHEN jsonb_typeof(enrichment_errors) = 'object' "
            "     THEN enrichment_errors ELSE '{}'::jsonb END "
            "|| jsonb_build_object(:name, jsonb_build_object('reason', :reason, 'at', :ts)) "
            "WHERE id = :id"
        ), {"name": self._enricher_name, "id": asset_id, "reason": reason, "ts": now_iso})
        self.item_failed(asset_id)
        self.stat("failed")

    def skip(self, session: Session, asset_id: int):
        """Prevent re-dispatch without marking enriched."""
        self._mark_resolved(session, asset_id)
        self.stat("skipped")
