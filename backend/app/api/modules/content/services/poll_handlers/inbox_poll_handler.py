"""
Inbox Poll Handler
==================

Watches a small ``_inbox/`` directory for new files. When files appear:

1. **Sidecar match** — ``{name}.meta.json`` declares what the file supersedes.
2. **Filename match** — Same filename exists in the dataset bundle → auto-version.
3. **Hash dedup** — Same content hash already in the bundle → skip (duplicate).
4. **Stem match** — Filename stem partially matches → flag for user confirmation.
5. **New asset** — No match at all → import as brand-new asset.

Files that are still being written (mtime < 30 s ago) are skipped and retried
on the next poll.  Processed files move to ``_inbox/_processed/{iso-date}/``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import text
from sqlmodel import select

from app.models import Asset, AssetKind, Bundle, ProcessingStatus, Source
from app.api.modules.content.handlers.base import IngestionContext
from app.api.modules.content.types import (
    detect_asset_kind_from_extension,
    importable_extensions,
)
from . import PollResult, register_poll_handler

logger = logging.getLogger(__name__)

_INBOX_README = """\
# Version Inbox

Drop files here to add them to the dataset.

**Automatic version detection:**
- Files with the same name as an existing asset are treated as new versions.
- Add a `{filename}.meta.json` sidecar to explicitly declare what a file supersedes:

```json
{{
  "supersedes": "relative/path/to/old_document.pdf",
  "reason": "Less redacted version",
  "version_label": "v2"
}}
```

- Duplicate files (same content hash) are automatically skipped.
- Files with a version-like suffix (e.g. `report_v2.pdf`) are flagged as
  potential versions of `report.pdf` for confirmation in the UI.

**Processing:**
- Files are checked every 15 minutes (configurable via inbox_interval_seconds).
- After import, files are moved to `_processed/{date}/`.
"""


def prepare_inbox_directory(source_path: Path) -> Path:
    """Create _inbox subdirectory and README if needed. Returns inbox dir path."""
    inbox_dir = Path(source_path).resolve() / "_inbox"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    readme_path = inbox_dir / "README.md"
    if not readme_path.exists():
        readme_path.write_text(_INBOX_README)
    return inbox_dir


def count_inbox_pending_files(inbox_dir: Path) -> int:
    """Count importable files in inbox (excluding .meta.json sidecars)."""
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


_STABILITY_SECONDS = 30
_VERSION_SUFFIX_RE = re.compile(
    r"^(?P<stem>.+?)(?:[-_ ]?v\d+|[-_ ]\d{4}[-]\d{2}[-]\d{2})$",
    re.IGNORECASE,
)


def _compute_sha256(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _parse_sidecar(file_path: Path) -> Optional[Dict[str, Any]]:
    """Read ``{filename}.meta.json`` sidecar, returning parsed dict or None."""
    sidecar_path = file_path.parent / f"{file_path.name}.meta.json"
    if not sidecar_path.exists():
        return None
    try:
        with open(sidecar_path) as f:
            data = json.load(f)
        if not isinstance(data, dict):
            logger.warning("Sidecar %s is not a JSON object, ignoring", sidecar_path)
            return None
        return data
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Invalid sidecar %s: %s", sidecar_path, exc)
        return None


def _strip_version_suffix(stem: str) -> Optional[str]:
    """If *stem* ends with a version-like suffix, return the base stem."""
    m = _VERSION_SUFFIX_RE.match(stem)
    return m.group("stem") if m else None


@register_poll_handler("directory_inbox")
class InboxPollHandler:
    """Poll handler for ``_inbox/`` directories with smart version detection."""

    # ------------------------------------------------------------------ #
    #  Public interface (PollHandler protocol)
    # ------------------------------------------------------------------ #

    async def poll(
        self,
        source: Source,
        context: IngestionContext,
        runtime_options: Optional[Dict[str, Any]] = None,
    ) -> PollResult:
        inbox_path = Path(source.details["inbox_path"])
        bundle_id = source.output_bundle_id
        if not bundle_id:
            raise ValueError("Inbox source has no output_bundle_id")

        if not inbox_path.exists():
            logger.warning("Inbox directory does not exist: %s", inbox_path)
            return PollResult(summary="Inbox directory missing")

        bundle = context.session.get(Bundle, bundle_id)
        if not bundle:
            raise ValueError(f"Bundle {bundle_id} not found")

        stable_files = list(self._stable_files(inbox_path))
        if not stable_files:
            return PollResult(summary="No new files in inbox")

        # Per-file lookups (O(inbox)) instead of loading full bundle indexes (O(bundle)).
        # Tracks assets created this poll so subsequent files can see them.
        created_this_poll: Dict[str, Asset] = {}  # filename -> Asset
        hashes_this_poll: Set[str] = set()

        created: List[Asset] = []
        skipped = 0

        for file_path in stable_files:
            result = self._process_file(
                file_path=file_path,
                context=context,
                source=source,
                bundle=bundle,
                created_this_poll=created_this_poll,
                hashes_this_poll=hashes_this_poll,
            )
            if result is None:
                skipped += 1
            else:
                created.append(result)
                if result.blob_path:
                    created_this_poll[file_path.name] = result
                if result.content_hash:
                    hashes_this_poll.add(result.content_hash)

        # Defer file moves until after DB commit succeeds (avoids data loss
        # if the commit fails — files would be gone from inbox with no assets)
        processed_dir = inbox_path / "_processed" / datetime.now(timezone.utc).strftime("%Y-%m-%d")
        files_to_move = list(stable_files)

        def _do_move():
            if files_to_move:
                processed_dir.mkdir(parents=True, exist_ok=True)
            for fp in files_to_move:
                self._move_to_processed(fp, processed_dir)

        summary_parts = []
        if created:
            summary_parts.append(f"{len(created)} imported")
        if skipped:
            summary_parts.append(f"{skipped} duplicates skipped")
        summary = ", ".join(summary_parts) or "nothing to do"

        return PollResult(
            assets=created,
            cursor_update={"last_inbox_scan": datetime.now(timezone.utc).isoformat()},
            summary=summary,
            post_commit_actions=[_do_move],
        )

    # ------------------------------------------------------------------ #
    #  File enumeration
    # ------------------------------------------------------------------ #

    def _stable_files(self, inbox_path: Path):
        """Yield files whose mtime is old enough to not be mid-write."""
        cutoff = time.time() - _STABILITY_SECONDS
        importable = importable_extensions()
        for entry in sorted(inbox_path.iterdir(), key=lambda p: p.stat().st_mtime):
            if entry.name.startswith(".") or entry.name == "_processed":
                continue
            if entry.name.endswith(".meta.json"):
                continue
            if not entry.is_file():
                continue
            if entry.suffix.lower() not in importable:
                continue
            try:
                if entry.stat().st_mtime < cutoff:
                    yield entry
            except OSError:
                continue

    # ------------------------------------------------------------------ #
    #  Per-file processing with layered version detection
    # ------------------------------------------------------------------ #

    def _process_file(
        self,
        *,
        file_path: Path,
        context: IngestionContext,
        source: Source,
        bundle: Bundle,
        created_this_poll: Dict[str, Asset],
        hashes_this_poll: Set[str],
    ) -> Optional[Asset]:
        """
        Process one inbox file. Returns a new Asset, or None if skipped.
        Uses per-file DB queries (O(1) each) instead of preloaded bundle indexes.
        """
        sidecar = _parse_sidecar(file_path)
        file_hash = _compute_sha256(file_path)

        # --- Layer 1: Explicit sidecar with supersedes ---
        if sidecar and sidecar.get("supersedes"):
            old_asset = self._resolve_by_blob_path(
                context, bundle.id, sidecar["supersedes"]
            )
            if old_asset:
                return self._create_version_asset(
                    file_path, file_hash, context, source, bundle,
                    old_asset=old_asset, sidecar=sidecar,
                )
            else:
                logger.warning(
                    "Sidecar supersedes target not found: %s (importing as new)",
                    sidecar["supersedes"],
                )
                # Fall through to create as new asset, store unresolved ref

        # --- Layer 2: Exact filename match (DB + same-poll) ---
        existing_by_name = created_this_poll.get(file_path.name)
        if not existing_by_name:
            existing_by_name = self._find_by_filename(context, bundle.id, context.infospace_id, file_path.name)
        if existing_by_name and not existing_by_name.is_superseded:
            return self._create_version_asset(
                file_path, file_hash, context, source, bundle,
                old_asset=existing_by_name, sidecar=sidecar,
            )

        # --- Layer 3: Content hash dedup (DB + same-poll) ---
        if file_hash in hashes_this_poll:
            logger.info("Duplicate content hash %s for %s, skipping (same poll)", file_hash[:12], file_path.name)
            return None
        if self._hash_exists(context, bundle.id, context.infospace_id, file_hash):
            logger.info("Duplicate content hash %s for %s, skipping", file_hash[:12], file_path.name)
            return None

        # --- Layer 4: Stem match (flag for confirmation) ---
        base_stem = _strip_version_suffix(file_path.stem)
        candidate = self._find_by_stem(context, bundle.id, context.infospace_id, base_stem) if base_stem else None

        asset = self._create_new_asset(
            file_path, file_hash, context, source, bundle, sidecar=sidecar,
        )
        if candidate:
            file_info = dict(asset.file_info or {})
            file_info["potential_supersedes"] = candidate.id
            file_info["potential_supersedes_title"] = candidate.title
            asset.file_info = file_info

        return asset

    # ------------------------------------------------------------------ #
    #  Asset creation helpers
    # ------------------------------------------------------------------ #

    def _create_version_asset(
        self,
        file_path: Path,
        file_hash: str,
        context: IngestionContext,
        source: Source,
        bundle: Bundle,
        *,
        old_asset: Asset,
        sidecar: Optional[Dict[str, Any]] = None,
    ) -> Asset:
        """Create a new asset that supersedes *old_asset*."""
        old_asset.is_superseded = True
        context.session.add(old_asset)
        # Cascade: mark children as having a superseded parent
        from sqlalchemy import update as sql_update

        context.session.execute(
            sql_update(Asset)
            .where(Asset.parent_asset_id == old_asset.id)
            .values(parent_is_superseded=True)
        )

        asset = self._build_asset(file_path, file_hash, context, source, bundle)
        asset.previous_asset_id = old_asset.id

        file_info = dict(asset.file_info or {})
        file_info["supersedes_asset_id"] = old_asset.id
        if sidecar:
            if sidecar.get("reason"):
                file_info["version_reason"] = sidecar["reason"]
            if sidecar.get("version_label"):
                file_info["version_label"] = sidecar["version_label"]
        asset.file_info = file_info

        logger.info(
            "Version link: %s supersedes asset %d (%s)",
            file_path.name, old_asset.id, old_asset.title,
        )
        return asset

    def _create_new_asset(
        self,
        file_path: Path,
        file_hash: str,
        context: IngestionContext,
        source: Source,
        bundle: Bundle,
        *,
        sidecar: Optional[Dict[str, Any]] = None,
    ) -> Asset:
        asset = self._build_asset(file_path, file_hash, context, source, bundle)
        if sidecar:
            file_info = dict(asset.file_info or {})
            if sidecar.get("supersedes"):
                file_info["unresolved_supersedes"] = sidecar["supersedes"]
            asset.file_info = file_info
        return asset

    def _build_asset(
        self,
        file_path: Path,
        file_hash: str,
        context: IngestionContext,
        source: Source,
        bundle: Bundle,
    ) -> Asset:
        ext = file_path.suffix.lower()
        kind = detect_asset_kind_from_extension(ext)
        try:
            stat = file_path.stat()
            file_meta = {"file_size": stat.st_size, "file_mtime": stat.st_mtime}
        except OSError:
            file_meta = {}

        blob_path = self._compute_inbox_blob_path(file_path, source)

        return Asset(
            title=file_path.name,
            kind=kind,
            infospace_id=source.infospace_id,
            user_id=source.user_id,
            bundle_ids=[bundle.id],
            blob_path=blob_path,
            logical_path=file_path.name,
            content_hash=file_hash,
            processing_status=ProcessingStatus.PENDING,
            file_info={
                "ingestion_method": "inbox",
                "source_path": str(file_path),
                "copy_mode": False,
                **file_meta,
            },
        )

    # ------------------------------------------------------------------ #
    #  Per-file lookup helpers (O(1) indexed queries, no full bundle load)
    # ------------------------------------------------------------------ #

    def _find_by_filename(
        self, context: IngestionContext, bundle_id: int, infospace_id: int, filename: str
    ) -> Optional[Asset]:
        """Find non-superseded asset in bundle with matching filename.
        Tries exact match first (index-friendly), then LIKE fallback for paths with subdirs.
        """
        from sqlalchemy import or_
        base = (
            text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id),
            Asset.infospace_id == infospace_id,
            Asset.parent_asset_id.is_(None),
            Asset.is_superseded.is_(False),
        )
        # Exact match first (uses composite index on bundle_id, logical_path/blob_path)
        exact_stmt = select(Asset).where(
            *base,
            or_(
                Asset.blob_path == filename,
                Asset.logical_path == filename,
            ),
        ).limit(1)
        result = context.session.exec(exact_stmt).first()
        if result:
            return result
        # Fallback: path ends with /filename (leading wildcard, no index)
        like_stmt = select(Asset).where(
            *base,
            or_(
                Asset.blob_path.like(f"%/{filename}"),
                (Asset.logical_path.is_not(None)) & (Asset.logical_path.like(f"%/{filename}")),
            ),
        ).limit(1)
        return context.session.exec(like_stmt).first()

    def _hash_exists(
        self, context: IngestionContext, bundle_id: int, infospace_id: int, content_hash: str
    ) -> bool:
        """Check if content_hash exists in bundle. Single indexed query."""
        stmt = select(Asset.id).where(
            text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id),
            Asset.infospace_id == infospace_id,
            Asset.content_hash == content_hash,
            Asset.is_superseded.is_(False),
        ).limit(1)
        return context.session.exec(stmt).first() is not None

    def _find_by_stem(
        self, context: IngestionContext, bundle_id: int, infospace_id: int, base_stem: str
    ) -> Optional[Asset]:
        """Find non-superseded asset whose filename stem matches (e.g. report_v2.pdf matches report)."""
        from sqlalchemy import or_
        # Match blob_path or logical_path ending with base_stem. or base_stem.
        pattern_suffix = f"%/{base_stem}."
        pattern_exact = f"%/{base_stem}"
        stmt = select(Asset).where(
            text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id),
            Asset.infospace_id == infospace_id,
            Asset.parent_asset_id.is_(None),
            Asset.is_superseded.is_(False),
            or_(
                Asset.blob_path.like(pattern_suffix),
                Asset.blob_path.like(pattern_exact),
                Asset.logical_path.like(f"{base_stem}.%"),
                Asset.logical_path == base_stem,
            ),
        ).limit(1)
        return context.session.exec(stmt).first()

    # ------------------------------------------------------------------ #
    #  Lookup helpers
    # ------------------------------------------------------------------ #

    def _resolve_by_blob_path(
        self, context: IngestionContext, bundle_id: int, target_path: str
    ) -> Optional[Asset]:
        """Find the latest non-superseded asset matching *target_path*.

        Uses SQL pushdown (exact match OR LIKE suffix) so this is O(1) via
        index, not O(all assets).
        """
        from sqlalchemy import or_

        stmt = select(Asset).where(
            text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id),
            Asset.infospace_id == context.infospace_id,
            Asset.is_superseded.is_(False),
            Asset.parent_asset_id.is_(None),
            Asset.blob_path.isnot(None),
            or_(
                Asset.blob_path == target_path,
                Asset.blob_path.like(f"%/{target_path}"),
            ),
        ).limit(1)
        return context.session.exec(stmt).first()

    # ------------------------------------------------------------------ #
    #  Path helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _compute_inbox_blob_path(file_path: Path, source: Source) -> str:
        """
        Blob path for inbox files uses the same reference style as directory import,
        relative to the storage base path when possible.
        """
        from app.core.config import settings

        try:
            base = Path(settings.LOCAL_STORAGE_BASE_PATH).resolve()
            return str(file_path.resolve().relative_to(base)).replace("\\", "/")
        except ValueError:
            dataset_name = source.details.get("dataset_name", "inbox")
            return f"{dataset_name}/_inbox/{file_path.name}"

    @staticmethod
    def _move_to_processed(file_path: Path, processed_dir: Path) -> None:
        """Move file and its sidecar to the processed directory."""
        try:
            if file_path.exists():
                dest = processed_dir / file_path.name
                file_path.rename(dest)
            sidecar = file_path.parent / f"{file_path.name}.meta.json"
            if sidecar.exists():
                sidecar.rename(processed_dir / sidecar.name)
        except OSError as exc:
            logger.warning("Failed to move %s to processed: %s", file_path.name, exc)
