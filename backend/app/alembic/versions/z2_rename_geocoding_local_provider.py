"""rename geocoding provider key local -> nominatim_local

"local" was only unique because it was scoped to geocoding. HQ.yml indexes
providers by key across every capability, where it says nothing and reads as
the local/self_hosted context. Stored selections carry the old value, so they
move with it.

Two json columns hold one: user.provider_defaults.geocoding is a
ProviderSelection, infospace.enrichment_config.geocoding is either `true` or a
ProviderSelection. Only the geocoding slot is touched.

Revision ID: z2_rename_geocoding_local
Revises: z1_asset_live_identity
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "z2_rename_geocoding_local"
down_revision = "z1_asset_live_identity"
branch_labels = None
depends_on = None

OLD, NEW = "local", "nominatim_local"
TARGETS = (("user", "provider_defaults"), ("infospace", "enrichment_config"))


def _swap(old: str, new: str) -> None:
    conn = op.get_bind()
    for table, column in TARGETS:
        if not conn.execute(
            sa.text("SELECT to_regclass(:t)"), {"t": f'public."{table}"'}
        ).scalar():
            continue

        rows = conn.execute(
            sa.text(f'SELECT id, {column} FROM "{table}" WHERE {column} IS NOT NULL')
        ).fetchall()

        for row_id, blob in rows:
            if not isinstance(blob, dict):
                continue
            geo = blob.get("geocoding")
            if not isinstance(geo, dict) or geo.get("provider_key") != old:
                continue
            geo["provider_key"] = new
            conn.execute(
                sa.text(
                    f'UPDATE "{table}" SET {column} = CAST(:v AS json) WHERE id = :i'
                ),
                {"v": json.dumps(blob), "i": row_id},
            )


def upgrade() -> None:
    _swap(OLD, NEW)


def downgrade() -> None:
    _swap(NEW, OLD)
