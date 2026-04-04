"""Add handle column to user table.

Unique, indexed handle for user discovery and invitations.
Auto-generated for existing users via funky word combos.

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-04-01

"""
from alembic import op
import sqlalchemy as sa

revision = "i9j0k1l2m3n4"
down_revision = "h8i9j0k1l2m3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user", sa.Column("handle", sa.String(40), nullable=True))
    op.create_index("ix_user_handle", "user", ["handle"], unique=True)

    # --- Backfill existing users with funky handles ---
    from app.api.modules.identity_infospace_user.handle_gen import generate_handle
    from sqlmodel import Session, select
    from app.models import User

    bind = op.get_bind()
    session = Session(bind=bind)
    try:
        users = session.exec(select(User).where(User.handle == None)).all()  # noqa: E711
        for user in users:
            user.handle = generate_handle(session, full_name=user.full_name)
            session.add(user)
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    op.drop_index("ix_user_handle", table_name="user")
    op.drop_column("user", "handle")
