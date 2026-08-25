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


def _entity_list(etype: str, ref=None):
    """An array-of-entity — the shape that carries ``x-ref`` on its ITEMS.

    This is the *common* shape: `by`, `with`, `to`, `via`, `serves`, `cites` are
    all multi-valued, and both emitters put the ref on the item
    (``adapters.ts:buildEntityObjectSchema``, ``templates.entity_list``). It was
    also the untested one — every case below used to run against the scalar
    only, which is why ``_parse_refs`` reading ``x-ref`` off the array node
    instead of its items went unnoticed while the vocabulary index came up
    empty for every multi-valued role in a real contract.
    """
    return {"type": "array", "items": _entity(etype, ref)}


#: The two shapes an entity field takes, and the path each produces. Every
#: ref-resolution case runs against both — see :func:`_entity_list`.
SHAPES = [
    pytest.param(_entity, "document.observations[*].via", id="scalar"),
    pytest.param(_entity_list, "document.observations[*].via[*]", id="array"),
]


def _contract(via_ref, make=_entity):
    return {
        "type": "object",
        "properties": {"document": {"type": "object", "properties": {
            "actors": {"type": "array", "items": _entity("Person")},
            "instruments": {"type": "array", "items": _entity("Account")},
            "observations": {"type": "array", "items": {
                "type": "object",
                "properties": {"via": make("Organization", ref=via_ref)},
            }},
        }}},
    }


@pytest.mark.parametrize("make,via", SHAPES)
def test_a_single_target_still_resolves(make, via):
    m = schema_map_for(_contract("actors", make))
    node = m.get(via)
    assert node.ref_targets == ("actors",)
    assert node.ref_target == "actors"          # back-compat view
    assert via in m.vocabularies["document.actors[*]"]


@pytest.mark.parametrize("make,via", SHAPES)
def test_a_union_registers_under_every_roster_it_draws_from(make, via):
    """A `via` is an intermediary OR a routing account. Declaring one target
    forced the field to misdescribe where its vocabulary comes from."""
    m = schema_map_for(_contract(["actors", "instruments"], make))
    node = m.get(via)
    assert node.ref_targets == ("actors", "instruments")

    for roster in ("document.actors[*]", "document.instruments[*]"):
        assert via in m.vocabularies[roster], roster


@pytest.mark.parametrize("make,via", SHAPES)
def test_ref_target_reports_the_first_of_a_union(make, via):
    m = schema_map_for(_contract(["instruments", "actors"], make))
    assert m.get(via).ref_target == "instruments"


@pytest.mark.parametrize("make,via", SHAPES)
def test_an_empty_or_missing_ref_is_no_ref(make, via):
    for raw in (None, "", "   ", [], ["", "  "]):
        m = schema_map_for(_contract(raw, make))
        assert m.get(via).ref_targets == ()


@pytest.mark.parametrize("make,via", SHAPES)
def test_a_dangling_target_is_skipped_not_fatal(make, via):
    """The contract is already stored; one bad pointer must not take down the
    map for every consumer."""
    m = schema_map_for(_contract(["actors", "nope"], make))
    assert via in m.vocabularies["document.actors[*]"]


@pytest.mark.parametrize("make,_via", SHAPES)
def test_a_cycle_still_raises(make, _via):
    c = {
        "type": "object",
        "properties": {"document": {"type": "object", "properties": {
            "a": make("Person", ref="b"),
            "b": make("Person", ref="a"),
        }}},
    }
    with pytest.raises(SchemaRefCycleError):
        schema_map_for(c)


@pytest.mark.parametrize("make,_via", SHAPES)
def test_a_union_reaching_one_anchor_two_ways_is_not_a_cycle(make, _via):
    """Diamond, not a loop: via → {alias, actors} and alias → actors."""
    c = {
        "type": "object",
        "properties": {"document": {"type": "object", "properties": {
            "actors": {"type": "array", "items": _entity("Person")},
            "alias": make("Person", ref="actors"),
            "via": make("Person", ref=["alias", "actors"]),
        }}},
    }
    m = schema_map_for(c)
    suffix = "[*]" if make is _entity_list else ""
    assert f"document.via{suffix}" in m.vocabularies["document.actors[*]"]


def test_a_ref_on_the_array_rather_than_its_items_still_resolves():
    """Belt-and-braces for a hand-authored or MCP-written contract.

    The adapter and the templates both put the ref on the item, but nothing
    stops a contract from declaring it on the array. Items win; the array is
    the fallback.
    """
    node = {"type": "array", "items": _entity("Organization"), "x-ref": "actors"}
    c = {
        "type": "object",
        "properties": {"document": {"type": "object", "properties": {
            "actors": {"type": "array", "items": _entity("Person")},
            "via": node,
        }}},
    }
    m = schema_map_for(c)
    assert m.get("document.via[*]").ref_targets == ("actors",)
    assert "document.via[*]" in m.vocabularies["document.actors[*]"]
