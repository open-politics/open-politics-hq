"""
web_search/models.py — this domain's data models.

  SearchHit        title · url · content · score · published_date · favicon
  SearchResults    hits, plus engine extras: answer · images · provider
  WebSearchQuirks  endpoint deviations within a dialect
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional


@dataclass(frozen=True)
class SearchHit:
    """One result from a web search."""
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
        """The fullest text this hit carries."""
        return self.raw_content or self.content


@dataclass(frozen=True)
class SearchResults:
    """Hits plus whatever engine-level extras came back. Iterates as a list of hits."""
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
    #: Full text beside the snippet. (answer_engine/tavily)
    raw_content: bool = True
    #: Ask for a synthesized answer. (answer_engine/tavily)
    answer: bool = True
    #: Ask for images and their descriptions. (answer_engine/tavily)
    images: bool = True
    #: Engine's default topic/vertical. (answer_engine/tavily)
    topic: str = "general"
    #: "basic" | "advanced" — advanced costs more tavily credits.
    depth: str = "basic"
