import os
import secrets
import warnings
from typing import Annotated, Any, Literal, Dict, List, Optional, Union
from pydantic import (
    AnyUrl,
    BeforeValidator,
    HttpUrl,
    PostgresDsn,
    computed_field,
    model_validator,
    Field,
)
from pydantic_core import MultiHostUrl
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing_extensions import Self
import uuid




def parse_cors(v: Any) -> list[str] | str:
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",")]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_ignore_empty=True, extra="ignore", case_sensitive=False
    )
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = secrets.token_urlsafe(32)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    DOMAIN: str = "localhost"
    ENVIRONMENT: Literal["local", "staging", "production"] = "local"
    OPOL_DEV_MODE: bool = os.environ.get("OPOL_DEV_MODE", "False") == "True"
    OPOL_MODE: str = os.environ.get("OPOL_MODE", "container")
    OPOL_API_KEY: str | None = os.environ.get("OPOL_API_KEY")
    NOMINATIM_PORT: int = os.environ.get("NOMINATIM_PORT", 8721)
    
    if OPOL_DEV_MODE:
        os.environ["PYTHONPATH"] = "/app/opol:/app"

    @computed_field  # type: ignore[misc]
    @property
    def server_host(self) -> str:
        # Use HTTPS for anything other than local development
        if self.ENVIRONMENT == "local":
            return f"http://{self.DOMAIN}"
        return f"https://{self.DOMAIN}"
    
    
    BACKEND_CORS_ORIGINS: Annotated[
        list[AnyUrl] | str, BeforeValidator(parse_cors)
    ] = ["http://localhost:3000", "http://localhost:8000"]
    CORS_ALLOWED_METHODS: Annotated[
        list[str],
        BeforeValidator(parse_cors),
        Field(default=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], env="CORS_ALLOWED_METHODS"),
    ]
    CORS_ALLOWED_HEADERS: Annotated[
        list[str],
        BeforeValidator(parse_cors),
        Field(default=["*"], env="CORS_ALLOWED_HEADERS"),
    ]

    PROJECT_NAME: str = "OSINT Kernel"
    POSTGRES_SERVER: str
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str = ""
    POSTGRES_SSL_MODE: Optional[str] = None

    @computed_field  # type: ignore[misc]
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
        # Build DSN with optional sslmode as a query string to avoid type issues
        query: str | None = (
            f"sslmode={self.POSTGRES_SSL_MODE}"
            if self.POSTGRES_SSL_MODE and self.POSTGRES_SSL_MODE.strip()
            else None
        )
        # Ensure database name does not start with a slash to avoid sending "/dbname" to server

        return MultiHostUrl.build(
            scheme="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
            query=query,
        )

    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: Optional[int] = 587
    SMTP_HOST: Optional[str] = None
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    # TODO: update type to EmailStr when sqlmodel supports it
    EMAILS_FROM_EMAIL: Optional[str] = None
    EMAILS_FROM_NAME: Optional[str] = None

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        if self.emails_enabled and not self.EMAILS_FROM_NAME:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        if self.emails_enabled and not self.EMAILS_FROM_EMAIL:
            raise ValueError("EMAILS_FROM_EMAIL must be set if SMTP is configured.")
        return self

    EMAIL_RESET_TOKEN_EXPIRE_HOURS: int = 48

    @computed_field  # type: ignore[misc]
    @property
    def emails_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.SMTP_PORT and self.EMAILS_FROM_EMAIL)

    # TODO: update type to EmailStr when sqlmodel supports it
    EMAIL_TEST_USER: str = "test@example.com"
    # TODO: update type to EmailStr when sqlmodel supports it
    FIRST_SUPERUSER: str
    FIRST_SUPERUSER_PASSWORD: str
    USERS_OPEN_REGISTRATION: bool = False
    REQUIRE_EMAIL_VERIFICATION: bool = True

    # Discourse Connect (SSO) Configuration
    DISCOURSE_CONNECT_ENABLED: bool = Field(default=False, env="DISCOURSE_CONNECT_ENABLED")
    DISCOURSE_CONNECT_SECRET: Optional[str] = Field(default=None, env="DISCOURSE_CONNECT_SECRET")
    DISCOURSE_CONNECT_URL: Optional[str] = Field(default=None, env="DISCOURSE_CONNECT_URL")  # e.g., https://forum.open-politics.org

    # MinIO Configuration
    MINIO_ENDPOINT: Optional[str] = Field(default="localhost:9000", env="MINIO_ENDPOINT")
    MINIO_ACCESS_KEY: Optional[str] = Field(default="minioadmin", env="MINIO_ACCESS_KEY")
    MINIO_SECRET_KEY: Optional[str] = Field(default="minioadmin", env="MINIO_SECRET_KEY")
    MINIO_BUCKET_NAME: str = Field(default="osint-kernel-bucket", env="MINIO_BUCKET_NAME")
    MINIO_USE_SSL: bool = Field(default=False, env="MINIO_USE_SSL")
    # S3 specific (examples)
    S3_BUCKET_NAME: Optional[str] = Field(default=None, env="S3_BUCKET_NAME")
    S3_ACCESS_KEY_ID: Optional[str] = Field(default=None, env="S3_ACCESS_KEY_ID")
    S3_SECRET_ACCESS_KEY: Optional[str] = Field(default=None, env="S3_SECRET_ACCESS_KEY")
    S3_REGION: Optional[str] = Field(default=None, env="S3_REGION")
    # Local FS specific (example)
    LOCAL_STORAGE_BASE_PATH: str = Field(default="/tmp/osint_storage", env="LOCAL_STORAGE_BASE_PATH")
    # Whitelist of paths allowed for directory import (comma-separated)
    # Prevents import endpoint from reading arbitrary filesystem locations
    ALLOWED_IMPORT_PATHS: str = Field(default="/data/import,/dataset_collection", env="ALLOWED_IMPORT_PATHS")
    # Max files to scan per directory when include_counts=True; 0 = no cap (defense in depth for 400GB+ browse)
    STORAGE_BROWSE_MAX_COUNT_FILES: int = Field(default=2000, env="STORAGE_BROWSE_MAX_COUNT_FILES")

    # Temporary folder for file downloads
    TEMP_FOLDER: str = Field(default="/tmp/osint_temp", env="TEMP_FOLDER")

    # Instance identifier for data transfer
    INSTANCE_ID: str = Field(default_factory=lambda: str(uuid.uuid4()))

    # --- Connection pool (tuned for concurrent task workers) ---
    DB_POOL_SIZE: int = Field(default=10, env="DB_POOL_SIZE")
    DB_MAX_OVERFLOW: int = Field(default=20, env="DB_MAX_OVERFLOW")
    DB_POOL_PRE_PING: bool = Field(default=True, env="DB_POOL_PRE_PING")

    # --- Upload / content limits (security) ---
    MAX_UPLOAD_SIZE_BYTES: int = Field(default=1024 * 1024 * 1024, env="MAX_UPLOAD_SIZE_BYTES")  # 1GB default
    # PDF processing: max pages per document (0 = no limit, for 400GB+ bulk deployments)
    PDF_MAX_PAGES: int = Field(default=0, env="PDF_MAX_PAGES", description="Max pages to process per PDF; 0 = no limit")
    # process_content Celery rate limit (e.g. "10/s", "100/m"); empty = no limit (prevents Redis queue flooding at import scale)
    PROCESS_CONTENT_RATE_LIMIT: str = Field(default="10/s", env="PROCESS_CONTENT_RATE_LIMIT")
    # Re-resolve singleton window: only consider EntityCanonicals created in last N days; 0 = no time limit
    RESOLVE_SINGLETON_WINDOW_DAYS: int = Field(default=7, env="RESOLVE_SINGLETON_WINDOW_DAYS")
    # Reactive watchers: comma-separated names. Empty = none run. Content: geocoding,ocr,hash,language_detection,quality_score,embedding. Annotation: version_gap_annotation,annotated_to_curate. Graph: superseded_entity_retire,re_resolve_singletons
    ENABLED_WATCHERS: str = Field(default="", env="ENABLED_WATCHERS")
    # Beat interval (seconds) for dispatch_reactive_work. Default 120 (2 min).
    DISPATCH_REACTIVE_WORK_INTERVAL_SECONDS: int = Field(default=120, env="DISPATCH_REACTIVE_WORK_INTERVAL_SECONDS")

    # === Provider Access Control ===
    # Per-provider access levels, set via PROVIDER_ACCESS_<CAPABILITY>_<type_key> env vars.
    # Values: "all" (any user), "superuser" (superuser only), "none" (disabled).
    # Smart defaults: requires_api_key=False → "all", True → "none".
    # Examples:
    #   PROVIDER_ACCESS_LLM_ollama=all          # any user can use system Ollama
    #   PROVIDER_ACCESS_LLM_openai=superuser    # only superusers can use system OpenAI key
    #   PROVIDER_ACCESS_EMBEDDING_ollama=all
    #   PROVIDER_ACCESS_OCR_tesseract=all

    @computed_field  # type: ignore[misc]
    @property
    def provider_access(self) -> Dict[str, str]:
        """Parse PROVIDER_ACCESS_* env vars into {capability_typekey: access_level} dict."""
        result: Dict[str, str] = {}
        prefix = "PROVIDER_ACCESS_"
        for key, value in os.environ.items():
            if key.startswith(prefix) and value.strip():
                # PROVIDER_ACCESS_LLM_ollama → "llm_ollama"
                suffix = key[len(prefix):].lower()
                if value.strip().lower() in ("all", "superuser", "none"):
                    result[suffix] = value.strip().lower()
        return result

    # === Provider Configurations ===

    # --- GeoCoding Provider ---
    # Default provider for geocoding - can be overridden per-request from frontend
    GEOCODING_PROVIDER_TYPE: str = Field(default="local", env="GEOCODING_PROVIDER_TYPE")
    NOMINATIM_BASE_URL: str = Field(default="http://nominatim:8080", env="NOMINATIM_BASE_URL")
    # User agent for API requests (Nominatim requires this per usage policy, also used for archive downloads)
    GEOCODING_USER_AGENT: str = Field(
        default="Mozilla/5.0 (compatible; OpenPoliticsHQ/1.0; +https://open-politics.org)", 
        env="GEOCODING_USER_AGENT"
    )
    # Optional: Mapbox token as fallback (prefer runtime from frontend)
    MAPBOX_ACCESS_TOKEN: Optional[str] = Field(default=None, env="MAPBOX_ACCESS_TOKEN")

    # --- Storage Provider ---
    STORAGE_PROVIDER_TYPE: str = Field(default="minio", env="STORAGE_PROVIDER_TYPE")

    # --- Encryption ---
    # Master key for encrypting user provider credentials
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # REQUIRED in production for storing user API keys securely
    ENCRYPTION_MASTER_KEY: str = Field(
        default="",
        env="ENCRYPTION_MASTER_KEY",
        description="Master encryption key for user API key storage (REQUIRED in production)"
    )
    
    # Credentials (ensure these environment variables are set for the chosen provider)
    GOOGLE_API_KEY: Optional[str] = Field(default=None, env="GOOGLE_API_KEY")
    OPENAI_API_KEY: Optional[str] = Field(default=None, env="OPENAI_API_KEY")
    OPENAI_BASE_URL: Optional[str] = Field(default=None, env="OPENAI_BASE_URL")
    ANTHROPIC_API_KEY: Optional[str] = Field(default=None, env="ANTHROPIC_API_KEY")
    ANTHROPIC_BASE_URL: Optional[str] = Field(default=None, env="ANTHROPIC_BASE_URL")
    MISTRAL_API_KEY: Optional[str] = Field(default=None, env="MISTRAL_API_KEY")
    MISTRAL_BASE_URL: Optional[str] = Field(default=None, env="MISTRAL_BASE_URL")
    # OPOL specific config (if OPOL is used as an abstraction layer)
    OPOL_MODE: Optional[Literal["remote", "local", "container"]] = Field(default="remote", env="OPOL_MODE")
    OPOL_API_KEY: Optional[str] = Field(default=None, env="OPOL_API_KEY")
    # Ollama specific (if OPOL uses it, or if you add a native Ollama provider)
    # Use host.docker.internal for Docker containers to reach host machine's Ollama
    OLLAMA_BASE_URL: Optional[str] = Field(default="http://host.docker.internal:11434", env="OLLAMA_BASE_URL")
    OLLAMA_DEFAULT_MODEL: Optional[str] = Field(default="llama3", env="OLLAMA_DEFAULT_MODEL")


    # --- Geospatial Provider ---
    GEOSPATIAL_PROVIDER_TYPE: Literal["opol", "nominatim"] = Field(default="opol", env="GEOSPATIAL_PROVIDER_TYPE")
    NOMINATIM_DOMAIN: Optional[str] = Field(default="nominatim.openstreetmap.org", env="NOMINATIM_DOMAIN")

    # --- Embedding settings (provider is per-infospace via embedding_selection) ---
    # Ollama embedding settings
    OLLAMA_EMBEDDING_MODEL: str = Field(default="nomic-embed-text", env="OLLAMA_EMBEDDING_MODEL")
    # Jina AI embedding settings  
    JINA_API_KEY: Optional[str] = Field(default=None, env="JINA_API_KEY")
    JINA_EMBEDDING_MODEL: str = Field(default="jina-embeddings-v5-text-small", env="JINA_EMBEDDING_MODEL")
    # OpenAI embedding settings (for future use)
    OPENAI_EMBEDDING_MODEL: str = Field(default="text-embedding-3-small", env="OPENAI_EMBEDDING_MODEL")
    VOYAGE_API_KEY: Optional[str] = Field(default=None, env="VOYAGE_API_KEY")
    VOYAGE_BASE_URL: Optional[str] = Field(default=None, env="VOYAGE_BASE_URL")

    # --- Scraping Provider ---
    SCRAPING_PROVIDER_TYPE: str = Field(default="newspaper4k", env="SCRAPING_PROVIDER_TYPE")

    # --- OCR Provider ---
    OCR_PROVIDER_TYPE: str = Field(default="tesseract", env="OCR_PROVIDER_TYPE")
    OLLAMA_OCR_MODEL: str = Field(default="llava", env="OLLAMA_OCR_MODEL")

    # --- Redis Configuration ---
    REDIS_HOST: str = Field(default="redis", env="REDIS_HOST")
    REDIS_PORT: int = Field(default=6379, env="REDIS_PORT")
    REDIS_DB: int = Field(default=0, env="REDIS_DB")
    REDIS_PASSWORD: Optional[str] = Field(default=None, env="REDIS_PASSWORD")
    # Optional: Override with full URL (takes precedence if set)
    REDIS_URL: Optional[str] = Field(default=None, env="REDIS_URL")
    
    @computed_field  # type: ignore[misc]
    @property
    def redis_url(self) -> str:
        # Use explicit REDIS_URL if provided, otherwise construct from components
        if self.REDIS_URL:
            return self.REDIS_URL
        
        # Validate required components
        if not self.REDIS_HOST:
            raise ValueError("REDIS_HOST is required when REDIS_URL is not provided")
        
        # Build URL with password if provided
        # Redis simple auth uses just password (no username) - format: redis://:password@host:port/db
        if self.REDIS_PASSWORD and self.REDIS_PASSWORD.strip():
            from urllib.parse import quote_plus
            # URL-encode password to handle special characters
            encoded_password = quote_plus(self.REDIS_PASSWORD)
            # Note the colon BEFORE password with empty username section
            url = f"redis://:{encoded_password}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        else:
            url = f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        
        return url

    # Tavily API Key
    TAVILY_API_KEY: Optional[str] = Field(default=None, env="TAVILY_API_KEY")

    # --- MCP Server Configuration ---
    # Optional: Explicit URL for MCP server (only needed for separate MCP service)
    # Default behavior: Uses localhost since client and server run in same process
    # Only set this if MCP server is deployed as a separate microservice/container
    # Example: "http://mcp-service:8022" for dedicated MCP container
    MCP_SERVER_URL: Optional[str] = Field(default=None, env="MCP_SERVER_URL")

    # --- Annotation Processing Configuration ---
    # Default concurrency for parallel annotation processing
    DEFAULT_ANNOTATION_CONCURRENCY: int = Field(default=5, env="DEFAULT_ANNOTATION_CONCURRENCY")
    # Maximum allowed concurrency to prevent overwhelming external APIs
    MAX_ANNOTATION_CONCURRENCY: int = Field(default=20, env="MAX_ANNOTATION_CONCURRENCY")
    # Enable/disable parallel processing (fallback to sequential if disabled)
    ENABLE_PARALLEL_ANNOTATION_PROCESSING: bool = Field(default=True, env="ENABLE_PARALLEL_ANNOTATION_PROCESSING")
    # Chunk size for per-chunk commits in large runs (50K-asset run avoids single tx)
    ANNOTATION_CHUNK_SIZE: int = Field(default=50, env="ANNOTATION_CHUNK_SIZE")
    

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        if value == "changethis":
            message = (
                f'The value of {var_name} is "changethis", '
                "for security, please change it, at least for deployments."
            )
            if self.ENVIRONMENT == "local":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        self._check_default_secret("SECRET_KEY", self.SECRET_KEY)
        self._check_default_secret("POSTGRES_PASSWORD", self.POSTGRES_PASSWORD)
        self._check_default_secret("FIRST_SUPERUSER_PASSWORD", self.FIRST_SUPERUSER_PASSWORD)
        if self.STORAGE_PROVIDER_TYPE == "minio":
            if not self.MINIO_ACCESS_KEY or not self.MINIO_SECRET_KEY:
                raise ValueError("MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set for MinIO storage.")
            self._check_default_secret("MINIO_ACCESS_KEY", self.MINIO_ACCESS_KEY)
            self._check_default_secret("MINIO_SECRET_KEY", self.MINIO_SECRET_KEY)
        return self


settings = AppSettings()  # type: ignore

