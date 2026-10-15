"""The network panel's graph — `graph/reading.py`, `graph/network.py`.

Real Postgres, rolled back per test. Pins three things:

* windowing a projection by annotation gives the same graph at any window
  size — no array is split, none is read twice;
* the columns the GPU reads are the graph the engine built, index for index;
* a selection opens exactly the assets behind it, under the run's scope.
"""
from __future__ import annotations

import asyncio
import types

import pytest
from sqlalchemy import text

import app.models  # noqa: F401 — every mapper
from app.api.modules.annotation import overview as ov
from app.api.modules.graph import network as net
from app.api.modules.graph.models import Canon, CanonEntry
from app.api.modules.graph.reading import collect, configure
from app.api.modules.graph.stream import collect_graph
from app.tests.test_graph_stream import (  # noqa: F401 — fixtures
    _annotation, _asset, _infospace, _run, _schema_with, _user, db, pg_engine,
)


def entity(t: str) -> dict:
    return {"type": "object", "x-entityField": True, "x-entityType": t,
            "properties": {"name": {"type": "string"}, "type": {"type": "string"}}}


CONTRACT = {"type": "object", "properties": {"document": {"type": "object", "properties": {
    "dated": {"type": "string", "format": "date"},
    "actors": {"type": "array", "items": entity("person")},
    "events": {"type": "array", "x-graph": {"place": {"at": "where.name"}},
               "items": {"type": "object", "properties": {
                   "what": {"type": "string"}, "where": entity("location")}}},
}}}}


def doc(actors: list[str], places: list[str]) -> dict:
    return {"document": {
        "dated": "2026-02-01",
        "actors": [{"name": a, "type": "person"} for a in actors],
        "events": [{"what": f"e{i}", "where": {"name": p, "type": "location"}}
                   for i, p in enumerate(places)],
    }}


@pytest.fixture
def world(db):
    """Five articles — more than a two-annotation window, so every window
    boundary is crossed — and one failed annotation that must not count."""
    uid = _user(db, "network")
    iid = _infospace(db, uid, "network")
    sid = _schema_with(db, iid, uid, CONTRACT)
    run = _run(db, iid, uid, "r")
    other = _run(db, iid, uid, "other")
    rows = {
        "A1": doc(["Ann", "Bob"], ["Rome", "Paris", "Rome"]),
        "A2": doc(["Ann"], ["Rome"]),
        "A3": doc(["Bob", "Cy"], ["Oslo"]),
        "A4": doc(["Cy"], []),
        "A5": doc(["Ann", "Cy", "Dee"], ["Paris", "Oslo", "Lima", "Rome"]),
    }
    assets, anns = {}, {}
    for name, value in rows.items():
        assets[name] = _asset(db, iid, uid, name)
        anns[name] = _annotation(db, iid, uid, run, sid, assets[name], value)
    failed = _annotation(db, iid, uid, run, sid, assets["A1"], doc(["Zed"], ["Nowhere"]))
    db.execute(text("UPDATE annotation SET status = 'FAILED' WHERE id = :i"), {"i": failed})
    foreign = _annotation(db, iid, uid, other, sid, assets["A2"], doc(["Ann"], []))
    db.execute(text("UPDATE asset SET event_timestamp = '2026-03-04T05:06:07' WHERE id = :a"),
               {"a": assets["A3"]})
    canon = Canon(infospace_id=iid, name="places")
    db.add(canon)
    db.flush()
    for name, coords in (("Rome", [12.5, 41.9]), ("Paris", [2.35, 48.86])):
        db.add(CanonEntry(infospace_id=iid, canon_id=canon.id, canonical=name, type="location",
                          aliases=[], properties={"coords": coords}))
    db.execute(text("UPDATE annotationrun SET canon_ids = CAST(:c AS json) WHERE id = :r"),
               {"c": f"[{canon.id}]", "r": run})
    db.flush()
    scope = ov.open_scope(db, types.SimpleNamespace(infospace_id=iid, scope=None), run)
    return types.SimpleNamespace(db=db, scope=scope, assets=assets, anns=anns,
                                 failed=failed, foreign=foreign)


def _graph(w, *, chunk_size: int):
    aq = w.scope.query()
    source, _ = configure(aq)
    return asyncio.run(collect_graph(w.db, w.scope.infospace_id, source,
                                     top_n_nodes=None, top_n_edges=None,
                                     chunk_size=chunk_size))


def _shape(g):
    nodes = {(n.name, n.type): (n.frequency, sorted(n.source_annotation_ids)) for n in g.nodes}
    edges = sorted((e.source, e.target, e.predicate, e.weight) for e in g.edges)
    return nodes, edges


def test_windowing_by_annotation_is_invisible_in_the_graph(world):
    whole = _shape(_graph(world, chunk_size=500))
    for size in (1, 2, 3):
        assert _shape(_graph(world, chunk_size=size)) == whole
    names = {name for name, _ in whole[0]}
    assert {"Ann", "Bob", "Cy", "Dee", "Rome", "Paris", "Oslo", "Lima"} <= names
    assert "Zed" not in names and "Nowhere" not in names     # the failed row


def test_columns_are_the_graph_index_for_index(world):
    aq = world.scope.query()
    source, parsed = configure(aq)
    g = collect(aq, source, parsed)
    wire = net.pack(world.db, g)

    n = wire["nodes"]
    assert n["id"] == [x.id for x in g.nodes]
    offsets, ids = n["ann"]["offsets"], n["ann"]["ids"]
    assert len(offsets) == len(g.nodes) + 1
    for i, node in enumerate(g.nodes):
        assert ids[offsets[i]:offsets[i + 1]] == node.source_annotation_ids
        assert wire["vocab"]["type"][n["type"][i]] == node.type
        assert wire["vocab"]["node_kind"][n["kind"][i]] == node.kind

    e = wire["edges"]
    assert len(e["source"]) == len(g.edges)
    for j, edge in enumerate(g.edges):
        assert n["id"][e["source"][j]] == edge.source
        assert n["id"][e["target"][j]] == edge.target
        assert wire["vocab"]["predicate"][e["predicate"][j]] == edge.predicate

    by_ann = dict(zip(wire["assets"]["annotation"], wire["assets"]["asset"]))
    assert set(by_ann) == set(ids)
    assert by_ann[world.anns["A3"]] == world.assets["A3"]
    times = dict(zip(wire["assets"]["annotation"], wire["assets"]["time"]))
    assert times[world.anns["A3"]] == 1772600767          # 2026-03-04T05:06:07Z
    assert times[world.anns["A1"]] is None


def test_places_ship_the_ladder_whole(world):
    aq = world.scope.query()
    source, parsed = configure(aq)
    g = collect(aq, source, parsed)
    wire = net.pack(world.db, g)
    pl, vocab = wire["nodes"]["places"], wire["vocab"]

    shipped = 0
    for i, node in enumerate(g.nodes):
        claims = [p for p in node.places if p.lat is not None]
        lo, hi = pl["offsets"][i], pl["offsets"][i + 1]
        assert hi - lo == len(claims)
        for k, p in zip(range(lo, hi), claims):
            lat, lon, name = vocab["coord"][pl["coord"][k]]
            assert (lat, lon) == (round(p.lat, 5), round(p.lon, 5)) and name == p.place
            assert vocab["rung"][pl["rung"][k]] == p.source
        shipped += len(claims)
    assert shipped > 0
    names = {row[2] for row in vocab["coord"]}
    assert {"Rome", "Paris"} <= names
    assert len(vocab["coord"]) == len({(r[0], r[1]) for r in vocab["coord"]})  # one row per coordinate


def test_a_node_cap_drops_the_edges_it_cut_and_says_so(world):
    aq = world.scope.query()
    source, parsed = configure(aq)
    whole = collect(aq, source, parsed)
    source, parsed = configure(world.scope.query())
    capped = collect(world.scope.query(), source, parsed, top_n_nodes=3)
    wire = net.pack(world.db, capped)
    assert len(wire["nodes"]["id"]) == 3
    kept = set(wire["nodes"]["id"])
    assert all(wire["nodes"]["id"][s] in kept for s in wire["edges"]["source"])
    assert len(wire["edges"]["source"]) + wire["dropped_edges"] == len(capped.edges)
    assert len(capped.edges) <= len(whole.edges)


def test_a_selection_opens_its_assets(world):
    w = world
    ann = [w.anns["A1"], w.anns["A5"], w.anns["A5"], w.anns["A2"]]
    page = net.assets_of(w.scope, ann)
    assert page["total"] == 3
    # An annotation named twice is still one annotation; ties fall to the
    # newest asset.
    assert [(i["id"], i["n"]) for i in page["items"]] == [
        (w.assets["A5"], 1), (w.assets["A2"], 1), (w.assets["A1"], 1),
    ]
    assert page["items"][0]["kind"] == "article"

    paged = net.assets_of(w.scope, ann, offset=1, limit=1)
    assert len(paged["items"]) == 1 and paged["total"] == 3


def test_a_selection_cannot_reach_past_the_run(world):
    w = world
    page = net.assets_of(w.scope, [w.failed, w.foreign])
    assert page == {"items": [], "total": 0, "offset": 0}
    assert net.assets_of(w.scope, []) == {"items": [], "total": 0, "offset": 0}
