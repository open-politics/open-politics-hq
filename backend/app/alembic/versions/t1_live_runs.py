"""Live runs: add `live` flag, drop the family tier (`parent_run_id`), index the
coverage anti-join.

- annotationrun.live: a live run stays alive — it cycles
  PENDING → RUNNING → COMPLETED(idle, watching) → PENDING as the `live_runs`
  reconciler re-pends it on new content in scope. Existing continuous runs
  (source_bundle_id set) become live so they finally get their missing poll.
- Drop annotationrun.parent_run_id: the family/rollup tier is removed. Extension
  now grows a run in place; version drift creates independent runs.
- ix_annotation_run_asset_status: the streaming delta's coverage anti-join
  ("pairs this run has already done") seeks instead of scanning at 400k+.

Revision ID: t1_live_runs
Revises: s1_source_drift_and_breaker
"""

from alembic import op
import sqlalchemy as sa

revision = "t1_live_runs"
down_revision = "s1_source_drift_and_breaker"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `live` flag — non-null with a server default so existing rows backfill.
    op.add_column(
        "annotationrun",
        sa.Column("live", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_annotationrun_live", "annotationrun", ["live"], unique=False)

    # Existing continuous runs become live — this is what finally gives them the
    # reconcile poll the old "self-extend on poll" comment promised.
    op.execute(
        "UPDATE annotationrun SET live = true WHERE source_bundle_id IS NOT NULL"
    )

    # Drop the family tier. Postgres cascades the FK + index with the column.
    op.drop_column("annotationrun", "parent_run_id")

    # Streaming coverage anti-join: "assets this run has a non-failed annotation
    # for, across all its schemas." Composite seek beats the single-column index.
    op.create_index(
        "ix_annotation_run_asset_status",
        "annotation",
        ["run_id", "asset_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_annotation_run_asset_status", table_name="annotation")

    op.add_column(
        "annotationrun",
        sa.Column("parent_run_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_annotationrun_parent_run_id",
        "annotationrun",
        "annotationrun",
        ["parent_run_id"],
        ["id"],
    )
    op.create_index(
        "ix_annotationrun_parent_run_id", "annotationrun", ["parent_run_id"], unique=False
    )

    op.drop_index("ix_annotationrun_live", table_name="annotationrun")
    op.drop_column("annotationrun", "live")
