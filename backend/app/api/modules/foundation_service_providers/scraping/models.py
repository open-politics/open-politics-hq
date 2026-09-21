"""
scraping/models.py — this domain's data models.

  ScrapingQuirks   one parser's tuning knobs: timeout · threads · language
                   · fetch_images · enable_nlp · user_agent · …
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class ScrapingQuirks:
    """Parser deviations — currently all newspaper4k config knobs."""
    timeout: int = 30
    threads: int = 4
    fetch_images: bool = True
    enable_nlp: bool = False
    language: str = "en"
    user_agent: str = "Mozilla/5.0 (compatible; OpenPoliticsBot/1.0; +https://open-politics.org/)"
    memoize_articles: bool = True
    follow_meta_refresh: bool = False
    http_success_only: bool = True
