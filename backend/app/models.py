from sqlmodel import Field, Relationship, SQLModel
from typing import List, Optional, Dict, Any, Union, Literal
from datetime import datetime, timezone
from sqlalchemy import Column, ARRAY, Text, JSON, Integer, UniqueConstraint, String, Enum, DateTime
from pydantic import BaseModel, model_validator
import enum

# ---------------------------------------------------------------------------
# Enums used across multiple models
# ---------------------------------------------------------------------------

class FieldType(str, enum.Enum):
    """Defines the data type for a ClassificationField."""
    INT = "int"
    STR = "str"
    LIST_STR = "List[str]"
    LIST_DICT = "List[Dict[str, any]]"

class ClassificationRunStatus(str, enum.Enum):
    """Defines the possible states of a ClassificationRun."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

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
    documents: List["Document"] = Relationship(back_populates="user")
    # classification_schemes: List["ClassificationScheme"] = Relationship(back_populates="user") # Consider if direct link needed
    # classification_runs: List["ClassificationRun"] = Relationship(back_populates="user") # Consider if direct link needed

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
    sources: Optional[List[str]] = Field(default=None, sa_column=Column(ARRAY(Text)))
    icon: Optional[str] = None

# Database table model for Workspace
class Workspace(WorkspaceBase, table=True):
    uid: Optional[int] = Field(default=None, primary_key=True)
    user_id_ownership: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationships
    owner: Optional[User] = Relationship(back_populates="workspaces")
    classification_schemes: List["ClassificationScheme"] = Relationship(back_populates="workspace")
    documents: List["Document"] = Relationship(back_populates="workspace")
    # saved_result_sets: List["SavedResultSet"] = Relationship(back_populates="workspace") # Add if needed
    # classification_runs: List["ClassificationRun"] = Relationship(back_populates="workspace") # Add if needed

# API model for Workspace creation
class WorkspaceCreate(WorkspaceBase):
    pass

# API model for Workspace update
class WorkspaceUpdate(WorkspaceBase):
    pass

# API model for returning Workspace data
class WorkspaceRead(WorkspaceBase):
    uid: int
    created_at: datetime
    updated_at: datetime
    user_id_ownership: int # Include owner ID

# API model for returning a list of Workspaces
class WorkspacesOut(SQLModel):
    data: List[WorkspaceRead]
    count: int

# ---------------------------------------------------------------------------
# Document & File Management Models
# ---------------------------------------------------------------------------

# --- File Models ---

# Shared properties for File
class FileBase(SQLModel):
    name: str
    filetype: Optional[str] = None
    size: Optional[int] = None
    url: Optional[str] = None # Potentially a MinIO URL or presigned URL
    caption: Optional[str] = None
    media_type: Optional[str] = Field(default=None, sa_column=Column(Text))  # 'image', 'document', etc
    top_image: Optional[str] = Field(default=None, sa_column=Column(Text)) # URL of representative image if applicable

# Database table model for File
class File(FileBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    document_id: Optional[int] = Field(default=None, foreign_key="document.id")

    # Relationship
    document: Optional["Document"] = Relationship(back_populates="files")

# API model for returning File data
class FileRead(FileBase):
    id: int
    document_id: int

# --- Document Models ---

# Shared properties for Document
class DocumentBase(SQLModel):
    title: str
    url: Optional[str] = None
    content_type: Optional[str] = 'article' # E.g., 'article', 'pdf_upload', 'report'
    source: Optional[str] = None # Origin of the document (e.g., website name, import source)
    top_image: Optional[str] = None # URL of primary image associated with the document
    text_content: Optional[str] = Field(default=None, sa_column=Column(Text)) # Extracted text
    summary: Optional[str] = Field(default=None, sa_column=Column(Text)) # Generated or provided summary
    insertion_date: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True))
    )

# Database table model for Document
class Document(DocumentBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    # insertion_date defined in Base is used
    workspace_id: int = Field(foreign_key="workspace.uid")
    user_id: int = Field(foreign_key="user.id")

    # Relationships
    workspace: Optional["Workspace"] = Relationship(back_populates="documents")
    user: Optional["User"] = Relationship(back_populates="documents")
    files: List["File"] = Relationship(back_populates="document", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    classification_results: List["ClassificationResult"] = Relationship(back_populates="document", sa_relationship_kwargs={"cascade": "all, delete-orphan"})

# API model for Document creation
class DocumentCreate(DocumentBase):
    workspace_id: Optional[int] = None # Can be set via path param or body
    insertion_date: Optional[datetime] = None # Allow overriding default

# API model for returning Document data
class DocumentRead(DocumentBase):
    id: int
    workspace_id: int
    user_id: int
    files: List["FileRead"] = [] # Include associated files

# API model for Document update
class DocumentUpdate(DocumentBase):
    # Allow updating any field from Base optionally
    title: Optional[str] = None
    url: Optional[str] = None
    content_type: Optional[str] = None
    source: Optional[str] = None
    top_image: Optional[str] = None
    text_content: Optional[str] = None
    summary: Optional[str] = None
    insertion_date: Optional[datetime] = None

# API model for returning a list of Documents
class DocumentsOut(SQLModel):
    data: List[DocumentRead]
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
    workspace_id: int = Field(foreign_key="workspace.uid")
    user_id: int = Field(foreign_key="user.id") # User who created the scheme
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationships
    fields: List[ClassificationField] = Relationship(back_populates="scheme", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    workspace: Optional["Workspace"] = Relationship(back_populates="classification_schemes")
    classification_results: List["ClassificationResult"] = Relationship(back_populates="scheme")

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
    fields: Optional[List[ClassificationFieldCreate]] = None # TODO: Define how field updates work (replace all? partial?)

# API model for returning ClassificationScheme data
class ClassificationSchemeRead(ClassificationSchemeBase):
    id: int
    workspace_id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    fields: List[ClassificationFieldCreate] # Return field definitions
    # Optional counts populated by specific API endpoints
    classification_count: Optional[int] = None
    document_count: Optional[int] = None

# API model for returning a list of ClassificationSchemes
class ClassificationSchemesOut(SQLModel):
    data: List[ClassificationSchemeRead]
    count: int


# ---------------------------------------------------------------------------
# Classification Run Management Models
# ---------------------------------------------------------------------------
# A ClassificationRun represents a specific execution instance of applying
# one or more ClassificationSchemes to one or more Documents. It groups
# the resulting ClassificationResults generated during that single execution.

# Shared properties for ClassificationRun
class ClassificationRunBase(SQLModel):
    name: Optional[str] = None # User-defined name for the run
    description: Optional[str] = Field(default=None, sa_column=Column(Text)) # User description
    status: ClassificationRunStatus = Field(
        default=ClassificationRunStatus.PENDING,
        sa_column=Column(Enum(ClassificationRunStatus))
    )
    # Optional counts, potentially populated later or via specific queries
    document_count: Optional[int] = None
    scheme_count: Optional[int] = None

    model_config = {
        "json_schema_extra": {
            "properties": {
                "status": {
                    "default": "pending" # Explicitly set default in schema via model_config
                }
            }
        }
    }

# Database table model for ClassificationRun
class ClassificationRun(ClassificationRunBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    workspace_id: int = Field(foreign_key="workspace.uid")
    user_id: int = Field(foreign_key="user.id") # User who initiated the run
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationship: A run groups multiple results
    classification_results: List["ClassificationResult"] = Relationship(back_populates="run")
    # workspace: Optional["Workspace"] = Relationship(back_populates="classification_runs") # Add if needed
    # user: Optional["User"] = Relationship(back_populates="classification_runs") # Add if needed

# API model for ClassificationRun creation
class ClassificationRunCreate(ClassificationRunBase):
    # workspace_id is required to link the run on creation
    workspace_id: int

# API model for ClassificationRun update
class ClassificationRunUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[ClassificationRunStatus] = None

# API model for returning ClassificationRun data
class ClassificationRunRead(ClassificationRunBase):
    id: int
    workspace_id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    result_count: Optional[int] = Field(default=0) # Include calculated count from API

# API model for returning a list of ClassificationRuns
class ClassificationRunsOut(SQLModel):
    data: List[ClassificationRunRead]
    count: int

# ---------------------------------------------------------------------------
# Classification Result Management Models
# ---------------------------------------------------------------------------
# A ClassificationResult stores the output of applying a single
# ClassificationScheme to a single Document, potentially as part of a
# specific ClassificationRun.

# Shared properties for ClassificationResult
class ClassificationResultBase(SQLModel):
    document_id: int = Field(foreign_key="document.id")
    scheme_id: int = Field(foreign_key="classificationscheme.id")
    run_id: Optional[int] = Field(default=None, foreign_key="classificationrun.id") # Link to the specific run
    value: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON)) # The actual classification output (JSON)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Database table model for ClassificationResult
class ClassificationResult(ClassificationResultBase, table=True):
    # Define a unique constraint for (document_id, scheme_id, run_id) if a result
    # for a given doc/scheme within a specific run should be unique.
    # __table_args__ = (UniqueConstraint("document_id", "scheme_id", "run_id", name="uq_doc_scheme_run"),)

    id: int = Field(default=None, primary_key=True)

    # Relationships
    document: Document = Relationship(back_populates="classification_results")
    scheme: ClassificationScheme = Relationship(back_populates="classification_results")
    run: Optional["ClassificationRun"] = Relationship(back_populates="classification_results")

# API model for ClassificationResult creation
class ClassificationResultCreate(SQLModel):
    document_id: int
    scheme_id: int
    run_id: Optional[int] = None # The run this result belongs to
    value: Dict[str, Any] = Field(default_factory=dict) # The classification output
    timestamp: Optional[datetime] = None # Allow overriding default

# API model for returning ClassificationResult data
# Includes nested DocumentRead and ClassificationSchemeRead for context
class ClassificationResultRead(ClassificationResultBase):
    id: int
    document: DocumentRead
    scheme: ClassificationSchemeRead
    # run details could be added here if needed, but might cause circular refs or large payloads

# API model specifically for enhancing results in the frontend, adding a display_value
class EnhancedClassificationResultRead(ClassificationResultRead):
    """Adds a processed 'display_value' based on the raw 'value' and scheme."""
    display_value: Union[float, str, Dict[str, Any], List[Any], None] = Field(default=None)

    @model_validator(mode='before')
    @classmethod # Use classmethod for model validators
    def convert_value(cls, data: Any):
        # Ensure data is a dict (SQLModel instance or dict) before processing
        if not isinstance(data, dict):
             # If it's already an instance, it might have been validated, return directly.
             # Or handle the case where it's some other type if necessary.
             return data

        # Use .get() to safely access potential keys
        scheme_data = data.get('scheme')
        value = data.get('value')
        display_value = None # Default

        # Ensure scheme_data is a dict or an object with attributes before accessing 'fields'
        scheme_fields = []
        if isinstance(scheme_data, dict) and 'fields' in scheme_data:
            scheme_fields = scheme_data['fields']
        elif hasattr(scheme_data, 'fields'):
            scheme_fields = scheme_data.fields

        # --- Start: Simplified Value Processing Logic ---
        if value is None:
            display_value = None
        elif isinstance(value, str):
            display_value = "N/A" if value.lower() == "n/a" else value
        elif isinstance(value, (int, float)):
             # Basic check for binary-like scales (adjust threshold if needed)
             is_likely_binary = False
             if scheme_fields and len(scheme_fields) == 1:
                 field = scheme_fields[0]
                 # Check if field is dict or object before accessing keys/attrs
                 s_min = field.get('scale_min') if isinstance(field, dict) else getattr(field, 'scale_min', None)
                 s_max = field.get('scale_max') if isinstance(field, dict) else getattr(field, 'scale_max', None)
                 if s_min == 0 and s_max == 1:
                     is_likely_binary = True

             if is_likely_binary:
                 display_value = 'True' if value > 0.5 else 'False'
             else:
                 display_value = value # Keep as number otherwise
        elif isinstance(value, dict):
             # Try to extract based on field names if available
             extracted = {}
             if scheme_fields:
                 field_names = [f.get('name') if isinstance(f, dict) else getattr(f, 'name', None) for f in scheme_fields]
                 for name in field_names:
                     if name and name in value:
                         extracted[name] = value[name]

             display_value = extracted if extracted else value # Fallback to raw dict
        elif isinstance(value, list):
             display_value = value # Return list as is
        else:
             display_value = str(value) # Fallback to string representation
        # --- End: Simplified Value Processing Logic ---

        data['display_value'] = display_value
        return data

# API model for querying results (e.g., for specific documents)
class ClassificationResultQuery(SQLModel):
    document_ids: List[int] = Field(default=[])
    scheme_ids: Optional[List[int]] = None # Allow filtering by scheme too
    run_ids: Optional[List[int]] = None # Allow filtering by run


# ---------------------------------------------------------------------------
# Saved Result Set Management Models
# ---------------------------------------------------------------------------
# A SavedResultSet represents a user-defined, named collection (snapshot)
# of ClassificationResults, defined by a specific set of Document IDs and
# Scheme IDs. This allows users to bookmark interesting cross-sections of
# data, potentially spanning multiple ClassificationRuns.

# Shared properties for SavedResultSet
class SavedResultSetBase(SQLModel):
    name: str
    # Store the criteria defining the set
    document_ids: List[int] = Field(default=[], sa_column=Column(ARRAY(Integer)))
    scheme_ids: List[int] = Field(default=[], sa_column=Column(ARRAY(Integer)))

# Database table model for SavedResultSet
class SavedResultSet(SavedResultSetBase, table=True):
    id: int = Field(default=None, primary_key=True)
    workspace_id: int = Field(foreign_key="workspace.uid")
    # user_id: int = Field(foreign_key="user.id") # Link to user who saved it
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # workspace: Optional["Workspace"] = Relationship(back_populates="saved_result_sets") # Add if needed
    # user: Optional["User"] = Relationship() # Add if needed

# API model for SavedResultSet creation
class SavedResultSetCreate(SavedResultSetBase):
    pass # Base fields are sufficient

# API model for returning SavedResultSet data
class SavedResultSetRead(SavedResultSetBase):
    id: int
    workspace_id: int
    # user_id: int
    created_at: datetime
    updated_at: datetime
    # Optionally include the actual results matching the criteria (can be large)
    results: List["ClassificationResultRead"] = Field(default_factory=list)


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

