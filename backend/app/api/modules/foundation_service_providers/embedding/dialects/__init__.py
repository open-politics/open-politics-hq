"""
embedding/dialects — which wires exist.
=======================================

  indexed   POST {base}/embeddings  ──►  {data:[{index, embedding}]}
            sorted by index — no endpoint promises request order
            serves: openai · voyage · jina

  flat      POST {base}/api/embed   ──►  {embeddings:[[…]]}
            positional — array order IS the input's order
            serves: ollama

  NOT IN THIS FILE
    provider.py  Embedding.dialect(…) — how these get registered.
    ../base.py   EmbeddingProvider — the Protocol both wires implement.
"""

from app.api.modules.foundation_service_providers.embedding.provider import Embedding


Embedding.dialect("indexed", module="indexed", adapter="IndexedEmbedder", path="/embeddings")
Embedding.dialect("flat", module="flat", adapter="FlatEmbedder", path="/api/embed")
