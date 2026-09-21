"""
storage — bytes in, bytes out, wherever they live.

  base.py      the contract         StorageProvider
  models.py    the data             StorageQuirks
  provider.py  the Domain           Storage
  dialects/    the wires            s3 · filesystem
"""

from app.api.modules.foundation_service_providers.storage.base import StorageProvider
from app.api.modules.foundation_service_providers.storage.models import (
    StorageQuirks,
)
from app.api.modules.foundation_service_providers.storage.provider import Storage

# Must follow the Domain it registers the dialects onto.
from app.api.modules.foundation_service_providers.storage import dialects  # noqa: F401


__all__ = [
    "Storage",
    "StorageProvider",
    "StorageQuirks",
]
