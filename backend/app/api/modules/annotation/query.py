"""AnnotationQuery — composable SQL builder for annotation analysis.

The annotation module's counterpart to AssetQuery in the content module.
Routes construct it directly — no service class wrapping.

Three materializations on the same builder state:
  .results()    → paginated rows with asset hierarchy context
  .aggregate()  → grouped statistics (temporal or categorical buckets)
  .graph()      → entity/relationship network from triplet extraction

All materializations share the same WHERE clause, built from the shared
filter language in core/filters.py.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlmodel import Session

from app.api.modules.content.schemas import ListingSection
from app.api.modules.graph.schemas import (
    GraphEdgeData as GraphEdge,
    GraphNodeData as GraphNode,
    GraphResultData as GraphResult,
)
from app.core.cursor import decode_cursor, encode_cursor
from app.core.filters import (
    ExplosionPath,
    FieldCondition,
    FilterSet,
    MergeMap,
    condition_sql,
    jsonb_accessor,
    jsonb_value_accessor,
    merge_case,
    parse_explosion,
    safe_array_elements,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Response types
# ---------------------------------------------------------------------------


class AssetSummary(BaseModel):
    """Asset context sidecar returned alongside annotation rows."""

    id: int
    title: str | None = None
    kind: str
    parent_asset_id: int | None = None
    parent_title: str | None = None


class AnnotationRow(BaseModel):
    """One row in a paginated annotation result."""

    annotation_id: int
    asset_id: int
    schema_id: int
    run_id: int
    value: dict[str, Any]
    timestamp: datetime
    status: str
    element: dict[str, Any] | None = None
    element_index: int | None = None


class ResultsPage(ListingSection["AnnotationRow"]):
    """Annotation-domain specialization of ListingSection.

    Inherits ``items``, ``total``, ``has_more``, ``cursor_next`` from
    ``ListingSection[AnnotationRow]``. Adds the ``assets`` sidecar that
    carries asset hierarchy context for the rows in the page.
    """

    assets: dict[int, AssetSummary] = Field(default_factory=dict)


class AggregateBucket(BaseModel):
    key: str
    count: int
    stats: dict[str, Any] | None = None
    # Optional second-dimension value when the query carries a ``split_by``.
    # Rows with the same ``key`` and different ``split_value`` form the pivot
    # the frontend turns into series (e.g. grouped timeline).
    split_value: str | None = None


class AggregateResult(BaseModel):
    buckets: list[AggregateBucket]
    field_path: str
    interval: str | None = None
    total_count: int
    split_field_path: str | None = None


# ─── Formula output relation — the one shape ────────────────────────────────


class OutputRow(BaseModel):
    """One row of a Formula's output relation: group keys × measures.

    ``annotation_id``/``asset_id``/``snippet`` are populated **only** in
    evidence mode (a ``top(N)`` measure or a snippet binding) — there the
    row *is* an annotation, so provenance is intrinsic and free. In pure
    aggregate mode they are ``None``: the query itself is the provenance.
    """

    keys: dict[str, str] = Field(default_factory=dict)
    measures: dict[str, Any] = Field(default_factory=dict)
    annotation_id: int | None = None
    asset_id: int | None = None
    snippet: str | None = None


class OutputRelation(BaseModel):
    """A Formula's frozen-able answer. No per-row provenance in aggregate
    mode by design — see ``docs/intelligence/HOW_TO.md``."""

    rows: list[OutputRow] = Field(default_factory=list)
    output_keys: list[str] = Field(default_factory=list)
    measure_names: list[str] = Field(default_factory=list)
    total: int = 0
    evidence_mode: bool = False
    has_more: bool = False
    cursor_next: str | None = None


# ─── Numeric value SQL — enum_weights lift + safe cast ──────────────────────


def _safe_float_sql(acc: str) -> str:
    """Cast a text accessor to float only when it *is* numeric — one dirty
    value can no longer fail an entire Formula (the strict ``::float`` did)."""
    return (
        f"CASE WHEN ({acc}) ~ '^[[:space:]]*-?[0-9]+(\\.[0-9]+)?[[:space:]]*$' "
        f"THEN ({acc})::float ELSE NULL END"
    )


def _numeric_lift_sql(acc: str, weights: dict[str, float] | None) -> str:
    """The ordinal/axes thesis in SQL: ``enum_weights`` maps a categorical
    value to a number via CASE (case-insensitive, like ``merge_case``);
    absent ⇒ safe float cast. This is what makes ordinal measures
    aggregatable without any schema-level axis."""
    if not weights:
        return _safe_float_sql(acc)
    whens = " ".join(
        f"WHEN lower({acc}) = lower('{str(k).replace(chr(39), chr(39) * 2)}') "
        f"THEN {float(v)}"
        for k, v in weights.items()
    )
    return f"CASE {whens} ELSE NULL END"


def _collect_explosion_tree(chains: list) -> list:
    """Build the union of every chain's segments as a topologically ordered
    list (outer LATERAL first, inner LATERAL last). Each segment becomes
    one ``LATERAL jsonb_array_elements`` in the engine's FROM clause.

    Validation: at any given ``parent_alias`` only one ``array_path`` may be
    chosen. Two chains that disagree (e.g. ``mails[*]`` and ``calls[*]``
    both at depth 0) would Cartesian-product across annotations; this is
    the contract the single-LATERAL constraint enforced before nested
    explosions were supported, generalised to "all chains must share a
    common explosion tree."

    Returns the deduped segments — chains that share an outer array (or
    a full prefix) end up reading from the same LATERAL because aliases
    are deterministic from depth + array_path's last segment.
    """
    from app.core.filters import ExplosionSegment

    # Group by (depth, parent_alias) — at each fork point only one array
    # path may win. Outer-to-inner ordering falls out by iterating depths
    # in ascending order.
    out: list[ExplosionSegment] = []
    seen_aliases: set[str] = set()
    max_depth = max((len(c.segments) for c in chains), default=0)
    for depth in range(max_depth):
        chosen: dict[str, ExplosionSegment] = {}  # parent_alias -> segment
        for c in chains:
            if depth >= len(c.segments):
                continue
            seg = c.segments[depth]
            existing = chosen.get(seg.parent_alias)
            if existing is None:
                chosen[seg.parent_alias] = seg
            elif existing.array_path != seg.array_path:
                raise ValueError(
                    f"Formula explosions conflict at depth {depth} under "
                    f"parent {seg.parent_alias!r}: "
                    f"{existing.array_path!r} vs {seg.array_path!r}. "
                    "All paths must share a common explosion tree."
                )
        for seg in chosen.values():
            if seg.alias not in seen_aliases:
                out.append(seg)
                seen_aliases.add(seg.alias)
    return out


def _merge_relation_rows(
    rows_a: list[OutputRow], rows_b: list[OutputRow]
) -> list[OutputRow]:
    """Merge two OutputRow lists by their ``keys`` dict. Both sides may
    have non-overlapping keysets — every row in either list ends up in the
    output. ``measures`` from B win on collision (used by distribution
    decomposition where B carries the distribution map)."""
    def _kt(r: OutputRow) -> tuple:
        return tuple(sorted(r.keys.items()))

    by_a: dict[tuple, OutputRow] = {_kt(r): r for r in rows_a}
    out: list[OutputRow] = []
    seen: set[tuple] = set()
    for rb in rows_b:
        kt = _kt(rb)
        ra = by_a.get(kt)
        if ra is not None:
            merged = dict(ra.measures)
            merged.update(rb.measures)
            out.append(OutputRow(keys=ra.keys, measures=merged))
        else:
            out.append(rb)
        seen.add(kt)
    for ra in rows_a:
        if _kt(ra) not in seen:
            out.append(ra)
    return out


def _apply_post_sort(rel: OutputRelation, formula) -> OutputRelation:
    """Apply ``order_by`` when the named column is a derive (or any post-
    SQL measure). SQL-side sorts are pushed in ``_compute_relation``; this
    handler runs after derives evaluate, on the in-memory ≤5000 rows."""
    ob = getattr(formula, "order_by", None)
    if ob is None:
        return rel
    if any(s.name == ob.column for s in formula.derives):
        reverse = ob.direction == "desc"

        def _key(r: OutputRow):
            v = r.measures.get(ob.column)
            # Push None to the end regardless of direction
            return (v is None, v if v is not None else 0)

        rel.rows.sort(key=_key, reverse=reverse)
    return rel


# GraphNode/GraphEdge/GraphResult are Pydantic BaseModels re-exported from
# ``graph.schemas`` so the same types flow through ``stream_graph`` and the
# ``/view`` wire. The ``graph()`` materialization on AnnotationQuery returns
# ``GraphResult`` (ephemeral; full set) or — per Phase 4.7 — the
# ``stream_graph`` chunk iterator.

ResultsPage.model_rebuild()


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------

class AnnotationQuery:
    """Composable SQL builder rooted in the Annotation table.

    Usage::

        aq = AnnotationQuery(session, infospace_id)
        aq.runs([1, 2]).schemas([3]).filter(filter_set).explode("emails")
        page = aq.results()          # paginated rows
        agg  = aq.aggregate("emails[*].sender", interval=None)  # categorical
        graph = aq.graph("relationships")  # triplet extraction
    """

    def __init__(self, session: Session, infospace_id: int) -> None:
        self._session = session
        self._infospace_id = infospace_id
        self._run_ids: list[int] = []
        self._schema_ids: list[int] = []
        self._asset_ids: list[int] = []
        self._conditions: list[FieldCondition] = []
        self._merge_maps: list[MergeMap] = []
        self._limit: int = 100
        self._cursor: int | None = None
        # Package-share scope. ``None`` = full infospace access (owner / collaborator).
        # A ``PackageScope`` (even an empty one) restricts visibility to its grants.
        self._package_scope = None

    # --- Builder methods (all return self) ---

    def runs(self, run_ids: list[int]) -> AnnotationQuery:
        self._run_ids = run_ids
        return self

    def schemas(self, schema_ids: list[int]) -> AnnotationQuery:
        self._schema_ids = schema_ids
        return self

    def assets(self, asset_ids: list[int]) -> AnnotationQuery:
        self._asset_ids = asset_ids
        return self

    def filter(self, fs: FilterSet) -> AnnotationQuery:
        self._conditions.extend(fs.conditions)
        return self

    def merge(self, mm: MergeMap) -> AnnotationQuery:
        self._merge_maps.append(mm)
        return self

    def scope(self, package_scope) -> AnnotationQuery:
        """Apply package scope to all materializations.

        ``None`` = full access (owner / collaborator). A populated
        ``PackageScope`` restricts visibility to the grant's run_ids. An
        empty ``PackageScope`` (object present but no grants) returns no
        rows — 'scope is set, nothing granted' is not the same as 'no
        scope set'.
        """
        self._package_scope = package_scope
        return self

    def paginate(self, cursor: str | int | None = None, limit: int = 100) -> AnnotationQuery:
        """Opaque cursor pagination.

        Accepts the encoded string (preferred), a raw ``int`` annotation id
        (legacy callers), or ``None`` for a fresh listing. The primitive
        decodes internally.
        """
        if cursor is None:
            self._cursor = None
        elif isinstance(cursor, int):
            self._cursor = cursor
        else:
            try:
                _, _, _, last_id = decode_cursor(cursor)
                self._cursor = last_id
            except Exception:
                # Legacy callers may still send stringified ints.
                try:
                    self._cursor = int(cursor)
                except ValueError:
                    self._cursor = None
        self._limit = min(limit, 500)
        return self

    # ------------------------------------------------------------------
    # Shared SQL generation
    # ------------------------------------------------------------------

    def _base_where(
        self, *, alias: str = "a", include_cursor: bool = True,
    ) -> tuple[list[str], dict[str, Any]]:
        """Build WHERE clauses common to all materializations.

        Returns (clause_list, params) where each clause is a raw SQL string
        and params is the bind-parameter dict.

        Pass ``include_cursor=False`` for count queries that should not be
        scoped by the pagination cursor.
        """
        clauses: list[str] = [f"{alias}.infospace_id = :iid"]
        params: dict[str, Any] = {"iid": self._infospace_id}

        if self._run_ids:
            clauses.append(f"{alias}.run_id = ANY(:run_ids)")
            params["run_ids"] = self._run_ids

        if self._schema_ids:
            clauses.append(f"{alias}.schema_id = ANY(:schema_ids)")
            params["schema_ids"] = self._schema_ids

        if self._asset_ids:
            clauses.append(f"{alias}.asset_id = ANY(:asset_ids)")
            params["asset_ids"] = self._asset_ids

        # Package scope — single source of truth for all three materializations.
        # results(), aggregate(), graph() all build their SQL on top of _base_where,
        # so adding the predicate here guarantees none of them can leak scoped data.
        if self._package_scope is not None:
            if self._package_scope.run_ids:
                clauses.append(f"{alias}.run_id = ANY(:scope_run_ids)")
                params["scope_run_ids"] = list(self._package_scope.run_ids)
            else:
                # Scope set but empty = see nothing.
                clauses.append("FALSE")

        if include_cursor and self._cursor is not None:
            clauses.append(f"{alias}.id < :cursor")
            params["cursor"] = self._cursor

        return clauses, params

    def _apply_conditions(
        self,
        clauses: list[str],
        params: dict[str, Any],
        *,
        annotation_alias: str = "a",
        element_alias: str | None = None,
        active_explosion: str | None = None,
    ) -> None:
        """Compile FieldConditions into SQL and append to clauses/params.

        *element_alias* is the SQL alias for the lateral-joined element
        (e.g. ``"elem"``).  Conditions whose path matches the active
        explosion are evaluated on the element alias; others on the
        annotation value column.
        """
        for i, cond in enumerate(self._conditions):
            ep = parse_explosion(cond.path)
            prefix = f"fc{i}"

            if ep.is_exploded and element_alias and ep.array_field == active_explosion:
                # Element-level condition on the lateral-joined array
                col = element_alias
                # Rewrite the condition to use just the remainder path
                inner_cond = FieldCondition(
                    path=ep.remainder or ep.array_field,
                    operator=cond.operator,
                    value=cond.value,
                )
                frag, frag_params = condition_sql(inner_cond, col, param_prefix=prefix)
            elif ep.is_exploded and not element_alias:
                # Element-level condition but no lateral join active.
                # Use EXISTS on jsonb_array_elements as a sub-condition.
                frag, frag_params = self._element_exists_condition(
                    cond, ep, annotation_alias, prefix
                )
            else:
                # Direct condition on annotation.value
                frag, frag_params = condition_sql(
                    cond, f"{annotation_alias}.value", param_prefix=prefix
                )

            clauses.append(frag)
            params.update(frag_params)

    def _element_exists_condition(
        self,
        cond: FieldCondition,
        ep: Any,  # ExplosionPath
        annotation_alias: str,
        prefix: str,
    ) -> tuple[str, dict[str, Any]]:
        """Build an EXISTS subquery for element-level conditions when no
        lateral join is active (e.g., filtering annotations that *contain*
        matching elements without exploding them).

        The array accessor goes through ``jsonb_value_accessor`` so dotted
        ``ep.array_field`` paths (``document.mails``) resolve across the
        flat / nested / unwrapped-document storage conventions — matches the
        same policy used in ``aggregate()`` for the LATERAL join.

        When ``ep.remainder`` is empty (``array_of_primitives[*]``), the
        element itself IS the value; compare against ``_el #>> '{}'``.
        Otherwise delegate to ``condition_sql`` with ``_el`` as the alias
        and ``ep.remainder`` as the sub-path.
        """
        params: dict[str, Any] = {}
        if ep.remainder:
            inner_cond = FieldCondition(
                path=ep.remainder, operator=cond.operator, value=cond.value
            )
            inner_frag, inner_params = condition_sql(
                inner_cond, "_el", param_prefix=prefix
            )
            params.update(inner_params)
        else:
            # Synthesize a condition that compares the element-as-text using
            # a dummy single-segment path; condition_sql accepts any operator.
            # ``_el_text`` is a SQL scalar (``_el #>> '{}'``), and we pass it
            # as the column so ``{column}->>:path`` degenerates to the scalar.
            from app.core.filters import condition_sql as _cs
            # condition_sql expects ``column``; inject raw SQL by using the
            # text-of-element expression directly via a fake single-segment
            # path. Simpler: inline the common operators for primitives here.
            inner_frag, inner_params = self._primitive_element_condition(
                cond, prefix,
            )
            params.update(inner_params)
        arr_acc, arr_params = jsonb_value_accessor(
            f"{annotation_alias}.value",
            ep.array_field,
            param_name=f"{prefix}_arr_fp",
        )
        params.update(arr_params)
        sql = (
            f"EXISTS (SELECT 1 FROM jsonb_array_elements({safe_array_elements(arr_acc)}) AS _el "
            f"WHERE {inner_frag})"
        )
        return sql, params

    def _primitive_element_condition(
        self,
        cond: FieldCondition,
        prefix: str,
    ) -> tuple[str, dict[str, Any]]:
        """Compare the element itself (not a sub-field) in a primitive array.

        Used when ``field[*]`` is filtered directly (no ``.remainder``).
        Supports the operators the UI produces: ``eq``, ``contains``, ``in``,
        ``gt``, ``lt``, ``between`` — enough for the common filter surface.
        """
        acc = "_el #>> '{}'"
        op = cond.operator
        val = cond.value
        params: dict[str, Any] = {}
        pp = prefix
        if op in ("eq", "equals"):
            params[f"{pp}_val"] = str(val)
            return f"{acc} = :{pp}_val", params
        if op in ("ne", "not_equals"):
            params[f"{pp}_val"] = str(val)
            return f"{acc} != :{pp}_val", params
        if op == "contains":
            params[f"{pp}_val"] = f"%{val}%"
            return f"{acc} ILIKE :{pp}_val", params
        if op == "not_contains":
            params[f"{pp}_val"] = f"%{val}%"
            return f"{acc} NOT ILIKE :{pp}_val", params
        if op == "in":
            vals = list(val) if isinstance(val, (list, tuple)) else [val]
            params[f"{pp}_val"] = [str(v) for v in vals]
            return f"{acc} = ANY(:{pp}_val)", params
        if op == "not_in":
            vals = list(val) if isinstance(val, (list, tuple)) else [val]
            params[f"{pp}_val"] = [str(v) for v in vals]
            return f"{acc} != ALL(:{pp}_val)", params
        if op in ("gt", "greater_than"):
            try:
                params[f"{pp}_val"] = float(val)
                return f"({acc})::float > :{pp}_val", params
            except (TypeError, ValueError):
                params[f"{pp}_val"] = str(val)
                return f"{acc} > :{pp}_val", params
        if op in ("lt", "less_than"):
            try:
                params[f"{pp}_val"] = float(val)
                return f"({acc})::float < :{pp}_val", params
            except (TypeError, ValueError):
                params[f"{pp}_val"] = str(val)
                return f"{acc} < :{pp}_val", params
        if op == "between":
            if not isinstance(val, (list, tuple)) or len(val) != 2:
                raise ValueError("'between' requires [low, high]")
            try:
                params[f"{pp}_lo"] = float(val[0])
                params[f"{pp}_hi"] = float(val[1])
                return f"({acc})::float BETWEEN :{pp}_lo AND :{pp}_hi", params
            except (TypeError, ValueError):
                params[f"{pp}_lo"] = str(val[0])
                params[f"{pp}_hi"] = str(val[1])
                return f"{acc} BETWEEN :{pp}_lo AND :{pp}_hi", params
        if op == "exists":
            return f"{acc} IS NOT NULL", params
        if op == "not_exists":
            return f"{acc} IS NULL", params
        raise ValueError(
            f"Operator {op!r} not supported for primitive-array element filter"
        )

    def _find_merge_map(self, field_path: str) -> MergeMap | None:
        """Find a merge map whose field_path matches the given path."""
        for mm in self._merge_maps:
            if mm.field_path == field_path:
                return mm
        return None

    # ------------------------------------------------------------------
    # Materialization 1: results()
    # ------------------------------------------------------------------

    def results(self) -> ResultsPage:
        """Paginated annotation rows with asset hierarchy context."""
        clauses, params = self._base_where()

        # No explosion for results — we return full annotation rows
        self._apply_conditions(clauses, params)

        where = " AND ".join(clauses)

        # Main query: annotations joined with asset + parent asset
        sql = f"""
            SELECT
                a.id AS annotation_id,
                a.asset_id,
                a.schema_id,
                a.run_id,
                a.value,
                a.timestamp,
                a.status,
                asset.title AS asset_title,
                asset.kind AS asset_kind,
                asset.parent_asset_id,
                parent.id AS parent_id,
                parent.title AS parent_title,
                parent.kind AS parent_kind
            FROM annotation a
            JOIN asset ON asset.id = a.asset_id
            LEFT JOIN asset parent ON parent.id = asset.parent_asset_id
            WHERE {where}
            ORDER BY a.id DESC
            LIMIT :lim
        """
        params["lim"] = self._limit

        rows = self._session.exec(text(sql).bindparams(**params)).all()

        items: list[AnnotationRow] = []
        assets: dict[int, AssetSummary] = {}

        for row in rows:
            items.append(AnnotationRow(
                annotation_id=row.annotation_id,
                asset_id=row.asset_id,
                schema_id=row.schema_id,
                run_id=row.run_id,
                value=row.value if isinstance(row.value, dict) else {},
                timestamp=row.timestamp,
                status=row.status if isinstance(row.status, str) else str(row.status),
            ))

            if row.asset_id not in assets:
                assets[row.asset_id] = AssetSummary(
                    id=row.asset_id,
                    title=row.asset_title,
                    kind=row.asset_kind if isinstance(row.asset_kind, str) else str(row.asset_kind),
                    parent_asset_id=row.parent_asset_id,
                    parent_title=row.parent_title,
                )
            if row.parent_id and row.parent_id not in assets:
                assets[row.parent_id] = AssetSummary(
                    id=row.parent_id,
                    title=row.parent_title or "",
                    kind=row.parent_kind if isinstance(row.parent_kind, str) else str(row.parent_kind) if row.parent_kind else "",
                    parent_asset_id=None,
                    parent_title=None,
                )

        # Count (deferred — can be slow for large datasets).
        # Exclude cursor so we count total matching rows, not just those after cursor.
        count_clauses, count_params = self._base_where(include_cursor=False)
        self._apply_conditions(count_clauses, count_params)
        count_where = " AND ".join(count_clauses)
        count_sql = f"SELECT count(*) FROM annotation a WHERE {count_where}"
        total = self._session.exec(text(count_sql).bindparams(**count_params)).scalar()

        cursor_next: str | None = None
        if items and len(items) == self._limit:
            last = items[-1]
            cursor_next = encode_cursor(
                sort_field="annotation_id",
                direction="desc",
                last_value=last.annotation_id,
                last_id=last.annotation_id,
            )

        return ResultsPage(
            items=items,
            assets=assets,
            total=total,
            cursor_next=cursor_next,
            has_more=cursor_next is not None,
        )

    # ------------------------------------------------------------------
    # Materialization 2: aggregate()
    # ------------------------------------------------------------------

    def aggregate(
        self,
        group_by: str,
        *,
        interval: str | None = None,
        function: str = "count",
        value_field: str | None = None,
        top_n: int | None = None,
        split_by: str | None = None,
    ) -> AggregateResult:
        """Grouped statistics via SQL pushdown.

        Args:
            group_by:     Field path to group on (e.g. "emails[*].sender").
            interval:     For temporal grouping: day/week/month/quarter/year.
            function:     Aggregation: count/sum/avg/min/max.
            value_field:  Field for sum/avg/min/max (within same explosion).
            top_n:        Limit to top N categories.
            split_by:     Optional second-dimension field path. When set, each
                          ``(bucket, split_value)`` pair becomes a row and the
                          frontend pivots split values into series (grouped
                          timeline, clustered bars, small multiples).

        Notes:
            Explosion context is shared across ``group_by``, ``value_field``,
            and ``split_by``: any of them may carry ``[*]`` and the LATERAL join
            binds to that single array. Paths without ``[*]`` read from
            ``annotation.value`` directly in the same query. Two exploded paths
            pointing at *different* arrays are rejected (cartesian product).

            **Count semantics after fanning.** ``count(*)`` is row-count after
            the LATERAL — so when ``value_field`` brings the explosion (e.g.
            ``group_by=event_timestamp`` + ``value_field=events[*].score``)
            each array element is its own row and ``count`` reports element
            count, not annotation count. Callers that need annotation count
            while still aggregating over an exploded measure should ignore the
            returned ``count`` and derive it via a separate un-exploded query.
        """
        ep_group = parse_explosion(group_by)
        ep_value = parse_explosion(value_field) if value_field else None
        ep_split = parse_explosion(split_by) if split_by is not None else None
        clauses, params = self._base_where()

        # Collapse all three explosion candidates into ONE active array — the
        # backend supports a single LATERAL per aggregate, so group_by /
        # value_field / split_by must either share the array or be unexploded.
        exploded_arrays = {
            ep.array_field
            for ep in (ep_group, ep_value, ep_split)
            if ep is not None and ep.is_exploded and ep.array_field
        }
        if len(exploded_arrays) > 1:
            raise ValueError(
                "group_by, value_field, and split_by may not each introduce "
                "a different explosion (would produce a cartesian product). "
                f"Got: {sorted(exploded_arrays)}."
            )

        # Use the JSONB value accessor for the array read so COALESCE covers the
        # flat/nested/unwrapped storage conventions — otherwise
        # ``document.topics[*]`` fails when data is stored flat even though
        # ``document.topics`` (no [*]) works.
        from_clause = "annotation a"
        element_alias: str | None = None
        active_explosion: str | None = None

        if exploded_arrays:
            array_field = next(iter(exploded_arrays))
            arr_acc, arr_params = jsonb_value_accessor(
                "a.value", array_field, param_name="expl_fp"
            )
            params.update(arr_params)
            from_clause = (
                f"annotation a, LATERAL jsonb_array_elements({safe_array_elements(arr_acc)}) AS elem"
            )
            element_alias = "elem"
            active_explosion = array_field

        self._apply_conditions(
            clauses, params,
            element_alias=element_alias,
            active_explosion=active_explosion,
        )

        # One accessor rule for all three roles: read from ``elem`` when the
        # path is exploded (it hangs off the active LATERAL), else from
        # ``a.value`` via its full path. Keeps group_by / value_field /
        # split_by symmetric — whichever brought the explosion doesn't matter.
        def accessor_for(
            ep: ExplosionPath, raw_path: str, param_name: str, *, cast: str | None = None,
        ) -> tuple[str, dict[str, Any]]:
            if ep.is_exploded:
                if ep.remainder:
                    return jsonb_accessor("elem", ep.remainder, param_name=param_name, cast=cast)
                # Array of primitives — elem IS the value. ``#>> '{}'`` extracts
                # any jsonb leaf as text and works uniformly for string / number
                # / bool elements; wrap in the cast when requested.
                acc = "elem #>> '{}'"
                return (f"({acc})::{cast}" if cast else acc), {}
            return jsonb_accessor("a.value", raw_path, param_name=param_name, cast=cast)

        # Build the group-by accessor
        group_acc, group_params = accessor_for(ep_group, group_by, "grp_fp")
        params.update(group_params)

        # Apply merge map if one exists for this field
        mm = self._find_merge_map(group_by)
        if mm:
            group_expr = merge_case(mm, group_acc)
        else:
            group_expr = group_acc

        # Temporal wrapping — filter out non-parseable values before cast
        if interval:
            valid_intervals = ("day", "week", "month", "quarter", "year")
            if interval not in valid_intervals:
                raise ValueError(f"interval must be one of {valid_intervals}")
            # Exclude NULLs and empty strings; use a CTE-safe approach with
            # a WHERE filter that rejects values that can't be cast.
            clauses.append(
                f"{group_acc} IS NOT NULL AND {group_acc} != '' "
                f"AND {group_acc} !~ '^<'"  # skip "<UNKNOWN>" etc.
            )
            group_expr = f"date_trunc('{interval}', ({group_expr})::timestamptz)"

        # Second-dimension split accessor — uses the same symmetric accessor
        # helper, so split_by can be exploded on the shared array regardless of
        # whether group_by is the one that brought the LATERAL.
        split_expr: str | None = None
        if ep_split is not None:
            split_acc, sp_params = accessor_for(ep_split, split_by, "split_fp")
            params.update(sp_params)
            mm_split = self._find_merge_map(split_by)
            split_expr = merge_case(mm_split, split_acc) if mm_split else split_acc

        # Aggregation expression
        agg_parts = ["count(*) AS cnt"]
        if function != "count" and value_field and ep_value is not None:
            val_acc, val_params = accessor_for(ep_value, value_field, "val_fp", cast="float")
            params.update(val_params)

            if function in ("sum", "avg", "min", "max"):
                agg_parts.append(f"{function}({val_acc}) AS agg_val")

        where = " AND ".join(clauses)
        agg_select = ", ".join(agg_parts)

        if split_expr is not None:
            select_cols = f"{group_expr} AS bucket, {split_expr} AS split_val, {agg_select}"
            group_clause = f"{group_expr}, {split_expr}"
            order = "bucket ASC, cnt DESC" if interval else "bucket ASC, cnt DESC"
        else:
            select_cols = f"{group_expr} AS bucket, {agg_select}"
            group_clause = group_expr
            order = "bucket ASC" if interval else "cnt DESC"

        sql = f"""
            SELECT {select_cols}
            FROM {from_clause}
            WHERE {where}
            GROUP BY {group_clause}
            ORDER BY {order}
        """

        if top_n:
            sql += f" LIMIT {int(top_n)}"

        rows = self._session.exec(text(sql).bindparams(**params)).all()

        buckets: list[AggregateBucket] = []
        total_count = 0
        for row in rows:
            count = row.cnt
            total_count += count
            stats = None
            if function != "count" and hasattr(row, "agg_val") and row.agg_val is not None:
                stats = {value_field or "value": {function: float(row.agg_val)}}
            split_value: str | None = None
            if split_expr is not None and hasattr(row, "split_val"):
                split_value = (
                    str(row.split_val) if row.split_val is not None else None
                )
            buckets.append(AggregateBucket(
                key=str(row.bucket) if row.bucket is not None else "",
                count=count,
                stats=stats,
                split_value=split_value,
            ))

        return AggregateResult(
            buckets=buckets,
            field_path=group_by,
            interval=interval,
            total_count=total_count,
            split_field_path=split_by,
        )

    # ------------------------------------------------------------------
    # Materialization 3: relation()  — the Formula engine (one GROUP BY)
    # ------------------------------------------------------------------

    def relation(self, formula) -> OutputRelation:
        """Materialise a Formula as ONE SQL ``GROUP BY`` (or, when a
        ``top(N)`` measure or a snippet is present, one bounded
        ``ROW_NUMBER()`` window). The engine does **zero** entity
        resolution — merge maps normalise values in-flight; canonical
        identity is a curation concern, persisted out-of-band.

        Mixed ``distribution + sum/mean/etc`` is decomposed into two
        queries that share the WHERE and merge by group key, so the
        author writes one formula and the engine does the right thing.

        See ``docs/intelligence/HOW_TO.md`` § "One SQL GROUP BY".
        """
        # Save state so multiple ``relation()`` calls on the same AQ don't
        # compound conditions / merge_maps. The body extends self in place
        # because every helper (_base_where, _apply_conditions, _find_merge_map)
        # reads from self; localising would mean threading state through
        # every helper, which is more change for the same outcome.
        saved = (
            list(self._schema_ids), list(self._conditions), list(self._merge_maps)
        )
        try:
            if formula.schema_id is not None and not self._schema_ids:
                self._schema_ids = [formula.schema_id]
            if formula.filter and formula.filter.conditions:
                self._conditions.extend(formula.filter.conditions)
            for mm in formula.merge_maps:
                self._merge_maps.append(mm)
            return self._compute_relation(formula)
        finally:
            self._schema_ids, self._conditions, self._merge_maps = saved

    def _compute_relation(self, formula) -> OutputRelation:
        """The body of ``relation()`` — runs after state has been folded in
        by the caller. Pulled out so distribution decomposition can recurse
        without re-extending state."""
        from app.core.filters import (
            ExplosionChain,
            ExplosionSegment,
            jsonb_accessor,
            jsonb_value_accessor,
            merge_case,
            parse_explosion_chain,
            safe_array_elements,
        )

        dims = list(formula.group)
        measures = list(formula.measures) or []
        evidence = any(m.agg == "top" for m in measures) or formula.snippet is not None

        clauses, params = self._base_where(include_cursor=False)

        # Parse every dim / measure / weight path into a multi-level explosion
        # chain. The chains' segments share aliases when they share an outer
        # array; conflicts at a shared parent (e.g. ``mails[*].x`` and
        # ``calls[*].y``) are Cartesian products and rejected below.
        dim_chains = [(d, parse_explosion_chain(d.path)) for d in dims]
        mv_chains = [parse_explosion_chain(m.path) for m in measures if m.path]
        side_chains: list[ExplosionChain] = []
        if formula.weight is not None and formula.weight.path:
            side_chains.append(parse_explosion_chain(formula.weight.path))
        if formula.snippet is not None and formula.snippet.verbatim:
            side_chains.append(parse_explosion_chain(formula.snippet.verbatim))
        for m in measures:
            if m.agg == "top" and m.top_by:
                side_chains.append(parse_explosion_chain(m.top_by))

        tree = _collect_explosion_tree(
            [c for _, c in dim_chains] + mv_chains + side_chains
        )

        from_parts = ["annotation a"]
        for seg in tree:
            arr_acc, ap = jsonb_value_accessor(
                seg.parent_alias, seg.array_path,
                param_name=f"expl_{seg.alias}_fp",
            )
            params.update(ap)
            from_parts.append(
                f"LATERAL jsonb_array_elements({safe_array_elements(arr_acc)}) "
                f"AS {seg.alias}"
            )
        from_clause = ", ".join(from_parts)

        # Filter conditions still operate on the outermost LATERAL (single-
        # level). Element-level filters on inner LATERALs would need a
        # multi-level FieldCondition contract — out of scope for now; they
        # fall back to EXISTS via _apply_conditions's existing path.
        outer_seg: ExplosionSegment | None = tree[0] if tree else None
        element_alias = outer_seg.alias if outer_seg else None
        active = outer_seg.array_path if outer_seg else None

        self._apply_conditions(
            clauses, params, element_alias=element_alias, active_explosion=active,
        )

        def accessor_for(chain: ExplosionChain, raw_path, pname, cast=None):
            """Read from the deepest LATERAL alias matching this chain.

            Chains with no segments read from ``a.value`` via ``raw_path``;
            chains ending in an explosion (``leaf == ""``) read the element
            as text; everything else reads the leaf inside the innermost
            element."""
            if not chain.segments:
                return jsonb_accessor("a.value", raw_path, param_name=pname, cast=cast)
            parent = chain.innermost_alias
            if chain.leaf:
                return jsonb_accessor(parent, chain.leaf, param_name=pname, cast=cast)
            acc = f"{parent} #>> '{{}}'"
            return (f"({acc})::{cast}" if cast else acc), {}

        # ── Dimension expressions ──────────────────────────────────────
        dim_sql: list[tuple[str, str]] = []  # (name, expr)
        for i, (d, chain) in enumerate(dim_chains):
            acc, p = accessor_for(chain, d.path, f"dim{i}_fp")
            params.update(p)
            mm = self._find_merge_map(d.path)
            expr = merge_case(mm, acc) if mm else acc
            if d.kind == "time":
                iv = d.interval or "month"
                if iv not in ("day", "week", "month", "quarter", "year"):
                    raise ValueError(f"bad interval {iv!r}")
                clauses.append(
                    f"{acc} IS NOT NULL AND {acc} != '' AND {acc} !~ '^<'"
                )
                expr = f"date_trunc('{iv}', ({expr})::timestamptz)"
            dim_sql.append((d.name, expr))

        where = " AND ".join(clauses)
        key_names = formula.output_keys or [d.name for d, _ in dim_chains]

        # ── Evidence mode: bounded window, rows carry their annotation ──
        if evidence:
            top_m = next((m for m in measures if m.agg == "top"), None)
            order_expr = "a.id"
            if top_m and top_m.top_by:
                ob_acc, obp = accessor_for(
                    parse_explosion_chain(top_m.top_by), top_m.top_by, "ob_fp"
                )
                params.update(obp)
                order_expr = _safe_float_sql(ob_acc)  # dirty values can't crash
            n = (top_m.top_n if top_m and top_m.top_n else 5)
            part = ", ".join(e for _, e in dim_sql) or "a.id"
            sel = ", ".join(f"{e} AS k_{i}" for i, (_, e) in enumerate(dim_sql))
            sel = (sel + ", ") if sel else ""
            snip = "NULL"
            if formula.snippet and formula.snippet.verbatim:
                sc, sp = accessor_for(
                    parse_explosion_chain(formula.snippet.verbatim),
                    formula.snippet.verbatim, "snip_fp",
                )
                params.update(sp)
                snip = sc
            sql = f"""
                SELECT * FROM (
                  SELECT {sel}a.id AS _aid, a.asset_id AS _asid,
                         {snip} AS _snip,
                         ROW_NUMBER() OVER (PARTITION BY {part}
                                            ORDER BY {order_expr} DESC NULLS LAST) AS _rn
                  FROM {from_clause} WHERE {where}
                ) e WHERE e._rn <= {int(n)}
                ORDER BY {', '.join(f'k_{i}' for i in range(len(dim_sql))) + ', ' if dim_sql else ''}_rn
                LIMIT {max(1, min(self._limit, 5000)) + 1}
                OFFSET {self._cursor if isinstance(self._cursor, int) and self._cursor > 0 else 0}
            """
            rows = self._session.exec(text(sql).bindparams(**params)).all()
            ev_lim = max(1, min(self._limit, 5000))
            ev_off = self._cursor if isinstance(self._cursor, int) and self._cursor > 0 else 0
            ev_more = len(rows) > ev_lim
            rows = rows[:ev_lim]
            out: list[OutputRow] = []
            for r in rows:
                rd = dict(r._mapping)
                out.append(OutputRow(
                    keys={dim_sql[i][0]: ("" if rd.get(f"k_{i}") is None else str(rd[f"k_{i}"]))
                          for i in range(len(dim_sql))},
                    measures={},
                    annotation_id=rd.get("_aid"),
                    asset_id=rd.get("_asid"),
                    snippet=(str(rd["_snip"]) if rd.get("_snip") is not None else None),
                ))
            rel = OutputRelation(
                rows=out, output_keys=key_names,
                measure_names=[m.name for m in measures],
                total=len(out), evidence_mode=True,
                has_more=ev_more,
                cursor_next=(str(ev_off + ev_lim) if ev_more else None),
            )
            return self._apply_derives(formula, rel)

        # ── Aggregate mode ─────────────────────────────────────────────
        # ``distribution`` folds a value into a {value: count} map per key:
        # add it as an extra group column, then collapse in Python.
        dist = [m for m in measures if m.agg == "distribution"]

        # Mixed shape: distribution + sum/mean/etc. Decompose into two
        # queries that share the WHERE + dims, then merge by group key.
        # One formula in, one OutputRelation out — the engine does the
        # right thing. (Formula model already rejects >1 distribution.)
        if dist and any(m.agg not in ("count", "distribution") for m in measures):
            dist_only = formula.model_copy(update={
                "measures": [m for m in measures if m.agg in ("distribution", "count")],
                "derives": [],
                "order_by": None,
            })
            agg_only = formula.model_copy(update={
                "measures": [m for m in measures if m.agg != "distribution"],
                "derives": [],
                "order_by": None,
            })
            rel_dist = self._compute_relation(dist_only)
            rel_agg = self._compute_relation(agg_only)
            merged_rows = _merge_relation_rows(rel_agg.rows, rel_dist.rows)
            rel = OutputRelation(
                rows=merged_rows,
                output_keys=rel_agg.output_keys,
                measure_names=[m.name for m in measures],
                total=len(merged_rows),
                evidence_mode=False,
                has_more=rel_agg.has_more or rel_dist.has_more,
                cursor_next=rel_agg.cursor_next,
            )
            return _apply_post_sort(self._apply_derives(formula, rel), formula)

        select_parts = [f"{e} AS k_{i}" for i, (_, e) in enumerate(dim_sql)]
        agg_parts: list[str] = []
        if dist:
            dm = dist[0]
            dacc, dp = accessor_for(parse_explosion_chain(dm.path), dm.path, "distv_fp")
            params.update(dp)
            select_parts.append(f"{dacc} AS distval")
            agg_parts.append("count(*) AS m_cnt")
            group_cols = ", ".join(
                [e for _, e in dim_sql] + [dacc]
            ) or "1"
        else:
            # Per-row weight (the GGL case): a numeric/enum-lifted expr that
            # multiplies value in sum, and forms a weighted mean. min/max/
            # median/mode stay unweighted (weighted order-stats are out of
            # scope — documented).
            w_expr: str | None = None
            if formula.weight is not None and formula.weight.path:
                wacc, wp = accessor_for(
                    parse_explosion_chain(formula.weight.path),
                    formula.weight.path, "wt_fp",
                )
                params.update(wp)
                w_expr = _numeric_lift_sql(wacc, formula.weight.enum_weights)

            for j, m in enumerate(measures):
                if m.agg == "count":
                    agg_parts.append(f"count(*) AS m_{j}")
                    continue
                vacc, vp = accessor_for(
                    parse_explosion_chain(m.path), m.path, f"mv{j}_fp"
                )
                params.update(vp)
                # numeric value: enum_weights lift if declared, else safe cast
                vnum = _numeric_lift_sql(vacc, m.enum_weights)
                if m.agg == "sum":
                    expr = (
                        f"sum(({w_expr})*({vnum}))" if w_expr else f"sum({vnum})"
                    )
                    agg_parts.append(f"{expr} AS m_{j}")
                elif m.agg == "mean":
                    expr = (
                        f"sum(({w_expr})*({vnum}))/NULLIF(sum({w_expr}),0)"
                        if w_expr else f"avg({vnum})"
                    )
                    agg_parts.append(f"{expr} AS m_{j}")
                elif m.agg in ("min", "max"):
                    agg_parts.append(f"{m.agg}({vnum}) AS m_{j}")
                elif m.agg == "median":
                    agg_parts.append(
                        f"percentile_cont(0.5) WITHIN GROUP "
                        f"(ORDER BY {vnum}) AS m_{j}"
                    )
                elif m.agg == "mode":
                    # mode of a category → the label itself, not its weight
                    agg_parts.append(
                        f"mode() WITHIN GROUP (ORDER BY {vacc}) AS m_{j}"
                    )
            if not agg_parts:
                agg_parts.append("count(*) AS m_cnt")
            group_cols = ", ".join(e for _, e in dim_sql) or "1"

        # ORDER BY — explicit override (Formula.order_by) or smart default.
        # Default: time ASC if a time dim is present (chronological);
        # otherwise first non-derive measure DESC (biggest-first — what
        # pies and bars want). order_by on a derive defers to a post-eval
        # Python sort applied by _apply_post_sort.
        ob = formula.order_by
        sql_order: str | None = None
        if ob is not None:
            di = next((i for i, (n, _) in enumerate(dim_sql) if n == ob.column), None)
            if di is not None:
                sql_order = f"k_{di} {ob.direction.upper()} NULLS LAST"
            else:
                mi = next(
                    (j for j, m in enumerate(measures) if m.name == ob.column),
                    None,
                )
                if mi is not None and not dist:
                    sql_order = f"m_{mi} {ob.direction.upper()} NULLS LAST"
                elif any(s.name == ob.column for s in formula.derives):
                    # post-eval sort; SQL falls back to group cols for determinism
                    sql_order = (
                        group_cols if group_cols and group_cols != "1" else "1"
                    )
                else:
                    raise ValueError(
                        f"order_by column {ob.column!r} matches no dim, "
                        f"measure, or derive on this formula"
                    )
        if sql_order is None:
            time_idx = next(
                (i for i, (d, _) in enumerate(dim_chains) if d.kind == "time"),
                None,
            )
            if time_idx is not None:
                sql_order = f"k_{time_idx} ASC NULLS LAST"
            elif not dist and any(m.agg != "top" for m in measures):
                sql_order = "m_0 DESC NULLS LAST"
            else:
                sql_order = group_cols if group_cols and group_cols != "1" else "1"

        # Pagination — no more silent truncation. ``distribution`` folds in
        # Python so its groups must all be present: bound high + flag, no
        # offset. Everything else: keyset-free offset paging with has_more.
        lim = max(1, min(self._limit, 5000))
        off = self._cursor if isinstance(self._cursor, int) and self._cursor > 0 else 0
        page_has_more = False
        page_cursor_next: str | None = None
        if dist:
            sql = f"""
                SELECT {', '.join(select_parts + agg_parts)}
                FROM {from_clause}
                WHERE {where}
                GROUP BY {group_cols}
                ORDER BY {sql_order}
                LIMIT 20001
            """
            rows = self._session.exec(text(sql).bindparams(**params)).all()
            if len(rows) > 20000:
                page_has_more = True
                rows = rows[:20000]
        else:
            sql = f"""
                SELECT {', '.join(select_parts + agg_parts)}
                FROM {from_clause}
                WHERE {where}
                GROUP BY {group_cols}
                ORDER BY {sql_order}
                LIMIT {lim + 1} OFFSET {off}
            """
            rows = self._session.exec(text(sql).bindparams(**params)).all()
            if len(rows) > lim:
                page_has_more = True
                page_cursor_next = str(off + lim)
                rows = rows[:lim]

        out = []
        if dist:
            dm = dist[0]
            folded: dict[tuple, OutputRow] = {}
            for r in rows:
                rd = dict(r._mapping)
                key = {dim_sql[i][0]: ("" if rd.get(f"k_{i}") is None else str(rd[f"k_{i}"]))
                       for i in range(len(dim_sql))}
                kt = tuple(key.values())
                row = folded.get(kt)
                if row is None:
                    row = OutputRow(keys=key, measures={dm.name: {}})
                    folded[kt] = row
                dv = rd.get("distval")
                row.measures[dm.name][("" if dv is None else str(dv))] = int(rd["m_cnt"])
            out = list(folded.values())
        else:
            for r in rows:
                rd = dict(r._mapping)
                key = {dim_sql[i][0]: ("" if rd.get(f"k_{i}") is None else str(rd[f"k_{i}"]))
                       for i in range(len(dim_sql))}
                mv: dict[str, Any] = {}
                for j, m in enumerate(measures):
                    raw = rd.get(f"m_{j}", rd.get("m_cnt"))
                    mv[m.name] = float(raw) if isinstance(raw, (int, float)) else raw
                if not measures:
                    mv["count"] = int(rd.get("m_cnt", 0))
                out.append(OutputRow(keys=key, measures=mv))

        rel = OutputRelation(
            rows=out, output_keys=key_names,
            measure_names=[m.name for m in measures] or ["count"],
            total=len(out), evidence_mode=False,
            has_more=page_has_more, cursor_next=page_cursor_next,
        )
        return _apply_post_sort(self._apply_derives(formula, rel), formula)

    def _apply_derives(self, formula, rel: OutputRelation) -> OutputRelation:
        """Evaluate ``derive`` specs over the GROUPED relation (a handful of
        rows). Composition (``@formula[k].col``) resolves via the optional
        ``_formula_lookup`` attached to this query."""
        if not formula.derives:
            return rel
        from app.core.expr import evaluate as _expr_eval
        fl = getattr(self, "_formula_lookup", None)
        for row in rel.rows:
            ns: dict[str, Any] = {
                "keys": row.keys, "measures": row.measures,
                **row.keys, **row.measures,
            }
            for spec in formula.derives:
                try:
                    val = _expr_eval(spec.expr, ns, fl)
                except Exception as e:  # noqa: BLE001
                    logger.warning("derive %r failed: %s", spec.name, e)
                    val = None
                row.measures[spec.name] = val
                ns[spec.name] = val
            if formula.derives:
                rel.measure_names = rel.measure_names + [
                    s.name for s in formula.derives
                    if s.name not in rel.measure_names
                ]
        return rel


    # ------------------------------------------------------------------
    # Materialization 4: graph()
    # ------------------------------------------------------------------

    def graph_stream(
        self,
        triplet_field: str,
        *,
        dedup: str = "exact",
        top_n_nodes: int | None = 1000,
        top_n_edges: int | None = 5000,
        chunk_size: int = 500,
        edge_weight_field: str | None = None,
        edge_weight_mode: str = "count",
        forward_properties: list[Any] | None = None,
        node_group_by: str | None = None,
        edge_group_by: str | None = None,
        null_policy: str = "skip",
    ):
        """Chunked async iterator over the graph projection.

        Bounded-memory counterpart to ``graph()``. Delegates to
        ``stream_graph`` with an ``AnnotationGraphSource`` so ephemeral and
        persistent graph paths share one engine.

        The ``edge_weight_*``, ``forward_properties``, and ``*_group_by`` kwargs
        plumb through to the source's SQL SELECT + ``stream_graph``'s
        aggregation. All optional — omit them for the legacy count-only shape.
        """
        from app.api.modules.graph.stream import (
            AnnotationGraphSource,
            stream_graph,
        )
        return stream_graph(
            self._session,
            self._infospace_id,
            AnnotationGraphSource(
                query=self,
                triplet_field=triplet_field,
                dedup=dedup,
                edge_weight_field=edge_weight_field,
                edge_weight_mode=edge_weight_mode,
                forward_properties=list(forward_properties or []),
                node_group_by=node_group_by,
                edge_group_by=edge_group_by,
                null_policy=null_policy,
            ),
            top_n_nodes=top_n_nodes,
            top_n_edges=top_n_edges,
            chunk_size=chunk_size,
        )

    def graph(
        self,
        triplet_field: str,
        *,
        dedup: str = "exact",
        top_n_nodes: int | None = None,
        top_n_edges: int | None = None,
    ) -> GraphResult:
        """Entity/relationship network from annotation triplet arrays.

        .. deprecated::
            Use ``graph_stream`` (bounded-memory) or ``collect_graph`` from
            ``annotation.views`` (iterates ``graph_stream`` into a bounded
            result). This method ``array_agg(DISTINCT a.id)``s all source
            annotation ids per edge into a single row — at 5M-annotation
            scale a heavy-hitter edge can pack tens of MB into one row. The
            ``/view`` endpoint no longer calls this method; it remains only
            for direct callers that already handle smaller graphs.

        Extracts subject/predicate/object from the triplet array field,
        deduplicates, and returns nodes + edges.

        Args:
            triplet_field:  Array field containing triplet objects, e.g.
                            ``"relationships"`` (looked up in annotation.value).
            dedup:          Dedup strategy: "exact" or "normalized" (lowercase).
            top_n_nodes:    When set, cap the returned node list (after sort).
            top_n_edges:    When set, cap the returned edge list.
        """
        clauses, params = self._base_where()

        triplet_arr_acc = f"a.value->'{triplet_field}'"
        from_clause = (
            f"annotation a, LATERAL jsonb_array_elements("
            f"{safe_array_elements(triplet_arr_acc)}) AS triplet"
        )

        self._apply_conditions(
            clauses, params,
            element_alias="triplet",
            active_explosion=triplet_field,
        )

        where = " AND ".join(clauses)

        # Extract triplet fields
        subj_acc = "triplet->>'subject_name'"
        subj_type_acc = "triplet->>'subject_type'"
        pred_acc = "triplet->>'predicate'"
        obj_acc = "triplet->>'object_name'"
        obj_type_acc = "triplet->>'object_type'"

        # Apply merge map normalization if available
        mm = self._find_merge_map(f"{triplet_field}[*].subject_name")
        if mm:
            subj_acc = merge_case(mm, subj_acc)
            obj_acc = merge_case(mm, obj_acc)

        # Normalization for dedup
        if dedup == "normalized":
            subj_acc = f"lower({subj_acc})"
            obj_acc = f"lower({obj_acc})"
            pred_acc = f"lower({pred_acc})"

        # Aggregate edges: group by (subject, predicate, object)
        sql = f"""
            SELECT
                {subj_acc} AS subject_name,
                {subj_type_acc} AS subject_type,
                {pred_acc} AS predicate,
                {obj_acc} AS object_name,
                {obj_type_acc} AS object_type,
                count(*) AS weight,
                array_agg(DISTINCT a.id) AS annotation_ids
            FROM {from_clause}
            WHERE {where}
              AND triplet->>'subject_name' IS NOT NULL
              AND triplet->>'object_name' IS NOT NULL
            GROUP BY subject_name, subject_type, predicate, object_name, object_type
            ORDER BY weight DESC
        """

        rows = self._session.exec(text(sql).bindparams(**params)).all()

        # Build nodes and edges
        nodes_map: dict[str, GraphNode] = {}
        edges: list[GraphEdge] = []

        for row in rows:
            s_name = row.subject_name or ""
            s_type = row.subject_type or ""
            o_name = row.object_name or ""
            o_type = row.object_type or ""
            pred = row.predicate or ""
            ann_ids = list(row.annotation_ids) if row.annotation_ids else []

            s_id = _node_id(s_name, s_type)
            o_id = _node_id(o_name, o_type)

            if s_id not in nodes_map:
                nodes_map[s_id] = GraphNode(
                    id=s_id, name=s_name, type=s_type,
                    frequency=0, source_annotation_ids=[],
                )
            if o_id not in nodes_map:
                nodes_map[o_id] = GraphNode(
                    id=o_id, name=o_name, type=o_type,
                    frequency=0, source_annotation_ids=[],
                )

            nodes_map[s_id].frequency += row.weight
            nodes_map[o_id].frequency += row.weight

            # Collect unique annotation IDs per node
            for aid in ann_ids:
                if aid not in nodes_map[s_id].source_annotation_ids:
                    nodes_map[s_id].source_annotation_ids.append(aid)
                if aid not in nodes_map[o_id].source_annotation_ids:
                    nodes_map[o_id].source_annotation_ids.append(aid)

            edges.append(GraphEdge(
                source=s_id, target=o_id, predicate=pred, weight=row.weight,
            ))

        nodes = list(nodes_map.values())
        if top_n_nodes is not None:
            nodes = nodes[:top_n_nodes]
        if top_n_edges is not None:
            edges = edges[:top_n_edges]
        return GraphResult(nodes=nodes, edges=edges)

    # ------------------------------------------------------------------
    # Materialization 4: distinct_values()
    # ------------------------------------------------------------------

    def distinct_values(
        self,
        field_path: str,
        *,
        search: str | None = None,
        limit: int = 100,
    ) -> list["DistinctValueEntry"]:
        """Distinct values of a field (with optional prefix search) + counts.

        Feeds the panel Value Alias manager. Works the same way as
        ``aggregate(function='count')`` but with an ILIKE prefix pushed into
        the WHERE clause so a 5M-row scan doesn't happen on every keystroke.
        Applies any configured ``MergeMap`` so aliased buckets appear
        unified.

        Args:
            field_path: dotted path to the target field.
            search: optional ILIKE prefix — SQL adds ``field ILIKE 'search%'``.
            limit: max entries returned (capped at 1000).
        """
        limit = min(max(1, int(limit)), 1000)

        ep = parse_explosion(field_path)
        clauses, params = self._base_where()

        from_clause = "annotation a"
        element_alias: str | None = None
        active_explosion: str | None = None

        if ep.is_exploded:
            arr_acc, arr_params = jsonb_value_accessor(
                "a.value", ep.array_field, param_name="dv_expl_fp"
            )
            params.update(arr_params)
            from_clause = (
                f"annotation a, LATERAL jsonb_array_elements({safe_array_elements(arr_acc)}) AS elem"
            )
            element_alias = "elem"
            active_explosion = ep.array_field

        self._apply_conditions(
            clauses, params,
            element_alias=element_alias,
            active_explosion=active_explosion,
        )

        if ep.is_exploded:
            if ep.remainder:
                acc, acc_params = jsonb_accessor(
                    "elem", ep.remainder, param_name="dv_fp"
                )
            else:
                # Array of primitives — element itself is the value.
                acc = "elem #>> '{}'"
                acc_params = {}
        else:
            acc, acc_params = jsonb_accessor(
                "a.value", field_path, param_name="dv_fp"
            )
        params.update(acc_params)

        mm = self._find_merge_map(field_path)
        value_expr = merge_case(mm, acc) if mm else acc

        # Skip NULLs and empty strings.
        clauses.append(f"{acc} IS NOT NULL AND {acc} != ''")

        # ILIKE prefix search is parameterized — raw user input stays in
        # params, not inlined into SQL.
        if search:
            params["dv_search"] = f"{search}%"
            clauses.append(f"{value_expr} ILIKE :dv_search")

        where = " AND ".join(clauses)
        # Repeat the expression in GROUP BY rather than GROUP-BY-alias —
        # ``value`` is a pg reserved word in some contexts and can collide
        # with an annotation.value column reference when the alias is used
        # as the GROUP BY target.
        sql = f"""
            SELECT {value_expr} AS bucket, count(*) AS cnt
            FROM {from_clause}
            WHERE {where}
            GROUP BY {value_expr}
            ORDER BY cnt DESC
            LIMIT :dv_lim
        """
        params["dv_lim"] = limit

        rows = self._session.exec(text(sql).bindparams(**params)).all()
        return [
            DistinctValueEntry(value=str(r.bucket), count=int(r.cnt))
            for r in rows
        ]


class DistinctValueEntry(BaseModel):
    """One (value, count) row in a distinct-values result."""

    value: str
    count: int


def _node_id(name: str, entity_type: str) -> str:
    """Deterministic node ID from name + type."""
    raw = f"{name.lower().strip()}::{entity_type.lower().strip()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]
