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

from .facets import FACET_LOCATION_LAT, FACET_OCR_USED, FACET_OCR_FAILED, CONTENT_HASH_FIELD, FACET_QUALITY_SCORE

logger = logging.getLogger(__name__)


@dataclass
class Enricher:
    """
    Enricher descriptor: name, target facet, applicable kinds, Celery task, optional provider.

    Provider-gated enrichers only run when the Foundation provider is configured.
    Watchers find work; tasks use task_context(providers=[...]) to obtain the provider.

    Watcher-generation fields (for EnricherWatcher auto-generation):
    - requires_field: Asset column that must exist (e.g. "text_content"); None = no gate
    - missing_check: metadata/facets key that must be NULL for dispatch (e.g. "language")
    - requires_modality: positive predicate, asset must have this in discovered_modalities (e.g. "image" for OCR)
    - depends_on: name of another watcher for ordering
    - batch_size: max IDs per task
    - event_trigger: event name for immediate dispatch when bus is live (optional)
    """

    name: str
    target_facet: str
    applicable_kinds: Set[AssetKind]  # Empty = all kinds
    task_name: str  # Celery task name, e.g. "enrich_geocoding"
    capability: Optional[str] = None  # e.g. "geocoding"; None = no provider gate
    requires_field: Optional[str] = None
    missing_check: Optional[str] = None
    requires_modality: Optional[str] = None
    requires_facet: Optional[str] = None  # metadata key that must be present (e.g. "location" for geocoding)
    exclude_when_facet: Optional[str] = None  # skip dispatch when this facet is set (e.g. "ocr_failed")
    depends_on: Optional[str] = None
    batch_size: int = 50
    event_trigger: Optional[str] = None
    top_level_only: bool = False
    children_only: bool = False


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
        capability="geocoding",
        requires_facet="location",
        missing_check="location_lat",
        batch_size=20,
    )
)

register_enricher(
    Enricher(
        name="ocr",
        target_facet=FACET_OCR_USED,
        applicable_kinds={AssetKind.PDF_PAGE},
        task_name="enrich_ocr",
        capability="ocr",
        requires_modality="image",
        missing_check="ocr_used",
        exclude_when_facet=FACET_OCR_FAILED,  # Stop re-dispatch after OCR failure
        batch_size=10,
        children_only=True,
        event_trigger="asset.processed",
    )
)

register_enricher(
    Enricher(
        name="hash",
        target_facet=CONTENT_HASH_FIELD,
        applicable_kinds=set(),
        task_name="enrich_file_hash",
        capability="storage",
        requires_field="blob_path",
        missing_check="content_hash",
        batch_size=50,
        top_level_only=True,
        event_trigger="asset.processed",
    )
)

register_enricher(
    Enricher(
        name="language_detection",
        target_facet="language",
        applicable_kinds=set(),
        task_name="enrich_language",
        capability=None,
        requires_field="text_content",
        missing_check="language",
        batch_size=50,
        event_trigger="asset.processed",
    )
)

register_enricher(
    Enricher(
        name="quality_score",
        target_facet=FACET_QUALITY_SCORE,
        applicable_kinds=set(),
        task_name="enrich_quality_score",
        capability=None,
        requires_field="text_content",
        missing_check="quality_score",
        batch_size=50,
        event_trigger="asset.processed",
    )
)
