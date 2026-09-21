"""
caching.py — feature: prompt caching, within a hard 4-breakpoint budget.

  PROVIDES = ("apply_cache_markers",)  ──►  p.apply_cache_markers(system,
                                             msgs), called by blocks.py's
                                             encode()

  spec = _spec_for(p)      first declared model, else the dialect baseline
  budget = 4 if spec.supports_prompt_caching else 0     (MAX_BREAKPOINTS)

  per block, system before messages (outermost prefix spent first):
    "cacheable" absent   ──► block unchanged
    "cacheable" present  ──► key always dropped, and if spent < budget:
                              cache_control: {type: "ephemeral"}, spent += 1

The 4-breakpoint cap is the wire's hard limit: a 5th marker fails the request.
"""

from __future__ import annotations

import logging
from typing import Any, List, Tuple

logger = logging.getLogger(__name__)

PROVIDES = ("apply_cache_markers",)

EPHEMERAL = {"type": "ephemeral"}

#: Hard API limit. Markers past this fail the request outright.
MAX_BREAKPOINTS = 4


def apply_cache_markers(p, system: List[Any], messages: List[dict]) -> Tuple[List[Any], List[dict]]:
    """Translate ``cacheable`` hints into native cache markers, within budget.

    Returns ``(system, messages)`` with every ``cacheable`` key removed.
    """
    spec = _spec_for(p)
    enabled = getattr(spec, "supports_prompt_caching", False) if spec else False
    budget = MAX_BREAKPOINTS if enabled else 0
    spent = 0

    def convert(block: Any) -> Any:
        nonlocal spent
        if not isinstance(block, dict) or "cacheable" not in block:
            return block
        out = {k: v for k, v in block.items() if k != "cacheable"}
        if block.get("cacheable") and spent < budget:
            out.setdefault("cache_control", EPHEMERAL)
            spent += 1
        return out

    # System first: the outermost prefix is the most valuable marker to spend.
    new_system = (
        [convert(b) for b in system if isinstance(b, dict)]
        if isinstance(system, list) else system
    )
    new_messages = [
        {**m, "content": [convert(b) for b in m["content"]]}
        if isinstance(m.get("content"), list) else m
        for m in messages
    ]

    if spent:
        logger.debug("Applied %d/%d cache breakpoints", spent, MAX_BREAKPOINTS)
    elif enabled:
        logger.debug("No cacheable content in this request")

    return new_system, new_messages


def _spec_for(p) -> Any:
    """The spec whose ``supports_prompt_caching`` decides the budget."""
    models = p.descriptor.models
    return models[0] if models else p.descriptor.binding.dialect.baseline
