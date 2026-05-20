"""Tests for the geocoding action — first v2 @task(params_model=...) instance."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.api.modules.annotation.schemas import GeocodeActionRequest, GeocodeParams
from app.api.modules.annotation.tasks.geocode import (
    _extract_location_strings,
    geocode,
)


class _FakeAnnotation:
    def __init__(self, value):
        self.value = value


def test_extract_simple_path():
    a = _FakeAnnotation({"location": {"name": "Berlin"}})
    assert _extract_location_strings(a, "location.name") == ["Berlin"]


def test_extract_explode_path():
    a = _FakeAnnotation({"annotations": [
        {"location": "Berlin"},
        {"location": "Paris"},
        {"location": "  "},
    ]})
    assert _extract_location_strings(a, "annotations[*].location") == ["Berlin", "Paris"]


def test_extract_missing_path_returns_empty():
    a = _FakeAnnotation({"other": "nope"})
    assert _extract_location_strings(a, "location.name") == []


def test_geocode_task_registered():
    """Task is wired into the registry, direct-invocation-only."""
    desc = geocode._task_descriptor
    assert desc.name == "geocode"
    assert desc.params_model is GeocodeParams
    assert desc.triggers == []
    assert desc.schedule is None
    assert desc.capability == "geocoding"
    assert desc.queue == "external_api"
    assert "geocoding" in desc.tags


def test_geocode_delay_requires_params_of_correct_type():
    with pytest.raises(TypeError, match="expects params of type GeocodeParams"):
        geocode.delay([1], 1, params=object())


def test_geocode_delay_sends_dict_args():
    """fn.delay(ids, iid, params=GeocodeParams(...)) serializes params into args."""
    captured = {}
    def _fake(args=None, **kw):
        captured["args"] = args
        return MagicMock(id="t-123")
    geocode._celery_task.apply_async = _fake

    params = GeocodeParams(run_id=5, field_path="annotations[*].location", annotation_ids=[10])
    result = geocode.delay([10], 7, params=params)
    assert result.id == "t-123"
    assert captured["args"][0] == [10]
    assert captured["args"][1] == 7
    assert captured["args"][2]["run_id"] == 5
    assert captured["args"][2]["field_path"] == "annotations[*].location"


def test_action_request_schema_accepts_minimal():
    body = GeocodeActionRequest(field_path="location.name")
    assert body.field_path == "location.name"
    assert body.annotation_ids is None
