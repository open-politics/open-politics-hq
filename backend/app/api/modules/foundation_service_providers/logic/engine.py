"""
logic/engine.py — the loop above a wire. Every decision leaves through here.

  judge(state, questions)
    validate   2 ≤ options ≤ min(wire ceiling, the model's own) · state is not empty
               · a state past `trained_state_tokens` warns, never truncates
    call       adapter.ask(state, questions)        one request per state
    shape      transforms.to_answer per question    logits → temper → softmax
                                                    probs  → renormalise

  judge_many(items)
    asyncio.Semaphore(quirks.parallel) — the width the ENDPOINT serves, not the
    width a caller happens to want. Kev answers one request at a time and says
    so in its quirks; a four-slot llama-server says four. Order is preserved.

Aggregation lives in three places and this file owns two of them: one request
carries every question about a state, and one call carries as many states as the
endpoint can take. The third is the `logic` queue, which belongs to the caller's
@task — see MAP.md for the recipe.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from app.api.modules.foundation_service_providers.logic import transforms
from app.api.modules.foundation_service_providers.logic.models import Answer, Question

logger = logging.getLogger(__name__)

#: Rough chars-per-token, only ever used to decide whether to warn about a long
#: state. Nothing branches on it, so a crude number is the honest one.
CHARS_PER_TOKEN = 4


class Judge:
    """Wraps a logic dialect with validation, shaping and batching.

    Delegates anything it does not implement to the adapter, so a feature bound
    onto the instance still reads like a method.
    """

    def __init__(self, adapter, descriptor):
        self.adapter = adapter
        self.descriptor = descriptor

    def __getattr__(self, name):
        return getattr(self.adapter, name)

    # ── contract ─────────────────────────────────────────────────────────────

    async def judge(self, state: Any, questions: Mapping[str, Question],
                    model_name: Optional[str] = None) -> Dict[str, Answer]:
        if not questions:
            raise ValueError("judge needs at least one question")
        self._validate(state, questions)

        readouts = await self.adapter.ask(state, questions, model_name=model_name)

        answers: Dict[str, Answer] = {}
        for key, question in questions.items():
            readout = readouts.get(key)
            if readout is None:
                raise RuntimeError(
                    f"{self.descriptor.provider_key} answered without {key!r}; "
                    f"got {sorted(readouts)}"
                )
            answers[key] = transforms.to_answer(
                question, readout,
                quirks=self.adapter.quirks,
                model=model_name or "",
                wire=self.descriptor.binding.dialect.name,
            )
        return answers

    async def judge_many(
        self,
        items: Sequence[Tuple[Any, Mapping[str, Question]]],
        model_name: Optional[str] = None,
    ) -> List[Dict[str, Answer]]:
        """Judge many states at the endpoint's own width, in input order."""
        if not items:
            return []
        width = max(1, int(getattr(self.adapter.quirks, "parallel", 1) or 1))
        gate = asyncio.Semaphore(width)

        async def one(state, questions):
            async with gate:
                return await self.judge(state, questions, model_name)

        return list(await asyncio.gather(
            *(one(state, questions) for state, questions in items)
        ))

    # ── validation ───────────────────────────────────────────────────────────

    def _validate(self, state: Any, questions: Mapping[str, Question]) -> None:
        """Refuse what cannot be answered; warn about what answers badly.

        Everything read here is a fact about the endpoint, because a decision
        endpoint serves one model: the option ceiling its wire can express, and
        the state length that model was trained on.
        """
        if state is None or (isinstance(state, str) and not state.strip()) or state == []:
            raise ValueError("a decision needs a non-empty state")

        quirks = self.adapter.quirks
        ceiling = int(getattr(quirks, "max_options", 16) or 16)

        for key, question in questions.items():
            options = transforms.as_options(question)
            if len(options) < 2:
                raise ValueError(f"question {key!r} offers {len(options)} option(s); needs 2")
            if len(options) > ceiling:
                raise ValueError(
                    f"question {key!r} offers {len(options)} options; "
                    f"{self.descriptor.provider_key} takes {ceiling}"
                )
            if len({option.key for option in options}) != len(options):
                raise ValueError(f"question {key!r} has duplicate option keys")

        trained = int(getattr(quirks, "trained_state_tokens", 0) or 0)
        if trained:
            estimate = len(transforms.render_state(state)) // CHARS_PER_TOKEN
            if estimate > trained:
                # Not an error: the server accepts it, and a caller may know the
                # model generalises. It is outside what the model was trained on,
                # which is worth one line in a log and nothing more.
                logger.warning(
                    "logic: state is ~%d tokens, past the %d %s was trained on; "
                    "probabilities past that point are extrapolation",
                    estimate, trained, self.descriptor.provider_key,
                )
