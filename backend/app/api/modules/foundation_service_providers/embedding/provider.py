"""
embedding/provider.py — the Domain itself.
==========================================

  base.py      EmbeddingProvider  ─┐
  models.py    EmbeddingQuirks    ─┴──►  Embedding = Domain(…)
                                                     │
  dialects/__init__.py   ──►  Embedding.dialect("indexed") · ("flat")
  features/__init__.py   ──►  probe_model · verify · list_models
  providers.py           ──►  Embedding(dialect=…, quirks=…) per endpoint

  system_default   none — the stored vector's dimension depends on
                   the choice, so it must always be explicit.

  NOT IN THIS FILE
    ../primitives.py  Domain, Dialect, Feature, Binding — what these
                      calls actually build.
    ../resolve.py     how a Binding becomes a live, constructed instance.
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
    # No system_default: the stored vector's dimension depends on the choice.
)
