"""add ARCHIVE to the assetkind enum

The ARCHIVE AssetKind (zip/tar/gz container — incr-3 archive-as-Type) was added to
the Python ``AssetKind`` enum but never to the Postgres ``assetkind`` enum, so
persisting an ARCHIVE asset raised ``DataError: invalid input value for enum
assetkind: "ARCHIVE"``. It lay dormant because archive ingestion was never
live-DB-tested until the pre-cutover verification. The column stores enum *names*
(PDF / WEB / RSS_FEED / …), so we add the name ``ARCHIVE``.
"""
from alembic import op

revision = "q2_add_archive_assetkind"
down_revision = "q1_source_warning_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on some PG
    # versions → autocommit (matches the project's other enum/index migrations).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE assetkind ADD VALUE IF NOT EXISTS 'ARCHIVE'")


def downgrade() -> None:
    # Postgres cannot drop an enum value; the extra value is harmless, so this is a no-op.
    pass
