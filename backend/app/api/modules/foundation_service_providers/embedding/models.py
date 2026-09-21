"""
embedding/models.py — EmbeddingModelSpec · EmbeddingQuirks.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from app.api.modules.foundation_service_providers.models import ModelSpec


@dataclass(frozen=True)
class EmbeddingModelSpec(ModelSpec):
    """What an embedding model produces: the stored vector's width and the
    input ceiling the engine truncates to."""
    dimension: int = 0
    max_sequence_length: int = 0


@dataclass(frozen=True)
class EmbeddingQuirks:
    """Endpoint deviations within an embedding dialect."""
    #: role of the input. (voyage requires document vs query.)
    input_type: Optional[str] = None
    #: send `encoding_format: "float"`. (openai, jina; voyage rejects it.)
    encoding_format: bool = True
    #: base_url is already the full path, do not append. (jina.)
    base_url_is_full_path: bool = False
    #: ask the server to truncate over-long inputs. (ollama.)
    server_truncate: bool = False
    #: chars per token for the truncation budget. (ollama.)
    char_budget_ratio: float = 3.2
