"""
embedding/provider.py — the Embedding domain: protocol, quirks, engine, package root.
"""

from __future__ import annotations

from app.api.modules.foundation_service_providers.primitives import Domain
from app.api.modules.foundation_service_providers.embedding.base import EmbeddingProvider
from app.api.modules.foundation_service_providers.embedding.models import EmbeddingQuirks


Embedding = Domain(
    name="embedding",
    protocol=EmbeddingProvider,
    package="app.api.modules.foundation_service_providers.embedding",
    engine="engine.Batcher",
    quirks_type=EmbeddingQuirks,
    # no system_default: the stored vector's dimension follows the model choice
)
