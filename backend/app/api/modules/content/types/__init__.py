"""
Content Type Registry
=====================

Central registry for content type configuration. Single source of truth for:
- Extension to AssetKind mapping
- Which kinds are importable, processable, containers
- Processor class per kind
- Metadata extractors (for Phase 1 pipeline)

All scattered definitions (importable_extensions(),
Asset.is_container, etc.) become derived views from this registry.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, FrozenSet, List, Optional, Protocol, Set, Tuple, Type, TypeVar, runtime_checkable

from app.api.modules.content.models import Asset, AssetKind, Modality
from app.api.modules.foundation_service_providers import StorageProvider

# BaseProcessor/ProcessingContext not imported here to avoid circular dependency:
# types <- processors.base <- processors/__init__ <- strategy <- types
# Concrete processors and base are imported lazily in _register_builtin and get_processor.

# The descriptor record + @content_type decorator live in .base so per-type files
# import them without a cycle through this package init (which imports those files
# to register their classes).
from app.api.modules.content.types.base import (
    ContentTypeDescriptor, content_type, consume_declared, Text, Image, Audio, Video,
    excerpt, order_modalities, article_preview,
)


def _sniff_image(head: bytes) -> bool:
    """Magic-byte check for the common raster formats — the IMAGE kind has no
    class to host a ``recognizes()``, so its sniffer lives here."""
    return (
        head.startswith(b"\x89PNG\r\n\x1a\n")              # PNG
        or head.startswith(b"\xff\xd8\xff")                 # JPEG
        or head[:6] in (b"GIF87a", b"GIF89a")               # GIF
        or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")  # WEBP
        or head.startswith(b"BM")                            # BMP
    )


class ContentTypeRegistry:
    """Registry of content types. Derived views replace scattered constants."""

    def __init__(self):
        self._by_kind: dict[AssetKind, ContentTypeDescriptor] = {}
        self._extension_to_descriptor: dict[str, ContentTypeDescriptor] = {}
        self._mimetype_to_descriptor: dict[str, ContentTypeDescriptor] = {}
        self._sniffers: list[ContentTypeDescriptor] = []
        self._register_builtin()

    def _register(self, descriptor: ContentTypeDescriptor) -> None:
        self._by_kind[descriptor.kind] = descriptor
        for ext in descriptor.extensions:
            self._extension_to_descriptor[ext.lower()] = descriptor
        for mt in descriptor.mimetypes:
            self._mimetype_to_descriptor[mt.lower()] = descriptor
        if descriptor.recognizer is not None:
            self._sniffers.append(descriptor)

    def _register_builtin(self) -> None:
        # Migrated types register themselves via @content_type on import.
        from app.api.modules.content.types import pdf, web_article, csv, archive, rss_feed  # noqa: F401

        descriptors = [
            ContentTypeDescriptor(
                kind=AssetKind.TEXT,
                extensions=frozenset({".txt", ".md"}),
                mimetypes=frozenset({"text/plain", "text/markdown"}),
                importable=True,
                is_container=False,
                category="document",
                preview_builder_name="article",
            ),
            ContentTypeDescriptor(
                kind=AssetKind.FILE,
                extensions=frozenset({".doc", ".docx", ".json"}),  # zip/tar/gz → ARCHIVE type
                importable_extensions=frozenset({".json"}),
                is_container=False,
                category="document",
            ),
            ContentTypeDescriptor(
                kind=AssetKind.IMAGE,
                extensions=frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"}),
                mimetypes=frozenset({"image/jpeg", "image/png", "image/gif",
                                     "image/webp", "image/bmp", "image/svg+xml"}),
                recognizer=_sniff_image,
                importable=True,
                is_container=False,
                category="media",
                supported_modalities=(Modality.IMAGE,),
            ),
            ContentTypeDescriptor(
                kind=AssetKind.VIDEO,
                extensions=frozenset({".mp4", ".avi", ".mov", ".webm"}),
                importable=False,
                is_container=False,
                category="media",
                supported_modalities=(Modality.VIDEO,),
            ),
            ContentTypeDescriptor(
                kind=AssetKind.AUDIO,
                extensions=frozenset({".mp3", ".wav", ".ogg"}),
                supported_modalities=(Modality.AUDIO,),
                importable=False,
                is_container=False,
                category="media",
            ),
            ContentTypeDescriptor(
                kind=AssetKind.MBOX,
                extensions=frozenset({".mbox"}),
                importable=False,
                is_container=True,
                child_kind=AssetKind.EMAIL,
                processor_class=None,  # MBOXProcessor not implemented
                category="email",
            ),
            ContentTypeDescriptor(
                kind=AssetKind.EMAIL,
                extensions=frozenset({".eml"}),
                importable=False,
                is_container=False,
                category="email",
            ),
            # Child/derived kinds (no extensions, not importable)
            ContentTypeDescriptor(
                kind=AssetKind.CSV_ROW,
                extensions=frozenset(),
                importable=False,
                is_container=False,
                category="data",
            ),
            ContentTypeDescriptor(
                kind=AssetKind.PDF_PAGE,
                extensions=frozenset(),
                importable=False,
                is_container=False,
                category="document",
                supported_modalities=(Modality.TEXT, Modality.IMAGE),
            ),
            ContentTypeDescriptor(
                kind=AssetKind.TEXT_CHUNK,
                extensions=frozenset(),
                importable=False,
                is_container=False,
                category="document",
            ),
            ContentTypeDescriptor(
                kind=AssetKind.IMAGE_REGION,
                extensions=frozenset(),
                importable=False,
                is_container=False,
                category="media",
                supported_modalities=(Modality.IMAGE,),
            ),
            ContentTypeDescriptor(
                kind=AssetKind.VIDEO_SCENE,
                extensions=frozenset(),
                importable=False,
                is_container=False,
                category="media",
            ),
            ContentTypeDescriptor(
                kind=AssetKind.AUDIO_SEGMENT,
                extensions=frozenset(),
                importable=False,
                is_container=False,
                category="media",
            ),
            ContentTypeDescriptor(
                kind=AssetKind.ARTICLE,
                extensions=frozenset(),
                importable=False,
                is_container=True,
                category="document",
                preview_builder_name="article",
            ),
        ]

        # Inline legacy descriptors + the @content_type-registered migrated types.
        for d in descriptors + consume_declared():
            self._register(d)

    def by_kind(self, kind: AssetKind) -> Optional[ContentTypeDescriptor]:
        """Get descriptor for an AssetKind."""
        return self._by_kind.get(kind)

    def extension_to_kind(self, file_ext: str) -> AssetKind:
        """Resolve file extension to AssetKind. Returns AssetKind.FILE if unknown."""
        if not file_ext:
            return AssetKind.FILE
        ext = file_ext.lower()
        if not ext.startswith("."):
            ext = f".{ext}"
        desc = self._extension_to_descriptor.get(ext)
        return desc.kind if desc else AssetKind.FILE

    def detect_kind(
        self,
        mimetype: Optional[str] = None,
        head: Optional[bytes] = None,
        filename: Optional[str] = None,
    ) -> AssetKind:
        """The one classifier — resolve a kind from whatever signals exist, in
        confidence order: declared mimetype → content sniff → filename extension →
        FILE. Each signal's data lives on the types themselves (``mimetypes`` /
        ``recognizes`` / ``extensions``); there is no central detection table to
        keep in sync. Generic mimetypes (``application/octet-stream``, a catch-all
        ``text/plain``) are simply left unmapped, so they fall through to the sniff
        or extension that actually knows."""
        # 1. Declared mimetype (drop any "; charset=…" parameter).
        if mimetype:
            mt = mimetype.split(";", 1)[0].strip().lower()
            desc = self._mimetype_to_descriptor.get(mt)
            if desc:
                return desc.kind
        # 2. Content sniff — a format signature in the first bytes (doesn't lie the
        #    way a server-sent mimetype can). First claimant wins.
        if head:
            for desc in self._sniffers:
                try:
                    if desc.recognizer(head):
                        return desc.kind
                except Exception:
                    continue
        # 3. Filename extension.
        if filename and "." in filename:
            kind = self.extension_to_kind("." + filename.rsplit(".", 1)[-1].lower())
            if kind is not AssetKind.FILE:
                return kind
        # 4. Nothing claimed it.
        return AssetKind.FILE

    def importable_extensions(self, categories: Optional[List[str]] = None) -> Set[str]:
        """Extensions that are importable. Optionally filter by category."""
        result: Set[str] = set()
        for desc in self._by_kind.values():
            if categories and desc.category not in categories:
                continue
            if desc.importable_extensions is not None:
                result.update(desc.importable_extensions)
            elif desc.importable and desc.extensions:
                result.update(desc.extensions)
        return result

    def processable_kinds(self) -> FrozenSet[AssetKind]:
        """AssetKinds that have a processor (migrated callable or legacy class)."""
        return frozenset(
            d.kind for d in self._by_kind.values()
            if d.processor is not None or d.processor_class is not None
        )

    def is_container(self, kind: AssetKind) -> bool:
        """Check if this kind can have child assets."""
        desc = self.by_kind(kind)
        return desc.is_container if desc else False

    def container_kinds(self) -> FrozenSet[AssetKind]:
        """Return all AssetKinds that are containers."""
        return frozenset(d.kind for d in self._by_kind.values() if d.is_container)

    def kinds_supporting_modality(
        self, modality: Modality, include_conditional: bool = True
    ) -> FrozenSet[AssetKind]:
        """
        Return kinds that support the given modality.
        include_conditional: if True, include kinds like PDF_PAGE that can be text or image.
        """
        result: Set[AssetKind] = set()
        for desc in self._by_kind.values():
            if modality in desc.supported_modalities:
                result.add(desc.kind)
        return frozenset(result)

    def get_processor_class(self, asset: Asset) -> Optional[Type[Any]]:
        """Legacy processor class for an asset (None for @content_type-migrated kinds)."""
        desc = self.by_kind(asset.kind)
        return desc.processor_class if desc else None

    def get_processor(self, asset: Asset, context: Any) -> Optional[Any]:
        """Get instantiated processor for an asset."""
        cls = self.get_processor_class(asset)
        return cls(context) if cls else None

    def get_preview_builder(self, kind: AssetKind) -> Optional[Callable[..., Dict[str, Any]]]:
        """Get preview builder callable for a kind. Returns None if no preview."""
        desc = self.by_kind(kind)
        if not desc or not desc.preview_builder_name:
            return None
        # Lazy import to avoid circular dependency with tree_renderer
        from app.api.tree_renderer import (
            build_csv_preview,
            build_pdf_preview,
            build_article_preview,
        )
        builders = {
            "csv": build_csv_preview,
            "pdf": build_pdf_preview,
            "article": build_article_preview,
        }
        return builders.get(desc.preview_builder_name)


# Global instance
_registry = ContentTypeRegistry()


def get_content_type_registry() -> ContentTypeRegistry:
    """Get the global content type registry."""
    return _registry


# ─────────────────────────────────────────────────────────────────────────────
# Derived views (drop-in replacements for old constants)
# ─────────────────────────────────────────────────────────────────────────────

def detect_asset_kind_from_extension(file_ext: str) -> AssetKind:
    """Detect AssetKind from file extension. Canonical source of truth."""
    return _registry.extension_to_kind(file_ext)


def detect_kind(
    mimetype: Optional[str] = None,
    head: Optional[bytes] = None,
    filename: Optional[str] = None,
) -> AssetKind:
    """The one content classifier: mimetype → sniff → extension → FILE, off the
    types' own recognition signals. See ``ContentTypeRegistry.detect_kind``. This
    is the seam ``run_ingestion`` calls after fetch for items whose source couldn't
    name the kind at read time."""
    return _registry.detect_kind(mimetype=mimetype, head=head, filename=filename)


def needs_processing(kind: AssetKind) -> bool:
    """Check if an AssetKind requires content processing."""
    return kind in _registry.processable_kinds()


# Default import extensions for directory handler (document + data + media categories)
def importable_extensions(categories: Optional[List[str]] = None) -> Set[str]:
    """Extensions that can be imported. Default: document, data, and media (images)."""
    if categories is None:
        categories = ["document", "data", "media"]
    return _registry.importable_extensions(categories)


# ─────────────────────────────────────────────────────────────────────────────
# URL detection (moved from registry.py)
# ─────────────────────────────────────────────────────────────────────────────

def is_rss_feed_url(url: str) -> bool:
    """Detect if a URL is an RSS/Atom feed."""
    if not url:
        return False
    rss_patterns = [
        "/rss", "/feed", "/atom", ".rss", ".xml",
        "rss.", "feed.", "feeds/", "/feed.xml", "/rss.xml"
    ]
    url_lower = url.lower()
    return any(pattern in url_lower for pattern in rss_patterns)


def is_archive_url(url: str) -> bool:
    """Detect if a URL points to a downloadable archive file."""
    if not url:
        return False
    url_path = url.lower().split("?")[0].split("#")[0]
    archive_extensions = (
        ".zip", ".tar", ".gz", ".tgz", ".tar.gz",
        ".bz2", ".tar.bz2", ".7z", ".rar"
    )
    return url_path.endswith(archive_extensions)


# Default processing limits (used by ProcessingContext)
DEFAULT_MAX_ROWS = 50000
DEFAULT_MAX_PAGES = 1000
DEFAULT_MAX_IMAGES = 8
DEFAULT_TIMEOUT = 30


def get_supported_content_types() -> Dict[str, List[str]]:
    """Get supported content types for UI. Derived from ContentTypeRegistry."""
    result: Dict[str, List[str]] = {}
    for desc in _registry._by_kind.values():
        if desc.extensions:
            exts = (
                desc.importable_extensions
                if desc.importable_extensions is not None
                else desc.extensions
            )
            result.setdefault(desc.category, []).extend(sorted(exts))
    result["web"] = ["http://", "https://"]
    return {k: sorted(set(v)) for k, v in result.items()}


