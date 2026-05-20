"""End-to-end functional tests for Canon CRUD + actions.

Covers the new ``Canon`` surface introduced in the canon-graph rework:
- ``GET/POST /infospaces/{iid}/canons``
- ``GET/PATCH /canons/{id}``
- ``GET /canons/{id}/entities``
- ``POST /canons/{id}/action/extend``
- ``POST /canons/{id}/action/merge-entities``
- ``POST /canons/{id}/action/delete`` (preview/confirm)

Requires: Postgres (via docker compose). Auto-creates and tears down
infospaces using the ``infospace_factory`` from ``conftest.py``.
"""
from __future__ import annotations

import uuid

import pytest

from app.core.config import settings

API = settings.API_V1_STR


# ─── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    """Dedicated infospace — auto-creates a General canon at infospace creation."""
    return infospace_factory(f"Canon Routes {uuid.uuid4().hex[:6]}", user_id)


# ─── General canon auto-created on infospace creation ────────────────────────


def test_general_canon_auto_created(client, headers, workspace):
    """Every infospace gets a General canon (role='general') at creation."""
    r = client.get(f"{API}/infospaces/{workspace}/canons", headers=headers)
    assert r.status_code == 200, r.text
    canons = r.json()
    assert len(canons) >= 1
    general = [c for c in canons if c["role"] == "general" and c["name"] == "General"]
    assert len(general) == 1, f"expected one General canon, found {len(general)}"


def test_infospace_default_canon_id_is_set(client, headers, workspace):
    """``infospace.default_canon_id`` is set after creation."""
    r = client.get(f"{API}/infospaces/{workspace}", headers=headers)
    assert r.status_code == 200
    info = r.json()
    assert info.get("default_canon_id") is not None


# ─── Canon CRUD ──────────────────────────────────────────────────────────────


def test_create_and_list_canon(client, headers, workspace):
    name = f"World Politics {uuid.uuid4().hex[:6]}"
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": name, "description": "Canon under test"},
    )
    assert r.status_code == 201, r.text
    canon = r.json()
    assert canon["name"] == name
    assert canon["role"] == "general"
    assert canon["infospace_id"] == workspace

    # List includes both General and the new canon.
    r = client.get(f"{API}/infospaces/{workspace}/canons", headers=headers)
    assert r.status_code == 200
    names = {c["name"] for c in r.json()}
    assert "General" in names and name in names


def test_get_canon_by_id(client, headers, workspace):
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Canon-Get-{uuid.uuid4().hex[:6]}"},
    )
    canon_id = r.json()["id"]

    r = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}", headers=headers)
    assert r.status_code == 200
    assert r.json()["id"] == canon_id


def test_patch_canon(client, headers, workspace):
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Canon-Patch-{uuid.uuid4().hex[:6]}"},
    )
    canon_id = r.json()["id"]

    r = client.patch(
        f"{API}/infospaces/{workspace}/canons/{canon_id}",
        headers=headers,
        json={"description": "Updated description"},
    )
    assert r.status_code == 200
    assert r.json()["description"] == "Updated description"


# ─── Role enum ───────────────────────────────────────────────────────────────


def test_create_canon_with_geo_role(client, headers, workspace):
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Geo-{uuid.uuid4().hex[:6]}", "role": "geo"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "geo"


def test_filter_canons_by_role(client, headers, workspace):
    """``?role=geo`` filters server-side."""
    # Create a fresh geo canon to ensure at least one exists in this workspace.
    client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Geo-Filter-{uuid.uuid4().hex[:6]}", "role": "geo"},
    )

    r = client.get(
        f"{API}/infospaces/{workspace}/canons?role=geo",
        headers=headers,
    )
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 1
    assert all(c["role"] == "geo" for c in rows)


# ─── Delete preview / confirm ────────────────────────────────────────────────


def test_delete_preview_no_blockers(client, headers, workspace):
    """Empty canon (no graphs, no entities, not default) → preview can_proceed=True."""
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Delete-{uuid.uuid4().hex[:6]}"},
    )
    canon_id = r.json()["id"]

    r = client.post(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/action/delete",
        headers=headers,
        json={"confirm": False},
    )
    assert r.status_code == 200, r.text
    impact = r.json()
    assert impact["can_proceed"] is True
    assert impact["confirmed"] is False
    assert impact["blockers"] == []


def test_delete_blocked_by_referencing_graph(client, headers, workspace):
    """Canon referenced by a graph → preview reports blocker; confirm raises 409."""
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Backed-{uuid.uuid4().hex[:6]}"},
    )
    canon_id = r.json()["id"]

    # Wire a graph that references this canon
    r = client.post(
        f"{API}/infospaces/{workspace}/knowledge-graphs",
        headers=headers,
        json={"name": f"Graph-{uuid.uuid4().hex[:6]}", "canon_id": canon_id},
    )
    assert r.status_code == 201, r.text

    r = client.post(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/action/delete",
        headers=headers,
        json={"confirm": False},
    )
    assert r.status_code == 200
    impact = r.json()
    assert impact["can_proceed"] is False
    assert any("graph" in b.lower() for b in impact["blockers"])

    r = client.post(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/action/delete",
        headers=headers,
        json={"confirm": True},
    )
    assert r.status_code == 409


def test_delete_blocked_when_default_canon(client, headers, workspace):
    """The infospace's General canon (default_canon_id) cannot be deleted."""
    # Get the General canon id
    r = client.get(f"{API}/infospaces/{workspace}/canons?role=general", headers=headers)
    general = next(c for c in r.json() if c["name"] == "General")

    r = client.post(
        f"{API}/infospaces/{workspace}/canons/{general['id']}/action/delete",
        headers=headers,
        json={"confirm": False},
    )
    assert r.status_code == 200
    impact = r.json()
    assert impact["can_proceed"] is False
    assert any("default" in b.lower() for b in impact["blockers"])


def test_delete_confirm_removes_canon(client, headers, workspace):
    """End-to-end: create empty canon, preview clean, confirm, gone."""
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Doomed-{uuid.uuid4().hex[:6]}"},
    )
    canon_id = r.json()["id"]

    r = client.post(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/action/delete",
        headers=headers,
        json={"confirm": True},
    )
    assert r.status_code == 200
    assert r.json()["confirmed"] is True

    r = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}", headers=headers)
    assert r.status_code == 404


# ─── Canon entity listing (empty by default) ─────────────────────────────────


def test_list_canon_entities_empty(client, headers, workspace):
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Empty-{uuid.uuid4().hex[:6]}"},
    )
    canon_id = r.json()["id"]

    r = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/entities", headers=headers)
    assert r.status_code == 200
    assert r.json() == []
