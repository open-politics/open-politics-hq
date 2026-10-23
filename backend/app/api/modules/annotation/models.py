"""Annotation domain models: AnnotationSchema, AnnotationRun, Annotation."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import enum
import uuid

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import BigInteger, Column, ForeignKey, Index, Integer, JSON, Text, text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from app.api.modules.identity_infospace_user.models import User, Infospace
from app.api.modules.content.models import Asset, Bundle


# ─── Annotation enums ───

class RunStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    WAITING = "waiting"  # Paused at async checkpoint (e.g. flow waiting for annotation)
    COMPLETED = "completed"
    FAILED = "failed"
    COMPLETED_WITH_ERRORS = "completed_with_errors"


class ResultStatus(str, enum.Enum):
    SUCCESS = "success"
    FAILED = "failed"


class RunType(str, enum.Enum):
    ONE_OFF = "one_off"
    FLOW_STEP = "flow_step"
    RETRY = "retry"  # Retrying failed assets from a parent run
    BACKFILL = "backfill"  # Filling annotation gaps (version changes, new schemas)


class AnnotationRunTrigger(str, enum.Enum):
    MANUAL = "manual"
    SOURCE_POLL = "source_poll"
    FLOW_STEP = "flow_step"
    API = "api"


class AnnotationSchemaTargetLevel(str, enum.Enum):
    ASSET = "asset"
    CHILD = "child"
    BOTH = "both"


# ─── Annotation schema ───

class AnnotationSchema(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    output_contract: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    instructions: Optional[str] = Field(default=None, sa_column=Column(Text))
    version: str = Field(default="1.0")
    # The head: ``output_contract`` and ``instructions`` are this revision. A
    # contract annotations were made under is never rewritten — revising keeps
    # the head it replaces as an ``AnnotationSchemaRevision`` (see ``revisions.py``).
    revision: int = Field(default=1, sa_column_kwargs={"server_default": "1"})
    # A draft: a schema being revised inside one run, not yet adopted
    # (``drafts.py``). ``draft_of`` is the schema it would revise, ``draft_in``
    # the run it is drafted in; it goes with either. Hidden from every list of
    # schemas, and read only by that run's trial run.
    draft_of: Optional[int] = Field(default=None, sa_column=Column(
        "draft_of", Integer, ForeignKey("annotationschema.id", ondelete="CASCADE"), nullable=True,
        index=True))
    draft_in: Optional[int] = Field(default=None, sa_column=Column(
        "draft_in", Integer, ForeignKey("annotationrun.id", ondelete="CASCADE"), nullable=True))
    is_active: bool = Field(default=True, index=True)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship(back_populates="schemas")
    user: Optional[User] = Relationship(back_populates="schemas")
    annotations: List["Annotation"] = Relationship(
        back_populates="schema",
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "passive_deletes": True},
    )

    __table_args__ = (
        Index(
            "ix_unique_active_schema_name_version",
            "infospace_id", "name", "version",
            unique=True,
            postgresql_where=text("is_active = true AND draft_of IS NULL")
        ),
        Index("uq_annotationschema_draft", "draft_in", "draft_of", unique=True,
              postgresql_where=text("draft_of IS NOT NULL")),
    )


class AnnotationSchemaRevision(SQLModel, table=True):
    """A contract a schema has been revised away from — kept, because the
    annotations made under it still say so (``Annotation.schema_rev``). The
    head lives on the schema row; this table only ever holds the past."""
    __tablename__ = "annotation_schema_revision"

    id: Optional[int] = Field(default=None, primary_key=True)
    schema_id: int = Field(sa_column=Column(Integer, ForeignKey("annotationschema.id", ondelete="CASCADE"), nullable=False))
    rev: int
    output_contract: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    instructions: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    __table_args__ = (UniqueConstraint("schema_id", "rev", name="uq_annotation_schema_revision"),)


class RunSchemaLink(SQLModel, table=True):
    run_id: Optional[int] = Field(foreign_key="annotationrun.id", primary_key=True)
    schema_id: Optional[int] = Field(foreign_key="annotationschema.id", primary_key=True)
    # The revision this run reads through. NULL follows the schema's head; a
    # number pins the run to that revision while the head moves on.
    rev: Optional[int] = None


class AnnotationRun(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("trial_of", name="uq_annotationrun_trial_of"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = Field(default=None, sa_column=Column(Text))
    configuration: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: RunStatus = RunStatus.PENDING
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    started_at: Optional[datetime] = Field(default=None)
    completed_at: Optional[datetime] = Field(default=None)
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    include_parent_context: bool = Field(default=False)
    context_window: int = Field(default=0)
    views_config: Optional[List[Dict[str, Any]]] = Field(default_factory=list, sa_column=Column(JSONB))
    run_type: RunType = Field(default=RunType.ONE_OFF)
    flow_execution_id: Optional[int] = Field(default=None, foreign_key="flowexecution.id", index=True)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    is_favorite: bool = Field(default=False, index=True)
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    trigger_type: str = Field(default="manual")
    trigger_context: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    source_bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id", index=True)
    graph_config: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    # The run's declared coordinate frame: the canon(s) curation resolves into.
    # Explicit declaration replaces the implicit infospace-default fallback.
    # Phase 2 targets the primary (canon_ids[0]); multi-canon union read is deferred.
    canon_ids: List[int] = Field(default_factory=list, sa_column=Column(JSON))
    follow_on_version_change: bool = Field(default=False, index=True)
    # A live run is never "done" — it cycles PENDING → RUNNING → COMPLETED(idle,
    # watching) → PENDING as new content lands in its scope. The `reconcile_runs`
    # reconciler re-pends it; the streaming delta makes re-pending idempotent.
    live: bool = Field(default=False, index=True)
    # "Resolve into canon" mode: when on (and canon_ids set), curation of this run's
    # entity mentions is settled-only — exact/alias matches auto-apply, unmatched
    # mentions stage as human-confirmed CanonProposals instead of auto-creating.
    resolve_into_canon: bool = Field(default=False, index=True)
    progress_total: Optional[int] = Field(default=None)
    progress_current: Optional[int] = Field(default=None)
    # The run this one tries drafts for (``drafts.py``): it reads a few chosen
    # assets through the run's drafts, so what a revision would make is seen
    # before it is adopted. One per run, gone with it, hidden from every list.
    trial_of: Optional[int] = Field(default=None, sa_column=Column(
        "trial_of", Integer, ForeignKey("annotationrun.id", ondelete="CASCADE"), nullable=True))

    infospace: Optional[Infospace] = Relationship(back_populates="runs")
    user: Optional[User] = Relationship(back_populates="runs")
    flow_execution: Optional["FlowExecution"] = Relationship(
        back_populates="annotation_runs",
        sa_relationship_kwargs={"foreign_keys": "[AnnotationRun.flow_execution_id]"}
    )
    target_schemas: List["AnnotationSchema"] = Relationship(link_model=RunSchemaLink)
    annotations: List["Annotation"] = Relationship(
        back_populates="run",
        # An annotation is part of its run. Without this SQLAlchemy disassociated
        # the children on delete — UPDATE annotation SET run_id = NULL — against a
        # NOT NULL column. passive_deletes hands the work to the FK's ON DELETE
        # CASCADE instead of loading every row to delete it one at a time.
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "passive_deletes": True},
    )


class Annotation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    asset_id: int = Field(foreign_key="asset.id")
    schema_id: int = Field(foreign_key="annotationschema.id")
    run_id: int = Field(foreign_key="annotationrun.id")
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    value: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    status: ResultStatus = ResultStatus.SUCCESS
    # The schema revision whose contract this value was extracted under.
    schema_rev: int = Field(default=1, sa_column_kwargs={"server_default": "1"})
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    event_timestamp: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    region: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    links: Optional[List[Dict[str, Any]]] = Field(default=None, sa_column=Column(JSON))
    imported_from_uuid: Optional[str] = Field(default=None, index=True)

    asset: Optional[Asset] = Relationship(back_populates="annotations")
    run: Optional[AnnotationRun] = Relationship(back_populates="annotations")
    schema: Optional[AnnotationSchema] = Relationship(back_populates="annotations")
    infospace: Optional[Infospace] = Relationship(back_populates="annotations")
    user: Optional[User] = Relationship(back_populates="annotations")

    __table_args__ = (
        UniqueConstraint("asset_id", "schema_id", "run_id", "uuid"),
        Index("ix_annotation_value", "value", postgresql_using="gin", postgresql_ops={"value": "jsonb_path_ops"}),
    )


# ``annotation.seq`` — a run's change clock, maintained by Postgres: taken from
# ``annotation_seq`` on insert, and again by a trigger whenever ``value``
# changes, so an annotation filled in place moves it as surely as a new one.
# ``max(seq)`` over a run is its watermark (the overview's frame, the
# resolver's seed check). ``max(id)`` was, and missed every in-place change.
#
# On the table, deliberately NOT a model field — the same reason as
# ``CANON_ENTRY_COORDS``: SQLModel sets every field on construction, so a mapped
# ``seq`` went into every INSERT as an explicit NULL, past the default.
ANNOTATION_SEQ = Column(
    "seq", BigInteger, nullable=False,
    server_default=text("nextval('annotation_seq')"),
)
Annotation.__table__.append_column(ANNOTATION_SEQ)
Index("ix_annotation_run_seq", Annotation.__table__.c.run_id, ANNOTATION_SEQ)


class RunAggregate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="annotationrun.id")
    field_path: str
    value_kind: str
    sketch_kind: str
    payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_runaggregate_payload", "payload", postgresql_using="gin", postgresql_ops={"payload": "jsonb_path_ops"}),
        Index("ix_runaggregate_run_field", "run_id", "field_path"),
    )
