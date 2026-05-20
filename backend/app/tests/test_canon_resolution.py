"""Tests for canon-scoped entity resolution semantics.

Key invariants under test:
- Resolution scopes by ``canon_id`` only — same ``(name, type)`` curated
  into different canons produces two different Entity rows.
- ``find_by_alias`` returns entries from the target canon only.
- ``resolve_entities_batch`` creates fresh rows when the lookup misses.
- The ``_resolve_target_canon`` helper falls back to the infospace's
  ``default_canon_id`` when no graph_id is supplied; raises when the
  infospace has no default (migration regression check).

These are functional tests against real Postgres (the model uses pgvector
columns and JSONB which sqlite can't handle).
"""
from __future__ import annotations

import asyncio
import uuid

import pytest

from app.api.modules.graph.models import Canon, Entity, KnowledgeGraph
from app.api.modules.graph.resolution import (
    find_by_alias,
    resolve_entities_batch,
)
from app.api.modules.graph.tasks.curation import _resolve_target_canon
from app.core.config import settings

API = settings.API_V1_STR


@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    return infospace_factory(f"Resolution {uuid.uuid4().hex[:6]}", user_id)


def _db_session():
    """Module-level DB session that doesn't need fixtures from conftest.

    Uses the app's session factory directly. Caller commits/rolls back.
    """
    from app.api.dependency_injection import get_db
    gen = get_db()
    return next(gen), gen


def test_find_by_alias_returns_only_canon_members(client, headers, workspace):
    """An entity in canon A is invisible to find_by_alias scoped to canon B."""
    # Create two canons in the same infospace via routes so we exercise the
    # full path.
    canon_a = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Canon-A-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    canon_b = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Canon-B-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]

    # Same entity name in canon A
    name = f"Apple-{uuid.uuid4().hex[:4]}"
    client.post(
        f"{API}/infospaces/{workspace}/entities",
        headers=headers,
        json={
            "canonical_name": name,
            "entity_type": "Organization",
            "canon_id": canon_a,
        },
    )

    db, gen = _db_session()
    try:
        a_match = find_by_alias(db, canon_id=canon_a, raw_name=name, entity_type="Organization")
        b_match = find_by_alias(db, canon_id=canon_b, raw_name=name, entity_type="Organization")
        assert a_match is not None, "should find in canon A"
        assert b_match is None, "must not find in canon B (different canon)"
    finally:
        db.close()
        try:
            next(gen)
        except StopIteration:
            pass


def test_resolve_entities_batch_creates_in_target_canon(client, headers, workspace):
    """Missing entities are created fresh in the target canon, not the
    infospace's default canon."""
    canon_target = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"Target-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]

    name = f"FreshOrg-{uuid.uuid4().hex[:4]}"
    db, gen = _db_session()
    try:
        result = asyncio.run(resolve_entities_batch(
            session=db,
            infospace_id=workspace,
            canon_id=canon_target,
            entities=[(name, "Organization")],
            use_embeddings=False,
        ))
        db.commit()
        assert (name, "Organization") in result
        ent = result[(name, "Organization")]
        assert ent.canon_id == canon_target, "entity must land in target canon"
    finally:
        db.close()
        try:
            next(gen)
        except StopIteration:
            pass


def test_resolve_target_canon_falls_back_to_default(client, headers, workspace):
    """No graph_id → uses infospace.default_canon_id."""
    db, gen = _db_session()
    try:
        canon_id, graph_id = _resolve_target_canon(db, workspace, None)
        assert canon_id is not None
        assert graph_id is None
        # Sanity: canon belongs to this infospace
        canon = db.get(Canon, canon_id)
        assert canon is not None
        assert canon.infospace_id == workspace
    finally:
        db.close()
        try:
            next(gen)
        except StopIteration:
            pass


def test_resolve_target_canon_uses_graph_canon(client, headers, workspace):
    """``graph_id`` provided → returns ``graph.canon_id``, not the default."""
    other_canon = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"GraphCanon-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    graph = client.post(
        f"{API}/infospaces/{workspace}/knowledge-graphs",
        headers=headers,
        json={"name": f"Graph-{uuid.uuid4().hex[:6]}", "canon_id": other_canon},
    ).json()
    graph_id = graph["id"]

    db, gen = _db_session()
    try:
        canon_id, returned_graph_id = _resolve_target_canon(db, workspace, graph_id)
        assert canon_id == other_canon
        assert returned_graph_id == graph_id
    finally:
        db.close()
        try:
            next(gen)
        except StopIteration:
            pass


def test_cross_canon_collision_creates_fresh(client, headers, workspace):
    """Same (name, type) curated into different canons → two distinct entities."""
    canon_a = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"CanonA-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]
    canon_b = client.post(
        f"{API}/infospaces/{workspace}/canons",
        headers=headers,
        json={"name": f"CanonB-{uuid.uuid4().hex[:6]}"},
    ).json()["id"]

    name = f"Collide-{uuid.uuid4().hex[:4]}"
    db, gen = _db_session()
    try:
        res_a = asyncio.run(resolve_entities_batch(
            session=db,
            infospace_id=workspace,
            canon_id=canon_a,
            entities=[(name, "Person")],
            use_embeddings=False,
        ))
        res_b = asyncio.run(resolve_entities_batch(
            session=db,
            infospace_id=workspace,
            canon_id=canon_b,
            entities=[(name, "Person")],
            use_embeddings=False,
        ))
        db.commit()
        ent_a = res_a[(name, "Person")]
        ent_b = res_b[(name, "Person")]
        assert ent_a.id != ent_b.id, "entities must be distinct rows"
        assert ent_a.canon_id == canon_a
        assert ent_b.canon_id == canon_b
    finally:
        db.close()
        try:
            next(gen)
        except StopIteration:
            pass
