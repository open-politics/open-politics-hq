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

Also provides from_aql() to compile a ParsedQuery (from parse(), below) into an AssetQuery.
"""

from __future__ import annotations

import calendar
import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional, Tuple

from sqlalchemy import and_, bindparam, case, or_, column as sa_column, func, text
from sqlmodel import Session, select

from app.api.modules.content.facets import build_facet_filter
from app.api.modules.content.models import Asset, AssetKind, Bundle
from app.api.modules.content.utils.watcher_filters import non_superseded_filter
from app.api.modules.content.schemas import AnnotationFilter, ParsedQuery, SemanticClause

logger = logging.getLogger(__name__)


def _u(sql: str, **params):
    """A raw ``text()`` clause whose binds are unique — safe to repeat or OR together.

    Every ``:name`` in *sql* binds to a uniquely-renamed compiled param, so the same
    clause type can appear in multiple positions of one statement — the OR groups of
    a compound query, or a ``tag:a,b`` loop — without two clauses colliding on a
    shared bind name (a collision silently collapses both to one value). Placeholders
    repeated *within* a single clause still share their value. This is what makes a
    condition genuinely composable, so ``_where()`` can AND/OR it freely.
    """
    return text(sql).bindparams(*[bindparam(k, value=v, unique=True) for k, v in params.items()])


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
            .rows()            # or .assets() / .count() / .containers()
        )

    Or via AQL:
        from app.api.modules.content.query import parse
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
        self._text_query: Optional[str] = None
        self._kinds: List[AssetKind] = []
        self._bundle_id: Optional[int] = None
        self._entity_semantic_query: Optional[str] = None
        self._entity_semantic_threshold: Optional[float] = None
        self._entity_semantic_threshold_op: Optional[str] = None
        self._sort: str = "created_at_desc"
        self._cursor: Optional[int] = None
        self._cursor_value: Any = None  # last row's sort-column value (keyset pagination)
        self._limit: int = 25
        self._offset: int = 0
        # Deferred (async) clauses — semantic / entity-semantic — resolve to plain
        # id-set conditions + a per-asset score map via resolve(). Kept here so
        # every read path (assets, rows, count, containers) sees the same resolved
        # predicate. See resolve().
        self._semantic_scores: Dict[int, float] = {}
        self._deferred_resolved: bool = False
        # Compound OR — DNF sub-queries, one per top-level OR group. Empty for a
        # simple query. _where() ORs them; resolve() resolves each. See from_aql.
        self._groups: List["AssetQuery"] = []
        # Subtree-expanded bundle/asset scope to pre-filter the semantic vector
        # search by. Set by from_aql / search hints; passed to search_by_text in
        # resolve() so a bundle-scoped ~semantic search keeps recall inside the scope
        # (the pre-filter is applied in SQL, not as a post-filter that starves top-k).
        self._semantic_scope = None

    # ─── Text search ───

    def text(self, query: str, mode: str = "fts") -> AssetQuery:
        """Add text search. mode='fts' uses websearch_to_tsquery + title ILIKE; 'ilike' fallback."""
        if not query or not query.strip():
            return self
        q = query.strip()
        self._text_query = q
        if mode == "fts":
            try:
                fts_cond = _u(
                    "text_search_vector @@ websearch_to_tsquery('english', :q)", q=q
                )
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
                _u("metadata @> :facets::jsonb", facets=json.dumps(facet_filter))
            )
        if quality_score_gte is not None:
            self._conditions.append(
                _u("(metadata->>'quality_score')::float >= :quality_gte", quality_gte=quality_score_gte)
            )
        if quality_score_lte is not None:
            self._conditions.append(
                _u("(metadata->>'quality_score')::float <= :quality_lte", quality_lte=quality_score_lte)
            )
        return self

    def fragments_contain(self, fragment_filter: Dict[str, Any]) -> AssetQuery:
        """Filter assets whose fragments JSONB contain the given structure."""
        if fragment_filter:
            self._conditions.append(
                _u("fragments @> :frag::jsonb", frag=json.dumps(fragment_filter))
            )
        return self

    # ─── Semantic search ───

    def semantic(
        self,
        query_text: str,
        top_k: int = 20,
        threshold: Optional[float] = None,
        threshold_op: Optional[str] = None,
    ) -> AssetQuery:
        """Add semantic similarity filter via pgvector.

        Credentials follow the infospace owner (ROADMAP invariant #6) — no BYOK
        at this layer. Call `similarity.search_by_text` directly if runtime_key
        is needed.
        """
        self._semantic_query = query_text
        self._semantic_top_k = top_k
        self._semantic_threshold = threshold
        self._semantic_threshold_op = threshold_op
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
                _u("bundle_ids @> ARRAY[:bid]::int[]", bid=bundle_id)
            )
        return self

    def ids(self, asset_ids: List[int]) -> AssetQuery:
        """Filter to specific asset IDs. Enables drill-down from AnnotationQuery.results()."""
        if asset_ids:
            self._conditions.append(Asset.id.in_(asset_ids))
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
                _u("bundle_ids && CAST(:scope_bids AS int[])", scope_bids=list(package_scope.bundle_ids))
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

    def no_bundles(self) -> AssetQuery:
        """Only return assets that are not in any real bundle.

        Uses the ROOT=0 sentinel convention from ``content/tree.py``: every
        asset's ``bundle_ids`` array is non-empty, with ``0`` meaning "at
        root" and any positive id meaning "in that bundle". An asset is
        unbundled iff its array contains only zeros — i.e. it is a subset
        of ``{0}``. This is what the tree root listing wants, so that an
        asset inside a bundle doesn't also appear as a top-level sibling.
        """
        self._conditions.append(
            text("bundle_ids <@ ARRAY[0]::int[]")
        )
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
                _u("CAST(tags AS jsonb) @> CAST(:tag_val AS jsonb)", tag_val=json.dumps([tag]))
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

        Uses graph (GraphEdge → Entity) when available, falls back to text match.
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
        Entity embeddings via pgvector, then filters assets via GraphEdge.
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

        Uses shared JSONB accessor from core/filters.py.
        """
        from app.core.filters import jsonb_accessor as _jsonb_acc

        if not re.match(r"^[a-zA-Z0-9_.]+$", field):
            return self

        field_accessor, params = _jsonb_acc("annotation.value", field)
        parts = field.split(".")

        # Base EXISTS
        base_parts = [
            "SELECT 1 FROM annotation WHERE annotation.asset_id = asset.id",
        ]

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

        self._conditions.append(_u(exists_sql, **params))
        return self

    # ─── Sorting & pagination ───

    def sort(self, mode: str = "created_at_desc") -> AssetQuery:
        """Set sort order: 'created_at_desc', 'created_at_asc', 'relevance', 'title'."""
        self._sort = mode or "created_at_desc"
        return self

    def paginate(
        self,
        cursor: str | int | None = None,
        limit: int = 25,
        max_limit: int = 200,
    ) -> AssetQuery:
        """Set cursor and limit for pagination.

        Accepts the opaque ``core.cursor`` encoded string (preferred), a raw
        ``int`` asset id (legacy), or ``None``. The primitive decodes
        internally; callers never parse.
        """
        if cursor is None:
            self._cursor = None
            self._cursor_value = None
        elif isinstance(cursor, int):
            self._cursor = cursor
            self._cursor_value = None  # legacy id-only cursor → id keyset fallback
        else:
            try:
                from app.core.cursor import decode_cursor
                _f, _d, last_value, last_id = decode_cursor(cursor)
                self._cursor = last_id
                self._cursor_value = last_value
            except Exception:
                try:
                    self._cursor = int(cursor)
                    self._cursor_value = None
                except ValueError:
                    self._cursor = None
                    self._cursor_value = None
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

    def _relevance_rank(self):
        """Combined FTS relevance expression: title (weighted) + content + substring boost.

        ``text_search_vector`` is a generated column over ``text_content`` ONLY, so
        ``ts_rank`` on it alone scores a direct title match near zero and buries it
        under content hits. We add:
          * the title's own ``ts_rank`` (word/stem matches, ranked by quality), and
          * a substring boost (catches filenames / partial words ``tsquery`` can't
            tokenize — the same ILIKE that lets the row match in ``.text()``),
        each weighted so a title match outranks a content-only match.

        Single source of truth: used by both the ORDER BY and the returned score,
        so the hybrid-merge re-sort (the rows() merge) stays consistent.
        """
        tsq = func.websearch_to_tsquery('english', self._text_query)
        content_rank = func.ts_rank(sa_column('text_search_vector'), tsq)
        title_rank = func.ts_rank(
            func.to_tsvector('english', func.coalesce(Asset.title, '')), tsq
        )
        rank = content_rank + (title_rank * 2.0)
        # Substring boost for matches tsquery can't tokenize (filenames, partials).
        plain = _strip_fts_operators(self._text_query).strip()
        if plain:
            rank = rank + case((Asset.title.ilike(f"%{plain}%"), 2.0), else_=0.0)
        return rank

    def _apply_sort_and_pagination(self, stmt):
        """Apply ORDER BY, keyset cursor, offset, and LIMIT.

        Pagination is a true keyset: ``ORDER BY <sort_col> <dir>, id <dir>`` and the
        cursor seeks past the last row with ``WHERE (sort_col, id) <dir> (last_value,
        last_id)``. Because the id tiebreaker shares the sort column's direction and
        the cursor carries the column's *actual* value, Load-more is exact — no
        overlap/skip — and index-friendly on a composite ``(sort_col, id)`` index.
        Holds for every stored-column sort: date (the feed/tree default), title,
        part_index.

        Relevance is the one exception: its sort key is a per-query computed rank
        (ts_rank + title boost + ilike boost), not stored and not carried in the
        cursor, so it stays an id-tiebreaker approximation — shallow paging is an
        accepted ceiling (the search path has the frontend merge-by-id safety net).
        """
        effective_date = func.coalesce(Asset.event_timestamp, Asset.created_at)

        # Relevance — rank-ordered, not keyset-able by a stored column.
        if self._sort == "relevance" and self._text_query:
            stmt = stmt.order_by(self._relevance_rank().desc(), Asset.id.desc())
            if self._cursor is not None:
                stmt = stmt.where(Asset.id < self._cursor)
            if self._offset > 0:
                stmt = stmt.offset(self._offset)
            if self._limit is not None:
                stmt = stmt.limit(self._limit)
            return stmt

        # Stored-column sorts → real keyset on (sort_col, id).
        if self._sort == "title":
            sort_col, ascending = Asset.title, True
        elif self._sort == "part_index":
            sort_col, ascending = Asset.part_index, True
        elif self._sort == "created_at_asc":
            sort_col, ascending = effective_date, True
        else:  # created_at_desc + unknown fallback
            sort_col, ascending = effective_date, False

        if ascending:
            stmt = stmt.order_by(sort_col.asc().nulls_last(), Asset.id.asc())
        else:
            stmt = stmt.order_by(sort_col.desc().nulls_last(), Asset.id.desc())

        if self._cursor is not None:
            value = self._coerce_cursor_value(self._cursor_value)
            if value is None:
                # Legacy id-only cursor (or unparseable value) → id keyset fallback.
                stmt = stmt.where(Asset.id > self._cursor if ascending else Asset.id < self._cursor)
            elif ascending:
                stmt = stmt.where(or_(sort_col > value, and_(sort_col == value, Asset.id > self._cursor)))
            else:
                stmt = stmt.where(or_(sort_col < value, and_(sort_col == value, Asset.id < self._cursor)))

        if self._offset > 0:
            stmt = stmt.offset(self._offset)

        if self._limit is not None:
            stmt = stmt.limit(self._limit)
        return stmt

    def _coerce_cursor_value(self, value):
        """Coerce a decoded cursor value to the active sort column's type.

        Date sorts compare against ``coalesce(event_timestamp, created_at)`` — the
        cursor carries an ISO string, parsed back to ``datetime`` so Postgres
        compares timestamp-to-timestamp. title/part_index values are used as-is.
        """
        if value is None:
            return None
        if self._sort not in ("title", "part_index"):
            # Date-typed column (effective_date) — cursor carries an ISO string.
            if isinstance(value, str):
                try:
                    return datetime.fromisoformat(value)
                except ValueError:
                    return None
            return value
        return value

    def _where(self):
        """The effective WHERE predicate — the single accessor every read uses.

        Simple query: ``AND`` of the accumulated ``_conditions``. Compound (OR):
        ``and_(shared, or_(group_1, … group_n))`` — the shared invariants plus any
        caller refinements (access scope, structural bundle/no_bundles, hint
        filters, sort/paginate) AND across a union of the per-group predicates.
        Every read (assets/rows/stream/count/containers) goes through here, so
        compound support landed in one place. Centralizes what used to be
        ``and_(*self._conditions)`` copy-pasted across five reads.
        """
        base = and_(*self._conditions)
        if self._groups:
            return and_(base, or_(*(g._where() for g in self._groups)))
        return base

    def _build_base_select(self):
        """Build base select with all conditions."""
        stmt = select(Asset).where(self._where())
        return self._apply_sort_and_pagination(stmt)

    def count(self, cap: int | None = None) -> int:
        """Count matching rows (ignores limit/offset/cursor).

        ``cap=None`` → exact full count (the content-explorer / detailed total,
        streamed to a later stage since it can be O(matches)). ``cap=N`` → a
        bounded count: stop scanning after N+1 matches and return ``min(actual,
        N+1)`` — a result > N means "more than N" (render as ``N+``). O(N) instead
        of O(matches), so it stays cheap even on a folder holding tens of
        thousands of assets. Same predicates either way — one primitive, two
        cost profiles.
        """
        if cap is None:
            stmt = select(func.count(Asset.id)).where(self._where())
            return self.session.exec(stmt).one() or 0
        inner = select(Asset.id).where(self._where()).limit(cap + 1)
        stmt = select(func.count()).select_from(inner.subquery())
        return self.session.exec(stmt).one() or 0

    def containers(self) -> set[int]:
        """Distinct real bundle ids across the matching assets — "which folders the
        results live in" (ignores limit/offset).

        Aggregate sibling of ``count``: where ``count`` answers "how many results",
        this answers "where do they live". The leaf bundles whose ancestor chain
        forms the search-tree skeleton (see ``views._skeleton``). ROOT sentinel
        ``0`` (unbundled) dropped. Call after ``resolve`` so a ``~semantic`` clause
        is already a condition.
        """
        stmt = select(func.unnest(Asset.bundle_ids)).where(self._where()).distinct()
        return {b for b in self.session.exec(stmt).all() if b and b != 0}

    def assets(self) -> List[Asset]:
        """The matching assets, no scores. Call ``resolve`` first if the query carries semantic."""
        return list(self.session.exec(self._build_base_select()).all())

    def _scored_select(self):
        """Build the (Asset, rank, headline) select for FTS, sorted + paginated."""
        tsq = func.websearch_to_tsquery('english', self._text_query)
        rank_col = self._relevance_rank().label('rank')
        headline_col = func.ts_headline(
            'english',
            func.coalesce(Asset.text_content, ''),
            tsq,
            'MaxFragments=3,MaxWords=35,StartSel=<mark>,StopSel=</mark>',
        ).label('headline')
        stmt = select(Asset, rank_col, headline_col).where(self._where())
        return self._apply_sort_and_pagination(stmt)

    def rows(self) -> List[Tuple[Asset, Optional[float], Optional[str]]]:
        """The current page as (asset, score, snippet) — materialized.

        ``score`` is the FTS ``ts_rank`` (with a ``ts_headline`` snippet) for text
        queries, ``None`` for pure filters. When ``resolve`` has populated
        ``_semantic_scores``, the semantic/hybrid blend is merged in (and re-sorted
        for relevance). Call ``resolve`` first if the query carries a ``~semantic``
        clause. Folds the old ``execute_scored`` + ``execute_scored_async``.
        """
        if self._text_query:
            raw = list(self.session.exec(self._scored_select()).all())
            result: List[Tuple[Asset, Optional[float], Optional[str]]] = [
                (row[0], float(row[1]), row[2]) for row in raw
            ]
        else:
            result = [(a, None, None) for a in self.assets()]

        if not self._semantic_scores:
            return result

        # Blend FTS rank + semantic similarity (hybrid), or similarity alone.
        merged: List[Tuple[Asset, Optional[float], Optional[str]]] = []
        for asset, fts_rank, highlight in result:
            sem = self._semantic_scores.get(asset.id)
            if fts_rank is not None and sem is not None:
                merged.append((asset, fts_rank * 0.4 + sem * 0.6, highlight))
            elif sem is not None:
                merged.append((asset, sem, highlight))
            else:
                merged.append((asset, fts_rank, highlight))
        if self._sort == "relevance":
            merged.sort(key=lambda t: t[1] or 0, reverse=True)
        return merged

    def stream(
        self, batch_size: int = 5
    ) -> Iterator[List[Tuple[Asset, Optional[float], Optional[str]]]]:
        """Yield (asset, rank, headline) in small batches off a server-side cursor.

        Text/filter only — semantic & hybrid need the whole set to merge and
        re-sort scores, so those callers use ``rows`` (after ``resolve``). With
        ``stream_results`` Postgres hands rows back (and runs ``ts_headline`` per
        row) incrementally once the ORDER BY is resolved, so the UI fills in
        progressively instead of waiting for the entire page to materialise.
        """
        if self._text_query:
            stmt = self._scored_select()
            scored = True
        else:
            stmt = self._build_base_select()
            scored = False

        result = self.session.exec(stmt.execution_options(stream_results=True, yield_per=batch_size))
        batch: List[Tuple[Asset, Optional[float], Optional[str]]] = []
        for row in result:
            if scored:
                batch.append((row[0], float(row[1]), row[2]))
            else:
                batch.append((row, None, None))
            if len(batch) >= batch_size:
                yield batch
                batch = []
        if batch:
            yield batch

    async def resolve(self) -> None:
        """Resolve the deferred (async) clauses — ``semantic`` and ``entity_semantic``
        — into plain WHERE conditions on ``_conditions``, capturing per-asset
        semantic scores in ``_semantic_scores``.

        This is the seam that lets semantic compose like any other clause: after it
        runs, ``_conditions`` is pure SQL, so the same predicate is OR-able (compound
        queries), countable (``count``), and tree-aggregatable (``containers``).
        Idempotent — the embed+pgvector work happens once. It is the ONE async step:
        callers with a ``~semantic`` clause (views' ``flat``/``tree``, ``_skeleton``,
        MCP, bundle_populate) ``await resolve()`` before a sync read; pure text/filter
        callers never need it.
        """
        if self._deferred_resolved:
            return
        self._deferred_resolved = True

        # Compound (OR): resolve each group's deferred clauses into its own
        # conditions, then merge the per-asset semantic scores up (best wins) so
        # rows() can blend a hybrid rank across the union.
        if self._groups:
            for g in self._groups:
                await g.resolve()
                for aid, s in g._semantic_scores.items():
                    self._semantic_scores[aid] = max(self._semantic_scores.get(aid, 0.0), s)
            return

        # ── Entity semantic: embed query → search Entity → filter via GraphEdge ──
        if self._entity_semantic_query:
            try:
                await self._resolve_entity_semantic()
            except Exception as e:
                logger.warning("Entity semantic search failed: %s", e)

        # ── Asset semantic: embed query → search AssetChunk via pgvector ──
        if self._semantic_query:
            try:
                from app.api.modules.embedding.similarity import search_by_text

                # Convert similarity threshold → distance threshold for cosine
                dist_threshold = None
                if self._semantic_threshold is not None and self._semantic_threshold_op in ('>', '>='):
                    dist_threshold = 1.0 - self._semantic_threshold

                hits = await search_by_text(
                    self.session, self.infospace_id, self._semantic_query,
                    limit=self._semantic_top_k,
                    asset_kinds=self._kinds if self._kinds else None,
                    bundle_id=self._bundle_id,
                    scope=self._semantic_scope,
                    distance_threshold=dist_threshold,
                )

                # For < / <= threshold, post-filter: keep only results below threshold
                if self._semantic_threshold is not None and self._semantic_threshold_op in ('<', '<='):
                    max_sim = self._semantic_threshold
                    hits = [h for h in hits if h.similarity < max_sim]

                # Capture similarity scores per asset (best chunk wins)
                for h in hits:
                    self._semantic_scores[h.asset_id] = max(self._semantic_scores.get(h.asset_id, 0), h.similarity)

                asset_ids = list(self._semantic_scores.keys())
                # No semantic hits → the clause matched nothing. Force empty rather
                # than short-circuit so count / containers stay consistent.
                self._conditions.append(Asset.id.in_(asset_ids) if asset_ids else text("FALSE"))
            except Exception as e:
                logger.warning("Semantic search failed: %s", e)

    async def _resolve_entity_semantic(self) -> None:
        """Embed entity query text, search Entity embeddings, filter assets via GraphEdge."""
        from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS
        from app.api.modules.embedding.embed import embed_texts
        from app.api.modules.foundation_service_providers import get_configured_foundation_provider

        sel = get_configured_foundation_provider(self.session, self.infospace_id, "embedding")
        if not sel or not sel.model_name:
            logger.debug("Entity semantic: no embedding configured for infospace %s", self.infospace_id)
            return

        vectors, em = await embed_texts(
            self.session, self.infospace_id, [self._entity_semantic_query],
        )
        if not vectors:
            return

        raw_embedding = vectors[0]
        dim = em.dimension
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
            JOIN canon_entry ec ON (ge.source_entry_id = ec.id OR ge.target_entry_id = ec.id)
            WHERE ge.infospace_id = :iid
              AND ec.{col_name} IS NOT NULL
              AND (ec.{col_name} <=> CAST(:vec AS vector)) <= :dist_thresh
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
        """Build an AssetQuery from a ParsedQuery (AQL parse result).

        A compound (top-level ``OR``) parse dispatches to ``_from_aql_compound``,
        which compiles each group through this same method (single-group fast
        path) and unions them. A simple parse builds the flat query below.
        """
        if parsed.groups:
            return cls._from_aql_compound(session, infospace_id, parsed, parent_asset_id)

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

        # Scope: bundles + assets combined with OR (same semantics as PackageScope).
        # A ``bundle:`` ref includes its whole subtree — selecting a folder searches
        # everything under it, not just its direct members. This matches how access
        # grants expand (``access.py`` runs the same ``subtree_ids``) and how the
        # result-tree skeleton (``participating_bundles``) already clamps.
        if parsed.bundle_refs or parsed.asset_refs:
            from app.api.modules.identity_infospace_user.access import PackageScope
            from app.api.modules.content.tree import subtree_ids
            bundle_ids = _resolve_bundle_ids(session, infospace_id, parsed.bundle_refs)
            if bundle_ids:
                bundle_ids = list(subtree_ids(session, set(bundle_ids)))
            asset_ids = _resolve_asset_ids(session, infospace_id, parsed.asset_refs)
            scope = PackageScope(
                bundle_ids=tuple(bundle_ids or ()),
                asset_ids=tuple(asset_ids or ()),
            )
            q.scope(scope)
            q._semantic_scope = scope  # same scope pre-filters a ~semantic clause

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

    @classmethod
    def _from_aql_compound(
        cls,
        session: Session,
        infospace_id: int,
        parsed: "ParsedQuery",
        parent_asset_id: Optional[int] = None,
    ) -> AssetQuery:
        """Compile a compound (OR) ParsedQuery into a union query.

        Each top-level OR group is compiled by ``from_aql`` itself — the group has
        no nested groups, so it takes the single-group fast path and comes back a
        self-contained, superseded-excluded, per-group-top-level sub-query (a group
        scoping ``asset:`` drills in; its siblings stay top-level — the same rule a
        simple query follows). The parent holds only the infospace clamp plus
        whatever refinements callers append (``.scope(access)``, ``.no_bundles()``,
        ``.bundle(N)``, hint filters, sort/paginate); ``_where`` ANDs those across
        ``or_(groups)`` and ``resolve`` resolves each group.
        """
        q = cls(session, infospace_id)
        q._groups = [
            cls.from_aql(session, infospace_id, g, parent_asset_id=parent_asset_id)
            for g in parsed.groups
        ]
        return q


# ─── Helpers ───

def _strip_fts_operators(q: str) -> str:
    """Strip FTS operators (-, or, quotes) to get a plain string for ILIKE title matching."""
    return re.sub(r'["\-]', '', q).replace(' or ', ' ').strip()


def _entity_condition(name: str, infospace_id: int):
    """Build a condition matching assets connected to an entity (graph OR text fallback)."""
    graph_exists = _u("""
        EXISTS (
            SELECT 1 FROM graphedge ge
            JOIN annotation ann ON ge.annotation_id = ann.id
            JOIN canon_entry ec ON (ge.source_entry_id = ec.id OR ge.target_entry_id = ec.id)
            WHERE ann.asset_id = asset.id
            AND ge.infospace_id = :iid
            AND (
                lower(ec.canonical) = lower(:ename)
                OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(ec.aliases::jsonb) alias_val
                    WHERE lower(alias_val) = lower(:ename)
                )
            )
        )
    """, iid=infospace_id, ename=name)

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


# ─── AQL text parser ───────────────────────────────────────────────────────
# Parse an asset-query-language string into a ParsedQuery (the contract in
# schemas.py), which AssetQuery.from_aql compiles into a query. Pure, no DB.
#
#   corruption                FTS (unquoted words AND'd)    "Deutsche Bank"  phrase
#   -sports                   FTS negation                  ~corruption>0.7  semantic+threshold
#   kind:pdf,email  -kind:image    after:2019-01  before:2022-12
#   bundle:"leaked docs"  asset:123  tag:important,review  run:42
#   entity:"A","B"  entity:~politician>0.7  -entity:"name"
#   annotation:sentiment>=0.8  annotation:doc.topics.0=="climate"
# Composition: space = AND, comma = OR within a filter, - = NOT, ~ = semantic.

_THRESHOLD_RE = re.compile(r'([><]=?)([\d.]+)$')
_ANNOTATION_OP_RE = re.compile(r'^([a-zA-Z0-9_.]+)(==|!=|>=|>|<=|<)(.+)$')
_PREFIX_RE = re.compile(r'^(-)?([a-z]+):(.+)$', re.DOTALL)

_KNOWN_PREFIXES = frozenset({"kind", "after", "before", "bundle", "asset", "run", "entity", "annotation", "children", "tag"})


def _tokenize(raw: str) -> list[str]:
    """Split query string into tokens, respecting quoted strings."""
    tokens: list[str] = []
    current: list[str] = []
    in_quotes = False
    for ch in raw:
        if ch == '"':
            in_quotes = not in_quotes
            current.append(ch)
        elif ch == ' ' and not in_quotes:
            if current:
                tokens.append(''.join(current))
                current = []
        else:
            current.append(ch)
    if current:
        tokens.append(''.join(current))
    return tokens


def _strip_quotes(s: str) -> str:
    if len(s) >= 2 and s.startswith('"') and s.endswith('"'):
        return s[1:-1]
    return s


def _parse_comma_values(s: str) -> list[str]:
    """Parse comma-separated values, respecting quotes."""
    parts: list[str] = []
    current: list[str] = []
    in_q = False
    for ch in s:
        if ch == '"':
            in_q = not in_q
        elif ch == ',' and not in_q:
            parts.append(_strip_quotes(''.join(current).strip()))
            current = []
            continue
        current.append(ch)
    if current:
        parts.append(_strip_quotes(''.join(current).strip()))
    return [p for p in parts if p]


def _parse_semantic(raw: str) -> SemanticClause:
    """Parse semantic value: 'query', 'query>0.7', '"phrase">0.5'."""
    m = _THRESHOLD_RE.search(raw)
    if m:
        query = _strip_quotes(raw[:m.start()])
        return SemanticClause(text=query, threshold_op=m.group(1), threshold=float(m.group(2)))
    return SemanticClause(text=_strip_quotes(raw))


def bundles_matching(
    session: Session,
    infospace_id: int,
    parsed: ParsedQuery,
    access_scope,
    *,
    limit: int = 10,
) -> List[Tuple[Bundle, float]]:
    """Rank bundles (folders) by name against a parsed query's free-text term.

    Folders have no body/FTS, so they match on name (and weakly description /
    purpose) only — a different matcher than ``AssetQuery``, converging on the
    same node stream. A small CASE ranks the way file search does — exact >
    prefix > word-start > substring — so a perfectly-named folder leads. Clamped
    by ``access_scope`` exactly like ``views._build_nav`` (scope set but no
    bundle grants → nothing visible). Bounded, indexed, limited: cheap at any
    infospace size.
    """
    term = (parsed.text or "").strip()
    if not term:
        return []
    if access_scope is not None and not access_scope.bundle_ids:
        return []  # scope set, no bundle grants — no folders visible

    like = f"%{term}%"
    prefix = f"{term}%"
    word = f"% {term}%"  # term at a word boundary inside the name
    name_lower = func.lower(Bundle.name)

    score = case(
        (name_lower == term.lower(), 4.0),
        (Bundle.name.ilike(prefix), 3.0),
        (Bundle.name.ilike(word), 2.0),
        (Bundle.name.ilike(like), 1.0),
        else_=0.0,
    ) + case(
        (or_(Bundle.description.ilike(like), Bundle.purpose.ilike(like)), 0.5),
        else_=0.0,
    )

    stmt = (
        select(Bundle, score.label("rank"))
        .where(Bundle.infospace_id == infospace_id)
        .where(
            or_(
                Bundle.name.ilike(like),
                Bundle.description.ilike(like),
                Bundle.purpose.ilike(like),
            )
        )
    )
    if access_scope is not None and access_scope.bundle_ids:
        stmt = stmt.where(Bundle.id.in_(access_scope.bundle_ids))
    stmt = stmt.order_by(score.desc(), Bundle.name.asc()).limit(limit)

    return [(b, float(rank)) for b, rank in session.exec(stmt).all()]


def _split_or_groups(raw: str) -> list[str]:
    """Quote-aware split into top-level OR groups.

    Splits on a standalone uppercase ``OR`` token or ``|`` (space-delimited); a
    quoted ``"OR"`` or lowercase ``or`` is preserved (it stays free text, where
    websearch_to_tsquery treats ``or`` as a boolean). Returns a single element —
    the whole string — when there is no top-level OR.
    """
    if not raw or not raw.strip():
        return [raw]
    groups: list[str] = []
    current: list[str] = []
    for tok in _tokenize(raw.strip()):
        if tok in ("OR", "|"):
            if current:
                groups.append(" ".join(current))
                current = []
        else:
            current.append(tok)
    if current:
        groups.append(" ".join(current))
    return groups or [raw]


def parse(raw: str) -> ParsedQuery:
    """Parse an AQL string into a ParsedQuery.

    Top-level ``OR`` / ``|`` splits into DNF groups (``a bundle:1 OR b bundle:2``
    → two groups, unioned at query time); each group is parsed independently and
    stored in ``ParsedQuery.groups``. A simple query (no top-level OR) parses flat
    into the fields directly — it is its own single group via ``groups_or_self``.
    """
    groups = _split_or_groups(raw)
    if len(groups) > 1:
        q = ParsedQuery()
        q.groups = [_parse_single(g) for g in groups]
        return q
    return _parse_single(groups[0])


def _parse_single(raw: str) -> ParsedQuery:
    """Parse a single (non-compound) query string into structured filters."""
    q = ParsedQuery()
    if not raw or not raw.strip():
        return q

    tokens = _tokenize(raw.strip())
    text_parts: list[str] = []

    for token in tokens:
        # Try prefix match: [-]prefix:value
        prefix_match = _PREFIX_RE.match(token)

        if prefix_match and prefix_match.group(2) in _KNOWN_PREFIXES:
            negated = prefix_match.group(1) == '-'
            prefix = prefix_match.group(2)
            rest = prefix_match.group(3)

            if prefix == 'kind':
                values = _parse_comma_values(rest)
                if negated:
                    q.excluded_kinds.extend(values)
                else:
                    q.kinds.extend(values)

            elif prefix == 'after':
                q.date_after = _strip_quotes(rest)

            elif prefix == 'before':
                q.date_before = _strip_quotes(rest)

            elif prefix == 'bundle':
                q.bundle_refs.extend(_parse_comma_values(rest))

            elif prefix == 'asset':
                q.asset_refs.extend(_parse_comma_values(rest))

            elif prefix == 'children':
                val = _strip_quotes(rest).lower()
                if val in ('none', '0'):
                    q.children_limit = 0
                elif val in ('show', 'all'):
                    q.children_limit = -1  # -1 = unlimited
                else:
                    try:
                        q.children_limit = max(0, int(val))
                    except ValueError:
                        pass

            elif prefix == 'tag':
                q.tags.extend(_parse_comma_values(rest))

            elif prefix == 'run':
                try:
                    q.run_ids.append(int(_strip_quotes(rest)))
                except ValueError:
                    pass

            elif prefix == 'entity':
                if rest.startswith('~'):
                    q.entity_semantic = _parse_semantic(rest[1:])
                else:
                    values = _parse_comma_values(rest)
                    if negated:
                        q.entity_negations.extend(values)
                    else:
                        q.entities.append(values)

            elif prefix == 'annotation':
                ann_match = _ANNOTATION_OP_RE.match(rest)
                if ann_match:
                    q.annotations.append(AnnotationFilter(
                        field=ann_match.group(1),
                        op=ann_match.group(2),
                        value=_strip_quotes(ann_match.group(3)),
                        negated=negated,
                    ))

            continue

        # No prefix — semantic (~) or free text
        if token.startswith('~'):
            q.semantic = _parse_semantic(token[1:])
        else:
            # Everything else is free text (websearch_to_tsquery handles quotes, -, or)
            text_parts.append(token)

    q.text = ' '.join(text_parts)
    return q
