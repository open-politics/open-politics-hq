"""
scraping/models.py — this domain's data models.
===============================================

  ScrapingQuirks   one parser's tuning knobs: timeout · threads · language
                   · fetch_images · enable_nlp · user_agent · …

Previously an opaque config dict: 10 keys were read but only 6 were ever
supplied, so memoize_articles / follow_meta_refresh / http_success_only /
proxies / headers were unreachable from configuration. Typed here so
that gap cannot reopen.
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class ScrapingQuirks:
    """Parser deviations. All currently one parser's tuning knobs.

    These were previously an opaque ``config`` dict threaded through an
    ``extra=`` lambda, of which 10 keys were read but only 6 were ever supplied —
    ``memoize_articles``, ``follow_meta_refresh``, ``http_success_only``,
    ``proxies`` and ``headers`` were unreachable from configuration. Typed here
    so that gap cannot reopen.
    """
    timeout: int = 30
    threads: int = 4
    fetch_images: bool = True
    enable_nlp: bool = False
    language: str = "en"
    user_agent: str = "Mozilla/5.0 (compatible; OpenPoliticsBot/1.0; +https://open-politics.org/)"
    memoize_articles: bool = True
    follow_meta_refresh: bool = False
    http_success_only: bool = True
