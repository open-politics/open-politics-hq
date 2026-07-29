"""Asset evaluation context for flow FILTER/ROUTE steps.

Flattens an Asset (plus, optionally, its annotations) into a dict that
``FilterExpression.evaluate()`` can read. This is the *in-memory twin* of the SQL
pushdown in ``flow/services/filter_service._expression_to_asset_query`` — the fallback
taken when an expression can't be translated (OR, sub-expressions, non-whitelisted
fields). The two must agree on field names, so keep them in sync.

Four independent layers, each a plain function over an Asset, plus a composition. They
are separate so a caller that needs only one — a preview, a rule editor, a debug view —
can take it without dragging in the annotation query or the session it needs.
"""

from __future__ import annotations

import enum
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from app.api.modules.content.models import Asset

logger = logging.getLogger(__name__)

# NOTE: there is no relationship skip-set here any more. The old one listed ten
# relationship names to "avoid lazy loads", but SQLModel `Relationship()` fields never
# appear in `model_fields`, so it never skipped anything — and it had gone stale on top
# of that, listing `bundle`, which stopped being an Asset attribute when membership
# became the `bundle_ids` array. Introspecting `model_fields` is already columns-only.

_TEXT_PREVIEW_CHARS = 500


def asset_fields(asset: Asset) -> Dict[str, Any]:
    """Layer 1 — the Asset's own columns, JSON-shaped.

    ``text_content`` is deliberately included in full: the SQL pushdown whitelists it,
    so dropping it here would make a `text_content` filter behave differently depending
    on whether the expression happened to be translatable.
    """
    out: Dict[str, Any] = {}
    for name in Asset.model_fields:
        val = getattr(asset, name, None)
        if isinstance(val, datetime):
            out[name] = val.isoformat()
        elif isinstance(val, enum.Enum):
            out[name] = val.value
        elif isinstance(val, (dict, list, str, int, float, bool, type(None))):
            out[name] = val
    return out


def facet_fields(asset: Asset) -> Dict[str, Any]:
    """Layer 2 — the two JSONB bags by name, plus cheap text derivations."""
    text = asset.text_content or ""
    return {
        "facets": asset.facets or {},
        "file_info": asset.file_info or {},
        "text_preview": text[:_TEXT_PREVIEW_CHARS],
        "text_length": len(text),
    }


def fragment_fields(asset: Asset) -> Dict[str, Any]:
    """Layer 3 — curated fragments, wholesale and flattened as ``fragment_<key>``."""
    frags = asset.fragments or {}
    out: Dict[str, Any] = {"fragments": frags}
    for key, val in frags.items():
        out[f"fragment_{key}"] = val.get("value", val) if isinstance(val, dict) else val
    return out


def annotation_fields(
    session: Session, asset_id: int, run_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """Layer 4 — merged annotation values from the given runs.

    Returns ``{"annotations": {...}, "annotation_count": N}``. The flat merge is applied
    by ``build_asset_context``, which is where collisions with asset columns are
    resolved — this function just reports what the runs produced.
    """
    if not run_ids:
        return {"annotations": {}, "annotation_count": 0}

    from app.api.modules.annotation.models import Annotation

    rows = session.exec(
        select(Annotation).where(
            Annotation.asset_id == asset_id,
            Annotation.run_id.in_(run_ids),
        )
    ).all()
    values: Dict[str, Any] = {}
    for ann in rows:
        if ann.value:
            values.update(ann.value)
    return {"annotations": values, "annotation_count": len(rows)}


def build_asset_context(
    session: Session,
    asset: Asset,
    annotation_run_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """Compose the four layers into one evaluation context.

    Annotation values are ALSO exposed flat, so a rule can say ``sentiment > 0.5``
    rather than ``annotations.sentiment``. They no longer overwrite asset columns
    though: an annotation field named ``title`` or ``kind`` used to silently shadow the
    asset's own value, which is never what a rule author means. On collision the asset
    wins and the annotation stays reachable under ``annotations.<field>``.
    """
    context = asset_fields(asset)
    context.update(facet_fields(asset))
    context.update(fragment_fields(asset))

    ann = annotation_fields(session, asset.id, annotation_run_ids)
    context["annotations"] = ann["annotations"]
    context["annotation_count"] = ann["annotation_count"]

    for key, val in ann["annotations"].items():
        if key in context:
            logger.debug(
                "annotation field %r shadows an asset field on asset %s; "
                "the asset value wins — use annotations.%s for the annotation",
                key, asset.id, key,
            )
            continue
        context[key] = val

    return context
