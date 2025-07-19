"""
Search Intelligence Service
==========================

Core service that orchestrates search-to-asset workflows, providing intelligent
search capabilities with filtering, deduplication, and automated asset creation.

This service acts as the main coordinator between:
- Search providers (Tavily, OPOL, etc.)
- Content ingestion (ContentService)
- Site discovery and crawling
- Recurring search monitoring
- Result filtering and deduplication

Key Features:
- Unified search interface across multiple providers
- Intelligent filtering and deduplication
- Site discovery and URL extraction
- Automated asset creation from search results
- Change tracking for monitored content
- Recurring search operations
"""

import logging
import asyncio
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple, Union
from urllib.parse import urljoin, urlparse
import re

from sqlmodel import Session, select
from fastapi import HTTPException

from app.models import Asset, Source, Bundle, AssetKind, ProcessingStatus
from app.schemas import AssetCreate
from app.api.providers.base import SearchProvider, ScrapingProvider
from app.api.providers.factory import create_search_provider, create_scraping_provider
from app.api.services.content_service import ContentService
from app.api.services.service_utils import validate_infospace_access
from app.core.config import settings

logger = logging.getLogger(__name__)

class SearchResult:
    """Standardized search result with enhanced metadata."""
    
    def __init__(self, title: str, url: str, content: str, score: Optional[float] = None, 
                 provider: str = "unknown", raw_data: Optional[Dict[str, Any]] = None):
        self.title = title
        self.url = url
        self.content = content
        self.score = score
        self.provider = provider
        self.raw_data = raw_data or {}
        self.content_hash = self._generate_content_hash()
        self.domain = self._extract_domain()
        
    def _generate_content_hash(self) -> str:
        """Generate a hash for deduplication purposes."""
        content_for_hash = f"{self.title}|{self.url}|{self.content[:500]}"
        return hashlib.md5(content_for_hash.encode()).hexdigest()
    
    def _extract_domain(self) -> str:
        """Extract domain from URL."""
        try:
            return urlparse(self.url).netloc
        except Exception:
            return "unknown"

class SearchFilter:
    """Configuration for filtering search results."""
    
    def __init__(self):
        self.allowed_domains: Optional[Set[str]] = None
        self.blocked_domains: Optional[Set[str]] = None
        self.required_keywords: Optional[List[str]] = None
        self.blocked_keywords: Optional[List[str]] = None
        self.min_content_length: Optional[int] = None
        self.max_content_length: Optional[int] = None
        self.min_score: Optional[float] = None
        self.url_patterns: Optional[List[str]] = None  # Regex patterns for URLs
        self.content_patterns: Optional[List[str]] = None  # Regex patterns for content
        
    def matches(self, result: SearchResult) -> bool:
        """Check if a search result matches the filter criteria."""
        # Domain filtering
        if self.allowed_domains and result.domain not in self.allowed_domains:
            return False
        if self.blocked_domains and result.domain in self.blocked_domains:
            return False
            
        # Keyword filtering
        if self.required_keywords:
            content_lower = f"{result.title} {result.content}".lower()
            if not any(keyword.lower() in content_lower for keyword in self.required_keywords):
                return False
                
        if self.blocked_keywords:
            content_lower = f"{result.title} {result.content}".lower()
            if any(keyword.lower() in content_lower for keyword in self.blocked_keywords):
                return False
                
        # Content length filtering
        if self.min_content_length and len(result.content) < self.min_content_length:
            return False
        if self.max_content_length and len(result.content) > self.max_content_length:
            return False
            
        # Score filtering
        if self.min_score and (result.score is None or result.score < self.min_score):
            return False
            
        # URL pattern filtering
        if self.url_patterns:
            if not any(re.search(pattern, result.url) for pattern in self.url_patterns):
                return False
                
        # Content pattern filtering
        if self.content_patterns:
            content_text = f"{result.title} {result.content}"
            if not any(re.search(pattern, content_text, re.IGNORECASE) for pattern in self.content_patterns):
                return False
                
        return True

class SearchIntelligenceService:
    """
    Core service for intelligent search operations and asset creation.
    
    This service provides a unified interface for:
    - Multi-provider search with intelligent filtering
    - Site discovery and URL extraction
    - Automated asset creation from search results
    - Deduplication and change tracking
    - Recurring search monitoring
    """
    
    def __init__(self, session: Session, content_service: ContentService):
        self.session = session
        self.content_service = content_service
        self.search_provider = create_search_provider(settings)
        self.scraping_provider = create_scraping_provider(settings)
        logger.info("SearchIntelligenceService initialized")
    
    # ─────────────── Core Search Operations ─────────────── #
    
    async def search_with_provider(
        self,
        query: str,
        provider: str = "default",
        limit: int = 20,
        skip: int = 0,
        **provider_params
    ) -> List[SearchResult]:
        """
        Execute search using specified provider.
        
        Args:
            query: Search query
            provider: Provider name (default uses configured provider)
            limit: Maximum number of results
            skip: Number of results to skip
            **provider_params: Provider-specific parameters
            
        Returns:
            List of standardized search results
        """
        try:
            # Use configured provider if "default" is specified
            if provider == "default":
                search_provider = self.search_provider
            else:
                # TODO: Support multiple providers via factory
                search_provider = self.search_provider
                
            raw_results = await search_provider.search(
                query=query, 
                limit=limit, 
                skip=skip, 
                **provider_params
            )
            
            # Convert to standardized format
            results = []
            for raw_result in raw_results:
                result = SearchResult(
                    title=raw_result.get("title", ""),
                    url=raw_result.get("url", ""),
                    content=raw_result.get("content", ""),
                    score=raw_result.get("score"),
                    provider=provider,
                    raw_data=raw_result
                )
                results.append(result)
                
            logger.info(f"Search '{query}' via {provider} returned {len(results)} results")
            return results
            
        except Exception as e:
            logger.error(f"Search failed for query '{query}': {e}")
            raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")
    
    async def search_and_filter(
        self,
        query: str,
        search_filter: Optional[SearchFilter] = None,
        provider: str = "default",
        limit: int = 20,
        deduplicate: bool = True,
        **provider_params
    ) -> List[SearchResult]:
        """
        Search with intelligent filtering and deduplication.
        
        Args:
            query: Search query
            search_filter: Filter configuration
            provider: Provider name
            limit: Maximum number of results
            deduplicate: Whether to remove duplicates
            **provider_params: Provider-specific parameters
            
        Returns:
            Filtered and deduplicated search results
        """
        # Get raw search results
        results = await self.search_with_provider(
            query=query,
            provider=provider,
            limit=limit * 2 if search_filter else limit,  # Get more if filtering
            **provider_params
        )
        
        # Apply filtering
        if search_filter:
            results = [result for result in results if search_filter.matches(result)]
            
        # Apply deduplication
        if deduplicate:
            results = self._deduplicate_results(results)
            
        # Limit final results
        return results[:limit]
    
    def _deduplicate_results(self, results: List[SearchResult]) -> List[SearchResult]:
        """Remove duplicate results based on content hash and URL."""
        seen_hashes = set()
        seen_urls = set()
        unique_results = []
        
        for result in results:
            # Skip if we've seen this content hash or URL
            if result.content_hash in seen_hashes or result.url in seen_urls:
                continue
                
            seen_hashes.add(result.content_hash)
            seen_urls.add(result.url)
            unique_results.append(result)
            
        logger.info(f"Deduplication: {len(results)} -> {len(unique_results)} results")
        return unique_results
    
    # ─────────────── Site Discovery Operations ─────────────── #
    
    async def discover_site_urls(
        self,
        base_url: str,
        max_depth: int = 2,
        max_urls: int = 100,
        url_filter: Optional[SearchFilter] = None
    ) -> List[str]:
        """
        Discover URLs from a base site by crawling links.
        
        Args:
            base_url: Base URL to start crawling from
            max_depth: Maximum crawl depth
            max_urls: Maximum number of URLs to discover
            url_filter: Filter for discovered URLs
            
        Returns:
            List of discovered URLs
        """
        try:
            discovered_urls = set()
            urls_to_crawl = [(base_url, 0)]  # (url, depth)
            crawled_urls = set()
            
            while urls_to_crawl and len(discovered_urls) < max_urls:
                current_url, depth = urls_to_crawl.pop(0)
                
                if current_url in crawled_urls or depth > max_depth:
                    continue
                    
                crawled_urls.add(current_url)
                
                try:
                    # Scrape the page to extract links
                    scraped_data = await self.scraping_provider.scrape_url(current_url)
                    if not scraped_data:
                        continue
                        
                    # Extract links from scraped content
                    links = self._extract_links_from_content(
                        scraped_data.get("text_content", ""),
                        base_url=current_url
                    )
                    
                    for link in links:
                        if link not in discovered_urls and link not in crawled_urls:
                            # Apply URL filtering if provided
                            if url_filter:
                                dummy_result = SearchResult(
                                    title="", url=link, content="", provider="crawler"
                                )
                                if not url_filter.matches(dummy_result):
                                    continue
                                    
                            discovered_urls.add(link)
                            
                            # Add to crawl queue if within depth limit
                            if depth < max_depth:
                                urls_to_crawl.append((link, depth + 1))
                                
                except Exception as e:
                    logger.warning(f"Failed to crawl {current_url}: {e}")
                    continue
                    
            logger.info(f"Site discovery for {base_url}: found {len(discovered_urls)} URLs")
            return list(discovered_urls)
            
        except Exception as e:
            logger.error(f"Site discovery failed for {base_url}: {e}")
            raise HTTPException(status_code=500, detail=f"Site discovery failed: {str(e)}")
    
    def _extract_links_from_content(self, content: str, base_url: str) -> List[str]:
        """Extract and normalize links from content."""
        links = []
        
        # Simple regex to find URLs in content
        url_pattern = re.compile(r'https?://[^\s<>"\']+')
        found_urls = url_pattern.findall(content)
        
        for url in found_urls:
            try:
                # Normalize and validate URL
                normalized_url = urljoin(base_url, url)
                if self._is_valid_url(normalized_url):
                    links.append(normalized_url)
            except Exception:
                continue
                
        return links
    
    def _is_valid_url(self, url: str) -> bool:
        """Check if URL is valid and accessible."""
        try:
            parsed = urlparse(url)
            return parsed.scheme in ('http', 'https') and parsed.netloc
        except Exception:
            return False
    
    # ─────────────── Asset Creation Operations ─────────────── #
    
    async def search_and_create_assets(
        self,
        query: str,
        infospace_id: int,
        user_id: int,
        bundle_id: Optional[int] = None,
        search_filter: Optional[SearchFilter] = None,
        provider: str = "default",
        limit: int = 20,
        scrape_content: bool = True,
        asset_title_template: str = "{title}",
        **provider_params
    ) -> List[Asset]:
        """
        Search for content and automatically create assets.
        
        Args:
            query: Search query
            infospace_id: Target infospace ID
            user_id: User performing the operation
            bundle_id: Optional bundle to add assets to
            search_filter: Filter configuration
            provider: Search provider
            limit: Maximum number of assets to create
            scrape_content: Whether to scrape full content
            asset_title_template: Template for asset titles
            **provider_params: Provider-specific parameters
            
        Returns:
            List of created assets
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Perform filtered search
        search_results = await self.search_and_filter(
            query=query,
            search_filter=search_filter,
            provider=provider,
            limit=limit,
            **provider_params
        )
        
        # Create assets from search results
        created_assets = []
        
        for result in search_results:
            try:
                # Generate asset title from template
                asset_title = asset_title_template.format(
                    title=result.title,
                    query=query,
                    provider=result.provider,
                    domain=result.domain
                )
                
                # Create asset via ContentService
                asset = await self.content_service.ingest_url(
                    url=result.url,
                    infospace_id=infospace_id,
                    user_id=user_id,
                    title=asset_title,
                    scrape_immediately=scrape_content
                )
                
                # Add search metadata
                search_metadata = {
                    "search_query": query,
                    "search_provider": result.provider,
                    "search_score": result.score,
                    "search_rank": len(created_assets) + 1,
                    "content_hash": result.content_hash,
                    "discovered_at": datetime.now(timezone.utc).isoformat()
                }
                
                # Update asset with search metadata
                if asset.source_metadata:
                    asset.source_metadata.update(search_metadata)
                else:
                    asset.source_metadata = search_metadata
                    
                self.session.add(asset)
                created_assets.append(asset)
                
                # Add to bundle if specified
                if bundle_id:
                    await self._add_asset_to_bundle(asset.id, bundle_id)
                    
            except Exception as e:
                logger.error(f"Failed to create asset from {result.url}: {e}")
                continue
                
        self.session.commit()
        logger.info(f"Created {len(created_assets)} assets from search '{query}'")
        return created_assets
    
    async def discover_and_create_assets(
        self,
        base_url: str,
        infospace_id: int,
        user_id: int,
        bundle_id: Optional[int] = None,
        max_depth: int = 2,
        max_urls: int = 50,
        url_filter: Optional[SearchFilter] = None,
        scrape_content: bool = True
    ) -> List[Asset]:
        """
        Discover URLs from a site and create assets.
        
        Args:
            base_url: Base URL to crawl
            infospace_id: Target infospace ID
            user_id: User performing the operation
            bundle_id: Optional bundle to add assets to
            max_depth: Maximum crawl depth
            max_urls: Maximum number of URLs to process
            url_filter: Filter for discovered URLs
            scrape_content: Whether to scrape full content
            
        Returns:
            List of created assets
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Discover URLs
        discovered_urls = await self.discover_site_urls(
            base_url=base_url,
            max_depth=max_depth,
            max_urls=max_urls,
            url_filter=url_filter
        )
        
        # Create assets from discovered URLs
        created_assets = await self.content_service.ingest_bulk_urls(
            urls=discovered_urls,
            infospace_id=infospace_id,
            user_id=user_id,
            base_title=f"Discovered from {urlparse(base_url).netloc}",
            scrape_immediately=scrape_content
        )
        
        # Add discovery metadata
        discovery_metadata = {
            "discovery_base_url": base_url,
            "discovery_depth": max_depth,
            "discovered_at": datetime.now(timezone.utc).isoformat(),
            "discovery_method": "site_crawl"
        }
        
        for asset in created_assets:
            if asset.source_metadata:
                asset.source_metadata.update(discovery_metadata)
            else:
                asset.source_metadata = discovery_metadata
            self.session.add(asset)
            
            # Add to bundle if specified
            if bundle_id:
                await self._add_asset_to_bundle(asset.id, bundle_id)
                
        self.session.commit()
        logger.info(f"Created {len(created_assets)} assets from site discovery of {base_url}")
        return created_assets
    
    # ─────────────── Change Tracking Operations ─────────────── #
    
    async def track_content_changes(
        self,
        url: str,
        infospace_id: int,
        user_id: int,
        comparison_asset_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Track changes in content at a URL.
        
        Args:
            url: URL to monitor
            infospace_id: Target infospace ID
            user_id: User performing the operation
            comparison_asset_id: Optional existing asset to compare against
            
        Returns:
            Change tracking information
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        try:
            # Scrape current content
            current_content = await self.scraping_provider.scrape_url(url)
            if not current_content:
                return {"error": "Failed to scrape current content"}
                
            current_hash = hashlib.md5(
                current_content.get("text_content", "").encode()
            ).hexdigest()
            
            # Find existing asset if not provided
            if not comparison_asset_id:
                existing_asset = self.session.exec(
                    select(Asset).where(
                        Asset.infospace_id == infospace_id,
                        Asset.source_identifier == url
                    ).order_by(Asset.created_at.desc())
                ).first()
                comparison_asset_id = existing_asset.id if existing_asset else None
                
            # Compare with existing content
            if comparison_asset_id:
                existing_asset = self.session.get(Asset, comparison_asset_id)
                if existing_asset and existing_asset.text_content:
                    existing_hash = hashlib.md5(
                        existing_asset.text_content.encode()
                    ).hexdigest()
                    
                    has_changed = current_hash != existing_hash
                    
                    return {
                        "url": url,
                        "has_changed": has_changed,
                        "current_hash": current_hash,
                        "previous_hash": existing_hash,
                        "comparison_asset_id": comparison_asset_id,
                        "checked_at": datetime.now(timezone.utc).isoformat()
                    }
                    
            # No existing content to compare
            return {
                "url": url,
                "has_changed": True,  # New content
                "current_hash": current_hash,
                "previous_hash": None,
                "comparison_asset_id": None,
                "checked_at": datetime.now(timezone.utc).isoformat()
            }
            
        except Exception as e:
            logger.error(f"Change tracking failed for {url}: {e}")
            return {"error": f"Change tracking failed: {str(e)}"}
    
    # ─────────────── Utility Methods ─────────────── #
    
    async def _add_asset_to_bundle(self, asset_id: int, bundle_id: int) -> None:
        """Add an asset to a bundle."""
        try:
            from app.models import AssetBundleLink
            
            # Check if link already exists
            existing_link = self.session.exec(
                select(AssetBundleLink).where(
                    AssetBundleLink.asset_id == asset_id,
                    AssetBundleLink.bundle_id == bundle_id
                )
            ).first()
            
            if not existing_link:
                link = AssetBundleLink(asset_id=asset_id, bundle_id=bundle_id)
                self.session.add(link)
                
        except Exception as e:
            logger.error(f"Failed to add asset {asset_id} to bundle {bundle_id}: {e}")
    
    def create_filter_from_config(self, filter_config: Dict[str, Any]) -> SearchFilter:
        """Create a SearchFilter from configuration dictionary."""
        search_filter = SearchFilter()
        
        if "allowed_domains" in filter_config:
            search_filter.allowed_domains = set(filter_config["allowed_domains"])
        if "blocked_domains" in filter_config:
            search_filter.blocked_domains = set(filter_config["blocked_domains"])
        if "required_keywords" in filter_config:
            search_filter.required_keywords = filter_config["required_keywords"]
        if "blocked_keywords" in filter_config:
            search_filter.blocked_keywords = filter_config["blocked_keywords"]
        if "min_content_length" in filter_config:
            search_filter.min_content_length = filter_config["min_content_length"]
        if "max_content_length" in filter_config:
            search_filter.max_content_length = filter_config["max_content_length"]
        if "min_score" in filter_config:
            search_filter.min_score = filter_config["min_score"]
        if "url_patterns" in filter_config:
            search_filter.url_patterns = filter_config["url_patterns"]
        if "content_patterns" in filter_config:
            search_filter.content_patterns = filter_config["content_patterns"]
            
        return search_filter
    
    def get_supported_providers(self) -> List[str]:
        """Get list of supported search providers."""
        # TODO: Implement dynamic provider discovery
        return ["tavily", "opol_searxng", "default"]
    
    def get_provider_capabilities(self, provider: str) -> Dict[str, Any]:
        """Get capabilities of a specific provider."""
        # TODO: Implement provider capability discovery
        return {
            "supports_pagination": True,
            "supports_date_filtering": False,
            "supports_domain_filtering": False,
            "max_results": 100
        } 