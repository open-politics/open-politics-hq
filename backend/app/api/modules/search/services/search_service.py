"""
Search Service
==============

Text and semantic search over assets within an infospace.

Used by:
- AssetService.search_assets() — MCP search_assets tool (text, semantic, hybrid)
- ConversationService._tool_search_assets() — legacy tool execution

Methods:
- search_assets_text(): ILIKE on title/text_content, optional kind/bundle/parent filters
- search_assets_semantic(): VectorSearchService embeddings, falls back to text on failure
"""

import logging
from typing import Any, Dict, List

from sqlmodel import Session, select, and_, or_

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

        Used by: ConversationService MCP search_assets tool, AssetService
        """
        asset_kinds = options.get('asset_kinds', [])
        parent_asset_id = options.get('parent_asset_id')
        bundle_id = options.get('bundle_id')

        query_conditions = [Asset.infospace_id == infospace_id]

        if query:
            search_condition = or_(
                Asset.title.ilike(f"%{query}%"),
                Asset.text_content.ilike(f"%{query}%")
            )
            query_conditions.append(search_condition)

        if asset_kinds:
            kind_conditions = [
                Asset.kind == AssetKind(kind)
                for kind in asset_kinds
                if kind in AssetKind.__members__
            ]
            if kind_conditions:
                query_conditions.append(or_(*kind_conditions))

        if parent_asset_id:
            query_conditions.append(Asset.parent_asset_id == parent_asset_id)

        if bundle_id:
            query_conditions.append(Asset.bundle_id == bundle_id)

        assets = self.session.exec(
            select(Asset)
            .where(and_(*query_conditions))
            .order_by(Asset.created_at.desc())
            .limit(limit)
        ).all()

        return list(assets)

    async def search_assets_semantic(
        self,
        query: str,
        infospace_id: int,
        limit: int,
        options: Dict[str, Any]
    ) -> List[Asset]:
        """
        Semantic search using embeddings.

        Used by: AssetService search_assets method for semantic/hybrid search
        """
        try:
            from app.api.embedding.services import VectorSearchService

            runtime_api_keys = options.get('runtime_api_keys')

            search_service = VectorSearchService(
                self.session, runtime_api_keys=runtime_api_keys
            )
            search_results = await search_service.semantic_search(
                query_text=query,
                infospace_id=infospace_id,
                limit=limit,
                asset_kinds=options.get('asset_kinds'),
                distance_threshold=options.get('distance_threshold', 0.8)
            )

            asset_ids = list(set(result.asset_id for result in search_results))

            if not asset_ids:
                return []

            assets = self.session.exec(
                select(Asset)
                .where(Asset.id.in_(asset_ids))
                .where(Asset.infospace_id == infospace_id)
            ).all()

            return list(assets)

        except Exception as e:
            logger.warning(f"Semantic search failed, falling back to text: {e}")
            return await self.search_assets_text(query, infospace_id, limit, options)
