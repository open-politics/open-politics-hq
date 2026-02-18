"""
Content Type Registry
=====================

Central registry for content type configuration. Single source of truth for:
- Extension to AssetKind mapping
- Which kinds are importable, processable, containers
- Processor class per kind
- Metadata extractors (for Phase 1 pipeline)

All scattered definitions (FILE_EXTENSION_MAP, PROCESSABLE_KINDS, importable_extensions(),
Asset.is_container, etc.) become derived views from this registry.
"""

from dataclasses import dataclass, field
from typing import FrozenSet, List, Optional, Set, Tuple, Type, TypeVar

from app.api.content.models import Asset, AssetKind, Modality

# Import base only to avoid circular dependency; concrete processors registered lazily
from app.api.content.processors.base import BaseProcessor, ProcessingContext

# Type for metadata extractors (Phase 1 pipeline - defined later)
MetadataExtractorT = TypeVar("MetadataExtractorT")


@dataclass
class ContentTypeDescriptor:
    """Everything the system knows about a content type."""

    kind: AssetKind
    extensions: FrozenSet[str]
    importable: bool = True
    is_container: bool = False
    child_kind: Optional[AssetKind] = None
    processor_class: Optional[Type[BaseProcessor]] = None
    metadata_extractors: List[Type] = field(default_factory=list)
    category: str = "document"  # document, media, data, email, archive
    # Override importable extensions when only some extensions are importable (e.g. FILE has .json only)
    importable_extensions: Optional[FrozenSet[str]] = None
    # Heavy processing: PDF/CSV take longer; used by ProcessingStrategy for immediate vs background
    is_heavy_processing: bool = False
    # Modalities this kind can support (discovered during processing; e.g. PDF can be text or image-dominant)
    supported_modalities: Tuple[Modality, ...] = (Modality.TEXT,)  # Default for text-based kinds


class ContentTypeRegistry:
    """Registry of content types. Derived views replace scattered constants."""

    def __init__(self):
        self._by_kind: dict[AssetKind, ContentTypeDescriptor] = {}
        self._extension_to_descriptor: dict[str, ContentTypeDescriptor] = {}
        self._extension_processor_override: dict[str, Type[BaseProcessor]] = {}
        self._register_builtin()

    def _register(self, descriptor: ContentTypeDescriptor) -> None:
        self._by_kind[descriptor.kind] = descriptor
        for ext in descriptor.extensions:
            self._extension_to_descriptor[ext.lower()] = descriptor

    def _register_builtin(self) -> None:
        # Import processors here to avoid circular imports at module load
        from app.api.content.processors.csv_processor import CSVProcessor
        from app.api.content.processors.excel_processor import ExcelProcessor
        from app.api.content.processors.pdf_processor import PDFProcessor
        from app.api.content.processors.web_processor import WebProcessor

        descriptors = [
            # Documents
            ContentTypeDescriptor(
                kind=AssetKind.PDF,
                extensions=frozenset({".pdf"}),
                importable=True,
                is_container=True,
                child_kind=AssetKind.PDF_PAGE,
                processor_class=PDFProcessor,
                category="document",
                is_heavy_processing=True,
                supported_modalities=(Modality.TEXT, Modality.IMAGE),  # Pages can be text or image-dominant
            ),
            ContentTypeDescriptor(
                kind=AssetKind.TEXT,
                extensions=frozenset({".txt", ".md"}),
                importable=True,
                is_container=False,
                category="document",
            ),
            ContentTypeDescriptor(
                kind=AssetKind.FILE,
                extensions=frozenset({".doc", ".docx", ".json", ".zip", ".tar", ".gz"}),
                importable_extensions=frozenset({".json"}),
                is_container=False,
                category="document",
            ),
            # Data - CSVProcessor for .csv; ExcelProcessor for .xlsx/.xls via extension override
            ContentTypeDescriptor(
                kind=AssetKind.CSV,
                extensions=frozenset({".csv", ".xlsx", ".xls"}),
                importable=True,
                is_container=True,
                child_kind=AssetKind.CSV_ROW,
                processor_class=CSVProcessor,
                category="data",
                is_heavy_processing=True,
            ),
            # Excel uses CSV kind but ExcelProcessor; register extension override
            ContentTypeDescriptor(
                kind=AssetKind.IMAGE,
                extensions=frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"}),
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
            ),
            ContentTypeDescriptor(
                kind=AssetKind.RSS_FEED,
                extensions=frozenset(),
                importable=False,
                is_container=True,
                category="document",
            ),
            ContentTypeDescriptor(
                kind=AssetKind.WEB,
                extensions=frozenset(),
                importable=False,
                is_container=True,
                processor_class=WebProcessor,
                category="document",
            ),
        ]

        for d in descriptors:
            self._register(d)

        # ExcelProcessor: .xlsx/.xls use CSV kind but ExcelProcessor (extension override)
        self._extension_processor_override[".xlsx"] = ExcelProcessor
        self._extension_processor_override[".xls"] = ExcelProcessor

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
        """AssetKinds that have processors and need content processing."""
        return frozenset(
            d.kind for d in self._by_kind.values() if d.processor_class is not None
        )

    def is_container(self, kind: AssetKind) -> bool:
        """Check if this kind can have child assets."""
        desc = self.by_kind(kind)
        return desc.is_container if desc else False

    def get_processor_class(self, asset: Asset) -> Optional[Type[BaseProcessor]]:
        """
        Get processor class for an asset.
        Priority: extension override (e.g. ExcelProcessor for xlsx/xls) then kind.
        """
        import os

        if asset.blob_path:
            ext = os.path.splitext(asset.blob_path)[1].lower()
            if ext in self._extension_processor_override:
                return self._extension_processor_override[ext]
        desc = self.by_kind(asset.kind)
        return desc.processor_class if desc else None

    def get_processor(self, asset: Asset, context: ProcessingContext) -> Optional[BaseProcessor]:
        """Get instantiated processor for an asset."""
        cls = self.get_processor_class(asset)
        return cls(context) if cls else None


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


# Backward compatibility: dict/set views matching old FILE_EXTENSION_MAP and PROCESSABLE_KINDS
FILE_EXTENSION_MAP: dict = {}
PROCESSABLE_KINDS: set = set()


def _init_backward_compat() -> None:
    """Populate backward-compat views (called after registry init)."""
    global FILE_EXTENSION_MAP, PROCESSABLE_KINDS
    FILE_EXTENSION_MAP = {
        ext: desc.kind for ext, desc in _registry._extension_to_descriptor.items()
    }
    PROCESSABLE_KINDS = set(_registry.processable_kinds())


_init_backward_compat()
