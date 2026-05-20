"""End-to-end functional tests for graph-scoped relationship routes.

Covers:
- ``GET /infospaces/{iid}/graphs/{gid}/relationships`` — derived list (no
  rows materialized → empty result)
- ``PATCH /infospaces/{iid}/graphs/{gid}/relationships/{a}/{b}`` — lazy
  materialization; canonical ordering enforced (PATCH ``(b, a)`` →
  row stored as ``(min, max)``)
- ``GET /infospaces/{iid}/graphs/{gid}/relationships/{a}/{b}`` — single
  view with overlay
- ``POST .../action/delete`` — overlay-only deletion
- Cross-canon entity refusal (entities must belong to graph's canon)

Requires: Postgres (via docker compose).
"""
from __future__ import annotations

import uuid

import pytest

from app.core.config import settings

API = settings.API_V1_STR


# ─── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    return infospace_factory(f"Rel Routes {uuid.uuid4().hex[:6]}", user_id)


@pytest.fixture(scope="module")
def canon_id(client, headers, workspace):
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Canon {uuid.uuid4().hex[:6]}"},
    )
    return r.json()["id"]


@pytest.fixture(scope="module")
def graph_id(client, headers, workspace, canon_id):
    r = client.post(
        f"{API}/infospaces/{workspace}/knowledge-graphs",
        headers=headers,
        json={"name": f"Graph {uuid.uuid4().hex[:6]}", "canon_id": canon_id},
    )
    return r.json()["id"]


@pytest.fixture(scope="module")
def two_entities(client, headers, workspace, canon_id):
    """Two entities in the same canon — pair for relationship tests."""
    a = client.post(
        f"{API}/infospaces/{workspace}/entities",
        headers=headers,
        json={
            "canonical_name": f"Trump-{uuid.uuid4().hex[:4]}",
            "entity_type": "Person",
            "canon_id": canon_id,
        },
    )
    assert a.status_code == 201, a.text
    b = client.post(
        f"{API}/infospaces/{workspace}/entities",
        headers=headers,
        json={
            "canonical_name": f"Biden-{uuid.uuid4().hex[:4]}",
            "entity_type": "Person",
            "canon_id": canon_id,
        },
    )
    assert b.status_code == 201, b.text
    return a.json()["id"], b.json()["id"]


# ─── Derived list when nothing materialized ──────────────────────────────────


def test_list_empty_when_no_edges(client, headers, workspace, graph_id):
    """A graph with no curated edges has no relationships."""
    r = client.get(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json() == []


# ─── Lazy materialization on PATCH ───────────────────────────────────────────


def test_patch_lazy_materializes(client, headers, workspace, graph_id, two_entities):
    """PATCH on a non-existent overlay creates the row with the patch applied."""
    a, b = two_entities

    r = client.patch(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{a}/{b}",
        headers=headers,
        json={"is_pinned": True, "notes": "Important", "tags": ["political_rivalry"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_pinned"] is True
    assert body["notes"] == "Important"
    assert "political_rivalry" in body["tags"]
    assert body["entity_a_id"] == min(a, b)
    assert body["entity_b_id"] == max(a, b)


def test_patch_canonical_ordering_normalized(client, headers, workspace, graph_id, two_entities):
    """PATCH ``(b, a)`` (reversed) → row stored under canonical ``(min, max)``."""
    a, b = two_entities
    # Hit reversed order; backend normalizes via _normalize_pair.
    r = client.patch(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{b}/{a}",
        headers=headers,
        json={"label": "rivalry"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Stored canonically — entity_a_id < entity_b_id always
    assert body["entity_a_id"] == min(a, b)
    assert body["entity_b_id"] == max(a, b)
    assert body["label"] == "rivalry"


def test_self_relationship_rejected(client, headers, workspace, graph_id, two_entities):
    """``a == b`` is invalid — relationships need two distinct entities."""
    a, _ = two_entities
    r = client.patch(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{a}/{a}",
        headers=headers,
        json={"is_pinned": True},
    )
    assert r.status_code == 400


# ─── GET single ──────────────────────────────────────────────────────────────


def test_get_relationship_with_overlay(client, headers, workspace, graph_id, two_entities):
    """After materialization, GET returns derived counts + overlay fields."""
    a, b = two_entities
    # Ensure overlay exists
    client.patch(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{a}/{b}",
        headers=headers,
        json={"label": "test"},
    )
    r = client.get(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{a}/{b}",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["entity_a_id"] == min(a, b)
    assert body["entity_b_id"] == max(a, b)
    assert body["edge_count"] == 0  # no GraphEdges yet
    assert body["label"] == "test"


def test_get_404_when_no_overlay_and_no_edges(client, headers, workspace, graph_id, canon_id):
    """A pair with no edges and no overlay is 404."""
    # Two fresh entities, no PATCH, no edges between them.
    a = client.post(
        f"{API}/infospaces/{workspace}/entities",
        headers=headers,
        json={
            "canonical_name": f"Loner-A-{uuid.uuid4().hex[:4]}",
            "entity_type": "Person",
            "canon_id": canon_id,
        },
    ).json()["id"]
    b = client.post(
        f"{API}/infospaces/{workspace}/entities",
        headers=headers,
        json={
            "canonical_name": f"Loner-B-{uuid.uuid4().hex[:4]}",
            "entity_type": "Person",
            "canon_id": canon_id,
        },
    ).json()["id"]

    r = client.get(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{a}/{b}",
        headers=headers,
    )
    assert r.status_code == 404


# ─── Cross-canon refusal ─────────────────────────────────────────────────────


def test_cross_canon_pair_refused(client, headers, workspace, graph_id, two_entities):
    """An entity from a different canon than the graph's canon → 409."""
    a, _ = two_entities

    # Create a second canon and an entity in it
    other_canon = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Other {uuid.uuid4().hex[:4]}"},
    ).json()["id"]
    other_entity = client.post(
        f"{API}/infospaces/{workspace}/entities",
        headers=headers,
        json={
            "canonical_name": f"Other-{uuid.uuid4().hex[:4]}",
            "entity_type": "Person",
            "canon_id": other_canon,
        },
    ).json()["id"]

    # PATCH the graph's relationship with one entity from the wrong canon → 409
    r = client.patch(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{a}/{other_entity}",
        headers=headers,
        json={"label": "should-fail"},
    )
    assert r.status_code == 409, r.text


# ─── Delete overlay ──────────────────────────────────────────────────────────


def test_delete_overlay_only(client, headers, workspace, graph_id, canon_id):
    """DELETE removes only the overlay; the relationship vanishes from list
    (no edges, no overlay = nothing to show).
    """
    # Fresh pair so we don't fight other tests' state.
    a = client.post(
        f"{API}/infospaces/{workspace}/entities",
        headers=headers,
        json={
            "canonical_name": f"Del-A-{uuid.uuid4().hex[:4]}",
            "entity_type": "Person",
            "canon_id": canon_id,
        },
    ).json()["id"]
    b = client.post(
        f"{API}/infospaces/{workspace}/entities",
        headers=headers,
        json={
            "canonical_name": f"Del-B-{uuid.uuid4().hex[:4]}",
            "entity_type": "Person",
            "canon_id": canon_id,
        },
    ).json()["id"]

    # Materialize via PATCH
    client.patch(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{a}/{b}",
        headers=headers,
        json={"is_pinned": True},
    )

    # Confirm exists
    r = client.get(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{a}/{b}",
        headers=headers,
    )
    assert r.status_code == 200

    # Delete overlay
    r = client.post(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{a}/{b}/action/delete",
        headers=headers,
        json={"confirm": True},
    )
    assert r.status_code == 200
    assert r.json()["confirmed"] is True

    # GET now 404 (no overlay, no edges)
    r = client.get(
        f"{API}/infospaces/{workspace}/graphs/{graph_id}/relationships/{a}/{b}",
        headers=headers,
    )
    assert r.status_code == 404
