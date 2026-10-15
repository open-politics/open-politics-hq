"""Where and when a section's rows are — `annotation/bindings.py`.

Pure: every case is a contract in, a plan out. No database, no names read.
"""
from __future__ import annotations

from app.api.modules.annotation.bindings import (
    Pick, plan_schema, spatial_from, undecided_places,
)
from app.api.modules.annotation.schema_map import build_schema_map


def entity(t: str, ref: str | list[str] | None = None) -> dict:
    out: dict = {"type": "object", "x-entityField": True, "x-entityType": t,
                 "properties": {"name": {"type": "string"}, "type": {"type": "string"}}}
    if ref:
        out["x-ref"] = ref
    return out


def rows(props: dict, **decl) -> dict:
    out: dict = {"type": "array", "items": {"type": "object", "properties": props}}
    if decl:
        out["x-graph"] = decl
    return out


def roster(t: str, **decl) -> dict:
    out: dict = {"type": "array", "items": entity(t)}
    if decl:
        out["x-graph"] = decl
    return out


def contract(**fields) -> dict:
    return {"type": "object", "properties": {"document": {"type": "object", "properties": fields}}}


def plan(c: dict, **kw):
    return plan_schema(7, "s", build_schema_map(c), **kw)


def by_label(p):
    return {s.label: s for s in p.all}


# ─── Time ───────────────────────────────────────────────────────────────────


def test_time_is_declared_then_structural():
    p = by_label(plan(contract(
        quando={"type": "string", "format": "date"},
        hechos=rows({"fecha": {"type": "string", "format": "date"}, "nota": {"type": "string"}},
                    time={"start": "fecha"}),
        otros=rows({"dia": {"type": "string", "format": "date"}}),
        sin=rows({"nota": {"type": "string"}}),
    )))
    assert (p["Document"].time.path, p["Document"].time.source) == ("document.quando", "structural")
    assert (p["hechos"].time.path, p["hechos"].time.source) == ("document.hechos[*].fecha", "declared")
    assert (p["otros"].time.path, p["otros"].time.source) == ("document.otros[*].dia", "structural")
    assert p["sin"].time.path is None


def test_a_declared_end_never_becomes_the_start():
    """The declaration names `when` (missing) as start and `until` as end.
    The structural fallback must skip `until`, not promote it."""
    p = by_label(plan(contract(events=rows(
        {"until": {"type": "string", "format": "date"},
         "when_timestamp": {"type": "string", "format": "date"}},
        time={"start": "when", "end": "until"},
    ))))
    assert p["events"].time.path == "document.events[*].when_timestamp"


# ─── Place ──────────────────────────────────────────────────────────────────


def test_place_declared_by_binding_by_geo_roster_and_by_reference():
    p = by_label(plan(contract(
        lugares=roster("Lugar", frame="geo"),
        ort=entity("Lugar", ref="lugares"),
        hechos=rows({"bei": entity("Lugar"), "wer": entity("Persona")},
                    place={"at": "bei.name"}),
    )))
    assert (p["Document"].place.path, p["Document"].place.source) == ("document.ort", "declared")
    assert (p["lugares"].place.path, p["lugares"].place.source) == ("document.lugares[*]", "declared")
    assert (p["hechos"].place.path, p["hechos"].place.source) == ("document.hechos[*].bei", "declared")


def test_discovered_place_fills_only_where_the_contract_is_silent():
    c = contract(stadt=entity("Ort"), firma=entity("Org"))
    draft = plan(c)
    assert draft.document.place.path is None
    assert undecided_places(draft) == {"document.stadt", "document.firma"}
    spatial = spatial_from({"document.stadt": (40, 44), "document.firma": (1, 50)})
    p = plan(c, spatial=spatial)
    assert (p.document.place.path, p.document.place.source) == ("document.stadt", "discovered")


def test_a_mixed_reference_is_never_sampled():
    """`subject` names an actor OR a place — the contract has said so."""
    c = contract(
        places=roster("Location", frame="geo"),
        actors=roster("Person"),
        attrs=rows({"subject": entity("Person", ref=["actors", "places"])}),
    )
    assert "document.attrs[*].subject" not in undecided_places(plan(c))


def test_a_roster_is_placed_by_declaration_never_by_sampling():
    """Some actors are states; that must not put the actors roster on the map."""
    c = contract(actors=roster("Person"))
    assert "document.actors[*]" not in undecided_places(plan(c))
    p = plan(c, spatial=frozenset({"document.actors[*]"}))
    assert by_label(p)["actors"].place.path is None


def test_interest_sections_are_never_placed():
    c = contract(interests=roster("Interest", frame="interest"))
    s = by_label(plan(c, picks={"7:document.interests[*]": Pick(place="document.interests[*]")}))
    assert s["interests"].place.path is None
    assert s["interests"].place_candidates == ()


# ─── Picks ──────────────────────────────────────────────────────────────────


def test_a_pick_overrides_and_none_is_an_answer():
    c = contract(
        at=entity("Location", ref="places"),
        places=roster("Location", frame="geo"),
        notes=rows({"seen": {"type": "string"}, "on": {"type": "string", "format": "date"}}),
    )
    p = by_label(plan(c, picks={
        "7:@document": Pick(place=None),
        "7:document.notes[*]": Pick(time="document.notes[*].seen"),
    }))
    assert (p["Document"].place.path, p["Document"].place.source) == (None, "none")
    assert (p["notes"].time.path, p["notes"].time.source) == ("document.notes[*].seen", "picked")


def test_spatial_thresholds():
    assert spatial_from({"a": (3, 5), "b": (2, 2), "c": (2, 10), "d": (10, 30)}) == {"a", "b"}
