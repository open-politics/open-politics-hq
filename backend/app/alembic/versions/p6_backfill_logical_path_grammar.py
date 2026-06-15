"""phase6: backfill legacy bare logical_paths into the scheme://authority grammar

Legacy directory imports stored bare logical_paths whose first segment is already the
dataset (e.g. "cables/2010/x.pdf"). Normalize each to the grammar by **prepending the
scheme** (``directory://cables/2010/x.pdf``) so its first segment becomes the mount.
Assets with NULL logical_path (loose uploads, articles) stay NULL — flat in their
bundle, never in a vfolder tree. NOTE: one-time normalization only — the old bare-path
handlers retire in Phase 8 and the vfolder tree tolerates bare paths meanwhile, so full
normalization really belongs at/after Phase 8. (The unused `_slug` helper below is dead
code — trivial Phase-9 lint cleanup.)

id-cursor batched (forward scan, each row visited once → O(n), not O(n²)), under
autocommit (no single giant txn over millions of rows), and idempotent (the
``!~ grammar`` filter skips already-converted rows, so a crash-rerun resumes safely).
Runs BEFORE the prefix index so that index builds once over final data rather than
being maintained per-UPDATE. Forward-only: a backfilled path is indistinguishable
from a natively-minted one, so downgrade is a no-op by design.
"""
import re

from alembic import op
import sqlalchemy as sa

revision = "p6_backfill_logical_path_grammar"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None

_SLUG = re.compile(r"[^A-Za-z0-9._-]+")
_BATCH = 5000

# Forward scan by id: the PK index serves `id > :last_id ORDER BY id`, the regex
# filters bare (non-grammar) rows in that range. The bare path already carries the
# dataset as its first segment (e.g. "cables/2010/x.pdf"), so the conversion just
# prepends the scheme — the first segment becomes the mount/authority.
_SELECT_BARE = sa.text("""
    SELECT a.id, a.logical_path
    FROM asset a
    WHERE a.id > :last_id
      AND a.logical_path IS NOT NULL
      AND a.logical_path !~ '^[a-z][a-z0-9_]*://'
    ORDER BY a.id
    LIMIT :batch
""")

_UPDATE = sa.text("UPDATE asset SET logical_path = :lp WHERE id = :id")


def _slug(name) -> str:
    return _SLUG.sub("-", (name or "").strip()).strip("-") or "imports"


def upgrade() -> None:
    conn = op.get_bind()
    last_id = 0
    with op.get_context().autocommit_block():
        while True:
            rows = conn.execute(_SELECT_BARE, {"last_id": last_id, "batch": _BATCH}).fetchall()
            if not rows:
                break
            for asset_id, bare in rows:
                conn.execute(_UPDATE, {"lp": "directory://" + (bare or "").lstrip("/"), "id": asset_id})
            last_id = rows[-1][0]


def downgrade() -> None:
    # Forward-only: a backfilled path is indistinguishable from a natively-minted
    # grammar path, so stripping would corrupt new-source assets. No-op by design.
    pass
