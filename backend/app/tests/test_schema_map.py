"""Tests for ``SchemaMap`` — the backend's resolved view of an output_contract.

Unit tests over synthetic contracts — no DB, no fixtures. The contracts here
mirror what ``adapters.ts`` actually emits (entity objects carry
``x-entityField``, graph fields emit triplet arrays, refs round-trip as
``x-ref``), so a drift between the emitter and this walker shows up here.
"""
from __future__ import annotations

import pytest

from app.api.modules.annotation.schema_map import (
    SchemaRefCycleError,
    build_schema_map,
    iter_entity_refs,
    iter_values,
    infer_shape,
    strip_explosions,
)


# ─── Contract builders (mirror adapters.ts output) ──────────────────────────


def entity_object(entity_type: str = "", *, names: list[str] | None = None,
                  constrained: bool = True, ref: str | None = None) -> dict:
    """What ``adapters.ts:buildEntityObjectSchema`` emits."""
    obj: dict = {
        "type": "object",
        "x-entityField": True,
        "properties": {
            "name": {"type": "string"},
            "type": {"type": "string"},
            "additional_types": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name"],
        "x-entityTypeConstrained": constrained,
    }
    if entity_type:
        obj["x-entityType"] = entity_type
        obj["properties"]["type"]["x-entityTypeDeclared"] = entity_type
    if names:
        obj["x-entityEnum"] = names
        if constrained:
            obj["properties"]["name"]["enum"] = names
    if ref:
        obj["x-ref"] = ref
    return obj


def triplet_array(*, optional: dict | None = None,
                  from_source: str | None = None) -> dict:
    props = {
        "subject_name": {"type": "string"},
        "subject_type": {"type": "string"},
        "predicate": {"type": "string"},
        "object_name": {"type": "string"},
        "object_type": {"type": "string"},
    }
    props.update(optional or {})
    out: dict = {
        "type": "array",
        "items": {"type": "object", "properties": props},
    }
    if from_source:
        out["x-fromSource"] = from_source
    return out


def document(**fields) -> dict:
    return {"type": "object", "properties": {"document": {"type": "object", "properties": fields}}}


# ─── infer_shape ────────────────────────────────────────────────────────────


def test_entity_extension_wins_over_declared_object_type():
    """An entity node IS ``type: object`` — without the extension check it
    would collapse into the generic object branch."""
    assert infer_shape(entity_object("Person")) == "entity"


def test_array_of_entities():
    assert infer_shape({"type": "array", "items": entity_object("Person")}) == "array_entity"


def test_triplet_shape_by_structure_not_name():
    """Matches curation._is_triplet_subschema: shape decides, not the key."""
    assert infer_shape(triplet_array()) == "triplet"


def test_triplet_requires_all_three_roles():
    partial = {
        "type": "array",
        "items": {"type": "object", "properties": {"subject_name": {}, "predicate": {}}},
    }
    assert infer_shape(partial) == "array_object"


def test_triplet_accepts_bare_subject_object_aliases():
    """Schemas in the wild use ``subject``/``object`` as well as the ``_name``
    suffixed keys."""
    bare = {
        "type": "array",
        "items": {"type": "object", "properties": {
            "subject": {}, "predicate": {}, "object": {},
        }},
    }
    assert infer_shape(bare) == "triplet"


def test_object_root_with_triplet_keys_is_not_a_triplet():
    """Triplets are arrays. A lone object carrying the same keys is one row,
    not a graph field."""
    assert infer_shape({
        "type": "object",
        "properties": {"subject_name": {}, "predicate": {}, "object_name": {}},
    }) == "object"


def test_array_of_primitives_is_not_a_triplet():
    assert infer_shape({"type": "array", "items": {"type": "string"}}) == "array_string"


def test_scalar_shapes():
    assert infer_shape({"type": "string"}) == "string"
    assert infer_shape({"type": "string", "enum": ["a", "b"]}) == "enum_string"
    assert infer_shape({"type": "string", "format": "date-time"}) == "date"
    assert infer_shape({"type": "integer"}) == "number"
    assert infer_shape({"type": "boolean"}) == "boolean"
    assert infer_shape({"type": "array", "items": {"type": "string"}}) == "array_string"
    assert infer_shape({"type": "array", "items": {"type": "number"}}) == "array_number"


# ─── Path grammar ───────────────────────────────────────────────────────────


def test_array_nodes_carry_explosion_marker_and_children_hang_off_it():
    m = build_schema_map(document(
        observations={
            "type": "array",
            "items": {"type": "object", "properties": {"claim": {"type": "string"}}},
        },
    ))
    paths = {n.path for n in m.fields}
    assert "document.observations[*]" in paths
    assert "document.observations[*].claim" in paths


def test_container_is_nearest_enclosing_array():
    m = build_schema_map(document(
        observations={
            "type": "array",
            "items": {"type": "object", "properties": {"claim": {"type": "string"}}},
        },
        salience={"type": "number"},
    ))
    assert m.get("document.observations[*].claim").container == "document.observations[*]"
    # A section-root scalar hangs off no array.
    assert m.get("document.salience").container is None


def test_entity_internals_are_not_walked():
    """``{name, type, additional_types}`` is a closed system shape — walking it
    would triple the map for no consumer."""
    m = build_schema_map(document(entities={"type": "array", "items": entity_object("Person")}))
    paths = {n.path for n in m.fields}
    assert "document.entities[*]" in paths
    assert "document.entities[*].name" not in paths
    assert "document.entities[*].additional_types" not in paths


def test_canon_injected_property_bag_is_walked():
    """The injected bag IS user-declared (it comes from Canon.type_schemas), so
    unlike the closed identity keys it must be addressable."""
    ent = entity_object("Politician")
    ent["properties"]["properties"] = {
        "type": "object",
        "properties": {"birthdate": {"type": "string"}, "current_job": {"type": "string"}},
    }
    m = build_schema_map(document(entities={"type": "array", "items": ent}))
    paths = {n.path for n in m.fields}
    assert "document.entities[*].properties.birthdate" in paths
    assert "document.entities[*].properties.current_job" in paths


def test_per_modality_section_paths():
    contract = {
        "type": "object",
        "properties": {
            "document": {"type": "object", "properties": {"topic": {"type": "string"}}},
            "per_image": {
                "type": "array",
                "items": {"type": "object", "properties": {"caption": {"type": "string"}}},
            },
        },
    }
    m = build_schema_map(contract)
    assert m.get("per_image[*].caption").section == "per_image"
    assert m.get("document.topic").section == "document"


def test_flat_contract_without_document_wrapper():
    """MCP-authored and legacy schemas put fields at the root. Same two layouts
    ``split_schema_for_extraction`` already accommodates."""
    m = build_schema_map({"type": "object", "properties": {"sentiment": {"type": "string"}}})
    assert m.get("sentiment") is not None
    assert m.get("sentiment").section == "document"


# ─── Classification ─────────────────────────────────────────────────────────


def test_entity_and_triplet_paths_collected():
    m = build_schema_map(document(
        entities={"type": "array", "items": entity_object("Person")},
        location=entity_object("Location"),
        actions=triplet_array(),
    ))
    assert set(m.entity_paths) == {"document.entities[*]", "document.location"}
    assert m.triplet_paths == ("document.actions[*]",)


def test_entity_metadata_parsed_from_items_for_arrays():
    ent = entity_object("Politician", names=["Angela Merkel", "Olaf Scholz"])
    ent["x-entityAlternateTypes"] = ["Person"]
    m = build_schema_map(document(entities={"type": "array", "items": ent}))
    node = m.get("document.entities[*]")
    assert node.entity_type == "Politician"
    assert node.alternate_types == ("Person",)
    assert node.enum == ("Angela Merkel", "Olaf Scholz")
    assert node.type_constrained is True


def test_entity_vocabulary_reported_even_when_unconstrained():
    """``names_guided`` writes x-entityEnum without ``enum`` — the map must
    still report the vocabulary, or the prompt renderer has nothing to show."""
    ent = entity_object("Person", names=["A", "B"], constrained=False)
    m = build_schema_map(document(entities={"type": "array", "items": ent}))
    node = m.get("document.entities[*]")
    assert node.enum == ("A", "B")
    assert node.type_constrained is False


def test_time_and_place_candidates():
    m = build_schema_map(document(
        event_timestamp={"type": "string"},
        location=entity_object("Location"),
        claim={"type": "string"},
        observations={
            "type": "array",
            "items": {"type": "object", "properties": {
                "timestamp": {"type": "string"},
                "note": {"type": "string"},
            }},
        },
    ))
    assert "document.event_timestamp" in m.time_paths
    assert "document.observations[*].timestamp" in m.time_paths
    assert "document.claim" not in m.time_paths
    assert "document.location" in m.place_paths


def test_place_candidate_by_entity_type_not_just_name():
    """A field called ``origin`` typed Location is still a place anchor."""
    m = build_schema_map(document(origin=entity_object("Location")))
    assert "document.origin" in m.place_paths


def test_triplet_optional_fields_are_addressable():
    """Time bindings and edge weights point at triplet-internal fields."""
    m = build_schema_map(document(actions=triplet_array(optional={
        "start_date": {"type": "string"},
        "confidence": {"type": "number"},
    })))
    assert m.get("document.actions[*].confidence").shape == "number"
    assert "document.actions[*].start_date" in m.time_paths


def test_from_source_anchor_round_trips():
    m = build_schema_map(document(
        entities={"type": "array", "items": entity_object("Person")},
        actions=triplet_array(from_source="entities"),
    ))
    assert m.get("document.actions[*]").from_source == "entities"


def test_canon_tie_parsed_with_injection_controls():
    """``adapters.ts`` writes ``x-canon`` onto the property node — so for an
    ``array_entity`` it lands on the array, not on the items."""
    m = build_schema_map(document(entities={
        "type": "array",
        "items": entity_object("Politician"),
        "x-canon": {
            "type": "Politician", "canon_id": 7,
            "types": ["Politician", "Party"],
            "inject": "types", "inject_properties": True,
        },
    }))
    tie = m.get("document.entities[*]").canon
    assert tie.type == "Politician"
    assert tie.canon_id == 7
    assert tie.types == ("Politician", "Party")
    assert tie.inject == "types"
    assert tie.inject_properties is True


def test_canon_tie_defaults_on_legacy_contract():
    """A contract predating the injection controls gets safe defaults, not a
    crash — ``x-canon`` has been round-tripping as ``{canon_id, type}`` alone."""
    m = build_schema_map(document(entities={
        "type": "array",
        "items": entity_object("Person"),
        "x-canon": {"type": "Person", "canon_id": 3},
    }))
    tie = m.get("document.entities[*]").canon
    assert tie.inject == "none"
    assert tie.inject_properties is False
    assert tie.types == ()


def test_canon_tie_on_scalar_entity_node():
    """``buildEntityObjectSchema`` does not emit ``x-canon`` today, so a scalar
    entity field silently loses its tie. The walker reads it off the node
    regardless, so the tie resolves the moment the emitter is fixed."""
    ent = entity_object("Location")
    ent["x-canon"] = {"type": "location", "inject": "types"}
    m = build_schema_map(document(location=ent))
    tie = m.get("document.location").canon
    assert tie.type == "location"
    assert tie.inject == "types"


# ─── Vocabularies (x-ref) ───────────────────────────────────────────────────


def test_ref_resolves_nested_leaf_to_toplevel_anchor():
    """The whole point: the backend learns that a nested row's entity field and
    the top-level roster name the same population."""
    m = build_schema_map(document(
        entities={"type": "array", "items": entity_object("Person")},
        observations={
            "type": "array",
            "items": {"type": "object", "properties": {
                "statement_by": entity_object("Person", ref="entities"),
                "claim": {"type": "string"},
            }},
        },
    ))
    assert m.vocabularies == {
        "document.entities[*]": ("document.observations[*].statement_by",),
    }
    assert m.anchor_for("document.observations[*].statement_by") == "document.entities[*]"


def test_multiple_refs_share_one_anchor():
    m = build_schema_map(document(
        entities={"type": "array", "items": entity_object("Person")},
        observations={
            "type": "array",
            "items": {"type": "object", "properties": {
                "statement_by": entity_object("Person", ref="entities"),
                "directed_to": entity_object("Person", ref="entities"),
            }},
        },
    ))
    assert set(m.vocabularies["document.entities[*]"]) == {
        "document.observations[*].statement_by",
        "document.observations[*].directed_to",
    }


def test_ref_chain_follows_to_the_end():
    """Refs of refs are legal (adapters.ts:resolveFieldRef walks them); every
    member must land on the terminal anchor, not its immediate target."""
    m = build_schema_map(document(
        entities={"type": "array", "items": entity_object("Person")},
        speakers=entity_object("Person", ref="entities"),
        quoted=entity_object("Person", ref="speakers"),
    ))
    assert m.anchor_for("document.quoted") == "document.entities[*]"
    assert m.anchor_for("document.speakers") == "document.entities[*]"


def test_ref_cycle_raises():
    m_contract = document(
        a=entity_object("Person", ref="b"),
        b=entity_object("Person", ref="a"),
    )
    with pytest.raises(SchemaRefCycleError) as exc:
        build_schema_map(m_contract)
    assert len(exc.value.cycle_path) >= 2


def test_dangling_ref_is_skipped_not_fatal():
    """The contract is already stored — failing the map over one unreachable
    pointer would take down every consumer."""
    m = build_schema_map(document(orphan=entity_object("Person", ref="nope")))
    assert m.vocabularies == {}
    assert m.anchor_for("document.orphan") == "document.orphan"


def test_anchor_for_unreferenced_field_is_itself():
    m = build_schema_map(document(entities={"type": "array", "items": entity_object("Person")}))
    assert m.anchor_for("document.entities[*]") == "document.entities[*]"


# ─── Lookup helpers ─────────────────────────────────────────────────────────


def test_get_is_explosion_insensitive():
    m = build_schema_map(document(events={
        "type": "array",
        "items": {"type": "object", "properties": {"when": {"type": "string"}}},
    }))
    assert m.get("document.events.when") is m.get("document.events[*].when")


def test_in_container_lists_row_fields():
    m = build_schema_map(document(observations={
        "type": "array",
        "items": {"type": "object", "properties": {
            "claim": {"type": "string"}, "timestamp": {"type": "string"},
        }},
    }))
    fields = {n.path for n in m.in_container("document.observations[*]")}
    assert fields == {
        "document.observations[*].claim",
        "document.observations[*].timestamp",
    }


def test_strip_explosions():
    assert strip_explosions("a.b[*].c[*].d") == "a.b.c.d"


def test_empty_and_malformed_contracts():
    assert build_schema_map(None).fields == ()
    assert build_schema_map({}).fields == ()
    assert build_schema_map({"type": "object"}).fields == ()


# ─── Reading values at map paths ─────────────────────────────────────────────


def test_iter_values_nested_convention():
    hits = iter_values({"document": {"topic": "climate"}}, "document.topic")
    assert [(h.path, h.value) for h in hits] == [("document.topic", "climate")]


def test_iter_values_document_unwrapped_convention():
    """``annotate.py`` stores ``result["document"]`` at the value root, so a
    ``document.x`` map path has to resolve against a value holding bare ``x``."""
    hits = iter_values({"topic": "climate"}, "document.topic")
    assert [h.value for h in hits] == ["climate"]
    # Path stays the declared one so fragment_paths remain comparable.
    assert hits[0].path == "document.topic"


def test_iter_values_flat_dotted_key_convention():
    hits = iter_values({"document.topic": "climate"}, "document.topic")
    assert [h.value for h in hits] == ["climate"]


def test_iter_values_flat_dotted_key_on_an_array():
    hits = iter_values({"document.entities": [{"name": "A"}, {"name": "B"}]},
                       "document.entities[*]")
    assert [h.path for h in hits] == ["document.entities[0]", "document.entities[1]"]


def test_iter_values_substitutes_real_indices():
    value = {"document": {"observations": [
        {"statement_by": {"name": "A"}},
        {"statement_by": {"name": "B"}},
    ]}}
    hits = iter_values(value, "document.observations[*].statement_by")
    assert [h.path for h in hits] == [
        "document.observations[0].statement_by",
        "document.observations[1].statement_by",
    ]


def test_iter_values_nested_explosions():
    value = {"document": {"rows": [{"actors": [{"name": "A"}, {"name": "B"}]}]}}
    hits = iter_values(value, "document.rows[*].actors[*]")
    assert [h.path for h in hits] == [
        "document.rows[0].actors[0]", "document.rows[0].actors[1]",
    ]


def test_iter_values_tolerates_single_object_where_array_declared():
    """A recurring model failure mode. SQL loses these silently; recovering
    them is unambiguous."""
    hits = iter_values({"document": {"entities": {"name": "A"}}}, "document.entities[*]")
    assert [h.value for h in hits] == [{"name": "A"}]


def test_iter_values_missing_path_is_empty():
    assert iter_values({"document": {}}, "document.nope") == []
    assert iter_values(None, "document.x") == []
    assert iter_values({"document": {"x": 1}}, "") == []


# ─── iter_entity_refs ───────────────────────────────────────────────────────


def test_iter_entity_refs_reads_name_and_type():
    value = {"document": {"entities": [
        {"name": "Angela Merkel", "type": "Politician"},
        {"name": "BMW", "type": "Company"},
    ]}}
    assert iter_entity_refs(value, "document.entities[*]") == [
        ("Angela Merkel", "Politician", "document.entities[0]"),
        ("BMW", "Company", "document.entities[1]"),
    ]


def test_iter_entity_refs_accepts_bare_strings():
    """The model emits ``["Merkel"]`` instead of ``[{"name": "Merkel"}]`` often
    enough that dropping those would lose real mentions."""
    value = {"document": {"entities": ["Merkel", "  Scholz  "]}}
    assert iter_entity_refs(value, "document.entities[*]") == [
        ("Merkel", "", "document.entities[0]"),
        ("Scholz", "", "document.entities[1]"),
    ]


def test_iter_entity_refs_skips_blank_and_missing_names():
    value = {"document": {"entities": [{"name": ""}, {"type": "Person"}, {"name": "A"}]}}
    assert iter_entity_refs(value, "document.entities[*]") == [
        ("A", "", "document.entities[2]"),
    ]


def test_iter_entity_refs_from_nested_row_leaf():
    value = {"document": {"observations": [
        {"statement_by": {"name": "A", "type": "Person"}, "claim": "x"},
        {"statement_by": {"name": "B", "type": "Person"}, "claim": "y"},
    ]}}
    assert iter_entity_refs(value, "document.observations[*].statement_by") == [
        ("A", "Person", "document.observations[0].statement_by"),
        ("B", "Person", "document.observations[1].statement_by"),
    ]


def test_iter_entity_refs_scalar_entity_field():
    value = {"document": {"location": {"name": "Berlin", "type": "Location"}}}
    assert iter_entity_refs(value, "document.location") == [
        ("Berlin", "Location", "document.location"),
    ]


def test_iter_entity_refs_unexpected_list_at_scalar_path():
    """Declared scalar, emitted as a list — index into it rather than drop it."""
    value = {"document": {"location": [{"name": "Berlin"}, {"name": "Bonn"}]}}
    assert iter_entity_refs(value, "document.location") == [
        ("Berlin", "", "document.location[0]"),
        ("Bonn", "", "document.location[1]"),
    ]
