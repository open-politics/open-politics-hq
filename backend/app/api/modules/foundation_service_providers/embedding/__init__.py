"""
embedding — text in, vectors out.
=================================

  base.py      the contract        EmbeddingProvider
  models.py    the data            EmbeddingModelSpec · EmbeddingQuirks
  provider.py  the Domain          Embedding
  dialects/    the wires           indexed · flat
  features/    optional surfaces   probe_model · verify · list_models

  NOT IN THIS FILE
    engine.py     Batcher — wraps a dialect with truncation + salvage
                  retry. Geocoding has no engine; nothing to batch.
    providers.py  which endpoint binds which dialect, with what quirks.
"""

from app.api.modules.foundation_service_providers.embedding.base import EmbeddingProvider
from app.api.modules.foundation_service_providers.embedding.models import (
    EmbeddingModelSpec, EmbeddingQuirks,
)
from app.api.modules.foundation_service_providers.embedding.provider import Embedding

# Registers the dialects. Must follow the Domain it registers onto.
from app.api.modules.foundation_service_providers.embedding import dialects  # noqa: F401

# Registers the features. Must follow the Domain it registers onto.
from app.api.modules.foundation_service_providers.embedding import features  # noqa: F401


__all__ = [
    "Embedding",
    "EmbeddingProvider",
    "EmbeddingModelSpec",
    "EmbeddingQuirks",
]
