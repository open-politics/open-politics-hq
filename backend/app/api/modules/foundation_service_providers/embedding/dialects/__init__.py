"""
embedding dialects — indexed (openai · voyage · jina) · flat (ollama).
"""

from app.api.modules.foundation_service_providers.embedding.provider import Embedding


Embedding.dialect("indexed", module="indexed", adapter="IndexedEmbedder", path="/embeddings")
Embedding.dialect("flat", module="flat", adapter="FlatEmbedder", path="/api/embed")
