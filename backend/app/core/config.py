import hashlib
import logging
import os
import secrets
from pathlib import Path
import warnings
from typing import Annotated, Any, Literal, Dict, List, Optional, Union
from pydantic import (
    AliasChoices,
    AliasPath,
    field_validator,
    AnyUrl,
    BeforeValidator,
    HttpUrl,
    PostgresDsn,
    computed_field,
    model_validator,
    Field,
)
from pydantic_core import MultiHostUrl
from pydantic_settings import (
    BaseSettings,
    DotEnvSettingsSource,
    EnvSettingsSource,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)
from typing_extensions import Self
import uuid


# HQ.yml holds everything non-secret. Searched rather than assumed: a relative
# path resolves against CWD, which differs between the API, alembic, a worker
# and a script. Missing file falls through to field defaults.
def _find_hq_config() -> str:
    explicit = os.environ.get("HQ_CONFIG_FILE")
    if explicit:
        return explicit
    here = Path(__file__).resolve()
    candidates = [
        Path.cwd() / "HQ.yml",       # container /app, or repo root on a host
        here.parents[2] / "HQ.yml",  # <app root>/HQ.yml   (/app)
        here.parents[3] / "HQ.yml",  # <repo root>/HQ.yml  (host checkout)
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    return "HQ.yml"


# The capability ceiling's vocabulary. access.Capability is canonical; importing
# it here would be circular, so main.py asserts the two agree at startup.
KNOWN_CAPABILITIES = frozenset({"organize", "ingest", "compute", "delete", "setup"})

HQ_CONFIG_FILE = _find_hq_config()

# Set when someone named the file instead of letting it be discovered. The
# HQ_CONFIG_SHA stamp only pairs a discovered file with its .env, so the
# staleness gate stands down when this is true.
HQ_CONFIG_EXPLICIT = bool(os.environ.get("HQ_CONFIG_FILE"))

ACCESS_LEVELS = ("all", "superuser", "byok", "none")


def is_yaml_backed(field) -> bool:
    """True when this field's home is HQ.yml.

    Yaml-backed fields are declared ``AliasChoices("FIELD_NAME", AliasPath(...))``:
    the path is where the value lives, the bare name is so an explicit
    ``AppSettings(FIELD_NAME=...)`` still works. (A lone AliasPath would make
    the field unreachable by name, and ``populate_by_name`` is not an option —
    pydantic-settings 2.15 mixes it with AliasPath badly enough to KeyError on
    the path's first segment.)
    """
    alias = getattr(field, "validation_alias", None)
    if isinstance(alias, AliasPath):
        return True
    if isinstance(alias, AliasChoices):
        return any(isinstance(c, AliasPath) for c in alias.choices)
    return False


class _SecretsOnlyEnvSource(EnvSettingsSource):
    """An env source that refuses to serve yaml-backed fields.

    A field carrying an ``AliasPath`` lives in HQ.yml, so the environment must
    not answer for it even when the same name happens to sit in .env because
    compose needs to interpolate it (DOMAIN, POSTGRES_PORT, REDIS_HOST…).
    Pydantic treats an AliasPath field as *complex* and tries to JSON-decode
    whatever the env holds — `DOMAIN=localhost` becomes "Expecting value: line
    1 column 1".
    """

    def get_field_value(self, field, field_name):
        if is_yaml_backed(field):
            return None, field_name, False
        return super().get_field_value(field, field_name)


class _SecretsOnlyDotEnvSource(DotEnvSettingsSource):
    """Same rule for the .env file source."""

    def get_field_value(self, field, field_name):
        if is_yaml_backed(field):
            return None, field_name, False
        return super().get_field_value(field, field_name)


def parse_cors(v: Any) -> list[str] | str:
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",")]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", yaml_file=HQ_CONFIG_FILE,
        env_ignore_empty=True, extra="ignore", case_sensitive=False,
    )

    @classmethod
    def settings_customise_sources(
        cls, settings_cls, init_settings, env_settings, dotenv_settings,
        file_secret_settings,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # init first: an explicit AppSettings(FOO=...) outranks any file. The two
        # env sources hand back nothing for a field carrying an AliasPath.
        return (
            init_settings,
            _SecretsOnlyEnvSource(settings_cls),
            _SecretsOnlyDotEnvSource(settings_cls),
            YamlConfigSettingsSource(settings_cls),
        )

    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = secrets.token_urlsafe(32)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(validation_alias=AliasChoices("ACCESS_TOKEN_EXPIRE_MINUTES", AliasPath("deployment", "users", "token_expiry_minutes")), default=60 * 24 * 8, ge=1)
    DOMAIN: str = Field(validation_alias=AliasChoices("DOMAIN", AliasPath("deployment", "network", "domain")), default="localhost")
    ENVIRONMENT: Literal["local", "staging", "production"] = Field(validation_alias=AliasChoices("ENVIRONMENT", AliasPath("stack", "environment")), default="local")

    # Compose owns these; the backend never reads them. Declared because this is
    # the only process that parses HQ.yml as a whole, so it is the only place a
    # typo can be caught.
    NETWORK_MODE: Literal["host", "bridge"] = Field(validation_alias=AliasPath("deployment", "network", "mode"), default="host")
    NETWORK_REACH: Literal["local", "public"] = Field(validation_alias=AliasPath("deployment", "network", "reach"), default="local")
    BACKEND_HOST_PORT: int = Field(validation_alias=AliasPath("deployment", "services", "backend", "port"), default=8022, ge=1, le=65535)
    FRONTEND_HOST_PORT: int = Field(validation_alias=AliasPath("deployment", "services", "frontend", "port"), default=3000, ge=1, le=65535)

    # "auto", or a positive integer — compose interpolates these straight onto a
    # command line. import_style picks which OSM extract nominatim imports.
    NOMINATIM_IMPORT_STYLE: Literal["admin", "address"] = Field(validation_alias=AliasPath("foundation", "providers", "nominatim_local", "import_style"), default="admin")

    BACKEND_WORKERS: Union[Literal["auto"], int] = Field(validation_alias=AliasPath("deployment", "services", "backend", "workers"), default="auto")
    CELERY_WORKERS: Union[Literal["auto"], int] = Field(validation_alias=AliasPath("deployment", "services", "celery", "workers"), default="auto")
    CELERY_PROCESSING_WORKERS: Union[Literal["auto"], int] = Field(validation_alias=AliasPath("deployment", "services", "celery", "processing_workers"), default="auto")

    @field_validator("BACKEND_WORKERS", "CELERY_WORKERS", "CELERY_PROCESSING_WORKERS")
    @classmethod
    def _worker_count_is_positive(cls, v: Any, info: Any) -> Any:
        if isinstance(v, int) and v < 1:
            raise ValueError(f"{info.field_name} is {v}; use a positive number or \"auto\".")
        return v

    @computed_field  # type: ignore[misc]
    @property
    def server_host(self) -> str:
        # Use HTTPS for anything other than local development
        if self.ENVIRONMENT == "local":
            return f"http://{self.DOMAIN}"
        return f"https://{self.DOMAIN}"
    
    
    BACKEND_CORS_ORIGINS: Annotated[
        list[AnyUrl] | str, BeforeValidator(parse_cors)
    ] = Field(validation_alias=AliasPath("deployment", "network", "cors", "origins"),
              default=["http://localhost:3000"])
    CORS_ALLOWED_METHODS: Annotated[
        list[str], BeforeValidator(parse_cors)
    ] = Field(validation_alias=AliasPath("deployment", "network", "cors", "methods"),
              default=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    CORS_ALLOWED_HEADERS: Annotated[
        list[str], BeforeValidator(parse_cors)
    ] = Field(validation_alias=AliasPath("deployment", "network", "cors", "headers"),
              default=["*"])

    PROJECT_NAME: str = Field(validation_alias=AliasChoices("PROJECT_NAME", AliasPath("stack", "project")), default="HQ")
    POSTGRES_SERVER: str = Field(validation_alias=AliasPath("deployment", "services", "database", "host"))
    POSTGRES_PORT: int = Field(validation_alias=AliasChoices("POSTGRES_PORT", AliasPath("deployment", "services", "database", "port")), default=5432, ge=1, le=65535)
    POSTGRES_USER: str = Field(validation_alias=AliasPath("deployment", "services", "database", "user"))
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str = Field(validation_alias=AliasChoices("POSTGRES_DB", AliasPath("deployment", "services", "database", "name")), min_length=1)
    POSTGRES_SSL_MODE: Optional[Literal["", "disable", "allow", "prefer", "require", "verify-ca", "verify-full"]] = Field(validation_alias=AliasChoices("POSTGRES_SSL_MODE", AliasPath("deployment", "services", "database", "ssl_mode")), default=None)

    @computed_field  # type: ignore[misc]
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
        # Build DSN with optional sslmode as a query string to avoid type issues
        query: str | None = (
            f"sslmode={self.POSTGRES_SSL_MODE}"
            if self.POSTGRES_SSL_MODE and self.POSTGRES_SSL_MODE.strip()
            else None
        )

        return MultiHostUrl.build(
            scheme="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
            query=query,
        )

    SMTP_TLS: bool = Field(validation_alias=AliasChoices("SMTP_TLS", AliasPath("deployment", "email", "tls")), default=True)
    SMTP_SSL: bool = Field(validation_alias=AliasChoices("SMTP_SSL", AliasPath("deployment", "email", "ssl")), default=False)
    SMTP_PORT: Optional[int] = Field(validation_alias=AliasChoices("SMTP_PORT", AliasPath("deployment", "email", "port")), default=587, ge=1, le=65535)
    SMTP_HOST: Optional[str] = Field(validation_alias=AliasChoices("SMTP_HOST", AliasPath("deployment", "email", "host")), default=None)
    SMTP_USER: Optional[str] = Field(validation_alias=AliasChoices("SMTP_USER", AliasPath("deployment", "email", "user")), default=None)
    SMTP_PASSWORD: Optional[str] = None
    # TODO: update type to EmailStr when sqlmodel supports it
    EMAILS_FROM_EMAIL: Optional[str] = Field(validation_alias=AliasChoices("EMAILS_FROM_EMAIL", AliasPath("deployment", "email", "from_email")), default=None)
    EMAILS_FROM_NAME: Optional[str] = Field(validation_alias=AliasChoices("EMAILS_FROM_NAME", AliasPath("deployment", "email", "from_name")), default=None)

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        if self.emails_enabled and not self.EMAILS_FROM_NAME:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        if self.emails_enabled and not self.EMAILS_FROM_EMAIL:
            raise ValueError("EMAILS_FROM_EMAIL must be set if SMTP is configured.")
        return self

    EMAIL_RESET_TOKEN_EXPIRE_HOURS: int = Field(validation_alias=AliasChoices("EMAIL_RESET_TOKEN_EXPIRE_HOURS", AliasPath("deployment", "users", "password_reset_expiry_hours")), default=48, ge=1)

    @computed_field  # type: ignore[misc]
    @property
    def emails_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.SMTP_PORT and self.EMAILS_FROM_EMAIL)

    # TODO: update type to EmailStr when sqlmodel supports it
    FIRST_SUPERUSER: str
    FIRST_SUPERUSER_PASSWORD: str
    USERS_OPEN_REGISTRATION: bool = Field(validation_alias=AliasChoices("USERS_OPEN_REGISTRATION", AliasPath("deployment", "users", "open_registration")), default=False)
    REQUIRE_EMAIL_VERIFICATION: bool = Field(validation_alias=AliasChoices("REQUIRE_EMAIL_VERIFICATION", AliasPath("deployment", "users", "require_email_verification")), default=True)

    # Discourse Connect (SSO) Configuration
    DISCOURSE_CONNECT_ENABLED: bool = Field(validation_alias=AliasChoices("DISCOURSE_CONNECT_ENABLED", AliasPath("deployment", "sso", "discourse", "enabled")), default=False)
    DISCOURSE_CONNECT_SECRET: Optional[str] = Field(default=None)
    DISCOURSE_CONNECT_URL: Optional[str] = Field(validation_alias=AliasChoices("DISCOURSE_CONNECT_URL", AliasPath("deployment", "sso", "discourse", "url")), default=None)  # e.g., https://forum.open-politics.org

    # Object storage, when deployment.storage.use is s3.
    S3_BUCKET_NAME: Optional[str] = Field(validation_alias=AliasChoices("S3_BUCKET_NAME", AliasPath("deployment", "services", "s3", "bucket")), default=None)
    S3_ACCESS_KEY_ID: Optional[str] = Field(default=None)
    S3_SECRET_ACCESS_KEY: Optional[str] = Field(default=None)
    S3_REGION: Optional[str] = Field(validation_alias=AliasChoices("S3_REGION", AliasPath("deployment", "services", "s3", "region")), default=None)
    S3_ENDPOINT: Optional[str] = Field(validation_alias=AliasChoices("S3_ENDPOINT", AliasPath("deployment", "services", "s3", "endpoint")), default=None)
    S3_USE_SSL: bool = Field(validation_alias=AliasChoices("S3_USE_SSL", AliasPath("deployment", "services", "s3", "use_ssl")), default=False)
    # Local disk, when deployment.storage.use is local_fs. Must be the container
    # path compose bind-mounts, and it doubles as the directory-import allow-list
    # root, so it is a boundary rather than a hint.
    LOCAL_STORAGE_BASE_PATH: str = Field(validation_alias=AliasChoices("LOCAL_STORAGE_BASE_PATH", AliasPath("deployment", "storage", "user_uploads", "base_path")), default="/data/storage")
    # The dirs a directory import may read from. Empty closes directory import;
    # it does not fall back to the storage root, which holds every infospace's blobs.
    ALLOWED_IMPORT_PATHS: Annotated[
        list[str], BeforeValidator(parse_cors)
    ] = Field(validation_alias=AliasPath("deployment", "storage", "importable_paths"),
              default=["/data/storage/datasets"])

    @property
    def importable_roots(self) -> List[Path]:
        """Resolved roots for directory import. Empty means nothing is importable."""
        roots: List[Path] = []
        for entry in self.ALLOWED_IMPORT_PATHS or []:
            if not str(entry).strip():
                continue
            try:
                roots.append(Path(str(entry)).resolve())
            except (ValueError, OSError):
                continue
        return roots

    def is_importable(self, path: Any) -> bool:
        """True when ``path`` sits under one of ``importable_roots``."""
        try:
            resolved = Path(path).resolve()
        except (ValueError, OSError, TypeError):
            return False
        return any(resolved.is_relative_to(root) for root in self.importable_roots)
    # Max files to scan per directory when include_counts=True; 0 = no cap (defense in depth for 400GB+ browse)
    STORAGE_BROWSE_MAX_COUNT_FILES: int = Field(validation_alias=AliasChoices("STORAGE_BROWSE_MAX_COUNT_FILES", AliasPath("deployment", "storage", "browse_max_files")), default=5000, ge=0)

    # Scratch space for in-flight downloads. Ephemeral on purpose.
    TEMP_FOLDER: str = Field(default="/tmp/hq")

    # Instance identifier for data transfer
    INSTANCE_ID: str = Field(default_factory=lambda: str(uuid.uuid4()))

    # Connection pool (tuned for concurrent task workers)
    DB_POOL_SIZE: int = Field(validation_alias=AliasChoices("DB_POOL_SIZE", AliasPath("deployment", "services", "database", "pool", "size")), default=10, ge=1)
    DB_MAX_OVERFLOW: int = Field(validation_alias=AliasChoices("DB_MAX_OVERFLOW", AliasPath("deployment", "services", "database", "pool", "max_overflow")), default=20, ge=0)
    DB_POOL_PRE_PING: bool = Field(validation_alias=AliasChoices("DB_POOL_PRE_PING", AliasPath("deployment", "services", "database", "pool", "pre_ping")), default=True)

    # Upload / content limits (security)
    MAX_UPLOAD_SIZE_BYTES: int = Field(validation_alias=AliasChoices("MAX_UPLOAD_SIZE_BYTES", AliasPath("deployment", "processing", "max_upload_size_bytes")), default=1024 * 1024 * 1024, ge=1)  # 1GB default
    # PDF processing: max pages per document (0 = no limit, for 400GB+ bulk deployments)
    PDF_MAX_PAGES: int = Field(validation_alias=AliasChoices("PDF_MAX_PAGES", AliasPath("deployment", "processing", "pdf_max_pages")), default=0, ge=0, description="Max pages to process per PDF; 0 = no limit")
    # Which containers this deployment starts, and where each provider lives.
    # Read by the coherence gate; not otherwise consulted at runtime.
    FOUNDATION_RUN: Dict[str, bool] = Field(
        default_factory=dict, validation_alias=AliasPath("foundation", "run")
    )
    FOUNDATION_PROVIDERS: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict, validation_alias=AliasPath("foundation", "providers")
    )

    @field_validator("FOUNDATION_RUN", "FOUNDATION_PROVIDERS", "FOUNDATION_ACCESS",
                     "MCP_CONNECTOR_URLS", mode="before")
    @classmethod
    def _empty_block_is_empty(cls, v: Any) -> Any:
        """A block with nothing under it means nothing, not a boot failure.

        `default_factory` only covers an ABSENT key; YAML hands a present-but-
        empty one over as ``None``, which a ``Dict`` field refuses — so deleting
        the last entry under ``access:`` stopped the whole stack with a pydantic
        error naming neither the file nor the fix. Mid-edit is a normal state for
        a config a person hand-edits, and an empty block reads as empty.
        """
        return {} if v is None else v

    HQ_CONFIG_SHA: Optional[str] = None

    ENRICHERS: Dict[str, bool] = Field(
        default_factory=dict,
        validation_alias=AliasPath("deployment", "processing", "background_content_enrichers"),
    )
    # Beat interval (seconds) for dispatch_tasks. Default 120 (2 min).
    DISPATCH_REACTIVE_WORK_INTERVAL_SECONDS: int = Field(validation_alias=AliasChoices("DISPATCH_REACTIVE_WORK_INTERVAL_SECONDS", AliasPath("deployment", "processing", "dispatch_interval_seconds")), default=120, ge=1)

    # What a fresh install starts with, applied once when the superuser is created.
    # The path is inside the container; compose bind-mounts ./.github/seed onto /app/seed.
    STARTER_DOCUMENTS_PATH: str = Field(validation_alias=AliasPath("deployment", "starter", "documents"), default="/app/seed")
    # Template ids from annotation/templates.py list_templates(). Empty = no schemas.
    STARTER_SCHEMAS: List[str] = Field(validation_alias=AliasPath("deployment", "starter", "schemas"), default_factory=lambda: ["minimal", "positions"])

    # Deployment capability ceiling: comma-separated names, "*" for all, empty =
    # readonly. Intersected with per-user capabilities in Requires().
    # Values: organize, ingest, compute, delete, setup
    DEPLOYMENT_CAPABILITIES: str = Field(validation_alias=AliasChoices("DEPLOYMENT_CAPABILITIES", AliasPath("deployment", "users", "allowed_actions")), default="*")

    @field_validator("DEPLOYMENT_CAPABILITIES")
    @classmethod
    def _capability_names_exist(cls, v: str) -> str:
        """A typo here silently produces a read-only deployment."""
        raw = v.strip()
        if raw in ("*", ""):
            return v
        unknown = [n.strip() for n in raw.split(",")
                   if n.strip() and n.strip() not in KNOWN_CAPABILITIES]
        if unknown:
            raise ValueError(
                f"deployment.users.allowed_actions names {', '.join(unknown)}, which "
                f"grants nothing. Known: {', '.join(sorted(KNOWN_CAPABILITIES))}. "
                f'Use "*" for all, or an empty value for a read-only deployment.'
            )
        return v

    @computed_field  # type: ignore[misc]
    @property
    def deployment_capability_names(self) -> frozenset:
        """'*' = all known capabilities. Empty string = none (readonly)."""
        raw = self.DEPLOYMENT_CAPABILITIES.strip()
        if raw == "*":
            return frozenset(KNOWN_CAPABILITIES)
        if not raw:
            return frozenset()
        return frozenset(n.strip() for n in raw.split(",") if n.strip())

    # Provider access control: who may use THIS deployment's compute or API keys.
    #   foundation:
    #     access:
    #       language:
    #         ollama: all          # our compute/key, any infospace owner
    #         openai: superuser    # our key, superuser-owned infospaces only
    #         anthropic: byok      # usable, but our key is never handed over
    #         mistral: none        # blocked outright
    # Leaving a keyed provider out is the same as `none`.
    FOUNDATION_ACCESS: Dict[str, Dict[str, str]] = Field(
        default_factory=dict, validation_alias=AliasPath("foundation", "access")
    )

    @field_validator("FOUNDATION_ACCESS", mode="before")
    @classmethod
    def _normalise_access_keys(cls, v: Any) -> Any:
        """Lowercase capability and provider keys once, at load. The registry
        keys everything lowercase.
        """
        if not isinstance(v, dict):
            return v
        return {
            str(cap).lower(): (
                {str(p).lower(): str(l).lower() for p, l in entries.items()}
                if isinstance(entries, dict) else entries
            )
            for cap, entries in v.items()
        }

    @model_validator(mode="after")
    def _validate_access_grants(self) -> Self:
        """Reject a malformed grant instead of ignoring it."""
        for cap, entries in (self.FOUNDATION_ACCESS or {}).items():
            where = f"foundation.access.{cap}"
            if not isinstance(entries, dict):
                raise ValueError(
                    f"{where} in {HQ_CONFIG_FILE} must be a map of provider -> "
                    f"{'|'.join(ACCESS_LEVELS)}, got {type(entries).__name__}."
                )
            for provider, level in entries.items():
                if str(level).lower() not in ACCESS_LEVELS:
                    raise ValueError(
                        f"{where}.{provider} is {level!r} in {HQ_CONFIG_FILE}. "
                        f"Use one of {', '.join(ACCESS_LEVELS)}, or remove the line "
                        f"so users bring their own key."
                    )
        return self

    def access_level(self, capability: str, provider_key: str) -> Optional[str]:
        """Grant for one (capability, provider), or None when ungranted."""
        entries = (self.FOUNDATION_ACCESS or {}).get(capability.lower())
        return entries.get(provider_key.lower()) if entries else None

    # Provider Configurations
    # GeoCoding Provider
    # Default provider for geocoding - can be overridden per-request from frontend
    GEOCODING_PROVIDER_TYPE: str = Field(validation_alias=AliasChoices("GEOCODING_PROVIDER_TYPE", AliasPath("foundation", "use", "geocoding")), default="nominatim_local, nominatim_api")
    NOMINATIM_BASE_URL: str = Field(validation_alias=AliasChoices("NOMINATIM_BASE_URL", AliasPath("foundation", "providers", "nominatim_local", "base_url")), default="http://nominatim:8080")
    # Tesseract's OCR language, read via Setting("OCR_DEFAULT_LANGUAGE").
    OCR_DEFAULT_LANGUAGE: str = Field(validation_alias=AliasChoices("OCR_DEFAULT_LANGUAGE", AliasPath("foundation", "providers", "tesseract", "language")), default="eng")

    GEOCODING_USER_AGENT: str = Field(validation_alias=AliasChoices("GEOCODING_USER_AGENT", AliasPath("stack", "user_agent")), default="OpenPoliticsHQ/1.0 (+https://open-politics.org)"
    )
    # Optional: Mapbox token as fallback (prefer runtime from frontend)
    MAPBOX_ACCESS_TOKEN: Optional[str] = Field(default=None)

    # Storage Provider
    STORAGE_PROVIDER_TYPE: str = Field(validation_alias=AliasChoices("STORAGE_PROVIDER_TYPE", AliasPath("deployment", "storage", "use")), default="local_fs")

    # Encryption. Master key for user provider credentials, required in production.
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    ENCRYPTION_MASTER_KEY: str = Field(
        default="",
        description="Primary Fernet key — used to ENCRYPT user API key storage (REQUIRED in production)"
    )
    # Decrypt-only legacy keys, comma-separated. Used ONLY during key rotation so
    # ciphertext written under an old key stays readable. Never used to encrypt.
    ENCRYPTION_MASTER_KEY_FALLBACKS: str = Field(
        default="",
        description="Comma-separated decrypt-only legacy Fernet keys for rotation; remove once rotation verified"
    )

    @computed_field  # type: ignore[misc]
    @property
    def encryption_keys(self) -> List[str]:
        """Ordered Fernet keys for MultiFernet. Index 0 (primary) encrypts;
        all keys are decrypt candidates."""
        keys = [self.ENCRYPTION_MASTER_KEY, *self.ENCRYPTION_MASTER_KEY_FALLBACKS.split(",")]
        return [k.strip() for k in keys if k and k.strip()]

    # Credentials (ensure these environment variables are set for the chosen provider)
    OPENAI_API_KEY: Optional[str] = Field(default=None)
    OPENAI_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("OPENAI_BASE_URL", AliasPath("foundation", "providers", "openai", "base_url")), default="https://api.openai.com/v1")
    ANTHROPIC_API_KEY: Optional[str] = Field(default=None)
    ANTHROPIC_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("ANTHROPIC_BASE_URL", AliasPath("foundation", "providers", "anthropic", "base_url")), default="https://api.anthropic.com")
    MISTRAL_API_KEY: Optional[str] = Field(default=None)
    MISTRAL_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("MISTRAL_BASE_URL", AliasPath("foundation", "providers", "mistral", "base_url")), default="https://api.mistral.ai/v1")
    # Ollama (native provider). Use host.docker.internal to reach the host's Ollama from a container.
    OLLAMA_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("OLLAMA_BASE_URL", AliasPath("foundation", "providers", "ollama", "base_url")), default="http://ollama:11434")

    # Embedding settings (provider is per-infospace via enrichment_config.embedding)
    JINA_API_KEY: Optional[str] = Field(default=None)
    VOYAGE_API_KEY: Optional[str] = Field(default=None)
    VOYAGE_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("VOYAGE_BASE_URL", AliasPath("foundation", "providers", "voyage", "base_url")), default="https://api.voyageai.com/v1")

    # Provider base URLs that providers.py reads by name. Every Setting() in a
    # declaration names a field here, and this default is the only one — a
    # Setting carries no default of its own.
    SEARXNG_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("SEARXNG_BASE_URL", AliasPath("foundation", "providers", "searxng", "base_url")), default="http://searxng:8888")
    LLAMACPP_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("LLAMACPP_BASE_URL", AliasPath("foundation", "providers", "llamacpp", "base_url")), default="http://host.docker.internal:4000")
    JINA_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("JINA_BASE_URL", AliasPath("foundation", "providers", "jina", "base_url")), default="https://api.jina.ai/v1/embeddings")
    TAVILY_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("TAVILY_BASE_URL", AliasPath("foundation", "providers", "tavily", "base_url")), default="https://api.tavily.com")
    MAPBOX_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("MAPBOX_BASE_URL", AliasPath("foundation", "providers", "mapbox", "base_url")), default="https://api.mapbox.com/geocoding/v5/mapbox.places")
    NOMINATIM_API_URL: Optional[str] = Field(validation_alias=AliasChoices("NOMINATIM_API_URL", AliasPath("foundation", "providers", "nominatim_api", "base_url")), default="https://nominatim.openstreetmap.org")
    # Kev serves decisions on the System One API. Container by default; point it at
    # host.docker.internal:8009 to use one you run yourself. It has no auth of its
    # own, which is why setup.sh keeps its port in the loopback audit.
    KEV_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("KEV_BASE_URL", AliasPath("foundation", "providers", "kev", "base_url")), default="http://kev:8009")
    TYPESAFE_API_KEY: Optional[str] = Field(default=None)
    TYPESAFE_BASE_URL: Optional[str] = Field(validation_alias=AliasChoices("TYPESAFE_BASE_URL", AliasPath("foundation", "providers", "typesafe", "base_url")), default="https://api.typesafe.ai")

    # Outbound: MCP servers a language endpoint may call itself, {label: url}.
    # `hq` is our own /tools and needs a URL reachable from the provider's side.
    # Empty => every tool runs through our own executor. Not MCP_SERVER_URL below,
    # which is inbound — where OUR client finds the server.
    MCP_CONNECTOR_URLS: Dict[str, str] = Field(validation_alias=AliasChoices("MCP_CONNECTOR_URLS", AliasPath("foundation", "mcp_connectors")), default_factory=dict)

    # Scraping Provider
    SCRAPING_PROVIDER_TYPE: str = Field(validation_alias=AliasChoices("SCRAPING_PROVIDER_TYPE", AliasPath("foundation", "use", "scraping")), default="newspaper4k")

    # Web Search Provider
    WEB_SEARCH_PROVIDER_TYPE: str = Field(validation_alias=AliasChoices("WEB_SEARCH_PROVIDER_TYPE", AliasPath("foundation", "use", "web_search")), default="searxng")

    # OCR Provider
    OCR_PROVIDER_TYPE: str = Field(validation_alias=AliasChoices("OCR_PROVIDER_TYPE", AliasPath("foundation", "use", "ocr")), default="tesseract")
    OLLAMA_OCR_MODEL: str = Field(validation_alias=AliasChoices("OLLAMA_OCR_MODEL", AliasPath("foundation", "providers", "ollama", "ocr_model")), default="llava")

    # Logic Provider. Empty by default: unlike ocr or scraping there is no built-in
    # answer, so a deployment that never names one simply has no `logic` capability.
    LOGIC_PROVIDER_TYPE: str = Field(validation_alias=AliasChoices("LOGIC_PROVIDER_TYPE", AliasPath("foundation", "use", "logic")), default="")

    # Redis Configuration
    REDIS_HOST: str = Field(validation_alias=AliasChoices("REDIS_HOST", AliasPath("deployment", "services", "redis", "host")), default="redis")
    REDIS_PORT: int = Field(validation_alias=AliasChoices("REDIS_PORT", AliasPath("deployment", "services", "redis", "port")), default=6379)
    REDIS_DB: int = Field(validation_alias=AliasChoices("REDIS_DB", AliasPath("deployment", "services", "redis", "db")), default=0)
    REDIS_PASSWORD: Optional[str] = Field(default=None)
    # Optional: Override with full URL (takes precedence if set)
    REDIS_URL: Optional[str] = Field(validation_alias=AliasChoices("REDIS_URL", AliasPath("deployment", "services", "redis", "url")), default=None)
    
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
            url = f"redis://:{encoded_password}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        else:
            url = f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        
        return url

    # Tavily API Key
    TAVILY_API_KEY: Optional[str] = Field(default=None)

    # MCP server URL. Only needed when MCP runs as a separate service; the default
    # is in-process. Example: "http://mcp-service:8022".
    MCP_SERVER_URL: Optional[str] = Field(default=None)   # inbound; see MCP_CONNECTOR_URLS

    # Annotation Processing Configuration
    # Default concurrency for parallel annotation processing
    DEFAULT_ANNOTATION_CONCURRENCY: int = Field(validation_alias=AliasChoices("DEFAULT_ANNOTATION_CONCURRENCY", AliasPath("deployment", "processing", "annotation", "default_concurrency")), default=5, ge=1)
    # Maximum allowed concurrency to prevent overwhelming external APIs
    MAX_ANNOTATION_CONCURRENCY: int = Field(validation_alias=AliasChoices("MAX_ANNOTATION_CONCURRENCY", AliasPath("deployment", "processing", "annotation", "max_concurrency")), default=20, ge=1)
    # Chunk size for per-chunk commits in large runs (50K-asset run avoids single tx)
    ANNOTATION_CHUNK_SIZE: int = Field(validation_alias=AliasChoices("ANNOTATION_CHUNK_SIZE", AliasPath("deployment", "processing", "annotation", "chunk_size")), default=50, ge=1)
    


    # Boot gates. At import, so they fire in every process, not just the web
    # entrypoint.

    @model_validator(mode="after")
    def _gate_config_is_current(self) -> Self:
        """.env's generated region must match the yaml it was rendered from."""
        if not self.HQ_CONFIG_SHA or HQ_CONFIG_EXPLICIT:
            return self          # nothing rendered yet, or a deliberately chosen file
        try:
            digest = hashlib.sha256(Path(HQ_CONFIG_FILE).read_bytes()).hexdigest()[:16]
        except OSError:
            return self
        if digest != self.HQ_CONFIG_SHA:
            raise ValueError(
                f"{HQ_CONFIG_FILE} changed since .env was rendered "
                f"(config {digest}, .env expects {self.HQ_CONFIG_SHA}).\n"
                f"Run:  ./setup.sh render && docker compose up -d\n"
                f"(`render` is non-interactive and idempotent; the dashboard's "
                f"start does it for you.)"
            )
        return self

    @model_validator(mode="after")
    def _gate_limits_are_coherent(self) -> Self:
        """Bounds that only make sense relative to each other."""
        if self.DEFAULT_ANNOTATION_CONCURRENCY > self.MAX_ANNOTATION_CONCURRENCY:
            raise ValueError(
                f"deployment.processing.annotation.default_concurrency "
                f"({self.DEFAULT_ANNOTATION_CONCURRENCY}) exceeds max_concurrency "
                f"({self.MAX_ANNOTATION_CONCURRENCY}); every run would be clamped "
                f"to the max and the default would never be the default."
            )
        return self

    @property
    def chosen_providers(self) -> List[tuple]:
        """(capability, value) for every `use` selection, including storage."""
        return [
            ("storage", self.STORAGE_PROVIDER_TYPE),
            ("ocr", self.OCR_PROVIDER_TYPE),
            ("geocoding", self.GEOCODING_PROVIDER_TYPE),
            ("web_search", self.WEB_SEARCH_PROVIDER_TYPE),
            ("scraping", self.SCRAPING_PROVIDER_TYPE),
            ("logic", self.LOGIC_PROVIDER_TYPE),
        ]

    @model_validator(mode="after")
    def _gate_providers_are_reachable(self) -> Self:
        """Refuse a provider that points at a container we do not run.

        Keyed on the ADDRESS, not the provider name: `use: ollama` with
        base_url http://ollama:11434 and run.ollama false is broken, while the
        same grant with host.docker.internal is Ollama on the host and fine.
        A comma list passes if ANY entry is usable — `tesseract, ollama` with
        Ollama off still has Tesseract to answer with.
        """
        run = {k.lower(): bool(v) for k, v in (self.FOUNDATION_RUN or {}).items()}
        if not run:
            return self
        _dead_fallbacks: List[str] = []

        def unreachable(provider: str) -> Optional[str]:
            cfg = (self.FOUNDATION_PROVIDERS or {}).get(provider.lower()) or {}
            addr = cfg.get("base_url") or cfg.get("endpoint")
            if not addr:
                return None                       # in-process, nothing to reach
            host = str(addr).split("//")[-1].split("/")[0].split(":")[0]
            if host in run and not run[host]:
                return f"{addr} needs foundation.run.{host}: true"
            return None

        problems = []
        for capability, chosen in self.chosen_providers:
            entries = [c.strip() for c in str(chosen or "").split(",") if c.strip()]
            if not entries:
                continue
            reasons = [(e, unreachable(e)) for e in entries]
            if all(r for _, r in reasons):        # nothing in the list can answer
                detail = "; ".join(f"{e}: {r}" for e, r in reasons)
                problems.append(f"  use.{capability} = {chosen} -> {detail}")
            else:
                # Something answers, so the deployment works, but this entry
                # never will.
                for entry, why in reasons:
                    if why:
                        _dead_fallbacks.append(f"use.{capability}: {entry} ({why})")

        # storage is special: `s3` is served by services.s3, not a provider entry
        if self.STORAGE_PROVIDER_TYPE == "s3" and self.S3_ENDPOINT:
            host = str(self.S3_ENDPOINT).split("//")[-1].split("/")[0].split(":")[0]
            if host in run and not run[host]:
                problems.append(
                    f"  storage.use = s3 -> services.s3.endpoint {self.S3_ENDPOINT} "
                    f"needs foundation.run.{host}: true"
                )

        if problems:
            raise ValueError(
                "Config points at containers this deployment does not run:\n"
                + "\n".join(problems)
                + f"\nSet the run flag in {HQ_CONFIG_FILE}, or point the address at "
                  "an instance you already have."
            )
        # Grants are warned about, not refused: granting a provider you intend to
        # switch on later is legitimate.
        for cap, entries in (self.FOUNDATION_ACCESS or {}).items():
            if not isinstance(entries, dict):
                continue
            for prov, level in entries.items():
                if str(level).lower() == "none":
                    continue
                why = unreachable(prov)
                if why:
                    _dead_fallbacks.append(f"access.{cap}.{prov} ({why})")

        if _dead_fallbacks:
            logging.getLogger(__name__).warning(
                "[CONFIG] configured but unreachable: %s",
                "; ".join(_dead_fallbacks),
            )
        return self

    @model_validator(mode="after")
    def _gate_secrets_are_real(self) -> Self:
        """Refuse to run on a shipped placeholder. Every environment.

        SECRET_KEY signs JWTs and ENCRYPTION_MASTER_KEY is the only thing
        standing between a database dump and every user's provider credentials.
        """
        placeholders = {"changethis", "app_user", "app_user_password", ""}
        offenders = [
            name for name in (
                "SECRET_KEY", "ENCRYPTION_MASTER_KEY", "POSTGRES_PASSWORD",
                "FIRST_SUPERUSER", "FIRST_SUPERUSER_PASSWORD",
            )
            if str(getattr(self, name, "") or "").strip().lower() in placeholders
        ]
        # Redis is reachable from every container on the compose network and, in
        # host mode, from anything on the box.
        if str(self.REDIS_PASSWORD or "").strip().lower() in placeholders:
            offenders.append("REDIS_PASSWORD")
        if offenders:
            raise ValueError(
                "Unset or placeholder secrets: " + ", ".join(offenders) + ". "
                "Run ./setup.sh — it generates strong values and never overwrites "
                "one you already set."
            )
        return self


settings = AppSettings()  # type: ignore
