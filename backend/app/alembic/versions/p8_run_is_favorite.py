"""phase8: add annotationrun.is_favorite

Favorites move from client-side localStorage to a real run field so they
persist server-side and sync across devices. Set/cleared via the existing
PATCH /runs/{id} route (AnnotationRunUpdate). Indexed for cheap
"favorited runs" listing on the home surface.
"""
from alembic import op
import sqlalchemy as sa

revision = "p8_run_is_favorite"
down_revision = "p7_drop_sourcepollhistory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotationrun",
        sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_annotationrun_is_favorite", "annotationrun", ["is_favorite"])


def downgrade() -> None:
    op.drop_index("ix_annotationrun_is_favorite", table_name="annotationrun")
    op.drop_column("annotationrun", "is_favorite")
