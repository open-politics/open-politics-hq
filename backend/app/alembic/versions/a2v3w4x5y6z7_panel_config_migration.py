"""Migrate AnnotationRun.views_config to the typed PanelConfig v2 shape.

Reads every ``AnnotationRun.views_config`` list, routes each panel dict
through ``migrate_panel_config`` to hoist legacy ``settings`` bag keys into
typed sub-models (``graph_settings``, ``chart_settings``, etc.), drop the
inert ``inspection_granularity``, and stamp ``version=2``.

Idempotent — re-running on already-migrated panels is a no-op because v2
entries round-trip cleanly through the migrator. Individual panels that
fail validation are logged and removed from the run's config rather than
failing the whole batch.

Revision ID: a2v3w4x5y6z7
Revises: z1u2v3w4x5y6
Create Date: 2026-04-22

"""
from __future__ import annotations

import json
import logging

from alembic import op
from sqlalchemy import text

revision = "a2v3w4x5y6z7"
# Merge the two heads that existed at branch time (main flow state rev and
# the asset-source index rev). This migration converges them.
down_revision = ("z1u2v3w4x5y6", "c1d2e3f4g5h6")
branch_labels = None
depends_on = None


logger = logging.getLogger("alembic.panel_config_migration")


def upgrade() -> None:
    # Lazy import to avoid pulling app code at revision registration time.
    from app.api.modules.annotation.panel_config import migrate_views_config
    import sqlalchemy as sa
    from sqlalchemy.dialects.postgresql import JSONB

    conn = op.get_bind()

    # Safety rail: back up the pre-migration shape into a new column so
    # operators can roll back or inspect the original if anything is off.
    # Idempotent — checks for column existence first.
    inspector = sa.inspect(conn)
    existing_columns = {col["name"] for col in inspector.get_columns("annotationrun")}
    if "views_config_legacy_v1" not in existing_columns:
        op.add_column(
            "annotationrun",
            sa.Column(
                "views_config_legacy_v1",
                JSONB(astext_type=sa.Text()),
                nullable=True,
            ),
        )
        conn.execute(
            text(
                "UPDATE annotationrun "
                "SET views_config_legacy_v1 = views_config "
                "WHERE views_config IS NOT NULL "
                "  AND views_config_legacy_v1 IS NULL"
            )
        )

    rows = conn.execute(
        text("SELECT id, views_config FROM annotationrun WHERE views_config IS NOT NULL")
    ).fetchall()

    migrated_runs = 0
    migrated_entries = 0

    for row in rows:
        run_id = row[0]
        raw_list = row[1]
        if not raw_list:
            continue
        if isinstance(raw_list, str):
            try:
                raw_list = json.loads(raw_list)
            except Exception:
                logger.warning("run %s views_config is invalid JSON; skipping", run_id)
                continue

        new_list = migrate_views_config(raw_list)
        migrated_entries += len(new_list)
        migrated_runs += 1

        conn.execute(
            text("UPDATE annotationrun SET views_config = CAST(:vc AS jsonb) WHERE id = :rid"),
            {"vc": json.dumps(new_list), "rid": run_id},
        )

    logger.info(
        "panel_config_migration: migrated %d entries across %d runs "
        "(pre-migration shape retained in views_config_legacy_v1)",
        migrated_entries, migrated_runs,
    )


def downgrade() -> None:
    """Restore the pre-migration views_config from the backup column.

    If ``views_config_legacy_v1`` exists and holds a non-null value, copy it
    back into ``views_config``. Then drop the backup column.
    """
    conn = op.get_bind()
    import sqlalchemy as sa
    inspector = sa.inspect(conn)
    existing_columns = {col["name"] for col in inspector.get_columns("annotationrun")}
    if "views_config_legacy_v1" in existing_columns:
        conn.execute(text(
            "UPDATE annotationrun "
            "SET views_config = views_config_legacy_v1 "
            "WHERE views_config_legacy_v1 IS NOT NULL"
        ))
        op.drop_column("annotationrun", "views_config_legacy_v1")
