"""
raw.py — next-token readout on a llama-server. Any GGUF, no decision training.

  POST /tokenize        each answer letter, once per endpoint — it must be ONE token
  POST /apply-template  {messages, chat_template_kwargs: {enable_thinking: false}} → prompt
  POST /completion      {prompt, n_predict: 1, n_probs, post_sampling_probs: false,
                         cache_prompt: true, id_slot}
     ──► the raw next-token distribution, restricted to the answer letters

No generation: the model never emits a sentence a parser has to trust. The
probabilities are pre-sampler, so `n_probs` reports the model's own distribution
rather than one the sampler already reshaped, and the letters keep their
`mass` — how much probability landed on the answer slots at all.

Questions about one state run in sequence on one slot. That is deliberate: the
state is the expensive part of the prompt and the server's cache keeps it.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Mapping, Optional

import httpx

from app.api.modules.foundation_service_providers.logic.base import LogicDialect
from app.api.modules.foundation_service_providers.logic.models import Question, Readout
from app.api.modules.foundation_service_providers.logic.transforms import (
    PROMPT_VERSION, as_options, prompt_hash, raw_messages,
)

logger = logging.getLogger(__name__)


class RawReadout(LogicDialect):
    """One forward pass per question, over a shared and cached state prefix."""

    #: One prompt, one token. A server still thinking about that after five
    #: minutes is wedged rather than busy, whatever hardware it runs on.
    timeout = 300.0

    def __init__(self, **config):
        super().__init__(**config)
        self._labels: Optional[List[int]] = None

    async def ask(self, state: Any, questions: Mapping[str, Question], *,
                  model_name: Optional[str] = None) -> Dict[str, Readout]:
        readouts: Dict[str, Readout] = {}
        for key, question in questions.items():
            options = as_options(question)
            slots = await self.label_ids(len(options))
            prompt = await self._render(raw_messages(state, question, options))
            scores, mass = await self._next_token(prompt, slots)
            readouts[key] = Readout(
                scores={option.key: score for option, score in zip(options, scores)},
                kind="logits",
                mass=mass,
                provenance={"model": model_name or "",
                            "prompt_version": PROMPT_VERSION,
                            "prompt_sha256": prompt_hash(prompt)},
            )
        return readouts

    # ── the three calls ──────────────────────────────────────────────────────

    async def label_ids(self, count: int) -> List[int]:
        """Token ids for the answer letters, verified once per endpoint.

        A letter that tokenises to two tokens cannot be read off the next
        position at all, so this fails loudly at the first decision rather than
        returning a confident number about the wrong thing.
        """
        if self._labels is None:
            ids: List[int] = []
            for letter in self.quirks.labels:
                tokens = (await self._post("/tokenize", {"content": letter})).get("tokens") or []
                if len(tokens) != 1:
                    raise RuntimeError(
                        f"answer slot {letter!r} is {len(tokens)} tokens under this "
                        f"model's tokenizer; the readout needs exactly one"
                    )
                ids.append(int(tokens[0]))
            self._labels = ids
        if count > len(self._labels):
            raise ValueError(f"{count} options exceeds the {len(self._labels)} answer slots")
        return self._labels[:count]

    async def _render(self, messages: List[Dict[str, str]]) -> str:
        """Let the server apply its own chat template — it owns the GGUF's.

        Thinking off is not a preference here: a reasoning template would spend
        the one token we read on `<think>`.
        """
        body: Dict[str, Any] = {"messages": messages}
        kwarg = self.quirks.no_thinking_template_kwarg
        if kwarg:
            body["chat_template_kwargs"] = {kwarg: False}
        prompt = (await self._post("/apply-template", body)).get("prompt")
        if not prompt:
            raise RuntimeError(f"{self.provider_key} returned no prompt from /apply-template")
        return prompt

    async def _next_token(self, prompt: str, slots: List[int]) -> tuple[List[float], float]:
        """Log-probabilities for the answer letters, plus the mass they carry."""
        payload: Dict[str, Any] = {
            "prompt": prompt,
            "n_predict": 1,
            "n_probs": self.quirks.top_n,
            "post_sampling_probs": False,   # the model's distribution, not the sampler's
            "temperature": 0,               # the sampled token is discarded either way
            "cache_prompt": True,
        }
        if self.quirks.slot is not None:
            payload["id_slot"] = self.quirks.slot

        data = await self._post(self.descriptor.path, payload)
        entries = (data.get("completion_probabilities") or [{}])[0].get("top_logprobs") or []
        by_id = {int(e["id"]): float(e["logprob"])
                 for e in entries if e.get("id") is not None and e.get("logprob") is not None}
        if not by_id:
            raise RuntimeError(f"{self.provider_key} returned no token probabilities")

        # A letter outside the top-N window is bounded by the window's floor: we
        # know it is no likelier than that, which is enough to rank it last.
        floor = min(by_id.values())
        scores = [by_id.get(token, floor) for token in slots]
        mass = sum(math.exp(by_id[token]) for token in slots if token in by_id)
        return scores, mass

    async def _post(self, path: str, payload: dict) -> dict:
        try:
            response = await self.client.post(self.url(path), json=payload)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(
                f"{self.provider_key} HTTP {e.response.status_code} on {path}: "
                f"{e.response.text[:300]}"
            ) from e
        except Exception as e:
            raise RuntimeError(f"{self.provider_key} readout failed on {path}: {e}") from e
