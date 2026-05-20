"""Hard-reset AnnotationRun.views_config for the Formula/Panel unroll.

The intelligence layer's stored shape changed incompatibly: ``PanelProjection``
(roles/scalars/edges/axes) is replaced by the six-verb ``Formula`` + thin
``Panel``. Per the unroll plan this is a deliberate **hard cut** — existing
formulas/observations/panels are disposable (the feature was barely adopted and
the old shape cannot be faithfully converted). Every run's ``views_config`` is
reset to the empty new-shape dashboard.

Not silently destructive: the pre-reset value is stashed in
``views_config_pre_formula_unroll`` so ``downgrade()`` fully restores it. The
column is dropped on downgrade.

Revision ID: f0rmula1unr0
Revises: s1f2g3h4i5
Create Date: 2026-05-18

"""
from __future__ import annotations

import logging

from alembic import op
from sqlalchemy import inspect, text

revision = "f0rmula1unr0"
down_revision = "s1f2g3h4i5"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.views_config_hard_reset")

_EMPTY_DASHBOARD = '{"panels": [], "formulas": [], "observations": [], "notes_md": ""}'


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("annotationrun")}

    if "views_config_pre_formula_unroll" not in cols:
        op.execute(
            "ALTER TABLE annotationrun "
            "ADD COLUMN views_config_pre_formula_unroll JSONB"
        )

    # Stash the pre-reset value once (idempotent: only where not already stashed).
    op.execute(
        text(
            "UPDATE annotationrun "
            "SET views_config_pre_formula_unroll = views_config "
            "WHERE views_config IS NOT NULL "
            "  AND views_config_pre_formula_unroll IS NULL"
        )
    )

    res = bind.execute(
        text(
            "UPDATE annotationrun "
            "SET views_config = CAST(:empty AS jsonb) "
            "WHERE views_config IS NOT NULL"
        ),
        {"empty": _EMPTY_DASHBOARD},
    )
    logger.info(
        "views_config hard-reset complete: %s run(s) reset "
        "(pre-reset shape retained in views_config_pre_formula_unroll)",
        res.rowcount,
    )


def downgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("annotationrun")}
    if "views_config_pre_formula_unroll" in cols:
        op.execute(
            text(
                "UPDATE annotationrun "
                "SET views_config = views_config_pre_formula_unroll "
                "WHERE views_config_pre_formula_unroll IS NOT NULL"
            )
        )
        op.execute(
            "ALTER TABLE annotationrun DROP COLUMN views_config_pre_formula_unroll"
        )
