"""
Provider Declarations
=====================

All provider declarations live here — one decorated class per external service.
The ``@provider`` decorator reads ``Capability`` attributes and registers
``ProviderDescriptor`` entries into the shared registry.

Adding a new provider: define a class with ``key``, optional ``api_key`` /
``base_url`` / ``contexts``, and one or more capability attributes
(``language``, ``embedding``, ``ocr``, etc.). Credential key for user-stored
keys is auto-derived from ``key`` when ``api_key`` is present.

Most providers only need ``api_key`` and ``base_url``, which ``_build_config``
handles automatically. The ``extra`` lambdas exist for providers whose
implementations have non-standard constructor signatures — see inline comments
on each for the specific reason.
"""

from app.core.config import AppSettings
from app.api.modules.foundation_service_providers.base import (
    LLMModelSpec,
    EmbeddingModelSpec,
    StorageProvider,
    ScrapingProvider,
    WebSearchProvider,
    EmbeddingProvider,
    GeocodingProvider,
    OcrProvider,
)
from app.api.modules.foundation_service_providers.registry import (
    Setting,
    Capability,
    provider,
    get_provider,
)


# ── Multi-capability providers ────────────────────────────────────────────────

@provider
class Ollama:
    key = "ollama"
    base_url = Setting("OLLAMA_BASE_URL", default="http://host.docker.internal:11434")
    contexts = {"local", "self_hosted"}

    language = Capability("language_ollama.OllamaLanguageModelProvider")
    embedding = Capability("embedding_ollama.OllamaEmbeddingProvider")
    ocr = Capability(
        "ocr_ollama.OllamaOcrProvider",
        extra=lambda s: {"model": getattr(s, "OLLAMA_OCR_MODEL", "llava")},  # ollama serves multiple vision models — selects which one does OCR
    )


@provider
class OpenAI:
    key = "openai"
    api_key = Setting("OPENAI_API_KEY")
    base_url = Setting("OPENAI_BASE_URL", default="https://api.openai.com/v1")
    contexts = {"cloud"}

    language = Capability("language_openai.OpenAILanguageModelProvider", models=[
        LLMModelSpec(
            name="gpt-5.2",
            supports_tools=True,
            supports_streaming=True,
            supports_multimodal=True,
            supports_structured_output=True,
        ),
        LLMModelSpec(
            name="gpt-5-mini",
            supports_tools=True,
            supports_streaming=True,
            supports_multimodal=True,
            supports_structured_output=True,
        ),
        LLMModelSpec(
            name="gpt-5-nano",
            supports_tools=True,
            supports_streaming=True,
            supports_structured_output=True,
        ),
        LLMModelSpec(
            name="gpt-4.1",
            supports_tools=True,
            supports_streaming=True,
            supports_multimodal=True,
            supports_structured_output=True,
        ),
        LLMModelSpec(
            name="o3",
            supports_tools=True,
            supports_streaming=True,
            supports_thinking=True,
            supports_structured_output=True,
        ),
        LLMModelSpec(
            name="o4-mini",
            supports_tools=True,
            supports_streaming=True,
            supports_thinking=True,
            supports_structured_output=True,
        ),
    ])
    embedding = Capability("embedding_openai.OpenAIEmbeddingProvider", models=[
        EmbeddingModelSpec(
            name="text-embedding-3-small",
            dimension=1536,
            max_sequence_length=8191,
        ),
        EmbeddingModelSpec(
            name="text-embedding-3-large",
            dimension=3072,
            max_sequence_length=8191,
        ),
    ], extra=lambda s, models: {  # openai's API doesn't expose embedding specs — dimensions must be passed in
        "models": {
            m.name: {"dimension": m.dimension, "max_sequence_length": m.max_sequence_length}
            for m in models
        },
    })


# ── Language-only providers ───────────────────────────────────────────────────

@provider
class Anthropic:
    key = "anthropic"
    api_key = Setting("ANTHROPIC_API_KEY")
    base_url = Setting("ANTHROPIC_BASE_URL", default="https://api.anthropic.com")
    contexts = {"cloud"}

    language = Capability("language_anthropic.AnthropicLanguageModelProvider", models=[
        LLMModelSpec(
            name="claude-sonnet-4-6",
            supports_tools=True,
            supports_streaming=True,
            supports_thinking=True,
            supports_multimodal=True,
            supports_structured_output=True,
        ),
        LLMModelSpec(
            name="claude-opus-4-6",
            supports_tools=True,
            supports_streaming=True,
            supports_thinking=True,
            supports_multimodal=True,
            supports_structured_output=True,
        ),
        LLMModelSpec(
            name="claude-haiku-4-5",
            supports_tools=True,
            supports_streaming=True,
            supports_thinking=False,
            supports_multimodal=True,
            supports_structured_output=True,
        ),
    ])


@provider
class Gemini:
    key = "gemini"
    api_key = Setting("GOOGLE_API_KEY")
    contexts = {"cloud"}

    language = Capability("language_gemini.GeminiLanguageModelProvider", models=[
        LLMModelSpec(
            name="gemini-3.1-pro",
            supports_tools=True,
            supports_streaming=True,
            supports_thinking=True,
            supports_multimodal=True,
            supports_structured_output=True,
            context_length=1048576,
            max_tokens=8192,
        ),
        LLMModelSpec(
            name="gemini-3-flash",
            supports_tools=True,
            supports_streaming=True,
            supports_thinking=True,
            supports_multimodal=True,
            supports_structured_output=True,
            context_length=1048576,
            max_tokens=8192,
        ),
        LLMModelSpec(
            name="gemini-2.5-pro",
            supports_tools=True,
            supports_streaming=True,
            supports_thinking=True,
            supports_multimodal=True,
            supports_structured_output=True,
            context_length=1048576,
            max_tokens=8192,
        ),
        LLMModelSpec(
            name="gemini-2.5-flash",
            supports_tools=True,
            supports_streaming=True,
            supports_thinking=True,
            supports_multimodal=True,
            supports_structured_output=True,
            context_length=1048576,
            max_tokens=8192,
        ),
    ])


@provider
class Mistral:
    key = "mistral"
    api_key = Setting("MISTRAL_API_KEY")
    base_url = Setting("MISTRAL_BASE_URL", default="https://api.mistral.ai")
    contexts = {"cloud"}

    language = Capability("language_mistral.MistralLanguageModelProvider", models=[
        LLMModelSpec(
            name="mistral-large-latest",
            supports_tools=True,
            supports_streaming=True,
            supports_structured_output=True,
        ),
        LLMModelSpec(
            name="mistral-small-latest",
            supports_tools=True,
            supports_streaming=True,
            supports_structured_output=True,
        ),
        LLMModelSpec(
            name="codestral-latest",
            supports_tools=True,
            supports_streaming=True,
            supports_structured_output=True,
        ),
    ])


# ── Embedding-only providers ─────────────────────────────────────────────────

@provider
class Jina:
    key = "jina"
    api_key = Setting("JINA_API_KEY")
    contexts = {"cloud"}

    embedding = Capability("embedding_jina.JinaEmbeddingProvider", models=[
        EmbeddingModelSpec(
            name="jina-embeddings-v5-text-small",
            dimension=1024,
            max_sequence_length=32768,
        ),
        EmbeddingModelSpec(
            name="jina-embeddings-v5-text-nano",
            dimension=768,
            max_sequence_length=8192,
        ),
        EmbeddingModelSpec(
            name="jina-embeddings-v4",
            dimension=1024,
            max_sequence_length=32768,
        ),
    ], extra=lambda s, models: {  # jina has no model-spec API; fallback model + dimensions provided statically
        "default_model": getattr(s, "JINA_EMBEDDING_MODEL", "jina-embeddings-v5-text-small"),
        "models": {
            m.name: {"dimension": m.dimension, "max_sequence_length": m.max_sequence_length}
            for m in models
        },
    })


@provider
class Voyage:
    key = "voyage"
    api_key = Setting("VOYAGE_API_KEY")
    base_url = Setting("VOYAGE_BASE_URL", default="https://api.voyageai.com/v1")
    contexts = {"cloud"}

    embedding = Capability("embedding_voyage.VoyageAIEmbeddingProvider", models=[
        EmbeddingModelSpec(
            name="voyage-4-large",
            dimension=1024,
            max_sequence_length=32000,
        ),
        EmbeddingModelSpec(
            name="voyage-4",
            dimension=1024,
            max_sequence_length=32000,
        ),
        EmbeddingModelSpec(
            name="voyage-4-lite",
            dimension=1024,
            max_sequence_length=32000,
        ),
        EmbeddingModelSpec(
            name="voyage-4-nano",
            dimension=1024,
            max_sequence_length=32000,
        ),
        EmbeddingModelSpec(
            name="voyage-code-3",
            dimension=1024,
            max_sequence_length=32000,
        ),
        EmbeddingModelSpec(
            name="voyage-finance-2",
            dimension=1024,
            max_sequence_length=32000,
        ),
        EmbeddingModelSpec(
            name="voyage-law-2",
            dimension=1024,
            max_sequence_length=32000,
        ),
        EmbeddingModelSpec(
            name="voyage-code-2",
            dimension=1536,
            max_sequence_length=16000,
        ),
    ])


# ── OCR ───────────────────────────────────────────────────────────────────────

@provider
class Tesseract:
    key = "tesseract"
    contexts = {"local"}
    ocr = Capability("ocr_tesseract.TesseractOcrProvider")


# ── Geocoding ─────────────────────────────────────────────────────────────────

@provider
class NominatimLocal:
    key = "local"
    base_url = Setting("NOMINATIM_BASE_URL", default="http://nominatim:8080")
    contexts = {"local", "self_hosted"}
    geocoding = Capability("geocoding_nominatim_local.NominatimLocalGeocodingProvider")


@provider
class NominatimAPI:
    key = "nominatim_api"
    contexts = {"cloud"}
    geocoding = Capability("geocoding_nominatim_api.NominatimAPIGeocodingProvider",
        extra=lambda s: {"user_agent": s.GEOCODING_USER_AGENT})  # nominatim blocks requests without a user-agent


@provider
class Mapbox:
    key = "mapbox"
    api_key = Setting("MAPBOX_ACCESS_TOKEN")
    contexts = {"cloud"}
    geocoding = Capability("geocoding_mapbox.MapboxGeocodingProvider")


# ── Storage ───────────────────────────────────────────────────────────────────

@provider
class MinIO:
    key = "minio"
    contexts = {"self_hosted"}
    storage = Capability("storage_minio.MinioStorageProvider",
        extra=lambda s: {  # S3 protocol needs its own credential shape — doesn't fit api_key/base_url
            "endpoint_url": s.MINIO_ENDPOINT,
            "access_key": s.MINIO_ACCESS_KEY,
            "secret_key": s.MINIO_SECRET_KEY,
            "bucket_name": s.MINIO_BUCKET_NAME,
            "use_ssl": s.MINIO_USE_SSL,
        })


@provider
class LocalFS:
    key = "local_fs"
    contexts = {"local"}
    storage = Capability("storage_local.LocalFileSystemStorageProvider",
        extra=lambda s: {  # impl resolves all paths under base_path and validates imports against allowed list
            "base_path": s.LOCAL_STORAGE_BASE_PATH,
            "allowed_import_paths": [p.strip() for p in (s.ALLOWED_IMPORT_PATHS or "").split(",") if p.strip()],
        })


# ── Scraping ──────────────────────────────────────────────────────────────────

@provider
class Newspaper4k:
    key = "newspaper4k"
    contexts = {"local"}
    scraping = Capability("scraping_newspaper4k.Newspaper4kScrapingProvider",
        extra=lambda s: {"config": {  # newspaper4k builds its internal Config once at init from this dict
            "timeout": getattr(s, "SCRAPING_TIMEOUT", 30),
            "threads": getattr(s, "SCRAPING_THREADS", 4),
            "fetch_images": getattr(s, "SCRAPING_FETCH_IMAGES", True),
            "enable_nlp": getattr(s, "SCRAPING_ENABLE_NLP", False),
            "language": getattr(s, "SCRAPING_DEFAULT_LANGUAGE", "en"),
            "user_agent": getattr(s, "SCRAPING_USER_AGENT", None),
        }})


# ── Web Search ────────────────────────────────────────────────────────────────

@provider
class Tavily:
    key = "tavily"
    api_key = Setting("TAVILY_API_KEY")
    contexts = {"cloud"}
    web_search = Capability("web_search_tavily.TavilyWebSearchProvider")


@provider
class SearXNG:
    key = "searxng"
    base_url = Setting("SEARXNG_BASE_URL", default="http://searxng:8080")
    contexts = {"local", "self_hosted"}
    web_search = Capability("web_search_searxng.SearXNGWebSearchProvider")


# ── Convenience getters ──────────────────────────────────────────────────────

def get_storage_provider(settings: AppSettings):
    return get_provider(StorageProvider, settings.STORAGE_PROVIDER_TYPE.lower(), settings)


def get_scraping_provider(settings: AppSettings):
    provider_type = getattr(settings, "SCRAPING_PROVIDER_TYPE", "newspaper4k").lower()
    return get_provider(ScrapingProvider, provider_type, settings)


def get_web_search_provider(settings: AppSettings):
    provider_type = getattr(settings, "WEB_SEARCH_PROVIDER_TYPE", "searxng").lower()
    return get_provider(WebSearchProvider, provider_type, settings)


def get_embedding_provider(settings: AppSettings, type_key: str = "ollama"):
    """Get an embedding provider by explicit type_key (no system-wide default)."""
    return get_provider(EmbeddingProvider, type_key.lower(), settings)


def get_geocoding_provider(settings: AppSettings):
    return get_provider(GeocodingProvider, settings.GEOCODING_PROVIDER_TYPE.lower(), settings)


def get_ocr_provider(settings: AppSettings):
    provider_type = getattr(settings, "OCR_PROVIDER_TYPE", "tesseract").lower()
    return get_provider(OcrProvider, provider_type, settings)
