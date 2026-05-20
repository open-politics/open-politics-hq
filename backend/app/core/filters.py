"""Shared filter language for query builders.

Both AssetQuery (content/query.py) and AnnotationQuery (annotation/query.py)
use these types and utilities. The filter language is also the format used by
cross-panel scopes in the frontend — scopes serialize as FilterSet objects and
are passed as query parameters to the analysis routes.

Three concerns live here:
  1. Pydantic models for the filter language (FieldCondition, FilterSet)
  2. Pydantic models for value normalization (MergeMap, MergeMapEntry)
  3. SQL generation utilities (jsonb_accessor, merge_case, parse_explosion)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, field_validator
from sqlalchemy import text


# ---------------------------------------------------------------------------
# Path validation
# ---------------------------------------------------------------------------

# Matches dotted field paths with optional [*] for array explosion.
# ``[*]`` may appear after any segment (``emails[*].sender``,
# ``doc.emails[*].sender``, ``a[*]``) but only once — the backend grammar
# supports a single explosion per path (``core.filters.parse_explosion``).
# Valid:   "sentiment", "doc.topics.0", "emails[*].sender",
#          "doc.emails[*].sender", "a[*].b.c"
# Invalid: ""; DROP TABLE", "foo[1]", "foo[*][*].bar"
_SEGMENT_RE = r"[a-zA-Z0-9_]+(?:\[\*\])?"
_PATH_RE = re.compile(rf"^{_SEGMENT_RE}(?:\.{_SEGMENT_RE})*$")


def _valid_path(path: str) -> bool:
    if not _PATH_RE.match(path):
        return False
    # At most one explosion marker — backend can't chain lateral joins on a
    # single accessor (would be a cartesian product on nested arrays).
    return path.count("[*]") <= 1


# ---------------------------------------------------------------------------
# Filter models
# ---------------------------------------------------------------------------

Operator = Literal[
    "eq", "ne",
    "gt", "ge", "lt", "le",
    "in", "not_in",
    "contains", "not_contains",
    "between",
    "exists", "not_exists",
    # Relational filter family: scope inspection by entity-pair co-occurrence.
    # Future siblings (relational.path, relational.cluster) plug in here as a
    # closed namespace — the operator string carries the family.
    "relational.cooccurs",
]


class FieldCondition(BaseModel):
    """Single condition on a JSONB field path.

    Paths use dot notation for nesting and ``[*]`` for array explosion::

        "sentiment"            top-level field
        "doc.topics.0"         nested path
        "emails[*].sender"     element field inside exploded array

    When a path contains ``[*]``, the query builder adds a lateral join on
    the array and evaluates the condition on each element.  Paths without
    ``[*]`` are evaluated directly on ``annotation.value``.

    For relational operators (``relational.*``), the ``path`` is conventionally
    ``"$"`` and the real configuration (entities, reach, target paths) lives
    in ``value``. The ``$`` placeholder is whitelisted by ``_valid_path``.
    """

    path: str
    operator: Operator
    value: Any = None

    @field_validator("path")
    @classmethod
    def _check_path(cls, v: str) -> str:
        # `$` is a placeholder for relational operators where the real target
        # lives in the value dict — see the FieldCondition docstring.
        if v == "$":
            return v
        if not _valid_path(v):
            raise ValueError(f"Invalid field path: {v!r}")
        return v


class FilterSet(BaseModel):
    """Composable filter with AND/OR logic.

    All analysis routes accept a JSON-encoded FilterSet as a query parameter.
    Cross-panel scopes are FilterSet objects.  Multiple FilterSets merge by
    wrapping them in an AND FilterSet.
    """

    logic: Literal["and", "or"] = "and"
    conditions: list[FieldCondition] = []


# ---------------------------------------------------------------------------
# Merge map models
# ---------------------------------------------------------------------------

class MergeMapEntry(BaseModel):
    """One normalization rule: raw values → canonical value."""

    keep: str
    names: list[str]
    type: str | None = None  # entity type override (graph merge maps)


class MergeMap(BaseModel):
    """Value normalization applied at query time via SQL CASE WHEN.

    Stored per-run in ``views_config``.  Same shape as the graph module's
    ``entity_merges`` in ``graph_config`` (convergence planned).
    """

    field_path: str
    entries: list[MergeMapEntry]

    @field_validator("field_path")
    @classmethod
    def _check_path(cls, v: str) -> str:
        if not _valid_path(v):
            raise ValueError(f"Invalid merge map field path: {v!r}")
        return v


# ---------------------------------------------------------------------------
# Path parsing
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class ExplosionPath:
    """Result of splitting a field path at ``[*]``.

    Attributes:
        array_field:   Part before ``[*]`` (e.g. ``"emails"``), or None.
        remainder:     Part after ``[*]`` (e.g. ``"sender"``), or the full
                       path if no explosion.
        is_exploded:   Whether the original path contained ``[*]``.
    """

    array_field: str | None
    remainder: str
    is_exploded: bool


def parse_explosion(path: str) -> ExplosionPath:
    """Split a field path at ``[*]`` into array and element parts.

    Single-level only — for ``mails[*].sender``-style paths used by
    ``FieldCondition`` / ``MergeMap`` and the legacy ``aggregate()`` /
    ``distinct_values()`` materialisations. Formula dim/measure paths use
    :func:`parse_explosion_chain` which supports nested explosions like
    ``mails[*].recipients[*]``.

    Examples::

        parse_explosion("emails[*].sender")
        → ExplosionPath(array_field="emails", remainder="sender", is_exploded=True)

        parse_explosion("emails[*].nested.field")
        → ExplosionPath(array_field="emails", remainder="nested.field", is_exploded=True)

        parse_explosion("sentiment")
        → ExplosionPath(array_field=None, remainder="sentiment", is_exploded=False)

        parse_explosion("emails[*]")
        → ExplosionPath(array_field="emails", remainder="", is_exploded=True)
    """
    marker = "[*]"
    idx = path.find(marker)
    if idx == -1:
        return ExplosionPath(array_field=None, remainder=path, is_exploded=False)

    array_field = path[:idx]
    after = path[idx + len(marker) :]
    remainder = after.lstrip(".")
    return ExplosionPath(array_field=array_field, remainder=remainder, is_exploded=True)


# ─── Multi-level explosion — the LATERAL ladder ─────────────────────────────


@dataclass(frozen=True, slots=True)
class ExplosionSegment:
    """One hop in a multi-level explosion chain.

    Each segment becomes one ``LATERAL jsonb_array_elements(parent->array_path)``
    in the engine's FROM clause. ``parent_alias`` is the SQL expression the
    array hangs off — ``"a.value"`` for the outermost segment, otherwise the
    previous segment's alias. ``alias`` is deterministic from depth +
    array_path so two paths sharing an outer array also share the same
    LATERAL (engine dedupes by alias).
    """

    parent_alias: str
    array_path: str
    alias: str


@dataclass(frozen=True, slots=True)
class ExplosionChain:
    """A path's full multi-level explosion + the leaf relative to the
    innermost element.

    Examples::

        parse_explosion_chain("mails[*].sender")
        → segments=[Segment(parent="a.value", array_path="mails", alias="_x0_mails")]
          leaf="sender"

        parse_explosion_chain("mails[*].recipients[*].email")
        → segments=[
              Segment(parent="a.value",   array_path="mails",      alias="_x0_mails"),
              Segment(parent="_x0_mails", array_path="recipients", alias="_x1_recipients"),
          ]
          leaf="email"

        parse_explosion_chain("mails[*].recipients[*]")
        → same two segments, leaf=""  (the element IS the value)

        parse_explosion_chain("country")
        → segments=(), leaf="country"
    """

    segments: tuple[ExplosionSegment, ...]
    leaf: str

    @property
    def is_exploded(self) -> bool:
        return bool(self.segments)

    @property
    def innermost_alias(self) -> str | None:
        return self.segments[-1].alias if self.segments else None

    @property
    def outer_array_path(self) -> str | None:
        """The outermost array path — what ``aggregate()`` would call
        ``array_field``. Used for back-compat with single-level filter
        condition matching against ``active_explosion``."""
        return self.segments[0].array_path if self.segments else None


def _safe_segment(s: str) -> str:
    """Normalise an array_path leaf into a SQL-alias-safe slug. Keeps
    alphanumerics + underscore; collapses anything else to ``_``."""
    out = []
    for ch in s:
        if ch.isalnum() or ch == "_":
            out.append(ch)
        else:
            out.append("_")
    slug = "".join(out).strip("_") or "x"
    return slug


def parse_explosion_chain(path: str) -> ExplosionChain:
    """Parse a path with zero or more ``[*]`` markers into a LATERAL ladder.

    Aliases are deterministic from ``(depth, last_segment_of_array_path)``
    so two paths sharing an outer array share the same alias — the engine
    builds each LATERAL exactly once. Two paths that disagree on an outer
    array (e.g. ``mails[*].sender`` vs ``calls[*].speaker``) would produce
    different aliases at depth 0 and a Cartesian product; the engine's tree
    builder rejects that explicitly.
    """
    segments: list[ExplosionSegment] = []
    cursor = path
    parent = "a.value"
    depth = 0
    while "[*]" in cursor:
        idx = cursor.find("[*]")
        array_path = cursor[:idx]
        cursor = cursor[idx + 3:].lstrip(".")
        last = array_path.rsplit(".", 1)[-1]
        alias = f"_x{depth}_{_safe_segment(last)}"
        segments.append(ExplosionSegment(
            parent_alias=parent, array_path=array_path, alias=alias,
        ))
        parent = alias
        depth += 1

    return ExplosionChain(segments=tuple(segments), leaf=cursor)


# ---------------------------------------------------------------------------
# JSONB accessor generation
# ---------------------------------------------------------------------------

def jsonb_accessor(
    column: str,
    path: str,
    *,
    param_name: str = "field_path",
    cast: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """Build a JSONB text accessor for a dotted field path.

    Returns ``(sql_fragment, params_dict)`` suitable for use with
    ``sqlalchemy.text(...).bindparams(**params)``.

    The accessor always extracts as text (``->>`` or ``#>>``).  Pass
    *cast* to wrap in a type cast, e.g. ``cast="float"`` produces
    ``(accessor)::float``.

    Examples::

        jsonb_accessor("a.value", "sentiment")
        → ("a.value->>:field_path", {"field_path": "sentiment"})

        jsonb_accessor("a.value", "doc.topics.0")
        → ("a.value #>> :field_path", {"field_path": "{doc,topics,0}"})

        jsonb_accessor("elem", "sender")
        → ("elem->>:field_path", {"field_path": "sender"})

        jsonb_accessor("a.value", "score", cast="float")
        → ("(a.value->>:field_path)::float", {"field_path": "score"})
    """
    parts = path.split(".")
    if len(parts) == 1:
        accessor = f"{column}->>{_p(param_name)}"
        params: dict[str, Any] = {param_name: path}
    else:
        # Three storage conventions coexist for hierarchical schemas:
        #   (A) flat key:        ``{"document.party": "FDP"}`` — dots INSIDE the key
        #   (B) nested path:     ``{"document": {"party": "FDP"}}``
        #   (C) unwrapped root:  ``{"party": "FDP"}`` — the annotation task
        #       (annotate.py) stores ``result["document"]`` directly at the
        #       value root, so ``document.X`` field paths from the picker need
        #       to resolve to ``X`` at runtime.
        # COALESCE across all three so the caller doesn't need to know which
        # convention applies. ``CAST(... AS text[])`` rather than ``::text[]``
        # because SQLAlchemy's text() bind-param regex skips ``:name::cast``.
        flat_param = param_name
        nested_param = f"{param_name}_arr"
        branches = [
            f"{column}->>{_p(flat_param)}",
            f"{column} #>> CAST({_p(nested_param)} AS text[])",
        ]
        params = {
            flat_param: path,
            nested_param: "{" + ",".join(parts) + "}",
        }
        if parts[0] == "document":
            unwrapped = parts[1:]
            unwrapped_param = f"{param_name}_unwrapped"
            if len(unwrapped) == 1:
                branches.append(f"{column}->>{_p(unwrapped_param)}")
                params[unwrapped_param] = unwrapped[0]
            else:
                unwrapped_arr_param = f"{param_name}_unwrapped_arr"
                branches.append(
                    f"{column} #>> CAST({_p(unwrapped_arr_param)} AS text[])"
                )
                params[unwrapped_arr_param] = "{" + ",".join(unwrapped) + "}"
        accessor = f"COALESCE({', '.join(branches)})"

    if cast:
        accessor = f"({accessor})::{cast}"

    return accessor, params


def jsonb_value_accessor(
    column: str,
    path: str,
    *,
    param_name: str = "field_path",
) -> tuple[str, dict[str, Any]]:
    """Build a JSONB **value** accessor (``->`` / ``#>``) for a dotted path.

    Counterpart to :func:`jsonb_accessor`. That returns text via ``->>``/``#>>``;
    this returns the underlying JSONB node via ``->``/``#>``, suitable for
    wrapping in ``jsonb_array_elements(...)`` or further JSONB drill-downs.

    Honors the same three storage conventions as ``jsonb_accessor`` so callers
    don't need to know which one the annotation task wrote. Returns the first
    non-NULL branch via ``COALESCE``.

    Examples::

        jsonb_value_accessor("a.value", "topics")
        → ("a.value->:field_path", {"field_path": "topics"})

        jsonb_value_accessor("a.value", "document.topics")
        → COALESCE across flat-with-dots / nested / unwrapped-root.
    """
    parts = path.split(".")
    if len(parts) == 1:
        accessor = f"{column}->{_p(param_name)}"
        params: dict[str, Any] = {param_name: path}
        return accessor, params

    flat_param = param_name
    nested_param = f"{param_name}_arr"
    branches = [
        f"{column}->{_p(flat_param)}",
        f"{column} #> CAST({_p(nested_param)} AS text[])",
    ]
    params = {
        flat_param: path,
        nested_param: "{" + ",".join(parts) + "}",
    }
    if parts[0] == "document":
        unwrapped = parts[1:]
        unwrapped_param = f"{param_name}_unwrapped"
        if len(unwrapped) == 1:
            branches.append(f"{column}->{_p(unwrapped_param)}")
            params[unwrapped_param] = unwrapped[0]
        else:
            unwrapped_arr_param = f"{param_name}_unwrapped_arr"
            branches.append(
                f"{column} #> CAST({_p(unwrapped_arr_param)} AS text[])"
            )
            params[unwrapped_arr_param] = "{" + ",".join(unwrapped) + "}"
    return f"COALESCE({', '.join(branches)})", params


def _p(name: str) -> str:
    """Format a bind-parameter placeholder."""
    return f":{name}"


def safe_array_elements(expr: str) -> str:
    """Wrap a JSONB expression so ``jsonb_array_elements`` can never fault.

    ``jsonb_array_elements`` raises ``cannot extract elements from a scalar``
    when given anything other than a JSONB array — including JSONB ``null``,
    which is a value (not SQL NULL) and so survives ``COALESCE``. The LLM
    routinely emits ``"field": null`` for unfilled optional arrays, so every
    explosion call-site that targets a user-defined field must guard against
    it. Use::

        f"jsonb_array_elements({safe_array_elements(arr_acc)}) AS elem"

    Returns ``[]::jsonb`` when *expr* is null/scalar/object — same effect as
    "no rows" without a runtime error.
    """
    return f"CASE WHEN jsonb_typeof({expr}) = 'array' THEN {expr} ELSE '[]'::jsonb END"


# ---------------------------------------------------------------------------
# Merge map → SQL CASE WHEN
# ---------------------------------------------------------------------------

def merge_case(
    merge_map: MergeMap,
    accessor: str,
) -> str:
    """Build a SQL CASE expression for value normalization.

    The caller provides the *accessor* (a SQL fragment that extracts the
    raw value as text, e.g. ``"elem->>'party'"``).  The returned CASE
    expression normalizes values according to the merge map entries.

    Values are compared case-insensitively via ``lower()``.

    Example output::

        CASE
          WHEN lower(elem->>'party') IN ('sozialdemokratische partei deutschlands','spd') THEN 'SPD'
          WHEN lower(elem->>'party') IN ('christlich demokratische union','cdu') THEN 'CDU'
          ELSE elem->>'party'
        END

    Note: values are inlined (not parameterized) because merge maps are
    user-curated, per-run config — not external input.  Names are escaped
    via single-quote doubling to prevent SQL injection.
    """
    if not merge_map.entries:
        return accessor

    branches: list[str] = []
    for entry in merge_map.entries:
        escaped_names = ", ".join(
            f"'{_sql_escape(n.lower())}'" for n in entry.names
        )
        escaped_keep = _sql_escape(entry.keep)
        branches.append(
            f"WHEN lower({accessor}) IN ({escaped_names}) THEN '{escaped_keep}'"
        )

    return f"CASE {' '.join(branches)} ELSE {accessor} END"


def apply_merge_map_value(merge_map: MergeMap | None, raw_value: str | None) -> str | None:
    """Python-side mirror of :func:`merge_case` — used by the projection
    engine's per-row loop where canon resolution and snippet extraction
    happen outside SQL.

    Returns the normalised value when an entry matches (case-insensitive),
    the raw value otherwise. ``None`` short-circuits to ``None``.

    Same casing convention as ``merge_case``: ``lower()`` on both sides
    of the comparison.
    """
    if raw_value is None:
        return None
    if merge_map is None or not merge_map.entries:
        return raw_value
    norm = raw_value.lower()
    for entry in merge_map.entries:
        for name in entry.names:
            if name.lower() == norm:
                return entry.keep
    return raw_value


def _sql_escape(value: str) -> str:
    """Escape single quotes for SQL string literals."""
    return value.replace("'", "''")


# ---------------------------------------------------------------------------
# Condition → SQL fragment
# ---------------------------------------------------------------------------

def condition_sql(
    cond: FieldCondition,
    column: str,
    *,
    param_prefix: str = "c",
) -> tuple[str, dict[str, Any]]:
    """Compile a FieldCondition into a SQL fragment + bind params.

    The *column* is the JSONB column or element alias to access
    (e.g. ``"annotation.value"`` or ``"elem"``).

    Uses the raw field remainder (after any explosion stripping done by
    the caller).  The caller is responsible for handling ``[*]`` paths
    by setting up lateral joins and passing the element alias as *column*.

    Returns ``(sql_fragment, params)`` or raises ValueError for unknown ops.
    """
    # Relational operators are pre-handled — they don't fit the single-path
    # FieldCondition shape (multi-entity, multi-path) so they generate their
    # own SQL via dedicated helpers.
    if cond.operator == "relational.cooccurs":
        return _cooccurs_sql(cond, column, param_prefix=param_prefix)

    ep = parse_explosion(cond.path)
    # If the path has [*], the caller should have split it already and
    # passed the element alias.  We use the remainder for the accessor.
    field = ep.remainder if ep.is_exploded else cond.path

    if not field and cond.operator not in ("exists", "not_exists"):
        # Path like "emails[*]" with no field — only exists/not_exists make sense
        raise ValueError(f"No field after [*] for operator {cond.operator}")

    params: dict[str, Any] = {}
    pp = param_prefix  # shorter alias

    if cond.operator in ("exists", "not_exists"):
        if not field:
            # Existence of the array itself — check on the original column
            # before explosion.  Caller handles this differently.
            fragment = "TRUE"  # placeholder; caller should handle array existence
        else:
            parts = field.split(".")
            if len(parts) == 1:
                fragment = f"{column} ? {_p(f'{pp}_fp')}"
                params[f"{pp}_fp"] = field
            else:
                acc, acc_params = jsonb_accessor(column, field, param_name=f"{pp}_fp")
                params.update(acc_params)
                fragment = f"({acc}) IS NOT NULL"
        if cond.operator == "not_exists":
            fragment = f"NOT ({fragment})"
        return fragment, params

    acc, acc_params = jsonb_accessor(column, field, param_name=f"{pp}_fp")
    params.update(acc_params)

    op = cond.operator
    val = cond.value

    if op == "eq":
        fragment = f"({acc})::text = {_p(f'{pp}_val')}"
        params[f"{pp}_val"] = str(val)

    elif op == "ne":
        fragment = f"({acc})::text != {_p(f'{pp}_val')}"
        params[f"{pp}_val"] = str(val)

    elif op in ("gt", "ge", "lt", "le"):
        sql_op = {"gt": ">", "ge": ">=", "lt": "<", "le": "<="}[op]
        try:
            params[f"{pp}_val"] = float(val)
            fragment = f"({acc})::float {sql_op} {_p(f'{pp}_val')}"
        except (ValueError, TypeError):
            params[f"{pp}_val"] = str(val)
            fragment = f"({acc})::text {sql_op} {_p(f'{pp}_val')}"

    elif op == "in":
        vals = val if isinstance(val, list) else [val]
        str_vals = [str(v) for v in vals]
        params[f"{pp}_val"] = str_vals
        fragment = f"({acc})::text = ANY({_p(f'{pp}_val')})"

    elif op == "not_in":
        vals = val if isinstance(val, list) else [val]
        str_vals = [str(v) for v in vals]
        params[f"{pp}_val"] = str_vals
        fragment = f"({acc})::text != ALL({_p(f'{pp}_val')})"

    elif op == "contains":
        params[f"{pp}_val"] = f"%{val}%"
        fragment = f"{acc} ILIKE {_p(f'{pp}_val')}"

    elif op == "not_contains":
        params[f"{pp}_val"] = f"%{val}%"
        fragment = f"{acc} NOT ILIKE {_p(f'{pp}_val')}"

    elif op == "between":
        if not isinstance(val, (list, tuple)) or len(val) != 2:
            raise ValueError("'between' operator requires a 2-element list [low, high]")
        try:
            params[f"{pp}_lo"] = float(val[0])
            params[f"{pp}_hi"] = float(val[1])
            fragment = (
                f"({acc})::float BETWEEN {_p(f'{pp}_lo')} AND {_p(f'{pp}_hi')}"
            )
        except (ValueError, TypeError):
            params[f"{pp}_lo"] = str(val[0])
            params[f"{pp}_hi"] = str(val[1])
            fragment = (
                f"({acc})::text BETWEEN {_p(f'{pp}_lo')} AND {_p(f'{pp}_hi')}"
            )

    else:
        raise ValueError(f"Unknown operator: {op!r}")

    return fragment, params


# ---------------------------------------------------------------------------
# relational.cooccurs — entity-pair co-occurrence scope
# ---------------------------------------------------------------------------

def _cooccurs_sql(
    cond: FieldCondition,
    column: str,
    *,
    param_prefix: str = "c",
) -> tuple[str, dict[str, Any]]:
    """SQL for ``relational.cooccurs``: rows where every named entity appears
    in at least one of the listed entity-typed paths.

    Value shape::

        {
          "entities": ["Merkel", "Macron"],          # 2+ names; pairwise-AND
          "reach":    "annotation" | "asset",        # default: "annotation"
          "paths":    ["actors[*]", "mails[*].sender"]   # entity-typed paths
        }

    For each entity X we OR across paths (X may live in any of them); we then
    AND across entities (every entity must appear). This is "all of these
    appear somewhere on the same annotation/asset".

    Path conventions (entity field shape from the schema editor's adapter):
    every entity-typed leaf is an object ``{name, type?, additional_types?}``,
    so the comparison is always ``elem->>'name' = X`` (or ``(...)->>'name'``
    for non-array paths). ``[*]`` in a path triggers a LATERAL via
    ``jsonb_array_elements``.

    ``reach="asset"`` wraps the body in a self-join via the annotation table
    on ``asset_id``: any annotation belonging to the same asset is searched
    rather than just the focal annotation row. ``column`` MUST be ``a.value``
    in this case (the alias is part of the SQL we emit). ``reach="same_level"``
    requires every entity to appear within a *shared parent* — the same array
    element for exploded paths (e.g. one mail with both sender=A and
    receiver=B), or the annotation root for non-exploded paths. Implemented
    by grouping paths by their array prefix and OR-ing across groups: any
    shared parent that holds every entity satisfies the row.
    """
    val = cond.value or {}
    if not isinstance(val, dict):
        raise ValueError("relational.cooccurs: value must be an object")
    entities = val.get("entities") or []
    paths = val.get("paths") or []
    reach = val.get("reach", "annotation")

    if not isinstance(entities, list) or len(entities) < 1:
        raise ValueError("relational.cooccurs: 'entities' must be a list of 1+ names")
    if not isinstance(paths, list) or len(paths) == 0:
        raise ValueError("relational.cooccurs: 'paths' must list at least one entity-typed field")
    if reach not in ("annotation", "asset", "same_level"):
        raise ValueError(f"relational.cooccurs: unknown reach {reach!r}")

    pp = param_prefix
    params: dict[str, Any] = {}

    # Build the "entity X appears in any path" sub-fragment for one entity name.
    def per_entity(eidx: int, name: str, scope_column: str) -> str:
        params[f"{pp}_e{eidx}_name"] = str(name)
        per_path: list[str] = []
        for pidx, p in enumerate(paths):
            if not isinstance(p, str) or not _valid_path(p):
                raise ValueError(f"relational.cooccurs: invalid path {p!r}")
            ep = parse_explosion(p)
            param_root = f"{pp}_e{eidx}_p{pidx}"
            if ep.is_exploded:
                # Array of entity objects: lateral-extract, match by name.
                arr_path = ep.array_field or ""
                if not arr_path:
                    continue
                arr_acc, arr_params = jsonb_value_accessor(
                    scope_column, arr_path, param_name=f"{param_root}_arr",
                )
                params.update(arr_params)
                inner_path = ep.remainder  # e.g. "" for "actors[*]", "sender" for "mails[*].sender"
                if inner_path:
                    inner_acc, inner_params = jsonb_accessor(
                        "elem", f"{inner_path}.name", param_name=f"{param_root}_inner",
                    )
                    params.update(inner_params)
                    elem_match = inner_acc
                else:
                    # Direct entity-array, e.g. actors[*] — element IS the entity object.
                    elem_match = f"elem->>{_p(f'{param_root}_namekey')}"
                    params[f"{param_root}_namekey"] = "name"
                per_path.append(
                    f"EXISTS (SELECT 1 FROM jsonb_array_elements({safe_array_elements(arr_acc)}) AS elem "
                    f"WHERE {elem_match} = {_p(f'{pp}_e{eidx}_name')})"
                )
            else:
                # Single entity at this path: object {name, type?}.
                acc, acc_params = jsonb_accessor(
                    scope_column, f"{p}.name", param_name=f"{param_root}_name",
                )
                params.update(acc_params)
                per_path.append(f"({acc}) = {_p(f'{pp}_e{eidx}_name')}")
        if not per_path:
            return "FALSE"
        return "(" + " OR ".join(per_path) + ")"

    if reach == "annotation":
        per_entity_clauses = [per_entity(i, e, column) for i, e in enumerate(entities)]
        return "(" + " AND ".join(per_entity_clauses) + ")", params

    if reach == "asset":
        # Entities anywhere across the asset's annotations. Wrap each entity
        # check in a subquery against the annotation table joined on
        # asset_id. The outer query alias is conventionally `a` (the same
        # alias AnnotationQuery uses); we use `a2` for the inner.
        per_entity_clauses: list[str] = []
        for i, name in enumerate(entities):
            inner_body = per_entity(i, name, "a2.value")
            per_entity_clauses.append(
                f"EXISTS (SELECT 1 FROM annotation a2 WHERE a2.asset_id = a.asset_id AND ({inner_body}))"
            )
        return "(" + " AND ".join(per_entity_clauses) + ")", params

    # reach == "same_level" — entities must share a parent. Group paths by
    # their array prefix; each group's clause asserts every entity appears in
    # some path within that group at a shared parent (annotation root for
    # non-exploded paths, or the same array element for exploded ones).
    # OR across groups: any single shared parent satisfies the row.
    #
    # Worked examples:
    #   paths=[mails[*].sender, mails[*].receiver], entities=[A,B]
    #     → one group "mails": EXISTS one mail where (A in sender OR receiver)
    #       AND (B in sender OR receiver). Mail with sender=A, receiver=B
    #       passes. Two mails (one with A, one with B) does NOT — they aren't
    #       in the same parent.
    #   paths=[author, editor], entities=[A,B]
    #     → one root group: AND across entities of OR across paths at root.
    #       Annotation with author=A, editor=B passes.
    #   paths=[mails[*].sender, author], entities=[A,B]
    #     → two groups, neither has more than one path → neither group can
    #       cover both entities. Returns FALSE.
    #   paths=[actors[*]], entities=[A,B]
    #     → one group "actors". Each element is one entity; element can't be
    #       both A and B. Returns FALSE.
    groups: dict[str | None, list[tuple[int, str]]] = {}
    group_order: list[str | None] = []
    for pidx, p in enumerate(paths):
        if not isinstance(p, str) or not _valid_path(p):
            raise ValueError(f"relational.cooccurs: invalid path {p!r}")
        ep = parse_explosion(p)
        key = ep.array_field if ep.is_exploded else None
        if key not in groups:
            groups[key] = []
            group_order.append(key)
        groups[key].append((pidx, p))

    group_clauses: list[str] = []
    for gidx, key in enumerate(group_order):
        paths_in_group = groups[key]
        if key is None:
            # Non-exploded group: AND-of-entity-OR-of-paths at annotation root.
            ent_clauses: list[str] = []
            for eidx, name in enumerate(entities):
                params[f"{pp}_e{eidx}_name"] = str(name)
                per_path: list[str] = []
                for pidx, p in paths_in_group:
                    param_root = f"{pp}_e{eidx}_p{pidx}"
                    acc, acc_params = jsonb_accessor(
                        column, f"{p}.name", param_name=f"{param_root}_name",
                    )
                    params.update(acc_params)
                    per_path.append(f"({acc}) = {_p(f'{pp}_e{eidx}_name')}")
                ent_clauses.append("(" + " OR ".join(per_path) + ")")
            group_clauses.append("(" + " AND ".join(ent_clauses) + ")")
        else:
            # Exploded group: walk array once; inside each element AND across
            # entities of OR across the group's inner paths.
            arr_acc, arr_params = jsonb_value_accessor(
                column, key, param_name=f"{pp}_g{gidx}_arr",
            )
            params.update(arr_params)
            ent_clauses = []
            for eidx, name in enumerate(entities):
                params[f"{pp}_e{eidx}_name"] = str(name)
                per_path = []
                for pidx, p in paths_in_group:
                    ep = parse_explosion(p)
                    param_root = f"{pp}_e{eidx}_p{pidx}"
                    inner_path = ep.remainder
                    if inner_path:
                        inner_acc, inner_params = jsonb_accessor(
                            "elem", f"{inner_path}.name",
                            param_name=f"{param_root}_inner",
                        )
                        params.update(inner_params)
                        per_path.append(f"({inner_acc}) = {_p(f'{pp}_e{eidx}_name')}")
                    else:
                        # Direct entity-array element — element IS the entity.
                        per_path.append(
                            f"elem->>{_p(f'{param_root}_namekey')} = {_p(f'{pp}_e{eidx}_name')}"
                        )
                        params[f"{param_root}_namekey"] = "name"
                ent_clauses.append("(" + " OR ".join(per_path) + ")")
            group_clauses.append(
                f"EXISTS (SELECT 1 FROM jsonb_array_elements({safe_array_elements(arr_acc)}) AS elem "
                f"WHERE " + " AND ".join(ent_clauses) + ")"
            )

    if not group_clauses:
        return "FALSE", params
    return "(" + " OR ".join(group_clauses) + ")", params
