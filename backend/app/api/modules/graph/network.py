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

And by degree: :func:`weigh` reads a number in the annotations as a weight
per annotation, :func:`about` a meaning — the documents' chunks per
annotation, and the reader's node names by their own vectors. The way back
to words is :func:`describe`: what some of the run's documents are about,
apart from the rest of it — a room's reading.
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.api.modules.graph.schemas import GraphResultData

__all__ = ["pack", "assets_of", "assets_where", "weigh", "about", "describe"]

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


def _declared_range(scope: Any, path: str) -> tuple[float, float] | None:
    """The scale a run's schemas declare for the number at ``path`` — the
    first of its schemas that states both ends."""
    from app.api.modules.annotation.schema_map import schema_map_for

    for schema in scope.run.target_schemas or []:
        try:
            smap = schema_map_for(schema.output_contract)
        except Exception:  # noqa: BLE001 — a broken contract declares nothing
            continue
        for f in smap.fields:
            if f.path == path and f.minimum is not None and f.maximum is not None and f.maximum > f.minimum:
                return f.minimum, f.maximum
    return None


def _element_entity(scope: Any, path: str) -> str | None:
    """Where an element of the array ``path`` reads into names its entity,
    relative to the element: ``""`` when the array holds entities, the child's
    name when each element holds one (``actors[*].actor``); None when the
    elements name none, or ``path`` reads into no array."""
    from app.api.modules.annotation.schema_map import ENTITY_SHAPES, schema_map_for
    from app.core.filters import parse_explosion

    ep = parse_explosion(path)
    if not (ep.is_exploded and ep.array_field):
        return None
    array = f"{ep.array_field}[*]"
    for schema in scope.run.target_schemas or []:
        try:
            smap = schema_map_for(schema.output_contract)
        except Exception:  # noqa: BLE001 — a broken contract names nothing
            continue
        for f in smap.fields:
            if f.shape not in ENTITY_SHAPES:
                continue
            if f.path == array:
                return ""
            rest = f.path[len(array) + 1:] if f.path.startswith(array + ".") else None
            if rest and "[*]" not in rest and "." not in rest:
                return rest
    return None


def _threshold(operator: str, value: Any):
    """A number test for a thresholded weight; ``between`` takes ``[lo, hi]``,
    low end first."""
    try:
        if operator == "between":
            if not isinstance(value, (list, tuple)) or len(value) != 2:
                raise TypeError
            lo, hi = (float(x) for x in value)
            if lo > hi:
                raise ValueError(f"between needs its low end first, got [{lo}, {hi}]")
            return lambda v: lo <= v <= hi
        if isinstance(value, bool):
            raise TypeError
        t = float(value)
    except TypeError as e:
        raise ValueError(f"{operator} needs a number{' pair' if operator == 'between' else ''}") from e
    return {"gt": lambda v: v > t, "ge": lambda v: v >= t, "lt": lambda v: v < t, "le": lambda v: v <= t}[operator]


def weigh(scope: Any, path: str, operator: str, value: Any = None) -> dict[str, Any]:
    """A number at ``path`` as a weight per annotation, in 0…1 — what the
    plane folds onto its nodes as a field.

    Graded (``operator="value"``): by the scale the schema declares, so a 9 on
    a 1–10 score is high in every run; by rank within the run when no scale
    is declared, since then only the order means anything. Thresholded
    (``gt ge lt le between``): 1 where the number passes, 0 where it does not.
    Either way an annotation without a number there is left out — absent,
    never zero. ``scale`` says which reading was used, for the chip.

    The ``/network/where`` membership is the 0/1 case of this, and folds into
    it in time.
    """
    # A bad threshold is the caller's mistake whether or not there are numbers.
    passes = _threshold(operator, value) if operator != "value" else None
    numbers = scope.query().numbers(path)
    if not numbers:
        return {"annotation": {"ids": [], "weights": []}, "scale": _NO_SCALE}
    ids = [a for a, _ in numbers]
    vals = [v for _, v in numbers]

    declared = _declared_range(scope, path) if operator == "value" else None

    def read(vs: Sequence[float]) -> tuple[list[float], dict[str, Any]]:
        """Numbers to weights, one rule for annotations and elements alike."""
        if passes is not None:
            # Judged on the same number the graded reading uses — an array's
            # mean — so a threshold and a surface agree about every annotation.
            return [1.0 if passes(v) else 0.0 for v in vs], {"by": "threshold", "min": min(vs), "max": max(vs)}
        if declared:
            lo, hi = declared
            return [min(1.0, max(0.0, (v - lo) / (hi - lo))) for v in vs], {"by": "declared", "min": lo, "max": hi}
        return _by_rank(vs)

    weights, scale = read(vals)
    out: dict[str, Any] = {"annotation": {"ids": ids, "weights": weights}, "scale": scale}

    # A number inside an array whose elements name an entity belongs to that
    # entity — an actor's stance is the actor's, not its document's. Read per
    # element too, so the plane can give each its own.
    name_rel = _element_entity(scope, path)
    if name_rel is not None:
        rows = scope.query().number_elements(path, name_rel)
        if rows:
            ew, escale = read([v for _, _, v in rows])
            out["element"] = {
                "annotation": [a for a, _, _ in rows], "name": [n for _, n, _ in rows],
                "weights": ew, "scale": escale,
            }
    return out


#: Steps of a ranked scale's ``quantiles``: the raw value at every twentieth.
QUANTILES = 20
_NO_SCALE = {"by": "none", "min": None, "max": None}
#: Alternatives one ``about`` reads — each is a pass over the run's chunks.
ABOUT_TEXTS = 10


def _by_rank(vals: Sequence[float]) -> tuple[list[float], dict[str, Any]]:
    """Each value's rank share in 0…1, and the scale that reads it back.

    Ties share their mean rank; a single value sits at 1. ``quantiles`` is the
    raw value at each twentieth of the rank, lowest first — what a reach on the
    weights stands at in the values' own units (a cosine, a score)."""
    n = len(vals)
    order = sorted(range(n), key=vals.__getitem__)
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and vals[order[j + 1]] == vals[order[i]]:
            j += 1
        share = 1.0 if n == 1 else ((i + j) / 2) / (n - 1)
        for k in range(i, j + 1):
            ranks[order[k]] = share
        i = j + 1
    ordered = [vals[k] for k in order]
    quantiles = [ordered[round(q / QUANTILES * (n - 1))] for q in range(QUANTILES + 1)] if n else []
    return ranks, {"by": "rank", "min": ordered[0] if n else None, "max": ordered[-1] if n else None,
                   "quantiles": quantiles}


def _texts(value: Any) -> list[str]:
    """``about``'s value — a phrase, or alternatives — as its distinct phrases."""
    raw = [value] if isinstance(value, str) else value if isinstance(value, list) else []
    texts = list(dict.fromkeys(t.strip() for t in raw if isinstance(t, str) and t.strip()))
    if len(texts) > ABOUT_TEXTS:
        raise ValueError(f"about takes at most {ABOUT_TEXTS} phrases")
    return texts


def _pairs(scope: Any) -> list[tuple[int, int]]:
    """The run's annotations in scope, each with its document."""
    clauses, params = scope.query()._base_where(include_cursor=False)
    return [tuple(r) for r in scope.session.execute(
        text(f"SELECT a.id, a.asset_id FROM annotation a WHERE {' AND '.join(clauses)} ORDER BY a.id"),
        params,
    ).all()]



async def about(
    scope: Any, value: Any, labels: Sequence[str] | None = None, like: Sequence[int] | None = None,
) -> dict[str, Any]:
    """A meaning as a weight, on both bases — what ``≈`` places by.

    *value* is a phrase, or alternatives (a unit takes its closest); *like*,
    documents of the run whose centroid is one more alternative — a held
    room's snapshot. Both columns are rank shares within the run, so a reach
    reads "the closest tenth" whatever the model's cosines run to; each
    ``scale.quantiles`` gives the cosine back.

    - **context** (``annotation``): each document's best chunk, its parts
      counted toward it, ranked over the run's embedded documents; every
      annotation of the run on that document takes its share.
    - **said** (``label``): each of *labels* — the reader's node names — by
      its remembered vector (``embed_labels``), ranked over the names that have
      one. Only when asked: the names are the reader's, not the run's.

    A document without chunks, or a name without a vector, is left out —
    absent, never far.
    """
    from app.api.modules.embedding.similarity import Like, weigh_texts
    from app.api.modules.embedding.similarity import weigh as near

    session, iid = scope.session, scope.infospace_id
    pairs = _pairs(scope)
    documents = sorted({asset for _, asset in pairs})
    meanings: list[Any] = _texts(value)
    if like:
        # Only the run's own documents: the reader's snapshot, read under scope.
        mine = set(documents)
        meanings.append(Like(tuple(sorted(d for d in set(like) if d in mine))))
    if not meanings:
        raise ValueError("about needs a phrase, a list of them, or documents it is like")

    closest: dict[int, float] = {}
    for t in meanings:
        for doc, s in (await near(session, iid, t, within=documents)).items():
            closest[doc] = max(s, closest.get(doc, s))
    shares, scale = _by_rank(list(closest.values())) if closest else ([], _NO_SCALE)
    share = dict(zip(closest, shares))
    held = [(a, share[d]) for a, d in pairs if d in share]
    out: dict[str, Any] = {
        "annotation": {"ids": [a for a, _ in held], "weights": [w for _, w in held]},
        "scale": scale,
    }

    if labels is not None:
        said: dict[str, float] = {}
        names = [n for n in dict.fromkeys(n.strip() for n in labels) if n]
        for t in meanings:
            for name, s in (await weigh_texts(session, iid, t, names)).items():
                said[name] = max(s, said.get(name, s))
        weights, label_scale = _by_rank(list(said.values())) if said else ([], _NO_SCALE)
        out["label"] = {"names": list(said), "weights": weights, "scale": label_scale}
    return out


#: Documents ``describe`` reads as one meaning.
DESCRIBE_DOCUMENTS = 20_000


async def describe(
    scope: Any, documents: Sequence[int], labels: Sequence[str] = (), *, passages: int = 3, terms: int = 8,
) -> dict[str, Any]:
    """What *documents* of the run are about, apart from the rest of it: the
    meaning ``Like(documents, unlike=run)``, read back as the passages of
    those documents closest to it and the closest of *labels* — the reader's
    names, by their own vectors. A room's reading.

    Documents outside the run's scope are not read. ``embedded`` counts the
    documents read that have chunks — the reading stands on those."""
    from app.api.modules.embedding.similarity import Like, _documents
    from app.api.modules.embedding.similarity import describe as words

    run = sorted({asset for _, asset in _pairs(scope)})
    mine = set(run)
    room = sorted(d for d in set(documents) if d in mine)
    if len(room) > DESCRIBE_DOCUMENTS:
        raise ValueError(f"describe reads at most {DESCRIBE_DOCUMENTS} documents")
    names = [n for n in dict.fromkeys(n.strip() for n in labels) if n]
    out = await words(
        scope.session, scope.infospace_id, Like(tuple(room), unlike=tuple(run)),
        within=room, texts=names, passages=passages, terms=terms,
    ) if room else {"passages": [], "terms": []}
    params: dict[str, Any] = {}
    embedded = scope.session.execute(text(f"""
        SELECT count(DISTINCT d.document)
        FROM assetchunk c JOIN asset a ON a.id = c.asset_id {_documents(params, "room", room)}
        WHERE c.embedding_model_id IS NOT NULL
    """), params).scalar() if room else 0
    return {**out, "documents": len(room), "embedded": int(embedded or 0)}


COMPARE = {">": "gt", ">=": "ge", "<": "lt", "<=": "le"}


def assets_where(scope: Any, path: str, op: str, values: Sequence[str]) -> list[int]:
    """The run's assets with an annotation whose ``path`` is (``=``) or
    contains (``~``) any of ``values`` — or whose number there compares
    (``> >= < <=``) to the one value — any schema of the run, read under
    *scope* as everything else is.

    ``=`` also matches every spelling an alias at ``path`` folds into a value,
    so a value offered by the alias-merged distinct list finds its raw rows.
    ``~`` is a case-insensitive substring. An array path (``topics[*]``)
    matches when any element does. A comparison reads only what is a number.
    """
    from app.core.filters import FieldCondition, FilterSet

    wanted = [v for v in dict.fromkeys(str(v).strip() for v in values) if v]
    if not wanted:
        return []
    if op in COMPARE:
        try:
            number = float(wanted[0])
        except ValueError as e:
            raise ValueError(f"{op} compares to a number, not {wanted[0]!r}") from e
        cond = FieldCondition(path=path, operator=COMPARE[op], value=number)
        return scope.query().filter(FilterSet(conditions=[cond])).asset_ids()
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
