"""
Asset evaluation context for flow FILTER/ROUTE steps.

Model-introspected context builder. Cross-cutting composable — aggregates data from
content, annotation, and potentially graph. Lives at api/ toplevel (no domain import).
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
import enum

from sqlmodel import Session, select

from app.api.modules.content.models import Asset


# Relationship fields to skip during introspection (avoid lazy loads)
_ASSET_RELATIONSHIP_FIELDS = frozenset({
    "parent_asset", "children_assets", "previous_asset", "next_versions",
    "infospace", "user", "source", "bundle", "annotations", "chunks",
})


def build_asset_context(
    session: Session,
    asset: Asset,
    annotation_run_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """
    Build complete evaluation context from an asset.
    Introspects Asset model columns. Used by FILTER, ROUTE, and any future step that evaluates conditions.
    """
    context: Dict[str, Any] = {}

    # Layer 1: Scalar columns from Asset model via introspection
    for field_name in Asset.model_fields:
        if field_name in _ASSET_RELATIONSHIP_FIELDS:
            continue
        try:
            val = getattr(asset, field_name, None)
        except Exception:
            continue
        if isinstance(val, datetime):
            context[field_name] = val.isoformat()
        elif isinstance(val, enum.Enum):
            context[field_name] = val.value
        elif isinstance(val, (dict, list, str, int, float, bool, type(None))):
            context[field_name] = val

    # Layer 2: Facets and file_info (model-introspected above; include for explicit access)
    context["facets"] = asset.facets or {}
    context["file_info"] = asset.file_info or {}

    # Convenience: text_preview, text_length (derived from text_content)
    tc = asset.text_content or ""
    context.setdefault("text_preview", tc[:500] if len(tc) > 500 else tc)
    context.setdefault("text_length", len(tc))

    # Layer 3: Fragments -- include wholesale, also unwrap values for flat access
    frags = asset.fragments or {}
    context["fragments"] = frags
    for k, v in frags.items():
        context[f"fragment_{k}"] = v.get("value", v) if isinstance(v, dict) else v

    # Layer 4: Annotation values from specified runs
    if annotation_run_ids:
        from app.api.modules.annotation.models import Annotation
        annotations = session.exec(
            select(Annotation).where(
                Annotation.asset_id == asset.id,
                Annotation.run_id.in_(annotation_run_ids),
            )
        ).all()
        ann_values: Dict[str, Any] = {}
        for ann in annotations:
            if ann.value:
                ann_values.update(ann.value)
        context["annotations"] = ann_values
        context.update(ann_values)

    return context
