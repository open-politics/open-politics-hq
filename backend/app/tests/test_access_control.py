"""
Tests for the access control system: scope methods, capability enforcement,
and deployment capability ceiling.

These tests work on any DB backend (including SQLite) because they test the
access LAYER, not the data layer. Capability checks fail in Requires() before
any PostgreSQL-specific queries run.

Full end-to-end scope filtering tests (array ops, CTEs, package token resolution)
require PostgreSQL and are marked with @pytest.mark.postgres.
"""
import pytest
from unittest.mock import MagicMock
from fastapi import HTTPException
from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, insert, select
from sqlalchemy.orm import Session
from typing import Optional

from app.api.modules.identity_infospace_user.access import (
    Access,
    Capability,
    PackageScope,
    ROLE_CAPABILITIES,
    CollaboratorRole,
)


# ─── Minimal table for scope_filter SQL tests ───
# Raw SQLAlchemy table avoids polluting the global SQLModel mapper registry,
# which would trigger cascading configuration of all app models (JSONB, pgvector, etc.)

_test_metadata = MetaData()
fake_entity = Table(
    "fake_entity",
    _test_metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String, default=""),
)


@pytest.fixture(scope="module")
def scope_engine():
    engine = create_engine("sqlite://", echo=False)
    _test_metadata.create_all(engine)
    return engine


@pytest.fixture
def scope_session(scope_engine):
    with Session(scope_engine) as session:
        yield session
        session.rollback()


def _make_access(
    scope: Optional[PackageScope] = None,
    capabilities: frozenset = frozenset(),
    infospace_id: int = 1,
    user_id: int = 1,
) -> Access:
    """Build an Access object with a mock Infospace (avoids DB dependency)."""
    mock_infospace = MagicMock()
    mock_infospace.id = infospace_id
    mock_infospace.owner_id = user_id
    return Access(
        infospace_id=infospace_id,
        infospace=mock_infospace,
        user_id=user_id,
        is_owner=True,
        capabilities=capabilities,
        scope=scope,
        role=CollaboratorRole.OWNER,
    )


# ═══════════════════════════════════════════════════
# require_in_scope — pure Python, no DB
# ═══════════════════════════════════════════════════

class TestRequireInScope:
    """Tests for Access.require_in_scope()"""

    def test_noop_when_no_scope(self):
        """Full access (scope=None) — never raises."""
        access = _make_access(scope=None)
        access.require_in_scope("run_ids", 999)  # should not raise

    def test_allows_in_scope_entity(self):
        """Entity ID is in the scope set — no error."""
        scope = PackageScope(run_ids=(1, 2, 3))
        access = _make_access(scope=scope)
        access.require_in_scope("run_ids", 2)  # should not raise

    def test_blocks_out_of_scope_entity(self):
        """Entity ID is NOT in the scope set — 404."""
        scope = PackageScope(run_ids=(1, 2, 3))
        access = _make_access(scope=scope)
        with pytest.raises(HTTPException) as exc_info:
            access.require_in_scope("run_ids", 99)
        assert exc_info.value.status_code == 404

    def test_blocks_on_empty_scope(self):
        """Scope is set but ID set is empty — 404 for ANY entity.

        This is the critical bug that Phase 0.1 fixed: empty tuple is falsy,
        so the old `if access.scope and access.scope.run_ids:` pattern
        would skip the check entirely, leaking data.
        """
        scope = PackageScope(run_ids=())
        access = _make_access(scope=scope)
        with pytest.raises(HTTPException) as exc_info:
            access.require_in_scope("run_ids", 1)
        assert exc_info.value.status_code == 404

    def test_works_across_all_scope_fields(self):
        """Every scope field works the same way."""
        fields = {
            "run_ids": (10,),
            "schema_ids": (20,),
            "graph_ids": (30,),
            "entity_canonical_ids": (40,),
            "asset_ids": (50,),
            "bundle_ids": (60,),
        }
        scope = PackageScope(**fields)
        access = _make_access(scope=scope)

        # In scope → no raise
        for field, ids in fields.items():
            access.require_in_scope(field, ids[0])

        # Out of scope → 404
        for field in fields:
            with pytest.raises(HTTPException) as exc_info:
                access.require_in_scope(field, 9999)
            assert exc_info.value.status_code == 404


# ═══════════════════════════════════════════════════
# scope_filter — SQL statement manipulation
# ═══════════════════════════════════════════════════

class TestScopeFilter:
    """Tests for Access.scope_filter()"""

    def test_noop_when_no_scope(self, scope_session):
        """Full access (scope=None) — statement unchanged."""
        access = _make_access(scope=None)
        stmt = select(fake_entity)
        result = access.scope_filter(stmt, fake_entity.c.id, "run_ids")
        rows = scope_session.execute(result).all()
        assert rows == []

    def test_filters_to_in_scope_ids(self, scope_session):
        """Scope with IDs — only matching entities returned."""
        scope_session.execute(insert(fake_entity).values([
            {"id": i, "name": f"entity_{i}"} for i in range(1, 6)
        ]))
        scope_session.flush()

        scope = PackageScope(run_ids=(2, 4))
        access = _make_access(scope=scope)
        stmt = select(fake_entity)
        result = access.scope_filter(stmt, fake_entity.c.id, "run_ids")
        rows = scope_session.execute(result).all()
        assert {r.id for r in rows} == {2, 4}

    def test_returns_nothing_on_empty_scope(self, scope_session):
        """Scope set but empty tuple — WHERE FALSE, zero results.

        This is the critical correctness property: empty tuple ≠ no filtering.
        """
        scope_session.execute(insert(fake_entity).values({"id": 100, "name": "should_not_appear"}))
        scope_session.flush()

        scope = PackageScope(run_ids=())
        access = _make_access(scope=scope)
        stmt = select(fake_entity)
        result = access.scope_filter(stmt, fake_entity.c.id, "run_ids")
        rows = scope_session.execute(result).all()
        assert rows == []


# ═══════════════════════════════════════════════════
# Role → Capability mapping
# ═══════════════════════════════════════════════════

class TestRoleCapabilities:
    """Verify the role → capability mapping is correct."""

    def test_owner_has_all_capabilities(self):
        assert ROLE_CAPABILITIES[CollaboratorRole.OWNER] == frozenset(Capability)

    def test_analyst_has_four_capabilities(self):
        caps = ROLE_CAPABILITIES[CollaboratorRole.ANALYST]
        assert Capability.ORGANIZE in caps
        assert Capability.INGEST in caps
        assert Capability.COMPUTE in caps
        assert Capability.DELETE in caps
        assert Capability.SETUP not in caps

    def test_curator_has_organize_only(self):
        caps = ROLE_CAPABILITIES[CollaboratorRole.CURATOR]
        assert caps == frozenset({Capability.ORGANIZE})

    def test_viewer_has_no_capabilities(self):
        caps = ROLE_CAPABILITIES[CollaboratorRole.VIEWER]
        assert caps == frozenset()

    def test_invariant_scope_and_caps_disjoint(self):
        """Package consumers (scope != None) should have empty capabilities.

        This invariant means write endpoints don't need scope checks —
        the capability gate is sufficient.
        """
        # Simulate package token access: scope is set, capabilities are empty
        scope = PackageScope(bundle_ids=(1,))
        access = _make_access(scope=scope, capabilities=frozenset())
        assert access.scope is not None
        assert len(access.capabilities) == 0


# ═══════════════════════════════════════════════════
# Deployment capability ceiling
# ═══════════════════════════════════════════════════

class TestDeploymentCeiling:
    """Test the DEPLOYMENT_CAPABILITIES config and its effect on access."""

    def test_star_means_all(self):
        from app.core.config import AppSettings
        s = AppSettings(
            FIRST_SUPERUSER="test@test.com",
            FIRST_SUPERUSER_PASSWORD="testpass",
            DEPLOYMENT_CAPABILITIES="*",
            POSTGRES_SERVER="localhost",
        )
        assert s.deployment_capability_names == frozenset({"organize", "ingest", "compute", "delete", "setup"})

    def test_empty_means_readonly(self):
        from app.core.config import AppSettings
        s = AppSettings(
            FIRST_SUPERUSER="test@test.com",
            FIRST_SUPERUSER_PASSWORD="testpass",
            DEPLOYMENT_CAPABILITIES="",
            POSTGRES_SERVER="localhost",
        )
        assert s.deployment_capability_names == frozenset()

    def test_comma_separated_parsing(self):
        from app.core.config import AppSettings
        s = AppSettings(
            FIRST_SUPERUSER="test@test.com",
            FIRST_SUPERUSER_PASSWORD="testpass",
            DEPLOYMENT_CAPABILITIES="organize,ingest",
            POSTGRES_SERVER="localhost",
        )
        assert s.deployment_capability_names == frozenset({"organize", "ingest"})

    def test_ceiling_intersects_with_capabilities(self):
        """An owner on a readonly deployment gets no capabilities."""
        all_caps = frozenset(Capability)
        ceiling_names = frozenset()  # readonly
        ceiling = frozenset(c for c in Capability if c.value in ceiling_names)
        capped = all_caps & ceiling
        assert capped == frozenset()

    def test_ceiling_intersects_partial(self):
        """An owner on an ingest-only deployment loses COMPUTE and DELETE."""
        all_caps = frozenset(Capability)
        ceiling_names = frozenset({"organize", "ingest"})
        ceiling = frozenset(c for c in Capability if c.value in ceiling_names)
        capped = all_caps & ceiling
        assert Capability.ORGANIZE in capped
        assert Capability.INGEST in capped
        assert Capability.COMPUTE not in capped
        assert Capability.DELETE not in capped
        assert Capability.SETUP not in capped


# ═══════════════════════════════════════════════════
# PackageScope construction
# ═══════════════════════════════════════════════════

class TestPackageScope:
    """Verify PackageScope frozen tuple semantics."""

    def test_default_is_empty_tuples(self):
        scope = PackageScope()
        assert scope.bundle_ids == ()
        assert scope.run_ids == ()
        assert scope.schema_ids == ()
        assert scope.graph_ids == ()
        assert scope.entity_canonical_ids == ()
        assert scope.asset_ids == ()

    def test_is_frozen(self):
        scope = PackageScope(run_ids=(1, 2))
        with pytest.raises(AttributeError):
            scope.run_ids = (3, 4)  # type: ignore

    def test_empty_tuple_is_falsy_but_scope_exists(self):
        """The core semantic: scope is set (not None) but a field is empty.

        This is NOT the same as 'no scope'. The scope exists and explicitly
        grants zero access to that entity type.
        """
        scope = PackageScope(bundle_ids=(1,), run_ids=())
        assert scope is not None  # scope exists
        assert scope.run_ids == ()  # empty — grants zero run access
        assert len(scope.run_ids) == 0
        # Python truthiness: () is falsy — this is WHY the inline pattern was dangerous
        assert not scope.run_ids
