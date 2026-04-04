"""
Pure serialization functions: domain model → canonical dict.

No I/O, no file handling, no DB access. Blob and text file references are
pre-resolved by the caller (PackageBuilder) and passed as zip path strings.

These functions are the single source of truth for how each entity type
becomes a dict in a DataPackage manifest.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ─── Helpers ───


_KIND_EXTENSIONS = {
    "pdf": ".pdf", "pdf_page": ".pdf", "csv": ".csv", "csv_row": ".csv",
    "image": ".png", "web": ".html", "article": ".html", "markdown": ".md",
    "text": ".txt", "json": ".json", "email": ".eml", "mbox": ".mbox",
    "docx": ".docx", "xlsx": ".xlsx", "pptx": ".pptx",
}


def _resolve_original_filename(asset) -> str:
    """Best-effort original filename from an Asset model, always with extension."""
    info = asset.file_info or {}
    name = (
        info.get("original_filename")
        or info.get("filename")
        or asset.title
        or (Path(asset.blob_path).name if asset.blob_path else None)
        or f"asset_{asset.uuid}"
    )
    # Ensure the filename has an extension
    if name and "." not in Path(name).suffix:
        kind_str = asset.kind.value if hasattr(asset.kind, "value") else str(asset.kind or "")
        ext = _KIND_EXTENSIONS.get(kind_str, "")
        if ext:
            name = f"{name}{ext}"
    return name


def _make_asset_ref(asset) -> Dict[str, Any]:
    """Compact reference dict for cross-entity pointers."""
    return {"uuid": str(asset.uuid), "id": asset.id, "title": asset.title}


def _make_schema_ref(schema) -> Dict[str, Any]:
    """Compact reference dict for schema cross-pointers."""
    return {
        "uuid": str(schema.uuid),
        "id": schema.id,
        "name": schema.name,
        "version": schema.version,
    }


# ─── Per-type serializers ───


def serialize_asset(
    asset,
    *,
    blob_ref: Optional[str] = None,
    text_ref: Optional[str] = None,
    include_text_inline: bool = True,
    text_size_threshold: int = 5000,
    include_annotations: bool = False,
    annotations: Optional[List[Dict[str, Any]]] = None,
    include_parent_info: bool = True,
    parent_asset: Optional[Any] = None,
) -> Dict[str, Any]:
    """Asset → canonical dict for manifest.

    Args:
        asset: Asset SQLModel instance.
        blob_ref: Pre-resolved zip path for the blob file (or None if not fetched).
        text_ref: Pre-resolved zip path for large text content (or None).
        include_text_inline: Whether to inline short text content.
        text_size_threshold: Max chars for inline text (larger → file ref).
        include_annotations: Whether to include the annotations list.
        annotations: Pre-serialized annotation dicts.
        include_parent_info: Whether to include parent_asset_id/part_index.
    """
    from app.schemas import AssetRead

    data = AssetRead.model_validate(asset).model_dump(exclude_none=True)

    # Text content: always include in manifest for round-trip fidelity.
    # The files/ directory is for original source documents (blobs) only —
    # text content lives in the manifest, not as separate .txt files.
    data.pop("text_content", None)
    if include_text_inline and asset.text_content:
        data["text_content"] = asset.text_content

    # Blob file reference
    if blob_ref:
        data["blob_file_reference"] = blob_ref

    # Parent-child hierarchy
    if include_parent_info and asset.parent_asset_id:
        data["parent_asset_id"] = asset.parent_asset_id
        data["part_index"] = asset.part_index
        # Include parent UUID + title for cross-reference in CSVs
        if parent_asset:
            data["parent_asset_uuid"] = str(parent_asset.uuid)
            data["parent_title"] = parent_asset.title

    # Annotations
    if include_annotations and annotations:
        data["annotations"] = annotations

    return data


def serialize_annotation(
    ann,
    *,
    include_justifications: bool = True,
    justifications: Optional[list] = None,
    asset_ref: Optional[Dict[str, Any]] = None,
    schema_ref: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Annotation → canonical dict.

    Args:
        ann: Annotation SQLModel instance.
        include_justifications: Whether to include justifications.
        justifications: Pre-fetched Justification instances (or None to use ann.justifications).
        asset_ref: Pre-built asset reference dict (from _make_asset_ref).
        schema_ref: Pre-built schema reference dict (from _make_schema_ref).
    """
    data = ann.model_dump(exclude_none=True, exclude={"justifications"})

    if include_justifications:
        justs = justifications if justifications is not None else (
            ann.justifications if hasattr(ann, "justifications") and ann.justifications else []
        )
        if justs:
            data["justifications"] = [j.model_dump(exclude_none=True) for j in justs]

    if asset_ref:
        data["asset_reference"] = asset_ref
    if schema_ref:
        data["schema_reference"] = schema_ref

    return data


def serialize_schema(schema) -> Dict[str, Any]:
    """AnnotationSchema → canonical dict."""
    return schema.model_dump(exclude_none=True)


def serialize_run(
    run,
    *,
    schema_dicts: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """AnnotationRun → canonical dict (without annotations — those are separate).

    Args:
        run: AnnotationRun SQLModel instance.
        schema_dicts: Pre-serialized schema dicts. If None, serializes from run.target_schemas.
    """
    data = run.model_dump(exclude_none=True, exclude={"annotations", "target_schemas"})

    if hasattr(run, "views_config") and run.views_config:
        data["views_config"] = run.views_config

    if schema_dicts is not None:
        data["annotation_schemas"] = schema_dicts
    else:
        data["annotation_schemas"] = [
            serialize_schema(s) for s in (run.target_schemas or [])
        ]

    return data


def serialize_bundle(
    bundle,
    *,
    asset_refs: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Bundle → canonical dict.

    Args:
        bundle: Bundle SQLModel instance.
        asset_refs: List of compact asset reference dicts for assets in this bundle.
    """
    data = bundle.model_dump(exclude_none=True, exclude={"assets"})

    if asset_refs is not None:
        data["asset_references"] = asset_refs

    return data
