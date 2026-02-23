"""
Source Metadata Facets
======================

Well-known keys in source_metadata for queryable content facets.
Facets live under source_metadata.facets (and file.*, processing.* namespaces).

Facets enable: spatial queries, language filtering, summaries, quality scores.
Data can come from Phase 1 extraction, Phase 2 processing, Phase 3 enrichment,
or annotation promotion.
"""

from typing import Any, Dict, Optional

# ─────────────────────────────────────────────────────────────────────────────
# Well-known facet keys (source_metadata.facets.*)
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
FACET_QUALITY_SCORE = "quality_score"

# File (also in source_metadata.file.*)
FACET_FILE_SIZE = "file_size"  # bytes
FACET_MIME_TYPE = "mime_type"

# Content hash (first-class Asset column; used for change detection)
CONTENT_HASH_FIELD = "content_hash"


def get_facet(metadata: Optional[Dict[str, Any]], key: str) -> Any:
    """Get a facet value from source_metadata."""
    if not metadata:
        return None
    facets = metadata.get("facets") or {}
    return facets.get(key)


def set_facet(metadata: Dict[str, Any], key: str, value: Any) -> None:
    """Set a facet value in source_metadata (mutates in place)."""
    if "facets" not in metadata or metadata["facets"] is None:
        metadata["facets"] = {}
    metadata["facets"][key] = value


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
    Usage: WHERE source_metadata @> build_facet_filter(language='de')
    """
    facets: Dict[str, Any] = {}
    if language is not None:
        facets[FACET_LANGUAGE] = language
    for k, v in facets_kwargs.items():
        if v is not None:
            facets[k] = v
    return {"facets": facets} if facets else {}
