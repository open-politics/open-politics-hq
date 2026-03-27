"""
Tests for the ContentTypeRegistry — the routing backbone.

Every kind→processor, extension→kind, and importability decision flows through
this registry. If it's wrong, ingestion routes to the wrong processor, imports
miss valid files, and the tree builder renders garbage.
"""
import pytest

from app.api.modules.content.types import (
    get_content_type_registry,
    detect_asset_kind_from_extension,
    importable_extensions,
    needs_processing,
    is_rss_feed_url,
    is_archive_url,
)
from app.api.modules.content.models import AssetKind


@pytest.fixture(scope="module")
def registry():
    return get_content_type_registry()


# ═══════════════════════════════════════════════════
# Extension → Kind mapping
# ═══════════════════════════════════════════════════

class TestExtensionToKind:

    def test_pdf(self, registry):
        assert registry.extension_to_kind(".pdf") == AssetKind.PDF

    def test_csv(self, registry):
        assert registry.extension_to_kind(".csv") == AssetKind.CSV

    def test_txt(self, registry):
        assert registry.extension_to_kind(".txt") == AssetKind.TEXT

    def test_md(self, registry):
        assert registry.extension_to_kind(".md") == AssetKind.TEXT

    def test_images(self, registry):
        for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]:
            assert registry.extension_to_kind(ext) == AssetKind.IMAGE, f"Failed for {ext}"

    def test_xlsx(self, registry):
        assert registry.extension_to_kind(".xlsx") == AssetKind.CSV

    def test_unknown_falls_back_to_file(self, registry):
        assert registry.extension_to_kind(".xyz") == AssetKind.FILE
        assert registry.extension_to_kind(".unknown") == AssetKind.FILE

    def test_module_level_helper(self):
        assert detect_asset_kind_from_extension(".pdf") == AssetKind.PDF


# ═══════════════════════════════════════════════════
# Kind → Descriptor lookup
# ═══════════════════════════════════════════════════

class TestByKind:

    def test_known_kind(self, registry):
        desc = registry.by_kind(AssetKind.PDF)
        assert desc is not None
        assert desc.kind == AssetKind.PDF

    def test_returns_none_for_unknown(self, registry):
        """by_kind with an unregistered kind returns None."""
        result = registry.by_kind("nonexistent_kind_xyz")
        assert result is None

    def test_all_standard_kinds_registered(self, registry):
        """Every commonly used kind should have a descriptor."""
        expected = [
            AssetKind.PDF, AssetKind.TEXT, AssetKind.CSV, AssetKind.IMAGE,
            AssetKind.FILE, AssetKind.ARTICLE, AssetKind.WEB,
        ]
        for kind in expected:
            assert registry.by_kind(kind) is not None, f"{kind} not registered"


# ═══════════════════════════════════════════════════
# Container kinds
# ═══════════════════════════════════════════════════

class TestContainerKinds:

    def test_pdf_is_container(self, registry):
        assert registry.is_container(AssetKind.PDF) is True

    def test_csv_is_container(self, registry):
        assert registry.is_container(AssetKind.CSV) is True

    def test_text_is_not_container(self, registry):
        assert registry.is_container(AssetKind.TEXT) is False

    def test_image_is_not_container(self, registry):
        assert registry.is_container(AssetKind.IMAGE) is False

    def test_container_kinds_set(self, registry):
        containers = registry.container_kinds()
        assert AssetKind.PDF in containers
        assert AssetKind.CSV in containers
        assert AssetKind.TEXT not in containers


# ═══════════════════════════════════════════════════
# Processor routing
# ═══════════════════════════════════════════════════

class TestProcessorRouting:

    def test_pdf_has_processor(self, registry):
        desc = registry.by_kind(AssetKind.PDF)
        assert desc.processor_class is not None

    def test_text_has_no_processor(self, registry):
        desc = registry.by_kind(AssetKind.TEXT)
        assert desc.processor_class is None

    def test_processable_kinds(self, registry):
        processable = registry.processable_kinds()
        assert AssetKind.PDF in processable
        assert AssetKind.CSV in processable

    def test_needs_processing_helper(self):
        assert needs_processing(AssetKind.PDF) is True
        assert needs_processing(AssetKind.TEXT) is False


# ═══════════════════════════════════════════════════
# Importability
# ═══════════════════════════════════════════════════

class TestImportability:

    def test_pdf_is_importable(self, registry):
        desc = registry.by_kind(AssetKind.PDF)
        assert desc.importable is True

    def test_video_is_not_importable(self, registry):
        desc = registry.by_kind(AssetKind.VIDEO)
        assert desc.importable is False

    def test_importable_extensions_include_pdf(self):
        exts = importable_extensions()
        assert ".pdf" in exts

    def test_importable_extensions_include_csv(self):
        exts = importable_extensions()
        assert ".csv" in exts

    def test_importable_extensions_include_images(self):
        exts = importable_extensions()
        assert ".jpg" in exts
        assert ".png" in exts

    def test_child_kinds_not_importable(self, registry):
        """Child kinds (PDF_PAGE, CSV_ROW) should not be importable."""
        for kind in [AssetKind.PDF_PAGE, AssetKind.CSV_ROW]:
            desc = registry.by_kind(kind)
            if desc:
                assert desc.importable is False, f"{kind} should not be importable"


# ═══════════════════════════════════════════════════
# URL detection helpers
# ═══════════════════════════════════════════════════

class TestURLDetection:

    def test_rss_feed_urls(self):
        assert is_rss_feed_url("https://example.com/feed") is True
        assert is_rss_feed_url("https://example.com/rss") is True
        assert is_rss_feed_url("https://example.com/atom.xml") is True
        assert is_rss_feed_url("https://example.com/feed.xml") is True

    def test_non_rss_urls(self):
        assert is_rss_feed_url("https://example.com/page") is False
        assert is_rss_feed_url("https://example.com/document.pdf") is False

    def test_archive_urls(self):
        assert is_archive_url("https://example.com/data.zip") is True
        assert is_archive_url("https://example.com/data.tar.gz") is True

    def test_non_archive_urls(self):
        assert is_archive_url("https://example.com/page.html") is False
        assert is_archive_url("https://example.com/doc.pdf") is False
