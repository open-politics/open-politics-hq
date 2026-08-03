"""``x-ref`` as a union — one role drawing from several rosters."""
from __future__ import annotations

import pytest

from app.api.modules.annotation.schema_map import (
    SchemaRefCycleError, schema_map_for,
)


def _entity(etype: str, ref=None):
    node = {
        "type": "object", "x-entityField": True, "x-entityType": etype,
        "properties": {"name": {"type": "string"}, "type": {"type": "string"}},
        "required": ["name"],
    }
    if ref is not None:
        node["x-ref"] = ref
    return node


def _contract(via_ref):
    return {
        "type": "object",
        "properties": {"document": {"type": "object", "properties": {
            "actors": {"type": "array", "items": _entity("Person")},
            "instruments": {"type": "array", "items": _entity("Account")},
            "observations": {"type": "array", "items": {
                "type": "object",
                "properties": {"via": _entity("Organization", ref=via_ref)},
            }},
        }}},
    }


def test_a_single_target_still_resolves():
    m = schema_map_for(_contract("actors"))
    node = m.get("document.observations[*].via")
    assert node.ref_targets == ("actors",)
    assert node.ref_target == "actors"          # back-compat view
    assert "document.observations[*].via" in m.vocabularies["document.actors[*]"]


def test_a_union_registers_under_every_roster_it_draws_from():
    """A `via` is an intermediary OR a routing account. Declaring one target
    forced the field to misdescribe where its vocabulary comes from."""
    m = schema_map_for(_contract(["actors", "instruments"]))
    node = m.get("document.observations[*].via")
    assert node.ref_targets == ("actors", "instruments")

    for roster in ("document.actors[*]", "document.instruments[*]"):
        assert "document.observations[*].via" in m.vocabularies[roster], roster


def test_ref_target_reports_the_first_of_a_union():
    m = schema_map_for(_contract(["instruments", "actors"]))
    assert m.get("document.observations[*].via").ref_target == "instruments"


def test_an_empty_or_missing_ref_is_no_ref():
    for raw in (None, "", "   ", [], ["", "  "]):
        m = schema_map_for(_contract(raw))
        assert m.get("document.observations[*].via").ref_targets == ()


def test_a_dangling_target_is_skipped_not_fatal():
    """The contract is already stored; one bad pointer must not take down the
    map for every consumer."""
    m = schema_map_for(_contract(["actors", "nope"]))
    assert "document.observations[*].via" in m.vocabularies["document.actors[*]"]


def test_a_cycle_still_raises():
    c = {
        "type": "object",
        "properties": {"document": {"type": "object", "properties": {
            "a": _entity("Person", ref="b"),
            "b": _entity("Person", ref="a"),
        }}},
    }
    with pytest.raises(SchemaRefCycleError):
        schema_map_for(c)


def test_a_union_reaching_one_anchor_two_ways_is_not_a_cycle():
    """Diamond, not a loop: via → {alias, actors} and alias → actors."""
    c = {
        "type": "object",
        "properties": {"document": {"type": "object", "properties": {
            "actors": {"type": "array", "items": _entity("Person")},
            "alias": _entity("Person", ref="actors"),
            "via": _entity("Person", ref=["alias", "actors"]),
        }}},
    }
    m = schema_map_for(c)
    assert "document.via" in m.vocabularies["document.actors[*]"]
