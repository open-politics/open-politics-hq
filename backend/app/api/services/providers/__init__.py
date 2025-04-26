"""
Provider interfaces and implementations.

This package contains the interface definitions and concrete implementations
for various external services used by the application. This abstraction layer
allows the application to swap different implementations (like switching from
OPOL to another search engine) without changing the core business logic.
"""

# Imports base interfaces
from typing import Any, Dict # Added Any, Dict for dummy providers

# Base interfaces
from .base import (
    StorageProvider,
    ScrapingProvider,
    SearchProvider,
    ClassificationProvider,
    GeospatialProvider
)

# Removed provider factory imports

__all__ = [
    "StorageProvider",
    "ScrapingProvider",
    "SearchProvider",
    "ClassificationProvider",
    "GeospatialProvider",
    # Removed provider factory function names from __all__
]