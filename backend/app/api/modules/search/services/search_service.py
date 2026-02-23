"""
Search Service
==============

Text and semantic search over assets within an infospace.
Delegates query building to AssetQuery; keeps search history + hybrid merge as its concern.

Used by:
- AssetService.search_assets() — MCP search_assets tool (text, semantic, hybrid)
- ConversationService._tool_search_assets() — legacy tool execution

Methods:
- search_assets_text(): Uses AssetQuery with FTS/ILIKE
- search_assets_semantic(): AssetQuery.semantic() + execute_async, fallback to text
"""

import logging
from typing import Any, Dict, List

from sqlmodel import Session

from app.api.modules.content.query import AssetQuery
from app.models import Asset, AssetKind

logger = logging.getLogger(__name__)


class SearchService:
    """Text and semantic search over assets within an infospace."""

    def __init__(self, session: Session):
        self.session = session

    async def search_assets_text(
        self,
        query: str,
        infospace_id: int,
        limit: int,
        options: Dict[str, Any]
    ) -> List[Asset]:
        """
        Text-based search in existing assets.
        Uses AssetQuery with FTS when available, ILIKE fallback.
        """
        asset_kinds = options.get('asset_kinds', [])
        bundle_id = options.get('bundle_id')
        parent_asset_id = options.get('parent_asset_id')

        kinds = [
            AssetKind(k) for k in asset_kinds
            if k in AssetKind.__members__
        ]

        return (
            AssetQuery(self.session, infospace_id)
            .exclude_superseded()
            .text(query, mode="fts")
            .kinds(kinds if kinds else [])
            .bundle(bundle_id)
            .parent_asset(parent_asset_id)
            .sort("relevance" if query else "created_at_desc")
            .paginate(limit=limit)
            .execute()
        )

    async def search_assets_semantic(
        self,
        query: str,
        infospace_id: int,
        limit: int,
        options: Dict[str, Any]
    ) -> List[Asset]:
        """
        Semantic search using embeddings.
        Uses AssetQuery.execute_async() with semantic(); falls back to text on failure.
        """
        try:
            asset_kinds = options.get('asset_kinds', [])
            kinds = [
                AssetKind(k) for k in asset_kinds
                if k in AssetKind.__members__
            ]
            q = (
                AssetQuery(self.session, infospace_id)
                .exclude_superseded()
                .semantic(query, top_k=limit)
                .kinds(kinds if kinds else [])
                .bundle(options.get('bundle_id'))
                .paginate(limit=limit)
            )
            return await q.execute_async()
        except Exception as e:
            logger.warning(f"Semantic search failed, falling back to text: {e}")
            return await self.search_assets_text(query, infospace_id, limit, options)
