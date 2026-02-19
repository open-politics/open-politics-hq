""" Core Models
=================================================
Re-export hub: imports from domain models. Alembic and existing code use from app.models import *.
"""

from app.api.modules.identity_infospace_user.models import User, Infospace, UserBase, UserTier
from app.api.modules.content.models import (
    Asset,
    AssetChunk,
    AssetKind,
    Bundle,
    Dataset,
    DatasetIngestionJob,
    EmbeddingModel,
    EmbeddingProvider,
    IngestionStatus,
    Modality,
    ProcessingStatus,
    Source,
    SourcePollHistory,
    SourceStatus,
    SourceType,
)
from app.api.modules.annotation.models import (
    Annotation,
    AnnotationRun,
    AnnotationSchema,
    AnnotationRunTrigger,
    AnnotationSchemaTargetLevel,
    Justification,
    ResultStatus,
    RunAggregate,
    RunSchemaLink,
    RunStatus,
    RunType,
)

# Association table for MCP/raw SQL joins (RunSchemaLink link model)
annotation_run_schema_association = RunSchemaLink.__table__
from app.api.modules.graph.models import EntityCanonical, FragmentCuration
from app.api.modules.flow.models import (
    Flow,
    FlowExecution,
    Task,
    FlowStatus,
    FlowInputType,
    FlowTriggerMode,
    FlowStepType,
    TaskType,
    TaskStatus,
)
from app.api.modules.search.models import SearchHistory
from app.api.modules.conversational_intelligence.models import ChatConversation, ChatConversationMessage
from app.api.modules.sharing.models import (
    ShareableLink,
    Package,
    InfospaceBackup,
    UserBackup,
    PermissionLevel,
    ResourceType,
    BackupType,
    BackupStatus,
)
from app.api.modules.analysis.models import AnalysisAdapter

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import enum
import uuid

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import (
    ARRAY,
    Column,
    DateTime,
    Enum as PgEnum,
    Index,
    JSON,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from pgvector.sqlalchemy import Vector

# ─────────────────────────────────────────────────────────────── Enums ──── #
# PermissionLevel, ResourceType, BackupType, BackupStatus imported from app.api.modules.sharing.models

# Flow enums, Task, Flow, FlowExecution imported from app.api.modules.flow.models
# RunType, AnnotationRunTrigger, AnnotationSchemaTargetLevel imported from annotation

# Sources, Assets, Bundles, etc. imported from app.api.modules.content.models



# Annotation models imported from app.api.modules.annotation.models
# Graph models (EntityCanonical, FragmentCuration) imported from app.api.modules.graph.models
# Task, Flow, FlowExecution imported from app.api.modules.flow.models
# SearchHistory imported from app.api.modules.search.models
# ChatConversation, ChatConversationMessage imported from app.api.modules.conversational_intelligence.models
# ShareableLink, Package, InfospaceBackup, UserBackup, PermissionLevel, ResourceType, BackupType, BackupStatus from app.api.modules.sharing.models
# AnalysisAdapter from app.api.modules.analysis.models
