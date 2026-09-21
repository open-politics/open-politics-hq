"""
scraping/dialects — which wires exist.

  article_parser   newspaper4k — a library, not a wire
"""

from app.api.modules.foundation_service_providers.scraping.provider import Scraping


Scraping.dialect("article_parser", module="article_parser", adapter="ArticleParserScraper")
