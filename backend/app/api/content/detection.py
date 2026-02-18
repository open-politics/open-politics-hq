"""
Content Detection
=================

Flat checks to reclassify asset kind based on extracted metadata.
Called after Phase 1 metadata extraction, before Phase 2 content processing.
"""

from typing import Any, Dict, Optional

from app.models import Asset, AssetKind


def detect_content_kind(asset: Asset, metadata: Dict[str, Any]) -> Optional[AssetKind]:
    """
    Check if asset should be reclassified based on extracted metadata.
    Returns new kind, or None to keep current.

    Add a detection: add an if block.

    Per Foundation: A PDF with scanned pages is still a PDF. Processing discovers
    that its pages are image-dominant; it does not reclassify the PDF.
    """
    # Magic bytes disagree with extension
    detected_mime = metadata.get("detected_mime")
    mime_type = metadata.get("mime_type")
    if detected_mime and mime_type and detected_mime != mime_type:
        guessed = _kind_from_mime(detected_mime)
        if guessed and guessed != asset.kind:
            return guessed

    return None


def _kind_from_mime(mime: str) -> Optional[AssetKind]:
    """Map MIME type to AssetKind."""
    m = mime.lower()
    if "pdf" in m:
        return AssetKind.PDF
    if "image" in m or "jpeg" in m or "png" in m or "gif" in m:
        return AssetKind.IMAGE
    if "text" in m and "csv" not in m:
        return AssetKind.TEXT
    if "csv" in m or "spreadsheet" in m:
        return AssetKind.CSV
    if "html" in m or "xml" in m:
        return AssetKind.WEB
    return None
