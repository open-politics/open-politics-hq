"""The graph as the GPU reads it — columns, not objects.

A run's whole graph is tens of thousands of nodes. As objects (``/view``'s
graph phase) that is a node dict carrying its evidence, places, properties and
provenance, ~1.4 KB each — 117 MB for run 433's 80k nodes, most of it text
nobody reads until they click. A renderer that draws every node needs none of
that up front. It needs, per node, what positions and paints it; per edge, its
two ends; and the way back from a node to the documents that said it.

    nodes   id · name · type · kind · frequency · size · t0 · t1
            ann        CSR over the annotations that produced each node
            places     CSR over each node's geocoded place claims: coordinate,
                       rung, interval, trajectory end — the place ladder whole,
                       so the client can anchor by any preset without asking
    edges   source · target (node indices) · kind · predicate · weight
    vocab   the strings `type`, `kind`, `predicate` and `rung` index into, and
            the coordinates places index into (`[lat, lon, name]`)
    assets  annotation → asset, and that asset's own timestamp

Interned and columnar: one list per channel, small integers where a string
repeats. Everything else about a node — its evidence, its places, its forwarded
properties — is read by opening the assets behind it (:func:`assets_of`), the
same list the overview opens for a place or a name.

The way in goes the other way too: :func:`assets_where` reads which of the
run's assets carry an annotation value — ``sentiment = negative``, ``topics ~
energy`` — so a reader can gather the nodes those documents produced, beside
the names, types and groups the graph itself carries.
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.api.modules.graph.schemas import GraphResultData

__all__ = ["pack", "assets_of", "assets_where"]

#: Node ``kind`` on the wire. Entities are the labelled nouns; occurrences the
#: numerous connective tissue — the renderer treats them oppositely.
KINDS = ("entity", "occurrence")
#: A place claim's position on a trajectory: none (a point), its start, its end.
ENDS = (None, "from", "to")


class _Vocab:
    """Strings → small integers, first seen first."""

    def __init__(self) -> None:
        self.index: dict[str, int] = {}

    def __call__(self, value: str | None) -> int:
        key = value or ""
        i = self.index.get(key)
        if i is None:
            i = self.index[key] = len(self.index)
        return i

    @property
    def values(self) -> list[str]:
        return list(self.index)


def _round(v: float | None, digits: int = 5) -> float | None:
    return None if v is None else round(float(v), digits)


def pack(session: Session, graph: GraphResultData) -> dict[str, Any]:
    """*graph* as columns. Edges whose ends were cut by a node cap are dropped
    here rather than shipped dangling — and counted, so the cut is visible."""
    nodes = graph.nodes
    at = {n.id: i for i, n in enumerate(nodes)}
    types, edge_kinds, predicates, rungs = _Vocab(), _Vocab(), _Vocab(), _Vocab()

    offsets, flat = [0], []
    for n in nodes:
        flat.extend(n.source_annotation_ids)
        offsets.append(len(flat))

    # Places: only claims that geocoded — a place with no coordinate is
    # unknown, not (0, 0), and the client could do nothing with it. Runs name
    # few distinct places many times (922 coordinates behind 73k claims on run
    # 433), so the coordinates are a table and each claim an index into it.
    coords: dict[tuple[float, float], int] = {}
    coord_rows: list[list[Any]] = []
    p_offsets, p_coord, p_rung, p_from, p_to, p_end = [0], [], [], [], [], []
    for n in nodes:
        for p in n.places:
            if p.lat is None or p.lon is None:
                continue
            key = (round(float(p.lat), 5), round(float(p.lon), 5))
            c = coords.get(key)
            if c is None:
                c = coords[key] = len(coord_rows)
                coord_rows.append([key[0], key[1], p.place])
            p_coord.append(c)
            p_rung.append(rungs(p.source))
            p_from.append(p.from_)
            p_to.append(p.to)
            p_end.append(ENDS.index(p.end) if p.end in ENDS else 0)
        p_offsets.append(len(p_coord))

    source, target, kind, predicate, weight = [], [], [], [], []
    dangling = 0
    for e in graph.edges:
        s, t = at.get(e.source), at.get(e.target)
        if s is None or t is None:
            dangling += 1
            continue
        source.append(s)
        target.append(t)
        kind.append(edge_kinds(getattr(e, "kind", None) or "relation"))
        predicate.append(predicates(e.predicate))
        weight.append(e.weight)

    return {
        "nodes": {
            "id": [n.id for n in nodes],
            "name": [n.name for n in nodes],
            "type": [types(n.type) for n in nodes],
            "kind": [KINDS.index(n.kind) if n.kind in KINDS else 0 for n in nodes],
            "frequency": [n.frequency for n in nodes],
            "size": [_round(getattr(n, "size", None), 4) for n in nodes],
            "t0": [n.t0 for n in nodes],
            "t1": [n.t1 for n in nodes],
            "ann": {"offsets": offsets, "ids": flat},
            "places": {
                "offsets": p_offsets, "coord": p_coord, "rung": p_rung,
                "from": p_from, "to": p_to, "end": p_end,
            },
        },
        "edges": {
            "source": source, "target": target, "kind": kind,
            "predicate": predicate, "weight": weight,
        },
        "vocab": {
            "type": types.values, "edge_kind": edge_kinds.values,
            "predicate": predicates.values, "node_kind": list(KINDS),
            "rung": rungs.values, "coord": coord_rows,
        },
        "assets": _annotation_assets(session, set(flat)),
        "dropped_edges": dangling,
    }


def _annotation_assets(session: Session, ids: Iterable[int]) -> dict[str, list[Any]]:
    """Each annotation's asset, and that asset's own timestamp in epoch
    seconds — when it was published or recorded, the one time that is not a
    claim. ``event_timestamp`` only, never ``created_at``: when it was ingested
    says nothing about it."""
    ids = sorted(ids)
    if not ids:
        return {"annotation": [], "asset": [], "time": []}
    rows = session.execute(text("""
        SELECT a.id, a.asset_id, extract(epoch FROM ast.event_timestamp)::bigint AS at
        FROM annotation a LEFT JOIN asset ast ON ast.id = a.asset_id
        WHERE a.id = ANY(:ids) ORDER BY a.id
    """), {"ids": ids}).all()
    return {
        "annotation": [r.id for r in rows],
        "asset": [r.asset_id for r in rows],
        "time": [r.at for r in rows],
    }


def assets_of(
    scope: Any,
    annotation_ids: Sequence[int],
    *,
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    """The assets behind a set of annotations — a node, an edge, a selection —
    most annotations first. ``n`` is how many of the given annotations each
    asset holds.

    Read under *scope* (an ``overview.RunScope``): the run, the reader's
    package grant, failed rows excluded — so an id from another run, or one the
    grant does not reach, selects nothing.
    """
    if not annotation_ids:
        return {"items": [], "total": 0, "offset": offset}
    clauses, params = scope.query()._base_where(include_cursor=False)
    rows = scope.session.execute(text(f"""
        WITH hit AS (
            SELECT a.asset_id, count(*) AS n
            FROM annotation a
            WHERE {' AND '.join(clauses)} AND a.id = ANY(:ann_ids)
            GROUP BY a.asset_id
        )
        SELECT ast.id, ast.title, ast.kind::text AS kind, ast.created_at,
               ast.event_timestamp AS at, hit.n, count(*) OVER () AS total
        FROM hit JOIN asset ast ON ast.id = hit.asset_id
        ORDER BY hit.n DESC, ast.event_timestamp DESC NULLS LAST, ast.id DESC
        OFFSET :ann_offset LIMIT :ann_limit
    """), {**params, "ann_ids": list(annotation_ids),
           "ann_offset": offset, "ann_limit": limit}).all()
    iso = lambda v: v.isoformat() if v else None  # noqa: E731
    return {
        "items": [{
            "id": r.id, "title": r.title, "kind": (r.kind or "").lower() or None,
            "created_at": iso(r.created_at), "t": iso(r.at), "n": r.n,
        } for r in rows],
        "total": rows[0].total if rows else 0,
        "offset": offset,
    }


def assets_where(scope: Any, path: str, op: str, values: Sequence[str]) -> list[int]:
    """The run's assets with an annotation whose ``path`` is (``=``) or
    contains (``~``) any of ``values`` — any schema of the run, read under
    *scope* as everything else is.

    ``=`` also matches every spelling an alias at ``path`` folds into a value,
    so a value offered by the alias-merged distinct list finds its raw rows.
    ``~`` is a case-insensitive substring. An array path (``topics[*]``)
    matches when any element does.
    """
    from app.core.filters import FieldCondition, FilterSet

    wanted = [v for v in dict.fromkeys(str(v).strip() for v in values) if v]
    if not wanted:
        return []
    if op == "=":
        spellings = list(wanted)
        folded = {v.lower() for v in wanted}
        for mm in scope.merge_maps:
            if mm.field_path != path:
                continue
            for entry in mm.entries:
                if entry.keep.lower() in folded:
                    spellings.extend(entry.names)
        cond = FieldCondition(path=path, operator="in", value=list(dict.fromkeys(spellings)))
        return scope.query().filter(FilterSet(conditions=[cond])).asset_ids()
    if op == "~":
        out: set[int] = set()
        for v in wanted:
            cond = FieldCondition(path=path, operator="contains", value=v)
            out.update(scope.query().filter(FilterSet(conditions=[cond])).asset_ids())
        return sorted(out)
    raise ValueError(f"unknown operator {op!r}")
