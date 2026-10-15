"""Overview — a run read as where, when, who and how much.

The front door of a run. Not its rows: **buckets** of rows. Every coordinate
in an annotation is a place *name* resolved to a point, so five thousand rows
saying "Berlin" are one mark however they are shipped; and buckets are bounded
by distinct places × time cells × sections, whatever the size of the corpus.
Rows come back only when someone opens a bucket.

One reading, four counts::

    row stream     one row per section element (or per annotation, for the
                   document): section · rung · place · time · asset
                   ── a place-array fans out, one row per place ──
        │
        ├─ row        (section, rung, place, cell)  → rows        Rows / Sections modes
        ├─ asset      (rung, place, asset cell)     → assets      Assets mode
        ├─ asset_time (asset cell)                  → assets      totals, histogram
        └─ place      (place)                       → rows, assets   the Places list

**Rungs never render alike.** A row placed by its own binding (``row``) and one
placed only by its document (``doc``) are different claims — "the meeting was
in Valletta" against "this filing is about Malta" — so they are separate
buckets end to end.

**Asset time is per asset.** Each asset sits in exactly one asset-time cell
(the document's date, else the file's ``event_timestamp``), so distinct-asset
counts add across time and a brushed total is a plain sum. Across places they
do not add — an asset mentions many — and nothing here pretends they do.

Rows are read under the same run scope every other surface uses
(``AnnotationQuery._base_where``: run, package scope, failed rows excluded),
with the run's aliases applied. Where each section's rows are, and when, is
decided by ``annotation/bindings.py``; what a place name *is* by
``graph/places.py``.

**Opening a count.** :func:`assets_for` lists the assets behind one place or
one entity, read off the very streams that counted them and matched on every
spelling the canon folded into the identity (``graph.places.spellings_of``) —
so the list a marker opens is the list the marker counted, by construction.

**Within an entity.** ``within`` narrows a whole reading to the assets that
name one entity: the map shows where it is spoken of, the ranks who appears
beside it. Asset-level co-occurrence, the same unit the Entities list ranks by.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping

from sqlalchemy import text
from sqlmodel import Session

from app.api.modules.annotation.bindings import (
    Pick, SchemaPlan, SectionPlan, discover_spatial, plan_schema, spatial_from,
    undecided_places,
)
from app.api.modules.annotation.query import AnnotationQuery, _safe_timestamptz_sql
from app.api.modules.annotation.schema_map import FieldNode, schema_map_for, strip_explosions
from app.core.filters import (
    MergeMap, jsonb_accessor, jsonb_value_accessor, merge_case, parse_explosion_chain,
    safe_array_elements,
)

logger = logging.getLogger(__name__)

__all__ = [
    "RunScope", "open_scope", "frame", "schema_plans", "buckets", "entities", "assets_for",
]

#: Ranked entities shipped per load.
_TOP_ENTITIES = 60
#: Row buckets shipped per load; the remainder is reported, never dropped silently.
_MAX_ROW_BUCKETS = 20000
#: Not-located places shipped by name — the rest are a count.
_TOP_UNLOCATED = 150


# ─── Scope ──────────────────────────────────────────────────────────────────


@dataclass
class RunScope:
    """Which rows, and how their values are normalised — never what they mean.

    The part of a request that is *which panel you are in*: the run, the
    reader's package grant, the run's alias library and the canon it resolves
    against. Built once per request; every read below goes through
    :meth:`query`, so no stage can see rows another stage cannot.
    """

    session: Session
    infospace_id: int
    run_id: int
    run: Any
    package_scope: Any = None
    merge_maps: list[MergeMap] = field(default_factory=list)
    canon_ids: tuple[int, ...] = ()
    geo_canon_id: int | None = None

    def query(self, *, include_failed: bool = False) -> AnnotationQuery:
        aq = AnnotationQuery(self.session, self.infospace_id).scope(self.package_scope)
        aq.runs([self.run_id])
        if not include_failed:
            aq.exclude_failed()
        for mm in self.merge_maps:
            aq.merge(mm)
        return aq


def open_scope(
    session: Session,
    access: Any,
    run_id: int,
    *,
    panel_merge_maps: Iterable[MergeMap] = (),
) -> RunScope:
    from app.api.modules.annotation.models import AnnotationRun
    from app.models import Infospace

    run = session.get(AnnotationRun, run_id)
    if run is None or run.infospace_id != access.infospace_id:
        raise LookupError(f"run {run_id} not found")
    views = run.views_config if isinstance(run.views_config, dict) else {}
    aliases = [MergeMap.model_validate(m) for m in (views.get("aliases") or [])]
    infospace = session.get(Infospace, access.infospace_id)
    # The JSON functions defeat the planner's row estimates (100 rows per
    # call against a handful actual), so every overview statement looks
    # expensive enough to JIT-compile — which then costs more than running
    # it: 7 s against 3 s on a 1,400-annotation run. Off for this
    # transaction only.
    session.execute(text("SET LOCAL jit = off"))
    return RunScope(
        session=session,
        infospace_id=access.infospace_id,
        run_id=run_id,
        run=run,
        package_scope=access.scope,
        # Panel aliases first — first match wins, as everywhere else.
        merge_maps=[*panel_merge_maps, *aliases],
        canon_ids=tuple(c for c in (run.canon_ids or []) if c),
        geo_canon_id=getattr(infospace, "default_geo_canon_id", None),
    )


# ─── Stage 1: frame ─────────────────────────────────────────────────────────


def frame(scope: RunScope) -> dict[str, Any]:
    """Denominators, cheaply. Everything the HUD needs to say *of how many*
    before a single bucket exists — and the watermark later stages resume from.
    """
    clauses, params = scope.query(include_failed=True)._base_where(include_cursor=False)
    row = scope.session.execute(text(f"""
        SELECT count(*) FILTER (WHERE LOWER(a.status::text) <> 'failed') AS ok,
               count(*) FILTER (WHERE LOWER(a.status::text) = 'failed')  AS failed,
               count(DISTINCT a.asset_id) FILTER (WHERE LOWER(a.status::text) <> 'failed') AS assets,
               max(a.id) AS watermark
        FROM annotation a WHERE {' AND '.join(clauses)}
    """), params).one()
    run = scope.run
    status = getattr(run.status, "value", run.status)
    return {
        "run": {
            "id": scope.run_id, "status": str(status).lower(), "live": bool(run.live),
            "progress": [run.progress_current or 0, run.progress_total or 0],
        },
        "totals": {"annotations": row.ok, "failed": row.failed, "assets": row.assets},
        "watermark": row.watermark or 0,
    }


# ─── Stage 2: plans ─────────────────────────────────────────────────────────


def schema_plans(
    scope: RunScope,
    picks: Mapping[str, Pick] | None = None,
) -> tuple[list[SchemaPlan], dict[int, dict[str, tuple[int, int]]]]:
    """One :class:`SchemaPlan` per schema in the run, discovery included.

    Returns the plans and, per schema, the discovery numbers behind them — so
    a picker can show *why* a field was or was not taken as a place.
    """
    clauses, params = scope.query()._base_where(include_cursor=False)
    rows = scope.session.execute(text(f"""
        SELECT s.id, s.name, s.output_contract
        FROM annotationschema s
        WHERE s.id IN (SELECT DISTINCT a.schema_id FROM annotation a
                       WHERE {' AND '.join(clauses)})
        ORDER BY s.id
    """), params).fetchall()

    plans: list[SchemaPlan] = []
    stats: dict[int, dict[str, tuple[int, int]]] = {}
    for sid, name, contract in rows:
        try:
            smap = schema_map_for(contract)
        except Exception:  # noqa: BLE001 — a broken contract is one dark schema, not a dark panel
            logger.warning("overview: schema %s has no usable map", sid, exc_info=True)
            continue
        draft = plan_schema(sid, name, smap, picks=picks)
        need = undecided_places(draft)
        found: dict[str, tuple[int, int]] = {}
        if need:
            fingerprint = hashlib.sha1(
                json.dumps(contract, sort_keys=True, default=str).encode()
            ).hexdigest()[:16]
            found = discover_spatial(
                scope.session, scope.query().schemas([sid]), smap,
                infospace_id=scope.infospace_id,
                canon_ids=scope.canon_ids, geo_canon_id=scope.geo_canon_id,
                cache_key=(scope.infospace_id, scope.run_id, sid, fingerprint,
                           scope.canon_ids, scope.geo_canon_id),
                only=need,
            )
        stats[sid] = found
        plans.append(plan_schema(sid, name, smap,
                                 spatial=spatial_from(found), picks=picks))
    return plans, stats


# ─── Stage 3: buckets ───────────────────────────────────────────────────────


def _quoted(seg: str) -> str:
    return seg.replace("'", "''")


def _values_at(elem: str, rel: str, pfx: str, params: dict[str, Any]) -> str:
    """Every value at a section-relative path, as a JSONB array.

    ``at`` → the one value, wrapped; ``by[*]`` → the array itself; a JSON
    ``null`` or a missing key → ``[]``. Plain operators for a plain path —
    the jsonpath engine costs several times more per element and a section
    can have tens of thousands of them. Only a nested explosion
    (``rows[*].who``) needs jsonpath, and gets it.
    """
    segs = rel.split(".")
    if any(seg.endswith("[*]") for seg in segs[:-1]):
        path = "$" + "".join(
            f'."{seg.removesuffix("[*]")}"' + ("[*]" if seg.endswith("[*]") else "")
            for seg in segs
        ) + " ? (@ != null)"
        params[f"{pfx}_jp"] = path
        return (f"COALESCE(jsonb_path_query_array({elem}, CAST(:{pfx}_jp AS jsonpath)),"
                f" '[]'::jsonb)")
    keys = [seg.removesuffix("[*]") for seg in segs]
    node = (f"({elem}->'{_quoted(keys[0])}')" if len(keys) == 1
            else f"({elem} #> '{{{','.join(_quoted(k) for k in keys)}}}')")
    return (f"CASE WHEN {node} IS NULL OR jsonb_typeof({node}) = 'null' THEN '[]'::jsonb "
            f"WHEN jsonb_typeof({node}) = 'array' THEN {node} "
            f"ELSE jsonb_build_array({node}) END")


def _text_at(elem: str, rel: str) -> str:
    keys = [seg.removesuffix("[*]") for seg in rel.split(".")]
    if len(keys) == 1:
        return f"({elem}->>'{_quoted(keys[0])}')"
    return f"({elem} #>> '{{{','.join(_quoted(k) for k in keys)}}}')"


def _doc_values(path: str | None, pfx: str, params: dict[str, Any]) -> str:
    """A top-level field as a JSONB array of its values, across all three
    storage conventions. ``'[]'`` when there is no binding."""
    if not path:
        return "'[]'::jsonb"
    node, p = jsonb_value_accessor("v.v", path.removesuffix("[*]"), param_name=f"{pfx}_dv")
    params.update(p)
    return f"COALESCE(jsonb_path_query_array({node}, '$[*] ? (@ != null)'), '[]'::jsonb)"


def _doc_time(path: str | None, pfx: str, params: dict[str, Any]) -> str:
    if not path:
        return "NULL::timestamptz"
    acc, p = jsonb_accessor("v.v", path, param_name=f"{pfx}_dt")
    params.update(p)
    return _safe_timestamptz_sql(acc)


def _named(value: str, mm: MergeMap | None) -> str:
    """The name a value gives, or NULL.

    Not :func:`scalar_of`: that falls back to an object's raw JSON, which is
    right for grouping arbitrary fields and wrong for a name — an entity slot
    the model left as ``{}`` became a place called "{}". An object names
    itself by ``name`` or not at all; a string or number is its own name.
    """
    v = f"({value})"
    name = (f"NULLIF(TRIM(CASE jsonb_typeof({v}) WHEN 'object' THEN {v}->>'name' "
            f"WHEN 'string' THEN {v} #>> '{{}}' WHEN 'number' THEN {v} #>> '{{}}' END), '')")
    return merge_case(mm, name) if mm else name


def _base(plans: list[SchemaPlan], aq: AnnotationQuery, params: dict[str, Any],
          where: str | None = None) -> str:
    """The run's rows, each annotation's value decompressed exactly once.

    An annotation value is a large TOASTed document, and Postgres decompresses
    it again for every expression that reads it. Read per section element, the
    document's own date and place cost ~6 decompressions × every element of
    every section — 45 s for 1,400 annotations. Here the value is copied out
    once (``|| '{}'`` forces a detoasted, in-memory datum), and the
    document-level fields are computed once per annotation, per its schema.

    ``OFFSET 0`` is load-bearing: without it the planner inlines the lateral
    and ``a.value || '{}'`` runs again for every expression that reads ``v`` —
    one decompression per reference, the very cost this exists to avoid.
    """
    doc_t = []
    doc_p = []
    for j, plan in enumerate(plans):
        params[f"b{j}_sid"] = plan.schema_id
        doc_t.append(f"WHEN :b{j}_sid THEN {_doc_time(plan.document.time.path, f'b{j}', params)}")
        doc_p.append(f"WHEN :b{j}_sid THEN {_doc_values(plan.document.place.path, f'b{j}', params)}")
    clauses, base = aq._base_where(include_cursor=False)
    params.update(base)
    if where:
        clauses = [*clauses, where]
    return f"""
        SELECT a.id AS ann, a.asset_id, a.schema_id AS sid, v.v,
               CASE a.schema_id {' '.join(doc_t)} END AS doc_t,
               CASE a.schema_id {' '.join(doc_p)} ELSE '[]'::jsonb END AS dp,
               ast.event_timestamp AS ats
        FROM annotation a
        LEFT JOIN asset ast ON ast.id = a.asset_id
        CROSS JOIN LATERAL (SELECT a.value || '{{}}'::jsonb AS v OFFSET 0) AS v
        WHERE {' AND '.join(clauses)}
    """


def _stream(
    section: SectionPlan, document: SectionPlan, i: int, aq: AnnotationQuery,
    params: dict[str, Any],
) -> str:
    """One section's rows as ``(sec, ann, ord, asset_id, place, rung, t, t_asset)``.

    The place ladder is read in SQL: the row's own place when it has one,
    else the document's — each with its rung, and a place-array fanning out to
    one row per place. A row with neither is kept with a NULL place: it is
    still a row, and the denominators must count it.
    """
    pfx = f"s{i}"
    params[f"{pfx}_k"] = section.key
    params[f"{pfx}_sid"] = section.schema_id

    # A motive is not somewhere — not even "where its document is about".
    dp = "'[]'::jsonb" if section.frame == "interest" else "b.dp"
    doc_mm = aq._find_merge_map(document.place.path) if document.place.path else None

    if section.kind == "document":
        rp, row_mm, row_t = "'[]'::jsonb", None, "NULL::timestamptz"
        source = "(SELECT 'null'::jsonb AS elem, 0::bigint AS ord) AS e"
    else:
        arr, p = jsonb_value_accessor(
            "b.v", section.path.removesuffix("[*]"), param_name=f"{pfx}_arr")
        params.update(p)
        source = (f"jsonb_array_elements({safe_array_elements(arr)}) "
                  f"WITH ORDINALITY AS e(elem, ord)")
        place = section.place.path
        if place is None:
            rp = "'[]'::jsonb"
        elif place == section.path:
            rp = "jsonb_build_array(e.elem)"            # a roster: the row IS the place
        else:
            rp = _values_at("e.elem", section.relative(place), pfx, params)
        row_mm = aq._find_merge_map(place) if place else None
        if section.time.path:
            row_t = _safe_timestamptz_sql(
                _text_at("e.elem", section.relative(section.time.path)))
        else:
            row_t = "NULL::timestamptz"

    return f"""
        SELECT CAST(:{pfx}_k AS text) AS sec, b.ann * 100000 + e.ord AS row_id, b.asset_id,
               pl.place, CASE WHEN pl.place IS NULL THEN NULL ELSE pl.rung END AS rung,
               COALESCE({row_t}, b.doc_t, b.ats) AS t,
               COALESCE(b.doc_t, b.ats) AS t_asset
        FROM base b
        CROSS JOIN LATERAL {source}
        CROSS JOIN LATERAL (
            SELECT CASE WHEN src.rung = 'row' THEN {_named('x.v', row_mm)}
                        ELSE {_named('x.v', doc_mm)} END AS place,
                   src.rung
            FROM (
                SELECT CASE WHEN jsonb_array_length(z.rp) > 0 THEN z.rp ELSE z.dp END AS vals,
                       CASE WHEN jsonb_array_length(z.rp) > 0 THEN 'row' ELSE 'doc' END AS rung
                FROM (SELECT {rp} AS rp, {dp} AS dp) AS z
            ) AS src
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_array_length(src.vals) > 0 THEN src.vals
                     ELSE '[null]'::jsonb END
            ) AS x(v)
        ) AS pl
        WHERE b.sid = :{pfx}_sid
    """


_GROUPS = """
    WITH base AS MATERIALIZED ({base}),
    s AS MATERIALIZED ({streams}),
    ext AS (
        -- The 2nd–98th percentile, not min/max: one model-written "1900" or
        -- "2060" must not turn a two-year corpus into a century of years.
        SELECT percentile_disc(0.02) WITHIN GROUP (ORDER BY t) AS lo,
               percentile_disc(0.98) WITHIN GROUP (ORDER BY t) AS hi
        FROM s WHERE t IS NOT NULL
    ),
    g AS (
        SELECT CASE
            WHEN lo IS NULL                         THEN 'month'
            WHEN hi - lo <= interval '120 days'     THEN 'day'
            WHEN hi - lo <= interval '2 years'      THEN 'week'
            WHEN hi - lo <= interval '10 years'     THEN 'month'
            WHEN hi - lo <= interval '30 years'     THEN 'quarter'
            ELSE 'year' END AS grain, lo, hi
        FROM ext
    )
    SELECT 'row' AS kind, s.sec, s.rung, s.place,
           date_trunc(g.grain, s.t, 'UTC') AS cell,
           count(*) AS n, NULL::bigint AS m, NULL::bigint AS d, NULL::int[] AS ids
    FROM s, g WHERE s.place IS NOT NULL GROUP BY s.sec, s.rung, s.place, 5
    UNION ALL
    SELECT 'hist', s.sec, NULL, NULL, date_trunc(g.grain, s.t, 'UTC'),
           count(DISTINCT s.row_id), NULL, NULL, NULL
    FROM s, g GROUP BY s.sec, 5
    UNION ALL
    -- Asset ids, not only their count: one place spelled two ways is two
    -- groups here and one identity on the map, and distinct assets do not add
    -- across spellings. ``_pack`` unions them per identity.
    SELECT 'asset', NULL, s.rung, s.place, date_trunc(g.grain, s.t_asset, 'UTC'),
           count(DISTINCT s.asset_id), NULL, NULL, array_agg(DISTINCT s.asset_id)
    FROM s, g WHERE s.place IS NOT NULL GROUP BY s.rung, s.place, 5
    UNION ALL
    SELECT 'asset_time', NULL, NULL, NULL, date_trunc(g.grain, s.t_asset, 'UTC'),
           count(DISTINCT s.asset_id), NULL, NULL, NULL
    FROM s, g GROUP BY 5
    UNION ALL
    SELECT 'place', NULL, NULL, s.place, NULL, count(*), count(DISTINCT s.asset_id), NULL,
           array_agg(DISTINCT s.asset_id)
    FROM s WHERE s.place IS NOT NULL GROUP BY s.place
    UNION ALL
    SELECT 'section', s.sec, NULL, NULL, NULL,
           count(DISTINCT s.row_id),
           count(DISTINCT s.row_id) FILTER (WHERE s.place IS NOT NULL),
           count(DISTINCT s.row_id) FILTER (WHERE s.t IS NOT NULL), NULL
    FROM s GROUP BY s.sec
    UNION ALL
    SELECT 'placed_assets', NULL, NULL, NULL, NULL, count(DISTINCT s.asset_id), NULL, NULL, NULL
    FROM s WHERE s.place IS NOT NULL
    UNION ALL
    SELECT 'grain', g.grain, NULL, NULL, g.lo, NULL, NULL, NULL, NULL FROM g
    UNION ALL
    SELECT 'grain_hi', NULL, NULL, NULL, g.hi, NULL, NULL, NULL, NULL FROM g
"""


def _iso(v: Any) -> str | None:
    return v.isoformat() if v is not None and hasattr(v, "isoformat") else None


def _streams(plans: list[SchemaPlan], aq: AnnotationQuery, params: dict[str, Any],
             sections: Iterable[str] | None = None) -> list[str]:
    """Every section's row stream, or only the named ones.

    The document is a section of its own only where there are no others;
    elsewhere it is the rung every section falls back to. Its stream still
    runs, so a schema whose sections are all empty keeps its documents.
    """
    only = set(sections) if sections is not None else None
    out: list[str] = []
    for plan in plans:
        for section in plan.all:
            if only is None or section.key in only:
                out.append(_stream(section, plan.document, len(out), aq, params))
    return out


def buckets(scope: RunScope, plans: list[SchemaPlan], *, within: str | None = None) -> dict[str, Any]:
    """Every count the map, the lists and the time strip draw from — one
    statement, one scan of the run's rows — with place names resolved to canon
    identities (:func:`graph.places.resolve_places`) and merged on them.
    ``within`` narrows it to the assets naming one entity.
    """
    from app.api.modules.graph.places import name_key, resolve_places

    aq = scope.query()
    params: dict[str, Any] = {}
    streams = _streams(plans, aq, params)
    if not streams:
        return _empty_buckets()

    where = _within(scope, plans, aq, within, params)
    sql = _GROUPS.format(base=_base(plans, aq, params, where),
                         streams=" UNION ALL ".join(streams))
    rows = scope.session.execute(text(sql), params).fetchall()

    raw_places = {r.place for r in rows if r.kind == "place" and r.place}
    resolved = resolve_places(scope.session, scope.infospace_id, raw_places,
                              canon_ids=scope.canon_ids, geo_canon_id=scope.geo_canon_id)
    return _pack(rows, resolved)


_RUNG = {"row": 0, "doc": 1}
#: The place index every bucket of a placed-but-not-located row points at.
UNLOCATED = -2


def _pack(rows: list[Any], resolved: Mapping[str, Any]) -> dict[str, Any]:
    """Grouped rows → the wire shape.

    Index-encoded, because the SSE path is deliberately uncompressed and a
    bucket that repeats ``"411:document.observations[*]"`` and an ISO date
    five thousand times is most of a megabyte of nothing. Sections, places and
    time cells each get a table; every bucket is a short tuple of indices.
    Places are columnar — the shape a GPU layer wants anyway.
    """
    from app.api.modules.graph.places import name_key

    sections: list[str] = []
    sec_ix: dict[str, int] = {}
    cells: list[str] = []
    cell_ix: dict[str, int] = {}
    place_ix: dict[str, int] = {}
    places: dict[str, list[Any]] = {k: [] for k in (
        "id", "name", "lat", "lon", "entry", "geo", "rows", "assets")}
    spellings: dict[int, list[str]] = {}

    def sec(key: str) -> int:
        if key not in sec_ix:
            sec_ix[key] = len(sections)
            sections.append(key)
        return sec_ix[key]

    def cell(v: Any) -> int:
        iso = _iso(v)
        if iso is None:
            return -1
        if iso not in cell_ix:
            cell_ix[iso] = len(cells)
            cells.append(iso)
        return cell_ix[iso]

    # Places first: buckets index into them. Only LOCATED places get a slot —
    # a place with no point cannot be drawn, so its buckets all fold into one
    # "not located" index (UNLOCATED) and the names themselves ship as a
    # ranked list, which is what the Locate action and the Places card read.
    # Rows add across the spellings of one identity; distinct assets do not —
    # an asset that wrote "United States" and "US" is one asset there. So
    # assets are unioned per identity from their ids, never summed.
    unlocated: dict[str, dict[str, Any]] = {}
    place_assets: dict[str, set[int]] = {}
    for r in rows:
        if r.kind != "place":
            continue
        p = resolved[name_key(r.place)]
        place_assets.setdefault(p.identity, set()).update(r.ids or ())
        if not p.located:
            u = unlocated.setdefault(p.identity, {
                "id": p.identity, "name": p.display, "entry": p.entry_id,
                "geo": p.in_geo_canon, "rows": 0, "assets": 0})
            u["rows"] += r.n
            continue
        i = place_ix.get(p.identity)
        if i is None:
            i = place_ix[p.identity] = len(places["id"])
            for k, v in (("id", p.identity), ("name", p.display), ("lat", p.lat),
                         ("lon", p.lon), ("entry", p.entry_id),
                         ("geo", p.in_geo_canon), ("rows", 0), ("assets", 0)):
                places[k].append(v)
        places["rows"][i] += r.n
        spellings.setdefault(i, []).append(r.place)
    for i, identity in enumerate(places["id"]):
        places["assets"][i] = len(place_assets[identity])
    for identity, u in unlocated.items():
        u["assets"] = len(place_assets[identity])

    def place(raw: str) -> int:
        return place_ix.get(resolved[name_key(raw)].identity, UNLOCATED)

    row_b: dict[tuple, int] = {}
    asset_b: dict[tuple, set[int]] = {}
    hist: list[list[int]] = []
    asset_time: list[list[int]] = []
    totals: dict[int, dict[str, int]] = {}
    out: dict[str, Any] = {"grain": "month", "extent": [None, None], "placed_assets": 0}

    for r in rows:
        if r.kind == "row":
            key = (sec(r.sec), _RUNG[r.rung], place(r.place), cell(r.cell))
            row_b[key] = row_b.get(key, 0) + r.n
        elif r.kind == "hist":
            hist.append([sec(r.sec), cell(r.cell), r.n])
        elif r.kind == "asset":
            key = (_RUNG[r.rung], place(r.place), cell(r.cell))
            asset_b.setdefault(key, set()).update(r.ids or ())
        elif r.kind == "asset_time":
            asset_time.append([cell(r.cell), r.n])
        elif r.kind == "section":
            totals[sec(r.sec)] = {"rows": r.n, "placed": r.m, "dated": r.d}
        elif r.kind == "placed_assets":
            out["placed_assets"] = r.n
        elif r.kind == "grain":
            out["grain"], out["extent"][0] = r.sec, _iso(r.cell)
        elif r.kind == "grain_hi":
            out["extent"][1] = _iso(r.cell)

    ordered = sorted(row_b.items(), key=lambda kv: -kv[1])
    kept = ordered[:_MAX_ROW_BUCKETS]
    out.update(
        sections=[{"key": k, **totals.get(i, {"rows": 0, "placed": 0, "dated": 0})}
                  for i, k in enumerate(sections)],
        cells=cells,
        places=places,
        spellings={str(i): v for i, v in spellings.items() if len(v) > 1},
        unlocated={
            "total": len(unlocated),
            "items": sorted(unlocated.values(), key=lambda u: -u["rows"])[:_TOP_UNLOCATED],
        },
        rows=[[*k, n] for k, n in kept],
        rows_truncated=sum(n for _, n in ordered[_MAX_ROW_BUCKETS:]),
        hist=hist,
        assets=[[*k, len(ids)] for k, ids in asset_b.items()],
        asset_time=asset_time,
    )
    return out


def _empty_buckets() -> dict[str, Any]:
    return _pack([], {})


# ─── Stage 4: entities ──────────────────────────────────────────────────────


def _ranked_paths(plan: SchemaPlan) -> list[FieldNode]:
    """The entity fields whose values are *who* — not where, not when, not why.

    Excluded by declaration, never by name: anything a section reads as its
    place; anything whose vocabulary lives entirely in a framed section
    (events, interests, places); anything inside one.
    """
    smap = plan.smap
    placed = {s.place.path for s in plan.all if s.place.path} | set(smap.place_paths)
    frames: dict[str, str] = {}
    for s in plan.sections:
        if s.frame and s.path:
            frames[strip_explosions(s.path)] = s.frame

    def framed(path: str | None) -> bool:
        return bool(path) and strip_explosions(path) in frames

    out: list[FieldNode] = []
    for n in smap.fields:
        if not n.is_entity or n.path in placed:
            continue
        if framed(n.path) or framed(n.container):
            continue
        targets = [f"{n.section}.{t}" for t in n.ref_targets]
        if targets and all(t in frames for t in targets):
            continue
        out.append(n)
    return out


def _entity_values(node: FieldNode, pfx: str, aq: AnnotationQuery,
                   params: dict[str, Any]) -> str:
    """``(name, type)`` for every value of one entity path in the annotation
    value ``dv.v``, through its full explosion ladder — as ``distinct_values``
    reads it. A lateral body: :func:`_entity_union` supplies the row."""
    chain = parse_explosion_chain(node.path)
    sources: list[str] = []
    parent = "dv.v"
    for depth, seg in enumerate(chain.segments):
        acc, p = jsonb_value_accessor(parent, seg.array_path,
                                      param_name=f"{pfx}_x{depth}")
        params.update(p)
        alias = f"{pfx}_{seg.alias}"
        sources.append(f"jsonb_array_elements({safe_array_elements(acc)}) AS {alias}")
        parent = alias
    if chain.segments and not chain.leaf:
        value = parent
    else:
        value, p = jsonb_value_accessor(parent, chain.leaf or node.path,
                                        param_name=f"{pfx}_leaf")
        params.update(p)
    name = _named(value, aq._find_merge_map(node.path))
    from_clause = f"FROM {', LATERAL '.join(sources)}" if sources else ""
    return f"SELECT {name} AS name, ({value})->>'type' AS type {from_clause}"


def _entity_union(plans: list[SchemaPlan], aq: AnnotationQuery, params: dict[str, Any],
                  prefix: str = "e") -> str | None:
    """Every ranked entity value of the run as one ``(name, type, asset_id,
    ann)`` relation — what the Entities list counts, and what ``within`` and
    an entity's asset list read back.

    One pass over the annotations, each value decompressed once and fanned
    out to every entity path of its schema. One subquery *per path* read the
    whole run once per path — eight times over for a scenario schema, and the
    decompression, not the JSON, is what costs (see :func:`_base`, and its
    note on ``OFFSET 0``).
    """
    arms: list[str] = []
    for plan in plans:
        params[f"{prefix}_sid{plan.schema_id}"] = plan.schema_id
        for node in _ranked_paths(plan):
            body = _entity_values(node, f"{prefix}{len(arms)}", aq, params)
            arms.append(f"SELECT * FROM ({body}) AS x WHERE a.schema_id = :{prefix}_sid{plan.schema_id}")
    if not arms:
        return None
    clauses, base = aq._base_where(include_cursor=False)
    params.update(base)
    return f"""
        SELECT ev.name, ev.type, a.asset_id, a.id AS ann
        FROM annotation a
        CROSS JOIN LATERAL (SELECT a.value || '{{}}'::jsonb AS v OFFSET 0) AS dv
        CROSS JOIN LATERAL ({" UNION ALL ".join(arms)}) AS ev
        WHERE {' AND '.join(clauses)}
    """


def _entity_keys(scope: RunScope, identity: str) -> list[str]:
    from app.api.modules.graph.places import spellings_of

    # Entities resolve through the run's canon only — see :func:`entities`.
    return spellings_of(scope.session, scope.infospace_id, identity,
                        canon_ids=scope.canon_ids)


def _within(scope: RunScope, plans: list[SchemaPlan], aq: AnnotationQuery,
            within: str | None, params: dict[str, Any]) -> str | None:
    """The ``annotation a`` predicate for "only assets that name ``within``",
    or None when the reading is not narrowed."""
    if not within:
        return None
    union = _entity_union(plans, aq, params, prefix="w")
    keys = _entity_keys(scope, within)
    if not union or not keys:
        return "FALSE"          # an entity nothing names narrows to nothing
    params["within_keys"] = keys
    return (f"a.asset_id IN (SELECT w.asset_id FROM ({union}) AS w "
            f"WHERE LOWER(w.name) = ANY(:within_keys))")


def entities(scope: RunScope, plans: list[SchemaPlan], *, within: str | None = None) -> dict[str, Any]:
    """Who the run is about — ranked by how many assets name them, merged on
    canon identity so one person spelled three ways ranks once. ``within``
    ranks who appears beside one entity instead."""
    from app.api.modules.graph.places import name_key, resolve_places

    aq = scope.query()
    params: dict[str, Any] = {}
    union = _entity_union(plans, aq, params)
    if not union:
        return {"items": [], "total": 0}
    narrow = ""
    if within:
        keys = _entity_keys(scope, within)
        if not keys:
            return {"items": [], "total": 0}
        params["within_keys"] = keys
        narrow = ("AND asset_id IN (SELECT asset_id FROM u "
                  "WHERE LOWER(name) = ANY(:within_keys))")

    rows = scope.session.execute(text(f"""
        WITH u AS MATERIALIZED ({union})
        SELECT LOWER(name) AS key, min(name) AS name,
               mode() WITHIN GROUP (ORDER BY type) AS type,
               count(*) AS mentions, count(DISTINCT asset_id) AS assets,
               count(*) OVER () AS total
        FROM u WHERE name IS NOT NULL {narrow}
        GROUP BY LOWER(name)
        ORDER BY assets DESC, mentions DESC
        LIMIT :lim
    """), {**params, "lim": _TOP_ENTITIES * 3}).fetchall()
    if not rows:
        return {"items": [], "total": 0}

    # Identity through the run's canon only: a person's identity is the run's
    # curated vocabulary, not whatever the geo canon happens to call a place.
    resolved = resolve_places(scope.session, scope.infospace_id, [r.name for r in rows],
                              canon_ids=scope.canon_ids)
    merged: dict[str, dict[str, Any]] = {}
    for r in rows:
        p = resolved[name_key(r.name)]
        slot = merged.setdefault(p.identity, {
            "id": p.identity, "name": p.display, "type": r.type,
            "entry_id": p.entry_id, "mentions": 0, "assets": 0, "spellings": [],
        })
        slot["mentions"] += r.mentions
        slot["assets"] += r.assets
        slot["spellings"].append(r.name)
    for slot in merged.values():
        if len(slot["spellings"]) < 2:
            del slot["spellings"]          # only worth shipping when something folded
    items = sorted(merged.values(), key=lambda e: (-e["assets"], -e["mentions"]))
    return {"items": items[:_TOP_ENTITIES], "total": rows[0].total}


# ─── Drill-down: the assets behind one count ────────────────────────────────


#: The grains the time strip draws — and so the only ones a window can name.
_GRAINS = {"day", "week", "month", "quarter", "year"}

_ASSET_PAGE = """
    SELECT h.asset_id, h.n, h.t AS at, ast.title, ast.kind::text AS kind, ast.created_at,
           count(*) OVER () AS total
    FROM hits h JOIN asset ast ON ast.id = h.asset_id
    ORDER BY h.n DESC, h.t DESC NULLS LAST, h.asset_id DESC
    LIMIT :lim OFFSET :off
"""


def assets_for(
    scope: RunScope,
    plans: list[SchemaPlan],
    *,
    place: str | None = None,
    entity: str | None = None,
    within: str | None = None,
    sections: Iterable[str] | None = None,
    window: tuple[str, str] | None = None,
    grain: str = "month",
    asset_time: bool = True,
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    """The assets behind one place or one entity, most-mentioning first.

    A **place** is read off the same row streams :func:`buckets` counted —
    ``sections`` (all, when None) under the same ``within`` — matched on every
    spelling of its identity; ``n`` is how many rows put the asset there. An
    **entity** is read off the same relation the Entities list ranks; ``n`` is
    how many times the asset names it.

    ``window`` is the time strip's brush, as inclusive cell starts at
    ``grain``: on each asset's own time (``asset_time``, as the Assets mode
    counts), else on each row's.
    """
    from app.api.modules.graph.places import spellings_of

    if (place is None) == (entity is None):
        raise ValueError("assets_for needs exactly one of place or entity")
    if grain not in _GRAINS:
        raise ValueError(f"unknown grain {grain!r}")

    aq = scope.query()
    params: dict[str, Any] = {"lim": max(1, min(limit, 200)), "off": max(0, offset)}
    empty = {"items": [], "total": 0, "offset": params["off"], "spellings": []}

    if place is not None:
        keys = spellings_of(scope.session, scope.infospace_id, place,
                            canon_ids=scope.canon_ids, geo_canon_id=scope.geo_canon_id)
    else:
        keys = _entity_keys(scope, entity)
    if not keys:
        return empty
    params["keys"] = keys

    in_window = "TRUE"
    if window:
        params.update(w_grain=grain, w_lo=window[0], w_hi=window[1])
        in_window = ("date_trunc(:w_grain, {t}, 'UTC') "
                     "BETWEEN CAST(:w_lo AS timestamptz) AND CAST(:w_hi AS timestamptz)")

    if place is not None:
        streams = _streams(plans, aq, params, sections)
        if not streams:
            return empty
        where = _within(scope, plans, aq, within, params)
        t = "s.t_asset" if asset_time else "s.t"
        sql = f"""
            WITH base AS MATERIALIZED ({_base(plans, aq, params, where)}),
            s AS ({" UNION ALL ".join(streams)}),
            hits AS (
                SELECT s.asset_id, count(DISTINCT s.row_id) AS n, max({t}) AS t
                FROM s
                WHERE LOWER(s.place) = ANY(:keys) AND {in_window.format(t=t)}
                GROUP BY s.asset_id
            )
            {_ASSET_PAGE}
        """
    else:
        union = _entity_union(plans, aq, params)
        if not union:
            return empty
        within_sql = _within(scope, plans, aq, within, params)
        # Only the annotations that name the entity are decompressed for
        # their dates — the base is the expensive part, and here it is small.
        named = "a.id IN (SELECT ann FROM m)"
        where = f"{named} AND {within_sql}" if within_sql else named
        t = "COALESCE(b.doc_t, b.ats)"
        sql = f"""
            WITH m AS MATERIALIZED (
                SELECT ann, asset_id, count(*) AS n FROM ({union}) AS u
                WHERE LOWER(u.name) = ANY(:keys) GROUP BY ann, asset_id
            ),
            base AS MATERIALIZED ({_base(plans, aq, params, where)}),
            hits AS (
                SELECT m.asset_id, sum(m.n)::bigint AS n, max({t}) AS t
                FROM m JOIN base b ON b.ann = m.ann
                WHERE {in_window.format(t=t)}
                GROUP BY m.asset_id
            )
            {_ASSET_PAGE}
        """

    rows = scope.session.execute(text(sql), params).fetchall()
    return {
        # ``at``, not ``t``: ``Row.t`` is SQLAlchemy's own typed-tuple accessor.
        "items": [{"id": r.asset_id, "title": r.title, "kind": (r.kind or "").lower() or None,
                   "created_at": _iso(r.created_at), "t": _iso(r.at), "n": r.n}
                  for r in rows],
        "total": rows[0].total if rows else 0,
        "offset": params["off"],
        "spellings": keys,
    }
