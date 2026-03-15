"""
Provider interfaces for various external services.

This module defines the abstract base classes that all providers must implement.
Each provider represents an interface to an external service or library,
allowing the application to switch between different implementations without
changing the core business logic.
"""
from abc import abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, BinaryIO, Protocol, runtime_checkable, Type, Callable, Awaitable
from fastapi import UploadFile
from datetime import datetime
from pydantic import BaseModel


# ─────────────────────────────────────────── Model Specs ──── #

@dataclass
class ModelSpec:
    """Base model specification for any provider type."""
    name: str
    description: str = ""


@dataclass
class LLMModelSpec(ModelSpec):
    """Model spec for language model providers."""
    supports_tools: bool = False
    supports_streaming: bool = True
    supports_thinking: bool = False
    supports_multimodal: bool = False
    supports_structured_output: bool = False
    max_tokens: Optional[int] = None
    context_length: Optional[int] = None


@dataclass
class EmbeddingModelSpec(ModelSpec):
    """Model spec for embedding providers."""
    dimension: int = 0
    max_sequence_length: int = 0


# ────────────────────────────────── Provider Selection ──── #


class ProviderSelection(BaseModel):
    """A typed provider+model choice."""
    provider_key: str
    model_name: Optional[str] = None
    dimension: Optional[int] = None  # override for variable-dim models (Matryoshka etc.)

    # Accept type_key as alias for backwards compat with existing JSON
    class Config:
        populate_by_name = True

    @classmethod
    def __get_validators__(cls):
        yield cls._compat_validator

    @classmethod
    def _compat_validator(cls, v):
        if isinstance(v, dict) and "type_key" in v and "provider_key" not in v:
            v = {**v, "provider_key": v.pop("type_key")}
        return v

    def __init__(self, **data):
        # Accept type_key in constructor for backwards compat
        if "type_key" in data and "provider_key" not in data:
            data["provider_key"] = data.pop("type_key")
        elif "type_key" in data:
            data.pop("type_key")
        super().__init__(**data)

    @property
    def type_key(self) -> str:
        """Backwards compat accessor."""
        return self.provider_key


class LanguageDefaults(BaseModel):
    """Language capability defaults with context-specific overrides.

    ``default`` is the base language provider. ``chat`` and ``annotation``
    override it for those specific contexts.  ``resolve()`` checks the
    context override first and falls back to ``default``.
    """
    default: Optional[ProviderSelection] = None
    chat: Optional[ProviderSelection] = None
    annotation: Optional[ProviderSelection] = None

    def resolve(self, context: Optional[str] = None) -> Optional[ProviderSelection]:
        if context:
            override = getattr(self, context, None)
            if override:
                return override
        return self.default


class ProviderDefaults(BaseModel):
    """User's per-capability provider preferences.

    Core capabilities are named fields — enforced by the model schema.
    Language uses ``LanguageDefaults`` for context-specific overrides;
    all other capabilities are plain ``ProviderSelection``.
    """
    language: Optional[LanguageDefaults] = None
    embedding: Optional[ProviderSelection] = None
    web_search: Optional[ProviderSelection] = None
    ocr: Optional[ProviderSelection] = None
    geocoding: Optional[ProviderSelection] = None

    def __init__(self, **data):
        # Accept "search" as alias for backwards compat
        if "search" in data and "web_search" not in data:
            data["web_search"] = data.pop("search")
        elif "search" in data:
            data.pop("search")
        super().__init__(**data)

    def get(
        self, capability: str, context: Optional[str] = None
    ) -> Optional[ProviderSelection]:
        """Get provider selection for a capability, with optional context override."""
        cap = getattr(self, capability, None)
        if cap is None:
            return None
        if isinstance(cap, LanguageDefaults):
            return cap.resolve(context)
        return cap


# ─────────────────────────────────────── Enrichment Config ──── #


class EnrichmentConfig(BaseModel):
    """Per-infospace enrichment configuration. All enrichers require explicit opt-in.

    Each field is either:
    - True (enable with system defaults)
    - ProviderSelection (enable with specific provider + optional model)
    - None/missing (disabled)

    Embedding is always ``ProviderSelection`` (never plain bool) because you
    can't embed without choosing a provider and model.
    """
    ocr: Optional[bool | ProviderSelection] = None
    geocoding: Optional[bool | ProviderSelection] = None
    language_detection: Optional[bool] = None
    quality_score: Optional[bool] = None
    hash: Optional[bool] = None
    embedding: Optional[ProviderSelection] = None
    embedding_dimension_override: Optional[int] = None

    def is_enabled(self, enricher_name: str) -> bool:
        """Check if a specific enricher is enabled."""
        val = getattr(self, enricher_name, None)
        if val is None:
            return False
        if isinstance(val, bool):
            return val
        if isinstance(val, (ProviderSelection, dict)):
            return True
        return False

    def get_selection(self, enricher_name: str) -> Optional[ProviderSelection]:
        """Get provider selection for an enricher, if configured."""
        val = getattr(self, enricher_name, None)
        if isinstance(val, dict):
            return ProviderSelection(**val)
        if isinstance(val, ProviderSelection):
            return val
        return None


# ─────────────────────────────────────────── File Stat ──── #

@dataclass
class FileStat:
    """File metadata for change detection and hashing."""
    size: int
    mtime: float
    etag: Optional[str] = None


@runtime_checkable
class StorageProvider(Protocol):
    """
    Abstract interface for storage providers (S3, MinIO, local_fs, etc).
    """
    async def upload_file(self, file: UploadFile, object_name: str) -> None:
        """Uploads a file to the storage
        Args:
            file: The file-like object to upload.
            object_name: The desired name/path for the object in storage.
        """
        pass
    
    async def get_file(self, object_name: str) -> Any:
        """Retrieves a file object from storage.
        Args:
            object_name: The name/path of the object in storage.
        Returns:
            A file-like object (e.g., open file handle or stream).
            Caller is responsible for closing the handle. Use as context manager
            when possible: async with provider.get_file(path) as f: ...
        """
        pass

    def file_exists(self, object_name: str) -> bool:
        """Check if an object exists in storage.
        Args:
            object_name: The name/path of the object.
        Returns:
            True if the object exists, False otherwise.
        """
        pass

    def file_stat(self, object_name: str) -> Optional[FileStat]:
        """Get file metadata for change detection.
        Args:
            object_name: The name/path of the object.
        Returns:
            FileStat with size, mtime, optional etag, or None if not found.
        """
        pass

    def get_file_path(self, object_name: str) -> Path:
        """Returns the local filesystem path for direct file access (zero-copy).
        Optional: only implemented by local-filesystem providers. Remote storage
        (MinIO, S3) should raise NotImplementedError.
        """
        pass

    async def download_file(self, source_object_name: str, destination_local_path: str) -> None:
        """Downloads a file from storage to a local path.
        Args:
            source_object_name: The name/path of the object in storage.
            destination_local_path: The local path to save the file.
        """
        pass
    
    async def delete_file(self, object_name: str) -> None:
        """Deletes a file from storage.
        Args:
            object_name: The name/path of the object in storage.
        """
        pass
        
    def delete_file_sync(self, object_name: str) -> None:
        """Synchronous version of delete_file. Needed for cleanup in non-async contexts."""
        pass

    async def list_files(
        self,
        prefix: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[str]:
        """Lists files in storage, optionally filtered by prefix.
        Args:
            prefix: Optional prefix to filter files.
            limit: Optional max number of results (None = no limit).
            offset: Number of results to skip (for pagination).
        Returns:
            A list of object names/paths.
        """
        pass
        
    async def move_file(self, source_object_name: str, destination_object_name: str) -> None:
        """Moves/renames a file within the storage.
        Args:
            source_object_name: The current name/path of the object.
            destination_object_name: The desired new name/path.
        """
        pass

    async def upload_from_bytes(
        self,
        file_bytes: bytes,
        object_name: str,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> None:
        """Uploads file content from bytes to storage.
        Args:
            file_bytes: The raw bytes to upload.
            object_name: The desired name/path for the object in storage.
            filename: Optional filename for content-type guessing.
            content_type: Optional MIME type (guessed from filename if not provided).
        """
        pass


@runtime_checkable
class ScrapingProvider(Protocol):
    """
    Abstract interface for content scraping providers.
    """
    async def scrape_url(self, url: str, timeout: int = 30, retry_attempts: int = 1) -> Dict[str, Any]:
        """Scrapes content from a single URL.
        Args:
            url: The URL to scrape
            timeout: Request timeout in seconds
            retry_attempts: Number of retry attempts on failure
        Returns:
            A dictionary containing scraped data (e.g., text_content, title, publication_date).
        """
        pass
    
    async def scrape_urls_bulk(self, urls: List[str], max_threads: int = 4) -> List[Dict[str, Any]]:
        """Scrape multiple URLs efficiently using threading.
        Args:
            urls: List of URLs to scrape
            max_threads: Maximum number of threads to use
        Returns:
            List of scraped article dictionaries
        """
        pass
    
    async def analyze_source(self, base_url: str) -> Dict[str, Any]:
        """Analyze a news source to discover RSS feeds, categories, and articles.
        Args:
            base_url: Base URL of the news source to analyze
        Returns:
            Dictionary containing source analysis results
        """
        pass
    
    async def discover_rss_feeds(self, base_url: str) -> List[str]:
        """Discover RSS feeds from a news source.
        Args:
            base_url: Base URL of the news source
        Returns:
            List of discovered RSS feed URLs
        """
        pass


@runtime_checkable
class WebSearchProvider(Protocol):
    """
    Abstract interface for web search providers (Tavily, Google, SearXNG, etc).
    External search engines; distinct from SearchService (internal asset search).
    """
    async def search(self, query: str, skip: int = 0, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Search for content based on a query.
        
        Args:
            query: The search query
            skip: Number of results to skip
            limit: Maximum number of results to return
            
        Returns:
            List of search results
        """
        pass
    
    async def search_by_entity(self, entity: str, date: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Search for content related to a specific entity.
        
        Args:
            entity: The entity to search for
            date: Optional date filter
            
        Returns:
            List of search results
        """
        pass


@runtime_checkable
class EmbeddingProvider(Protocol):
    """
    Abstract interface for embedding providers.
    """
    async def embed_texts(self, texts: List[str], model_name: Optional[str] = None) -> List[List[float]]:
        """
        Generate embeddings for a list of texts.
        
        Args:
            texts: List of text strings to embed
            model_name: Optional model name override
            
        Returns:
            List of embedding vectors (one per input text)
        """
        pass
    
    async def embed_single(self, text: str, model_name: Optional[str] = None) -> List[float]:
        """
        Generate embedding for a single text.
        
        Args:
            text: Text string to embed
            model_name: Optional model name override
            
        Returns:
            Single embedding vector
        """
        pass
    
    def get_available_models(self) -> List[Dict[str, Any]]:
        """
        Get list of available embedding models from this provider.
        
        Returns:
            List of model info dictionaries with keys:
            - name: str
            - dimension: int  
            - description: str
            - max_sequence_length: int
        """
        pass
    
    def get_model_dimension(self, model_name: str) -> int:
        """
        Get the embedding dimension for a specific model.
        
        Args:
            model_name: Name of the model
            
        Returns:
            Embedding dimension (e.g., 384, 768, 1024)
        """
        pass


@runtime_checkable
class GeocodingProvider(Protocol):
    """
    Abstract interface for geocoding providers.
    Converts location names/addresses to coordinates and vice versa.
    """
    async def geocode(self, location: str, language: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Geocode a location string to coordinates and metadata.
        
        Args:
            location: Location name or address to geocode
            language: Optional language code for results (e.g., 'en', 'es')
            
        Returns:
            Dictionary with:
            - coordinates: [lon, lat] array (centroid/representative point)
            - location_type: Type classification (country, city, etc.)
            - bbox: Bounding box [min_lat, max_lat, min_lon, max_lon] (legacy, simple approximation)
            - area: Approximate area in square degrees
            - display_name: Full formatted address/name
            - geometry: Optional GeoJSON geometry object for complex shapes
                       (Polygon, MultiPolygon, etc.) - future-ready for precise borders
            Returns None if location cannot be geocoded
        """
        pass
    
    async def reverse_geocode(self, lat: float, lon: float, language: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Reverse geocode coordinates to location information.
        
        Args:
            lat: Latitude
            lon: Longitude
            language: Optional language code for results
            
        Returns:
            Dictionary with location information including:
            - display_name: Full formatted address
            - address: Address components dictionary
            - location_type: Type classification
            - coordinates: [lon, lat] of the queried point
            - geometry: Optional GeoJSON geometry if available
            Returns None if coordinates cannot be reverse geocoded
        """
        pass


# ─────────────────────────────────────────── OCR ──── #

class OcrResult:
    """Result from OCR extraction."""
    def __init__(self, text: str, confidence: float, engine: str, page_count: int = 1):
        self.text = text
        self.confidence = confidence
        self.engine = engine
        self.page_count = page_count


@runtime_checkable
class OcrProvider(Protocol):
    """
    Abstract interface for OCR providers (ocrmypdf, Ollama multimodal, etc).
    Extracts text from image content or image-only PDF pages.
    """
    async def extract_text(
        self,
        file_path_or_bytes: Union[Path, bytes],
        language_hint: Optional[str] = None,
    ) -> OcrResult:
        """
        Extract text from an image or PDF page.
        Args:
            file_path_or_bytes: Local path or raw bytes of the image/PDF page
            language_hint: Optional language code (e.g. 'eng', 'deu') for better accuracy
        Returns:
            OcrResult with text, confidence, engine name, page_count
        """
        pass


# ─────────────────────────────────────────── Language Models ──── #

from dataclasses import dataclass
from typing import AsyncIterator

@dataclass
class ModelInfo:
    """Information about a language model and its capabilities."""
    name: str
    provider: str
    supports_structured_output: bool = False
    supports_tools: bool = False
    supports_streaming: bool = False
    supports_thinking: bool = False
    supports_multimodal: bool = False
    max_tokens: Optional[int] = None
    context_length: Optional[int] = None
    description: Optional[str] = None

@dataclass
class GenerationResponse:
    """Standardized response from language model generation."""
    content: str
    model_used: str
    usage: Optional[Dict[str, int]] = None
    tool_calls: Optional[List[Dict]] = None
    tool_executions: Optional[List[Dict]] = None  # History of tool executions with results
    thinking_trace: Optional[str] = None  # For reasoning models
    finish_reason: Optional[str] = None
    raw_response: Optional[Dict] = None  # Provider-specific full response

@runtime_checkable
class LanguageModelProvider(Protocol):
    """
    Unified interface for language model providers supporting chat, structured output, and tools.
    
    This interface treats all language model interactions as API calls with different JSON payloads:
    - Classification → structured JSON output via response_format
    - Chat → conversational JSON response
    - Tool calls → structured JSON with function calls
    - Streaming → same JSON, just chunked
    """
    
    async def discover_models(self) -> List[ModelInfo]:
        """
        Dynamically discover available models with their capabilities.
        
        Returns:
            List of ModelInfo objects describing available models
        """
        pass
    
    async def generate(self, 
                      messages: List[Dict[str, str]],
                      model_name: str,
                      response_format: Optional[Dict] = None,  # JSON schema for structured output
                      tools: Optional[List[Dict]] = None,      # Function definitions
                      stream: bool = False,
                      thinking_enabled: bool = False,          # Provider-specific thinking mode
                      tool_executor: Optional[Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]]] = None,
                      **kwargs) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        """
        Generate response with provider-specific handling of all features.
        
        Args:
            messages: List of message dicts with 'role' and 'content' keys
            model_name: Name of the model to use
            response_format: JSON schema for structured output (provider-specific format)
            tools: List of tool/function definitions (provider-specific format)
            stream: Whether to stream the response
            thinking_enabled: Whether to enable thinking/reasoning mode
            tool_executor: Async function to execute a tool call.
            **kwargs: Additional provider-specific parameters
            
        Returns:
            GenerationResponse object or async iterator for streaming
        """
        pass
    
    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """
        Get information about a specific model.

        Args:
            model_name: Name of the model

        Returns:
            ModelInfo object if model exists, None otherwise
        """
        pass