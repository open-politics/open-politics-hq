"""
web_search/base.py — the contract.

  query  ──►  search(limit=20, **options)  ──►  SearchResults[ SearchHit … ]

  answer_engine  tavily    a ranked list, PLUS a synthesized answer + images
  metasearch     searxng   a ranked list, nothing else
"""

from __future__ import annotations
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class WebSearchProvider(Protocol):
    """Search the web."""

    async def search(self, query: str, *, limit: int = 20, **options: Any) -> SearchResults:
        """Run a search. ``limit`` is a hard cap honoured by every dialect."""
        ...
