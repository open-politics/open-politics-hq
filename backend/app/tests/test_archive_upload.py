"""
Upload → nested Bundle tree tests.

Covers POST /infospaces/{iid}/assets/bulk-upload-background with relative_paths,
bundle_name, parent_bundle_id. Exercises:
  - Nested folder drop (tree-building)
  - Folder-with-zip drop (zip pre-pass, zip dissolves)
  - Flat drop + bundle_name
  - Drop into existing bundle via parent_bundle_id
  - Zip-slip rejected
  - Mixed flat + with-paths drop
"""
import io
import zipfile
import struct
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

def _get_bundle(bundle_id: int) -> Optional[Bundle]:
    with Session(engine) as s:
        b = s.get(Bundle, bundle_id)
        if b:
            s.expunge(b)
        return b


def _children_bundles(parent_id: int, infospace_id: int) -> list[Bundle]:
    with Session(engine) as s:
        result = list(s.exec(
            select(Bundle).where(
                Bundle.parent_bundle_id == parent_id,
                Bundle.infospace_id == infospace_id,
            )
        ).all())
        for b in result:
            s.expunge(b)
        return result


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
        assert len(body["tasks"]) == 2
        assert all(t["status"] in ("queued", "complete") for t in body["tasks"]), body["tasks"]

        # One new root bundle 'reports' + one child '2024'
        bundles_created = body["bundles_created"]
        assert len(bundles_created) == 2
        roots = [b for b in bundles_created if b["parent_bundle_id"] in (None, 0)]
        assert len(roots) == 1 and roots[0]["name"] == "reports"
        children = [b for b in bundles_created if b["parent_bundle_id"] == roots[0]["id"]]
        assert len(children) == 1 and children[0]["name"] == "2024"

        # Asset placement
        readme_assets = _assets_in_bundle(roots[0]["id"])
        assert any("readme" in (a.title or "") for a in readme_assets)
        q1_assets = _assets_in_bundle(children[0]["id"])
        assert any("q1" in (a.title or "") for a in q1_assets)

    def test_folder_with_zip_dissolves_zip_into_tree(self, client, headers, workspace, sample_zip_bytes):
        """Drop folder containing a zip → zip stem becomes a sub-bundle; zip not retained."""
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
        body = r.json()

        # Bundle names should include 'proj', 'data', 'nested' (from zip's nested/ dir)
        names = [b["name"] for b in body["bundles_created"]]
        assert "proj" in names
        assert "data" in names
        assert "nested" in names

        # Zip itself must not be an asset
        zip_titles = [t for t in body["tasks"] if t["filename"] == "data.zip"]
        assert not zip_titles, f"data.zip should have been extracted, not kept as asset: {zip_titles}"

        # Expect 4 real file assets: notes.txt, one.txt, two.txt, three.txt
        file_task_names = sorted(t["filename"] for t in body["tasks"] if t["status"] != "failed")
        assert set(file_task_names) == {"notes.txt", "one.txt", "three.txt", "two.txt"}, file_task_names

    def test_flat_drop_with_bundle_name(self, client, headers, workspace):
        """Flat files with bundle_name → one bundle, flat assets inside."""
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
        assert len(body["tasks"]) == 3
        assert all(t["status"] in ("queued", "complete") for t in body["tasks"])
        assert len(body["bundles_created"]) == 1
        assert body["bundles_created"][0]["name"] == "flat_test"
        assert body["bundles_created"][0]["parent_bundle_id"] in (None, 0)
        # All 3 assets in the new bundle
        bid = body["bundles_created"][0]["id"]
        assert len(_assets_in_bundle(bid)) == 3

    def test_drop_into_existing_bundle(self, client, headers, workspace):
        """parent_bundle_id → subbundles nest under it, no new root created."""
        # First create a bundle directly
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
        body = r.json()

        # bundles_created should NOT include the pre-existing parent
        created_ids = {b["id"] for b in body["bundles_created"]}
        assert parent_id not in created_ids

        # 'sub' should be a child of parent_id; 'deep' a child of 'sub'
        sub = next(b for b in body["bundles_created"] if b["name"] == "sub")
        deep = next(b for b in body["bundles_created"] if b["name"] == "deep")
        assert sub["parent_bundle_id"] == parent_id
        assert deep["parent_bundle_id"] == sub["id"]

        # Asset lives in 'deep'
        assets = _assets_in_bundle(deep["id"])
        assert any("inside" in (a.title or "") for a in assets)

    def test_zip_slip_rejected(self, client, headers, workspace, zip_slip_bytes):
        """Crafted zip with '../' entry → 400, no extraction."""
        files = [
            ("evil.zip", zip_slip_bytes, "application/zip"),
        ]
        r = _upload(
            client, headers, workspace,
            files=files,
            bundle_name="slip_test",
        )
        assert r.status_code == 400, f"Expected 400 for zip-slip, got {r.status_code}: {r.text[:300]}"
        assert "escape" in r.text.lower() or "extract" in r.text.lower()

    def test_mixed_flat_and_with_paths(self, client, headers, workspace):
        """Some items flat, some with paths — flat ones land in root bundle; nested ones build their subtree."""
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
        body = r.json()

        root = next(b for b in body["bundles_created"] if b["name"] == "mixed_root")
        sub = next(b for b in body["bundles_created"] if b["name"] == "sub")
        assert sub["parent_bundle_id"] == root["id"]

        # root_file.txt in root, deep.txt in sub
        root_assets = _assets_in_bundle(root["id"])
        sub_assets = _assets_in_bundle(sub["id"])
        assert any("root_file" in (a.title or "") for a in root_assets)
        assert any("deep" in (a.title or "") for a in sub_assets)

    def test_single_common_top_folder_inferred(self, client, headers, workspace):
        """All paths share one top folder + no bundle_name → that folder becomes root."""
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
        body = r.json()
        assert len(body["bundles_created"]) == 1
        assert body["bundles_created"][0]["name"] == "auto_root"
