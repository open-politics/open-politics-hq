"""
Provider interfaces for various external services.

This module defines the abstract base classes that all providers must implement.
Each provider represents an interface to an external service or library,
allowing the application to switch between different implementations without
changing the core business logic.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union, BinaryIO, Protocol, runtime_checkable, Type, Callable, Awaitable
from fastapi import UploadFile
from datetime import datetime
from pydantic import BaseModel


@runtime_checkable
class StorageProvider(Protocol):
    """
    Abstract interface for storage providers (S3, MinIO, etc).
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
            A file-like object (e.g., stream) or raises error if not found.
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

    async def list_files(self, prefix: Optional[str] = None) -> List[str]:
        """Lists files in storage, optionally filtered by prefix.
        Args:
            prefix: Optional prefix to filter files.
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
class SearchProvider(Protocol):
    """
    Abstract interface for search providers.
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


# DEPRECATED: ClassificationProvider replaced by LanguageModelProvider
# Kept temporarily for backward compatibility during migration
class ClassificationProvider(ABC):
    """
    DEPRECATED: Use LanguageModelProvider instead.
    This interface is kept for backward compatibility only.
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
class GeospatialProvider(Protocol):
    """
    Abstract interface for geospatial data providers.
    """
    async def get_geojson(self, start_date: Optional[str] = None, 
                         end_date: Optional[str] = None, 
                         limit: int = 100) -> Dict[str, Any]:
        """
        Get GeoJSON data within a specified time range.
        
        Args:
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering
            limit: Maximum number of locations to return
            
        Returns:
            GeoJSON formatted data
        """
        pass
    
    async def get_geojson_by_event(self, event_type: str, 
                                  start_date: Optional[str] = None,
                                  end_date: Optional[str] = None, 
                                  limit: int = 100) -> Dict[str, Any]:
        """
        Get GeoJSON data for a specific event type.
        
        Args:
            event_type: The type of event
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering
            limit: Maximum number of locations to return
            
        Returns:
            GeoJSON formatted data
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