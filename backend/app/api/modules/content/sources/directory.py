"""Directory source — walk a local directory tree, one RawItem per file.

A streaming generator (``os.walk``, sorted per level) that NEVER materializes the
tree — so a 150k-file import or a watched folder stays bounded. Each item carries
a cheap ``mtime:size`` change-token, so a re-poll costs O(changed), not O(corpus):
the build loop skips items whose token matches what's already ingested and only
``fetch``es the new/drifted ones. Files are not parsed here — their TYPE processes
them after the asset is built.

Two realization modes (``config["copy_mode"]``):
  • reference (default): ``blob_path`` points at the file under local storage — no copy.
  • copy: bytes are uploaded to ``managed/imports/<dataset>/<relpath>``.

Inbox mode (``config["inbox_mode"]``) adds a stability guard (skip files still
being written) and surfaces sidecar/versioning hints in metadata for the build loop.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, AsyncIterator, Dict

from app.api.modules.content.asset_builder import content_hash
from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.sources import (
    FetchedContent, Preview, RawItem, source_type, stage_blob,
)


@source_type("directory")
class FileDirectory:
    """``config = {path, dataset_name?, copy_mode?, file_extensions?, inbox_mode?, stable_seconds?}``;
    ``cursor = {last_processed_path}``."""

    async def read(self, config: dict, cursor: dict, ctx: SourceContext) -> AsyncIterator[RawItem]:
        # Uniform opener: a poll/import passes {path, ...} directly; the intake route
        # passes many via {"items": [...]}. Directory is one-dir-per-job in practice.
        for it in (config.get("items") or [config]):
            async for raw in self._read_dir(it, cursor, ctx):
                yield raw

    async def _read_dir(self, config: dict, cursor: dict, ctx: SourceContext) -> AsyncIterator[RawItem]:
        from app.api.modules.content.types import detect_asset_kind_from_extension, importable_extensions

        root = Path(config["path"]).resolve()
        dataset = config.get("dataset_name") or root.name
        copy_mode = bool(config.get("copy_mode", False))
        exts = set(config.get("file_extensions") or importable_extensions())
        # Set by the spine after each committed chunk. os.walk is ordered deterministically
        # below precisely so this resume point is meaningful — a job reclaimed after its
        # worker died picks up where it stopped instead of re-walking 150k files.
        resume_after = cursor.get("last_item")
        inbox = bool(config.get("inbox_mode", False))
        stable_before = time.time() - int(config.get("stable_seconds", 30))
        base = Path(ctx.settings.LOCAL_STORAGE_BASE_PATH).resolve()

        for dirpath, dirnames, filenames in os.walk(root):
            # Deterministic order (for resume) + drop macOS cruft.
            dirnames[:] = sorted(d for d in dirnames if d != "__MACOSX" and not d.startswith("._"))
            for name in sorted(filenames):
                if name.startswith("._"):
                    continue
                ext = os.path.splitext(name)[1].lower()
                if exts and ext not in exts:
                    continue
                abs_path = os.path.join(dirpath, name)
                if resume_after and abs_path <= resume_after:
                    continue
                try:
                    st = os.stat(abs_path)
                except OSError:
                    continue
                if inbox and st.st_mtime > stable_before:
                    continue  # still being written — wait for the next poll
                rel = os.path.relpath(abs_path, root).replace("\\", "/")
                blob_path = (
                    f"managed/imports/{dataset}/{rel}" if copy_mode
                    else os.path.relpath(abs_path, base).replace("\\", "/")
                )
                meta: Dict[str, Any] = {
                    "copy_mode": copy_mode, "blob_path": blob_path,
                    "file_size": st.st_size, "file_mtime": st.st_mtime,
                }
                if inbox:
                    meta.update(_inbox_hints(abs_path))
                yield RawItem(
                    source_identifier=blob_path,                       # stable across polls
                    kind=detect_asset_kind_from_extension(ext),
                    title=name,
                    source_token=f"{st.st_mtime:.6f}:{st.st_size}",     # cheap drift signal
                    path=os.path.dirname(rel).replace("\\", "/"),   # folder → bundle placement
                    locator=abs_path,
                    metadata=meta,
                )

    async def view(self, item: RawItem, ctx: SourceContext) -> Preview:
        return Preview(title=item.title, extra={"path": item.path, "size": item.metadata.get("file_size")})

    async def fetch(self, item: RawItem, ctx: SourceContext) -> FetchedContent:
        blob_path = item.metadata["blob_path"]
        # A blob caller hashes for itself: it holds the bytes the builder never sees.
        # Both modes go through the one derivation — bytes in copy mode, a streamed
        # Path when the file is referenced in place.
        if item.metadata.get("copy_mode"):
            data = await asyncio.to_thread(_read_bytes, item.locator)
            await stage_blob(ctx, data, blob_path, filename=item.title)
            digest = content_hash(data)
        else:
            digest = await asyncio.to_thread(content_hash, Path(item.locator))
        return FetchedContent(blob_path=blob_path, content_hash=digest,
                              metadata={"file_size": item.metadata.get("file_size")})


# ── internal helpers ───────────────────────────────────────────────────────────

def _read_bytes(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def _inbox_hints(abs_path: str) -> Dict[str, Any]:
    """Surface sidecar/versioning hints; the build loop decides version-vs-new."""
    hints: Dict[str, Any] = {"inbox_mode": True, "inbox_file_path": abs_path}
    sidecar = Path(abs_path).with_suffix(Path(abs_path).suffix + ".meta.json")
    if sidecar.exists():
        try:
            data = json.loads(sidecar.read_text())
            if data.get("supersedes"):
                hints["sidecar_supersedes"] = data["supersedes"]
            hints["sidecar"] = data
        except Exception:
            pass
    return hints


# ── Inbox (watched-folder) helpers ─────────────────────────────────────────────
# A watched inbox is just a `directory` Source with inbox_mode on; these prepare
# the folder and report what's waiting. Used by the routes/service that ensure
# the inbox Source exists.

_INBOX_README = """\
# Inbox

Drop files here to add them to the dataset.

- New files are picked up on the source's poll schedule (files still being
  written are skipped until they are stable).
- Re-dropping a changed file under the same name updates the existing asset —
  re-polls never duplicate unchanged content.
- An optional `{filename}.meta.json` sidecar (`{"supersedes": "...",
  "version_label": "..."}`) is surfaced to the UI as a version hint.
"""


def prepare_inbox_directory(source_path: Path) -> Path:
    """Create the ``_inbox`` subdirectory (README included). Returns the inbox dir."""
    inbox_dir = Path(source_path).resolve() / "_inbox"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    readme_path = inbox_dir / "README.md"
    if not readme_path.exists():
        readme_path.write_text(_INBOX_README)
    return inbox_dir


def count_inbox_pending_files(inbox_dir: Path) -> int:
    """Count importable files waiting in the inbox (sidecars excluded)."""
    try:
        from app.api.modules.content.types import importable_extensions

        exts = importable_extensions()
        return sum(
            1
            for f in inbox_dir.iterdir()
            if f.is_file() and f.suffix.lower() in exts and not f.name.endswith(".meta.json")
        )
    except OSError:
        return 0


def dataset_name_from_path(source_path: str, storage_base_path: str) -> str:
    """Dataset folder name from a path (e.g. ``data_set_1`` from ``<base>/datasets/data_set_1``)."""
    try:
        rel = Path(source_path).resolve().relative_to(Path(storage_base_path).resolve())
        return rel.parts[0] if rel.parts else Path(source_path).name
    except (ValueError, IndexError):
        return Path(source_path).name
