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
from app.api.modules.content.tree import purge

logger = logging.getLogger(__name__)


# Sentinel for dedup_on "not configured yet" (distinct from explicitly setting
# a key to None, which is meaningless, and from no_dedup(), which disables dedup).
_UNSET: Any = object()

MatchPolicy = Literal["skip", "supersede", "update"]


def derive_content_hash(
    source_identifier: Optional[str], text_content: Optional[str],
) -> Optional[str]:
    """Stable content key from ``source_identifier`` + a text prefix — the ONE
    derivation, shared by *build* (when no hash was supplied) and by *reconcile*
    (to compare an existing child against a freshly-extracted blueprint). Returns
    None only when both inputs are empty."""
    if not source_identifier and not text_content:
        return None
    parts: List[str] = []
    if source_identifier:
        parts.append(source_identifier)
    if text_content:
        parts.append(text_content[:1000])
    return hashlib.md5("|".join(parts).encode("utf-8", errors="ignore")).hexdigest()


Verdict = Literal["create", "skip", "unchanged", "supersede", "update"]


def decide(
    match: Optional["Asset"], incoming_hash: Optional[str], policy: MatchPolicy,
) -> Verdict:
    """The ONE identity/policy decision — the stage-2 (content) verdict shared by
    ``build_outcome`` and ``reconcile_children`` so the skip|supersede|update ×
    content_hash matrix lives in a single auditable place instead of interleaving across
    three branches (the supersede / re-update storm class).

    Stage 1 — the cheap ``source_token`` drift guard — runs earlier, before fetch, in the
    intake spine; reaching here means the item was worth realizing. This decides what to do
    now that content can be compared:

      • no match                          → ``create``
      • policy is ``skip``                → ``skip``      (return existing untouched)
      • content identical (hash == hash)  → ``unchanged`` (a drift signal moved but the
                                                           bytes didn't — refresh the token,
                                                           write nothing)
      • content differs                   → ``policy``    (``supersede`` | ``update``)
    """
    if match is None:
        return "create"
    if policy == "skip":
        return "skip"
    if incoming_hash and match.content_hash and incoming_hash == match.content_hash:
        return "unchanged"
    return policy


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

    # Provenance — set by sources (root assets): source_token = cheap drift
    # change-token, source_id = the Source that produced it.
    source_token: Optional[str] = None
    source_id: Optional[int] = None

    # Placement — destination bundle(s); None → ROOT via the column server_default.
    bundle_ids: Optional[List[int]] = None

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


@dataclass
class BuildOutcome:
    """What ``build_outcome()`` did: the asset plus the identity/policy verdict.

    Lets the ingestion loop count created vs skipped vs superseded accurately.
    The historical bug was callers counting ``len(assets)``, so dedup skips
    inflated ``IngestionJob.processed_files`` / ``Source.total_items_ingested``.
    ``status`` is the single authority for that decision — computed in
    ``build_outcome()`` and nowhere else.
    """

    asset: "Asset"
    status: Literal["created", "skipped", "superseded", "updated"]


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

    def with_source_token(self, token: str) -> "AssetBuilder":
        """Set source_token — the cheap drift change-token (etag / mtime / pubdate).
        Root assets only; a changed token is what drives re-fetch + supersede."""
        self.blueprint.source_token = token
        return self

    def with_source_id(self, source_id: int) -> "AssetBuilder":
        """Link the asset to the Source that produced it (monitoring / provenance).
        Distinct from ``with_source()``, which sets the source_identifier dedup key."""
        self.blueprint.source_id = source_id
        return self

    def into_bundle(self, bundle_id: int) -> "AssetBuilder":
        """Place the built asset in ``bundle_id`` (sets bundle_ids=[id]). Omit to
        leave it at ROOT — the column's non-empty server_default handles that."""
        self.blueprint.bundle_ids = [bundle_id]
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
        """Execute the fluent blueprint and return the resulting Asset.

        Thin wrapper over ``build_outcome()`` for the common case where the
        caller just wants the asset. When you need to know whether the asset
        was created / skipped / superseded / updated (the ingestion loop counts
        these), call ``build_outcome()`` instead.

        Flush-never-commit. The caller's transaction is the asset's unit of
        atomicity. Use in handlers, routes, @task bodies.
        """
        return (await self.build_outcome()).asset

    async def build_outcome(self) -> BuildOutcome:
        """Execute the fluent blueprint — validate, dedup, apply policy, flush —
        and report what happened.

        The single decision site for created vs skipped vs superseded vs
        updated; ``build()`` is the asset-only wrapper. Flush-never-commit.
        """
        if not self.blueprint.kind:
            raise ValueError("AssetBuilder.build(): kind must be set (.as_kind(...))")
        if not self.blueprint.title:
            raise ValueError("AssetBuilder.build(): title must be set (.with_title(...))")

        # Identity + policy — the single decision (see ``decide`` above). The storm-prone
        # skip|supersede|update × content_hash matrix lives there, not interleaved here.
        match = await self.find_match()
        incoming_hash = self.blueprint.content_hash or self._derived_content_hash()
        verdict = decide(match, incoming_hash, self.blueprint.match_policy)

        if verdict == "create":
            new_asset = self._blueprint_to_asset()
            self.session.add(new_asset)
            self.session.flush()
            logger.info(
                "Created asset id=%s (%s) %s",
                new_asset.id, new_asset.kind.value if new_asset.kind else "?", new_asset.title,
            )
            return BuildOutcome(new_asset, "created")

        if verdict == "skip":
            logger.debug("Matched asset id=%s, policy=skip, returning existing", match.id)
            return BuildOutcome(match, "skipped")

        if verdict == "unchanged":
            # Content identical — a drift signal moved (e.g. an mtime touch) but the bytes
            # did not. Refresh the stored token so the next poll's stage-1 guard skips without
            # a re-fetch; write nothing else. Idempotent, and applies to supersede AND update
            # policies — the latent supersede-side re-fetch storm dies here too.
            if (
                self.blueprint.source_token is not None
                and match.source_token != self.blueprint.source_token
            ):
                match.source_token = self.blueprint.source_token
                self.session.add(match)
                self.session.flush()
            return BuildOutcome(match, "skipped")

        if verdict == "supersede":
            self._do_supersede(match)
            new_asset = self._blueprint_to_asset()
            new_asset.previous_asset_id = match.id
            self.session.add(new_asset)
            self.session.flush()
            logger.info(
                "Superseded id=%s with new id=%s (%s)",
                match.id, new_asset.id, new_asset.title,
            )
            return BuildOutcome(new_asset, "superseded")

        # verdict == "update" — mutate the match in place with non-None blueprint fields
        # (incl. source_token, so next poll's guard sees it as current — no re-update storm).
        self._apply_blueprint_to(match)
        self.session.add(match)
        self.session.flush()
        logger.info("Updated asset id=%s in place", match.id)
        return BuildOutcome(match, "updated")

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
        """Bulk insert structural children (intrinsic parts — pdf pages, csv rows, web
        images). Auto-sets parent_asset_id + part_index (0..N-1). Delegates to build_batch.

        Container-in-container recursion is bounded where it lives — inside the recursing
        ``process`` (e.g. ``archive``), by stack-local depth + byte guards — not by a
        persisted per-asset counter."""
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
            if child.content_hash is None:
                # Stamp a stable identity hash so a later reprocess can tell which
                # children are unchanged (kept) vs changed (updated in place).
                child.content_hash = derive_content_hash(child.source_identifier, child.text_content)
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

        asset = Asset(
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
            source_token=self.blueprint.source_token,
            source_id=self.blueprint.source_id,
        )
        # Only emit bundle_ids when placed — else the column's ARRAY[0] (ROOT)
        # server_default stands; passing None would violate the NOT-NULL constraint.
        if self.blueprint.bundle_ids is not None:
            asset.bundle_ids = self.blueprint.bundle_ids
        return asset

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
        if self.blueprint.source_token is not None:
            # Advance the drift token so a re-poll's guard sees this item as current
            # (else an in-place update would re-fire every poll).
            asset.source_token = self.blueprint.source_token
        asset.updated_at = datetime.now(timezone.utc)

    def _derived_content_hash(self) -> Optional[str]:
        """Fallback content hash when the caller didn't supply one — delegates to the
        shared ``derive_content_hash`` so build and reconcile stay in lockstep."""
        return derive_content_hash(
            self.blueprint.source_identifier, self.blueprint.text_content,
        )


# Asset lifecycle operations (multi-row) — former asset_ops.py, folded in.
# Cross-infospace transfer + the container-reprocess reconcile that preserves child
# annotations across a re-extract. They compose the builder above; flush-never-commit.

# ─── transfer_assets ─────────────────────────────────────────────────────────

async def transfer_assets(
    session: Session,
    asset_ids: List[int],
    source_infospace_id: int,
    target_infospace_id: int,
    user_id: int,
    *,
    copy: bool = True,
) -> List[Asset]:
    """Move or copy assets between infospaces.

    ``copy=True`` (default) routes each source asset through AssetBuilder in the
    target infospace — duplicates (same content_hash) are skipped by dedup, so
    repeat transfers are idempotent. ``copy=False`` mutates existing rows in
    place (changes ``infospace_id`` and ``user_id``).

    Flush-only. Caller owns the transaction boundary (route, @task body).
    """
    if not asset_ids:
        return []

    sources = session.exec(
        select(Asset)
        .where(Asset.id.in_(asset_ids))
        .where(Asset.infospace_id == source_infospace_id)
    ).all()

    if not sources:
        return []

    transferred: List[Asset] = []
    if copy:
        for src in sources:
            builder = (
                AssetBuilder(session, user_id, target_infospace_id)
                .as_kind(src.kind)
                .with_title(src.title)
            )
            if src.text_content is not None:
                builder.with_text(src.text_content)
            if src.blob_path:
                builder.with_blob(src.blob_path)
            if src.source_identifier:
                builder.with_source(src.source_identifier)
            if src.content_hash:
                builder.with_content_hash(src.content_hash)
            if src.event_timestamp:
                builder.with_timestamp(src.event_timestamp)
            if src.facets:
                builder.with_facets(**src.facets)
            if src.file_info:
                builder.with_metadata(**src.file_info)
            if src.stub:
                builder.as_stub(True)
            if src.processing_status is not None:
                builder.with_processing_status(src.processing_status)
            if src.content_hash:
                builder.dedup_on(content_hash=src.content_hash).on_match("skip")
            else:
                builder.no_dedup()

            new_asset = await builder.build()
            transferred.append(new_asset)
    else:
        for src in sources:
            src.infospace_id = target_infospace_id
            src.user_id = user_id
            session.add(src)
            transferred.append(src)
        session.flush()

    logger.info(
        "transfer_assets_async: %d asset(s) %s → infospace %s",
        len(transferred), "copied" if copy else "moved", target_infospace_id,
    )
    return transferred


# ─── reconcile_children ──────────────────────────────────────────────────────

ReconcileAction = Literal["delete", "mark_orphaned"]
ChangePolicy = Literal["supersede", "update"]
MatchKey = Literal["source_identifier", "part_index", "title", "content_hash"]


async def reconcile_children(
    session: Session,
    parent_id: int,
    expected: List[Asset],
    *,
    user_id: int,
    infospace_id: int,
    match_key: MatchKey = "source_identifier",
    on_change: ChangePolicy = "supersede",
    orphan_action: ReconcileAction = "mark_orphaned",
) -> dict:
    """Reconcile the children of ``parent_id`` against a freshly-extracted blueprint
    list — so a container reprocess preserves the annotations on them instead of
    delete-and-recreating.

    Each existing (non-superseded) child is matched to a blueprint by ``match_key``.
    For a matched pair the content hash decides:
      • identical → **kept** (untouched).
      • changed, ``on_change="update"`` → **updated IN PLACE** (same row id → its
        annotations stay attached; this is the #8 reprocess path).
      • changed, ``on_change="supersede"`` → old row superseded + new row inserted
        (annotations stay on the *old* version — version-history semantics).
    A blueprint with no match → **inserted**. An existing child absent from the
    blueprints → ``orphan_action``: ``mark_orphaned`` tags+keeps it (annotations
    survive, row flagged), ``delete`` cascades it away.

    Blueprints carry no precomputed hash, so we derive one (``derive_content_hash`` —
    the same derivation ``build_children`` stamps) to compare against the child.

    Flush-only; caller commits. Returns
    ``{"inserted","kept","updated","superseded","orphaned"}``.
    """
    expected = expected or []

    existing_children = session.exec(
        select(Asset)
        .where(Asset.parent_asset_id == parent_id)
        .where(Asset.is_superseded == False)  # noqa: E712
    ).all()

    def _key(a: Asset):
        if match_key == "part_index":
            return a.part_index
        if match_key == "title":
            return a.title
        if match_key == "content_hash":
            return a.content_hash
        return a.source_identifier

    existing_by_key = {}
    for a in existing_children:
        k = _key(a)
        if k is not None:
            existing_by_key[k] = a

    stats = {"inserted": 0, "kept": 0, "updated": 0, "superseded": 0, "orphaned": 0}
    to_insert: List[Asset] = []

    for blueprint in expected:
        key = _key(blueprint)
        if key is None:
            to_insert.append(blueprint)        # anonymous → can't reconcile
            continue

        match = existing_by_key.pop(key, None)
        if match is None:
            to_insert.append(blueprint)
            continue

        bp_hash = blueprint.content_hash or derive_content_hash(
            blueprint.source_identifier, blueprint.text_content,
        )
        verdict = decide(match, bp_hash, on_change)  # the same matrix as build_outcome
        if verdict == "unchanged":
            stats["kept"] += 1
            continue

        if verdict == "update":
            _update_in_place(match, blueprint, bp_hash)
            session.add(match)
            stats["updated"] += 1
        else:  # "supersede"
            # Supersede via AssetBuilder (the single cascade write-site)
            await (
                AssetBuilder(session, user_id, infospace_id)
                .supersedes(match)
                .load(blueprint)
            )
            stats["superseded"] += 1

    if to_insert:
        await AssetBuilder(session, user_id, infospace_id).build_children(parent_id, to_insert)
        stats["inserted"] += len(to_insert)

    if existing_by_key:
        orphans = list(existing_by_key.values())
        if orphan_action == "mark_orphaned":
            for o in orphans:
                o.file_info = {**(o.file_info or {}), "orphaned": True}
                session.add(o)
            session.flush()
        elif orphan_action == "delete":
            purge(session, {o.id for o in orphans})
        stats["orphaned"] = len(orphans)

    return stats


def _update_in_place(match: Asset, blueprint: Asset, content_hash: Optional[str]) -> None:
    """Copy a freshly-extracted blueprint's content onto an existing child, KEEPING its
    row id — so the annotations referencing that id survive the reprocess. ``file_info``
    is merged (and any prior ``orphaned`` tag cleared, since the child reappeared)."""
    match.title = blueprint.title
    match.text_content = blueprint.text_content
    match.blob_path = blueprint.blob_path
    match.content_hash = content_hash
    if blueprint.part_index is not None:
        match.part_index = blueprint.part_index
    if blueprint.event_timestamp is not None:
        match.event_timestamp = blueprint.event_timestamp
    if getattr(blueprint, "modalities", None):
        match.modalities = blueprint.modalities
    if blueprint.processing_status is not None:
        match.processing_status = blueprint.processing_status
    merged = {**(match.file_info or {}), **(blueprint.file_info or {})}
    merged.pop("orphaned", None)
    match.file_info = merged
    match.updated_at = datetime.now(timezone.utc)


async def persist_children(
    session: Session,
    parent_id: int,
    children: List[Asset],
    *,
    user_id: int,
    infospace_id: int,
    match_key: MatchKey = "part_index",
) -> List[Asset]:
    """Persist a processor's freshly-extracted children, choosing the mode from STATE:

      • parent has no live children yet (first process) → **build** (bulk insert).
      • parent already has live children (a reprocess)   → **reconcile in place**
        (matched updated by id so annotations survive; vanished → orphaned; new → inserted).

    The processor never decides build-vs-reconcile — it hands over what it extracted and
    this picks. Returns the parent's live (non-orphaned) children for the caller to emit
    ``asset.processed`` on. Flush-only; caller commits.
    """
    has_existing = session.exec(
        select(Asset.id)
        .where(Asset.parent_asset_id == parent_id)
        .where(Asset.is_superseded == False)  # noqa: E712
        .limit(1)
    ).first()

    if has_existing is None:
        await AssetBuilder(session, user_id, infospace_id).build_children(parent_id, children)
    else:
        await reconcile_children(
            session, parent_id, children, user_id=user_id, infospace_id=infospace_id,
            match_key=match_key, on_change="update", orphan_action="mark_orphaned",
        )

    live = session.exec(
        select(Asset)
        .where(Asset.parent_asset_id == parent_id)
        .where(Asset.is_superseded == False)  # noqa: E712
        .order_by(Asset.part_index)
    ).all()
    return [c for c in live if not (c.file_info or {}).get("orphaned")]
