"""Add partial B-tree indexes for hot watcher query paths.

Revision ID: h9i0j1k2l3m4
Revises: g8h9i0j1k2l3
Create Date: 2026-02-26

Optimizes dispatch_reactive_work watcher queries at scale:
- OCR pending: PDF_PAGE children needing OCR (image modality, no ocr_used)
- Hash missing: top-level assets with blob_path but no content_hash
- Embed ready: READY assets with text_content but no AssetChunk (excludes containers)

These partial indexes enable index-only scans for the most frequent watcher paths.
"""
from alembic import op

revision = "h9i0j1k2l3m4"
down_revision = "g8h9i0j1k2l3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # OCR watcher: PDF_PAGE children with image modality, no ocr_used facet
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_asset_ocr_pending
        ON asset (id)
        WHERE processing_status = 'READY'
          AND kind = 'PDF_PAGE'
          AND parent_asset_id IS NOT NULL
          AND is_superseded = false
          AND parent_is_superseded = false
        """
    )
    # Hash watcher: top-level assets with blob_path but no content_hash
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_asset_hash_missing
        ON asset (id)
        WHERE processing_status = 'READY'
          AND content_hash IS NULL
          AND blob_path IS NOT NULL
          AND parent_asset_id IS NULL
          AND is_superseded = false
          AND parent_is_superseded = false
        """
    )
    # Embed watcher: READY assets with text_content, no chunk, not containers
    # (Container exclusion requires join to assetchunk - this index helps the base filter)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_asset_embed_ready
        ON asset (id)
        WHERE processing_status = 'READY'
          AND text_content IS NOT NULL
          AND parent_asset_id IS NULL
          AND is_superseded = false
          AND parent_is_superseded = false
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_asset_ocr_pending")
    op.execute("DROP INDEX IF EXISTS ix_asset_hash_missing")
    op.execute("DROP INDEX IF EXISTS ix_asset_embed_ready")
