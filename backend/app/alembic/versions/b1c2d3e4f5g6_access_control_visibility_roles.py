"""Access control: visibility field, new collaborator roles, package redesign.

Adds visibility to infospace (PRIVATE/INTERNAL/PUBLIC).
Extends CollaboratorRole enum with ANALYST and CURATOR.
Redesigns Package model with token, visibility, items.

Revision ID: b1c2d3e4f5g6
Revises: a0b1c2d3e4f5
Create Date: 2026-03-17

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "b1c2d3e4f5g6"
down_revision = "a0b1c2d3e4f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add visibility to infospace
    op.add_column(
        "infospace",
        sa.Column(
            "visibility",
            sa.String(),
            server_default="private",
            nullable=False,
        ),
    )

    # 2. Migrate existing EDITOR collaborators to ANALYST
    # Role is stored as String(32), not PostgreSQL enum — just update the values
    op.execute(
        "UPDATE infospacecollaborator SET role = 'analyst' WHERE role = 'editor'"
    )

    # 4. Redesign Package table
    # Add new columns to existing Package
    op.add_column("package", sa.Column("uuid", sa.String(), nullable=True))
    op.add_column("package", sa.Column("token", sa.String(), nullable=True))
    op.add_column("package", sa.Column("visibility", sa.String(), server_default="token", nullable=False))
    op.add_column("package", sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=True))
    op.add_column("package", sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False))
    op.add_column("package", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("package", sa.Column("default_allow_download", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("package", sa.Column("default_allow_copy", sa.Boolean(), server_default="false", nullable=False))

    # Generate UUIDs and tokens for existing packages
    # Use md5(random()::text) as a portable alternative to gen_random_uuid()
    op.execute(
        "UPDATE package SET uuid = md5(random()::text || clock_timestamp()::text) WHERE uuid IS NULL"
    )
    op.execute(
        "UPDATE package SET token = md5(random()::text || clock_timestamp()::text) "
        "|| md5(random()::text) WHERE token IS NULL"
    )

    # Make uuid and token non-nullable + unique
    op.alter_column("package", "uuid", nullable=False)
    op.alter_column("package", "token", nullable=False)
    op.create_index("ix_package_uuid", "package", ["uuid"], unique=True)
    op.create_index("ix_package_token", "package", ["token"], unique=True)

    # 5. Create PackageItem table
    op.create_table(
        "packageitem",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("package_id", sa.Integer(), sa.ForeignKey("package.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_type", sa.String(), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=False),
        sa.Column("allow_download", sa.Boolean(), nullable=True),  # NULL = use package default
        sa.Column("allow_copy", sa.Boolean(), nullable=True),      # NULL = use package default
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_packageitem_package", "packageitem", ["package_id"])
    op.create_index("ix_packageitem_resource", "packageitem", ["resource_type", "resource_id"])


def downgrade() -> None:
    op.drop_table("packageitem")
    op.drop_index("ix_package_token", table_name="package")
    op.drop_index("ix_package_uuid", table_name="package")
    op.drop_column("package", "default_allow_copy")
    op.drop_column("package", "default_allow_download")
    op.drop_column("package", "expires_at")
    op.drop_column("package", "is_active")
    op.drop_column("package", "user_id")
    op.drop_column("package", "visibility")
    op.drop_column("package", "token")
    op.drop_column("package", "uuid")
    op.drop_column("infospace", "visibility")
    # Note: Cannot remove enum values in PostgreSQL
