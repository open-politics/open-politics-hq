"""
Provider interfaces for various external services.

This module defines the abstract base classes that all providers must implement.
Each provider represents an interface to an external service or library,
allowing the application to switch between different implementations without
changing the core business logic.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union, BinaryIO, Protocol, runtime_checkable, Type
from fastapi import UploadFile
from datetime import datetime
from app.models import DataSourceType
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
    async def scrape_url(self, url: str) -> Dict[str, Any]:
        """Scrapes content from a URL.
        Returns:
            A dictionary containing scraped data (e.g., text_content, title, publication_date).
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


class ClassificationProvider(ABC):
    """
    Abstract Base Class for classification providers.
    """

    @abstractmethod
    def classify(self,
                 text: str,
                 model_class: Type[BaseModel],
                 instructions: Optional[str] = None,
                 api_key: Optional[str] = None,
                 provider_config: Optional[Dict[str, Any]] = None
                ) -> Dict[str, Any]:
        """
        Classify the given text according to the model_class structure and instructions.

        Args:
            text: The text content to classify.
            model_class: The Pydantic model defining the desired output structure.
            instructions: Optional instructions for the LLM (e.g., system prompt, task description).
            api_key: Optional API key for the provider.
            provider_config: Optional dictionary for provider-specific settings (e.g., thinking_budget).

        Returns:
            A dictionary representing the structured classification result.

        Raises:
            ValueError: If essential arguments are missing (e.g., API key when required).
            RuntimeError: If the classification process fails.
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