"""
scraping/provider.py — the Domain itself.
=========================================

  base.py     ScrapingProvider  ─┐
  models.py   ScrapingQuirks    ─┴──►  Scraping = Domain(…)
                                            │
  dialects/__init__.py  ──►  Scraping.dialect("article_parser")
  providers.py           ──►  Scraping(dialect=…, quirks=…) per endpoint
"""

from __future__ import annotations

from app.api.modules.foundation_service_providers.primitives import Domain
from app.api.modules.foundation_service_providers.scraping.base import ScrapingProvider
from app.api.modules.foundation_service_providers.scraping.models import ScrapingQuirks


Scraping = Domain(
    name="scraping",
    protocol=ScrapingProvider,
    package="app.api.modules.foundation_service_providers.scraping",
    system_default="SCRAPING_PROVIDER_TYPE",
    quirks_type=ScrapingQuirks,
)
