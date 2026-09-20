"""
embedding/features — which optional surfaces exist.
===================================================

  probe_model   POST /api/show   ─►  dimension · context_length
  verify        embed one char   ─►  bool
  list_models   GET /api/tags    ─►  [EmbeddingModelSpec]

  probe_model · list_models: ollama only — the one endpoint with
  no declared model list. verify: the three keyed endpoints instead,
  which have nothing to do with local model discovery.

  NOT IN THIS FILE
    provider.py  Embedding.feature(…) — how these get registered.
    ../base.py   EmbeddingProvider — the Protocol features compose onto.
"""

from app.api.modules.foundation_service_providers.embedding.provider import Embedding


Embedding.feature("probe_model", module="probe")
Embedding.feature("verify", module="verify")
Embedding.feature("list_models", module="models")
