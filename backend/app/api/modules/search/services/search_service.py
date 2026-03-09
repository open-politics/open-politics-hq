"""
Search Service
==============

Text and semantic search over assets within an infospace.
Delegates query building to AssetQuery; keeps search history + hybrid merge as its concern.

Used by:
- AssetService.search_assets() — MCP search_assets tool (text, semantic, hybrid)
- ConversationService._tool_search_assets() — legacy tool execution
- tree.py text_search_assets — tree UI multi-phase search (title, bundle, content)

Methods:
- search_assets_text(): Uses AssetQuery with FTS/ILIKE
- search_assets_semantic(): AssetQuery.semantic() + execute_async, fallback to text
- search_assets_tree_text(): Multi-phase search (title → bundle → content) with scoring for tree UI
"""

import logging
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select
from sqlalchemy import func

from app.api.modules.content.query import AssetQuery
from app.models import Asset, Bundle, AssetKind
from app.schemas import AssetRead

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

    def search_assets_tree_text(
        self,
        infospace_id: int,
        user_id: int,
        query: str,
        limit: int = 100,
        asset_kinds: Optional[List[AssetKind]] = None,
        bundle_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Multi-phase text search for tree UI: title → bundle name → content.
        Returns results with scores and match types (title, bundle, content).
        """
        search_term = query.strip().lower()
        if not search_term:
            return {
                "query": query,
                "results": [],
                "total_found": 0,
                "infospace_id": infospace_id,
            }

        logger.info(
            f"Tree text search in infospace {infospace_id}: '{query}' (kinds={asset_kinds}, bundle={bundle_id})"
        )

        base_query = (
            select(Asset)
            .where(Asset.infospace_id == infospace_id)
            .where(Asset.user_id == user_id)
        )

        if asset_kinds:
            base_query = base_query.where(Asset.kind.in_(asset_kinds))

        if bundle_id is not None:
            bundle = self.session.get(Bundle, bundle_id)
            if not bundle or bundle.infospace_id != infospace_id:
                raise ValueError(f"Bundle {bundle_id} not found")
            base_query = base_query.where(Asset.bundle_id == bundle_id)

        # Phase 1: Title matches
        title_query = base_query.where(func.lower(Asset.title).contains(search_term))
        title_matches = list(self.session.exec(title_query).all())

        # Phase 2: Bundle name matches (query by bundle_id to avoid loading bundle.assets)
        bundle_matches: List[tuple] = []
        if not bundle_id:
            matching_bundles = list(
                self.session.exec(
                    select(Bundle)
                    .where(Bundle.infospace_id == infospace_id)
                    .where(func.lower(Bundle.name).contains(search_term))
                ).all()
            )
            for bundle in matching_bundles:
                bundle_asset_query = (
                    select(Asset)
                    .where(Asset.bundle_id == bundle.id)
                    .where(Asset.infospace_id == infospace_id)
                    .where(Asset.user_id == user_id)
                )
                if asset_kinds:
                    bundle_asset_query = bundle_asset_query.where(Asset.kind.in_(asset_kinds))
                for asset in self.session.exec(bundle_asset_query).all():
                    if asset not in title_matches:
                        bundle_matches.append((asset, bundle.name))

        # Phase 3: Fulltext content matches
        found_ids = {a.id for a in title_matches} | {a[0].id for a in bundle_matches}
        content_query = base_query.where(
            Asset.text_content.isnot(None),
            func.lower(Asset.text_content).contains(search_term),
        )
        if found_ids:
            content_query = content_query.where(Asset.id.not_in(found_ids))
        content_matches = list(self.session.exec(content_query).all())

        results: List[Dict[str, Any]] = []

        for asset in title_matches:
            title_lower = (asset.title or "").lower()
            if title_lower == search_term:
                score = 1.0
            elif title_lower.startswith(search_term):
                score = 0.95
            else:
                position = title_lower.find(search_term)
                score = 0.8 + (0.15 * (1 - position / max(len(title_lower), 1)))
            results.append({
                "asset": AssetRead.model_validate(asset),
                "score": score,
                "match_type": "title",
                "match_context": (asset.title or "")[:100],
            })

        for asset, bundle_name in bundle_matches:
            bundle_lower = bundle_name.lower()
            if bundle_lower == search_term:
                score = 0.7
            elif bundle_lower.startswith(search_term):
                score = 0.65
            else:
                score = 0.5
            results.append({
                "asset": AssetRead.model_validate(asset),
                "score": score,
                "match_type": "bundle",
                "match_context": f"In bundle: {bundle_name}",
            })

        for asset in content_matches:
            if not asset.text_content:
                continue
            content_lower = asset.text_content.lower()
            match_pos = content_lower.find(search_term)
            snippet_start = max(0, match_pos - 50)
            snippet_end = min(len(asset.text_content), match_pos + len(search_term) + 50)
            snippet = asset.text_content[snippet_start:snippet_end].strip()
            if snippet_start > 0:
                snippet = "..." + snippet
            if snippet_end < len(asset.text_content):
                snippet = snippet + "..."
            occurrences = content_lower.count(search_term)
            score = min(0.3 + (occurrences * 0.05), 0.5)
            results.append({
                "asset": AssetRead.model_validate(asset),
                "score": score,
                "match_type": "content",
                "match_context": snippet[:200],
            })

        results.sort(key=lambda r: r["score"], reverse=True)
        results = results[:limit]

        logger.info(
            f"Tree text search found {len(results)} results: "
            f"{sum(1 for r in results if r['match_type'] == 'title')} title, "
            f"{sum(1 for r in results if r['match_type'] == 'bundle')} bundle, "
            f"{sum(1 for r in results if r['match_type'] == 'content')} content matches"
        )

        return {
            "query": query,
            "results": results,
            "total_found": len(results),
            "infospace_id": infospace_id,
        }
