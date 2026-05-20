"""
Asset Builder — pure fluent blueprint + identity + policy + flush pipeline.

This module contains NO source-type knowledge. Every `from_rss_entry`,
`from_search_result`, `from_file`, `from_url`, `for_csv_row`, etc. has
been moved to the handler or processor that owns the domain. The builder
exposes only:

  • Blueprint setters (`as_kind`, `with_title`, `with_text`, `with_source`,
    `with_blob`, `with_metadata`, `with_facets`, `with_timestamp`,
    `as_child_of`, `with_part_index`, `as_stub`, `with_processing_status`,
    `with_content_hash`, `with_depth`) — configure the asset's fields.

  • Identity (`dedup_on`, `no_dedup`) — declare what "match" means.

  • Policy (`on_match`, `supersedes`) — declare what happens on match.

  • Terminals (`find_match`, `build`, `load`, `build_batch`, `build_children`)
    — run the pipeline and flush. NEVER commit. Callers own the transaction.

See docs/plans/hq-v2/PRIMITIVES.md §1 for the full contract. Composition
examples in the v2 handlers (`content/handlers/*.py`).
"""

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from sqlalchemy import update
from sqlmodel import Session, select

from app.models import Asset, AssetKind, ProcessingStatus
from app.schemas import AssetCreate

logger = logging.getLogger(__name__)


# Sentinel for dedup_on "not configured yet" (distinct from explicitly setting
# a key to None, which is meaningless, and from no_dedup(), which disables dedup).
_UNSET: Any = object()

MatchPolicy = Literal["skip", "supersede", "update"]


@dataclass
class AssetBlueprint:
    """Intermediate representation of an asset being built.

    Every field here corresponds to exactly one fluent setter on AssetBuilder.
    No enrichment queues, no child-builder lists — handlers own that logic.
    """

    # Required context
    user_id: int
    infospace_id: int

    # Identity
    kind: Optional[AssetKind] = None
    title: Optional[str] = None
    stub: bool = False

    # Content
    text_content: Optional[str] = None
    blob_path: Optional[str] = None
    source_identifier: Optional[str] = None
    content_hash: Optional[str] = None

    # Hierarchy
    parent_asset_id: Optional[int] = None
    part_index: Optional[int] = None

    # Metadata
    file_info: Dict[str, Any] = field(default_factory=dict)
    facets: Dict[str, Any] = field(default_factory=dict)
    event_timestamp: Optional[datetime] = None
    processing_status: Optional[ProcessingStatus] = None

    # Ingestion depth (used by some handlers to signal child-extraction strategy)
    ingestion_depth: int = 0

    # Identity + policy (driven by .dedup_on() / .no_dedup() / .on_match() / .supersedes())
    dedup_source_identifier: Any = field(default=_UNSET)
    dedup_content_hash: Any = field(default=_UNSET)
    dedup_title: Any = field(default=_UNSET)
    dedup_disabled: bool = False
    match_policy: MatchPolicy = "skip"
    supersede_target: Optional["Asset"] = None


class AssetBuilder:
    """Fluent blueprint + identity + policy + flush.

    Every asset in the system is created through this builder. Handlers and
    processors compose setters — no `from_X` entry points on this class.

    Flush, never commit. The caller (route, @task, poll handler) owns the
    transaction boundary. Enforced by the flush-never-commit pytest fixture.
    """

    def __init__(self, session: Session, user_id: int, infospace_id: int):
        self.session = session
        self.blueprint = AssetBlueprint(
            user_id=user_id, infospace_id=infospace_id,
        )

    # ═══════════════════════════════════════════════════════════════
    # BLUEPRINT SETTERS
    # ═══════════════════════════════════════════════════════════════

    def as_kind(self, kind: AssetKind) -> "AssetBuilder":
        self.blueprint.kind = kind
        return self

    def with_title(self, title: str) -> "AssetBuilder":
        self.blueprint.title = title
        return self

    def with_text(self, text: str) -> "AssetBuilder":
        """Set text_content. Replaces any prior value."""
        self.blueprint.text_content = text
        return self

    def with_source(self, identifier: str) -> "AssetBuilder":
        """Set source_identifier (URL, feed entry id, file path, etc.)."""
        self.blueprint.source_identifier = identifier
        return self

    def with_blob(self, path: str) -> "AssetBuilder":
        """Set blob_path. Caller uploaded to storage themselves."""
        self.blueprint.blob_path = path
        return self

    def with_metadata(self, **kwargs) -> "AssetBuilder":
        """Merge into blueprint.file_info (ingestion/processing metadata)."""
        self.blueprint.file_info.update(kwargs)
        return self

    def with_facets(self, **kwargs) -> "AssetBuilder":
        """Merge into blueprint.facets (enricher-style discoverable properties).
        Scalars and flat lists only (per content/facets.py invariant)."""
        self.blueprint.facets.update(kwargs)
        return self

    def with_timestamp(self, ts: datetime) -> "AssetBuilder":
        self.blueprint.event_timestamp = ts
        return self

    def as_child_of(self, parent_id: int, part_index: Optional[int] = None) -> "AssetBuilder":
        self.blueprint.parent_asset_id = parent_id
        if part_index is not None:
            self.blueprint.part_index = part_index
        return self

    def with_part_index(self, part_index: int) -> "AssetBuilder":
        self.blueprint.part_index = part_index
        return self

    def as_stub(self, stub: bool = True) -> "AssetBuilder":
        self.blueprint.stub = stub
        if stub:
            # Stubs don't need processing
            self.blueprint.processing_status = ProcessingStatus.READY
        return self

    def with_processing_status(self, status: ProcessingStatus) -> "AssetBuilder":
        self.blueprint.processing_status = status
        return self

    def with_content_hash(self, content_hash: str) -> "AssetBuilder":
        """Set blueprint.content_hash. Persisted on the asset row."""
        self.blueprint.content_hash = content_hash
        return self

    def with_depth(self, depth: int) -> "AssetBuilder":
        """Ingestion depth for link extraction (handler-interpreted).
        0 = no extraction, 1 = stub references, 2 = recursive fetch."""
        self.blueprint.ingestion_depth = depth
        return self

    # ═══════════════════════════════════════════════════════════════
    # IDENTITY (dedup_on, no_dedup)
    # ═══════════════════════════════════════════════════════════════

    def dedup_on(
        self,
        *,
        source_identifier: Optional[str] = _UNSET,
        content_hash: Optional[str] = _UNSET,
        title: Optional[str] = _UNSET,
    ) -> "AssetBuilder":
        """Configure identity fields for find_match + on_match.

        Pass all fields that uniquely identify this asset for this caller.
        At least one of {source_identifier, content_hash, title} must be set;
        find_match runs an AND across supplied keys.

        Calling dedup_on() clears any prior no_dedup() flag; calling it twice
        merges keys (last write wins per key).
        """
        if source_identifier is not _UNSET:
            self.blueprint.dedup_source_identifier = source_identifier
        if content_hash is not _UNSET:
            self.blueprint.dedup_content_hash = content_hash
        if title is not _UNSET:
            self.blueprint.dedup_title = title
        self.blueprint.dedup_disabled = False
        return self

    def no_dedup(self) -> "AssetBuilder":
        """Disable dedup explicitly — this build always creates a new row."""
        self.blueprint.dedup_disabled = True
        self.blueprint.dedup_source_identifier = _UNSET
        self.blueprint.dedup_content_hash = _UNSET
        self.blueprint.dedup_title = _UNSET
        return self

    # ═══════════════════════════════════════════════════════════════
    # POLICY (on_match, supersedes)
    # ═══════════════════════════════════════════════════════════════

    def on_match(self, policy: MatchPolicy) -> "AssetBuilder":
        """Set policy applied when find_match finds an existing row.

        - 'skip' (default): return the existing row unchanged.
        - 'supersede': mark existing is_superseded=True, cascade to its
          children, insert new row with previous_asset_id = existing.id.
        - 'update': mutate existing row in place (rare — CSV row updates).
        """
        if policy not in ("skip", "supersede", "update"):
            raise ValueError(f"on_match policy must be skip|supersede|update, got {policy!r}")
        self.blueprint.match_policy = policy
        return self

    def supersedes(self, old_asset: Asset) -> "AssetBuilder":
        """Explicit supersede target — caller has already resolved the match.
        Builder skips find_match; on_match is forced to 'supersede'."""
        if old_asset is None:
            raise ValueError("supersedes() requires a non-None Asset")
        self.blueprint.supersede_target = old_asset
        self.blueprint.match_policy = "supersede"
        return self

    # ═══════════════════════════════════════════════════════════════
    # TERMINALS
    # ═══════════════════════════════════════════════════════════════

    async def find_match(self) -> Optional[Asset]:
        """Run the identity query without creating anything. Returns the
        existing Asset matching the configured dedup keys, or None.

        Uses the composite index ix_asset_source_active_roots when source_id
        or content_hash is the dominant key. Returns the most recent (by
        created_at DESC) non-superseded row matching all configured keys.

        When .supersedes(old) has been called, returns old directly.
        """
        if self.blueprint.supersede_target is not None:
            return self.blueprint.supersede_target

        if self.blueprint.dedup_disabled:
            return None

        stmt = select(Asset).where(
            Asset.infospace_id == self.blueprint.infospace_id,
            Asset.is_superseded == False,  # noqa: E712
        )

        has_key = False
        if self.blueprint.dedup_source_identifier is not _UNSET:
            stmt = stmt.where(
                Asset.source_identifier == self.blueprint.dedup_source_identifier
            )
            has_key = True
        if self.blueprint.dedup_content_hash is not _UNSET:
            stmt = stmt.where(Asset.content_hash == self.blueprint.dedup_content_hash)
            has_key = True
        if self.blueprint.dedup_title is not _UNSET:
            stmt = stmt.where(Asset.title == self.blueprint.dedup_title)
            has_key = True

        if not has_key:
            logger.warning(
                "AssetBuilder.find_match called with no identity keys configured; "
                "returning None. Did you forget dedup_on() or no_dedup()?"
            )
            return None

        stmt = stmt.order_by(Asset.created_at.desc()).limit(1)
        return self.session.exec(stmt).first()

    async def build(self) -> Asset:
        """Execute the fluent blueprint — validate, dedup, apply policy, flush.

        Flush-never-commit. The caller's transaction is the asset's unit of
        atomicity. Use in handlers, routes, @task bodies.
        """
        if not self.blueprint.kind:
            raise ValueError("AssetBuilder.build(): kind must be set (.as_kind(...))")
        if not self.blueprint.title:
            raise ValueError("AssetBuilder.build(): title must be set (.with_title(...))")

        # Identity check
        match = await self.find_match()

        if match is None:
            new_asset = self._blueprint_to_asset()
            self.session.add(new_asset)
            self.session.flush()
            logger.info(
                "Created asset id=%s (%s) %s",
                new_asset.id, new_asset.kind.value if new_asset.kind else "?", new_asset.title,
            )
            return new_asset

        policy = self.blueprint.match_policy
        if policy == "skip":
            logger.debug("Matched asset id=%s, policy=skip, returning existing", match.id)
            return match

        if policy == "supersede":
            incoming_hash = self.blueprint.content_hash or self._derived_content_hash()
            if match.content_hash and incoming_hash and match.content_hash == incoming_hash:
                logger.debug(
                    "Matched asset id=%s, content_hash identical, skipping supersede",
                    match.id,
                )
                return match
            self._do_supersede(match)
            new_asset = self._blueprint_to_asset()
            new_asset.previous_asset_id = match.id
            self.session.add(new_asset)
            self.session.flush()
            logger.info(
                "Superseded id=%s with new id=%s (%s)",
                match.id, new_asset.id, new_asset.title,
            )
            return new_asset

        if policy == "update":
            # Mutate the match in place with non-None blueprint fields
            self._apply_blueprint_to(match)
            self.session.add(match)
            self.session.flush()
            logger.info("Updated asset id=%s in place", match.id)
            return match

        raise ValueError(f"Unknown match_policy {policy!r}")

    async def load(self, asset: Asset) -> Asset:
        """Accept a pre-constructed Asset and run it through the identity/policy
        pipeline. For importers and processors that already built the row.

        When .dedup_on() is configured: find_match runs, match_policy applies.
        Otherwise the asset is flushed as-is. Caller owns the transaction."""
        match = await self.find_match()

        if match is None:
            if asset.user_id is None:
                asset.user_id = self.blueprint.user_id
            if asset.infospace_id is None:
                asset.infospace_id = self.blueprint.infospace_id
            self.session.add(asset)
            self.session.flush()
            return asset

        policy = self.blueprint.match_policy
        if policy == "skip":
            return match
        if policy == "supersede":
            if (
                match.content_hash
                and asset.content_hash
                and match.content_hash == asset.content_hash
            ):
                logger.debug(
                    "load(): matched asset id=%s, content_hash identical, skipping supersede",
                    match.id,
                )
                return match
            self._do_supersede(match)
            asset.previous_asset_id = match.id
            if asset.user_id is None:
                asset.user_id = self.blueprint.user_id
            if asset.infospace_id is None:
                asset.infospace_id = self.blueprint.infospace_id
            self.session.add(asset)
            self.session.flush()
            return asset
        if policy == "update":
            for attr in ("title", "text_content", "blob_path", "file_info",
                         "facets", "event_timestamp", "processing_status",
                         "content_hash"):
                val = getattr(asset, attr, None)
                if val is not None:
                    setattr(match, attr, val)
            self.session.add(match)
            self.session.flush()
            return match

        raise ValueError(f"Unknown match_policy {policy!r}")

    async def build_batch(self, assets: List[Asset]) -> List[Asset]:
        """Bulk insert a list of pre-constructed Asset objects.

        No dedup, no enrichers. Flushes per chunk of 500. For processors
        inserting known children or importers inserting validated rows."""
        CHUNK_SIZE = 500
        for i, asset in enumerate(assets):
            if asset.user_id is None:
                asset.user_id = self.blueprint.user_id
            if asset.infospace_id is None:
                asset.infospace_id = self.blueprint.infospace_id
            elif asset.infospace_id != self.blueprint.infospace_id:
                raise ValueError(
                    f"build_batch asset[{i}] infospace_id={asset.infospace_id} "
                    f"does not match builder's {self.blueprint.infospace_id}"
                )
            self.session.add(asset)
            if (i + 1) % CHUNK_SIZE == 0:
                self.session.flush()

        if len(assets) % CHUNK_SIZE != 0:
            self.session.flush()

        return assets

    async def build_children(
        self, parent_id: int, children: List[Asset],
    ) -> List[Asset]:
        """Bulk insert structural children. Auto-sets parent_asset_id and
        part_index (0..N-1) when missing. Delegates to build_batch."""
        for idx, child in enumerate(children):
            if child.parent_asset_id is None:
                child.parent_asset_id = parent_id
            elif child.parent_asset_id != parent_id:
                raise ValueError(
                    f"build_children child[{idx}] has parent_asset_id={child.parent_asset_id}, "
                    f"expected {parent_id}"
                )
            if child.part_index is None:
                child.part_index = idx
        return await self.build_batch(children)

    # ═══════════════════════════════════════════════════════════════
    # INTERNAL
    # ═══════════════════════════════════════════════════════════════

    def _do_supersede(self, old_asset: Asset) -> None:
        """Mark old_asset superseded and cascade parent_is_superseded.

        This is the ONE place in the codebase that writes is_superseded=True.
        Invariant enforced by CI grep. If you want to mark a row superseded
        elsewhere, call .supersedes(old).build() instead.
        """
        old_asset.is_superseded = True
        self.session.add(old_asset)

        self.session.exec(
            update(Asset)
            .where(Asset.parent_asset_id == old_asset.id)
            .values(parent_is_superseded=True)
        )

        self.session.flush()
        logger.info(
            "Superseded asset id=%s (%s) — children cascaded parent_is_superseded=True",
            old_asset.id, old_asset.title,
        )

    def _blueprint_to_asset(self) -> Asset:
        """Construct an Asset row from the fluent blueprint."""
        # Compute content_hash if not explicitly set.
        content_hash = self.blueprint.content_hash or self._derived_content_hash()

        # Annotate with ingested_at for observability (idempotent — overwrites on rebuild).
        file_info = dict(self.blueprint.file_info or {})
        file_info.setdefault("ingested_at", datetime.now(timezone.utc).isoformat())

        # Status default — keep caller's choice if set, else READY.
        status = self.blueprint.processing_status or ProcessingStatus.READY

        return Asset(
            title=self.blueprint.title,
            kind=self.blueprint.kind,
            stub=self.blueprint.stub,
            user_id=self.blueprint.user_id,
            infospace_id=self.blueprint.infospace_id,
            text_content=self.blueprint.text_content,
            blob_path=self.blueprint.blob_path,
            source_identifier=self.blueprint.source_identifier,
            facets=self.blueprint.facets or None,
            file_info=file_info or None,
            event_timestamp=self.blueprint.event_timestamp,
            parent_asset_id=self.blueprint.parent_asset_id,
            part_index=self.blueprint.part_index,
            processing_status=status,
            content_hash=content_hash,
        )

    def _apply_blueprint_to(self, asset: Asset) -> None:
        """Mutate an existing Asset with blueprint fields (for update policy).
        Only overwrites fields the blueprint set (non-None)."""
        if self.blueprint.title is not None:
            asset.title = self.blueprint.title
        if self.blueprint.text_content is not None:
            asset.text_content = self.blueprint.text_content
        if self.blueprint.blob_path is not None:
            asset.blob_path = self.blueprint.blob_path
        if self.blueprint.file_info:
            merged = dict(asset.file_info or {})
            merged.update(self.blueprint.file_info)
            asset.file_info = merged
        if self.blueprint.facets:
            merged_facets = dict(asset.facets or {})
            merged_facets.update(self.blueprint.facets)
            asset.facets = merged_facets
        if self.blueprint.event_timestamp is not None:
            asset.event_timestamp = self.blueprint.event_timestamp
        if self.blueprint.processing_status is not None:
            asset.processing_status = self.blueprint.processing_status
        if self.blueprint.content_hash is not None:
            asset.content_hash = self.blueprint.content_hash
        asset.updated_at = datetime.now(timezone.utc)

    def _derived_content_hash(self) -> Optional[str]:
        """Derive a content hash from source_identifier + text_content prefix.

        Stable across builds of the same content — used as a fallback when the
        caller didn't supply one via .with_content_hash(). Returns None if
        neither source_identifier nor text_content is set.
        """
        if not self.blueprint.source_identifier and not self.blueprint.text_content:
            return None

        parts: List[str] = []
        if self.blueprint.source_identifier:
            parts.append(self.blueprint.source_identifier)
        if self.blueprint.text_content:
            parts.append(self.blueprint.text_content[:1000])
        return hashlib.md5("|".join(parts).encode("utf-8", errors="ignore")).hexdigest()
