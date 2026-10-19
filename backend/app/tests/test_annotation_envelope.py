"""The ``document`` envelope survives two-phase extraction.

A stored contract rarely lists ``required``, which compiled the envelope as
nullable: a grammar-constrained model could answer Phase A with
``{"document": null}``, and the merge then filed every Phase B list beside the
null envelope, where demultiplex dropped the whole extraction.
"""
from __future__ import annotations

import pydantic
import pytest

from app.api.modules.annotation.tasks.annotate import _merge_phase_a_b
from app.core.task_utils import create_pydantic_model_from_json_schema, split_schema_for_extraction

ENTITY = {"type": "object", "properties": {"name": {"type": "string"}}}

# Schema 11's shape: no ``required`` anywhere, scalars beside array<object> lists.
HIERARCHICAL = {
    "type": "object",
    "properties": {
        "document": {
            "type": "object",
            "properties": {
                "dated": {"type": "string"},
                "at": ENTITY,
                "actors": {"type": "array", "items": ENTITY},
                "places": {"type": "array", "items": ENTITY},
            },
        },
    },
}

FLAT = {
    "type": "object",
    "properties": {
        "dated": {"type": "string"},
        "actors": {"type": "array", "items": ENTITY},
    },
}


def _phase_a_model(contract):
    scalar, _ = split_schema_for_extraction(contract)
    return create_pydantic_model_from_json_schema("PhaseA", scalar, justifications_enabled=False)


@pytest.mark.parametrize("model", [
    lambda: create_pydantic_model_from_json_schema("Full", HIERARCHICAL, justifications_enabled=False),
    lambda: _phase_a_model(HIERARCHICAL),
])
def test_envelope_is_never_null(model):
    m = model()
    schema = m.model_json_schema()
    assert "document" in schema["required"]
    assert "anyOf" not in schema["properties"]["document"]
    with pytest.raises(pydantic.ValidationError):
        m.model_validate({"document": None})
    with pytest.raises(pydantic.ValidationError):
        m.model_validate({})


def test_nested_objects_stay_optional():
    m = _phase_a_model(HIERARCHICAL)
    doc = m.model_validate({"document": {"dated": None, "at": None}})
    assert doc.document.at is None


@pytest.mark.parametrize("phase_a", [None, {}, {"document": None}])
def test_merge_keeps_lists_without_a_phase_a_envelope(phase_a):
    _, lists = split_schema_for_extraction(HIERARCHICAL)
    merged = _merge_phase_a_b(phase_a, {"actors": [{"name": "A"}], "places": []}, lists)
    assert merged == {"document": {"actors": [{"name": "A"}], "places": []}}


def test_merge_files_lists_inside_the_envelope():
    _, lists = split_schema_for_extraction(HIERARCHICAL)
    phase_a = {"document": {"dated": "2019-07-06", "at": {"name": "New York"}}}
    merged = _merge_phase_a_b(phase_a, {"actors": [{"name": "A"}]}, lists)
    assert merged == {"document": {"dated": "2019-07-06", "at": {"name": "New York"}, "actors": [{"name": "A"}]}}
    assert phase_a == {"document": {"dated": "2019-07-06", "at": {"name": "New York"}}}


def test_merge_flat_schema():
    _, lists = split_schema_for_extraction(FLAT)
    merged = _merge_phase_a_b({"dated": "2019-07-06"}, {"actors": [{"name": "A"}]}, lists)
    assert merged == {"dated": "2019-07-06", "actors": [{"name": "A"}]}
