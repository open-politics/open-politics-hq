from sqlmodel import Field, Relationship, SQLModel
from typing import List, Optional, Dict, Any, Union, Literal
from datetime import datetime, timezone
from sqlalchemy import Column, ARRAY, Text, JSON, Integer, UniqueConstraint, String, Enum, DateTime, Index
from pydantic import BaseModel, model_validator, computed_field
import enum
import uuid
import logging
import sqlalchemy as sa

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Enums used across multiple models
# ---------------------------------------------------------------------------

class DataSourceType(str, enum.Enum):
    """Defines the type of data source."""
    CSV = "csv"
    PDF = "pdf"
    BULK_PDF = "bulk_pdf"
    URL = "url"
    URL_LIST = "url_list"
    TEXT_BLOCK = "text_block"
    # Add other types as needed

class DataSourceStatus(str, enum.Enum):
    """Defines the processing status of a DataSource."""
    PENDING = "pending" # Initial state, waiting for processing
    PROCESSING = "processing" # Ingestion task is running
    COMPLETE = "complete" # Ingestion finished successfully
    FAILED = "failed" # Ingestion failed

class ClassificationJobStatus(str, enum.Enum):
    """Defines the execution status of a ClassificationJob."""
    PENDING = "pending" # Initial state, waiting for execution
    RUNNING = "running" # Classification task is active
    PAUSED = "paused"  # Job is temporarily paused
    COMPLETED = "completed" # Job finished successfully
    COMPLETED_WITH_ERRORS = "completed_with_errors" # Job finished, but some classifications failed
    FAILED = "failed" # Job execution failed critically

class ClassificationResultStatus(str, enum.Enum):
    """Defines the status of an individual classification result attempt."""
    SUCCESS = "success"
    FAILED = "failed"

class FieldType(str, enum.Enum):
    """Defines the data type for a ClassificationField."""
    INT = "int"
    STR = "str"
    LIST_STR = "List[str]"
    LIST_DICT = "List[Dict[str, any]]"

# ---------------------------------------------------------------------------
# User Management Models
# ---------------------------------------------------------------------------

# Shared properties for User
class UserBase(SQLModel):
    email: str = Field(unique=True, index=True)
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = None

# API model for User creation
class UserCreate(UserBase):
    password: str

# API model for public User creation (e.g., self-registration)
# TODO replace email str with EmailStr when sqlmodel supports it
class UserCreateOpen(SQLModel):
    email: str
    password: str
    full_name: str | None = None

# API model for User update (as admin)
# TODO replace email str with EmailStr when sqlmodel supports it
class UserUpdate(UserBase):
    email: str | None = None  # type: ignore
    password: str | None = None

# API model for User updating their own profile
# TODO replace email str with EmailStr when sqlmodel supports it
class UserUpdateMe(SQLModel):
    full_name: str | None = None
    email: str | None = None

# API model for password update
class UpdatePassword(SQLModel):
    current_password: str
    new_password: str

# Database table model for User
class User(UserBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    hashed_password: str
    items: List["Item"] = Relationship(back_populates="owner")
    search_histories: List["SearchHistory"] = Relationship(back_populates="user")
    workspaces: List["Workspace"] = Relationship(back_populates="owner")
    # Remove old relationships
    # documents: List["Document"] = Relationship(back_populates="user")

    # Add new relationships
    datasources: List["DataSource"] = Relationship(back_populates="user")
    classification_jobs: List["ClassificationJob"] = Relationship(back_populates="user")

# API model for returning User data
class UserOut(UserBase):
    id: int

# API model for returning a list of Users
class UsersOut(SQLModel):
    data: list[UserOut]
    count: int

# --- Auth Related ---

# API model for JWT token response
class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"

# Pydantic model for JWT token payload contents
class TokenPayload(SQLModel):
    sub: int | None = None # Subject (usually user ID)

# API model for resetting password using a token
class NewPassword(SQLModel):
    token: str
    new_password: str

# ---------------------------------------------------------------------------
# Workspace Management Models
# ---------------------------------------------------------------------------

# Shared properties for Workspace
class WorkspaceBase(SQLModel):
    name: str
    description: Optional[str] = None
    # 'sources' might be deprecated or repurposed if DataSources cover this
    # sources: Optional[List[str]] = Field(default=None, sa_column=Column(ARRAY(Text)))
    icon: Optional[str] = None
    system_prompt: Optional[str] = Field(default=None, sa_column=Column(Text), description="System-level prompt applied to all classifications in this workspace.")

# Database table model for Workspace
class Workspace(WorkspaceBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id_ownership: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationships
    owner: Optional[User] = Relationship(back_populates="workspaces")
    classification_schemes: List["ClassificationScheme"] = Relationship(back_populates="workspace", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    datasources: List["DataSource"] = Relationship(back_populates="workspace", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    classification_jobs: List["ClassificationJob"] = Relationship(back_populates="workspace", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    # Add relationships for other dependent tables
    recurring_tasks: List["RecurringTask"] = Relationship(back_populates="workspace", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    datasets: List["Dataset"] = Relationship(back_populates="workspace", sa_relationship_kwargs={"cascade": "all, delete-orphan"})

# API model for Workspace creation
class WorkspaceCreate(WorkspaceBase):
    pass

# API model for Workspace update
class WorkspaceUpdate(WorkspaceBase):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    system_prompt: Optional[str] = None

# API model for returning Workspace data
class WorkspaceRead(WorkspaceBase):
    id: int
    created_at: datetime
    updated_at: datetime
    user_id_ownership: int # Include owner ID
    system_prompt: Optional[str]

# API model for returning a list of Workspaces
class WorkspacesOut(SQLModel):
    data: List[WorkspaceRead]
    count: int

# ---------------------------------------------------------------------------
# NEW: Association Tables for Job M2M Relationships
# Moved these definitions BEFORE DataSource and ClassificationJob to resolve
# NoInspectionAvailable error related to link_model.
# ---------------------------------------------------------------------------

class ClassificationJobDataSourceLink(SQLModel, table=True):
    job_id: Optional[int] = Field(default=None, foreign_key="classificationjob.id", primary_key=True)
    datasource_id: Optional[int] = Field(default=None, foreign_key="datasource.id", primary_key=True)

class ClassificationJobSchemeLink(SQLModel, table=True):
    job_id: Optional[int] = Field(default=None, foreign_key="classificationjob.id", primary_key=True)
    scheme_id: Optional[int] = Field(default=None, foreign_key="classificationscheme.id", primary_key=True)

# ---------------------------------------------------------------------------
# NEW: DataSource Management Models
# ---------------------------------------------------------------------------

# Shared properties for DataSource
class DataSourceBase(SQLModel):
    name: str # User-provided name (e.g., filename, URL description, "Pasted Text")
    type: DataSourceType = Field(sa_column=Column(Enum(DataSourceType)))
    # origin_details: Stores info specific to the type.
    # CSV: {'filepath': '/path/to/file.csv', 'delimiter': ',', 'encoding': 'utf-8'}
    # PDF: {'filepath': '/path/to/document.pdf'}
    # URL_LIST: {'urls': ['http://...','http://...']}
    # TEXT_BLOCK: {'original_hash': 'sha256...'} (optional, to identify duplicates)
    origin_details: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    # source_metadata: Stores schema or structure info derived during PENDING/PROCESSING.
    # CSV: {'columns': ['col1', 'col2'], 'row_count_processed': 100, 'encoding_used': 'utf-8'}
    # PDF: {'page_count': 10, 'processed_page_count': 10}
    # URL_LIST: {'url_count': 5, 'processed_count': 5, 'failed_count': 0, 'failed_urls': []}
    # TEXT_BLOCK: {'character_count': 500}
    source_metadata: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: DataSourceStatus = Field(default=DataSourceStatus.PENDING, sa_column=Column(Enum(DataSourceStatus)))
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text)) # Store error if status is FAILED

# Database table model for DataSource
class DataSource(DataSourceBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    workspace_id: int = Field(foreign_key="workspace.id")
    user_id: int = Field(foreign_key="user.id") # User who created the source
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    data_record_count: Optional[int] = Field(default=0, nullable=True)

    # Relationships
    workspace: Optional["Workspace"] = Relationship(back_populates="datasources")
    user: Optional["User"] = Relationship(back_populates="datasources")
    data_records: List["DataRecord"] = Relationship(back_populates="datasource", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    # Many-to-Many with ClassificationJob via association table
    classification_jobs: List["ClassificationJob"] = Relationship(back_populates="target_datasources", link_model=ClassificationJobDataSourceLink)

# API model for DataSource creation (input)
# User provides minimal info, backend fills details like status, metadata
class DataSourceCreate(SQLModel):
    name: str
    type: DataSourceType
    # Depending on type, provide relevant origin details
    # e.g., for URL_LIST, pass {'urls': [...]}. For file uploads, API handles saving and sets origin_details.
    origin_details: Dict[str, Any] = Field(default_factory=dict)
    # workspace_id and user_id are set from context/path

# API model for returning DataSource data
class DataSourceRead(DataSourceBase):
    id: int
    workspace_id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    # Optionally include counts or related objects if needed for specific views
    data_record_count: Optional[int] = None # Can be calculated in API
    # ADDED fields for user updates
    name: Optional[str] = None
    description: Optional[str] = None

# API model for DataSource update (mostly for status/metadata by backend tasks)
class DataSourceUpdate(SQLModel):
    # Fields updatable by user
    name: Optional[str] = None
    description: Optional[str] = None
    origin_details: Optional[Dict[str, Any]] = None

    # Fields typically updated by backend tasks
    status: Optional[DataSourceStatus] = None
    source_metadata: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    # updated_at is handled automatically or in the service layer

    @model_validator(mode='before')
    def check_origin_details_urls(cls, values):
        origin_details = values.get('origin_details')
        if isinstance(origin_details, dict):
            urls = origin_details.get('urls')
            if urls is not None: # Only validate if 'urls' key exists
                if not isinstance(urls, list) or not all(isinstance(u, str) for u in urls):
                    raise ValueError("'origin_details.urls' must be a list of strings if provided")
        return values

# API model for returning a list of DataSources
class DataSourcesOut(SQLModel):
    data: List[DataSourceRead]
    count: int

# ---------------------------------------------------------------------------
# NEW: API Model for CSV Data Fetching
# ---------------------------------------------------------------------------

class CsvRowData(BaseModel):
    # Represents a single row. Using Dict[str, Any] is flexible,
    # but consider defining specific column types if known/consistent.
    # Or perhaps List[str] if order is guaranteed and types aren't critical.
    # Let's use Optional[str] to handle empty cells gracefully.
    row_data: Dict[str, Optional[str]] # Allow values to be None (from empty cells)
    row_number: int # Original row number in the CSV (1-based, including header)

class CsvRowsOut(SQLModel):
    data: List[CsvRowData] # The paginated rows
    total_rows: int # Total rows in the CSV (from metadata)
    columns: List[str] # Column headers (from metadata)

# ---------------------------------------------------------------------------
# NEW: DataRecord Management Models
# ---------------------------------------------------------------------------

# Shared properties for DataRecord
class DataRecordBase(SQLModel):
    title: Optional[str] = Field(default=None) # ADDED: Optional title for the record
    text_content: str = Field(sa_column=Column(Text)) # The actual text to be classified
    # source_metadata: Stores context about where this record came from within the DataSource.
    # CSV: {'row_number': 5, 'source_columns': {'text': 'column_name'}}
    # PDF: {'page_number': 2, 'chunk_index': 1}
    # URL_LIST: {'url': 'http://...', 'index': 0}
    # TEXT_BLOCK: {}
    source_metadata: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    event_timestamp: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True)) # When the event occurred
    top_image: Optional[str] = Field(default=None, nullable=True)
    images: Optional[List[str]] = Field(default=None, sa_column=Column(ARRAY(String), nullable=True))

# Database table model for DataRecord
class DataRecord(DataRecordBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    datasource_id: Optional[int] = Field(default=None, foreign_key="datasource.id", nullable=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    url_hash: Optional[str] = Field(default=None, index=True) # Added for efficient URL deduplication
    content_hash: Optional[str] = Field(default=None, index=True) # Added for content deduplication
    # title field inherited from DataRecordBase

    # Relationships
    datasource: Optional["DataSource"] = Relationship(back_populates="data_records")
    classification_results: List["ClassificationResult"] = Relationship(back_populates="datarecord", sa_relationship_kwargs={"cascade": "all, delete-orphan"})

# API model for DataRecord creation (primarily used internally by ingestion tasks)
class DataRecordCreate(DataRecordBase):
    datasource_id: Optional[int] = None # Allow creating records without an initial datasource link
    content_hash: Optional[str] = None # Allow passing hash during creation
    title: Optional[str] = None # ADDED: Explicitly allow setting title on creation
    event_timestamp: Optional[datetime] = None # Allow overriding default
    top_image: Optional[str] = None
    images: Optional[List[str]] = None

# API model for returning DataRecord data
class DataRecordRead(DataRecordBase):
    id: int
    datasource_id: Optional[int] = None # Made optional here too
    created_at: datetime
    content_hash: Optional[str] = None # Include hash in read model
    title: Optional[str] = None # ADDED: Include title in read model
    # event_timestamp is inherited from DataRecordBase
    top_image: Optional[str] = None
    images: Optional[List[str]] = None

# API model for returning a list of DataRecords
class DataRecordsOut(SQLModel):
    data: List[DataRecordRead]
    count: int

# --- ADDED: DataRecordUpdate Model ---
class DataRecordUpdate(SQLModel):
    """Schema for updating specific fields of a DataRecord."""
    title: Optional[str] = None # Allow updating the title
    event_timestamp: Optional[datetime] = None # Allow updating the event timestamp
# --- END ADDED ---

# ---------------------------------------------------------------------------
# Classification Scheme & Field Management Models
# ---------------------------------------------------------------------------

# --- Field Models ---

# API model for defining dictionary keys within a LIST_DICT field
class DictKeyDefinition(SQLModel):
    name: str
    type: Literal['str', 'int', 'float', 'bool'] # Allowed types within the dict

# API model for creating/updating a ClassificationField (part of Scheme create/update)
class ClassificationFieldCreate(SQLModel):
    name: str
    description: str
    type: FieldType
    scale_min: Optional[int] = None
    scale_max: Optional[int] = None
    is_set_of_labels: Optional[bool] = None # For LIST_STR: use predefined labels?
    labels: Optional[List[str]] = None # Predefined labels if is_set_of_labels is True
    dict_keys: Optional[List[DictKeyDefinition]] = None # Definitions if type is LIST_DICT
    is_time_axis_hint: Optional[bool] = None # Hint for UI to suggest this field for time axis
    # New fields for justification, bounding boxes, and enum usage
    request_justification: Optional[bool] = Field(default=None, description="Request justification for this field. True enables, False disables, None inherits from scheme's global setting.")
    request_bounding_boxes: Optional[bool] = Field(default=False, description="Request bounding boxes for this field if global image analysis is enabled and the field's value could be derived from an image region.")
    use_enum_for_labels: Optional[bool] = Field(default=False, description="For LIST_STR with predefined labels, generate a strict enum in the Pydantic model for the LLM.")

# Database table model for ClassificationField (defines one field within a scheme)
class ClassificationField(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    scheme_id: int = Field(foreign_key="classificationscheme.id")
    name: str
    description: str
    type: FieldType = Field(sa_column=Column(Enum(FieldType))) # Store enum value
    scale_min: Optional[int] = None # For INT type
    scale_max: Optional[int] = None # For INT type
    is_set_of_labels: Optional[bool] = None # For LIST_STR type
    labels: Optional[List[str]] = Field(default=None, sa_column=Column(ARRAY(String))) # For LIST_STR type
    dict_keys: Optional[List[Dict[str, str]]] = Field(default=None, sa_column=Column(JSON)) # For LIST_DICT type, store as JSON
    is_time_axis_hint: Optional[bool] = Field(default=False, nullable=True) # Hint for UI
    # New fields mirrored from Create model
    request_justification: Optional[bool] = Field(default=None)
    request_bounding_boxes: Optional[bool] = Field(default=False)
    use_enum_for_labels: Optional[bool] = Field(default=False)

    # Relationship
    scheme: Optional["ClassificationScheme"] = Relationship(back_populates="fields")

# --- Scheme Models ---

# Shared properties for ClassificationScheme
class ClassificationSchemeBase(SQLModel):
    name: str
    description: str
    model_instructions: Optional[str] = Field(default=None, sa_column=Column(Text)) # Instructions for the LLM
    validation_rules: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON)) # Optional JSON schema for validation
    default_thinking_budget: Optional[int] = Field(default=None, description="Default thinking budget (e.g., 1024) to use if justifications are requested. 0 disables thinking.")
    request_justifications_globally: Optional[bool] = Field(default=False, description="If true, justification fields will be added for all applicable fields unless overridden at the field level.")
    enable_image_analysis_globally: Optional[bool] = Field(default=False, description="If true, indicates that this scheme might involve image analysis, and fields can request bounding boxes.")

# Database table model for ClassificationScheme
class ClassificationScheme(ClassificationSchemeBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    workspace_id: int = Field(foreign_key="workspace.id")
    user_id: int = Field(foreign_key="user.id") # User who created the scheme
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationships
    fields: List[ClassificationField] = Relationship(back_populates="scheme", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    workspace: Optional["Workspace"] = Relationship(back_populates="classification_schemes")
    classification_results: List["ClassificationResult"] = Relationship(back_populates="scheme")
    # Many-to-Many with ClassificationJob via association table
    classification_jobs: List["ClassificationJob"] = Relationship(back_populates="target_schemes", link_model=ClassificationJobSchemeLink)

# API model for ClassificationScheme creation
class ClassificationSchemeCreate(ClassificationSchemeBase):
    # Expects a list of field definitions when creating a scheme
    fields: List[ClassificationFieldCreate]

# API model for ClassificationScheme update
class ClassificationSchemeUpdate(ClassificationSchemeBase):
    # Allows updating base fields and potentially fields (handle field updates carefully in API logic)
    name: Optional[str] = None
    description: Optional[str] = None
    model_instructions: Optional[str] = None
    validation_rules: Optional[Dict[str, Any]] = None
    fields: Optional[List[ClassificationFieldCreate]] = None # Uncommented

# API model for returning ClassificationScheme data
class ClassificationSchemeRead(ClassificationSchemeBase):
    id: int
    workspace_id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    fields: List[ClassificationFieldCreate] # Return field definitions including the hint
    # Optional counts populated by specific API endpoints
    classification_count: Optional[int] = None # Count of results using this scheme
    job_count: Optional[int] = None # Count of jobs using this scheme


# API model for returning a list of ClassificationSchemes
class ClassificationSchemesOut(SQLModel):
    data: List[ClassificationSchemeRead]
    count: int


# ---------------------------------------------------------------------------
# NEW: Classification Job Management Models
# ---------------------------------------------------------------------------

# --- Association Tables for Job M2M Relationships ---
# Definitions moved BEFORE DataSource and ClassificationJob models above

# Shared properties for ClassificationJob
class ClassificationJobBase(SQLModel):
    name: str # User-defined name for the job
    description: Optional[str] = Field(default=None, sa_column=Column(Text)) # User description
    # configuration: Stores IDs of target schemes and datasources, plus any LLM params
    # e.g., {'scheme_ids': [1, 2], 'datasource_ids': [5, 6], 'llm_provider': 'Google', 'llm_model': 'gemini-flash'}
    configuration: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: ClassificationJobStatus = Field(default=ClassificationJobStatus.PENDING, sa_column=Column(Enum(ClassificationJobStatus)))
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text)) # Store error if status is FAILED

# Database table model for ClassificationJob
class ClassificationJob(ClassificationJobBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    workspace_id: int = Field(foreign_key="workspace.id")
    user_id: int = Field(foreign_key="user.id") # User who initiated the job
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationships
    workspace: Optional["Workspace"] = Relationship(back_populates="classification_jobs")
    user: Optional["User"] = Relationship(back_populates="classification_jobs")
    classification_results: List["ClassificationResult"] = Relationship(back_populates="job", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    # M2M relationships via link models
    target_datasources: List["DataSource"] = Relationship(back_populates="classification_jobs", link_model=ClassificationJobDataSourceLink)
    target_schemes: List["ClassificationScheme"] = Relationship(back_populates="classification_jobs", link_model=ClassificationJobSchemeLink)

# API model for ClassificationJob creation (input)
class ClassificationJobCreate(SQLModel):
    name: str
    description: Optional[str] = None
    configuration: Dict[str, Any] # Must include 'scheme_ids' and 'datasource_ids' lists
    # workspace_id and user_id are set from context/path

    @model_validator(mode='before')
    def check_config_keys(cls, values):
        config = values.get('configuration')
        if not isinstance(config, dict):
            raise ValueError("Configuration must be a dictionary")
        if 'scheme_ids' not in config or not isinstance(config['scheme_ids'], list):
            raise ValueError("Configuration must include a 'scheme_ids' list")
        if 'datasource_ids' not in config or not isinstance(config['datasource_ids'], list):
            raise ValueError("Configuration must include a 'datasource_ids' list")
        return values


# API model for ClassificationJob update (primarily for status/errors by backend tasks)
class ClassificationJobUpdate(SQLModel):
    status: Optional[ClassificationJobStatus] = None
    error_message: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# API model for returning ClassificationJob data
class ClassificationJobRead(ClassificationJobBase):
    id: int
    workspace_id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    # Configuration is inherited from ClassificationJobBase and will be populated by model_validate
    # Include IDs from configuration for easier frontend use
    # target_scheme_ids: List[int] = Field(default=[]) # Removed Field definition
    # target_datasource_ids: List[int] = Field(default=[]) # Removed Field definition
    # Optionally include counts
    result_count: Optional[int] = None
    datarecord_count: Optional[int] = None # Total records targeted by the job

    @computed_field
    @property
    def target_scheme_ids(self) -> List[int]:
        # Access self.configuration after the model has been initially validated
        if isinstance(self.configuration, dict):
            return self.configuration.get('scheme_ids', [])
        # Handle cases where configuration might not be a dict (though it should be)
        return []

    @computed_field
    @property
    def target_datasource_ids(self) -> List[int]:
        # Access self.configuration after the model has been initially validated
        if isinstance(self.configuration, dict):
            return self.configuration.get('datasource_ids', [])
        # Handle cases where configuration might not be a dict
        return []

# API model for returning a list of ClassificationJobs
class ClassificationJobsOut(SQLModel):
    data: List[ClassificationJobRead]
    count: int

# ---------------------------------------------------------------------------
# REFACTORED: Classification Result Management Models
# ---------------------------------------------------------------------------
# A ClassificationResult stores the output of applying a single
# ClassificationScheme to a single DataRecord as part of a ClassificationJob.

# Shared properties for ClassificationResult
class ClassificationResultBase(SQLModel):
    # Removed: document_id, run_id
    datarecord_id: int = Field(foreign_key="datarecord.id")
    scheme_id: int = Field(foreign_key="classificationscheme.id")
    job_id: int = Field(foreign_key="classificationjob.id") # Link to the specific job

    value: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON)) # The actual classification output (JSON)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # --- MODIFIED: Use String type directly, map Enum in Python --- 
    status: ClassificationResultStatus = Field(default=ClassificationResultStatus.SUCCESS, sa_column=Column(sa.String(50), nullable=False))
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    # --- END MODIFICATION --- 

# Database table model for ClassificationResult
class ClassificationResult(ClassificationResultBase, table=True):
    # Define a unique constraint for (datarecord_id, scheme_id, job_id)
    __table_args__ = (UniqueConstraint("datarecord_id", "scheme_id", "job_id", name="uq_datarecord_scheme_job"),)

    id: int = Field(default=None, primary_key=True)

    # Relationships
    # Removed: document, run
    datarecord: "DataRecord" = Relationship(back_populates="classification_results")
    scheme: "ClassificationScheme" = Relationship(back_populates="classification_results")
    job: "ClassificationJob" = Relationship(back_populates="classification_results")

# API model for ClassificationResult creation (used internally by classification tasks)
class ClassificationResultCreate(SQLModel):
    datarecord_id: int
    scheme_id: int
    job_id: int
    value: Dict[str, Any] = Field(default_factory=dict) # The classification output
    timestamp: Optional[datetime] = None # Allow overriding default
    # --- ADDED FIELDS (Optional for creation, default to SUCCESS/None) ---
    status: Optional[ClassificationResultStatus] = ClassificationResultStatus.SUCCESS
    error_message: Optional[str] = None
    # --- END ADDED FIELDS ---

# API model for returning ClassificationResult data
# Keep nested objects minimal by default to avoid large responses.
# Frontend can fetch details for datarecord, scheme, job separately if needed.
class ClassificationResultRead(ClassificationResultBase):
    id: int
    # --- ADDED FIELDS (inherited from base, will be included) ---
    # status: ClassificationResultStatus
    # error_message: Optional[str]
    # --- END ADDED FIELDS ---
    # Maybe include basic info from related objects? Or just IDs? Let's stick to IDs for now.
    # datarecord: DataRecordRead # Too large potentially
    # scheme: ClassificationSchemeRead # Too large potentially
    # job: ClassificationJobRead # Too large potentially

# API model specifically for enhancing results in the frontend, adding a display_value
# Inherits from the base model to keep it simpler
class EnhancedClassificationResultRead(ClassificationResultBase):
    """Adds a processed 'display_value' based on the raw 'value'."""
    id: int # Add id back as it's not in Base
    # --- ADDED FIELDS (inherited from base, will be included) ---
    # status: ClassificationResultStatus
    # error_message: Optional[str]
    # --- END ADDED FIELDS ---
    display_value: Union[float, str, Dict[str, Any], List[Any], None] = Field(default=None)
    # Include nested objects needed for display_value calculation or context?
    # For now, assume calculation relies only on 'value'. If scheme info is needed,
    # the frontend might need to fetch the scheme separately or we include it here.
    # Let's add scheme_fields for processing, assuming it's passed during validation.
    scheme_fields: List[Dict[str, Any]] = Field(default=[], exclude=True) # Exclude from final output

    @model_validator(mode='before')
    @classmethod
    def process_and_set_display_value(cls, data: Any):
        if not isinstance(data, dict):
            return data

        value = data.get('value')
        scheme_id = data.get('scheme_id') # Need scheme_id to potentially look up fields
        # Attempt to get scheme_fields if they were injected (might not be)
        scheme_fields_injected = data.get('scheme_fields', [])
        display_value = None

        if value is None:
            display_value = None
        elif isinstance(value, str):
            # This case might be less common now if the backend always wraps
            display_value = "N/A" if value.lower() == "n/a" else value
        elif isinstance(value, (int, float)):
             # Similar logic for binary/numeric - requires scheme fields
             is_likely_binary = False
             if scheme_fields_injected and len(scheme_fields_injected) == 1:
                 field = scheme_fields_injected[0]
                 s_min = field.get('scale_min')
                 s_max = field.get('scale_max')
                 if s_min == 0 and s_max == 1:
                     is_likely_binary = True
             if is_likely_binary:
                 display_value = 'True' if value > 0.5 else 'False'
             else:
                 display_value = value
        elif isinstance(value, dict):
            # If the value is a dictionary (expected from _core_classify_text)
            # Try to extract the value corresponding to the field name.
            # For simplicity, assume single field if scheme_fields aren't injected.
            # A more robust solution might fetch the scheme if needed.
            field_keys = list(value.keys())
            if len(field_keys) == 1:
                # If the dict has only one key, assume that's the field name and its value is the one we want.
                actual_value = value[field_keys[0]]
                # Now format the actual_value based on its type (similar to above)
                if actual_value is None:
                    display_value = None
                elif isinstance(actual_value, str):
                     display_value = "N/A" if actual_value.lower() == "n/a" else actual_value
                elif isinstance(actual_value, (int, float)):
                    # Could refine with binary check if scheme_fields were available
                    display_value = actual_value
                elif isinstance(actual_value, list):
                     display_value = actual_value # Display lists as-is for now
                else:
                     display_value = str(actual_value)
            else:
                # Multiple keys found, or structure is unexpected. Render the dict as string? Or pick first?
                # For now, fallback to showing the dict representation
                display_value = value
        elif isinstance(value, list):
             display_value = value
        else:
             display_value = str(value)

        data['display_value'] = display_value
        return data


# API model for querying results (e.g., for specific job)
class ClassificationResultQuery(SQLModel):
    # Replace document_ids, run_ids with job_id, datarecord_ids etc.
    job_ids: Optional[List[int]] = None
    datarecord_ids: Optional[List[int]] = None
    scheme_ids: Optional[List[int]] = None


# ---------------------------------------------------------------------------
# NEW: Recurring Task Management Models
# ---------------------------------------------------------------------------

class RecurringTaskType(str, enum.Enum):
    """Defines the type of recurring task."""
    INGEST = "ingest"       # e.g., scrape URLs and add DataRecords
    CLASSIFY = "classify"   # e.g., run schemes against datasources

class RecurringTaskStatus(str, enum.Enum):
    """Defines the status of a recurring task."""
    ACTIVE = "active"       # Task is scheduled and running
    PAUSED = "paused"       # Task is configured but not scheduled
    ERROR = "error"         # Task encountered an error on last run (needs review)
    # Maybe add 'ARCHIVED' later if needed

# Shared properties for RecurringTask
class RecurringTaskBase(SQLModel):
    name: str
    description: Optional[str] = None
    type: RecurringTaskType = Field(sa_column=Column(Enum(RecurringTaskType)))
    # Cron string for scheduling (e.g., "0 5 * * *")
    schedule: str
    configuration: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    # Configuration Examples:
    # INGEST: {
    #   "target_datasource_id": 123,
    #   "source_urls": ["url1", "url2"],
    #   "deduplication_strategy": "url_hash" # or "content_hash"
    # }
    # CLASSIFY: {
    #   "target_datasource_ids": [123, 124],
    #   "target_scheme_ids": [4, 5],
    #   "process_only_new": true, # Only classify records created since last successful run
    #   "job_name_template": "Auto-classify: {task_name} - {timestamp}" # Optional naming
    # }
    status: RecurringTaskStatus = Field(default=RecurringTaskStatus.PAUSED, sa_column=Column(Enum(RecurringTaskStatus)))

# Database table model for RecurringTask
class RecurringTask(RecurringTaskBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    workspace_id: int = Field(foreign_key="workspace.id")
    user_id: int = Field(foreign_key="user.id") # User who created the task
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_run_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    last_successful_run_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True)) # Added
    last_run_status: Optional[str] = Field(default=None) # Can store 'success', 'error', etc.
    last_run_message: Optional[str] = Field(default=None, sa_column=Column(Text)) # Store error message or details
    # Optional link to the last ClassificationJob created by a 'classify' type task
    last_job_id: Optional[int] = Field(default=None, foreign_key="classificationjob.id", nullable=True)
    consecutive_failure_count: int = Field(default=0) # Added for auto-pausing

    # Relationships
    workspace: Optional["Workspace"] = Relationship(back_populates="recurring_tasks")
    user: Optional["User"] = Relationship()
    last_job: Optional["ClassificationJob"] = Relationship()

# API model for RecurringTask creation
class RecurringTaskCreate(RecurringTaskBase):
    # workspace_id and user_id are set from context/path
    pass

# API model for RecurringTask update
class RecurringTaskUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    schedule: Optional[str] = None
    configuration: Optional[Dict[str, Any]] = None
    status: Optional[RecurringTaskStatus] = None
    # last_run fields are updated internally by tasks

# API model for returning RecurringTask data
class RecurringTaskRead(RecurringTaskBase):
    id: int
    workspace_id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    last_run_message: Optional[str] = None
    last_job_id: Optional[int] = None

# API model for returning a list of RecurringTasks
class RecurringTasksOut(SQLModel):
    data: List[RecurringTaskRead]
    count: int


# ---------------------------------------------------------------------------
# Generic / Utility / Example Models
# ---------------------------------------------------------------------------

# --- Generic Message ---
class Message(SQLModel):
    message: str

# --- Search History ---
class SearchHistoryBase(SQLModel):
    query: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class SearchHistory(SearchHistoryBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    user: Optional["User"] = Relationship(back_populates="search_histories")

class SearchHistoryCreate(SearchHistoryBase):
    pass

class SearchHistoryRead(SearchHistoryBase):
    id: int
    user_id: int

class SearchHistoriesOut(SQLModel):
    data: List[SearchHistoryRead]
    count: int

# --- Item (Example Model) ---
# Shared properties
class ItemBase(SQLModel):
    title: str
    description: str | None = None

# Properties to receive on item creation
class ItemCreate(ItemBase):
    title: str

# Properties to receive on item update
class ItemUpdate(ItemBase):
    title: str | None = None  # type: ignore

# Database model, database table inferred from class name
class Item(ItemBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    owner_id: int | None = Field(default=None, foreign_key="user.id", nullable=False)
    owner: User | None = Relationship(back_populates="items")

# Properties to return via API, id is always required
class ItemOut(ItemBase):
    id: int
    owner_id: int

class ItemsOut(SQLModel):
    data: list[ItemOut]
    count: int

# ---------------------------------------------------------------------------
# Shareable Link Models (Copied from api/models/shareables.py)
# ---------------------------------------------------------------------------
# Note: Removed the table=True and __tablename__ from the DB model to keep it Pydantic-only
# for now, as integrating it fully into SQLModel requires more schema analysis/adjustment.
# The service layer seems to handle the DB logic separately.

class ResourceType(str, enum.Enum):
    """Enumeration of resource types that can be shared."""
    DATA_SOURCE = "data_source"
    SCHEMA = "schema"
    WORKSPACE = "workspace"
    CLASSIFICATION_JOB = "classification_job" # Changed from RUN
    DATASET = "dataset" # Add new resource type

class PermissionLevel(str, enum.Enum):
    """Enumeration of permission levels for shared resources."""
    READ_ONLY = "read_only"
    EDIT = "edit"
    FULL_ACCESS = "full_access"

class ShareableLinkBase(SQLModel): # Changed back to SQLModel
    """Base model for shareable links."""
    name: Optional[str] = None
    description: Optional[str] = None
    permission_level: PermissionLevel = Field(default=PermissionLevel.READ_ONLY, sa_column=Column(Enum(PermissionLevel)))
    is_public: bool = Field(default=False)
    requires_login: bool = Field(default=True)
    expiration_date: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    max_uses: Optional[int] = None
    # Not in DB model: resource_type, resource_id (defined below)

# Actual DB Model for ShareableLink
class ShareableLink(ShareableLinkBase, table=True):
    """Database model for shareable links."""
    __tablename__ = "shareable_links"

    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    resource_type: ResourceType = Field(sa_column=Column(Enum(ResourceType)))
    resource_id: int
    use_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column=Column(DateTime(timezone=True)))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column=Column(DateTime(timezone=True)))

    # Relationship (Optional, if needed)
    # user: Optional["User"] = Relationship(back_populates="shareable_links") # Add back_populates="shareable_links" to User model if needed

    def is_expired(self) -> bool:
        """Check if the link has expired"""
        if self.expiration_date is None:
            return False
        now_utc = datetime.now(timezone.utc)
        return now_utc > self.expiration_date

    def has_exceeded_max_uses(self) -> bool:
        """Check if the link has exceeded its maximum number of uses"""
        if self.max_uses is None:
            return False
        return self.use_count >= self.max_uses

    def is_valid(self) -> bool:
        """Check if the link is still valid (not expired and not exceeded max uses)"""
        return not (self.is_expired() or self.has_exceeded_max_uses())


class ShareableLinkCreate(SQLModel): # Use SQLModel if fields match DB closely
    """Schema for creating a new shareable link."""
    resource_type: ResourceType
    resource_id: int
    name: Optional[str] = None
    description: Optional[str] = None
    permission_level: PermissionLevel = PermissionLevel.READ_ONLY
    is_public: bool = False
    requires_login: bool = True
    expiration_date: Optional[datetime] = None
    max_uses: Optional[int] = None
    # user_id and token are set by the service

class ShareableLinkRead(ShareableLinkBase): # Keep as SQLModel
    """Schema for reading a shareable link."""
    id: int
    token: str
    user_id: int
    resource_type: ResourceType # Add from DB model
    resource_id: int          # Add from DB model
    use_count: int
    created_at: datetime
    updated_at: datetime

    share_url: Optional[str] = None # Keep computed field

    @model_validator(mode='before')
    def set_share_url(cls, values):
        try:
            from app.core.config import settings
            if isinstance(values, dict) and 'token' in values:
                 values['share_url'] = f"{settings.FRONTEND_URL}/share/{values.get('token')}"
            elif hasattr(values, 'token'): # Handle model instance case
                 values.share_url = f"{settings.FRONTEND_URL}/share/{values.token}"
        except ImportError:
            if isinstance(values, dict):
                 values['share_url'] = None
            elif hasattr(values, 'share_url'):
                 values.share_url = None
        return values


class ShareableLinkUpdate(SQLModel): # Use SQLModel
    """Schema for updating a shareable link."""
    name: Optional[str] = None
    description: Optional[str] = None
    permission_level: Optional[PermissionLevel] = None
    is_public: Optional[bool] = None
    requires_login: Optional[bool] = None
    expiration_date: Optional[datetime] = None
    max_uses: Optional[int] = None

    @model_validator(mode='before')
    def validate_expiration_date(cls, values):
        exp_date = values.get('expiration_date')
        if exp_date is not None:
            now_utc = datetime.now(timezone.utc)
            exp_date_utc = exp_date
            if exp_date_utc.tzinfo is None:
                exp_date_utc = exp_date_utc.replace(tzinfo=timezone.utc)
            if exp_date_utc < now_utc:
                raise ValueError("expiration_date must be in the future")
        return values

class ShareableLinkStats(SQLModel): # Use SQLModel
    total_links: int
    active_links: int
    expired_links: int
    links_by_resource_type: Dict[str, int]
    most_shared_resources: List[Dict[str, Any]]
    most_used_links: List[Dict[str, Any]]

# ---------------------------------------------------------------------------
# NEW: Dataset Management Models
# ---------------------------------------------------------------------------

# Shared properties for Dataset
class DatasetBase(SQLModel):
    name: str
    description: Optional[str] = None
    custom_metadata: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON)) 

# Database table model for Dataset
class Dataset(DatasetBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    workspace_id: int = Field(foreign_key="workspace.id")
    user_id: int = Field(foreign_key="user.id") # User who created the dataset
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Links to content using lists of IDs
    datarecord_ids: Optional[List[int]] = Field(default=None, sa_column=Column(ARRAY(Integer)))
    source_job_ids: Optional[List[int]] = Field(default=None, sa_column=Column(ARRAY(Integer)))
    source_scheme_ids: Optional[List[int]] = Field(default=None, sa_column=Column(ARRAY(Integer)))

    # Relationships (Optional, add back_populates if needed on Workspace/User)
    workspace: Optional["Workspace"] = Relationship(back_populates="datasets")
    user: Optional["User"] = Relationship()

# API model for Dataset creation
class DatasetCreate(DatasetBase):
    # IDs are provided during creation
    datarecord_ids: Optional[List[int]] = None
    source_job_ids: Optional[List[int]] = None
    source_scheme_ids: Optional[List[int]] = None
    # workspace_id and user_id are set from context/path
    # custom_metadata is inherited from DatasetBase

# API model for Dataset update
class DatasetUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    custom_metadata: Optional[Dict[str, Any]] = None # Renamed from metadata
    datarecord_ids: Optional[List[int]] = None
    source_job_ids: Optional[List[int]] = None
    source_scheme_ids: Optional[List[int]] = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# API model for returning Dataset data
class DatasetRead(DatasetBase):
    id: int
    workspace_id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    datarecord_ids: Optional[List[int]] = None
    source_job_ids: Optional[List[int]] = None
    source_scheme_ids: Optional[List[int]] = None
    # custom_metadata is inherited from DatasetBase

# API model for returning a list of Datasets
class DatasetsOut(SQLModel):
    data: List[DatasetRead]
    count: int


class DataSourceTransferRequest(BaseModel):
    source_workspace_id: int = Field(..., description="ID of the workspace to transfer from")
    target_workspace_id: int = Field(..., description="ID of the workspace to transfer to")
    datasource_ids: List[int] = Field(..., description="List of DataSource IDs to transfer")
    copy_datasources: bool = Field(default=True, description="If true, copy the datasources; if false, move them")

class DataSourceTransferResponse(BaseModel):
    success: bool
    message: str
    new_datasource_ids: Optional[List[int]] = Field(default=None, description="IDs of the newly created DataSources in the target workspace (if copied)")
    errors: Optional[Dict[int, str]] = Field(default=None, description="Dictionary of DataSource IDs that failed and the reason")

#  DATASET PACKAGE SUMMARY VIEW ---
class DatasetPackageFileManifestItem(BaseModel):
    filename: str
    original_datasource_uuid: Optional[str] = None
    original_datasource_id: Optional[int] = None
    type: Optional[str] = None # e.g., PDF, CSV
    linked_datarecord_uuid: Optional[str] = None

class DatasetPackageEntitySummary(BaseModel):
    entity_uuid: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None # Added description
    # Add other common fields if desired, e.g., description

class DatasetPackageSummary(BaseModel):
    package_metadata: Dict[str, Any] # from PackageMetadata.to_dict()
    dataset_details: DatasetPackageEntitySummary
    record_count: int = 0
    classification_results_count: int = 0 # Total results across all records
    included_schemes: List[DatasetPackageEntitySummary] = []
    included_jobs: List[DatasetPackageEntitySummary] = []
    # Unique datasources that the records in the dataset belong to
    # This might be different from datasources explicitly listed as "source_datasources" if that concept were added
    linked_datasources_summary: List[DatasetPackageEntitySummary] = [] 
    source_files_manifest: List[DatasetPackageFileManifestItem] = []
# --- END ADDED ---



