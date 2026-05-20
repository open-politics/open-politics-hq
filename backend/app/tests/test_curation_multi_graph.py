"""Tests for the multi-graph-field curation helpers.

Phase 2 of the schema-native-entities rework: curation now walks the
schema's output_contract to find every graph-shaped subschema, and tags
each emitted GraphEdge with ``source_field_path``. Legacy schemas with a
single ``"triplets"`` key still curate cleanly via the fallback path.

These are unit tests that exercise the helpers directly on synthetic
output_contracts and annotation values — no DB, no fixtures.
"""
from __future__ import annotations

from app.api.modules.graph.tasks.curation import (
    _extract_triplets,
    _extract_triplets_at_path,
    _find_graph_field_paths,
    _has_graph_structure,
    _is_triplet_subschema,
    _walk_value_path,
)


# ─── _is_triplet_subschema ──────────────────────────────────────────────────


def test_triplet_subschema_recognized_at_any_property_name():
    """The recognizer keys off shape, not the property name. A schema with
    `subject_name`/`predicate`/`object_name` items is triplet-shaped whether
    it's called ``triplets`` or ``loose_relationships`` or anything else."""
    schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "subject_name": {"type": "string"},
                "predicate": {"type": "string"},
                "object_name": {"type": "string"},
            },
        },
    }
    assert _is_triplet_subschema(schema) is True


def test_non_triplet_array_rejected():
    """An array of strings or arbitrary objects is NOT triplet-shaped."""
    assert _is_triplet_subschema({"type": "array", "items": {"type": "string"}}) is False
    assert _is_triplet_subschema({
        "type": "array",
        "items": {"type": "object", "properties": {"name": {"type": "string"}}},
    }) is False


def test_object_root_not_triplet():
    """A non-array root, even with subject/predicate/object children, is not
    a triplet-shape (triplets are arrays)."""
    assert _is_triplet_subschema({
        "type": "object",
        "properties": {"subject_name": {}, "predicate": {}, "object_name": {}},
    }) is False


# ─── _find_graph_field_paths ────────────────────────────────────────────────


def _triplet_field():
    return {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "subject_name": {"type": "string"},
                "predicate": {"type": "string"},
                "object_name": {"type": "string"},
            },
        },
    }


def test_finds_legacy_triplets_path():
    contract = {
        "type": "object",
        "properties": {
            "document": {
                "type": "object",
                "properties": {"triplets": _triplet_field()},
            },
        },
    }
    assert _find_graph_field_paths(contract) == ["document.triplets"]


def test_finds_multiple_graph_fields_with_user_facing_names():
    contract = {
        "type": "object",
        "properties": {
            "document": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "loose_relationships": _triplet_field(),
                    "actors": {"type": "array", "items": {"type": "string"}},
                    "licensing_assessments": _triplet_field(),
                },
            },
        },
    }
    paths = _find_graph_field_paths(contract)
    assert sorted(paths) == [
        "document.licensing_assessments",
        "document.loose_relationships",
    ]


def test_no_graph_fields_returns_empty():
    contract = {
        "type": "object",
        "properties": {
            "document": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    }
    assert _find_graph_field_paths(contract) == []


def test_handles_missing_or_malformed_contract():
    """Defensive: walking a contract that's None or shaped weirdly returns []
    rather than throwing — keeps curation robust against schema edge cases."""
    assert _find_graph_field_paths(None) == []
    assert _find_graph_field_paths({}) == []
    assert _find_graph_field_paths({"properties": {}}) == []
    assert _find_graph_field_paths({"properties": {"document": {}}}) == []


# ─── _walk_value_path / _extract_triplets_at_path ───────────────────────────


def test_walk_value_path_navigates_dotted_path():
    value = {"document": {"loose_relationships": [{"subject_name": "A"}]}}
    found = _walk_value_path(value, "document.loose_relationships")
    assert found == [{"subject_name": "A"}]


def test_walk_value_path_returns_none_on_missing_segment():
    value = {"document": {"actors": []}}
    assert _walk_value_path(value, "document.loose_relationships") is None
    assert _walk_value_path(value, "missing") is None
    assert _walk_value_path(value, "document.actors.deeper") is None


def test_extract_triplets_at_path_filters_to_dicts():
    value = {
        "document": {
            "loose_relationships": [
                {"subject_name": "A", "predicate": "p", "object_name": "B"},
                "garbage non-dict entry",
                {"subject_name": "C", "predicate": "q", "object_name": "D"},
            ],
        },
    }
    triplets = _extract_triplets_at_path(value, "document.loose_relationships")
    assert len(triplets) == 2
    assert triplets[0]["subject_name"] == "A"
    assert triplets[1]["subject_name"] == "C"


def test_extract_triplets_at_path_returns_empty_when_field_absent():
    value = {"document": {"actors": ["X"]}}
    assert _extract_triplets_at_path(value, "document.loose_relationships") == []


# ─── _has_graph_structure (recognizer fallback) ─────────────────────────────


def test_has_graph_structure_recognizes_legacy_triplets():
    assert _has_graph_structure({"document": {"triplets": []}}) is True


def test_has_graph_structure_recognizes_multi_graph_field_value():
    """Even without a schema, a value with at least one triplet-shaped array
    under document is recognized as having graph structure (so curation
    doesn't skip it on the legacy `_has_graph_structure` fast-path)."""
    value = {
        "document": {
            "summary": "irrelevant",
            "licensing_assessments": [
                {"subject_name": "A", "predicate": "gave_license_to", "object_name": "B"},
            ],
        },
    }
    assert _has_graph_structure(value) is True


def test_has_graph_structure_false_for_unrelated_arrays():
    value = {"document": {"tags": ["a", "b"], "scores": [1, 2]}}
    assert _has_graph_structure(value) is False


# ─── _extract_triplets (legacy fallback) ────────────────────────────────────


def test_legacy_extract_triplets_handles_document_wrapping():
    value = {"document": {"triplets": [{"subject_name": "A"}, {"subject_name": "B"}]}}
    triplets = _extract_triplets(value)
    assert len(triplets) == 2


def test_legacy_extract_triplets_handles_unwrapped():
    value = {"triplets": [{"subject_name": "A"}]}
    triplets = _extract_triplets(value)
    assert len(triplets) == 1
