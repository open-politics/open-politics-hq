"""
embedding — text in, vectors out.

  base.py      EmbeddingProvider
  models.py    EmbeddingModelSpec · EmbeddingQuirks
  provider.py  the Embedding domain
  dialects/    indexed · flat
  features/    probe_model · verify · list_models
"""

from app.api.modules.foundation_service_providers.embedding.base import EmbeddingProvider
from app.api.modules.foundation_service_providers.embedding.models import (
    EmbeddingModelSpec, EmbeddingQuirks,
)
from app.api.modules.foundation_service_providers.embedding.provider import Embedding

# side-effect imports: register dialects and features onto the Domain
from app.api.modules.foundation_service_providers.embedding import dialects  # noqa: F401

from app.api.modules.foundation_service_providers.embedding import features  # noqa: F401


__all__ = [
    "Embedding",
    "EmbeddingProvider",
    "EmbeddingModelSpec",
    "EmbeddingQuirks",
]
