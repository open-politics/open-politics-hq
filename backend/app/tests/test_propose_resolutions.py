"""Smoke tests for the propose_resolutions @task.

Confirms task registration and the route dispatch contract. End-to-end
embedding-similarity matching requires a configured embedding provider in
the test infospace, which isn't guaranteed in CI; these tests cover the
structural contract instead.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest

from app.api.modules.graph.schemas import ProposeResolutionsParams
from app.api.modules.graph.tasks.proposals import propose_resolutions
from app.core.config import settings

API = settings.API_V1_STR


def test_task_registered_with_correct_descriptor():
    """Task is in the registry with the right schedule/triggers/params."""
    desc = propose_resolutions._task_descriptor
    assert desc.name == "propose_resolutions"
    assert desc.params_model is ProposeResolutionsParams
    assert desc.triggers == []           # No automatic invocation
    assert desc.schedule is None         # Not periodically polled
    assert "graph" in desc.tags
    assert "resolution" in desc.tags


def test_delay_requires_correct_params_type():
    """fn.delay() rejects mismatched params shapes."""
    with pytest.raises(TypeError, match="expects params of type ProposeResolutionsParams"):
        propose_resolutions.delay([None], 1, params=object())


def test_delay_serializes_params(monkeypatch):
    """fn.delay() routes through Celery's apply_async with serialized params."""
    captured = {}

    def _fake(args=None, **kw):
        captured["args"] = args
        return MagicMock(id="task-id-1")

    propose_resolutions._celery_task.apply_async = _fake

    params = ProposeResolutionsParams(
        target="entities",
        canon_id=42,
        threshold=0.9,
    )
    result = propose_resolutions.delay([None], 7, params=params)
    assert result.id == "task-id-1"
    assert captured["args"][0] == [None]
    assert captured["args"][1] == 7
    serialized = captured["args"][2]
    assert serialized["target"] == "entities"
    assert serialized["canon_id"] == 42
    assert serialized["threshold"] == 0.9


# ─── End-to-end route dispatch ────────────────────────────────────────────────


@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    return infospace_factory(f"Proposals {uuid.uuid4().hex[:6]}", user_id)


def test_route_dispatches_and_returns_watch_url(client, headers, workspace):
    """POST returns a watch_url pointing to the /stream endpoint."""
    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Empty-{uuid.uuid4().hex[:4]}"},
    ).json()["id"]

    r = client.post(
        f"{API}/infospaces/{workspace}/canons/action/propose-resolutions",
        headers=headers,
        json={"target": "entities", "canon_id": canon_id, "threshold": 0.85},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["topic"] == "resolution.proposals"
    assert "watch_url" in body
    assert str(workspace) in body["watch_url"]
    assert body["task_id"]
