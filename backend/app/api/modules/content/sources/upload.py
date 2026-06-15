"""Upload source — a pre-staged uploaded file becomes one RawItem.

The route stages the file to storage first and passes the blob path in
``config``, so ``read`` does no I/O and ``fetch`` just points the asset at the
already-staged blob. Kind is detected from the extension; the TYPE processes it.
"""

from __future__ import annotations

from typing import AsyncIterator

from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.sources import (
    FetchedContent, Preview, RawItem, source_type,
)


@source_type("upload")
class FileUpload:
    """``config = {storage_path, filename, title?, file_info?}``."""

    async def read(self, config: dict, cursor: dict, ctx: SourceContext) -> AsyncIterator[RawItem]:
        from app.api.modules.content.types import detect_asset_kind_from_extension
        # Uniform opener: poll/single passes config directly; intake passes {"items": [...]}.
        for it in (config.get("items") or [config]):
            storage_path = it.get("storage_path")
            if not storage_path:
                raise ValueError("upload source missing storage_path")
            filename = it.get("filename") or storage_path.rsplit("/", 1)[-1]
            ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
            yield RawItem(
                source_identifier=storage_path,   # unique per upload
                kind=detect_asset_kind_from_extension(ext),
                title=it.get("title") or filename,
                path=it.get("path") or "",        # folder → sub-bundle placement (bulk folder upload)
                locator=storage_path,
                metadata=it.get("file_info") or {"original_filename": filename},
            )

    async def view(self, item: RawItem, ctx: SourceContext) -> Preview:
        return Preview(title=item.title)

    async def fetch(self, item: RawItem, ctx: SourceContext) -> FetchedContent:
        # Already staged at upload time — hand the blob to the build loop.
        return FetchedContent(blob_path=item.locator, metadata=item.metadata)
