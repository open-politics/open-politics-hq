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
    """Every infospace gets a General canon at creation."""
    r = client.get(f"{API}/infospaces/{workspace}/canons", headers=headers)
    assert r.status_code == 200, r.text
    canons = r.json()
    assert len(canons) >= 1
    general = [c for c in canons if c["name"] == "General"]
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
    assert canon["tags"] == []
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


# ─── Portable fields: external_id + tags ─────────────────────────────────────


def test_create_canon_with_external_id_and_tags(client, headers, workspace):
    """``external_id`` (deterministic import key) and ``tags`` round-trip.

    Replaces the dropped ``role`` enum — geo is no longer a role, it's entries
    carrying geo properties; canons organize via tags and anchor via external_id.
    """
    ext = f"naturalearth:admin0:{uuid.uuid4().hex[:6]}"
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={
            "name": f"Geo-{uuid.uuid4().hex[:6]}",
            "external_id": ext,
            "tags": ["geo", "reference"],
        },
    )
    assert r.status_code == 201, r.text
    canon = r.json()
    assert canon["external_id"] == ext
    assert set(canon["tags"]) == {"geo", "reference"}


# ─── Per-type property schemas (type_schemas) ────────────────────────────────


def test_canon_type_schemas_create_read_patch(client, headers, workspace):
    """``type_schemas`` (per-type property-shape declarations) round-trips through
    create, read, and patch. Guidance only — never enforced on entries."""
    r = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={
            "name": f"Actors-{uuid.uuid4().hex[:6]}",
            "type_schemas": {
                "person": [
                    {"name": "birth_date", "type": "date"},
                    {"name": "nationality", "type": "text", "required": True},
                ],
                "organization": [{"name": "founded", "type": "integer"}],
            },
        },
    )
    assert r.status_code == 201, r.text
    canon_id = r.json()["id"]
    ts = r.json()["type_schemas"]
    assert set(ts) == {"person", "organization"}
    assert ts["person"][0] == {
        "name": "birth_date", "type": "date", "description": None, "required": False,
    }
    assert ts["person"][1]["required"] is True

    # Patch replaces the map wholesale.
    r = client.patch(
        f"{API}/infospaces/{workspace}/canons/{canon_id}",
        headers=headers,
        json={"type_schemas": {"person": [{"name": "role", "type": "text"}]}},
    )
    assert r.status_code == 200, r.text
    ts = r.json()["type_schemas"]
    assert set(ts) == {"person"}
    assert ts["person"][0]["name"] == "role"

    # A fresh canon defaults to an empty map (column default).
    bare = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers, json={"name": f"Bare-{uuid.uuid4().hex[:6]}"},
    ).json()
    assert bare["type_schemas"] == {}


def test_canon_type_schemas_export_import_overlay(client, headers, workspace):
    """type_schemas travels in the portable export and overlays per-type on import."""
    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={
            "name": f"Src-{uuid.uuid4().hex[:6]}",
            "external_id": f"test:ts:{uuid.uuid4().hex[:8]}",
            "type_schemas": {"person": [{"name": "birth_date", "type": "date"}]},
        },
    ).json()["id"]

    payload = client.get(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/export", headers=headers
    ).json()
    assert payload["canon"]["type_schemas"]["person"][0]["name"] == "birth_date"

    # Import a payload that adds a new type + overrides person — imported keys win.
    payload["canon"]["type_schemas"] = {
        "person": [{"name": "full_name", "type": "text", "description": None, "required": False}],
        "place": [{"name": "population", "type": "integer", "description": None, "required": False}],
    }
    r = client.post(
        f"{API}/infospaces/{workspace}/canons/import?into_canon_id={canon_id}",
        headers=headers, json=payload,
    )
    assert r.status_code == 200, r.text
    ts = r.json()["type_schemas"]
    assert set(ts) == {"person", "place"}
    assert ts["person"][0]["name"] == "full_name"  # imported overrode local
    assert ts["place"][0]["name"] == "population"


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
    r = client.get(f"{API}/infospaces/{workspace}/canons", headers=headers)
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


# ─── Portability: serialize / materialize / import ───────────────────────────


def _seed_canon_with_entries(client, headers, workspace):
    """Create a canon + two portable entries (with external_id / tags / parents /
    properties, incl. a heavy geometry value). Returns (canon_id, external_id)."""
    cext = f"test:src:{uuid.uuid4().hex[:8]}"
    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Src-{uuid.uuid4().hex[:6]}", "external_id": cext, "tags": ["geo"]},
    ).json()["id"]
    client.post(
        f"{API}/infospaces/{workspace}/entities",
        headers=headers,
        json={
            "canonical": "Germany", "type": "country", "canon_id": canon_id,
            "external_id": "wikidata:Q183", "aliases": ["Deutschland", "DE"],
            "tags": ["nato"], "parents": ["wikidata:Q458"],
            "properties": {"lat": 51.16, "lon": 10.45, "geometry": {"type": "Point"}},
        },
    )
    client.post(
        f"{API}/infospaces/{workspace}/entities",
        headers=headers,
        json={
            "canonical": "France", "type": "country", "canon_id": canon_id,
            "external_id": "wikidata:Q142", "aliases": ["FR"],
        },
    )
    return canon_id, cext


def test_canon_export_excludes_local_fields(client, headers, workspace):
    """Export carries portable fields only — no id / infospace_id / embeddings."""
    canon_id, cext = _seed_canon_with_entries(client, headers, workspace)
    r = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/export", headers=headers)
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["format"] == "canon/v1"
    assert payload["canon"]["external_id"] == cext
    assert len(payload["entries"]) == 2
    de = next(e for e in payload["entries"] if e["external_id"] == "wikidata:Q183")
    assert de["canonical"] == "Germany"
    assert set(de["aliases"]) == {"Deutschland", "DE"}
    assert de["parents"] == ["wikidata:Q458"]
    assert de["properties"]["geometry"] == {"type": "Point"}
    # Local-only fields must NOT travel.
    for local in ("id", "infospace_id", "embedding_384", "embedding_768", "provenance_type"):
        assert local not in de, f"{local} leaked into wire format"


def test_canon_import_dedups_by_external_id(client, headers, workspace):
    """Re-importing the same file is idempotent — entries match by external_id."""
    canon_id, _ = _seed_canon_with_entries(client, headers, workspace)
    payload = client.get(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/export", headers=headers
    ).json()
    # Import back into the same canon explicitly.
    r = client.post(
        f"{API}/infospaces/{workspace}/canons/import?into_canon_id={canon_id}",
        headers=headers, json=payload,
    )
    assert r.status_code == 200, r.text
    entries = client.get(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/entities", headers=headers
    ).json()
    assert len(entries) == 2, "re-import must not duplicate entries"


def test_canon_import_creates_new_canon_roundtrip(client, headers, workspace):
    """Import with a fresh canon external_id creates a new canon; entries round-trip."""
    canon_id, _ = _seed_canon_with_entries(client, headers, workspace)
    payload = client.get(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/export", headers=headers
    ).json()
    payload["canon"]["external_id"] = f"test:dst:{uuid.uuid4().hex[:8]}"
    payload["canon"]["name"] = f"Dst-{uuid.uuid4().hex[:6]}"
    r = client.post(
        f"{API}/infospaces/{workspace}/canons/import", headers=headers, json=payload
    )
    assert r.status_code == 200, r.text
    new_id = r.json()["id"]
    assert new_id != canon_id
    entries = client.get(
        f"{API}/infospaces/{workspace}/canons/{new_id}/entities", headers=headers
    ).json()
    assert {e["external_id"] for e in entries} == {"wikidata:Q183", "wikidata:Q142"}
    de = next(e for e in entries if e["external_id"] == "wikidata:Q183")
    assert de["canonical"] == "Germany"
    assert de["parents"] == ["wikidata:Q458"]
    assert de["properties"]["geometry"] == {"type": "Point"}


# ─── combine_entries: property-merge + provenance on the canon merge path ─────


def test_merge_entries_merges_properties(client, headers, workspace):
    """Canon merge now unions properties (the upgraded combine_entries path)."""
    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers, json={"name": f"Merge-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    a = client.post(
        f"{API}/infospaces/{workspace}/entities", headers=headers,
        json={"canonical": "Acme", "type": "org", "canon_id": canon_id,
              "properties": {"founded": 1990}},
    ).json()["id"]
    b = client.post(
        f"{API}/infospaces/{workspace}/entities", headers=headers,
        json={"canonical": "Acme Corp", "type": "org", "canon_id": canon_id,
              "properties": {"ticker": "ACM"}},
    ).json()["id"]
    r = client.post(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/action/merge-entities",
        headers=headers, json={"entry_ids": [a, b], "keep_id": a},
    )
    assert r.status_code == 200, r.text
    keep = r.json()
    assert keep["properties"].get("founded") == 1990
    assert keep["properties"].get("ticker") == "ACM"
    assert keep["provenance_type"] == "manual"
    assert "Acme Corp" in keep["aliases"]


# ─── resolve-into-canon: staged proposals (accept / merge / dismiss) ─────────


def _make_proposal(workspace, canon_id, surface, etype="org"):
    """Insert a pending CanonProposal directly (as settled-only curation would)."""
    from app.api.dependency_injection import get_db
    from app.models import CanonProposal
    gen = get_db(); db = next(gen)
    try:
        p = CanonProposal(
            infospace_id=workspace, canon_id=canon_id, surface=surface,
            normalized_surface=surface.strip().lower(), type=etype, status="pending",
        )
        db.add(p); db.commit(); db.refresh(p)
        return p.id
    finally:
        db.close()
        try: next(gen)
        except StopIteration: pass


def test_proposal_accept_create_and_dismiss(client, headers, workspace):
    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons", headers=headers,
        json={"name": f"Prop-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    tag = uuid.uuid4().hex[:4]
    pid_create = _make_proposal(workspace, canon_id, f"Novel-{tag}")
    pid_dismiss = _make_proposal(workspace, canon_id, f"Junk-{tag}")

    # both pending
    pending = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/proposals", headers=headers).json()
    assert {pid_create, pid_dismiss} <= {p["id"] for p in pending}

    # accept (no merge target → create new entry)
    r = client.post(f"{API}/infospaces/{workspace}/canons/{canon_id}/proposals/{pid_create}/action/accept", headers=headers, json={})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "accepted"
    entries = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/entities", headers=headers).json()
    assert any(e["canonical"] == f"Novel-{tag}" for e in entries), "accept-create made the entry"

    # dismiss the other
    r = client.post(f"{API}/infospaces/{workspace}/canons/{canon_id}/proposals/{pid_dismiss}/action/dismiss", headers=headers)
    assert r.status_code == 200 and r.json()["status"] == "dismissed"

    # neither is pending anymore
    pending_ids = {p["id"] for p in client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/proposals?status=pending", headers=headers).json()}
    assert pid_create not in pending_ids and pid_dismiss not in pending_ids


def test_proposal_accept_merge_appends_alias(client, headers, workspace):
    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons", headers=headers,
        json={"name": f"PropMerge-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    tag = uuid.uuid4().hex[:4]
    entry_id = client.post(
        f"{API}/infospaces/{workspace}/entities", headers=headers,
        json={"canonical": f"Acme-{tag}", "type": "org", "canon_id": canon_id},
    ).json()["id"]
    pid = _make_proposal(workspace, canon_id, f"Acme Inc-{tag}")

    r = client.post(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/proposals/{pid}/action/accept",
        headers=headers, json={"merge_into_entry_id": entry_id},
    )
    assert r.status_code == 200, r.text
    entries = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/entities", headers=headers).json()
    target = next(e for e in entries if e["id"] == entry_id)
    assert f"Acme Inc-{tag}" in target["aliases"], "accept-merge appended the surface as an alias"


def test_bulk_triage_proposals(client, headers, workspace):
    """Bulk triage settles many proposals in one call: accept-create, accept-merge,
    dismiss — and skips (not errors) unknown / already-resolved ids."""
    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons", headers=headers,
        json={"name": f"Bulk-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    tag = uuid.uuid4().hex[:4]
    entry_id = client.post(
        f"{API}/infospaces/{workspace}/entities", headers=headers,
        json={"canonical": f"Globex-{tag}", "type": "org", "canon_id": canon_id},
    ).json()["id"]
    pid_create = _make_proposal(workspace, canon_id, f"Fresh-{tag}")
    pid_merge = _make_proposal(workspace, canon_id, f"Globex Inc-{tag}")
    pid_dismiss = _make_proposal(workspace, canon_id, f"Spam-{tag}")
    pid_already = _make_proposal(workspace, canon_id, f"Old-{tag}")
    client.post(f"{API}/infospaces/{workspace}/canons/{canon_id}/proposals/{pid_already}/action/dismiss", headers=headers)

    r = client.post(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/proposals/action/bulk",
        headers=headers,
        json={
            "accept": [
                {"proposal_id": pid_create},
                {"proposal_id": pid_merge, "merge_into_entry_id": entry_id},
            ],
            "dismiss": [pid_dismiss, 99999999, pid_already],  # not-found + already-dismissed → skipped
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["accepted"] == 2
    assert data["dismissed"] == 1
    assert data["skipped"] == 2  # 99999999 unknown + pid_already not pending
    assert data["runs_recurated"] == 0  # these proposals carry no run

    entries = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/entities", headers=headers).json()
    assert any(e["canonical"] == f"Fresh-{tag}" for e in entries), "accept-create made the entry"
    target = next(e for e in entries if e["id"] == entry_id)
    assert f"Globex Inc-{tag}" in target["aliases"], "accept-merge appended the alias"
    pending_ids = {p["id"] for p in client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/proposals?status=pending", headers=headers).json()}
    assert not ({pid_create, pid_merge, pid_dismiss} & pending_ids), "settled proposals left the pending list"


def test_bulk_triage_bad_merge_target_skipped(client, headers, workspace):
    """A bad merge_into_entry_id in a bulk accept is skipped (not a 500); the rest apply."""
    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons", headers=headers,
        json={"name": f"BulkBad-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    tag = uuid.uuid4().hex[:4]
    good = _make_proposal(workspace, canon_id, f"Good-{tag}")
    bad = _make_proposal(workspace, canon_id, f"Bad-{tag}")
    r = client.post(
        f"{API}/infospaces/{workspace}/canons/{canon_id}/proposals/action/bulk",
        headers=headers,
        json={
            "accept": [
                {"proposal_id": good},                                    # create new → ok
                {"proposal_id": bad, "merge_into_entry_id": 999999999},    # bad target → skipped
            ],
            "dismiss": [],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 1 and r.json()["skipped"] == 1
    entries = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/entities", headers=headers).json()
    assert any(e["canonical"] == f"Good-{tag}" for e in entries), "the valid accept still settled"


# ─── Embedding population: embed-on-create byproduct + backfill ──────────────


def test_embed_canon_action_route(client, headers, workspace):
    """The embed action dispatches the backfill task and 404s on an unknown canon."""
    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons", headers=headers,
        json={"name": f"Embed-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    r = client.post(f"{API}/infospaces/{workspace}/canons/{canon_id}/action/embed", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "dispatched"
    assert client.post(f"{API}/infospaces/{workspace}/canons/999999999/action/embed", headers=headers).status_code == 404


def test_backfill_canon_embeddings(client, headers, workspace, monkeypatch):
    """backfill_canon_embeddings embeds entries missing the current dim column,
    writes the matching embedding_{dim}, and is idempotent on re-run."""
    from app.api.modules.graph.tasks import maintenance
    from app.api.dependency_injection import get_db
    from sqlalchemy import text as sa_text

    # Stub the provider-backed embedder with a deterministic 384-dim vector.
    monkeypatch.setattr(maintenance, "_embed",
                        lambda session, iid, texts: [[0.1] * 384 for _ in texts])

    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons", headers=headers,
        json={"name": f"Backfill-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    tag = uuid.uuid4().hex[:4]
    for n in (f"Alpha-{tag}", f"Beta-{tag}"):
        client.post(f"{API}/infospaces/{workspace}/entities", headers=headers,
                    json={"canonical": n, "type": "org", "canon_id": canon_id})

    gen = get_db(); db = next(gen)
    try:
        embedded = maintenance.backfill_canon_embeddings(db, workspace, canon_id)
        assert embedded == 2, "both fresh entries embedded"
        non_null = db.execute(sa_text(
            "SELECT COUNT(*) FROM canon_entry WHERE canon_id = :c AND embedding_384 IS NOT NULL"
        ), {"c": canon_id}).scalar()
        assert non_null == 2

        # Idempotent — nothing left to embed on a second pass.
        assert maintenance.backfill_canon_embeddings(db, workspace, canon_id) == 0
    finally:
        db.close()
        try: next(gen)
        except StopIteration: pass


# ─── promote seam: run folds → canon ─────────────────────────────────────────


def test_promote_folds_create_extend_merge(client, headers, workspace):
    """promote_folds: creates when absent, is idempotent on re-promote, and
    merges when a fold's members already resolve to distinct entries."""
    from app.api.modules.graph.promote import promote_folds
    from app.api.dependency_injection import get_db

    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers, json={"name": f"Promote-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]

    tag = uuid.uuid4().hex[:4]
    gen = get_db()
    db = next(gen)
    try:
        # 1. create — no existing entry
        s1 = promote_folds(db, infospace_id=workspace, canon_id=canon_id,
                           folds=[{"keep": f"USA-{tag}", "names": [f"United States-{tag}", f"US-{tag}"], "type": "country"}])
        db.commit()
        assert s1["created"] == 1 and s1["merged"] == 0

        # 2. idempotent — re-promoting the same fold extends, creates nothing
        s2 = promote_folds(db, infospace_id=workspace, canon_id=canon_id,
                           folds=[{"keep": f"USA-{tag}", "names": [f"United States-{tag}"], "type": "country"}])
        db.commit()
        assert s2["created"] == 0 and s2["extended"] == 1
    finally:
        db.close()
        try: next(gen)
        except StopIteration: pass

    # 3. merge — two distinct entries the fold unites
    a = client.post(f"{API}/infospaces/{workspace}/entities", headers=headers,
                    json={"canonical": f"Berlin-{tag}", "type": "city", "canon_id": canon_id}).json()["id"]
    b = client.post(f"{API}/infospaces/{workspace}/entities", headers=headers,
                    json={"canonical": f"Berlin Stadt-{tag}", "type": "city", "canon_id": canon_id}).json()["id"]
    gen2 = get_db()
    db2 = next(gen2)
    try:
        s3 = promote_folds(db2, infospace_id=workspace, canon_id=canon_id,
                          folds=[{"keep": f"Berlin-{tag}", "names": [f"Berlin Stadt-{tag}"], "type": "city"}])
        db2.commit()
        assert s3["merged"] == 1
    finally:
        db2.close()
        try: next(gen2)
        except StopIteration: pass

    # The two city entries collapsed into one.
    entries = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/entities", headers=headers).json()
    cities = [e for e in entries if e["type"] == "city"]
    assert len(cities) == 1
    assert f"Berlin Stadt-{tag}" in cities[0]["aliases"]


def test_promote_folds_index_fresh_across_folds(client, headers, workspace):
    """A later fold that reuses an entry an earlier fold *created* in the same call
    extends it (no duplicate) — guards the preloaded alias index staying fresh."""
    from app.api.modules.graph.promote import promote_folds
    from app.api.dependency_injection import get_db

    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons", headers=headers,
        json={"name": f"IdxFresh-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    tag = uuid.uuid4().hex[:4]
    gen = get_db(); db = next(gen)
    try:
        s = promote_folds(db, infospace_id=workspace, canon_id=canon_id, folds=[
            {"keep": f"NATO-{tag}", "names": [f"N.A.T.O-{tag}"], "type": "org"},
            # reuses the just-created NATO entry — must extend, not create a second
            {"keep": f"NATO-{tag}", "names": [f"North Atlantic Treaty Org-{tag}"], "type": "org"},
        ])
        db.commit()
        assert s["created"] == 1 and s["extended"] == 1
    finally:
        db.close()
        try: next(gen)
        except StopIteration: pass

    entries = client.get(f"{API}/infospaces/{workspace}/canons/{canon_id}/entities", headers=headers).json()
    natos = [e for e in entries if e["type"] == "org" and e["canonical"] == f"NATO-{tag}"]
    assert len(natos) == 1, "the second fold extended the created entry rather than duplicating it"
    assert f"North Atlantic Treaty Org-{tag}" in natos[0]["aliases"]


def test_normalize_run_folds_value_aliases():
    """normalize_run_folds lifts variable-splitting value aliases out of
    views_config (nesting-agnostic), typing each fold by its field's leaf name."""
    from types import SimpleNamespace
    from app.api.modules.graph.promote import normalize_run_folds

    # views_config as a LIST with a nested globalVariableSplitting block carrying
    # the per-field map (the shape the dashboards persist today).
    run = SimpleNamespace(
        graph_config={},
        views_config=[{
            "runWideSettings": {
                "globalVariableSplitting": {
                    "enabled": True,
                    "valueAliasesByField": {
                        "document.party": {"SPD": ["Sozialdemokratische Partei", "spd"]},
                        "topics": {"Climate": ["climate change", "global warming"]},
                    },
                }
            }
        }],
    )
    folds = normalize_run_folds(run)
    by_keep = {f["keep"]: f for f in folds}
    assert by_keep["SPD"]["type"] == "party"
    assert set(by_keep["SPD"]["names"]) == {"Sozialdemokratische Partei", "spd"}
    assert by_keep["Climate"]["type"] == "topics"

    # Legacy single-map shape (valueAliases + fieldKey) → type from the fieldKey leaf.
    run_legacy = SimpleNamespace(
        graph_config={},
        views_config=[{"globalVariableSplitting": {
            "fieldKey": "email.sender",
            "valueAliases": {"ACME Corp": ["acme", "ACME Inc"]},
        }}],
    )
    legacy = normalize_run_folds(run_legacy)
    assert len(legacy) == 1
    assert legacy[0]["keep"] == "ACME Corp" and legacy[0]["type"] == "sender"

    # No splitting config → no value folds (and no crash on empty views_config).
    assert normalize_run_folds(SimpleNamespace(graph_config={}, views_config=[])) == []


def test_canon_value_merge_maps(client, headers, workspace):
    """canon_value_merge_maps projects value-typed canon entries back into
    MergeMaps keyed by the query's field paths (leaf-type match), so a panel
    grouping on a field auto-canonicalizes from the canon."""
    from app.api.modules.graph.promote import canon_value_merge_maps
    from app.api.dependency_injection import get_db

    canon_id = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers, json={"name": f"Values-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    tag = uuid.uuid4().hex[:4]
    # a value-typed entry (type = leaf field "party")
    client.post(f"{API}/infospaces/{workspace}/entities", headers=headers, json={
        "canonical": f"SPD-{tag}", "type": "party", "canon_id": canon_id,
        "aliases": [f"Sozialdemokraten-{tag}", f"spd-{tag}"],
    })

    gen = get_db()
    db = next(gen)
    try:
        # exact field path resolves by leaf "party"
        maps = canon_value_merge_maps(db, canon_id, ["document.party", "unrelated.score"])
        by_path = {m.field_path: m for m in maps}
        assert "document.party" in by_path and "unrelated.score" not in by_path
        entry = by_path["document.party"].entries[0]
        assert entry.keep == f"SPD-{tag}"
        # canonical itself + aliases all map to the keep
        assert f"SPD-{tag}" in entry.names and f"Sozialdemokraten-{tag}" in entry.names

        # no field paths / no matching type → empty, no crash
        assert canon_value_merge_maps(db, canon_id, []) == []
        assert canon_value_merge_maps(db, canon_id, ["a.b.nonexistenttype"]) == []
    finally:
        db.close()
        try: next(gen)
        except StopIteration: pass
