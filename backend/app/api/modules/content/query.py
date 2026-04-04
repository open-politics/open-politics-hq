"""
AssetQuery - Composable SQL query builder for asset search.

Supports:
- Full-text search (websearch_to_tsquery FTS with phrase/negation support)
- Kind filters, facet filters (facets JSONB), fragments containment
- Semantic search (pgvector via subquery)
- Entity search (graph-first with text fallback)
- Annotation value filters (JSONB pushdown with nested path support)
- Date range, bundle scope
- Relevance scoring (ts_rank) and highlights (ts_headline)
- Cursor/offset pagination, composite sort

Also provides from_aql() to compile a ParsedQuery (from aql.py) into an AssetQuery.
"""

from __future__ import annotations

import calendar
import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, or_, column as sa_column, func, text
from sqlmodel import Session, select

from app.api.modules.content.facets import build_facet_filter
from app.api.modules.content.models import Asset, AssetKind, Bundle
from app.api.modules.content.utils.watcher_filters import non_superseded_filter

logger = logging.getLogger(__name__)


class AssetQuery:
    """
    Composable builder for asset queries within an infospace.

    Usage:
        results = (
            AssetQuery(session, infospace_id)
            .text("climate policy")
            .kinds([AssetKind.PDF, AssetKind.WEB])
            .bundle(bundle_id=42)
            .sort("relevance")
            .paginate(cursor=None, limit=25)
            .execute()
        )

    Or via AQL:
        from app.api.modules.content.aql import parse
        aq = AssetQuery.from_aql(session, infospace_id, parse('corruption kind:pdf after:2019'))
    """

    def __init__(self, session: Session, infospace_id: int):
        self.session = session
        self.infospace_id = infospace_id
        self._conditions: List[Any] = [Asset.infospace_id == infospace_id]
        self._semantic_query: Optional[str] = None
        self._semantic_top_k: int = 20
        self._semantic_threshold: Optional[float] = None
        self._semantic_threshold_op: Optional[str] = None
        self._semantic_embedding_service: Optional[Any] = None
        self._text_query: Optional[str] = None
        self._kinds: List[AssetKind] = []
        self._bundle_id: Optional[int] = None
        self._entity_semantic_query: Optional[str] = None
        self._entity_semantic_threshold: Optional[float] = None
        self._entity_semantic_threshold_op: Optional[str] = None
        self._sort: str = "created_at_desc"
        self._cursor: Optional[int] = None
        self._limit: int = 25
        self._offset: int = 0

    # ─── Text search ───

    def text(self, query: str, mode: str = "fts") -> AssetQuery:
        """Add text search. mode='fts' uses websearch_to_tsquery + title ILIKE; 'ilike' fallback."""
        if not query or not query.strip():
            return self
        q = query.strip()
        self._text_query = q
        if mode == "fts":
            try:
                fts_cond = text(
                    "text_search_vector @@ websearch_to_tsquery('english', :q)"
                ).bindparams(q=q)
                # Also match title via ILIKE for assets where text_content may not contain the title
                title_pat = f"%{_strip_fts_operators(q)}%"
                self._conditions.append(or_(fts_cond, Asset.title.ilike(title_pat)))
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

    # ─── Kind filters ───

    def kinds(self, kinds: List[AssetKind]) -> AssetQuery:
        """Filter by asset kinds (OR)."""
        self._kinds = kinds or []
        if self._kinds:
            self._conditions.append(Asset.kind.in_(self._kinds))
        return self

    def exclude_kinds(self, kinds: List[AssetKind]) -> AssetQuery:
        """Exclude asset kinds."""
        if kinds:
            self._conditions.append(Asset.kind.notin_(kinds))
        return self

    # ─── Facets & fragments ───

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

    # ─── Semantic search ───

    def semantic(
        self,
        query_text: str,
        top_k: int = 20,
        threshold: Optional[float] = None,
        threshold_op: Optional[str] = None,
        embedding_service: Optional[Any] = None,
    ) -> AssetQuery:
        """Add semantic similarity filter via pgvector."""
        self._semantic_query = query_text
        self._semantic_top_k = top_k
        self._semantic_threshold = threshold
        self._semantic_threshold_op = threshold_op
        self._semantic_embedding_service = embedding_service
        return self

    # ─── Date range ───

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

    # ─── Scoping ───

    def bundle(self, bundle_id: Optional[int] = None) -> AssetQuery:
        """Scope to a bundle (asset.bundle_ids @> ARRAY[bundle_id])."""
        self._bundle_id = bundle_id
        if bundle_id is not None:
            self._conditions.append(
                text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id)
            )
        return self

    def scope_bundles(self, bundle_ids: tuple[int, ...]) -> AssetQuery:
        """Restrict to assets in any of the given bundles (PackageScope).

        Uses the && (overlap) operator: asset.bundle_ids && scope_bundle_ids.
        """
        if bundle_ids:
            arr = list(bundle_ids)
            self._conditions.append(
                text("bundle_ids && CAST(:scope_ids AS int[])").bindparams(scope_ids=arr)
            )
        return self

    def scope_items(
        self,
        bundle_ids: list[int] | None = None,
        asset_ids: list[int] | None = None,
    ) -> AssetQuery:
        """AQL scope: assets in any of these bundles OR matching these asset IDs (OR)."""
        clauses = []
        if bundle_ids:
            if len(bundle_ids) == 1:
                clauses.append(text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_ids[0]))
            else:
                clauses.append(text("bundle_ids && CAST(:scope_bids AS int[])").bindparams(scope_bids=bundle_ids))
        if asset_ids:
            clauses.append(Asset.id.in_(asset_ids))
        if clauses:
            self._conditions.append(or_(*clauses))
        return self

    def scope(self, package_scope) -> AssetQuery:
        """Apply full visibility predicate from a PackageScope.

        Three OR branches, combined via SQL ``OR``:
        1. Bundle path — GIN overlap on ``bundle_ids``
        2. Direct assets + ancestor chain — PK lookup
        3. Run-derived — semi-join via ``annotation.run_id``

        No-op when *package_scope* is ``None`` (full access).
        """
        if package_scope is None:
            return self  # full access

        from sqlalchemy import or_
        from app.api.modules.annotation.models import Annotation

        clauses = []
        if package_scope.bundle_ids:
            clauses.append(
                text("bundle_ids && CAST(:scope_bids AS int[])").bindparams(
                    scope_bids=list(package_scope.bundle_ids)
                )
            )
        if package_scope.asset_ids:
            clauses.append(Asset.id.in_(package_scope.asset_ids))
        if package_scope.run_ids:
            clauses.append(
                Asset.id.in_(
                    select(Annotation.asset_id)
                    .where(Annotation.run_id.in_(package_scope.run_ids))
                    .where(Annotation.asset_id.isnot(None))
                    .distinct()
                )
            )

        if clauses:
            self._conditions.append(or_(*clauses))
        else:
            # Scope is set but has no grants — no assets are visible
            self._conditions.append(text("FALSE"))
        return self

    def parent_asset(self, parent_asset_id: Optional[int] = None) -> AssetQuery:
        """Filter by parent asset (e.g. for CSV rows)."""
        if parent_asset_id is not None:
            self._conditions.append(Asset.parent_asset_id == parent_asset_id)
        return self

    def top_level_only(self) -> AssetQuery:
        """Only return top-level assets (parent_asset_id IS NULL)."""
        self._conditions.append(Asset.parent_asset_id.is_(None))
        return self

    def children_only(self) -> AssetQuery:
        """Only return child assets (parent_asset_id IS NOT NULL)."""
        self._conditions.append(Asset.parent_asset_id.isnot(None))
        return self

    def user_id(self, user_id: Optional[int] = None) -> AssetQuery:
        """Filter by user who created the asset."""
        if user_id is not None:
            self._conditions.append(Asset.user_id == user_id)
        return self

    def tags(self, values: List[str]) -> AssetQuery:
        """Filter by asset tags (JSON array contains any of the given values)."""
        for tag in values:
            self._conditions.append(
                text("CAST(tags AS jsonb) @> CAST(:tag_val AS jsonb)").bindparams(tag_val=json.dumps([tag]))
            )
        return self

    def exclude_superseded(self) -> AssetQuery:
        """Exclude superseded assets and children of superseded parents."""
        for clause in non_superseded_filter():
            self._conditions.append(clause)
        return self

    # ─── Entity search ───

    def entities(self, name_groups: List[List[str]]) -> AssetQuery:
        """Filter by entities. Each group is OR'd internally, groups are AND'd.

        Uses graph (GraphEdge → EntityCanonical) when available, falls back to text match.
        """
        for group in name_groups:
            if not group:
                continue
            or_clauses = []
            for name in group:
                or_clauses.append(_entity_condition(name, self.infospace_id))
            if len(or_clauses) == 1:
                self._conditions.append(or_clauses[0])
            else:
                self._conditions.append(or_(*or_clauses))
        return self

    def entity_negations(self, names: List[str]) -> AssetQuery:
        """Exclude assets connected to these entities."""
        for name in names:
            cond = _entity_condition(name, self.infospace_id)
            # Wrap in NOT — works for both EXISTS (graph) and text conditions
            self._conditions.append(~cond)
        return self

    def entity_semantic(
        self,
        query_text: str,
        threshold: Optional[float] = None,
        threshold_op: Optional[str] = None,
    ) -> AssetQuery:
        """Find assets connected to entities matching a semantic query.

        Resolved at execution time (async) — embeds query_text and searches
        EntityCanonical embeddings via pgvector, then filters assets via GraphEdge.
        """
        self._entity_semantic_query = query_text
        self._entity_semantic_threshold = threshold
        self._entity_semantic_threshold_op = threshold_op
        return self

    # ─── Annotation value filters ───

    def annotation_value(
        self,
        field: str,
        op: str,
        value: Any,
        run_ids: Optional[List[int]] = None,
        negated: bool = False,
    ) -> AssetQuery:
        """Filter by annotation value via EXISTS subquery.

        Supports nested JSONB paths (dot notation), optional run scoping,
        and smart type detection for comparisons (numeric vs text/date).
        """
        if not re.match(r"^[a-zA-Z0-9_.]+$", field):
            return self

        # Build field accessor — single key uses ->>, nested uses #>>
        parts = field.split('.')
        if len(parts) == 1:
            field_accessor = "annotation.value->>:field_path"
            field_param = field
        else:
            field_accessor = "annotation.value #>> :field_path"
            field_param = '{' + ','.join(parts) + '}'

        # Base EXISTS
        base_parts = [
            "SELECT 1 FROM annotation WHERE annotation.asset_id = asset.id",
        ]
        params: Dict[str, Any] = {"field_path": field_param}

        if run_ids:
            base_parts.append("AND annotation.run_id = ANY(:run_ids)")
            params["run_ids"] = run_ids

        base = " ".join(base_parts) + " AND "

        # Type-aware comparison
        if op == "==":
            expr = f"({field_accessor})::text = :val"
            params["val"] = str(value)
        elif op == "!=":
            negated = True
            expr = f"({field_accessor})::text = :val"
            params["val"] = str(value)
        elif op in (">=", ">", "<=", "<"):
            # Detect type: number → float cast, otherwise text (ISO dates sort lexicographically)
            try:
                params["val"] = float(value)
                expr = f"({field_accessor})::float {op} :val"
            except (ValueError, TypeError):
                params["val"] = str(value)
                expr = f"({field_accessor})::text {op} :val"
        elif op == "contains":
            params["val"] = f"%{value}%"
            expr = f"{field_accessor} ILIKE :val"
        elif op == "exists":
            if len(parts) == 1:
                expr = f"annotation.value ? :field_path"
            else:
                expr = f"({field_accessor}) IS NOT NULL"
            params.pop("val", None)
        elif op == "not_exists":
            negated = True
            if len(parts) == 1:
                expr = f"annotation.value ? :field_path"
            else:
                expr = f"({field_accessor}) IS NOT NULL"
            params.pop("val", None)
        else:
            return self

        exists_sql = f"EXISTS ({base}{expr})"
        if negated:
            exists_sql = f"NOT {exists_sql}"

        self._conditions.append(text(exists_sql).bindparams(**params))
        return self

    # ─── Sorting & pagination ───

    def sort(self, mode: str = "created_at_desc") -> AssetQuery:
        """Set sort order: 'created_at_desc', 'created_at_asc', 'relevance', 'title'."""
        self._sort = mode or "created_at_desc"
        return self

    def paginate(self, cursor: Optional[int] = None, limit: int = 25, max_limit: int = 200) -> AssetQuery:
        """Set cursor (asset id) and limit for pagination."""
        self._cursor = cursor
        self._limit = min(limit or 25, max_limit)
        return self

    def offset(self, offset: int = 0) -> AssetQuery:
        """Set offset for pagination (use with limit for skip/limit)."""
        self._offset = max(0, offset)
        return self

    def unlimited(self) -> AssetQuery:
        """Remove pagination limit. Use for background bulk operations."""
        self._limit = None  # type: ignore
        self._cursor = None
        self._offset = 0
        return self

    # ─── Build & execute ───

    def _apply_sort_and_pagination(self, stmt):
        """Apply ORDER BY, cursor/offset, and LIMIT to a statement."""
        # Use event_timestamp (source publication date) when available, fall back to created_at
        effective_date = func.coalesce(Asset.event_timestamp, Asset.created_at)

        if self._sort == "created_at_desc":
            stmt = stmt.order_by(effective_date.desc())
        elif self._sort == "created_at_asc":
            stmt = stmt.order_by(effective_date.asc())
        elif self._sort == "title":
            stmt = stmt.order_by(Asset.title.asc())
        elif self._sort == "part_index":
            stmt = stmt.order_by(Asset.part_index.asc().nulls_last(), Asset.created_at.asc())
        elif self._sort == "relevance" and self._text_query:
            tsv = sa_column('text_search_vector')
            tsq = func.websearch_to_tsquery('english', self._text_query)
            stmt = stmt.order_by(func.ts_rank(tsv, tsq).desc())
        else:
            stmt = stmt.order_by(effective_date.desc())

        if self._cursor is not None:
            if self._sort in ("created_at_desc", "relevance"):
                stmt = stmt.where(Asset.id < self._cursor)
            elif self._sort == "created_at_asc":
                stmt = stmt.where(Asset.id > self._cursor)

        if self._offset > 0:
            stmt = stmt.offset(self._offset)

        if self._limit is not None:
            stmt = stmt.limit(self._limit)
        return stmt

    def _build_base_select(self):
        """Build base select with all conditions."""
        stmt = select(Asset).where(and_(*self._conditions))
        return self._apply_sort_and_pagination(stmt)

    def count(self) -> int:
        """Return total count matching the current conditions (ignores limit/offset/cursor)."""
        stmt = select(func.count(Asset.id)).where(and_(*self._conditions))
        return self.session.exec(stmt).one() or 0

    def count_by_parent(self) -> dict[int, int]:
        """Return {parent_asset_id: count} for matching children.

        Cheap GROUP BY on indexed columns — no row fetch.
        Ignores limit/offset/cursor.
        """
        stmt = (
            select(Asset.parent_asset_id, func.count(Asset.id))
            .where(and_(*self._conditions))
            .group_by(Asset.parent_asset_id)
        )
        return {pid: cnt for pid, cnt in self.session.exec(stmt).all() if pid is not None}

    def execute(self) -> List[Asset]:
        """Execute and return list of Asset."""
        stmt = self._build_base_select()
        return list(self.session.exec(stmt).all())

    def execute_scored(self) -> List[Tuple[Asset, Optional[float], Optional[str]]]:
        """Execute returning (asset, rank, headline) tuples.

        When FTS is active, includes ts_rank score and ts_headline snippet.
        Otherwise rank and headline are None.
        """
        if self._text_query:
            tsv = sa_column('text_search_vector')
            tsq = func.websearch_to_tsquery('english', self._text_query)
            rank_col = func.ts_rank(tsv, tsq).label('rank')
            headline_col = func.ts_headline(
                'english',
                func.coalesce(Asset.text_content, ''),
                tsq,
                'MaxFragments=3,MaxWords=35,StartSel=<mark>,StopSel=</mark>',
            ).label('headline')

            stmt = select(Asset, rank_col, headline_col).where(and_(*self._conditions))
            stmt = self._apply_sort_and_pagination(stmt)
            rows = list(self.session.exec(stmt).all())
            return [(row[0], float(row[1]), row[2]) for row in rows]
        else:
            return [(a, None, None) for a in self.execute()]

    async def execute_async(self) -> List[Asset]:
        """Execute with async semantic search when semantic() was used."""
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

    async def execute_scored_async(self) -> List[Tuple[Asset, Optional[float], Optional[str]]]:
        """Execute with semantic/entity-semantic search support, returning (asset, rank, headline) tuples."""
        semantic_scores: Dict[int, float] = {}

        # ── Entity semantic: embed query → search EntityCanonical → filter via GraphEdge ──
        if self._entity_semantic_query:
            try:
                await self._resolve_entity_semantic()
            except Exception as e:
                logger.warning("Entity semantic search failed: %s", e)

        # ── Asset semantic: embed query → search AssetChunk via pgvector ──
        if self._semantic_query:
            try:
                from app.api.modules.embedding.services import VectorSearchService

                # Convert similarity threshold → distance threshold for cosine
                dist_threshold = None
                if self._semantic_threshold is not None and self._semantic_threshold_op in ('>', '>='):
                    dist_threshold = 1.0 - self._semantic_threshold

                vss = VectorSearchService(self.session)
                results = await vss.semantic_search(
                    query_text=self._semantic_query,
                    infospace_id=self.infospace_id,
                    limit=self._semantic_top_k,
                    asset_kinds=self._kinds if self._kinds else None,
                    bundle_id=self._bundle_id,
                    distance_threshold=dist_threshold,
                )

                # For < / <= threshold, post-filter: keep only results below threshold
                if self._semantic_threshold is not None and self._semantic_threshold_op in ('<', '<='):
                    max_sim = self._semantic_threshold
                    results = [r for r in results if r.similarity < max_sim]

                # Capture similarity scores per asset (best chunk wins)
                for r in results:
                    semantic_scores[r.asset_id] = max(semantic_scores.get(r.asset_id, 0), r.similarity)

                asset_ids = list(semantic_scores.keys())
                if not asset_ids:
                    return []
                self._conditions.append(Asset.id.in_(asset_ids))
            except Exception as e:
                logger.warning("Semantic search failed: %s", e)

        rows = self.execute_scored()

        # Merge semantic similarity into scores
        if semantic_scores:
            merged = []
            for asset, fts_rank, highlight in rows:
                sem = semantic_scores.get(asset.id)
                if fts_rank is not None and sem is not None:
                    # Hybrid: blend FTS rank + semantic similarity
                    merged.append((asset, fts_rank * 0.4 + sem * 0.6, highlight))
                elif sem is not None:
                    # Pure semantic — use similarity as score
                    merged.append((asset, sem, highlight))
                else:
                    merged.append((asset, fts_rank, highlight))
            # Re-sort by merged score when sorting by relevance
            if self._sort == "relevance":
                merged.sort(key=lambda t: t[1] or 0, reverse=True)
            return merged

        return rows

    async def _resolve_entity_semantic(self) -> None:
        """Embed entity query text, search EntityCanonical embeddings, filter assets via GraphEdge."""
        from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS
        from app.api.modules.embedding.services import EmbeddingService
        from app.api.modules.identity_infospace_user.models import Infospace

        infospace = self.session.get(Infospace, self.infospace_id)
        if not infospace or not infospace.embedding_configured:
            logger.debug("Entity semantic: no embedding configured for infospace %s", self.infospace_id)
            return

        sel = infospace.get_embedding_selection()
        embedding_service = EmbeddingService(self.session)

        emb_result = await embedding_service.generate_embeddings_for_chunks(
            chunks=[self._entity_semantic_query],
            model_name=sel.model_name,
            provider=sel.provider_key,
        )
        if not emb_result or not emb_result[0].get('embedding'):
            return

        raw_embedding = emb_result[0]['embedding']
        dim = len(raw_embedding)
        if dim not in EMBEDDING_SUPPORTED_DIMS:
            return

        col_name = f"embedding_{dim}"
        vec_str = "[" + ",".join(str(x) for x in raw_embedding) + "]"
        threshold = self._entity_semantic_threshold or 0.6
        dist_threshold = 1.0 - threshold

        # Find assets connected to semantically-matched entities
        sql = text(f"""
            SELECT DISTINCT a.id
            FROM asset a
            JOIN annotation ann ON ann.asset_id = a.id
            JOIN graphedge ge ON ge.annotation_id = ann.id
            JOIN entitycanonical ec ON (ge.subject_entity_id = ec.id OR ge.object_entity_id = ec.id)
            WHERE ge.infospace_id = :iid
              AND ec.{col_name} IS NOT NULL
              AND (ec.{col_name} <=> :vec::vector) <= :dist_thresh
        """)
        rows = self.session.execute(sql, {
            "iid": self.infospace_id,
            "vec": vec_str,
            "dist_thresh": dist_threshold,
        }).all()

        asset_ids = [row[0] for row in rows]
        if asset_ids:
            self._conditions.append(Asset.id.in_(asset_ids))
        else:
            # No matching entities — force empty result set
            self._conditions.append(text("FALSE"))

    # ─── AQL bridge ───

    @classmethod
    def from_aql(
        cls,
        session: Session,
        infospace_id: int,
        parsed: "ParsedQuery",
        parent_asset_id: Optional[int] = None,
    ) -> AssetQuery:
        """Build an AssetQuery from a ParsedQuery (AQL parse result)."""
        from app.api.modules.content.query_parser import ParsedQuery  # noqa: F811

        q = cls(session, infospace_id)

        if parsed.text:
            q.text(parsed.text, mode="fts")

        if parsed.semantic:
            q.semantic(
                parsed.semantic.text,
                top_k=200 if parsed.has_text else 50,
                threshold=parsed.semantic.threshold,
                threshold_op=parsed.semantic.threshold_op,
            )

        if parsed.kinds:
            q.kinds([AssetKind(k) for k in parsed.kinds])

        if parsed.excluded_kinds:
            q.exclude_kinds([AssetKind(k) for k in parsed.excluded_kinds])

        if parsed.date_after or parsed.date_before:
            q.date_range(
                after=_parse_date(parsed.date_after, end=False),
                before=_parse_date(parsed.date_before, end=True),
            )

        # Scope: bundles + assets combined with OR
        if parsed.bundle_refs or parsed.asset_refs:
            bundle_ids = _resolve_bundle_ids(session, infospace_id, parsed.bundle_refs)
            asset_ids = _resolve_asset_ids(session, infospace_id, parsed.asset_refs)
            q.scope_items(bundle_ids=bundle_ids or None, asset_ids=asset_ids or None)

        if parsed.entities:
            q.entities(parsed.entities)

        if parsed.entity_negations:
            q.entity_negations(parsed.entity_negations)

        if parsed.entity_semantic:
            q.entity_semantic(
                parsed.entity_semantic.text,
                threshold=parsed.entity_semantic.threshold,
                threshold_op=parsed.entity_semantic.threshold_op,
            )

        if parsed.tags:
            q.tags(parsed.tags)

        for af in parsed.annotations:
            q.annotation_value(
                field=af.field,
                op=af.op,
                value=af.value,
                run_ids=parsed.run_ids or None,
                negated=af.negated,
            )

        # Explicit parent_asset_id param (from query endpoint)
        if parent_asset_id is not None:
            q.parent_asset(parent_asset_id)

        q.exclude_superseded()
        # Only restrict to top-level when not scoping to specific assets
        if not parsed.asset_refs and parent_asset_id is None:
            q.top_level_only()

        return q


# ─── Helpers ───

def _strip_fts_operators(q: str) -> str:
    """Strip FTS operators (-, or, quotes) to get a plain string for ILIKE title matching."""
    return re.sub(r'["\-]', '', q).replace(' or ', ' ').strip()


def _entity_condition(name: str, infospace_id: int):
    """Build a condition matching assets connected to an entity (graph OR text fallback)."""
    graph_exists = text("""
        EXISTS (
            SELECT 1 FROM graphedge ge
            JOIN annotation ann ON ge.annotation_id = ann.id
            JOIN entitycanonical ec ON (ge.subject_entity_id = ec.id OR ge.object_entity_id = ec.id)
            WHERE ann.asset_id = asset.id
            AND ge.infospace_id = :iid
            AND (
                lower(ec.canonical_name) = lower(:ename)
                OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(ec.aliases::jsonb) alias_val
                    WHERE lower(alias_val) = lower(:ename)
                )
            )
        )
    """).bindparams(iid=infospace_id, ename=name)

    text_fallback = or_(
        Asset.title.ilike(f"%{name}%"),
        (Asset.text_content.isnot(None)) & (Asset.text_content.ilike(f"%{name}%")),
    )

    return or_(graph_exists, text_fallback)


def _parse_date(s: Optional[str], end: bool = False) -> Optional[datetime]:
    """Parse partial ISO date. end=True fills to end of period (Dec 31 / last day)."""
    if not s:
        return None
    parts = s.split('-')
    try:
        year = int(parts[0])
        month = int(parts[1]) if len(parts) > 1 else (12 if end else 1)
        if len(parts) > 2:
            day = int(parts[2])
        else:
            day = calendar.monthrange(year, month)[1] if end else 1
        day = min(day, calendar.monthrange(year, month)[1])
        return datetime(year, month, day)
    except (ValueError, IndexError):
        return None


def _resolve_bundle_ids(session: Session, infospace_id: int, refs: list[str]) -> list[int]:
    """Resolve bundle references (names or IDs) to numeric IDs."""
    ids: list[int] = []
    for ref in refs:
        try:
            ids.append(int(ref))
            continue
        except ValueError:
            pass
        bundle = session.exec(
            select(Bundle).where(Bundle.infospace_id == infospace_id, Bundle.name == ref)
        ).first()
        if bundle:
            ids.append(bundle.id)
    return ids


def _resolve_asset_ids(session: Session, infospace_id: int, refs: list[str]) -> list[int]:
    """Resolve asset references (titles or IDs) to numeric IDs."""
    ids: list[int] = []
    for ref in refs:
        try:
            ids.append(int(ref))
            continue
        except ValueError:
            pass
        asset = session.exec(
            select(Asset).where(Asset.infospace_id == infospace_id, Asset.title == ref)
        ).first()
        if asset:
            ids.append(asset.id)
    return ids
