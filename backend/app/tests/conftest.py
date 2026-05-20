"""
Shared test fixtures.

Unit tests use SQLite in-memory. Only specific tables are created per-test
module — the full app metadata uses JSONB/pgvector types that SQLite can't handle.

Functional tests hitting real Postgres use ``infospace_factory`` to ensure every
infospace created during the run is deleted on teardown — no more ghost workspaces
polluting the infospace list.

Enforcement fixture `builder_must_not_commit` asserts the HQ v2 invariant that
AssetBuilder.build() never commits internally. Opt-in per test — see
test_asset_builder_identity.py for examples. Commit-discipline invariant:
callers (handlers, routes, @task bodies) own the transaction boundary.
"""
import pytest
from sqlmodel import Session, create_engine


@pytest.fixture(scope="module")
def sqlite_engine():
    """In-memory SQLite engine for unit tests."""
    return create_engine("sqlite://", echo=False)


@pytest.fixture
def sqlite_session(sqlite_engine):
    """Fresh SQLite session, rolled back after each test."""
    with Session(sqlite_engine) as session:
        yield session
        session.rollback()


# ─── Functional test helpers (real Postgres) ──────────────────────────────────

@pytest.fixture(scope="module")
def client():
    """Shared TestClient for functional test modules."""
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


@pytest.fixture(scope="module")
def auth(client):
    """Authenticate as superuser. Returns (headers, user_id)."""
    from app.core.config import settings
    r = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    assert r.status_code == 200, f"Login failed: {r.text}"
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    me = client.get(f"{settings.API_V1_STR}/users/me", headers=headers)
    return headers, me.json()["id"]


@pytest.fixture(scope="module")
def headers(auth):
    return auth[0]


@pytest.fixture(scope="module")
def user_id(auth):
    return auth[1]


@pytest.fixture(scope="module")
def infospace_factory(client, headers):
    """Factory that creates infospaces and deletes them all on module teardown.

    Usage in a test or fixture::

        iid = infospace_factory("My Workspace", owner_id=uid)
    """
    from app.core.config import settings

    created: list[int] = []

    def _create(name: str, owner_id: int) -> int:
        r = client.post(
            f"{settings.API_V1_STR}/infospaces",
            headers=headers,
            json={"name": name, "owner_id": owner_id},
        )
        assert r.status_code == 201, f"Infospace creation failed: {r.text[:300]}"
        iid = r.json()["id"]
        created.append(iid)
        return iid

    yield _create

    # Teardown — delete every infospace we created (reverse order for safety)
    for iid in reversed(created):
        client.delete(f"{settings.API_V1_STR}/infospaces/{iid}", headers=headers)


# ─── Flush-never-commit enforcement (HQ v2 invariant #1) ──────────────────────

@pytest.fixture
def builder_must_not_commit(monkeypatch):
    """Assert AssetBuilder.build() / .load() / .build_batch() / .build_children()
    never commit internally. Opt-in per test.

    HQ v2 invariant: L2 primitives flush, never commit. The caller (route,
    @task, poll handler) owns the transaction boundary. This fixture wraps the
    session's commit() on builder instances and fails the test if called from
    within any builder terminal.

    Usage:
        def test_something(session, user_id, workspace, builder_must_not_commit):
            builder = AssetBuilder(session, user_id, workspace)
            asset = await builder.build()          # ← fixture watches this
            session.commit()                        # ← OK: caller's commit
    """
    from app.api.modules.content.services.asset_builder import AssetBuilder

    committed_inside: list[str] = []

    def _wrap_terminal(method_name: str):
        original = getattr(AssetBuilder, method_name)

        async def traced(self, *args, **kwargs):
            # Monkey-patch this session's commit() for the duration of the call.
            real_commit = self.session.commit

            def blocked_commit(*a, **kw):
                committed_inside.append(f"{method_name}() called session.commit()")
                # Let it through so the test continues — failure is raised in teardown.
                return real_commit(*a, **kw)

            self.session.commit = blocked_commit  # type: ignore[method-assign]
            try:
                return await original(self, *args, **kwargs)
            finally:
                self.session.commit = real_commit  # type: ignore[method-assign]

        monkeypatch.setattr(AssetBuilder, method_name, traced)

    for name in ("build", "load", "build_batch", "build_children"):
        _wrap_terminal(name)

    yield

    if committed_inside:
        pytest.fail(
            "AssetBuilder must not commit internally (HQ v2 invariant #1): "
            + "; ".join(committed_inside)
        )
