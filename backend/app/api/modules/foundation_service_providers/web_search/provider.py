"""
web_search/provider.py — the Domain itself.
===========================================

  base.py     WebSearchProvider  ─┐
  models.py   WebSearchQuirks    ─┴──►  WebSearch = Domain(…)
                                             │
  dialects/__init__.py ──► WebSearch.dialect("answer_engine")·("metasearch")
  providers.py         ──►  WebSearch(dialect=…, quirks=…) per endpoint
"""

from __future__ import annotations

from app.api.modules.foundation_service_providers.primitives import Domain
from app.api.modules.foundation_service_providers.web_search.base import WebSearchProvider
from app.api.modules.foundation_service_providers.web_search.models import WebSearchQuirks


WebSearch = Domain(
    name="web_search",
    protocol=WebSearchProvider,
    package="app.api.modules.foundation_service_providers.web_search",
    system_default="WEB_SEARCH_PROVIDER_TYPE",
    quirks_type=WebSearchQuirks,
)
