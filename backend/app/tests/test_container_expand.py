"""Container expand — archive zip-unroll + feed-document expand, end-to-end on a real DB.

These run the actual pipeline (``item_processing`` → ``process_content`` → the type's
``process``) against Postgres + real storage, the deferred "live verify" for incr-3/4:

  • An ARCHIVE asset expands INTO A BUNDLE named after the zip: folders become sub-bundles,
    a nested zip is unrolled in the same process call (its own sub-bundle), files become
    bundle MEMBERS (parent_asset_id NULL — standalone docs, not intrinsic parts), and the
    zip artifact is moved inside its contents bundle. Storage goes through the provider.
  • An RSS_FEED asset expands into a bundle of inline-content ARTICLE members.

Run with the celery_worker STOPPED so ``_run_processing`` owns the asset claim.
"""
from __future__ import annotations

import asyncio
import io
import zipfile

import pytest
from sqlalchemy import text
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.api.modules.content.models import Asset, AssetKind, Bundle, ProcessingStatus
from app.api.modules.content.tasks.processing import item_processing
from app.core.tasks import TaskContext


@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    return infospace_factory("Container Expand Tests", user_id)


# ─── harness ─────────────────────────────────────────────────────────────────

def _loop():
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop


def _stage_blob(object_name: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    from app.api.modules.foundation_service_providers import resolve
    storage = resolve("storage")
    _loop().run_until_complete(storage.upload_from_bytes(
        file_bytes=data, object_name=object_name,
        filename=object_name.rsplit("/", 1)[-1], content_type=content_type,
    ))
    return object_name


def _make_asset(user_id: int, workspace: int, *, title, kind, blob_path) -> int:
    with Session(engine) as s:
        a = Asset(title=title, kind=kind, user_id=user_id, infospace_id=workspace,
                  blob_path=blob_path, bundle_ids=[0], processing_status=ProcessingStatus.PENDING)
        s.add(a)
        s.commit()
        s.refresh(a)
        return a.id


def _run_processing(infospace_id: int, asset_ids: list[int]):
    _loop()
    item_processing(TaskContext(infospace_id=infospace_id, settings=settings, task_name="item_processing"), asset_ids)


def _bundle(session: Session, infospace_id: int, name: str, parent_id: int | None = None) -> Bundle | None:
    stmt = select(Bundle).where(Bundle.infospace_id == infospace_id, Bundle.name == name)
    if parent_id is not None:
        stmt = stmt.where(Bundle.parent_bundle_id == parent_id)
    return session.exec(stmt).first()


def _members(session: Session, infospace_id: int, bundle_id: int) -> list[Asset]:
    return list(session.exec(
        select(Asset).where(
            Asset.infospace_id == infospace_id,
            Asset.parent_asset_id.is_(None),
            text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id),
        )
    ).all())


# ─── archive ─────────────────────────────────────────────────────────────────

def _nested_zip() -> bytes:
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as z:
        z.writestr("deep.txt", b"deep content")
    outer = io.BytesIO()
    with zipfile.ZipFile(outer, "w") as z:
        z.writestr("report.txt", b"top level report")
        z.writestr("docs/memo.txt", b"a memo in a folder")
        z.writestr("inner.zip", inner.getvalue())
    return outer.getvalue()


def test_archive_unrolls_into_bundle_tree(user_id, workspace):
    """zip → a bundle named after it: report.txt at top, docs/ sub-bundle, inner.zip
    unrolled in-process into its own sub-bundle, the zip artifact moved inside."""
    blob = _stage_blob(f"managed/test/{workspace}/outer.zip", _nested_zip(), "application/zip")
    aid = _make_asset(user_id, workspace, title="outer.zip", kind=AssetKind.ARCHIVE, blob_path=blob)

    _run_processing(workspace, [aid])

    with Session(engine) as s:
        archive = s.get(Asset, aid)
        assert archive.processing_status == ProcessingStatus.READY
        assert archive.blob_path == blob, "zip artifact blob kept"

        outer_b = _bundle(s, workspace, "outer.zip", parent_id=0)
        assert outer_b is not None, "contents bundle named after the zip, under ROOT"
        assert archive.bundle_ids == [outer_b.id], "artifact moved INTO its contents bundle"

        names = {a.title: a for a in _members(s, workspace, outer_b.id)}
        assert "report.txt" in names, f"top-level file is a bundle member; got {list(names)}"
        assert names["report.txt"].parent_asset_id is None, "members are standalone, not children"
        assert names["report.txt"].content_hash, "member carries a content hash"
        assert names["report.txt"].source_identifier == f"archive://{aid}/report.txt", \
            "member identity = its position (dedup key)"
        assert "inner.zip" in names and names["inner.zip"].kind == AssetKind.ARCHIVE
        assert names["inner.zip"].processing_status == ProcessingStatus.READY, "nested zip kept, not re-queued"

        docs_b = _bundle(s, workspace, "docs", parent_id=outer_b.id)
        assert docs_b is not None, "internal folder became a sub-bundle"
        assert {a.title for a in _members(s, workspace, docs_b.id)} == {"memo.txt"}

        inner_b = _bundle(s, workspace, "inner.zip", parent_id=outer_b.id)
        assert inner_b is not None, "nested archive unrolled into its own sub-bundle (same process)"
        assert {a.title for a in _members(s, workspace, inner_b.id)} == {"deep.txt"}


# ─── feed ────────────────────────────────────────────────────────────────────

_FEED = b"""<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <item><title>Article One</title><link>http://ex.com/1</link>
        <description>Body of article one</description><guid>http://ex.com/1</guid></item>
  <item><title>Article Two</title><link>http://ex.com/2</link>
        <description>Body of article two</description><guid>http://ex.com/2</guid></item>
</channel></rss>"""


def test_feed_expands_into_inline_content_articles(user_id, workspace):
    """A fetched feed file → a bundle named after the feed, holding ARTICLE members that
    carry the feed's inline content (no re-scrape)."""
    blob = _stage_blob(f"managed/test/{workspace}/feed.xml", _FEED, "application/rss+xml")
    aid = _make_asset(user_id, workspace, title="feed.xml", kind=AssetKind.RSS_FEED, blob_path=blob)

    _run_processing(workspace, [aid])

    with Session(engine) as s:
        feed = s.get(Asset, aid)
        assert feed.processing_status == ProcessingStatus.READY

        feed_b = _bundle(s, workspace, "Test Feed", parent_id=0)
        assert feed_b is not None, "bundle named after the feed title"
        assert feed.bundle_ids == [feed_b.id], "feed artifact moved into its bundle"

        members = {a.title: a for a in _members(s, workspace, feed_b.id) if a.kind == AssetKind.ARTICLE}
        assert set(members) == {"Article One", "Article Two"}, f"got {list(members)}"
        assert members["Article One"].text_content == "Body of article one", "inline content, not a bare stub"
        assert members["Article One"].parent_asset_id is None, "articles are members, not children"


# ─── ingest dedup (the "URLs over and over" fix) ──────────────────────

def test_directory_repoll_skips_unchanged(user_id, workspace):
    """A second poll of an unchanged source re-ingests NOTHING — the read→guard→skip
    path (source_token unchanged → skip). This is the inverse of the dedup defect."""
    import os
    from app.models import IngestionJob, IngestionStatus
    from app.api.modules.content.tasks.ingestion import ingest

    d = os.path.join(settings.LOCAL_STORAGE_BASE_PATH, f"dedup_test_{workspace}")
    os.makedirs(d, exist_ok=True)
    for name in ("a.txt", "b.txt"):
        with open(os.path.join(d, name), "w") as fh:
            fh.write(f"content of {name}")

    def _mint() -> int:
        with Session(engine) as s:
            j = IngestionJob(infospace_id=workspace, user_id=user_id, kind="directory",
                             status=IngestionStatus.PENDING, source_locator=d,
                             cursor_state={"config": {"path": d, "copy_mode": False}})
            s.add(j)
            s.commit()
            s.refresh(j)
            return j.id

    def _run(jid: int):
        ingest(TaskContext(infospace_id=workspace, settings=settings, task_name="ingest"), [jid])

    def _counts(jid: int) -> dict:
        with Session(engine) as s:
            return (s.get(IngestionJob, jid).cursor_state or {}).get("counts", {})

    j1 = _mint()
    _run(j1)
    assert _counts(j1).get("created") == 2, f"first poll creates 2; got {_counts(j1)}"

    j2 = _mint()
    _run(j2)                                  # re-poll, same folder, files unchanged
    c2 = _counts(j2)
    assert c2.get("created", 0) == 0 and c2.get("skipped") == 2, f"re-poll must skip 2; got {c2}"
