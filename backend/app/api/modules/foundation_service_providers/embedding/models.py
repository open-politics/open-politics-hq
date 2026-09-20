"""
embedding/models.py — this domain's data models.
================================================

  EmbeddingModelSpec(ModelSpec)
    dimension           ─►  stored vector's width (load-bearing)
    max_sequence_length ─►  engine.py's truncation budget

  EmbeddingQuirks             one endpoint's deviations from its dialect
    input_type              indexed/voyage        document vs query
    encoding_format         indexed/openai+jina   send "float"?
    base_url_is_full_path   indexed/jina          don't re-append the path
    server_truncate         flat/ollama           ask the server to cut
    char_budget_ratio       flat/ollama           chars/token, conservative

  NOT IN THIS FILE
    base.py    EmbeddingProvider — the Protocol these types serve.
    engine.py  Batcher — the only reader of char_budget_ratio.
    dialects/  indexed.py · flat.py — where every other quirk is read.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import List, Optional, Protocol, runtime_checkable
from app.api.modules.foundation_service_providers.models import ModelSpec

from app.api.modules.foundation_service_providers.models import ModelSpec


@dataclass(frozen=True)
class EmbeddingModelSpec(ModelSpec):
    """What an embedding model produces.

    ``dimension`` is load-bearing — the vector column's width depends on it, and
    ``modules/embedding/embed.py`` truncates or raises on a mismatch.
    ``max_sequence_length`` feeds the engine's truncation budget.
    """
    dimension: int = 0
    max_sequence_length: int = 0


@dataclass(frozen=True)
class EmbeddingQuirks:
    """Endpoint deviations within an embedding dialect.

    Each field names the endpoint that forced it.
    """
    #: Names the input's role. (indexed/voyage — requires document vs query.)
    input_type: Optional[str] = None
    #: Send `encoding_format: "float"`. (indexed/openai + jina; Voyage rejects it.)
    encoding_format: bool = True
    #: base_url is already the full path, do not append. (indexed/jina.)
    base_url_is_full_path: bool = False
    #: Ask the server to truncate over-long inputs. (flat/ollama.)
    server_truncate: bool = False
    #: Chars-per-token for truncation; deliberately conservative. (flat/ollama.)
    char_budget_ratio: float = 3.2
