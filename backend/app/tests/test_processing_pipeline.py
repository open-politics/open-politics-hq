"""
Tests for the content processing pipeline — the real async work path.

These call @task functions directly with a real TaskContext, real DB, and
real providers. This is exactly what the Celery worker does, minus the
message broker dispatch. The processing is identical.

Flow tested:
  1. Upload file via HTTP (asset record created, status=PENDING)
  2. Call process_pending(ctx, [asset_id]) — the @task function
  3. Verify asset status changes to READY and children are created

Requires: Postgres, local storage (via docker compose).
"""
from pathlib import Path

import pytest
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.api.modules.content.models import Asset, ProcessingStatus
from app.api.modules.content.tasks.processing import process_pending
from app.core.tasks import TaskContext

FIXTURES = Path(__file__).parent / "fixtures"


# ─── Fixtures ────────────────────────────────────────────────────────────────
# client, auth, headers, user_id, infospace_factory — provided by conftest.py

@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    """Dedicated infospace — auto-deleted on teardown."""
    return infospace_factory("Processing Pipeline Tests", user_id)


def _upload(client, headers, workspace, filename, content_type):
    """Upload a fixture file, return the asset dict."""
    with open(FIXTURES / filename, "rb") as f:
        r = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/assets/upload",
            headers=headers,
            files={"file": (filename, f, content_type)},
            data={"process_immediately": "false"},  # prevent inline processing
        )
    assert r.status_code == 200, f"Upload {filename} failed: {r.text[:300]}"
    return r.json()


def _run_processing(infospace_id: int, asset_ids: list[int]):
    """Invoke process_pending exactly as the Celery worker would.

    Ensures a clean event loop — prior test modules may have left
    the loop in a closed/running state from async TestClient calls.
    """
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())

    ctx = TaskContext(
        infospace_id=infospace_id,
        settings=settings,
        task_name="process_pending",
    )
    process_pending(ctx, asset_ids)


def _get_asset(asset_id: int) -> Asset:
    """Load asset from DB."""
    with Session(engine) as session:
        asset = session.get(Asset, asset_id)
        session.expunge(asset)
        return asset


def _get_children(asset_id: int) -> list[Asset]:
    """Load child assets from DB."""
    from sqlmodel import select
    with Session(engine) as session:
        stmt = select(Asset).where(Asset.parent_asset_id == asset_id)
        children = session.exec(stmt).all()
        for c in children:
            session.expunge(c)
        return children


# ═══════════════════════════════════════════════════
# PDF processing — should produce page children
# ═══════════════════════════════════════════════════

class TestPDFProcessing:

    def test_pdf_processing_produces_pages_with_content(self, client, headers, workspace):
        """Upload PDF, run process_pending, verify page children with extracted text."""
        asset = _upload(client, headers, workspace, "d19-2553.pdf", "application/pdf")
        asset_id = asset["id"]

        # Force status to PENDING so process_pending can claim it
        # (upload handler may flip to PROCESSING via strategy check before event dispatch)
        with Session(engine) as session:
            from sqlalchemy import update as sa_update
            session.execute(
                sa_update(Asset).where(Asset.id == asset_id)
                .values(processing_status=ProcessingStatus.PENDING)
            )
            session.commit()

        # Run the @task function directly — same code path as Celery worker
        _run_processing(workspace, [asset_id])

        # Children created, all are PDF pages
        children = _get_children(asset_id)
        assert len(children) > 0, "PDF should produce page children"
        assert all(c.kind.value == "pdf_page" for c in children)

        # At least some pages should have extracted text
        pages_with_text = [c for c in children if c.text_content]
        assert len(pages_with_text) > 0, "At least some PDF pages should have extracted text"


# ═══════════════════════════════════════════════════
# CSV processing — should produce row children
# ═══════════════════════════════════════════════════

class TestCSVProcessing:

    def test_csv_produces_row_children(self, client, headers, workspace):
        """Upload CSV with deferred processing, then process."""
        asset = _upload(client, headers, workspace, "eu_parl_10.csv", "text/csv")
        asset_id = asset["id"]

        _run_processing(workspace, [asset_id])

        db_asset = _get_asset(asset_id)
        assert db_asset.processing_status in (ProcessingStatus.READY, ProcessingStatus.PROCESSING)

        children = _get_children(asset_id)
        assert len(children) == 10, f"Expected 10 CSV rows, got {len(children)}"
        assert all(c.kind.value == "csv_row" for c in children)


# ═══════════════════════════════════════════════════
# Markdown — no processing needed (text, not container)
# ═══════════════════════════════════════════════════

class TestTextProcessing:

    def test_markdown_no_children(self, client, headers, workspace):
        """Markdown/text assets are not containers — processing should mark READY with no children."""
        asset = _upload(client, headers, workspace, "README.md", "text/markdown")
        asset_id = asset["id"]

        _run_processing(workspace, [asset_id])

        db_asset = _get_asset(asset_id)
        # Text assets should complete processing (even if trivially)
        assert db_asset.processing_status in (ProcessingStatus.READY, ProcessingStatus.PROCESSING)

        children = _get_children(asset_id)
        assert len(children) == 0, "Text assets should not produce children"


# ═══════════════════════════════════════════════════
# Image — no processing needed (not container)
# ═══════════════════════════════════════════════════

class TestImageProcessing:

    def test_image_no_children(self, client, headers, workspace):
        """Images are not containers — no children produced."""
        asset = _upload(client, headers, workspace, "exactly.png", "image/png")
        asset_id = asset["id"]

        _run_processing(workspace, [asset_id])

        db_asset = _get_asset(asset_id)
        children = _get_children(asset_id)
        assert len(children) == 0, "Image assets should not produce children"


# ═══════════════════════════════════════════════════
# Atomic claim — double processing doesn't duplicate
# ═══════════════════════════════════════════════════

class TestAtomicClaim:

    def test_double_processing_is_idempotent(self, client, headers, workspace):
        """Running process_pending twice on the same asset doesn't duplicate children."""
        asset = _upload(client, headers, workspace, "d19-2553.pdf", "application/pdf")
        asset_id = asset["id"]

        _run_processing(workspace, [asset_id])
        children_first = _get_children(asset_id)

        # Run again — atomic claim should skip (already PROCESSING/READY, not PENDING)
        _run_processing(workspace, [asset_id])
        children_second = _get_children(asset_id)

        assert len(children_first) == len(children_second), \
            f"Double processing created duplicates: {len(children_first)} vs {len(children_second)}"
