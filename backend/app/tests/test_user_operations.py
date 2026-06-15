"""
End-to-end functional tests for real user operations.

These hit the actual FastAPI app backed by real Postgres. They test the
complete workflows a user performs — login, create workspace, ingest real
files, define schemas, create annotation runs, organize into bundles.

Requires: Postgres, SearXNG (via docker compose).

Test fixtures in app/tests/fixtures/:
  - README.md (markdown document)
  - d19-2553.pdf (EU parliament PDF)
  - eu_parl_10.csv (CSV with 10 rows)
  - exactly.png (image)
  - urls.txt (single URL for article ingestion)
"""
from pathlib import Path

import pytest

from app.core.config import settings

FIXTURES = Path(__file__).parent / "fixtures"


# ─── Fixtures ────────────────────────────────────────────────────────────────
# client, auth, headers, user_id, infospace_factory — provided by conftest.py

@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    """Dedicated infospace for all workflow tests — auto-deleted on teardown."""
    return infospace_factory("Functional Test Workspace", user_id)


def _url_from_fixture():
    """Read the URL from fixtures/urls.txt."""
    return (FIXTURES / "urls.txt").read_text().strip()


# ═══════════════════════════════════════════════════
# Auth
# ═══════════════════════════════════════════════════

class TestAuth:

    def test_login_returns_valid_token(self, client, headers):
        r = client.get(f"{settings.API_V1_STR}/users/me", headers=headers)
        assert r.status_code == 200
        assert r.json()["email"] == settings.FIRST_SUPERUSER

    def test_wrong_password(self, client):
        r = client.post(
            f"{settings.API_V1_STR}/login/access-token",
            data={"username": settings.FIRST_SUPERUSER, "password": "wrong"},
        )
        assert r.status_code == 400

    def test_no_token(self, client):
        assert client.get(f"{settings.API_V1_STR}/users/me").status_code == 401

    def test_garbage_token(self, client):
        r = client.get(
            f"{settings.API_V1_STR}/users/me",
            headers={"Authorization": "Bearer garbage"},
        )
        assert r.status_code == 401


# ═══════════════════════════════════════════════════
# Infospace CRUD
# ═══════════════════════════════════════════════════

class TestInfospace:

    def test_create_and_retrieve(self, client, headers, user_id, infospace_factory):
        iid = infospace_factory("Retrieve Test", user_id)

        # Patch description on the just-created infospace
        client.patch(
            f"{settings.API_V1_STR}/infospaces/{iid}", headers=headers,
            json={"description": "Climate coverage"},
        )

        r2 = client.get(f"{settings.API_V1_STR}/infospaces/{iid}", headers=headers)
        assert r2.status_code == 200
        assert r2.json()["name"] == "Retrieve Test"
        assert r2.json()["owner_id"] == user_id
        assert r2.json()["description"] == "Climate coverage"

    def test_update(self, client, headers, user_id, infospace_factory):
        iid = infospace_factory("Update Me", user_id)

        r = client.patch(
            f"{settings.API_V1_STR}/infospaces/{iid}", headers=headers,
            json={"description": "Updated"},
        )
        assert r.status_code == 200
        assert r.json()["description"] == "Updated"

    def test_list(self, client, headers):
        r = client.get(f"{settings.API_V1_STR}/infospaces", headers=headers)
        assert r.status_code == 200
        assert len(r.json()["data"]) >= 1

    def test_nonexistent_404(self, client, headers):
        assert client.get(f"{settings.API_V1_STR}/infospaces/999999", headers=headers).status_code == 404


# ═══════════════════════════════════════════════════
# Bundles — directories in the infospace tree
# ═══════════════════════════════════════════════════

class TestBundles:

    def test_create(self, client, headers, workspace):
        r = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/bundles",
            headers=headers, json={"name": "Investigation"},
        )
        assert r.status_code == 201
        assert r.json()["infospace_id"] == workspace

    def test_nested_bundles(self, client, headers, workspace):
        parent = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/bundles",
            headers=headers, json={"name": "Documents"},
        ).json()
        child = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/bundles",
            headers=headers, json={"name": "PDFs", "parent_bundle_id": parent["id"]},
        )
        assert child.status_code == 201
        assert child.json()["parent_bundle_id"] == parent["id"]

    def test_duplicate_rejected(self, client, headers, workspace):
        name = "Unique Name"
        client.post(f"{settings.API_V1_STR}/infospaces/{workspace}/bundles", headers=headers, json={"name": name})
        r = client.post(f"{settings.API_V1_STR}/infospaces/{workspace}/bundles", headers=headers, json={"name": name})
        assert r.status_code == 409

    def test_cross_infospace_isolation(self, client, headers, workspace, user_id, infospace_factory):
        bid = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/bundles",
            headers=headers, json={"name": "Isolated"},
        ).json()["id"]
        other_iid = infospace_factory("Other", user_id)
        assert client.get(
            f"{settings.API_V1_STR}/infospaces/{other_iid}/bundles/{bid}", headers=headers
        ).status_code == 404


# ═══════════════════════════════════════════════════
# Asset ingestion — real files from fixtures/
# ═══════════════════════════════════════════════════

def _drive(workspace: int, job_ids: list[int], *, process: bool = False):
    """Drive minted IngestionJobs exactly as the worker would: run ``ingest``
    in-process, and optionally sweep ``item_processing`` for PENDING assets."""
    import asyncio
    from app.core.tasks import TaskContext
    from app.api.modules.content.tasks.ingestion import ingest

    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())

    ingest(TaskContext(infospace_id=workspace, settings=settings, task_name="ingest"), job_ids)

    if process:
        from sqlmodel import Session, select
        from app.core.db import engine
        from app.api.modules.content.models import Asset, ProcessingStatus
        from app.api.modules.content.tasks.processing import item_processing

        with Session(engine) as s:
            pending = list(s.exec(
                select(Asset.id).where(
                    Asset.infospace_id == workspace,
                    Asset.processing_status == ProcessingStatus.PENDING,
                )
            ).all())
        if pending:
            item_processing(
                TaskContext(infospace_id=workspace, settings=settings, task_name="item_processing"),
                pending,
            )


def _find_asset(client, headers, workspace: int, *, title: str | None = None,
                source_identifier: str | None = None) -> dict:
    r = client.get(
        f"{settings.API_V1_STR}/infospaces/{workspace}/assets",
        headers=headers, params={"limit": 200},
    )
    assert r.status_code == 200
    for a in r.json()["data"]:
        if title is not None and a["title"] == title:
            return a
        if source_identifier is not None and a.get("source_identifier") == source_identifier:
            return a
    raise AssertionError(f"asset not found (title={title!r}, source_identifier={source_identifier!r})")


class TestAssetIngestion:
    """Ingest real files through the async intake contract: the route mints
    IngestionJob(s) to poll; the harness drives them in-process (what the
    worker does), then asserts the built assets."""

    def test_intake_text(self, client, headers, workspace):
        """Text content via the unified intake endpoint."""
        r = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/assets/intake",
            headers=headers,
            json={"items": [{"text": "Climate change threatens global food security.",
                             "title": "Climate Brief"}]},
        )
        assert r.status_code == 200, f"Text intake failed: {r.text[:300]}"
        jobs = r.json()
        assert len(jobs) == 1 and jobs[0]["kind"] == "text"

        _drive(workspace, [jobs[0]["id"]])
        asset = _find_asset(client, headers, workspace, title="Climate Brief")
        assert asset["kind"] == "text"

    def test_upload_markdown(self, client, headers, workspace):
        """Upload README.md — route returns the upload job; driving it builds the asset."""
        with open(FIXTURES / "README.md", "rb") as f:
            r = client.post(
                f"{settings.API_V1_STR}/infospaces/{workspace}/assets/upload",
                headers=headers,
                files={"file": ("README.md", f, "text/markdown")},
            )
        assert r.status_code == 200, f"MD upload failed: {r.text[:300]}"
        job = r.json()
        assert job["kind"] == "upload"

        _drive(workspace, [job["id"]])
        asset = _find_asset(client, headers, workspace, title="README.md")
        assert asset["kind"] == "text"

    def test_upload_csv_creates_children(self, client, headers, workspace):
        """Upload CSV — acquire builds the parent PENDING; processing creates row children."""
        with open(FIXTURES / "eu_parl_10.csv", "rb") as f:
            r = client.post(
                f"{settings.API_V1_STR}/infospaces/{workspace}/assets/upload",
                headers=headers,
                files={"file": ("eu_parl_10.csv", f, "text/csv")},
            )
        assert r.status_code == 200, f"CSV upload failed: {r.text[:300]}"

        _drive(workspace, [r.json()["id"]], process=True)
        parent = _find_asset(client, headers, workspace, title="eu_parl_10.csv")
        assert parent["kind"] == "csv"

        children = client.get(
            f"{settings.API_V1_STR}/infospaces/{workspace}/assets/{parent['id']}/children",
            headers=headers,
        )
        assert children.status_code == 200
        # eu_parl_10.csv has 10 rows
        assert len(children.json()) == 10

    def test_upload_image(self, client, headers, workspace):
        with open(FIXTURES / "exactly.png", "rb") as f:
            r = client.post(
                f"{settings.API_V1_STR}/infospaces/{workspace}/assets/upload",
                headers=headers,
                files={"file": ("exactly.png", f, "image/png")},
            )
        assert r.status_code == 200, f"Image upload failed: {r.text[:300]}"

        _drive(workspace, [r.json()["id"]])
        asset = _find_asset(client, headers, workspace, title="exactly.png")
        assert asset["kind"] == "image"

    def test_intake_url(self, client, headers, workspace):
        """Ingest a web article: acquire makes the stub; the WebArticle type scrapes it."""
        url = _url_from_fixture()
        r = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/assets/intake",
            headers=headers,
            json={"items": [{"url": url}]},
        )
        assert r.status_code == 200, f"URL intake failed: {r.text[:300]}"
        jobs = r.json()
        assert len(jobs) == 1 and jobs[0]["kind"] == "web"

        _drive(workspace, [jobs[0]["id"]], process=True)
        asset = _find_asset(client, headers, workspace, source_identifier=url)
        full = client.get(
            f"{settings.API_V1_STR}/infospaces/{workspace}/assets/{asset['id']}",
            headers=headers,
        ).json()
        assert full["text_content"], "scraping produced content"

    def test_upload_pdf(self, client, headers, workspace):
        """Upload a real EU parliament PDF."""
        with open(FIXTURES / "d19-2553.pdf", "rb") as f:
            r = client.post(
                f"{settings.API_V1_STR}/infospaces/{workspace}/assets/upload",
                headers=headers,
                files={"file": ("d19-2553.pdf", f, "application/pdf")},
            )
        assert r.status_code == 200, f"PDF upload failed: {r.text[:300]}"

        _drive(workspace, [r.json()["id"]])
        asset = _find_asset(client, headers, workspace, title="d19-2553.pdf")
        assert asset["kind"] == "pdf"

    def test_assets_appear_in_list(self, client, headers, workspace):
        """After all ingestions, the infospace has multiple assets."""
        r = client.get(
            f"{settings.API_V1_STR}/infospaces/{workspace}/assets",
            headers=headers,
            params={"limit": 100},
        )
        assert r.status_code == 200
        data = r.json()["data"]
        # We created at least 6 top-level assets (text, md, csv, image, url, pdf)
        # plus csv children — total should be well above 6
        assert len(data) >= 6, f"Expected >= 6 assets, got {len(data)}"


# ═══════════════════════════════════════════════════
# Annotation schemas + runs + manual annotations
# ═══════════════════════════════════════════════════

class TestAnnotationWorkflow:
    """Schema → run → (mock) annotation result."""

    def test_create_schema(self, client, headers, workspace):
        r = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/annotation_schemas",
            headers=headers,
            json={
                "name": "Entity Extraction",
                "output_contract": {
                    "fields": [
                        {"name": "entities", "type": "List[str]", "description": "Named entities"},
                        {"name": "sentiment", "type": "float", "description": "Sentiment -1 to 1"},
                    ]
                },
                "instructions": "Extract entities and rate sentiment.",
            },
        )
        assert r.status_code == 201
        assert len(r.json()["output_contract"]["fields"]) == 2

    def test_create_run_targeting_assets(self, client, headers, workspace):
        """Create a schema and a run — run records intent, LLM execution is async."""
        schema = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/annotation_schemas",
            headers=headers,
            json={
                "name": "Run Test Schema",
                "output_contract": {"fields": [{"name": "label", "type": "str"}]},
            },
        ).json()

        # Get an asset to target
        assets = client.get(
            f"{settings.API_V1_STR}/infospaces/{workspace}/assets", headers=headers,
        ).json()["data"]
        assert len(assets) > 0

        r = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/runs",
            headers=headers,
            json={
                "name": "Entity Extraction Run",
                "schema_ids": [schema["id"]],
                "target_asset_ids": [assets[0]["id"]],
                "configuration": {},
            },
        )
        assert r.status_code == 201, f"Run create failed: {r.text[:300]}"
        run = r.json()
        assert run["name"] == "Entity Extraction Run"
        assert run["status"] == "pending"

    def test_list_runs(self, client, headers, workspace):
        r = client.get(
            f"{settings.API_V1_STR}/infospaces/{workspace}/runs",
            headers=headers,
        )
        assert r.status_code == 200
        assert len(r.json()["data"]) >= 1


# ═══════════════════════════════════════════════════
# Capability enforcement
# ═══════════════════════════════════════════════════

class TestCapabilityEnforcement:

    def test_unauthenticated_blocked(self, client):
        assert client.post(f"{settings.API_V1_STR}/infospaces", json={"name": "No"}).status_code == 401

    def test_unauthenticated_cannot_ingest(self, client, workspace):
        r = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/assets/intake",
            json={"items": [{"text": "nope"}]},
        )
        assert r.status_code in (401, 403, 404)


# ═══════════════════════════════════════════════════
# Healthcheck
# ═══════════════════════════════════════════════════

class TestHealthcheck:

    def test_liveness(self, client):
        assert client.get(f"{settings.API_V1_STR}/healthz/liveness").status_code == 200

    def test_readiness_exists(self, client):
        assert client.get(f"{settings.API_V1_STR}/healthz/readiness").status_code in (200, 503)
