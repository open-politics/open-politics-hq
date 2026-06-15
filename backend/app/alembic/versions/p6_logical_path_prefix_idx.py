"""phase6: partial text_pattern_ops index on asset.logical_path (vfolder prefix nav)

The scheme-aware vfolder tree navigates by path prefix:
``logical_path LIKE 'directory://cables/2010/%'``. A plain btree can't serve
``LIKE 'prefix%'`` under a non-C collation, so we add a ``text_pattern_ops``
index — and make it **partial** on ``parent_asset_id IS NULL`` because vfolders
only ever list root assets (children live inside their parent, not the tree).
Result: each folder click is an index range scan over the subtree — O(subtree),
not O(bundle) — which is what lets the tree scale to millions of assets per bundle.

Built CONCURRENTLY (outside a txn) so creating it on a large table doesn't take a
write lock. Coexists with the existing plain ``ix_asset_logical_path`` (that one
still serves ``=`` and ``ORDER BY logical_path``).
"""
from alembic import op
import sqlalchemy as sa

revision = "p6_logical_path_prefix_idx"
down_revision = "p6_backfill_logical_path_grammar"
branch_labels = None
depends_on = None

INDEX_NAME = "ix_asset_logical_path_prefix"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index(
            INDEX_NAME,
            "asset",
            [sa.text("logical_path text_pattern_ops")],
            unique=False,
            postgresql_where=sa.text("parent_asset_id IS NULL"),
            postgresql_concurrently=True,
            if_not_exists=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            INDEX_NAME,
            table_name="asset",
            postgresql_concurrently=True,
            if_exists=True,
        )
