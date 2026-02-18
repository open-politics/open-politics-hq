"""
Enricher Registry
=================

Provider-gated enrichment descriptors. Enrichers backfill missing data (geocoding, OCR,
embedding) when the corresponding Foundation provider is configured. Dispatched via
ReactiveWatchers; batch_enrich uses task_name to dispatch Celery tasks.
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Set

from app.models import Asset, AssetKind

from .facets import FACET_LOCATION_LAT

logger = logging.getLogger(__name__)


@dataclass
class Enricher:
    """
    Enricher descriptor: name, target facet, applicable kinds, Celery task, optional provider.

    Provider-gated enrichers only run when the Foundation provider is configured.
    Watchers find work; tasks use task_context(providers=[...]) to obtain the provider.
    """

    name: str
    target_facet: str
    applicable_kinds: Set[AssetKind]  # Empty = all kinds
    task_name: str  # Celery task name, e.g. "enrich_geocoding"
    required_provider: Optional[str] = None  # e.g. "geocoding"; None = no provider gate


ENRICHER_REGISTRY: Dict[str, Enricher] = {}


def register_enricher(enricher: Enricher) -> None:
    """Register an enricher by name."""
    ENRICHER_REGISTRY[enricher.name] = enricher


def get_enricher(name: str) -> Optional[Enricher]:
    """Get enricher by name."""
    return ENRICHER_REGISTRY.get(name)


def get_applicable_enrichers(asset: Asset) -> List[Enricher]:
    """
    Return enrichers that apply to this asset.
    Used for batch_enrich allowlist validation; watchers define their own queries.
    """
    result = []
    for enricher in ENRICHER_REGISTRY.values():
        if not enricher.applicable_kinds or asset.kind in enricher.applicable_kinds:
            result.append(enricher)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Built-in enrichers (provider-gated, watcher-dispatched)
# ─────────────────────────────────────────────────────────────────────────────

register_enricher(
    Enricher(
        name="geocoding",
        target_facet=FACET_LOCATION_LAT,
        applicable_kinds=set(),
        task_name="enrich_geocoding",
        required_provider="geocoding",
    )
)
