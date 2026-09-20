"""
storage/provider.py — the Domain itself.
========================================

  base.py     StorageProvider  ─┐
  models.py   StorageQuirks    ─┴──►  Storage = Domain(…)
                                           │
  dialects/__init__.py  ──►  Storage.dialect("s3") · ("filesystem")
  providers.py           ──►  Storage(dialect=…, quirks=…) per endpoint
"""

from __future__ import annotations

from app.api.modules.foundation_service_providers.primitives import Domain
from app.api.modules.foundation_service_providers.storage.base import StorageProvider
from app.api.modules.foundation_service_providers.storage.models import StorageQuirks


Storage = Domain(
    name="storage",
    protocol=StorageProvider,
    package="app.api.modules.foundation_service_providers.storage",
    system_default="STORAGE_PROVIDER_TYPE",
    quirks_type=StorageQuirks,
)
