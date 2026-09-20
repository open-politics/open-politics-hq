"""
web_search/models.py — this domain's data models.
=================================================

  SearchHit        title · url · content · score · published_date · favicon
  SearchResults    hits, plus engine extras: answer · images · provider
  WebSearchQuirks  endpoint deviations within a dialect

SearchHit is typed, not a dict: callers used to getattr() plain dicts
and silently got None back for every field.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Protocol, runtime_checkable


@dataclass(frozen=True)
class SearchHit:
    """One result. Typed, because the prose contract was already costing us.

    ``content/sources/web_search.py`` read ``getattr(r, "url")`` against plain
    dicts — always ``None``, so it skipped every result and web-search ingestion
    silently produced nothing. A dict that promises "e.g. title, url" cannot be
    read wrong by a type checker; this can.
    """
    title: str
    url: str
    content: str = ""
    raw_content: Optional[str] = None      # full article text where the engine has it
    score: Optional[float] = None
    published_date: Optional[str] = None
    favicon: Optional[str] = None
    provider: str = ""
    raw: Dict[str, Any] = field(default_factory=dict)

    @property
    def best_text(self) -> str:
        """Fullest text this hit carries. The ingest path's actual question."""
        return self.raw_content or self.content


@dataclass(frozen=True)
class SearchResults:
    """Hits plus whatever global extras the engine returned.

    Iterates and indexes as the plain list it replaces, so ``for hit in
    results`` and ``len(results)`` read unchanged — but the extras are named
    fields instead of being smuggled into ``results[0]["raw"]``. That
    side-channel is why ``mcp_server/server.py`` read Tavily-only keys
    (``summary_answer``, ``tavily_images``) off *any* provider's first result.
    """
    hits: List[SearchHit]
    answer: Optional[str] = None           # synthesized answer, answer_engine only
    images: List[Any] = field(default_factory=list)
    provider: str = ""

    def __iter__(self) -> Iterator[SearchHit]:
        return iter(self.hits)

    def __len__(self) -> int:
        return len(self.hits)

    def __getitem__(self, i):
        return self.hits[i]

    def __bool__(self) -> bool:
        return bool(self.hits)


@dataclass(frozen=True)
class WebSearchQuirks:
    """Endpoint deviations within a web-search dialect."""
    #: Full text beside the snippet. (answer_engine/tavily — ingest prefers it.)
    raw_content: bool = True
    #: Ask for a synthesized answer. (answer_engine/tavily.)
    answer: bool = True
    #: Ask for images and their descriptions. (answer_engine/tavily.)
    images: bool = True
    #: Engine's default topic/vertical. (answer_engine/tavily.)
    topic: str = "general"
    #: "basic" | "advanced". (answer_engine/tavily — advanced costs more credits.)
    depth: str = "basic"
