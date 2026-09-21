"""Deleting a run, schema or asset: ON DELETE CASCADE on composition FKs.

``u1_infospace_cascade_delete`` made the schema own the cascade, but scoped
itself to *ownership* — the ``infospace_id`` FKs — and noted of the deeper rows
that "their parents (asset, run, entity, conversation, flow) are not
hard-deleted outside the infospace-delete path". That stopped being true: the
API hard-deletes runs, schemas and assets on their own.

So every one of those deletes failed, and the infospace delete failed with them:

  * ``DELETE /runs/{id}``   → NotNullViolation on ``annotation.run_id``. The ORM
    has no cascade on ``AnnotationRun.annotations``, so SQLAlchemy disassociated
    the children — ``UPDATE annotation SET run_id = NULL`` — against a NOT NULL
    column. Even had it not, the FK was NO ACTION and would have refused.
  * ``DELETE`` a schema or an asset → the same FK, from the other two parents.
  * ``DELETE`` an infospace → ``runschemalink`` has no ``infospace_id``, so it
    survived the ownership cascade and blocked the ``annotationschema`` rows it
    still referenced. Its sibling ``runschemalink.run_id`` was already CASCADE;
    only the schema side was missed.

An annotation is *part of* its run, its schema and its asset — none of the three
leaves anything meaningful behind — and a link row means nothing without either
end. ``graphedge.annotation_id`` is here for the same reason and because it is
NOT NULL: an edge derived from an annotation cannot outlive it, and on a run
delete the edge would otherwise survive its own provenance and block.

Still deliberately NO ACTION, unchanged: ``fragmentcuration.*``. Human curation
must never be dropped by a cascade — the run-delete path clears it explicitly,
the way ``delete_infospace`` already did.

Revision ID: a3_composition_cascade_delete
Revises: z2_rename_geocoding_local
"""
from alembic import op

revision = "a3_composition_cascade_delete"
down_revision = "z2_rename_geocoding_local"
branch_labels = None
depends_on = None

# (constraint_name, table, local_col, ref_table, ref_col)
_FKS = [
    ("annotation_run_id_fkey", "annotation", "run_id", "annotationrun", "id"),
    ("annotation_schema_id_fkey", "annotation", "schema_id", "annotationschema", "id"),
    ("annotation_asset_id_fkey", "annotation", "asset_id", "asset", "id"),
    ("runschemalink_schema_id_fkey", "runschemalink", "schema_id", "annotationschema", "id"),
    ("graphedge_annotation_id_fkey", "graphedge", "annotation_id", "annotation", "id"),
]


def _recreate(ondelete) -> None:
    for name, table, col, ref, refcol in _FKS:
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, ref, [col], [refcol], ondelete=ondelete)


def upgrade() -> None:
    _recreate("CASCADE")


def downgrade() -> None:
    _recreate(None)
