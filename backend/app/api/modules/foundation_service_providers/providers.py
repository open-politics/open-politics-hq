"""
providers.py — every provider declaration. Nothing here is code.

  @provider
  class Anthropic:
    key      = "anthropic"          ┐
    api_key  = Setting(…)           ├──► Endpoint    who we talk to
    base_url = Setting(…)           │
    contexts = {"cloud"}            ┘

    language = Language(            ┐
      dialect  = …dialects.blocks   │
      features = [prompt_caching]   ├──► Binding  (Domain.__call__ checks
      quirks   = BlocksQuirks(…)    │              the shape, at import)
      models   = [LLMModelSpec(…)]  ┘
    )

              Endpoint + Binding ──► _registry[(capability, provider_key)]

  the attribute name (``language =``) must equal the bound domain's
  name, or the AssertionError names the fix.

  A Setting names an AppSettings field and nothing more. That field's own
  declaration carries the default, here and everywhere.

  NOT IN THIS FILE
    primitives.py  the vocabulary, Domain.__call__, @provider, _registry.
    resolve.py     declaration ──► live object.
    <domain>/      the contract: base.py, models.py, dialects/, features/.
"""

from app.api.modules.foundation_service_providers.primitives import Setting, provider

from app.api.modules.foundation_service_providers.embedding import (
    Embedding, EmbeddingModelSpec, EmbeddingQuirks,
)
from app.api.modules.foundation_service_providers.geocoding import Geocoding, GeocodingQuirks
from app.api.modules.foundation_service_providers.language import (
    Language, BlocksQuirks, TurnsQuirks, ItemsQuirks, LLMModelSpec,
)
from app.api.modules.foundation_service_providers.logic import (
    Logic, QuestionsQuirks, RawQuirks,
)
from app.api.modules.foundation_service_providers.ocr import Ocr, OcrQuirks
from app.api.modules.foundation_service_providers.scraping import Scraping, ScrapingQuirks
from app.api.modules.foundation_service_providers.storage import Storage
from app.api.modules.foundation_service_providers.web_search import WebSearch, WebSearchQuirks


# Language


@provider
class Anthropic:
    key = "anthropic"
    name = "Anthropic"
    description = "Claude language models from Anthropic."
    api_key = Setting("ANTHROPIC_API_KEY", label="Anthropic API Key",
                      url="https://console.anthropic.com/settings/keys")
    base_url = Setting("ANTHROPIC_BASE_URL")
    contexts = {"cloud"}

    language = Language(
        dialect=Language.dialects.blocks,
        features=[Language.features.prompt_caching],
        models=[
            LLMModelSpec("claude-sonnet-4-6", "Latest Sonnet — enhanced reasoning",
                         supports_tools=True, supports_thinking=True,
                         supports_multimodal=True, supports_structured_output=True,
                         supports_prompt_caching=True,
                         max_tokens=64_000, context_length=200_000),
            LLMModelSpec("claude-opus-4-7", "Most capable Opus",
                         supports_tools=True, supports_thinking=True,
                         supports_multimodal=True, supports_structured_output=True,
                         supports_prompt_caching=True,
                         max_tokens=32_000, context_length=200_000),
            LLMModelSpec("claude-opus-4-6", "Most capable model for complex tasks",
                         supports_tools=True, supports_thinking=True,
                         supports_multimodal=True, supports_structured_output=True,
                         supports_prompt_caching=True,
                         max_tokens=32_000, context_length=200_000),
            LLMModelSpec("claude-haiku-4-5", "Fast and affordable",
                         supports_tools=True, supports_multimodal=True,
                         supports_structured_output=True, supports_prompt_caching=True,
                         max_tokens=64_000, context_length=200_000),
        ],
    )


@provider
class LlamaCpp:
    key = "llamacpp"
    name = "llama.cpp"
    description = "Local GGUF inference via llama-server."
    base_url = Setting("LLAMACPP_BASE_URL")
    contexts = {"local", "self_hosted"}

    language = Language(
        dialect=Language.dialects.blocks,       # Anthropic's packaging…
        features=[Language.features.models_v1,  # …OpenAI's model listing
                  Language.features.props],     # …and its own /props
        quirks=BlocksQuirks(
            auth_header="bearer",               # llama-server's --api-key reads Bearer
            placeholder_api_key="no-key",       # keyless, but a client wants a string
            # A GGUF reasons because its chat template does, not because we asked.
            no_thinking_template_kwarg="enable_thinking",
        ),
    )

    # The same server answers decisions by reading the next token instead of
    # generating one — no server flag, no second process. Untrained at the task,
    # so nothing defaults here: `foundation.use.logic` has to name it.
    logic = Logic(
        dialect=Logic.dialects.raw,
        model_required=False,           # llama-server serves the one GGUF it loaded
        quirks=RawQuirks(),
    )


@provider
class OpenAI:
    key = "openai"
    name = "OpenAI"
    description = "GPT models and text embeddings from OpenAI."
    api_key = Setting("OPENAI_API_KEY", label="OpenAI API Key",
                      url="https://platform.openai.com/api-keys")
    base_url = Setting("OPENAI_BASE_URL")
    contexts = {"cloud"}

    language = Language(
        dialect=Language.dialects.items,
        features=[Language.features.mcp],
        quirks=ItemsQuirks(
            max_tokens_field="max_output_tokens",
            developer_role=True,
            store=False,
            strict_tools=True,
        ),
        # No connector for the tool's label ⇒ the `mcp` feature declines and
        # our own executor runs the tool instead.
        extra=lambda s, models: {"mcp_connectors": s.MCP_CONNECTOR_URLS},
        models=[
            LLMModelSpec("gpt-5.2", "Best for coding and agentic tasks",
                         supports_tools=True, supports_multimodal=True,
                         supports_structured_output=True),
            LLMModelSpec("gpt-5-mini", "Faster, cost-efficient for well-defined tasks",
                         supports_tools=True, supports_multimodal=True,
                         supports_structured_output=True),
            LLMModelSpec("gpt-5-nano", "Fastest, most cost-efficient",
                         supports_tools=True, supports_multimodal=True,
                         supports_structured_output=True),
            LLMModelSpec("gpt-4.1", "Smartest non-reasoning model",
                         supports_tools=True, supports_multimodal=True,
                         supports_structured_output=True),
            LLMModelSpec("o3", "Reasoning model for complex tasks",
                         supports_tools=True, supports_thinking=True,
                         supports_multimodal=True, supports_structured_output=True),
            LLMModelSpec("o4-mini", "Fast, cost-efficient reasoning",
                         supports_tools=True, supports_thinking=True,
                         supports_multimodal=True, supports_structured_output=True),
        ],
    )

    embedding = Embedding(
        dialect=Embedding.dialects.indexed,
        features=[Embedding.features.verify],
        models=[
            EmbeddingModelSpec("text-embedding-3-small", dimension=1536,
                               max_sequence_length=8191),
            EmbeddingModelSpec("text-embedding-3-large", dimension=3072,
                               max_sequence_length=8191),
        ],
    )


@provider
class Mistral:
    key = "mistral"
    name = "Mistral AI"
    description = "Mistral and Codestral language models. EU-hosted."
    api_key = Setting("MISTRAL_API_KEY", label="Mistral API Key",
                      url="https://console.mistral.ai/api-keys/")
    base_url = Setting("MISTRAL_BASE_URL")
    contexts = {"cloud"}

    language = Language(
        dialect=Language.dialects.turns,
        models=[
            LLMModelSpec("mistral-large-latest", "Most capable Mistral model",
                         supports_tools=True, supports_structured_output=True),
            LLMModelSpec("mistral-small-latest", "Efficient and fast",
                         supports_tools=True, supports_structured_output=True),
            LLMModelSpec("codestral-latest", "Code-specialised",
                         supports_tools=True, supports_structured_output=True),
        ],
    )


@provider
class Ollama:
    key = "ollama"
    name = "Ollama"
    description = "Run open-source models locally via Ollama. Language, embedding and OCR."
    base_url = Setting("OLLAMA_BASE_URL")
    contexts = {"local", "self_hosted"}

    language = Language(
        dialect=Language.dialects.turns,        # same packaging as Mistral…
        path="/api/chat",                       # …at a different address
        features=[Language.features.models_ollama, Language.features.model_pull],
        quirks=TurnsQuirks(
            tool_args_encoding="object",        # Mistral sends a JSON string
            tool_result_needs_call_id=False,    # no such field on this endpoint
            image_placement="message_array",    # message-level `images: [b64]`
            schema_field="format",              # not `response_format`
            params_envelope="options",          # sampling params nest, max_tokens renames
            stream_frame="ndjson",              # not SSE deltas
            thinking_tags=True,
            native_tool_parsing=False,
            retry_without_tools_on_400=True,
        ),
    )

    embedding = Embedding(
        dialect=Embedding.dialects.flat,
        features=[Embedding.features.probe_model, Embedding.features.list_models],
        quirks=EmbeddingQuirks(server_truncate=True, char_budget_ratio=3.2),
    )

    ocr = Ocr(
        dialect=Ocr.dialects.vision_prompt,
        model_required=False,
        extra=lambda s, models: {"model": s.OLLAMA_OCR_MODEL},
    )


# Embedding


@provider
class Jina:
    key = "jina"
    name = "Jina AI"
    description = "High-quality multilingual text embeddings."
    api_key = Setting("JINA_API_KEY", label="Jina API Key",
                      url="https://jina.ai/embeddings/#apiform")
    base_url = Setting("JINA_BASE_URL")
    contexts = {"cloud"}

    embedding = Embedding(
        dialect=Embedding.dialects.indexed,
        features=[Embedding.features.verify],
        # Configured URL is already the full path; the dialect must not append.
        quirks=EmbeddingQuirks(base_url_is_full_path=True),
        models=[
            EmbeddingModelSpec("jina-embeddings-v5-text-small", dimension=1024,
                               max_sequence_length=32768),
            EmbeddingModelSpec("jina-embeddings-v5-text-nano", dimension=768,
                               max_sequence_length=8192),
            EmbeddingModelSpec("jina-embeddings-v4", dimension=1024,
                               max_sequence_length=32768),
        ],
    )


@provider
class Voyage:
    key = "voyage"
    name = "Voyage AI"
    description = "Specialised embeddings for code, law and finance."
    api_key = Setting("VOYAGE_API_KEY", label="Voyage API Key",
                      url="https://dash.voyageai.com/")
    base_url = Setting("VOYAGE_BASE_URL")
    contexts = {"cloud"}

    embedding = Embedding(
        dialect=Embedding.dialects.indexed,
        features=[Embedding.features.verify],
        # Requires the document/query distinction; rejects `encoding_format`.
        quirks=EmbeddingQuirks(input_type="document", encoding_format=False),
        models=[
            EmbeddingModelSpec("voyage-4-large", dimension=1024, max_sequence_length=32000),
            EmbeddingModelSpec("voyage-4", dimension=1024, max_sequence_length=32000),
            EmbeddingModelSpec("voyage-4-lite", dimension=1024, max_sequence_length=32000),
            EmbeddingModelSpec("voyage-4-nano", dimension=1024, max_sequence_length=32000),
            EmbeddingModelSpec("voyage-code-3", dimension=1024, max_sequence_length=32000),
            EmbeddingModelSpec("voyage-finance-2", dimension=1024, max_sequence_length=32000),
            EmbeddingModelSpec("voyage-law-2", dimension=1024, max_sequence_length=32000),
            EmbeddingModelSpec("voyage-code-2", dimension=1536, max_sequence_length=16000),
        ],
    )


# OCR


@provider
class Tesseract:
    key = "tesseract"
    name = "Tesseract OCR"
    description = "Open-source OCR engine running locally."
    contexts = {"local"}

    ocr = Ocr(
        dialect=Ocr.dialects.local_engine,
        model_required=False,
        # Engine language; a caller still overrides per document via `language_hint`.
        quirks=OcrQuirks(default_language=Setting("OCR_DEFAULT_LANGUAGE")),
    )


# Geocoding


@provider
class NominatimLocal:
    key = "nominatim_local"
    name = "Local Nominatim"
    description = "Self-hosted Nominatim geocoding instance."
    base_url = Setting("NOMINATIM_BASE_URL")
    contexts = {"local", "self_hosted"}

    geocoding = Geocoding(
        dialect=Geocoding.dialects.osm,
        model_required=False,
        # Self-hosted: no rate limit, no User-Agent policy.
        quirks=GeocodingQuirks(polygons=True),
    )


@provider
class NominatimAPI:
    key = "nominatim_api"
    name = "Nominatim Public API"
    description = "OpenStreetMap's free public geocoding API (rate-limited)."
    base_url = Setting("NOMINATIM_API_URL")
    contexts = {"cloud"}

    geocoding = Geocoding(
        dialect=Geocoding.dialects.osm,     # same packaging as the self-hosted one
        model_required=False,
        quirks=GeocodingQuirks(
            polygons=True,
            rate_limit_seconds=1.0,         # the public usage policy
            # nominatim's public API rejects a request that sends none
            user_agent=Setting("GEOCODING_USER_AGENT"),
        ),
    )


@provider
class Mapbox:
    key = "mapbox"
    name = "Mapbox Geocoding"
    description = "Commercial geocoding API from Mapbox."
    api_key = Setting("MAPBOX_ACCESS_TOKEN", label="Mapbox Access Token",
                      url="https://account.mapbox.com/access-tokens/")
    base_url = Setting("MAPBOX_BASE_URL")
    contexts = {"cloud"}

    geocoding = Geocoding(
        dialect=Geocoding.dialects.geojson,
        model_required=False,
        # Point geometry only — boundaries need a separate paid API.
        quirks=GeocodingQuirks(polygons=False),
    )


# Storage


@provider
class S3:
    key = "s3"
    name = "Object storage (S3)"
    description = "Any S3-compatible bucket — Garage, AWS, Hetzner, R2, B2, Wasabi."
    # The same protocol whether the bucket is a container on this machine or
    # somebody else's region. Which one it is lives in HQ.yml, not here.
    contexts = {"self_hosted", "cloud"}

    storage = Storage(
        dialect=Storage.dialects.s3,
        model_required=False,
        # Six values, none named like the standard api_key/base_url pair.
        # Garage rejects a request that sends no region.
        extra=lambda s, models: {
            "endpoint_url": s.S3_ENDPOINT,
            "access_key": s.S3_ACCESS_KEY_ID,
            "secret_key": s.S3_SECRET_ACCESS_KEY,
            "bucket_name": s.S3_BUCKET_NAME,
            "region": s.S3_REGION,
            "use_ssl": s.S3_USE_SSL,
        },
    )


@provider
class LocalFS:
    key = "local_fs"
    name = "Local Filesystem"
    description = "Store files directly on the local filesystem."
    contexts = {"local"}

    storage = Storage(
        dialect=Storage.dialects.filesystem,
        model_required=False,
        extra=lambda s, models: {"base_path": s.LOCAL_STORAGE_BASE_PATH},
    )


# Scraping


@provider
class Newspaper4k:
    key = "newspaper4k"
    name = "Newspaper4k"
    description = "Local article scraping and extraction."
    contexts = {"local"}

    scraping = Scraping(
        dialect=Scraping.dialects.article_parser,
        model_required=False,
        quirks=ScrapingQuirks(
            timeout=30,
            threads=4,
            fetch_images=True,
            enable_nlp=False,
            language="en",
        ),
    )


# Web search


@provider
class Tavily:
    key = "tavily"
    name = "Tavily"
    description = "AI-optimised web search with synthesized answers."
    api_key = Setting("TAVILY_API_KEY", label="Tavily API Key",
                      url="https://tavily.com/#api")
    base_url = Setting("TAVILY_BASE_URL")
    contexts = {"cloud"}

    web_search = WebSearch(
        dialect=WebSearch.dialects.answer_engine,
        model_required=False,
        quirks=WebSearchQuirks(raw_content=True, answer=True, images=True),
    )


@provider
class SearXNG:
    key = "searxng"
    name = "SearXNG"
    description = "Self-hosted metasearch. No API key, no outbound budget."
    base_url = Setting("SEARXNG_BASE_URL")
    contexts = {"local", "self_hosted"}

    web_search = WebSearch(
        dialect=WebSearch.dialects.metasearch,
        model_required=False,
    )


# Logic


@provider
class Kev:
    key = "kev"
    name = "Kev"
    description = "Small calibrated decision models, in a container on this machine."
    base_url = Setting("KEV_BASE_URL")
    contexts = {"local", "self_hosted"}

    # No models declared, and none to pick: the container loads one checkpoint at
    # startup, named by `foundation.providers.kev.run` in HQ.yml. The feature
    # reports which one that is; a picker here would offer a choice the server
    # ignores. Switching means editing HQ.yml and recreating the container.
    logic = Logic(
        dialect=Logic.dialects.questions,
        model_required=False,
        features=[Logic.features.loaded_model],
        # Every Kev checkpoint was trained on states up to 384 tokens. Longer
        # ones are answered, not refused — the engine just says so in the log.
        quirks=QuestionsQuirks(trained_state_tokens=384),
    )


@provider
class TypeSafe:
    key = "typesafe"
    name = "TypeSafe Jev"
    description = "Hosted decision models. Same wire as Kev, someone else's hardware."
    api_key = Setting("TYPESAFE_API_KEY", label="TypeSafe API Key",
                      url="https://docs.typesafe.ai/api")
    base_url = Setting("TYPESAFE_BASE_URL")
    contexts = {"cloud"}

    logic = Logic(
        dialect=Logic.dialects.questions,   # same packaging as the local one…
        model_required=False,
        features=[Logic.features.loaded_model],
        # …behind a credential. No trained-state claim: what Jev was trained on
        # is not published, and a guess would produce a warning nobody can act on.
        quirks=QuestionsQuirks(auth_header="bearer"),
    )
