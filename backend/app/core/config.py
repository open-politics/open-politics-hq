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
    API_V2_STR: str = "/api/v2"
    SECRET_KEY: str = secrets.token_urlsafe(32)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    DOMAIN: str = "localhost"
    ENVIRONMENT: Literal["local", "staging", "production"] = "local"
    OPOL_DEV_MODE: bool = os.environ.get("OPOL_DEV_MODE", "False") == "True"
    OPOL_MODE: str = os.environ.get("OPOL_MODE", "container")
    OPOL_API_KEY: str | None = os.environ.get("OPOL_API_KEY")
    
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

    PROJECT_NAME: str = "OSINT Kernel"
    SENTRY_DSN: Optional[HttpUrl] = None
    POSTGRES_SERVER: str
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str = ""

    @computed_field  # type: ignore[misc]
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
        return MultiHostUrl.build(
            scheme="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
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
    
    # Temporary folder for file downloads
    TEMP_FOLDER: str = Field(default="/tmp/osint_temp", env="TEMP_FOLDER")

    # Instance identifier for data transfer
    INSTANCE_ID: str = Field(default_factory=lambda: str(uuid.uuid4()))

    # === Provider Configurations ===

    # --- Storage Provider ---
    STORAGE_PROVIDER_TYPE: Literal["minio", "s3", "local_fs"] = Field(default="minio", env="STORAGE_PROVIDER_TYPE")
    # --- Classification Provider ---
    CLASSIFICATION_PROVIDER_TYPE: Literal["gemini_native", "opol_google_via_fastclass", "opol_ollama_via_fastclass"] = Field(default="gemini_native", env="CLASSIFICATION_PROVIDER_TYPE")
    # Default model name for the chosen CLASSIFICATION_PROVIDER_TYPE
    DEFAULT_CLASSIFICATION_MODEL_NAME: str = Field(default="gemini-2.5-flash-preview-05-20", env="DEFAULT_CLASSIFICATION_MODEL_NAME")

    # Credentials (ensure these environment variables are set for the chosen provider)
    GOOGLE_API_KEY: Optional[str] = Field(default=None, env="GOOGLE_API_KEY")
    OPENAI_API_KEY: Optional[str] = Field(default=None, env="OPENAI_API_KEY")
    # OPOL specific config (if OPOL is used as an abstraction layer)
    OPOL_MODE: Optional[Literal["remote", "local", "container"]] = Field(default="remote", env="OPOL_MODE")
    OPOL_API_KEY: Optional[str] = Field(default=None, env="OPOL_API_KEY")
    # Ollama specific (if OPOL uses it, or if you add a native Ollama provider)
    OLLAMA_BASE_URL: Optional[str] = Field(default="http://localhost:11434", env="OLLAMA_BASE_URL")
    OLLAMA_DEFAULT_MODEL: Optional[str] = Field(default="llama3", env="OLLAMA_DEFAULT_MODEL")

    # --- Scraping Provider ---
    SCRAPING_PROVIDER_TYPE: Literal["opol", "custom_playwright"] = Field(default="opol", env="SCRAPING_PROVIDER_TYPE")
    # --- Search Provider ---
    SEARCH_PROVIDER_TYPE: Literal["opol_searxng", "elasticsearch", "tavily"] = Field(default="opol_searxng", env="SEARCH_PROVIDER_TYPE")

    # --- Geospatial Provider ---
    GEOSPATIAL_PROVIDER_TYPE: Literal["opol", "nominatim"] = Field(default="opol", env="GEOSPATIAL_PROVIDER_TYPE")
    NOMINATIM_DOMAIN: Optional[str] = Field(default="nominatim.openstreetmap.org", env="NOMINATIM_DOMAIN")

    # --- Embedding Provider ---
    EMBEDDING_PROVIDER_TYPE: Literal["ollama", "jina", "openai"] = Field(default="ollama", env="EMBEDDING_PROVIDER_TYPE")
    # Ollama embedding settings
    OLLAMA_EMBEDDING_MODEL: str = Field(default="nomic-embed-text", env="OLLAMA_EMBEDDING_MODEL")
    # Jina AI embedding settings  
    JINA_API_KEY: Optional[str] = Field(default=None, env="JINA_API_KEY")
    JINA_EMBEDDING_MODEL: str = Field(default="jina-embeddings-v2-base-en", env="JINA_EMBEDDING_MODEL")
    # OpenAI embedding settings (for future use)
    OPENAI_EMBEDDING_MODEL: str = Field(default="text-embedding-ada-002", env="OPENAI_EMBEDDING_MODEL")

    # --- Celery / Redis ---
    CELERY_BROKER_URL: str = Field(default="redis://localhost:6379/0", env="CELERY_BROKER_URL")
    CELERY_RESULT_BACKEND: str = Field(default="redis://localhost:6379/0", env="CELERY_RESULT_BACKEND")

    # Tavily API Key
    TAVILY_API_KEY: Optional[str] = Field(default=None, env="TAVILY_API_KEY")

    # --- OPOL "FastClass" specific (from opol_config.py, better centralized here) ---
    FASTCLASS_DEFAULT_PROVIDER: str = Field(default="Google", env="FASTCLASS_DEFAULT_PROVIDER")
    FASTCLASS_DEFAULT_MODEL: str = Field(default="gemini-2.5-flash-preview-05-20", env="FASTCLASS_DEFAULT_MODEL")

    # --- Annotation Processing Configuration ---
    # Default concurrency for parallel annotation processing
    DEFAULT_ANNOTATION_CONCURRENCY: int = Field(default=5, env="DEFAULT_ANNOTATION_CONCURRENCY")
    # Maximum allowed concurrency to prevent overwhelming external APIs
    MAX_ANNOTATION_CONCURRENCY: int = Field(default=20, env="MAX_ANNOTATION_CONCURRENCY")
    # Enable/disable parallel processing (fallback to sequential if disabled)
    ENABLE_PARALLEL_ANNOTATION_PROCESSING: bool = Field(default=True, env="ENABLE_PARALLEL_ANNOTATION_PROCESSING")

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

