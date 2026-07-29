"""Text source — a submitted text block becomes one TEXT RawItem.

One-shot: ``config = {text, title?, event_timestamp?, metadata?}``. The content
arrives inline (the source already has it), so ``fetch`` just packages it.
"""

from __future__ import annotations

from typing import AsyncIterator

from app.api.modules.content.asset_builder import content_hash
from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.models import AssetKind
from app.api.modules.content.sources import (
    FetchedContent, Preview, RawItem, source_type,
)


@source_type("text")
class PastedText:
    async def read(self, config: dict, cursor: dict, ctx: SourceContext) -> AsyncIterator[RawItem]:
        # Uniform opener: a poll/single submit passes its config directly; the intake
        # route passes many via {"items": [...]}. Either way, one spec per iteration.
        for it in (config.get("items") or [config]):
            text = it.get("text") or ""
            if not text.strip():
                continue
            # Pasted text has no URL, so identity IS the content — the one derivation
            # serves as the dedup key here rather than as a change signal.
            digest = content_hash(text)
            yield RawItem(
                source_identifier=digest,
                kind=AssetKind.TEXT,
                title=it.get("title") or f"Text: {text[:30].strip()}…",
                source_token=digest,
                text=text,
                event_timestamp=it.get("event_timestamp"),
                metadata={"ingestion_method": "direct_text", **(it.get("metadata") or {})},
            )

    async def view(self, item: RawItem, ctx: SourceContext) -> Preview:
        return Preview(title=item.title, summary=(item.text or "")[:200])

    async def fetch(self, item: RawItem, ctx: SourceContext) -> FetchedContent:
        # Pass-through; the builder derives the hash (it lands on the same digest).
        return FetchedContent(
            text_content=item.text,
            event_timestamp=item.event_timestamp, metadata=item.metadata,
        )
