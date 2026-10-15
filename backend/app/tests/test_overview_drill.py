"""Opening an overview count — `annotation/overview.py::assets_for`, `within`.

The list a marker or a rank opens must be the list it counted: same streams,
same spellings, same narrowing. Real Postgres, rolled back per test.
"""
from __future__ import annotations

import types

import pytest
from sqlalchemy import text

import app.models  # noqa: F401 — every mapper, so the ORM inserts below configure
from app.api.modules.annotation import overview as ov
from app.api.modules.annotation.bindings import Pick
from app.api.modules.graph.models import Canon, CanonEntry
from app.api.modules.graph.places import spellings_of
from app.tests.test_graph_stream import (  # noqa: F401 — fixtures
    _annotation, _asset, _infospace, _run, _schema_with, _user, db, pg_engine,
)


def entity(t: str) -> dict:
    return {"type": "object", "x-entityField": True, "x-entityType": t,
            "properties": {"name": {"type": "string"}, "type": {"type": "string"}}}


CONTRACT = {"type": "object", "properties": {"document": {"type": "object", "properties": {
    "dated": {"type": "string", "format": "date"},
    "actors": {"type": "array", "items": entity("person")},
    "events": {"type": "array", "items": {"type": "object", "properties": {
        "what": {"type": "string"}, "where": entity("location")}}},
}}}}


def doc(dated: str, actors: list[str], places: list[str]) -> dict:
    return {"document": {
        "dated": dated,
        "actors": [{"name": a, "type": "person"} for a in actors],
        "events": [{"what": "x", "where": {"name": p, "type": "location"}} for p in places],
    }}


def _canon(db, iid: int, name: str) -> int:
    c = Canon(infospace_id=iid, name=name)
    db.add(c)
    db.flush()
    return c.id


def _entry(db, iid: int, cid: int, canonical: str, aliases: list[str], coords=None) -> int:
    e = CanonEntry(infospace_id=iid, canon_id=cid, canonical=canonical, type="location",
                   aliases=aliases, properties={"coords": coords} if coords else {})
    db.add(e)
    db.flush()
    return e.id


@pytest.fixture
def world(db):
    """Three articles. "United States" and "US" are one canon entry.

        A1  2026-01-05  Ann        United States, US
        A2  2026-02-10  Ann, Bob   Rome
        A3  2026-02-11  Bob        United States
    """
    uid = _user(db, "overview-drill")
    iid = _infospace(db, uid, "overview-drill")
    sid = _schema_with(db, iid, uid, CONTRACT)
    run = _run(db, iid, uid, "r")
    cid = _canon(db, iid, "places")
    us = _entry(db, iid, cid, "United States", ["US"], coords=[-98.5, 39.8])
    _entry(db, iid, cid, "Rome", [], coords=[12.5, 41.9])
    db.execute(text("UPDATE annotationrun SET canon_ids = CAST(:c AS json) WHERE id = :r"),
               {"c": f"[{cid}]", "r": run})
    assets = {}
    for name, value in (("A1", doc("2026-01-05", ["Ann"], ["United States", "US"])),
                        ("A2", doc("2026-02-10", ["Ann", "Bob"], ["Rome"])),
                        ("A3", doc("2026-02-11", ["Bob"], ["United States"]))):
        assets[name] = _asset(db, iid, uid, name)
        _annotation(db, iid, uid, run, sid, assets[name], value)
    db.flush()

    scope = ov.open_scope(db, types.SimpleNamespace(infospace_id=iid, scope=None), run)
    events = f"{sid}:document.events[*]"
    plans, _ = ov.schema_plans(scope, {events: Pick(place="document.events[*].where")})
    return types.SimpleNamespace(scope=scope, plans=plans, assets=assets, us=f"entry:{us}",
                                 events=events, iid=iid)


def _ids(w, page) -> dict[str, int]:
    names = {v: k for k, v in w.assets.items()}
    return {names[i["id"]]: i["n"] for i in page["items"]}


def test_a_place_opens_exactly_the_assets_its_marker_counted(world):
    w = world
    b = ov.buckets(w.scope, w.plans)
    i = b["places"]["id"].index(w.us)
    assert b["places"]["assets"][i] == 2           # A1 under two spellings, A3

    page = ov.assets_for(w.scope, w.plans, place=w.us, sections=[w.events])
    assert _ids(w, page) == {"A1": 2, "A3": 1}     # rows placing it there
    assert page["total"] == 2
    assert page["spellings"] == ["united states", "us"]
    assert next(x for x in page["items"] if x["n"] == 2)["kind"] == "article"


def test_an_entity_opens_the_assets_that_name_it(world):
    page = ov.assets_for(world.scope, world.plans, entity="name:ann")
    assert _ids(world, page) == {"A1": 1, "A2": 1}
    assert {x["t"][:10] for x in page["items"]} == {"2026-01-05", "2026-02-10"}


def test_within_narrows_the_whole_reading_to_one_entity(world):
    w = world
    b = ov.buckets(w.scope, w.plans, within="name:bob")
    assert sum(n for _, n in b["asset_time"]) == 2  # A2, A3
    places = dict(zip(b["places"]["id"], b["places"]["assets"]))
    assert places[w.us] == 1

    e = ov.entities(w.scope, w.plans, within="name:bob")
    assert {x["name"]: x["assets"] for x in e["items"]} == {"Bob": 2, "Ann": 1}

    page = ov.assets_for(w.scope, w.plans, place=w.us, within="name:ann")
    assert _ids(w, page) == {"A1": 2}


def test_an_entity_nothing_names_narrows_to_nothing(world):
    b = ov.buckets(world.scope, world.plans, within="name:nobody")
    assert b["places"]["id"] == [] and b["asset_time"] == []


def test_the_time_brush_cuts_the_list_like_it_cuts_the_strip(world):
    page = ov.assets_for(world.scope, world.plans, place=world.us,
                         window=("2026-02-01", "2026-02-01"), grain="month")
    assert set(_ids(world, page)) == {"A3"}


def test_a_spelling_an_earlier_canon_claims_is_not_this_entrys(db):
    uid = _user(db, "overview-spell")
    iid = _infospace(db, uid, "overview-spell")
    first, second = _canon(db, iid, "run"), _canon(db, iid, "geo")
    _entry(db, iid, first, "USA", ["US"])
    us = _entry(db, iid, second, "United States", ["US", "America"])
    keys = spellings_of(db, iid, f"entry:{us}", canon_ids=[first], geo_canon_id=second)
    assert keys == ["america", "united states"]    # "us" resolves to the run's entry
    assert spellings_of(db, iid, "name:rome") == ["rome"]
    assert spellings_of(db, iid, "entry:not-a-number") == []
