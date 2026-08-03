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
    _walk_value_path,
)

# Triplet-*shape* recognition moved to ``schema_map.infer_shape`` (one detector,
# shared with the frontend's copy) — see ``test_schema_map.py``. What stays here
# is the curation-specific half: which paths this module hands to
# ``_walk_value_path``, and how values are pulled out of them.


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


# ``_has_graph_structure`` is gone. It was a value-shape pre-gate that skipped
# any annotation without a triplet array — which silently excluded every
# entity-only annotation once entity fields became curatable. The flow now
# skips on "neither triplets nor entity mentions were found", which is the
# actual condition; see ``test_curation_entity_fields.py``.


# ─── _extract_triplets (legacy fallback) ────────────────────────────────────


def test_legacy_extract_triplets_handles_document_wrapping():
    value = {"document": {"triplets": [{"subject_name": "A"}, {"subject_name": "B"}]}}
    triplets = _extract_triplets(value)
    assert len(triplets) == 2


def test_legacy_extract_triplets_handles_unwrapped():
    value = {"triplets": [{"subject_name": "A"}]}
    triplets = _extract_triplets(value)
    assert len(triplets) == 1
