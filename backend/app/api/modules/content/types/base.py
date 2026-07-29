"""Content types — the ``@content_type`` decorator and its registry record.

A content type reads like a definition of what it *is* and what it *does*:

    @content_type(kind=AssetKind.PDF, extensions={".pdf"}, is_container=True,
                  child_kind=AssetKind.PDF_PAGE, modalities=[Text, Image])
    class PDF:
        async def metadata(self, asset, storage): ...   # Phase-1 detection (optional)
        async def process(self, context, asset): ...    # extract children (optional)
        def preview(self, asset, children=None): ...     # tree-UI preview (optional)
        async def materialize(self, asset, session, storage): ...  # children→file (optional)

Negative-space: a capability the class doesn't implement simply isn't a method —
there are no ``processor=None`` flags to thread through. The decorator introspects
the class once, binds its methods onto a ``ContentTypeDescriptor`` (the internal
registry record), and registers it. Symmetric with ``@source_type`` on the
sources side.

This module holds the record + decorator only, so per-type files import it
without a cycle through the package ``__init__`` (which imports them to register).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import (
    Any, Awaitable, Callable, Dict, FrozenSet, Iterable, List, Optional, Tuple, Type,
)

from app.api.modules.content.models import Asset, AssetKind, Modality

# Readable modality aliases for the decorator: modalities=[Text, Image].
Text = Modality.TEXT
Image = Modality.IMAGE
Audio = Modality.AUDIO
Video = Modality.VIDEO


@dataclass
class ContentTypeDescriptor:
    """Internal registry record for one content type. Authored via ``@content_type``
    (methods bound from the class) or, transitionally, inline with legacy fields."""

    kind: AssetKind
    extensions: FrozenSet[str] = frozenset()
    mimetypes: FrozenSet[str] = frozenset()
    importable: bool = True
    is_container: bool = False
    child_kind: Optional[AssetKind] = None
    category: str = "document"  # upload-dialog grouping; document/media/data/email/archive
    importable_extensions: Optional[FrozenSet[str]] = None
    # Modalities this kind CAN support, in dominance order (the *possible* set);
    # the processor discovers the *actual* subset and writes Asset.modalities.
    supported_modalities: Tuple[Modality, ...] = (Modality.TEXT,)
    skip_processing: bool = False
    reprocess_strategy: str = "delete_and_recreate"  # or "preserve_children"

    # ── Behaviour, bound from the type class's methods (None == not implemented) ──
    metadata_extractor: Optional[Callable[[Asset, Any], Awaitable[Optional[Dict[str, Any]]]]] = None
    # Content sniff: inspect the first bytes and claim the kind by format signature
    # (bound from the class's optional ``recognizes(head)`` staticmethod).
    recognizer: Optional[Callable[[bytes], bool]] = None
    processor: Optional[Callable[[Any, Asset], Awaitable[List[Asset]]]] = None
    preview: Optional[Callable[..., Dict[str, Any]]] = None
    materializer: Optional[Callable[..., Awaitable[Asset]]] = None

    # ── Transitional: legacy fields for kinds not yet on the class form ──
    # Removed in the final cleanup once every type is a @content_type class.
    processor_class: Optional[Type[Any]] = None
    preview_builder_name: Optional[str] = None
    materializer_class: Optional[Type[Any]] = None
    is_heavy_processing: bool = False
    is_typically_fast: bool = False


# Migrated type classes append their descriptor here on import (@content_type).
_DECLARED: List[ContentTypeDescriptor] = []


def content_type(
    *,
    kind: AssetKind,
    extensions: Iterable[str] = (),
    mimetypes: Iterable[str] = (),
    is_container: bool = False,
    child_kind: Optional[AssetKind] = None,
    modalities: Iterable[Modality] = (Modality.TEXT,),
    importable: Optional[bool] = None,
    importable_extensions: Optional[Iterable[str]] = None,
    category: str = "document",
    skip_processing: bool = False,
    reprocess: str = "delete_and_recreate",
):
    """Declare a content type. The decorated class's methods are its behaviour;
    whichever of ``metadata`` / ``process`` / ``preview`` / ``materialize`` it
    defines get bound onto the descriptor. ``importable`` defaults to
    "has extensions"."""

    exts = frozenset(extensions)
    mts = frozenset(mimetypes)

    def decorator(cls):
        impl = cls()  # stateless singleton; methods may call each other / helpers
        _DECLARED.append(ContentTypeDescriptor(
            kind=kind,
            extensions=exts,
            mimetypes=mts,
            is_container=is_container,
            child_kind=child_kind,
            category=category,
            importable=bool(exts) if importable is None else importable,
            importable_extensions=frozenset(importable_extensions) if importable_extensions is not None else None,
            supported_modalities=tuple(modalities),
            skip_processing=skip_processing,
            reprocess_strategy=reprocess,
            metadata_extractor=getattr(impl, "metadata", None),
            recognizer=getattr(impl, "recognizes", None),
            processor=getattr(impl, "process", None),
            preview=getattr(impl, "preview", None),
            materializer=getattr(impl, "materialize", None),
        ))
        return cls

    return decorator


def consume_declared() -> List[ContentTypeDescriptor]:
    """Descriptors registered via @content_type (the migrated type classes)."""
    return list(_DECLARED)


# ── Shared helpers (what ≥2 type classes do identically) ───────────────────────

def excerpt(text: Optional[str], limit: int = 200) -> str:
    """First ``limit`` chars, trimmed, with an ellipsis if truncated."""
    if not text:
        return ""
    head = text[:limit].strip()
    return head + ("…" if len(text) > limit else "")


def order_modalities(present: Iterable, supported: Tuple[Modality, ...]) -> List[str]:
    """Order the discovered modalities by the descriptor's dominance order."""
    present_vals = {m.value if isinstance(m, Modality) else m for m in present}
    return [m.value for m in supported if m.value in present_vals]


def article_preview(asset, children=None) -> Dict[str, Any]:
    """Text-excerpt preview shared by web / article / text kinds."""
    out: Dict[str, Any] = {}
    if asset.text_content:
        out["excerpt"] = excerpt(asset.text_content)
        out["word_count"] = len(asset.text_content.split())
    if asset.source_identifier and str(asset.source_identifier).startswith(("http://", "https://")):
        out["url"] = asset.source_identifier
    if asset.event_timestamp:
        out["published"] = asset.event_timestamp.isoformat()
    return out
