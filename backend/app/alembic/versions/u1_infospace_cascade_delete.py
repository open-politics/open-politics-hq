"""Infospace deletion: declare ON DELETE CASCADE on ownership FKs.

Deleting an infospace used to require a 187-line hand-ordered cascade in
InfospaceService that fought the ORM and got the order wrong (it NULLed the
NOT NULL collaborator FK, deleted bundles before the sources referencing them,
and never cleared entityeditlog). Make the schema own the cascade instead:
every FK that expresses ownership of an infospace — or of an infospace-owned
row — gets ON DELETE CASCADE, so a single `DELETE FROM infospace` removes the
whole subtree atomically and ordering bugs become structurally impossible.

Scope is ownership only. Deliberately left NO ACTION:
  * asset.source_id — sources DETACH (assets outlive them); see delete_source.
  * asset.parent/previous_asset_id, task.source_id, knowledgegraph.canon_id,
    graphedge.* , infospace.default_canon_id — same-subtree references that are
    satisfied by the deferred NO ACTION check when the whole infospace is
    removed in one statement.
  * fragmentcuration.* — human curation. Cleared explicitly by the service so a
    re-annotate that deletes annotations can never silently drop curation.

Cascade policy lives in migrations, matching the existing canon / entity /
collaborator / invitation cascades. alembic autogenerate does not compare
ondelete, so the plain `Field(foreign_key=...)` model declarations stay as-is.

Revision ID: u1_infospace_cascade_delete
Revises: t1_live_runs
"""
from alembic import op

revision = "u1_infospace_cascade_delete"
down_revision = "t1_live_runs"
branch_labels = None
depends_on = None

# (constraint_name, table, local_col, ref_table, ref_col)
_FKS = [
    # Direct infospace ownership.
    ("annotationschema_infospace_id_fkey", "annotationschema", "infospace_id", "infospace", "id"),
    ("bundle_infospace_id_fkey", "bundle", "infospace_id", "infospace", "id"),
    ("dataset_infospace_id_fkey", "dataset", "infospace_id", "infospace", "id"),
    ("infospacebackup_infospace_id_fkey", "infospacebackup", "infospace_id", "infospace", "id"),
    ("package_infospace_id_fkey", "package", "infospace_id", "infospace", "id"),
    ("shareablelink_infospace_id_fkey", "shareablelink", "infospace_id", "infospace", "id"),
    ("source_infospace_id_fkey", "source", "infospace_id", "infospace", "id"),
    ("task_infospace_id_fkey", "task", "infospace_id", "infospace", "id"),
    ("asset_infospace_id_fkey", "asset", "infospace_id", "infospace", "id"),
    ("annotationrun_infospace_id_fkey", "annotationrun", "infospace_id", "infospace", "id"),
    ("annotation_infospace_id_fkey", "annotation", "infospace_id", "infospace", "id"),
    ("chatconversation_infospace_id_fkey", "chatconversation", "infospace_id", "infospace", "id"),
    ("flow_infospace_id_fkey", "flow", "infospace_id", "infospace", "id"),
    ("datasetingestionjob_infospace_id_fkey", "ingestionjob", "infospace_id", "infospace", "id"),
    ("graphedge_infospace_id_fkey", "graphedge", "infospace_id", "infospace", "id"),
    # Deeper ownership — link / log / chunk / aggregate rows with no independent
    # meaning. Their parents (asset, run, entity, conversation, flow) are not
    # hard-deleted outside the infospace-delete path, so cascade only ever fires
    # when the infospace goes.
    ("assetchunk_asset_id_fkey", "assetchunk", "asset_id", "asset", "id"),
    ("runaggregate_run_id_fkey", "runaggregate", "run_id", "annotationrun", "id"),
    ("runschemalink_run_id_fkey", "runschemalink", "run_id", "annotationrun", "id"),
    ("entityeditlog_entity_canonical_id_fkey", "entityeditlog", "entity_id", "entity", "id"),
    ("chatconversationmessage_conversation_id_fkey", "chatconversationmessage", "conversation_id", "chatconversation", "id"),
    ("flowexecution_flow_id_fkey", "flowexecution", "flow_id", "flow", "id"),
]


def _recreate(ondelete) -> None:
    for name, table, col, ref, refcol in _FKS:
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, ref, [col], [refcol], ondelete=ondelete)


def upgrade() -> None:
    _recreate("CASCADE")


def downgrade() -> None:
    _recreate(None)
