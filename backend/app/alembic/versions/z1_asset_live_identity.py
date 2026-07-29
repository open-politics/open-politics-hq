"""Enforce asset identity: one live root per (infospace_id, source_identifier).

Revision ID: z1_asset_live_identity
Revises: y1_canon_type_schemas
Create Date: 2026-07-28

Dedup was advisory — ``AssetBuilder.find_match()`` SELECTed and the builder INSERTed with
nothing in between and no constraint, so two concurrent ingest jobs both saw "no match"
and both inserted. Measured on dev: 318k redundant rows out of 328k live roots, still
accruing at ~20% of newly created assets.

Both predicates are load-bearing, not defensive:

  ``is_superseded = false``   ``_do_supersede`` deliberately KEEPS the old row under the
                              same identifier and inserts a new one. A non-partial
                              constraint would break versioning on the first supersede.
  ``parent_asset_id IS NULL`` Children legitimately reuse identifiers — archive members
                              carry their position, ``reconcile_children`` matches on
                              ``source_identifier``, a page's images repeat across pages.

So the index says exactly what we mean: *at most one LIVE ROOT per identity, with
unlimited superseded versions behind it.*

It is also the composite index this query never had. ``find_match`` filters
(infospace_id, source_identifier, is_superseded, parent_asset_id) and the only thing
serving it was the single-column ``ix_asset_source_identifier`` — ``ix_asset_source_active_roots``
leads on ``source_id``, the Source FK, which the query never touches. Measured before:
32 ms / 3,551 buffers on a 3,334-copy identifier. So this is a read-side win, not a tax.

Requires ``scripts/dedup_assets.py --apply`` to have run. If duplicates remain this
migration fails — which is the point: the index IS the proof the cleanup worked.
"""

from alembic import op


revision = "z1_asset_live_identity"
down_revision = "y1_canon_type_schemas"
branch_labels = None
depends_on = None


INDEX_NAME = "ux_asset_live_identity"

# Keep this predicate textually in lockstep with AssetBuilder._IDENTITY_INDEX_WHERE —
# Postgres infers ON CONFLICT targets by matching the index predicate, and a mismatch
# silently degrades to "no inference target" (a runtime error), not to a wrong result.
PREDICATE = "parent_asset_id IS NULL AND is_superseded = false AND source_identifier IS NOT NULL"


def upgrade() -> None:
    # CONCURRENTLY cannot run inside a transaction; alembic wraps migrations in one.
    with op.get_context().autocommit_block():
        op.execute(
            f"CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS {INDEX_NAME} "
            f"ON asset (infospace_id, source_identifier) WHERE {PREDICATE}"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX_NAME}")
