"""
models.py — ModelSpec, the base every domain's spec derives from.
=================================================================

  ModelSpec(name, description="")
       ├──► LLMModelSpec        language/models.py
       └──► EmbeddingModelSpec  embedding/models.py
            (every domain that declares models grows its own subclass)

  .merged_with(other)
       per field: mine is unset (None/""/0/False) and theirs isn't
                                                          │
                                                          ▼
                                            take theirs, else keep mine

  resolve.py's cascade          declared.merged_with(dialect_baseline)
  list_models()'s 3rd source    runtime-discovered — merge it yourself

  NOT IN THIS FILE
    primitives.py  types Binding.models / ProviderDescriptor against this.
    resolve.py     runs the cascade above, inside _resolve_spec(). Zero I/O.

  Declared specs are curated defaults, never an allowlist — an undeclared
  model name still resolves and still runs.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Optional


@dataclass(frozen=True)
class ModelSpec:
    """What every domain's model description has in common."""
    name: str
    description: str = ""

    def merged_with(self, other: Optional["ModelSpec"]) -> "ModelSpec":
        """Fill this spec's unset fields from ``other``.

        Used by the capability cascade: a runtime-discovered spec is merged
        over the dialect baseline, and a declared spec is merged over both.
        "Unset" means falsy-and-defaulted — a declared ``supports_tools=False``
        on a model we curated is a statement, but the same value arriving from
        a baseline that never knew is not.
        """
        if other is None:
            return self
        fields = {}
        for f in self.__dataclass_fields__:                      # type: ignore[attr-defined]
            mine = getattr(self, f)
            theirs = getattr(other, f, None)
            fields[f] = theirs if (mine in (None, "", 0, False) and theirs is not None) else mine
        return replace(self, **fields)
