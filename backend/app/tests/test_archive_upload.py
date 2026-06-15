"""
Upload → nested Bundle tree tests (async intake contract).

POST /infospaces/{iid}/assets/bulk-upload-background stages files and mints ONE
``upload`` IngestionJob (response: ``{jobs, job_ids, root_bundle_id}``). The
harness drives ``ingest`` (and ``item_processing`` where a type must expand)
in-process — exactly what the worker does — then asserts the built tree:

  - Nested folder drop → folder paths become bundles at acquire (ensure_path_bundles)
  - Folder-with-zip drop → the zip rides in as an ARCHIVE asset; the ARCHIVE type
    dissolves it into a bundle named after the artifact (artifact kept inside)
  - Flat drop + bundle_name → destination bundle created at the route
  - Drop into existing bundle via parent_bundle_id
  - Zip-slip entries are never extracted
  - Mixed flat + with-paths drop

Run with the celery worker STOPPED — the harness owns the job/asset claims.
"""
import io
import zipfile
from typing import Optional

import pytest
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.models import Asset, Bundle


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    """Dedicated infospace — auto-deleted on teardown."""
    return infospace_factory("Upload Tree Tests", user_id)


@pytest.fixture
def sample_zip_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("one.txt", "hello one\n")
        zf.writestr("two.txt", "hello two\n")
        zf.writestr("nested/three.txt", "nested three\n")
    return buf.getvalue()


@pytest.fixture
def zip_slip_bytes() -> bytes:
    """Malicious zip attempting path traversal via '../' entry."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("../../etc/evil.txt", "should not be extracted\n")
    return buf.getvalue()


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _drive(workspace: int, job_ids: list[int], *, process: bool = False):
    """Run ``ingest`` (and optionally ``item_processing``) in-process."""
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
        from app.api.modules.content.models import ProcessingStatus
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


def _bundle_by(infospace_id: int, name: str, parent_id: Optional[int] = None) -> Optional[Bundle]:
    with Session(engine) as s:
        stmt = select(Bundle).where(
            Bundle.infospace_id == infospace_id, Bundle.name == name,
        )
        if parent_id is not None:
            stmt = stmt.where(Bundle.parent_bundle_id == parent_id)
        b = s.exec(stmt).first()
        if b:
            s.expunge(b)
        return b


def _assets_in_bundle(bundle_id: int) -> list[Asset]:
    with Session(engine) as s:
        result = list(s.exec(
            select(Asset).where(Asset.bundle_ids.contains([bundle_id]))  # type: ignore[attr-defined]
        ).all())
        for a in result:
            s.expunge(a)
        return result


def _upload(client, headers, infospace_id, *, files, relative_paths=None,
            bundle_name=None, parent_bundle_id=None):
    multipart_files = [("files", f) for f in files]
    # httpx quirk: when files= is present, data= must be a dict (with list values for
    # multi-value fields). List-of-tuples form breaks multipart encoding here.
    data: dict = {}
    if relative_paths is not None:
        data["relative_paths"] = list(relative_paths)
    if bundle_name is not None:
        data["bundle_name"] = bundle_name
    if parent_bundle_id is not None:
        data["parent_bundle_id"] = str(parent_bundle_id)
    return client.post(
        f"{settings.API_V1_STR}/infospaces/{infospace_id}/assets/bulk-upload-background",
        headers=headers,
        files=multipart_files,
        data=data,
    )


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestBulkUpload:
    def test_nested_folder_drop_builds_bundle_tree(self, client, headers, workspace):
        """Drop reports/readme.md + reports/2024/q1.pdf → root 'reports' + child '2024'."""
        files = [
            ("readme.md", b"top-level readme\n", "text/markdown"),
            ("q1.pdf", b"%PDF-1.4\n%fake pdf\n", "application/pdf"),
        ]
        r = _upload(
            client, headers, workspace,
            files=files,
            relative_paths=["reports/readme.md", "reports/2024/q1.pdf"],
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        body = r.json()
        assert body["job_ids"], body
        _drive(workspace, body["job_ids"])

        reports = _bundle_by(workspace, "reports", parent_id=0)
        assert reports is not None, "root folder became a top-level bundle"
        y2024 = _bundle_by(workspace, "2024", parent_id=reports.id)
        assert y2024 is not None, "nested folder became a child bundle"

        assert any("readme" in (a.title or "") for a in _assets_in_bundle(reports.id))
        assert any("q1" in (a.title or "") for a in _assets_in_bundle(y2024.id))

    def test_folder_with_zip_dissolves_zip_into_tree(self, client, headers, workspace, sample_zip_bytes):
        """Drop folder containing a zip → the ARCHIVE type unrolls it into a bundle
        named after the artifact; the artifact lives inside its contents bundle."""
        files = [
            ("notes.txt", b"root notes\n", "text/plain"),
            ("data.zip", sample_zip_bytes, "application/zip"),
        ]
        r = _upload(
            client, headers, workspace,
            files=files,
            relative_paths=["proj/notes.txt", "proj/data.zip"],
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        _drive(workspace, r.json()["job_ids"], process=True)

        proj = _bundle_by(workspace, "proj", parent_id=0)
        assert proj is not None
        zip_b = _bundle_by(workspace, "data.zip", parent_id=proj.id)
        assert zip_b is not None, "zip unrolled into a bundle named after the artifact"
        nested_b = _bundle_by(workspace, "nested", parent_id=zip_b.id)
        assert nested_b is not None, "zip-internal folder became a sub-bundle"

        zip_members = {a.title for a in _assets_in_bundle(zip_b.id)}
        assert {"one.txt", "two.txt", "data.zip"} <= zip_members, zip_members
        assert {a.title for a in _assets_in_bundle(nested_b.id)} == {"three.txt"}
        assert any("notes" in (a.title or "") for a in _assets_in_bundle(proj.id))

    def test_flat_drop_with_bundle_name(self, client, headers, workspace):
        """Flat files with bundle_name → destination bundle created at the route,
        flat assets inside after the job runs."""
        files = [
            ("a.txt", b"a\n", "text/plain"),
            ("b.txt", b"b\n", "text/plain"),
            ("c.txt", b"c\n", "text/plain"),
        ]
        r = _upload(
            client, headers, workspace,
            files=files,
            bundle_name="flat_test",
        )
        assert r.status_code == 200, r.text[:400]
        body = r.json()
        assert body["root_bundle_id"], "destination bundle resolved at the route"
        flat = _bundle_by(workspace, "flat_test", parent_id=0)
        assert flat is not None and flat.id == body["root_bundle_id"]

        _drive(workspace, body["job_ids"])
        assert len(_assets_in_bundle(flat.id)) == 3

    def test_drop_into_existing_bundle(self, client, headers, workspace):
        """parent_bundle_id → subbundles nest under it, no new root created."""
        r0 = client.post(
            f"{settings.API_V1_STR}/infospaces/{workspace}/bundles",
            headers=headers,
            json={"name": "pre_existing_parent"},
        )
        assert r0.status_code == 201, r0.text[:300]
        parent_id = r0.json()["id"]

        files = [
            ("inside.txt", b"inside\n", "text/plain"),
        ]
        r = _upload(
            client, headers, workspace,
            files=files,
            relative_paths=["sub/deep/inside.txt"],
            parent_bundle_id=parent_id,
        )
        assert r.status_code == 200, r.text[:400]
        assert r.json()["root_bundle_id"] == parent_id
        _drive(workspace, r.json()["job_ids"])

        sub = _bundle_by(workspace, "sub", parent_id=parent_id)
        assert sub is not None, "'sub' nests under the pre-existing parent"
        deep = _bundle_by(workspace, "deep", parent_id=sub.id)
        assert deep is not None, "'deep' nests under 'sub'"
        assert any("inside" in (a.title or "") for a in _assets_in_bundle(deep.id))

    def test_zip_slip_rejected(self, client, headers, workspace, zip_slip_bytes):
        """Crafted zip with '../' entry → the traversal entry is never extracted."""
        files = [
            ("evil.zip", zip_slip_bytes, "application/zip"),
        ]
        r = _upload(
            client, headers, workspace,
            files=files,
            bundle_name="slip_test",
        )
        assert r.status_code == 200, r.text[:400]
        _drive(workspace, r.json()["job_ids"], process=True)

        with Session(engine) as s:
            evil = s.exec(
                select(Asset).where(
                    Asset.infospace_id == workspace,
                    Asset.title == "evil.txt",
                )
            ).first()
        assert evil is None, "zip-slip entry must never become an asset"
        assert _bundle_by(workspace, "etc") is None, "no traversal-path bundles"

    def test_mixed_flat_and_with_paths(self, client, headers, workspace):
        """Some items flat, some with paths — flat ones land in the named root bundle;
        nested ones build their subtree under it."""
        files = [
            ("root_file.txt", b"root\n", "text/plain"),
            ("deep.txt", b"deep\n", "text/plain"),
        ]
        r = _upload(
            client, headers, workspace,
            files=files,
            relative_paths=["root_file.txt", "sub/deep.txt"],
            bundle_name="mixed_root",
        )
        assert r.status_code == 200, r.text[:400]
        _drive(workspace, r.json()["job_ids"])

        root = _bundle_by(workspace, "mixed_root", parent_id=0)
        assert root is not None
        sub = _bundle_by(workspace, "sub", parent_id=root.id)
        assert sub is not None

        assert any("root_file" in (a.title or "") for a in _assets_in_bundle(root.id))
        assert any("deep" in (a.title or "") for a in _assets_in_bundle(sub.id))

    def test_single_common_top_folder_inferred(self, client, headers, workspace):
        """All paths share one top folder + no bundle_name → that folder becomes a
        top-level bundle (folders ARE bundles — no inference step needed)."""
        files = [
            ("a.txt", b"a\n", "text/plain"),
            ("b.txt", b"b\n", "text/plain"),
        ]
        r = _upload(
            client, headers, workspace,
            files=files,
            relative_paths=["auto_root/a.txt", "auto_root/b.txt"],
        )
        assert r.status_code == 200, r.text[:400]
        _drive(workspace, r.json()["job_ids"])

        auto = _bundle_by(workspace, "auto_root", parent_id=0)
        assert auto is not None
        assert {a.title for a in _assets_in_bundle(auto.id)} == {"a.txt", "b.txt"}
