"""
logic/base.py — the two contracts a dialect sits between.

  LogicProvider                  what a caller may rely on
    judge(state, questions)      ──►  {key: Answer}
    judge_many(items)            ──►  [{key: Answer}, …]

  LogicDialect                   what a wire must implement
    ask(state, questions)        ──►  {key: Readout}

``ask`` takes ONE state and EVERY question about it, because that is the unit
both wires optimise: the System One wire packs them into a single request whose
questions cannot read each other, and the readout wire walks them over one
cached prompt prefix. A caller with fifty documents therefore hands over fifty
calls, not fifty times N — see ``engine.Judge.judge_many``.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Protocol, Sequence, Tuple, runtime_checkable

from app.api.modules.foundation_service_providers.base import Adapter
from app.api.modules.foundation_service_providers.logic.models import (
    Answer, Question, Readout,
)


@runtime_checkable
class LogicProvider(Protocol):
    """Decide typed questions against a state, with probabilities."""

    async def judge(
        self,
        state: Any,
        questions: Mapping[str, Question],
        model_name: Optional[str] = None,
    ) -> Dict[str, Answer]:
        """Answer every question about one state. Keys come back as they went in."""
        ...

    async def judge_many(
        self,
        items: Sequence[Tuple[Any, Mapping[str, Question]]],
        model_name: Optional[str] = None,
    ) -> List[Dict[str, Answer]]:
        """Answer many states, at whatever width the endpoint serves. Order is kept."""
        ...


class LogicDialect(Adapter):
    """What a logic wire must implement: one method, returning raw scores.

    Normalising, calibrating and naming the result belong to the engine, so two
    wires cannot disagree about what a probability is.
    """

    #: A decision backend is commonly CPU-only, and one request carries every
    #: question about a state. Wires tighten this where their own shape allows
    #: — the same way embedding's cloud wire sits at 120 and its local one at 600.
    timeout = 600.0

    async def ask(self, state: Any, questions: Mapping[str, Question], *,
                  model_name: Optional[str] = None) -> Dict[str, Readout]:
        raise NotImplementedError
