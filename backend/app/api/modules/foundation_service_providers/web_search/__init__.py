"""
web_search — a query in, ranked hits out.
=========================================

  base.py      the contract     WebSearchProvider
  models.py    the data         SearchHit · SearchResults · WebSearchQuirks
  provider.py  the Domain       WebSearch
  dialects/    the wires        answer_engine · metasearch
"""

from app.api.modules.foundation_service_providers.web_search.base import WebSearchProvider
from app.api.modules.foundation_service_providers.web_search.models import (
    SearchHit, SearchResults, WebSearchQuirks,
)
from app.api.modules.foundation_service_providers.web_search.provider import WebSearch

# Registers the dialects. Must follow the Domain it registers onto.
from app.api.modules.foundation_service_providers.web_search import dialects  # noqa: F401


__all__ = [
    "WebSearch",
    "WebSearchProvider",
    "SearchHit",
    "SearchResults",
    "WebSearchQuirks",
]
