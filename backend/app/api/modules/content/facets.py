"""
Asset Facets and file_info
==========================

Well-known keys in asset.facets (enrichment-discovered) and asset.file_info (intrinsic).

Facets enable: spatial queries, language filtering, summaries, quality scores.
Data can come from Phase 1 extraction, Phase 2 processing, Phase 3 enrichment,
or annotation promotion. file_info holds intrinsic file properties (size, mime_type, etc.).
"""

from typing import Any, Dict, Optional

# ─────────────────────────────────────────────────────────────────────────────
# Well-known facet keys (asset.facets)
# ─────────────────────────────────────────────────────────────────────────────

# Location (from EXIF, geocoded annotation, or manual)
FACET_LOCATION_LAT = "location_lat"
FACET_LOCATION_LON = "location_lon"
FACET_LOCATION = "location"  # Human-readable: "Berlin, Germany"

# Content
FACET_LANGUAGE = "language"  # ISO 639-1: "de", "en"
FACET_SUMMARY = "summary"
FACET_TAGS = "tags"  # Optional list

# Processing
FACET_OCR_USED = "ocr_used"
FACET_OCR_ENGINE = "ocr_engine"
FACET_OCR_CONFIDENCE = "ocr_confidence"
FACET_OCR_FAILED = "ocr_failed"  # Set when OCR attempt failed; prevents infinite re-dispatch
FACET_QUALITY_SCORE = "quality_score"

# File (in asset.file_info)
FACET_FILE_SIZE = "file_size"  # bytes
FACET_MIME_TYPE = "mime_type"

# Content hash (first-class Asset column; used for change detection)
CONTENT_HASH_FIELD = "content_hash"


def get_facet(facets: Optional[Dict[str, Any]], key: str) -> Any:
    """Get a facet value from asset.facets (flat dict)."""
    if not facets:
        return None
    return facets.get(key)


def set_facet(facets: Dict[str, Any], key: str, value: Any) -> None:
    """Set a facet value in asset.facets (mutates in place)."""
    facets[key] = value


# Mapping from annotation field names to facet keys (for promotion)
ANNOTATION_FIELD_TO_FACET = {
    "location": FACET_LOCATION,
    "location_lat": FACET_LOCATION_LAT,
    "location_lon": FACET_LOCATION_LON,
    "language": FACET_LANGUAGE,
    "summary": FACET_SUMMARY,
    "tags": FACET_TAGS,
}


def build_facet_filter(language: Optional[str] = None, **facets_kwargs) -> Dict[str, Any]:
    """
    Build a JSONB filter for facet queries.
    Usage: WHERE facets @> build_facet_filter(language='de')::jsonb
    Returns flat dict for direct containment on the facets column.
    """
    facets: Dict[str, Any] = {}
    if language is not None:
        facets[FACET_LANGUAGE] = language
    for k, v in facets_kwargs.items():
        if v is not None:
            facets[k] = v
    return facets


def merge_facets(session, asset_id: int, patch: dict) -> None:
    """
    Atomically merge key-value pairs into asset.metadata (facets) using SQL jsonb concat.

    INVARIANT: All facet values must be scalars (str, int, float, bool, None) or flat lists.
    The || operator does shallow merge; nested dicts would be replaced, not deep-merged.
    This function bypasses ORM dirty-tracking; do not mix with ORM attribute writes
    to asset.facets in the same flush cycle.

    When you must also write to the same asset via ORM (e.g. asset.text_content = x),
    call expire_asset_facets(session, asset) after merge_facets to avoid overwriting
    the metadata column with stale ORM cache on commit.
    """
    import json as _json
    from sqlalchemy import text as _text

    for k, v in patch.items():
        if isinstance(v, dict):
            raise ValueError(
                f"merge_facets: nested dict for key '{k}' is not allowed. "
                "Facets must be scalar values. Use set_facet() for ORM-level writes."
            )

    # Use CAST('{}' AS jsonb) instead of '{}'::jsonb to avoid :: parsed as bind param by SQLAlchemy
    session.execute(
        _text("UPDATE asset SET metadata = COALESCE(metadata, CAST('{}' AS jsonb)) || CAST(:patch AS jsonb) WHERE id = :id"),
        {"patch": _json.dumps(patch), "id": asset_id},
    )


def expire_asset_facets(session, asset: Any) -> None:
    """
    Expire the asset's facets attribute so the next access reloads from DB.

    Call after merge_facets when you will also do ORM writes to the same asset
    (e.g. asset.text_content = x) in the same transaction. Prevents the ORM
    from overwriting the metadata column with stale cache on commit.
    """
    if asset is not None and asset in session:
        session.expire(asset, ["facets"])
