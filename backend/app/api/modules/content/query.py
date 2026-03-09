"""
AssetQuery - Composable SQL query builder for asset search.

Supports:
- Full-text search (tsvector FTS or ILIKE fallback)
- Kind filters, facet filters (facets JSONB), fragments containment
- Semantic search (pgvector via subquery)
- Date range, bundle scope
- Cursor pagination, composite sort
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import re
from sqlalchemy import and_, or_, func, text
from sqlmodel import Session, select

from app.api.modules.content.facets import build_facet_filter
from app.api.modules.content.models import Asset, AssetKind
from app.api.modules.content.utils.watcher_filters import non_superseded_filter

logger = logging.getLogger(__name__)


class AssetQuery:
    """
    Composable builder for asset queries within an infospace.

    Usage:
        results = (
            AssetQuery(session, infospace_id)
            .text("climate policy", mode="fts")
            .kinds([AssetKind.PDF, AssetKind.WEB])
            .facets(language="en", quality_score_gte=0.5)
            .fragments_contain({"topic": {"value": "environment"}})
            .bundle(bundle_id=42)
            .sort("relevance")
            .paginate(cursor=None, limit=25)
            .execute()
        )
    """

    def __init__(self, session: Session, infospace_id: int):
        self.session = session
        self.infospace_id = infospace_id
        self._conditions: List[Any] = [Asset.infospace_id == infospace_id]
        self._semantic_query: Optional[str] = None
        self._semantic_top_k: int = 20
        self._semantic_embedding_service: Optional[Any] = None
        self._kinds: List[AssetKind] = []
        self._bundle_id: Optional[int] = None
        self._sort: str = "created_at_desc"
        self._cursor: Optional[int] = None
        self._limit: int = 25
        self._offset: int = 0

    def text(
        self,
        query: str,
        mode: str = "fts",
    ) -> AssetQuery:
        """Add text search. mode='fts' uses tsvector; 'ilike' fallback."""
        if not query or not query.strip():
            return self
        q = query.strip()
        if mode == "fts":
            try:
                self._conditions.append(
                    text(
                        "text_search_vector @@ plainto_tsquery('english', :q)"
                    ).bindparams(q=q)
                )
            except Exception:
                mode = "ilike"
        if mode == "ilike":
            pat = f"%{q}%"
            self._conditions.append(
                or_(
                    Asset.title.ilike(pat),
                    (Asset.text_content.isnot(None)) & (Asset.text_content.ilike(pat)),
                )
            )
        return self

    def kinds(self, kinds: List[AssetKind]) -> AssetQuery:
        """Filter by asset kinds."""
        self._kinds = kinds or []
        if self._kinds:
            self._conditions.append(Asset.kind.in_(self._kinds))
        return self

    def facets(
        self,
        language: Optional[str] = None,
        quality_score_gte: Optional[float] = None,
        quality_score_lte: Optional[float] = None,
        **facets_kwargs: Any,
    ) -> AssetQuery:
        """Filter by asset.facets (JSONB containment)."""
        facet_filter = build_facet_filter(language=language, **facets_kwargs)
        if facet_filter:
            self._conditions.append(
                text("metadata @> :facets::jsonb").bindparams(
                    facets=json.dumps(facet_filter)
                )
            )
        if quality_score_gte is not None:
            self._conditions.append(
                text("(metadata->>'quality_score')::float >= :quality_gte").bindparams(
                    quality_gte=quality_score_gte
                )
            )
        if quality_score_lte is not None:
            self._conditions.append(
                text("(metadata->>'quality_score')::float <= :quality_lte").bindparams(
                    quality_lte=quality_score_lte
                )
            )
        return self

    def fragments_contain(self, fragment_filter: Dict[str, Any]) -> AssetQuery:
        """Filter assets whose fragments JSONB contain the given structure."""
        if fragment_filter:
            self._conditions.append(
                text("fragments @> :frag::jsonb").bindparams(
                    frag=json.dumps(fragment_filter)
                )
            )
        return self

    def semantic(
        self,
        query_text: str,
        top_k: int = 20,
        embedding_service: Optional[Any] = None,
    ) -> AssetQuery:
        """Add semantic similarity filter via pgvector. Requires embedding_service for execute()."""
        self._semantic_query = query_text
        self._semantic_top_k = top_k
        self._semantic_embedding_service = embedding_service
        return self

    def date_range(
        self,
        after: Optional[datetime] = None,
        before: Optional[datetime] = None,
    ) -> AssetQuery:
        """Filter by event_timestamp or created_at."""
        if after is not None:
            self._conditions.append(
                or_(
                    Asset.event_timestamp >= after,
                    (Asset.event_timestamp.is_(None)) & (Asset.created_at >= after),
                )
            )
        if before is not None:
            self._conditions.append(
                or_(
                    Asset.event_timestamp <= before,
                    (Asset.event_timestamp.is_(None)) & (Asset.created_at <= before),
                )
            )
        return self

    def bundle(self, bundle_id: Optional[int] = None) -> AssetQuery:
        """Scope to a bundle."""
        self._bundle_id = bundle_id
        if bundle_id is not None:
            self._conditions.append(Asset.bundle_id == bundle_id)
        return self

    def parent_asset(self, parent_asset_id: Optional[int] = None) -> AssetQuery:
        """Filter by parent asset (e.g. for CSV rows)."""
        if parent_asset_id is not None:
            self._conditions.append(Asset.parent_asset_id == parent_asset_id)
        return self

    def user_id(self, user_id: Optional[int] = None) -> AssetQuery:
        """Filter by user who created the asset."""
        if user_id is not None:
            self._conditions.append(Asset.user_id == user_id)
        return self

    def offset(self, offset: int = 0) -> AssetQuery:
        """Set offset for pagination (use with limit for skip/limit)."""
        self._offset = max(0, offset)
        return self

    def exclude_superseded(self) -> AssetQuery:
        """Exclude superseded assets and children of superseded parents."""
        for clause in non_superseded_filter():
            self._conditions.append(clause)
        return self

    def annotation_value(
        self,
        run_ids: List[int],
        field: str,
        op: str,
        value: Any,
    ) -> AssetQuery:
        """Filter by annotation value via EXISTS subquery. SQL pushdown for post-annotation filtering."""
        if not run_ids:
            return self
        # Sanitize field: allow alphanumeric, underscore, dot for nested paths
        if not re.match(r"^[a-zA-Z0-9_.]+$", field):
            return self
        base = (
            "EXISTS (SELECT 1 FROM annotation WHERE annotation.asset_id = asset.id "
            "AND annotation.run_id = ANY(:run_ids) AND "
        )
        if op == "==":
            cond = text(
                base + "(annotation.value->>:field)::text = :val"
            ).bindparams(run_ids=run_ids, field=field, val=str(value))
        elif op == "!=":
            cond = text(
                "NOT " + base + "(annotation.value->>:field)::text = :val"
            ).bindparams(run_ids=run_ids, field=field, val=str(value))
        elif op in (">=", ">", "<=", "<"):
            cond = text(
                base + "(annotation.value->>:field)::float " + op + " :val"
            ).bindparams(run_ids=run_ids, field=field, val=float(value))
        elif op == "contains":
            pat = f"%{value}%"
            cond = text(
                base + "annotation.value->>:field ILIKE :pat"
            ).bindparams(run_ids=run_ids, field=field, pat=pat)
        elif op == "exists":
            cond = text(
                base + "annotation.value ? :field"
            ).bindparams(run_ids=run_ids, field=field)
        elif op == "not_exists":
            cond = text(
                "NOT " + base + "annotation.value ? :field"
            ).bindparams(run_ids=run_ids, field=field)
        else:
            return self
        self._conditions.append(cond)
        return self

    def sort(self, mode: str = "created_at_desc") -> AssetQuery:
        """Set sort order: 'created_at_desc', 'created_at_asc', 'relevance', 'title'."""
        self._sort = mode or "created_at_desc"
        return self

    def paginate(self, cursor: Optional[int] = None, limit: int = 25) -> AssetQuery:
        """Set cursor (asset id) and limit for pagination."""
        self._cursor = cursor
        self._limit = min(limit or 25, 200)
        return self

    def _build_base_select(self):
        """Build base select with all conditions."""
        stmt = select(Asset).where(and_(*self._conditions))
        if self._sort == "created_at_desc":
            stmt = stmt.order_by(Asset.created_at.desc())
        elif self._sort == "created_at_asc":
            stmt = stmt.order_by(Asset.created_at.asc())
        elif self._sort == "title":
            stmt = stmt.order_by(Asset.title.asc())
        elif self._sort == "relevance" and self._semantic_query:
            pass  # Handled in execute when semantic is used
        elif self._sort == "relevance":
            stmt = stmt.order_by(Asset.created_at.desc())
        if self._cursor is not None:
            if self._sort in ("created_at_desc", "relevance"):
                stmt = stmt.where(Asset.id < self._cursor)
            elif self._sort == "created_at_asc":
                stmt = stmt.where(Asset.id > self._cursor)
        if getattr(self, "_offset", 0) > 0:
            stmt = stmt.offset(self._offset)
        stmt = stmt.limit(self._limit)
        return stmt

    def count(self) -> int:
        """Return total count matching the current conditions (ignores limit/offset/cursor)."""
        stmt = select(func.count(Asset.id)).where(and_(*self._conditions))
        return self.session.exec(stmt).one() or 0

    def execute(self) -> List[Asset]:
        """
        Execute the query and return list of Asset.

        For semantic search use execute_async() when in an async context.
        """
        stmt = self._build_base_select()
        return list(self.session.exec(stmt).all())

    async def execute_async(self) -> List[Asset]:
        """
        Execute with async semantic search when semantic() was used.
        """
        if self._semantic_query:
            try:
                from app.api.modules.embedding.services import VectorSearchService

                vss = VectorSearchService(self.session)
                results = await vss.semantic_search(
                    query_text=self._semantic_query,
                    infospace_id=self.infospace_id,
                    limit=self._semantic_top_k,
                    asset_kinds=self._kinds if self._kinds else None,
                    bundle_id=self._bundle_id,
                )
                asset_ids = list({r.asset_id for r in results})
                if not asset_ids:
                    return []
                self._conditions.append(Asset.id.in_(asset_ids))
            except Exception as e:
                logger.warning("Semantic search failed: %s", e)

        stmt = self._build_base_select()
        return list(self.session.exec(stmt).all())
