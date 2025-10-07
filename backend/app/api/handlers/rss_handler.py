"""
RSS Handler
===========

Handles RSS feed ingestion.
"""

import logging
import feedparser
from typing import List, Dict, Any, Optional
from sqlmodel import Session

from app.models import Asset, AssetKind
from app.api.services.asset_builder import AssetBuilder

logger = logging.getLogger(__name__)


class RSSHandler:
    """
    Handle RSS feed ingestion.
    
    Uses AssetBuilder's from_rss_entry() pattern.
    """
    
    def __init__(self, session: Session):
        self.session = session
    
    async def handle(
        self,
        feed_url: str,
        infospace_id: int,
        user_id: int,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Asset]:
        """
        Handle RSS feed ingestion.
        
        Args:
            feed_url: URL of RSS feed
            infospace_id: Target infospace
            user_id: User ingesting feed
            options: Processing options
            
        Returns:
            List of created article assets
        """
        options = options or {}
        max_items = options.get('max_items', 50)
        
        try:
            feed = feedparser.parse(feed_url)
            
            # Extract feed metadata
            feed_title = feed.feed.get('title', 'RSS Feed')
            feed_metadata = {
                'feed_title': feed_title,
                'feed_url': feed_url,
                'feed_description': feed.feed.get('description', ''),
                'feed_language': feed.feed.get('language', ''),
                'feed_updated': feed.feed.get('updated', ''),
                'feed_generator': feed.feed.get('generator', ''),
            }
            
            logger.info(f"Processing RSS feed '{feed_title}' with {len(feed.entries[:max_items])} entries")
            
            articles = []
            
            # Process each entry
            for i, entry in enumerate(feed.entries[:max_items]):
                try:
                    article = await (AssetBuilder(self.session, user_id, infospace_id)
                        .from_rss_entry(entry, feed_url, i)
                        .as_kind(AssetKind.ARTICLE)
                        .build())
                    
                    # Add feed metadata
                    if article.source_metadata:
                        article.source_metadata.update(feed_metadata)
                        self.session.add(article)
                    
                    articles.append(article)
                    logger.debug(f"Created article: {article.title}")
                    
                except Exception as e:
                    logger.error(f"Failed to process RSS entry {i}: {e}")
                    continue
            
            self.session.commit()
            logger.info(f"RSS feed processing completed: {len(articles)} articles created from '{feed_title}'")
            return articles
            
        except ImportError:
            raise ValueError("feedparser library not installed. Install with: pip install feedparser")
        except Exception as e:
            raise ValueError(f"RSS feed processing failed: {e}")

