"""
web_search/base.py — the contract.
==================================

  query  ──►  search(limit=20, **options)  ──►  SearchResults[ SearchHit … ]

  answer_engine  tavily    a ranked list, PLUS a synthesized answer + images
  metasearch     searxng   a ranked list, nothing else

`limit` is a hard cap honoured by every dialect. It used to arrive as
`max_results=`, land in **kwargs, and match no dialect's option — so it
was silently dropped and each engine fell back to its own default.
"""

from __future__ import annotations
from typing import Any, Dict, Iterator, List, Optional, Protocol, runtime_checkable


@runtime_checkable
class WebSearchProvider(Protocol):
    """Search the web."""

    async def search(self, query: str, *, limit: int = 20, **options: Any) -> SearchResults:
        """Run a search.

        ``limit`` is the result cap and is honoured by every dialect. It used to
        be passed as ``max_results=`` by ``modules/search/web.py``, which landed
        in ``**kwargs`` and matched neither provider's option whitelist — so it
        was silently dropped and each engine used its own default (10 vs 20).
        """
        ...
