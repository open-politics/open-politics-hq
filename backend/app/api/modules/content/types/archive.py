"""Archive content type (zip / tar / single gzip|bzip2) — an embedded container.

An uploaded-or-fetched archive blob expands **into one bundle named after the
archive**: the archive artifact is moved inside it (kept for provenance / re-extract),
folders become nested bundles, each file becomes an asset. A nested archive is
unrolled **in the same process call** (ordinary recursion) so one user intent — "I
have this zip" — yields the FULL sub-tree in one job. Non-archive files are born
PENDING and the normal pipeline takes them (a zip-of-PDFs → PDFs → pages).

Scale + safety, **without persisting any per-asset state**:
  • Streaming — entries are read, uploaded, and built one at a time, committed in
    chunks. RAM is O(largest entry), not O(archive); the txn never holds 100k rows.
  • Bombs — two STACK-LOCAL guards on the recursion: a depth cap (cycles / silly
    nesting) and a cumulative decompressed-byte budget (the real 42.zip defense —
    depth alone never catches a wide bomb). Both die when the call returns; nothing
    is written to answer "how deep am I".

Storage stays behind the provider (read the one blob via ``read_to_path``; upload
each leaf via ``upload_from_bytes``) — no local extract dir, so it is identical on
S3 / MinIO / local. archive is a Type, never a Source: a remote archive URL is
fetched by ``web``, detected here, and expanded by this ``process``.
"""

from __future__ import annotations

import asyncio
import bz2
import gzip
import io
import logging
import os
import tarfile
import zipfile
from contextlib import closing
from typing import Any, Iterator, List, Optional, Tuple

from app.api.modules.content.asset_builder import content_hash
from app.api.modules.content.models import Asset, AssetKind, Bundle, ProcessingStatus
from app.api.modules.content.types import content_type

logger = logging.getLogger(__name__)

_MAX_ENTRY_BYTES = 256 * 1024 * 1024            # reject a single entry larger than this
_MAX_DEPTH = 32                                  # container-in-container ceiling (cycles)
_MAX_TOTAL_BYTES = 16 * 1024 * 1024 * 1024       # cumulative decompressed budget (zip-bomb backstop; tunable)
_CHUNK = 200                                     # assets per commit (bounded txn)


class _Budget:
    """A mutable cumulative-decompressed-bytes ceiling shared across the whole
    recursion. The real zip-bomb guard: depth catches cycles, this catches the
    petabyte-from-kilobytes expansion a depth cap never would. Transient — it lives
    only for one ``process()`` call and is never persisted."""

    __slots__ = ("left",)

    def __init__(self, total: int) -> None:
        self.left = total

    def allows(self, size: int) -> bool:
        return size <= self.left

    def consume(self, n: int) -> None:
        self.left -= n

    @property
    def healthy(self) -> bool:
        return self.left > 0


@content_type(
    kind=AssetKind.ARCHIVE,
    extensions={".zip", ".tar", ".tgz", ".tbz2", ".gz", ".bz2"},
    mimetypes={"application/zip", "application/x-tar", "application/gzip",
               "application/x-gzip", "application/x-bzip2"},
    is_container=True,
    category="archive",
)
class Archive:
    """zip / tar / single-compressed → a bundle of assets; nested archives recurse in-process."""

    @staticmethod
    def recognizes(head: bytes) -> bool:
        return (head.startswith(b"PK\x03\x04")      # zip
                or head.startswith(b"\x1f\x8b")       # gzip (incl .tar.gz)
                or head.startswith(b"BZh"))           # bzip2

    async def process(self, context, asset: Asset) -> List[Asset]:
        if not asset.blob_path:
            raise ValueError(f"ARCHIVE has no blob_path: asset {asset.id}")
        from app.api.modules.content.utils.storage_access import read_to_path
        from app.api.modules.content.tree import expand_into_bundle

        title = asset.title or "archive"
        bundle_id = expand_into_bundle(context.session, asset.infospace_id,
                                       asset.user_id, asset, title)   # bundle + move artifact in
        budget = _Budget(_MAX_TOTAL_BYTES)

        path, is_temp = await read_to_path(context.storage_provider, asset.blob_path)
        try:
            created, skipped = await self._unroll(
                context, str(path), title, bundle_id, depth=0, budget=budget,
                blob_prefix=f"managed/archives/{asset.id}",
                # Identity authority = the archive's asset id (unique per instance) so
                # members dedup per-position (source_identifier), never across two
                # same-named archives. The readable name lives on the bundle.
                id_prefix=f"archive://{asset.id}",
            )
        finally:
            if is_temp:
                _unlink(path)

        asset.file_info = {**(asset.file_info or {}), "entry_count": created + skipped,
                           **({} if budget.healthy else {"unexpanded": "byte_budget"})}
        context.session.add(asset)
        context.session.commit()

        # New PENDING members (PDFs, nested-but-capped archives, …) need a sweep;
        # process_pending self-queries on this. READY leaves ride the enricher schedule.
        from app.core.events import emit
        emit("asset.ingested", {"infospace_id": asset.infospace_id})
        logger.info("Unrolled ARCHIVE %s into bundle %s: %d new, %d existing%s",
                    asset.id, bundle_id, created, skipped,
                    "" if budget.healthy else " (byte budget hit — partial)")
        return []   # streamed + committed internally; nothing to hand back to process_content

    async def _unroll(self, context, src, name_hint: str, bundle_id: int, *, depth: int,
                      budget: _Budget, blob_prefix: str, id_prefix: str) -> Tuple[int, int]:
        """Stream one archive level into ``bundle_id``; recurse into nested archives
        in-process (``depth+1``). ``src`` is a path (top) or bytes (nested). Folders
        become sub-bundles; files become assets. Returns ``(created, skipped)``."""
        from app.api.modules.content.types import detect_kind, needs_processing
        from app.api.modules.content.tree import ensure_path_bundles

        memo: dict = {}     # folder-path → bundle id, this level only
        created = skipped = 0

        with closing(_iter_archive(src, name_hint)) as entries:
            for relpath, declared, read_bytes in entries:
                if declared is not None and declared > _MAX_ENTRY_BYTES:
                    logger.warning("archive: skipping oversized entry %s (%d bytes)", relpath, declared)
                    continue
                if declared is not None and not budget.allows(declared):
                    logger.warning("archive: byte budget exhausted before %s — stopping", relpath)
                    break

                data = await asyncio.to_thread(read_bytes)
                budget.consume(len(data))
                digest = content_hash(data)
                folder = os.path.dirname(relpath).replace("\\", "/")
                leaf = os.path.basename(relpath) or relpath
                target = ensure_path_bundles(context.session, bundle_id, folder,
                                             user_id=context.user_id,
                                             infospace_id=context.infospace_id, memo=memo)
                kind = detect_kind(filename=leaf, head=data[:8192])
                # Content-addressed blob: the hash subdir keeps the path collision-proof —
                # a nested zip's *artifact* file never clashes with its *contents* dir — and
                # dedups identical bytes in storage. The prefix stays constant down the
                # recursion (no per-level nesting in the blob path).
                blob = f"{blob_prefix}/{digest}/{leaf}"
                await context.storage_provider.upload_from_bytes(
                    file_bytes=data, object_name=blob, filename=leaf,
                    content_type="application/octet-stream",
                )
                position = f"{id_prefix}/{relpath}"

                if kind is AssetKind.ARCHIVE:
                    # Keep the nested artifact (READY — its contents are handled right
                    # here), then expand it in THIS call unless a guard says stop.
                    status = await _build_member(context, kind, leaf, blob=blob, digest=digest,
                                                 bundle_id=target, status=ProcessingStatus.READY,
                                                 position=position)
                    created, skipped = _tally(status, created, skipped)
                    if depth + 1 > _MAX_DEPTH or not budget.healthy:
                        logger.warning("archive: depth/budget cap at %s (depth=%d) — kept, not expanded",
                                       relpath, depth + 1)
                    else:
                        sub = _find_or_create_bundle(context, leaf, target)
                        c, s = await self._unroll(context, data, leaf, sub, depth=depth + 1,
                                                  budget=budget, blob_prefix=blob_prefix,
                                                  id_prefix=f"{id_prefix}/{leaf}")
                        created += c
                        skipped += s
                else:
                    pstatus = (ProcessingStatus.PENDING if needs_processing(kind)
                               else ProcessingStatus.READY)
                    status = await _build_member(context, kind, leaf, blob=blob, digest=digest,
                                                 bundle_id=target, status=pstatus, position=position)
                    created, skipped = _tally(status, created, skipped)

                del data
                if (created + skipped) % _CHUNK == 0:
                    context.session.commit()
                if not budget.healthy:
                    logger.warning("archive: byte budget exhausted after %s — stopping", relpath)
                    break

        context.session.commit()
        return created, skipped

    def preview(self, asset: Asset, children: Optional[List[Asset]] = None) -> dict:
        return {"entry_count": (asset.file_info or {}).get("entry_count", 0)}


# ── helpers ─────────────────────────────────────────────────────────────────────

def _tally(status: str, created: int, skipped: int) -> Tuple[int, int]:
    if status == "created":
        return created + 1, skipped
    if status == "skipped":
        return created, skipped + 1
    return created, skipped


def _find_or_create_bundle(context, name: str, parent_id: int) -> int:
    """Find-or-create the bundle named ``name`` under ``parent_id`` (idempotent across
    reprocess / re-encountered folders). Delegates to the shared placement primitive."""
    from app.api.modules.content.tree import find_or_create_child_bundle
    return find_or_create_child_bundle(
        context.session, context.infospace_id, context.user_id,
        name=name, parent_id=parent_id,
    ).id


async def _build_member(context, kind: AssetKind, title: str, *, blob: str, digest: str,
                        bundle_id: int, status: ProcessingStatus, position: str) -> str:
    """Build one archive member as a bundle member (parent_asset_id NULL — a standalone
    document, not an intrinsic part). Dedup on its **position** (``archive://<id>/<relpath>``
    as ``source_identifier``), so a reprocess skips it but two identical-content files in
    different folders stay distinct; the blob is content-addressed. Returns the BuildOutcome
    status."""
    from app.api.modules.content.asset_builder import AssetBuilder

    builder = (
        AssetBuilder(context.session, context.user_id, context.infospace_id)
        .as_kind(kind).with_title(title)
        .with_source(position).dedup_on(source_identifier=position).on_match("skip")
        .with_blob(blob, digest)
        .with_processing_status(status)
        .with_metadata(archive_member=True)
        .into_bundle(bundle_id)
    )
    return (await builder.build()).status


def _iter_archive(src: Any, name_hint: str) -> Iterator[Tuple[str, Optional[int], Any]]:
    """Yield ``(relpath, declared_uncompressed_size | None, read_bytes)`` for each real
    file, **lazily** — the archive stays open across yields and the consumer calls
    ``read_bytes`` one entry at a time (RAM = one entry). Skips dirs, macOS cruft, and
    path-traversal. ``src`` = a filesystem path (top) or raw bytes (a nested archive)."""
    fobj = io.BytesIO(src) if isinstance(src, (bytes, bytearray)) else open(src, "rb")
    try:
        fobj.seek(0)
        if zipfile.is_zipfile(fobj):
            fobj.seek(0)
            with zipfile.ZipFile(fobj) as zf:
                for info in zf.infolist():
                    if info.is_dir() or not _safe(info.filename):
                        continue
                    yield info.filename, info.file_size, (lambda i=info: zf.read(i))
            return
        fobj.seek(0)
        if tarfile.is_tarfile(fobj):
            fobj.seek(0)
            with tarfile.open(fileobj=fobj) as tf:
                for m in tf.getmembers():
                    if not m.isfile() or not _safe(m.name):
                        continue
                    yield m.name, m.size, (lambda mm=m, tt=tf: _tar_read(tt, mm))
            return
        # Single compressed stream (.gz / .bz2 that is not a tar) → exactly one entry.
        fobj.seek(0)
        raw = fobj.read()
        head = raw[:3]
        if head[:2] == b"\x1f\x8b":
            decomp = gzip.decompress
        elif head[:3] == b"BZh":
            decomp = bz2.decompress
        else:
            raise ValueError("Unsupported archive format (expected zip, tar, gzip, or bzip2)")
        yield _strip_compress_suffix(name_hint), None, (lambda: decomp(raw))
    finally:
        try:
            fobj.close()
        except Exception:
            pass


def _tar_read(tf: tarfile.TarFile, member: tarfile.TarInfo) -> bytes:
    f = tf.extractfile(member)
    return f.read() if f is not None else b""


def _strip_compress_suffix(name: str) -> str:
    stem = (name or "file").rsplit("/", 1)[-1]
    for suf in (".tar.gz", ".tar.bz2", ".tgz", ".tbz2", ".gz", ".bz2"):
        if stem.lower().endswith(suf):
            return stem[: -len(suf)] or "file"
    return stem or "file"


def _safe(name: str) -> bool:
    """Reject path-traversal ('zip slip') and macOS cruft."""
    base = os.path.basename(name)
    if "__MACOSX" in name or base.startswith("._") or base == ".DS_Store":
        return False
    norm = os.path.normpath(name)
    return not (norm.startswith("/") or norm.startswith(".."))


def _unlink(path) -> None:
    try:
        path.unlink()
    except OSError:
        pass
