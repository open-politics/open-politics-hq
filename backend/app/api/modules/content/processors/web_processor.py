"""
Web Processor
=============

Processes web pages by scraping content and extracting images.
"""

import logging
import dateutil.parser
from datetime import datetime, timezone
from typing import List
from app.api.modules.content.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.services.asset_builder import AssetBuilder
from .base import BaseProcessor, ProcessingError

logger = logging.getLogger(__name__)


class WebProcessor(BaseProcessor):
    """
    Process web pages.
    
    Scrapes HTML content and extracts:
    - Text content
    - Featured image
    - Content images
    """
    
    def can_process(self, asset: Asset) -> bool:
        """Check if asset is a processable web page."""
        return (
            asset.kind == AssetKind.WEB and
            asset.source_identifier is not None
        )
    
    async def process(self, asset: Asset) -> List[Asset]:
        """
        Process web page and create image assets.
        
        Args:
            asset: Parent WEB asset
            
        Returns:
            List of IMAGE child assets
        """
        if not self.can_process(asset):
            raise ProcessingError(f"Cannot process asset {asset.id} as web page")
        
        if not self.context.scraping_provider:
            raise ProcessingError("Scraping provider not available")
        
        timeout = self.context.timeout
        max_images = self.context.max_images
        
        # Scrape content
        scraped_data = await self.context.scraping_provider.scrape_url(
            asset.source_identifier,
            timeout=timeout
        )
        
        if not scraped_data or not scraped_data.get('text_content'):
            raise ProcessingError("No content could be scraped from URL")
        
        # Update asset with scraped content
        text_content = scraped_data.get('text_content', '').strip()
        title = scraped_data.get('title', '').strip()
        
        asset.text_content = text_content
        if title:
            asset.title = title
            logger.info(f"Updated asset {asset.id} title to scraped title: '{title}'")
        
        # Parse publication date if available
        if scraped_data.get('publication_date'):
            try:
                parsed_dt = dateutil.parser.parse(scraped_data['publication_date'])
                asset.event_timestamp = parsed_dt.replace(
                    tzinfo=parsed_dt.tzinfo or timezone.utc
                )
            except Exception as e:
                logger.warning(f"Could not parse publication date: {e}")
        
        # Update file_info (scraped metadata)
        file_info = asset.file_info or {}
        file_info.update({
            'scraped_at': datetime.now(timezone.utc).isoformat(),
            'scraped_title': scraped_data.get('title'),
            'top_image': scraped_data.get('top_image'),
            'summary': scraped_data.get('summary'),
            'publication_date': scraped_data.get('publication_date'),
            'content_length': len(text_content),
            'processing_options': self.context.options
        })
        asset.file_info = file_info
        
        # Build image child assets (stub image rows — just URL references)
        child_assets: List[Asset] = []
        parent_article_info = {
            'title': asset.title,
            'url': asset.source_identifier,
            'asset_id': asset.id,
        }
        scraped_at = asset.file_info.get('scraped_at', '')

        # Featured image
        if scraped_data.get('top_image'):
            child_assets.append(Asset(
                title=f"Featured: {asset.title}",
                kind=AssetKind.IMAGE,
                user_id=asset.user_id,
                infospace_id=asset.infospace_id,
                source_identifier=scraped_data['top_image'],
                processing_status=ProcessingStatus.READY,
                file_info={
                    'image_role': 'featured',
                    'image_url': scraped_data['top_image'],
                    'parent_article': parent_article_info,
                    'scraped_at': scraped_at,
                    'is_hero_image': True,
                },
            ))

        # Content images
        images = scraped_data.get('images', [])
        if images:
            content_images = self._filter_content_images(
                images,
                scraped_data.get('top_image'),
            )

            start_index = 1 if scraped_data.get('top_image') else 0
            for idx, img_url in enumerate(content_images[:max_images]):
                child_assets.append(Asset(
                    title=f"Image {start_index + idx + 1}: {asset.title}",
                    kind=AssetKind.IMAGE,
                    user_id=asset.user_id,
                    infospace_id=asset.infospace_id,
                    source_identifier=img_url,
                    processing_status=ProcessingStatus.READY,
                    file_info={
                        'image_role': 'content',
                        'image_url': img_url,
                        'parent_article': parent_article_info,
                        'content_index': idx,
                        'scraped_at': scraped_at,
                    },
                ))

        # Batch insert via builder (auto-assigns parent_asset_id + part_index 0..N-1)
        if child_assets:
            builder = AssetBuilder(
                self.context.session, asset.user_id, asset.infospace_id,
            )
            await builder.build_children(asset.id, child_assets)

        logger.info(
            f"Processed web content: {len(child_assets)} images extracted, "
            f"created {len(child_assets)} image assets"
        )

        return child_assets
    
    def _filter_content_images(
        self, 
        images: List[str], 
        top_image: str = None
    ) -> List[str]:
        """Filter out non-content images from scraped image list."""
        if not images:
            return []
        
        content_images = []
        seen_urls = {top_image} if top_image else set()
        
        skip_patterns = [
            'logo', 'icon', 'avatar', 'button', 'badge', 'banner',
            'header', 'footer', 'nav', 'menu', 'ad', 'advertisement',
            'twitter.gif', 'facebook.gif', 'pixel.gif', '1x1.gif',
            'sprite', 'tracking'
        ]
        
        for img_url in images:
            if img_url in seen_urls:
                continue
            
            img_lower = img_url.lower()
            if any(pattern in img_lower for pattern in skip_patterns):
                continue
            
            if any(dim in img_url for dim in ['16x16', '32x32', '64x64']):
                continue
            
            content_images.append(img_url)
            seen_urls.add(img_url)
        
        return content_images

