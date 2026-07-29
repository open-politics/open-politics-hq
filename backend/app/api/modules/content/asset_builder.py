"""
Asset Builder — whether an asset row should exist, and writing it exactly once.

This module contains NO source-type knowledge. Every `from_rss_entry`,
`from_search_result`, `from_file`, `from_url`, `for_csv_row`, etc. lives in the
handler or processor that owns the domain. The boundary with its neighbours:

  content_hash()   what the bytes are
  AssetBuilder     whether this row should exist — and writing it exactly once
  content.tree     where it sits, how it moves, when it dies

What this module exposes:

  • `content_hash()` — THE content derivation, module-level, over text / bytes / a
    streamed Path. Nothing else in the codebase computes a content hash; sources hand
    over content, never digests (a blob caller is the one exception, since it holds
    bytes the builder never sees, and it passes them via `with_blob(path, digest)`).
    CI-grep enforced: `hashlib` appears nowhere else under `content/`.

  • `decide()` — THE identity/policy verdict.

  • `AssetBuilder` — fluent setters populate `self.row`, the actual Asset that will be
    inserted. Identity (`dedup_on`, `no_dedup`) and policy (`on_match`, `supersedes`)
    are the only state that is not the row.

  • Terminals: `persist(row)` is the one write path; `build()` runs it over the row the
    setters populated; `build_batch` / `build_children` are the dedup-free bulk inserts
    for intrinsic parts. NEVER commit — callers own the transaction.

  • Plural compositions built on the above: `persist_children` / `reconcile_children`
    (reconcile a container's re-extracted parts so their annotations survive).

See docs/plans/hq-v2/PRIMITIVES.md §1 for the full contract.
"""

import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.tree import purge

logger = logging.getLogger(__name__)


MatchPolicy = Literal["skip", "supersede", "update"]

# Must stay textually in lockstep with ux_asset_live_identity's predicate
# (alembic z1_asset_live_identity). Postgres infers an ON CONFLICT target by matching
# the index predicate; a mismatch raises at runtime rather than silently misbehaving.
_IDENTITY_INDEX = "ux_asset_live_identity"

# The columns dedup_on() will match on. Anything else is a caller typo, not a key.
_IDENTITY_KEYS = frozenset({"source_identifier", "content_hash", "title"})


_HASH_CHUNK = 1024 * 1024   # 1 MiB — streaming reads for Path inputs


def content_hash(data: "str | bytes | Path | None") -> Optional[str]:
    """THE content derivation. Nothing else in the codebase computes a content hash.

    Three input shapes, because that is every shape a caller can hold:

      ``str``    realized text        → hashed directly
      ``bytes``  an in-memory blob    → hashed directly
      ``Path``   a file on disk       → streamed in 1 MiB chunks (never fully read)

    md5 of the content and nothing else — no identifier salt, no truncation. It is a
    dedup key, not a security boundary, and it is the fastest digest available
    (measured 898 MB/s vs sha256's 551). Deliberately matches Postgres's built-in
    ``md5(text)`` so a backfill is one SQL statement rather than a Python loop.

    Returns None for empty content, so "no content" and "content that happens to be
    empty" cannot be confused — ``decide()`` relies on a missing hash never reading as
    "unchanged".
    """
    if data is None:
        return None
    h = hashlib.md5()
    if isinstance(data, Path):
        with open(data, "rb") as f:
            for chunk in iter(lambda: f.read(_HASH_CHUNK), b""):
                h.update(chunk)
        return h.hexdigest()
    if isinstance(data, str):
        if not data:
            return None
        # utf-8 to match PG's md5(text) under a UTF8 database encoding.
        h.update(data.encode("utf-8", errors="ignore"))
        return h.hexdigest()
    if not data:
        return None
    h.update(data)
    return h.hexdigest()


Verdict = Literal["create", "skip", "unchanged", "supersede", "update"]


def decide(
    match: Optional["Asset"], incoming_hash: Optional[str], policy: MatchPolicy,
) -> Verdict:
    """The ONE identity/policy decision — the stage-2 (content) verdict shared by
    ``persist`` and ``reconcile_children`` so the skip|supersede|update ×
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
class BuildOutcome:
    """What the build did: the asset plus the identity/policy verdict.

    Lets the ingestion loop count created vs skipped vs superseded accurately.
    The historical bug was callers counting ``len(assets)``, so dedup skips
    inflated ``IngestionJob.processed_files`` / ``Source.total_items_ingested``.
    ``status`` is the single authority for that decision — computed in
    ``persist()`` and nowhere else.
    """

    asset: "Asset"
    status: Literal["created", "skipped", "superseded", "updated"]


class AssetBuilder:
    """Fluent row construction + identity + policy + one guarded write.

    Every asset in the system is created through this builder. Handlers and
    processors compose setters — no `from_X` entry points on this class.

    The setters populate ``self.row`` — the actual ``Asset`` that will be inserted —
    rather than a parallel blueprint. There used to be an ``AssetBlueprint`` dataclass
    mirroring fifteen Asset columns, plus a ``_blueprint_to_asset`` translator to copy
    them across: two declarations and a copy step per field, and a whole second code
    path (``load``) for callers who already held a row. A partially-populated Asset is
    legal (SQLModel table models skip construction-time validation) and is not attached
    to the session until ``_insert_guarded``, so it can simply BE the row.

    Flush, never commit. The caller (route, @task, poll handler) owns the
    transaction boundary. Enforced by the flush-never-commit pytest fixture.
    """

    def __init__(self, session: Session, user_id: int, infospace_id: int):
        self.session = session
        self.row = Asset(user_id=user_id, infospace_id=infospace_id)
        # The only state that is NOT the row: how to match it, and what to do on a match.
        # `_keys` empty == identity undeclared; presence IS declaration, which is why
        # there is no _UNSET sentinel any more.
        self._keys: Dict[str, Any] = {}
        self._dedup_disabled = False
        self._policy: MatchPolicy = "skip"
        self._supersede_target: Optional[Asset] = None

    # ═══════════════════════════════════════════════════════════════
    # BLUEPRINT SETTERS
    # ═══════════════════════════════════════════════════════════════

    def as_kind(self, kind: AssetKind) -> "AssetBuilder":
        self.row.kind = kind
        return self

    def with_title(self, title: str) -> "AssetBuilder":
        self.row.title = title
        return self

    def with_text(self, text: str) -> "AssetBuilder":
        """Set text_content. Replaces any prior value."""
        self.row.text_content = text
        return self

    def with_source(self, identifier: str) -> "AssetBuilder":
        """Set source_identifier (URL, feed entry id, file path, etc.)."""
        self.row.source_identifier = identifier
        return self

    def with_blob(self, path: str, digest: Optional[str] = None) -> "AssetBuilder":
        """Point the asset at storage the caller already wrote, with its digest.

        ``digest`` is the ONLY way to hand the builder a content hash, and that is
        deliberate: a blob caller holds bytes the builder never sees, so it must hash
        them itself. Text callers hand over text and the builder derives — which is why
        there is no ``with_content_hash``. The invalid state (a hand-rolled text hash
        disagreeing with the one derivation) is now unrepresentable rather than
        caught by an assertion after the fact.
        """
        self.row.blob_path = path
        if digest is not None:
            self.row.content_hash = digest
        return self

    def with_source_token(self, token: str) -> "AssetBuilder":
        """Set source_token — the cheap drift change-token (etag / mtime / pubdate).
        Root assets only; a changed token is what drives re-fetch + supersede."""
        self.row.source_token = token
        return self

    def with_source_id(self, source_id: int) -> "AssetBuilder":
        """Link the asset to the Source that produced it (monitoring / provenance).
        Distinct from ``with_source()``, which sets the source_identifier dedup key."""
        self.row.source_id = source_id
        return self

    def into_bundle(self, bundle_id: int) -> "AssetBuilder":
        """Place the asset in ``bundle_id``. Omit to leave it at ROOT — the column's
        non-empty server_default handles that, which is why an unplaced row reads as
        ``None`` here and only becomes ``{0}`` once Postgres writes it."""
        self.row.bundle_ids = [bundle_id]
        return self

    def with_metadata(self, **kwargs) -> "AssetBuilder":
        """Merge into file_info (ingestion/processing metadata)."""
        self.row.file_info = {**(self.row.file_info or {}), **kwargs}
        return self

    def with_facets(self, **kwargs) -> "AssetBuilder":
        """Merge into facets (enricher-style discoverable properties).
        Scalars and flat lists only (per content/facets.py invariant)."""
        self.row.facets = {**(self.row.facets or {}), **kwargs}
        return self

    def with_timestamp(self, ts: datetime) -> "AssetBuilder":
        self.row.event_timestamp = ts
        return self

    def as_child_of(self, parent_id: int, part_index: Optional[int] = None) -> "AssetBuilder":
        self.row.parent_asset_id = parent_id
        if part_index is not None:
            self.row.part_index = part_index
        return self

    def with_part_index(self, part_index: int) -> "AssetBuilder":
        self.row.part_index = part_index
        return self

    def as_stub(self, stub: bool = True) -> "AssetBuilder":
        self.row.stub = stub
        if stub:
            # Stubs don't need processing
            self.row.processing_status = ProcessingStatus.READY
        return self

    def with_processing_status(self, status: ProcessingStatus) -> "AssetBuilder":
        self.row.processing_status = status
        return self

    # ═══════════════════════════════════════════════════════════════
    # IDENTITY (dedup_on, no_dedup)
    # ═══════════════════════════════════════════════════════════════

    def dedup_on(self, **keys: Any) -> "AssetBuilder":
        """Declare what "already have this" means: ``dedup_on(source_identifier=url)``.

        Accepts any of ``source_identifier`` / ``content_hash`` / ``title``; several are
        AND-ed. A dict rather than three sentinel-defaulted parameters, so "declared"
        simply means "present" — which is why there is no ``_UNSET`` any more.

        An empty key is rejected. Passing None would render as ``<column> IS NULL`` and
        match every identity-less row in the infospace, so a source that yielded a blank
        identifier would silently merge its item into an unrelated asset rather than
        create one. "I have no identity" is ``no_dedup()``, and it must be said out loud.
        """
        for name, value in keys.items():
            if name not in _IDENTITY_KEYS:
                raise ValueError(
                    f"dedup_on: unknown identity key {name!r}; expected one of "
                    f"{sorted(_IDENTITY_KEYS)}"
                )
            if not value:
                raise ValueError(
                    f"dedup_on({name}={value!r}) is not an identity — an empty key matches "
                    f"every row with a NULL {name}. Use .no_dedup() to always create."
                )
        self._keys.update(keys)
        self._dedup_disabled = False
        return self

    def no_dedup(self) -> "AssetBuilder":
        """Disable dedup explicitly — this build always creates a new row."""
        self._keys.clear()
        self._dedup_disabled = True
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
        self._policy = policy
        return self

    def supersedes(self, old_asset: Asset) -> "AssetBuilder":
        """Explicit supersede target — caller has already resolved the match.
        Builder skips the identity query; on_match is forced to 'supersede'."""
        if old_asset is None:
            raise ValueError("supersedes() requires a non-None Asset")
        self._supersede_target = old_asset
        self._policy = "supersede"
        return self

    # ═══════════════════════════════════════════════════════════════
    # TERMINALS
    # ═══════════════════════════════════════════════════════════════

    def find_match(self) -> Optional[Asset]:
        """The live ROOT matching the caller's declared identity keys, or None.

        Root-scoped, which is exactly what ``ux_asset_live_identity`` covers — children
        legitimately reuse identifiers (archive members carry their position,
        ``reconcile_children`` matches on ``source_identifier``), so an unscoped query
        could return a child and shadow a real root ingest.

        Distinct from ``_identity_owner()``, which asks the question the DB constraint
        asks. This one answers the CALLER's question, and the two need not agree — a
        caller may dedup on ``content_hash`` while carrying a ``source_identifier``.

        ``supersedes(old)`` short-circuits to ``old``.
        """
        if self._supersede_target is not None:
            return self._supersede_target
        if self._dedup_disabled or not self._keys:
            return None
        return self.session.exec(
            select(Asset)
            .where(
                Asset.infospace_id == self.row.infospace_id,
                Asset.is_superseded == False,  # noqa: E712
                Asset.parent_asset_id.is_(None),
                *(getattr(Asset, k) == v for k, v in self._keys.items()),
            )
            # id breaks created_at ties, so "which row matched" is never timing-dependent.
            # Only reachable for the non-unique keys — source_identifier can match at
            # most one live root.
            .order_by(Asset.created_at.desc(), Asset.id.desc())
            .limit(1)
        ).first()

    async def build(self) -> BuildOutcome:
        """Persist the row the fluent setters populated, and report what happened.

        A constructor in front of ``persist()`` — a fluent chain is simply one way to
        produce the row that ``persist`` reconciles. Flush-never-commit; the caller's
        transaction is the asset's unit of atomicity.
        """
        return await self.persist(self.row)

    async def persist(self, row: Asset) -> BuildOutcome:
        """THE terminal. Reconcile ``row`` against identity + policy, write, and report.

        Every asset this class writes goes through here — whether the caller described it
        with the fluent setters (``build()``) or handed over a row it had already
        extracted (``persist`` directly, from a processor or importer).

        This used to be two pipelines. ``load()`` was added for "importers and processors
        that already built the row", and the cheap way to add it was to copy the pipeline
        and adjust — so the copies aged apart. The loaded path had reimplemented the
        ``decide()`` matrix inline, never refreshed ``source_token`` on unchanged content
        (a re-fetch every poll, the exact storm ``unchanged`` exists to kill), never
        placed the asset in its bundle, replaced ``file_info`` instead of merging it, and
        reported a bare Asset so callers could not count outcomes. One pipeline means one
        branch to be right about.

        Identity and policy stay on the BUILDER (``dedup_on`` / ``on_match``) — they are
        configuration, not row data. Everything the asset IS lives on the row.

        Flush-never-commit; the caller owns the transaction.
        """
        self._finalize(row)

        # Negative space: identity is DECLARED, never inferred. Silently treating "no
        # keys" as "no dedup" is how a forgotten dedup_on() used to become duplicate
        # rows. It now fails worse than that: find_match returns None, the insert
        # collides with ux_asset_live_identity, and the re-find still finds nothing —
        # surfacing far from the actual mistake. Say which it is, here.
        assert self._dedup_disabled or self._supersede_target is not None or self._keys, (
            "declare identity before building: .dedup_on(source_identifier=…) to dedup, "
            "or .no_dedup() if this build must always create a new row"
        )

        # Identity + policy — the single decision (see ``decide`` above). The storm-prone
        # skip|supersede|update × content_hash matrix lives there, not interleaved here.
        match = self.find_match()
        incoming_hash = row.content_hash
        verdict = decide(match, incoming_hash, self._policy)

        if verdict == "create":
            new_asset = self._insert_guarded(row)
            if new_asset is not None:
                logger.info(
                    "Created asset id=%s (%s) %s",
                    new_asset.id, new_asset.kind.value if new_asset.kind else "?", new_asset.title,
                )
                return BuildOutcome(new_asset, "created")
            # The identity is taken. Resolve the owner by the INDEX's key, not by the
            # caller's dedup keys — the constraint told us precisely which row exists,
            # and the two need not agree: a caller may dedup on content_hash while still
            # carrying a source_identifier (POST /assets does exactly that), in which
            # case re-running find_match looks for the wrong thing and finds nothing.
            match = self._identity_owner(row)
            if match is None:
                # Not an assert: this is a race outcome, not a broken self-model. Under
                # READ COMMITTED the winner is committed when our insert is rejected, but
                # a third writer can supersede or purge it before this read — narrow, and
                # legal. The supersede branch below resolves the identical situation the
                # same way; treating one as impossible and the other as expected is how a
                # rare race becomes a 500.
                raise RuntimeError(
                    f"identity {row.source_identifier!r} was taken by a concurrent writer "
                    "and released again before it could be resolved; retry the build"
                )
            verdict = decide(match, incoming_hash, self._policy)

        if verdict == "skip":
            logger.debug("Matched asset id=%s, policy=skip, returning existing", match.id)
            self._place(match, row)
            return BuildOutcome(match, "skipped")

        if verdict == "unchanged":
            # Content identical — a drift signal moved (e.g. an mtime touch) but the bytes
            # did not. Refresh the stored token so the next poll's stage-1 guard skips without
            # a re-fetch; write nothing else. Idempotent, and applies to supersede AND update
            # policies — the latent supersede-side re-fetch storm dies here too.
            if row.source_token is not None and match.source_token != row.source_token:
                match.source_token = row.source_token
                self.session.add(match)
                self.session.flush()
            self._place(match, row)
            return BuildOutcome(match, "skipped")

        if verdict == "supersede":
            self._do_supersede(match)
            new_asset = row
            new_asset.previous_asset_id = match.id
            # A child version stays a child. reconcile_children hands its blueprints
            # straight here, and without this a supersede-mode reconcile would insert the
            # new version at ROOT — detaching it from its container (and, for a
            # root-shaped identifier, colliding with ux_asset_live_identity).
            if new_asset.parent_asset_id is None:
                new_asset.parent_asset_id = match.parent_asset_id
            inserted = self._insert_guarded(new_asset)
            if inserted is None:
                # Superseding freed the identity, and a concurrent writer took it before
                # we could. Our supersede stands (the old version is correctly retired);
                # theirs is now the live row, so hand that back rather than failing.
                owner = self._identity_owner(row)
                if owner is None:
                    raise RuntimeError(
                        f"identity {self.row.source_identifier!r} taken during "
                        f"supersede of asset {match.id}, but no live root owns it"
                    )
                logger.info(
                    "Superseded id=%s; a concurrent writer won the identity — returning id=%s",
                    match.id, owner.id,
                )
                return BuildOutcome(owner, "superseded")
            logger.info(
                "Superseded id=%s with new id=%s (%s)",
                match.id, new_asset.id, new_asset.title,
            )
            return BuildOutcome(new_asset, "superseded")

        # verdict == "update" — mutate the match in place from the row's non-None fields
        # (incl. source_token, so next poll's guard sees it as current — no re-update storm).
        self._apply_to(match, row)
        self.session.add(match)
        self.session.flush()
        self._place(match, row)
        logger.info("Updated asset id=%s in place", match.id)
        return BuildOutcome(match, "updated")

    async def build_batch(self, assets: List[Asset]) -> List[Asset]:
        """Bulk insert a list of pre-constructed Asset objects.

        No dedup, no enrichers. Flushes per chunk of 500. For processors
        inserting known children or importers inserting validated rows."""
        CHUNK_SIZE = 500
        for i, asset in enumerate(assets):
            if asset.user_id is None:
                asset.user_id = self.row.user_id
            if asset.infospace_id is None:
                asset.infospace_id = self.row.infospace_id
            elif asset.infospace_id != self.row.infospace_id:
                raise ValueError(
                    f"build_batch asset[{i}] infospace_id={asset.infospace_id} "
                    f"does not match builder's {self.row.infospace_id}"
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
                child.content_hash = content_hash(child.text_content)
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
        # NB: supersede is NOT root-only. reconcile_children(on_change="supersede") versions
        # individual children so their annotations stay attached to the version they were
        # made against. The unique index is scoped to roots precisely so that stays legal.
        old_asset.is_superseded = True
        self.session.add(old_asset)
        self.session.flush()   # the flag must be visible to the CTE below

        # Cascade to the WHOLE subtree, not just direct children. A one-level UPDATE
        # left grandchildren (archive → csv → rows, pdf → pages) with
        # parent_is_superseded = false, so they stayed eligible for the OCR / hash /
        # embed watcher indexes — every one of which filters on that flag — and kept
        # being enriched on behalf of a version nobody can reach any more.
        cascaded = self.session.execute(
            text("""
                WITH RECURSIVE tree AS (
                    SELECT id FROM asset WHERE parent_asset_id = :root
                    UNION ALL
                    SELECT a.id FROM asset a JOIN tree ON a.parent_asset_id = tree.id
                )
                UPDATE asset SET parent_is_superseded = true
                WHERE id IN (SELECT id FROM tree) AND parent_is_superseded = false
            """),
            {"root": old_asset.id},
        ).rowcount

        self.session.flush()
        logger.info(
            "Superseded asset id=%s (%s) — %d descendant(s) cascaded parent_is_superseded=True",
            old_asset.id, old_asset.title, cascaded,
        )

    def _identity_owner(self, row: Asset) -> Optional[Asset]:
        """The live root holding ``row``'s ``source_identifier``, if any.

        Deliberately independent of ``dedup_on()``: this asks the question the DB
        constraint asks, so it is the only correct way to resolve a unique violation.
        ``find_match`` answers the *caller's* question, which may be a different one —
        a caller can dedup on ``content_hash`` while carrying a ``source_identifier``.
        """
        if not row.source_identifier:
            return None
        return self.session.exec(
            select(Asset).where(
                Asset.infospace_id == row.infospace_id,
                Asset.source_identifier == row.source_identifier,
                Asset.is_superseded == False,  # noqa: E712
                Asset.parent_asset_id.is_(None),
            )
        ).first()

    def _insert_guarded(self, asset: Asset) -> Optional[Asset]:
        """THE insert. Every row this class writes goes through here.

        Returns the asset, or None when ``ux_asset_live_identity`` says someone else
        already owns this identity. Any other IntegrityError is re-raised — swallowing
        an unrelated constraint would turn a real bug into a silent skip.

        A SAVEPOINT around the ordinary ORM insert. The savepoint is the point: a bare
        ``except IntegrityError`` would poison the whole transaction, and in the ingest
        spine the transaction is a 200-item chunk — one collision would discard 199
        good items. Rolling back to a savepoint discards only this row.

        Measured, per insert (500 inserts, local socket):

            plain ORM add/flush, no conflict safety   1.94 ms
            savepoint + ORM add/flush                 2.20 ms   ← this
            ON CONFLICT DO NOTHING + RETURNING       13.00 ms

        The statement-level ``ON CONFLICT`` this replaced looked cheaper on paper — one
        statement, no savepoint round-trips — but SQLAlchemy's ORM-enabled-insert path
        costs ~6x more per call than a plain flush, which swamps the two extra round
        trips. Conflicts are rare (a genuine race); paying 0.26 ms on every insert to
        make them free is the right trade, paying 11 ms is not.
        """
        try:
            with self.session.begin_nested():
                self.session.add(asset)
                self.session.flush()
        except IntegrityError as exc:
            if _IDENTITY_INDEX not in str(getattr(exc, "orig", exc)):
                raise
            return None
        return asset

    def _place(self, match: Asset, row: Asset) -> None:
        """Give ``match`` — an asset we recognized rather than created — the bundle
        membership ``row`` asked for.

        Identity is content; placement is membership. Without this, enforcing uniqueness
        would silently starve the second of two sources feeding one feed into different
        bundles: it would match the existing asset, skip, and never place it. One asset,
        N bundles — which is exactly what the ``bundle_ids`` array is for.

        The intent is read off ``row``, the thing the caller described, NOT off
        ``self.row``. They are the same object for ``build()``, and different for every
        direct ``persist(row)`` caller — which is how ``POST /assets`` came to drop the
        placement on an idempotent re-post: the builder's own untouched row said "no
        bundles" and won over the row that actually carried them.

        Unplaced reads as ``None`` here and only becomes ``{0}`` once Postgres applies the
        server_default at INSERT, so "no placement intent" and "deliberately at ROOT" stay
        distinguishable at the moment it matters.

        The same rule the ingest spine applies at its tier-1 guard, which skips before a
        builder is ever constructed — both go through ``tree.place``, so "placed an asset"
        has one definition.
        """
        if match.id is None:
            return
        from app.api.modules.content.tree import place

        place(self.session, [match.id], row.bundle_ids)

    def _finalize(self, row: Asset) -> None:
        """Terminal-time defaults, applied to EVERY path.

        These used to live in ``_blueprint_to_asset``, which only the fluent path ran —
        so a directly-persisted row was inserted with ``content_hash = None`` and no
        ``ingested_at`` even though ``persist`` had just derived the hash for the verdict
        and thrown it away. Deferred to here rather than done in the setters because the
        hash depends on whatever text the caller ends up supplying.
        """
        if not row.kind:
            raise ValueError("AssetBuilder: kind must be set (.as_kind(...))")
        if not row.title:
            raise ValueError("AssetBuilder: title must be set (.with_title(...))")

        # Root-only drift tokens — the model declares this (models.py: "Set only on root
        # assets ... children are re-derived by processing, not fetched").
        assert row.parent_asset_id is None or row.source_token is None, (
            "source_token is a root-asset drift signal; children are re-derived, not fetched"
        )

        row.user_id = row.user_id or self.row.user_id
        row.infospace_id = row.infospace_id or self.row.infospace_id
        # A hash can only reach the row via with_blob(digest=…) or a caller's own row, so
        # deriving here can never disagree with a hand-rolled one — that state is
        # unrepresentable now rather than assert-guarded.
        row.content_hash = row.content_hash or content_hash(row.text_content)
        row.processing_status = row.processing_status or ProcessingStatus.READY
        # ingested_at for observability; an existing value wins (idempotent on rebuild).
        row.file_info = {"ingested_at": datetime.now(timezone.utc).isoformat(),
                         **(row.file_info or {})}

    @staticmethod
    def _apply_to(match: Asset, row: Asset) -> None:
        """Fold ``row``'s content onto an existing ``match``, KEEPING its row id — so
        annotations referencing that id survive. The one in-place update.

        Used by the ``update`` policy AND by ``reconcile_children`` when a container is
        reprocessed. Those were two functions (``_apply_to`` and ``_update_in_place``)
        doing the same job with different field lists: one remembered ``facets`` and
        ``source_token``, the other ``part_index``, ``modalities`` and clearing the
        ``orphaned`` tag. Each was missing what the other had. This is the union.

        The JSONB bags MERGE rather than replace — an update carries what this pass
        learned, not the whole history, and clobbering ``file_info`` would drop every
        earlier enrichment.
        """
        for attr in ("title", "text_content", "blob_path", "content_hash",
                     "event_timestamp", "processing_status", "part_index",
                     "modalities", "source_token"):
            value = getattr(row, attr, None)
            if value is not None:
                setattr(match, attr, value)
        if row.facets:
            match.facets = {**(match.facets or {}), **row.facets}
        # ``orphaned`` is cleared unconditionally: reaching here means the child
        # reappeared in a re-extract, so a stale tag from a previous pass must not stick.
        merged = {**(match.file_info or {}), **(row.file_info or {})}
        merged.pop("orphaned", None)
        match.file_info = merged
        match.updated_at = datetime.now(timezone.utc)


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
                builder.with_blob(src.blob_path, src.content_hash)
            if src.source_identifier:
                builder.with_source(src.source_identifier)
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
            # Identity first, content second. The copy carries src.source_identifier,
            # so deduping only on content_hash would let a transfer insert a second live
            # root for an identifier the target infospace already holds — a direct
            # violation of ux_asset_live_identity. Fall back to the content hash when the
            # source has no identifier (pasted text, generated assets).
            if src.source_identifier:
                builder.dedup_on(source_identifier=src.source_identifier).on_match("skip")
            elif src.content_hash:
                builder.dedup_on(content_hash=src.content_hash).on_match("skip")
            else:
                builder.no_dedup()

            new_asset = (await builder.build()).asset
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

    Blueprints carry no precomputed hash, so we derive one (``content_hash`` — the same
    derivation ``build_children`` stamps) to compare against the child.

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

        bp_hash = blueprint.content_hash or content_hash(blueprint.text_content)
        verdict = decide(match, bp_hash, on_change)  # the same matrix persist() uses
        if verdict == "unchanged":
            stats["kept"] += 1
            continue

        if verdict == "update":
            blueprint.content_hash = bp_hash
            AssetBuilder._apply_to(match, blueprint)
            session.add(match)
            stats["updated"] += 1
        else:  # "supersede"
            # Supersede via AssetBuilder (the single cascade write-site)
            await (
                AssetBuilder(session, user_id, infospace_id)
                .supersedes(match)
                .persist(blueprint)
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


async def persist_children(
    session: Session,
    parent_id: int,
    children: List[Asset],
    *,
    user_id: int,
    infospace_id: int,
    match_key: MatchKey = "part_index",
) -> List[Asset]:
    """Persist a processor's freshly-extracted children against whatever is already there.

    Matched children are updated BY ID so their annotations survive; children that
    vanished from the extract are tagged orphaned; new ones are inserted. Returns the
    parent's live (non-orphaned) children for the caller to emit ``asset.processed`` on.
    Flush-only; caller commits.

    This used to branch on "does the parent already have children?" — bulk-build on the
    first process, reconcile on a reprocess. The branch was redundant: with no existing
    children every blueprint matches nothing, lands in ``to_insert``, and reconcile calls
    the same ``build_children``. It bought one saved SELECT at the price of a
    state-dependent code path, which is a bug surface, not an optimization.
    """
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
