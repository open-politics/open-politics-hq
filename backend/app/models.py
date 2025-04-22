from sqlmodel import Field, Relationship, SQLModel
from typing import List, Optional, Dict, Any, Union, Literal
from datetime import datetime, timezone
from sqlalchemy import Column, ARRAY, Text, JSON, Integer, UniqueConstraint, String, Enum, DateTime
from pydantic import BaseModel, model_validator, computed_field
import enum

# ---------------------------------------------------------------------------
# Enums used across multiple models
# ---------------------------------------------------------------------------

class DataSourceType(str, enum.Enum):
    """Defines the type of data source."""
    CSV = "csv"
    PDF = "pdf"
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
    COMPLETED = "completed" # Job finished successfully
    COMPLETED_WITH_ERRORS = "completed_with_errors" # Job finished, but some classifications failed
    FAILED = "failed" # Job execution failed critically

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

# Database table model for Workspace
class Workspace(WorkspaceBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id_ownership: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationships
    owner: Optional[User] = Relationship(back_populates="workspaces")
    classification_schemes: List["ClassificationScheme"] = Relationship(back_populates="workspace")
    # Remove old relationships
    # documents: List["Document"] = Relationship(back_populates="workspace")

    # Add new relationships
    datasources: List["DataSource"] = Relationship(back_populates="workspace")
    classification_jobs: List["ClassificationJob"] = Relationship(back_populates="workspace")
    # saved_result_sets might need rethinking in context of Jobs/DataRecords
    # saved_result_sets: List["SavedResultSet"] = Relationship(back_populates="workspace")

# API model for Workspace creation
class WorkspaceCreate(WorkspaceBase):
    pass

# API model for Workspace update
class WorkspaceUpdate(WorkspaceBase):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None

# API model for returning Workspace data
class WorkspaceRead(WorkspaceBase):
    id: int
    created_at: datetime
    updated_at: datetime
    user_id_ownership: int # Include owner ID

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
    workspace_id: int = Field(foreign_key="workspace.id")
    user_id: int = Field(foreign_key="user.id") # User who created the source
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

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

# API model for DataSource update (mostly for status/metadata by backend tasks)
class DataSourceUpdate(SQLModel):
    status: Optional[DataSourceStatus] = None
    source_metadata: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

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
    text_content: str = Field(sa_column=Column(Text)) # The actual text to be classified
    # source_metadata: Stores context about where this record came from within the DataSource.
    # CSV: {'row_number': 5, 'source_columns': {'text': 'column_name'}}
    # PDF: {'page_number': 2, 'chunk_index': 1}
    # URL_LIST: {'url': 'http://...', 'index': 0}
    # TEXT_BLOCK: {}
    source_metadata: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))

# Database table model for DataRecord
class DataRecord(DataRecordBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    datasource_id: int = Field(foreign_key="datasource.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationships
    datasource: Optional["DataSource"] = Relationship(back_populates="data_records")
    classification_results: List["ClassificationResult"] = Relationship(back_populates="datarecord", sa_relationship_kwargs={"cascade": "all, delete-orphan"})

# API model for DataRecord creation (primarily used internally by ingestion tasks)
class DataRecordCreate(DataRecordBase):
    datasource_id: int

# API model for returning DataRecord data
class DataRecordRead(DataRecordBase):
    id: int
    datasource_id: int
    created_at: datetime

# API model for returning a list of DataRecords
class DataRecordsOut(SQLModel):
    data: List[DataRecordRead]
    count: int

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

    # Relationship
    scheme: Optional["ClassificationScheme"] = Relationship(back_populates="fields")

# --- Scheme Models ---

# Shared properties for ClassificationScheme
class ClassificationSchemeBase(SQLModel):
    name: str
    description: str
    model_instructions: Optional[str] = Field(default=None, sa_column=Column(Text)) # Instructions for the LLM
    validation_rules: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON)) # Optional JSON schema for validation

# Database table model for ClassificationScheme
class ClassificationScheme(ClassificationSchemeBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
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
    # TODO: Define how field updates work (replace all? partial?)
    # fields: Optional[List[ClassificationFieldCreate]] = None # Commented out for now

# API model for returning ClassificationScheme data
class ClassificationSchemeRead(ClassificationSchemeBase):
    id: int
    workspace_id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    fields: List[ClassificationFieldCreate] # Return field definitions
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
    # Allow updating name/description? Maybe restrict this
    # name: Optional[str] = None
    # description: Optional[str] = None
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

    # Added computed fields
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

# API model for returning ClassificationResult data
# Keep nested objects minimal by default to avoid large responses.
# Frontend can fetch details for datarecord, scheme, job separately if needed.
class ClassificationResultRead(ClassificationResultBase):
    id: int
    # Maybe include basic info from related objects? Or just IDs? Let's stick to IDs for now.
    # datarecord: DataRecordRead # Too large potentially
    # scheme: ClassificationSchemeRead # Too large potentially
    # job: ClassificationJobRead # Too large potentially

# API model specifically for enhancing results in the frontend, adding a display_value
# Inherits from the base model to keep it simpler
class EnhancedClassificationResultRead(ClassificationResultBase):
    """Adds a processed 'display_value' based on the raw 'value'."""
    id: int # Add id back as it's not in Base
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
            # If already validated or not a dict, return as is.
            return data

        value = data.get('value')
        # scheme_fields should ideally be injected here by the calling API endpoint
        # based on the result's scheme_id if needed for complex display logic.
        # For simplicity now, let's assume scheme_fields might be present in `data`.
        scheme_fields = data.get('scheme_fields', [])
        display_value = None

        # --- Start: Simplified Value Processing Logic (copied from old model) ---
        if value is None:
            display_value = None
        elif isinstance(value, str):
            display_value = "N/A" if value.lower() == "n/a" else value
        elif isinstance(value, (int, float)):
             is_likely_binary = False
             if scheme_fields and len(scheme_fields) == 1:
                 field = scheme_fields[0]
                 s_min = field.get('scale_min')
                 s_max = field.get('scale_max')
                 if s_min == 0 and s_max == 1:
                     is_likely_binary = True

             if is_likely_binary:
                 display_value = 'True' if value > 0.5 else 'False'
             else:
                 display_value = value
        elif isinstance(value, dict):
             extracted = {}
             if scheme_fields:
                 field_names = [f.get('name') for f in scheme_fields if f.get('name')]
                 for name in field_names:
                     if name in value:
                         extracted[name] = value[name]
             display_value = extracted if extracted else value
        elif isinstance(value, list):
             display_value = value
        else:
             display_value = str(value)
        # --- End: Simplified Value Processing Logic ---

        data['display_value'] = display_value
        return data


# API model for querying results (e.g., for specific job)
class ClassificationResultQuery(SQLModel):
    # Replace document_ids, run_ids with job_id, datarecord_ids etc.
    job_ids: Optional[List[int]] = None
    datarecord_ids: Optional[List[int]] = None
    scheme_ids: Optional[List[int]] = None


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

