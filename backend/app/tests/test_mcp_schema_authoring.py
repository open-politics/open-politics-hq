"""Tests for the MCP field-list → output_contract builder.

The companion authors schemas through ``_fields_to_output_contract``. Whatever
it emits has to be recognised by the same walker every other consumer reads —
so these tests assert against ``SchemaMap`` rather than against raw JSON keys.
That coupling is the point: if the emitter and the walker ever disagree again,
this file fails.

The bug these guard: the builder previously emitted an entity-shaped object
*without* ``x-entityField``, so companion-authored entity fields were invisible
to curation, the prompt renderer, and the graph — despite the docstring
claiming otherwise.
"""
from __future__ import annotations

from app.api.modules.annotation.schema_map import build_schema_map
from app.api.modules.conversational_intelligence.mcp_server.server import (
    _fields_to_output_contract,
)


def _map(fields):
    return build_schema_map(_fields_to_output_contract(fields))


# ─── The regression ─────────────────────────────────────────────────────────


def test_entity_field_is_recognised_as_an_entity():
    m = _map([{"name": "entities", "type": "entity", "array": True, "entity_type": "Person"}])
    assert m.entity_paths == ("document.entities[*]",)
    assert m.get("document.entities[*]").entity_type == "Person"


def test_scalar_entity_field():
    m = _map([{"name": "location", "type": "entity", "entity_type": "Location"}])
    assert m.entity_paths == ("document.location",)
    assert "document.location" in m.place_paths


def test_entity_alternate_types_and_closed_names():
    m = _map([{
        "name": "actors", "type": "entity", "array": True,
        "entity_type": "Person", "entity_types": ["Organization"],
        "options": ["Angela Merkel", "BMW"],
    }])
    node = m.get("document.actors[*]")
    assert node.entity_type == "Person"
    assert node.alternate_types == ("Organization",)
    assert node.enum == ("Angela Merkel", "BMW")


def test_unconstrained_entity_keeps_vocabulary_off_the_wire():
    """``constrained: false`` must record the names as guidance only — never as
    a JSON Schema ``enum``, which would become a Pydantic Literal and make
    novel entities unrepresentable."""
    contract = _fields_to_output_contract([{
        "name": "actors", "type": "entity", "array": True, "entity_type": "Person",
        "options": ["A", "B"], "constrained": False,
    }])
    items = contract["properties"]["document"]["properties"]["actors"]["items"]
    assert items["x-entityEnum"] == ["A", "B"]
    assert "enum" not in items["properties"]["name"]
    assert build_schema_map(contract).get("document.actors[*]").enum == ("A", "B")


# ─── Nesting ────────────────────────────────────────────────────────────────


def test_nested_row_with_entity_leaves():
    m = _map([
        {"name": "entities", "type": "entity", "array": True, "entity_type": "Person"},
        {"name": "observations", "type": "object", "array": True, "fields": [
            {"name": "statement_by", "type": "entity", "entity_type": "Person"},
            {"name": "claim", "type": "text"},
        ]},
    ])
    assert "document.observations[*].statement_by" in m.entity_paths
    assert m.get("document.observations[*].claim").container == "document.observations[*]"


def test_ref_links_nested_leaf_to_roster():
    """The whole reason the companion needs ``ref``: without it the backend
    cannot know the row's entity field and the roster name one population."""
    m = _map([
        {"name": "entities", "type": "entity", "array": True, "entity_type": "Person"},
        {"name": "observations", "type": "object", "array": True, "fields": [
            {"name": "statement_by", "type": "entity", "entity_type": "Person", "ref": "entities"},
        ]},
    ])
    assert m.anchor_for("document.observations[*].statement_by") == "document.entities[*]"


def test_ref_on_array_entity_lands_on_the_array_node():
    m = _map([
        {"name": "entities", "type": "entity", "array": True, "entity_type": "Person"},
        {"name": "participants", "type": "entity", "array": True,
         "entity_type": "Person", "ref": "entities"},
    ])
    assert m.get("document.participants[*]").ref_target == "entities"
    assert m.anchor_for("document.participants[*]") == "document.entities[*]"


# ─── Graph fields ───────────────────────────────────────────────────────────


def test_graph_field_is_recognised_as_a_triplet():
    m = _map([{"name": "actions", "type": "graph"}])
    assert m.triplet_paths == ("document.actions[*]",)


def test_graph_field_anchors_and_extra_columns():
    m = _map([
        {"name": "entities", "type": "entity", "array": True, "entity_type": "Person"},
        {"name": "actions", "type": "graph", "from_source": "entities", "to_source": "entities",
         "predicates": ["funds", "owns"],
         "fields": [{"name": "start_date", "type": "date"},
                    {"name": "confidence", "type": "number"}]},
    ])
    node = m.get("document.actions[*]")
    assert node.from_source == "entities"
    assert node.to_source == "entities"
    assert m.get("document.actions[*].confidence").shape == "number"
    assert "document.actions[*].start_date" in m.time_paths


def test_graph_predicates_constrained_only_when_asked():
    contract = _fields_to_output_contract([
        {"name": "a", "type": "graph", "predicates": ["x"], "predicates_constrained": False},
    ])
    pred = contract["properties"]["document"]["properties"]["a"]["items"]["properties"]["predicate"]
    assert pred["x-predicateList"] == ["x"]
    assert "enum" not in pred


# ─── The canonical shape, authored end to end ───────────────────────────────


def test_companion_can_author_the_canonical_graph_schema():
    """The shape the whole graph domain is designed around — roster, linked
    rows, anchored triplets — must be reachable from the companion's field
    list, or LLM-guided setup can never produce a graphable schema."""
    m = _map([
        {"name": "event_timestamp", "type": "date"},
        {"name": "location", "type": "entity", "entity_type": "Location"},
        {"name": "salience", "type": "integer"},
        {"name": "entities", "type": "entity", "array": True, "entity_type": "Person",
         "canon": {"type": "Person", "inject": "types"}},
        {"name": "observations", "type": "object", "array": True, "fields": [
            {"name": "statement_by", "type": "entity", "entity_type": "Person", "ref": "entities"},
            {"name": "directed_to", "type": "entity", "entity_type": "Person", "ref": "entities"},
            {"name": "claim", "type": "text"},
            {"name": "timestamp", "type": "date"},
        ]},
        {"name": "actions", "type": "graph", "from_source": "entities", "to_source": "entities"},
    ])

    assert m.triplet_paths == ("document.actions[*]",)
    assert set(m.vocabularies["document.entities[*]"]) == {
        "document.observations[*].statement_by",
        "document.observations[*].directed_to",
    }
    assert "document.event_timestamp" in m.time_paths
    assert "document.observations[*].timestamp" in m.time_paths
    assert "document.location" in m.place_paths
    tie = m.get("document.entities[*]").canon
    assert tie.type == "Person" and tie.inject == "types"


# ─── Behaviour preserved ────────────────────────────────────────────────────


def test_scalars_and_enums_unchanged():
    contract = _fields_to_output_contract([
        {"name": "topic", "type": "enum", "options": ["a", "b"]},
        {"name": "score", "type": "number"},
        {"name": "flag", "type": "boolean"},
        {"name": "tags", "type": "text", "array": True},
    ])
    props = contract["properties"]["document"]["properties"]
    assert props["topic"] == {"type": "string", "enum": ["a", "b"], "description": ""}
    assert props["score"]["type"] == "number"
    assert props["flag"]["type"] == "boolean"
    assert props["tags"] == {"type": "array", "items": {"type": "string", "description": ""}, "description": ""}


def test_fields_are_required_by_default_and_can_opt_out():
    contract = _fields_to_output_contract([
        {"name": "a", "type": "text"},
        {"name": "b", "type": "text", "required": False},
    ])
    assert contract["properties"]["document"]["required"] == ["a"]


def test_bracket_suffix_still_means_array():
    contract = _fields_to_output_contract([{"name": "xs", "type": "text[]"}])
    assert contract["properties"]["document"]["properties"]["xs"]["type"] == "array"


def test_unnamed_and_malformed_fields_skipped():
    contract = _fields_to_output_contract([{"type": "text"}, None, "nope", {"name": "ok", "type": "text"}])
    assert list(contract["properties"]["document"]["properties"]) == ["ok"]
