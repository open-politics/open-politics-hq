"""Panel reshape — clear views_config for the new Panel model

Revision ID: g2k3l4m5n6o7
Revises: f0rmula1unr0
Create Date: 2026-05-21

The P2 reshape replaces the Panel binding triple
(``formula_id`` XOR ``observation_id`` XOR ``formula_inline``) with
inline ``formula`` + optional ``formula_ref``, plus a typed
``panel_config`` discriminated union (Pie/Chart/Map/Table/Graph/
Observation), top-level ``fields[]`` projection, and ``time_source``
at panel level. RunConfig.formulas[] (Workspace-saved formulas) is
preserved on a best-effort basis (the Formula primitive itself didn't
change), but the panels[] array is structurally incompatible with
the new model and is reset to ``[]``.

This is the second hard-reset of ``annotationrun.views_config``
(after ``f0rmula1unr0``). A backup of the old config is stored in the
``__panel_reshape_backup_views_config__`` column for one release.

The historical ``a2v3w4x5y6z7`` revision's ``migrate_views_config``
shim continues to no-op on fresh DBs.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "g2k3l4m5n6o7"
down_revision: Union[str, None] = "f0rmula1unr0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Reset ``annotationrun.views_config`` panels[] for the new Panel
    shape; preserve formulas[] and aliases[] best-effort.

    Old panels carried ``formula_id``/``observation_id``/
    ``formula_inline``; new panels carry inline ``formula`` +
    ``panel_config`` (typed per-type record). The structural mismatch
    means a generic migrator would be guesswork. Reset to ``[]``;
    panels are recreated through the new RolePicker UI.
    """
    bind = op.get_bind()

    # Add backup column (no harm if it already exists from prior runs).
    op.execute(
        "ALTER TABLE annotationrun ADD COLUMN IF NOT EXISTS "
        "__panel_reshape_backup_views_config__ JSONB"
    )

    rows = bind.execute(sa.text(
        "SELECT id, views_config FROM annotationrun WHERE views_config IS NOT NULL"
    )).fetchall()

    for row in rows:
        run_id = row.id
        cfg = row.views_config
        if not isinstance(cfg, dict):
            new_cfg = {"panels": [], "formulas": [], "aliases": []}
        else:
            new_cfg = {
                "panels": [],
                "formulas": cfg.get("formulas", []),
                "aliases": cfg.get("aliases", []),
                "observations": cfg.get("observations", []),
            }
        bind.execute(
            sa.text(
                "UPDATE annotationrun SET "
                "  __panel_reshape_backup_views_config__ = CAST(:bk AS jsonb), "
                "  views_config = CAST(:new AS jsonb) "
                "WHERE id = :rid"
            ),
            {
                "bk": _json_dumps(cfg),
                "new": _json_dumps(new_cfg),
                "rid": run_id,
            },
        )


def downgrade() -> None:
    """Restore the pre-reshape ``views_config`` from the backup column.

    The new Panel shape can't be downgraded into the old triple (data
    is lost in the forward direction); ``downgrade`` simply restores
    the backup wholesale.
    """
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, __panel_reshape_backup_views_config__ AS bk "
        "FROM annotationrun "
        "WHERE __panel_reshape_backup_views_config__ IS NOT NULL"
    )).fetchall()
    for row in rows:
        if row.bk is not None:
            bind.execute(
                sa.text(
                    "UPDATE annotationrun SET views_config = CAST(:bk AS jsonb) "
                    "WHERE id = :rid"
                ),
                {"bk": _json_dumps(row.bk), "rid": row.id},
            )


def _json_dumps(obj) -> str:
    """Local JSON serializer used for parameter binding. Avoids importing
    from app-level modules so the migration is dependency-light."""
    import json
    return json.dumps(obj)
