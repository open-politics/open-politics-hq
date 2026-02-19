"""
newspaper4k-based scraping provider implementation.

This module provides a ScrapingProvider implementation using the newspaper4k library,
replacing the previous OPOL-based implementation with enhanced capabilities for
news source analysis, RSS feed discovery, and bulk article processing.
"""

import logging
import asyncio
from typing import Any, Dict, List, Optional, Union
from datetime import datetime, timezone
from urllib.parse import urlparse, urljoin

import newspaper
from newspaper import Article, Source
from newspaper.mthreading import fetch_news

from app.api.providers.base import ScrapingProvider

logger = logging.getLogger(__name__)


class Newspaper4kScrapingProvider(ScrapingProvider):
    """
    newspaper4k implementation of the ScrapingProvider interface.
    
    Provides enhanced scraping capabilities including:
    - Single URL scraping with retry logic
    - Bulk URL processing with multi-threading
    - News source analysis and RSS feed discovery
    - Rich metadata extraction (authors, publish_date, images, etc.)
    - Optional NLP features (keywords, summary)
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize the newspaper4k scraping provider.
        
        Args:
            config: Optional configuration dictionary with newspaper4k settings
        """
        self.config = config or {}
        self.newspaper_config = self._create_newspaper_config()
        
        logger.info("Newspaper4kScrapingProvider initialized with enhanced capabilities")
    
    def _create_newspaper_config(self) -> newspaper.Config:
        """Create and configure newspaper4k Config object."""
        config = newspaper.Config()
        
        # Apply custom configuration
        config.browser_user_agent = self.config.get(
            'user_agent', 
            'Mozilla/5.0 (compatible; OpenPoliticsBot/1.0; +https://openpolitics.com/)'
        )
        config.request_timeout = self.config.get('timeout', 30)
        config.number_threads = self.config.get('threads', 4)
        config.fetch_images = self.config.get('fetch_images', True)
        config.memoize_articles = self.config.get('memoize_articles', True)
        config.follow_meta_refresh = self.config.get('follow_meta_refresh', False)
        config.http_success_only = self.config.get('http_success_only', True)
        
        # Set language if specified
        if 'language' in self.config:
            config.language = self.config['language']
        
        # Set proxy if specified
        if 'proxies' in self.config:
            config.proxies = self.config['proxies']
        
        # Custom headers
        if 'headers' in self.config:
            config.headers = self.config['headers']
        
        return config
    
    async def scrape_url(self, url: str, timeout: int = 30, retry_attempts: int = 1) -> Dict[str, Any]:
        """
        Scrape content from a single URL with retry logic.
        
        Args:
            url: The URL to scrape
            timeout: Request timeout in seconds
            retry_attempts: Number of retry attempts on failure
            
        Returns:
            Dictionary containing scraped content and metadata
            
        Raises:
            ValueError: If scraping fails after all retries
        """
        current_attempt = 0
        last_exception = None
        
        while current_attempt <= retry_attempts:
            try:
                logger.debug(f"Scraping attempt {current_attempt + 1}/{retry_attempts + 1} for URL: {url}")
                
                # Create article with custom config
                article_config = newspaper.Config()
                article_config.request_timeout = timeout
                article_config.browser_user_agent = self.newspaper_config.browser_user_agent
                article_config.fetch_images = self.newspaper_config.fetch_images
                article_config.follow_meta_refresh = self.newspaper_config.follow_meta_refresh
                article_config.http_success_only = self.newspaper_config.http_success_only
                
                if hasattr(self.newspaper_config, 'proxies') and self.newspaper_config.proxies:
                    article_config.proxies = self.newspaper_config.proxies
                
                # Use newspaper.article() shortcut for download + parse
                article_data = await asyncio.to_thread(
                    newspaper.article, 
                    url, 
                    config=article_config
                )
                
                if not article_data or not article_data.text:
                    if current_attempt == retry_attempts:
                        raise ValueError("Scraping yielded no content after all attempts")
                    
                    current_attempt += 1
                    await asyncio.sleep(1 * current_attempt)  # Simple backoff
                    continue
                
                # Extract and standardize data
                result = await self._extract_article_data(article_data, url)
                
                logger.info(f"Successfully scraped URL: {url}, Title: '{result['title'][:50]}...', Content: {len(result['text_content'])} chars")
                return result
                
            except Exception as e:
                last_exception = e
                logger.warning(f"Scraping attempt {current_attempt + 1} failed for URL {url}: {e}")
                
                if current_attempt == retry_attempts:
                    logger.error(f"All {retry_attempts + 1} scraping attempts failed for URL {url}")
                    raise ValueError(f"Failed to scrape URL {url} after {retry_attempts + 1} attempts: {last_exception}") from last_exception
                
                current_attempt += 1
                await asyncio.sleep(1 * current_attempt)
        
        # Should not reach here, but as fallback
        raise ValueError(f"Scraping failed for {url} due to unexpected loop exit. Last error: {last_exception}")
    
    async def scrape_urls_bulk(self, urls: List[str], max_threads: int = 4) -> List[Dict[str, Any]]:
        """
        Scrape multiple URLs using newspaper4k's multi-threading capabilities.
        
        Args:
            urls: List of URLs to scrape
            max_threads: Maximum number of threads to use
            
        Returns:
            List of scraped article dictionaries
        """
        if not urls:
            return []
        
        logger.info(f"Starting bulk scraping of {len(urls)} URLs with {max_threads} threads")
        
        try:
            # Use newspaper's fetch_news for efficient multi-threaded downloading
            results = await asyncio.to_thread(fetch_news, urls, threads=max_threads)
            
            # Process results and extract standardized data
            scraped_articles = []
            for i, article in enumerate(results):
                try:
                    if hasattr(article, 'url') and article.url:
                        # Article object from fetch_news
                        result = await self._extract_article_data(article, article.url)
                        scraped_articles.append(result)
                    else:
                        # Handle case where article is just a URL string
                        logger.warning(f"Bulk scraping item {i} did not return valid article data")
                        scraped_articles.append({
                            "url": urls[i] if i < len(urls) else "unknown",
                            "title": "",
                            "text_content": "",
                            "publication_date": None,
                            "authors": [],
                            "top_image": None,
                            "images": [],
                            "summary": "",
                            "keywords": [],
                            "meta_description": "",
                            "scraping_error": "No valid article data returned"
                        })
                except Exception as e:
                    logger.error(f"Error processing bulk scraped article {i}: {e}")
                    scraped_articles.append({
                        "url": urls[i] if i < len(urls) else "unknown",
                        "title": "",
                        "text_content": "",
                        "publication_date": None,
                        "authors": [],
                        "top_image": None,
                        "images": [],
                        "summary": "",
                        "keywords": [],
                        "meta_description": "",
                        "scraping_error": str(e)
                    })
            
            logger.info(f"Bulk scraping completed: {len(scraped_articles)} articles processed")
            return scraped_articles
            
        except Exception as e:
            logger.error(f"Bulk scraping failed: {e}")
            # Return error entries for all URLs
            return [{
                "url": url,
                "title": "",
                "text_content": "",
                "publication_date": None,
                "authors": [],
                "top_image": None,
                "images": [],
                "summary": "",
                "keywords": [],
                "meta_description": "",
                "scraping_error": f"Bulk scraping failed: {str(e)}"
            } for url in urls]
    
    async def analyze_source(self, base_url: str) -> Dict[str, Any]:
        """
        Analyze a news source to discover RSS feeds, categories, and articles.
        
        Args:
            base_url: Base URL of the news source to analyze
            
        Returns:
            Dictionary containing source analysis results
        """
        logger.info(f"Analyzing news source: {base_url}")
        
        try:
            # Build source using newspaper4k
            source = await asyncio.to_thread(newspaper.build, base_url, config=self.newspaper_config)
            
            # Extract source information
            analysis_result = {
                "base_url": base_url,
                "brand": getattr(source, 'brand', ''),
                "description": getattr(source, 'description', ''),
                "size": source.size(),
                "domain": getattr(source, 'domain', ''),
                "favicon": getattr(source, 'favicon', ''),
                "logo_url": getattr(source, 'logo_url', ''),
                
                # RSS feeds
                "rss_feeds": [],
                "feed_urls": [],
                
                # Categories
                "categories": [],
                "category_urls": [],
                
                # Recent articles
                "recent_articles": [],
                
                # Analysis metadata
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
                "analysis_method": "newspaper4k"
            }
            
            # Extract RSS feeds
            try:
                feed_urls = source.feed_urls()
                analysis_result["feed_urls"] = list(feed_urls)
                analysis_result["rss_feeds"] = [{"url": url, "title": f"RSS Feed"} for url in feed_urls]
            except Exception as e:
                logger.warning(f"Failed to extract RSS feeds from {base_url}: {e}")
            
            # Extract categories
            try:
                category_urls = source.category_urls()
                analysis_result["category_urls"] = list(category_urls)
                analysis_result["categories"] = [{"url": url, "title": self._extract_category_name(url)} for url in category_urls]
            except Exception as e:
                logger.warning(f"Failed to extract categories from {base_url}: {e}")
            
            # Extract recent articles (limited sample)
            try:
                articles = source.articles[:20]  # Limit to first 20 articles
                recent_articles = []
                for article in articles:
                    recent_articles.append({
                        "url": article.url,
                        "title": getattr(article, 'title', '') or self._extract_title_from_url(article.url)
                    })
                analysis_result["recent_articles"] = recent_articles
            except Exception as e:
                logger.warning(f"Failed to extract recent articles from {base_url}: {e}")
            
            logger.info(f"Source analysis completed for {base_url}: {len(analysis_result['rss_feeds'])} feeds, {len(analysis_result['categories'])} categories, {len(analysis_result['recent_articles'])} articles")
            return analysis_result
            
        except Exception as e:
            logger.error(f"Source analysis failed for {base_url}: {e}")
            return {
                "base_url": base_url,
                "error": str(e),
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
                "analysis_method": "newspaper4k"
            }
    
    async def discover_rss_feeds(self, base_url: str) -> List[str]:
        """
        Discover RSS feeds from a news source.
        
        Args:
            base_url: Base URL of the news source
            
        Returns:
            List of discovered RSS feed URLs
        """
        try:
            analysis = await self.analyze_source(base_url)
            return analysis.get("feed_urls", [])
        except Exception as e:
            logger.error(f"RSS feed discovery failed for {base_url}: {e}")
            return []
    
    async def _extract_article_data(self, article, original_url: str) -> Dict[str, Any]:
        """
        Extract and standardize data from a newspaper4k Article object.
        
        Args:
            article: newspaper4k Article object
            original_url: Original URL that was scraped
            
        Returns:
            Standardized article data dictionary
        """
        # Handle potential NLP processing
        enable_nlp = self.config.get('enable_nlp', False)
        if enable_nlp and hasattr(article, 'nlp'):
            try:
                await asyncio.to_thread(article.nlp)
            except Exception as e:
                logger.warning(f"NLP processing failed for {original_url}: {e}")
        
        # Extract publication date
        publication_date = None
        if hasattr(article, 'publish_date') and article.publish_date:
            try:
                if isinstance(article.publish_date, str):
                    publication_date = article.publish_date
                else:
                    publication_date = article.publish_date.isoformat()
            except Exception as e:
                logger.warning(f"Failed to process publication date for {original_url}: {e}")
        
        # Extract authors
        authors = []
        if hasattr(article, 'authors') and article.authors:
            authors = list(article.authors)
        
        # Extract images
        images = []
        if hasattr(article, 'images') and article.images:
            images = list(article.images)
        
        # Extract keywords (from NLP if enabled)
        keywords = []
        if enable_nlp and hasattr(article, 'keywords') and article.keywords:
            keywords = list(article.keywords)
        
        # Extract summary (from NLP if enabled)
        summary = ""
        if enable_nlp and hasattr(article, 'summary') and article.summary:
            summary = article.summary
        
        return {
            "url": original_url,
            "final_url": getattr(article, 'url', original_url),  # May differ due to redirects
            "title": getattr(article, 'title', ''),
            "text_content": getattr(article, 'text', ''),
            "publication_date": publication_date,
            "authors": authors,
            "top_image": getattr(article, 'top_image', None),
            "images": images,
            "summary": summary,
            "keywords": keywords,
            "meta_description": getattr(article, 'meta_description', ''),
            "meta_keywords": getattr(article, 'meta_keywords', ''),
            "meta_lang": getattr(article, 'meta_lang', ''),
            "canonical_link": getattr(article, 'canonical_link', ''),
            
            # Technical metadata
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "scraping_method": "newspaper4k",
            "content_length": len(getattr(article, 'text', '')),
            "image_count": len(images),
            "author_count": len(authors),
            "keyword_count": len(keywords),
            
            # Raw data for debugging/advanced use
            "raw_scraped_data": {
                "html_length": len(getattr(article, 'html', '')),
                "article_html_length": len(getattr(article, 'article_html', '')),
                "download_state": getattr(article, 'download_state', None),
                "is_parsed": getattr(article, 'is_parsed', False)
            }
        }
    
    def _extract_category_name(self, category_url: str) -> str:
        """Extract a readable category name from a category URL."""
        try:
            parsed = urlparse(category_url)
            path_parts = [part for part in parsed.path.split('/') if part]
            if path_parts:
                return path_parts[-1].replace('-', ' ').replace('_', ' ').title()
            return "Category"
        except Exception:
            return "Category"
    
    def _extract_title_from_url(self, url: str) -> str:
        """Extract a potential title from a URL path."""
        try:
            parsed = urlparse(url)
            path_parts = [part for part in parsed.path.split('/') if part]
            if path_parts:
                # Take the last part and clean it up
                title_part = path_parts[-1]
                # Remove common file extensions
                for ext in ['.html', '.htm', '.php', '.asp', '.aspx']:
                    if title_part.endswith(ext):
                        title_part = title_part[:-len(ext)]
                        break
                # Replace separators with spaces and title case
                return title_part.replace('-', ' ').replace('_', ' ').title()
            return "Article"
        except Exception:
            return "Article"
