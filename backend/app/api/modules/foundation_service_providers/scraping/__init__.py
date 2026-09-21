"""
scraping — a URL in, structured article content out.

  base.py      the contract         ScrapingProvider
  models.py    the data             ScrapingQuirks
  provider.py  the Domain           Scraping
  dialects/    the wires            article_parser
"""

from app.api.modules.foundation_service_providers.scraping.base import ScrapingProvider
from app.api.modules.foundation_service_providers.scraping.models import (
    ScrapingQuirks,
)
from app.api.modules.foundation_service_providers.scraping.provider import Scraping

# Must follow the Domain it registers the dialects onto.
from app.api.modules.foundation_service_providers.scraping import dialects  # noqa: F401


__all__ = [
    "Scraping",
    "ScrapingProvider",
    "ScrapingQuirks",
]
