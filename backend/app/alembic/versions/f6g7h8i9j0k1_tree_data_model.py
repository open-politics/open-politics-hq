"""Tree data model: ROOT=0, NOT NULL, sealed bundles, validation trigger.

Migrates bundle/asset tree from nullable NULL=root to NOT NULL 0=root.
Adds sealed column, parent-scoped unique constraint, validation trigger.

Revision ID: f6g7h8i9j0k1
Revises: e5f6g7h8i9j0
Create Date: 2026-03-25

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
import logging

log = logging.getLogger(__name__)

revision = "f6g7h8i9j0k1"
down_revision = "e5f6g7h8i9j0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. Update cleanup trigger FIRST (must normalize to {0} before NOT NULL) ──

    conn.execute(text("""
        CREATE OR REPLACE FUNCTION cleanup_bundle_ids() RETURNS trigger AS $$
        BEGIN
            UPDATE asset
            SET bundle_ids = CASE
                WHEN array_length(array_remove(bundle_ids, OLD.id), 1) IS NULL
                    THEN ARRAY[0]::int[]
                ELSE array_remove(bundle_ids, OLD.id)
            END
            WHERE bundle_ids @> ARRAY[OLD.id];
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
    """))

    # ── 2. Migrate asset.bundle_ids: NULL → {0} ──

    null_count = conn.execute(text(
        "SELECT count(*) FROM asset WHERE bundle_ids IS NULL"
    )).scalar()
    empty_count = conn.execute(text(
        "SELECT count(*) FROM asset WHERE bundle_ids = '{}'"
    )).scalar()
    log.info(f"Migrating {null_count} NULL bundle_ids, {empty_count} empty arrays")

    conn.execute(text(
        "UPDATE asset SET bundle_ids = ARRAY[0]::int[] WHERE bundle_ids IS NULL"
    ))
    conn.execute(text(
        "UPDATE asset SET bundle_ids = ARRAY[0]::int[] WHERE bundle_ids = '{}'"
    ))

    # Verify
    remaining = conn.execute(text(
        "SELECT count(*) FROM asset WHERE bundle_ids IS NULL"
    )).scalar()
    assert remaining == 0, f"Migration incomplete: {remaining} assets still NULL"

    # Make NOT NULL
    conn.execute(text(
        "ALTER TABLE asset ALTER COLUMN bundle_ids SET NOT NULL"
    ))
    conn.execute(text(
        "ALTER TABLE asset ALTER COLUMN bundle_ids SET DEFAULT ARRAY[0]::int[]"
    ))

    # ── 3. Update CHECK constraint ──

    conn.execute(text(
        "ALTER TABLE asset DROP CONSTRAINT IF EXISTS ck_asset_bundle_ids_no_empty"
    ))
    conn.execute(text(
        "ALTER TABLE asset ADD CONSTRAINT ck_asset_bundle_ids_no_empty "
        "CHECK (array_length(bundle_ids, 1) > 0)"
    ))

    # ── 4. Drop self-referential FK (must happen before setting parent=0) ──

    conn.execute(text("""
        DO $$
        DECLARE
            fk_name text;
        BEGIN
            SELECT conname INTO fk_name
            FROM pg_constraint
            WHERE conrelid = 'bundle'::regclass
            AND confrelid = 'bundle'::regclass
            AND contype = 'f';

            IF fk_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE bundle DROP CONSTRAINT %I', fk_name);
            END IF;
        END $$;
    """))

    # ── 5. Migrate bundle.parent_bundle_id: NULL → 0 ──

    null_parents = conn.execute(text(
        "SELECT count(*) FROM bundle WHERE parent_bundle_id IS NULL"
    )).scalar()
    log.info(f"Migrating {null_parents} NULL parent_bundle_id values")

    conn.execute(text(
        "UPDATE bundle SET parent_bundle_id = 0 WHERE parent_bundle_id IS NULL"
    ))

    remaining = conn.execute(text(
        "SELECT count(*) FROM bundle WHERE parent_bundle_id IS NULL"
    )).scalar()
    assert remaining == 0, f"Migration incomplete: {remaining} bundles still NULL parent"

    # Make NOT NULL with default
    conn.execute(text(
        "ALTER TABLE bundle ALTER COLUMN parent_bundle_id SET NOT NULL"
    ))
    conn.execute(text(
        "ALTER TABLE bundle ALTER COLUMN parent_bundle_id SET DEFAULT 0"
    ))

    # ── 6. Add validation trigger ──

    conn.execute(text("""
        CREATE OR REPLACE FUNCTION validate_parent_bundle_id() RETURNS trigger AS $$
        BEGIN
            IF NEW.parent_bundle_id != 0 AND NOT EXISTS (
                SELECT 1 FROM bundle WHERE id = NEW.parent_bundle_id
            ) THEN
                RAISE EXCEPTION 'parent_bundle_id % does not reference an existing bundle',
                    NEW.parent_bundle_id;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """))
    conn.execute(text("""
        CREATE TRIGGER trg_validate_parent_bundle_id
            BEFORE INSERT OR UPDATE OF parent_bundle_id ON bundle
            FOR EACH ROW EXECUTE FUNCTION validate_parent_bundle_id();
    """))

    # ── 7. Update UniqueConstraint: scope to parent ──

    # Drop old constraint (infospace_id, name, version)
    conn.execute(text("""
        DO $$
        DECLARE
            uc_name text;
        BEGIN
            SELECT conname INTO uc_name
            FROM pg_constraint
            WHERE conrelid = 'bundle'::regclass
            AND contype = 'u'
            AND array_length(conkey, 1) = 3;

            IF uc_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE bundle DROP CONSTRAINT %I', uc_name);
            END IF;
        END $$;
    """))

    # Add new constraint (infospace_id, parent_bundle_id, name, version)
    conn.execute(text(
        "ALTER TABLE bundle ADD CONSTRAINT uq_bundle_infospace_parent_name_version "
        "UNIQUE (infospace_id, parent_bundle_id, name, version)"
    ))

    # ── 8. Add sealed column ──

    op.add_column("bundle", sa.Column("sealed", sa.Boolean(), nullable=False, server_default="false"))

    log.info("Tree data model migration complete")


def downgrade() -> None:
    conn = op.get_bind()

    # 1. Drop sealed column
    op.drop_column("bundle", "sealed")

    # 2. Drop validation trigger
    conn.execute(text("DROP TRIGGER IF EXISTS trg_validate_parent_bundle_id ON bundle"))
    conn.execute(text("DROP FUNCTION IF EXISTS validate_parent_bundle_id()"))

    # 3. Restore UniqueConstraint
    conn.execute(text(
        "ALTER TABLE bundle DROP CONSTRAINT IF EXISTS uq_bundle_infospace_parent_name_version"
    ))
    conn.execute(text(
        "ALTER TABLE bundle ADD CONSTRAINT bundle_infospace_id_name_version_key "
        "UNIQUE (infospace_id, name, version)"
    ))

    # 4. Restore cleanup trigger to old behavior (empty → NULL)
    conn.execute(text("""
        CREATE OR REPLACE FUNCTION cleanup_bundle_ids() RETURNS trigger AS $$
        BEGIN
            UPDATE asset
            SET bundle_ids = CASE
                WHEN array_length(array_remove(bundle_ids, OLD.id), 1) IS NULL THEN NULL
                ELSE array_remove(bundle_ids, OLD.id)
            END
            WHERE bundle_ids @> ARRAY[OLD.id];
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
    """))

    # 5. Re-add FK constraint on parent_bundle_id
    conn.execute(text(
        "ALTER TABLE bundle ALTER COLUMN parent_bundle_id DROP NOT NULL"
    ))
    conn.execute(text(
        "ALTER TABLE bundle ALTER COLUMN parent_bundle_id DROP DEFAULT"
    ))
    conn.execute(text(
        "UPDATE bundle SET parent_bundle_id = NULL WHERE parent_bundle_id = 0"
    ))
    conn.execute(text(
        "ALTER TABLE bundle ADD CONSTRAINT bundle_parent_bundle_id_fkey "
        "FOREIGN KEY (parent_bundle_id) REFERENCES bundle(id)"
    ))

    # 6. Restore old CHECK constraint
    conn.execute(text(
        "ALTER TABLE asset DROP CONSTRAINT IF EXISTS ck_asset_bundle_ids_no_empty"
    ))
    conn.execute(text(
        "ALTER TABLE asset ADD CONSTRAINT ck_asset_bundle_ids_no_empty "
        "CHECK (bundle_ids IS NULL OR array_length(bundle_ids, 1) > 0)"
    ))

    # 7. Make asset.bundle_ids nullable again
    conn.execute(text(
        "ALTER TABLE asset ALTER COLUMN bundle_ids DROP NOT NULL"
    ))
    conn.execute(text(
        "ALTER TABLE asset ALTER COLUMN bundle_ids DROP DEFAULT"
    ))
    conn.execute(text(
        "UPDATE asset SET bundle_ids = NULL WHERE bundle_ids = ARRAY[0]::int[]"
    ))
