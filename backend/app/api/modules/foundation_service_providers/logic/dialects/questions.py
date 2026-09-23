"""
questions.py — TypeSafe's System One wire. Served by Kev locally and Jev hosted.

  POST {base}/v1/systemone
       {state, model, questions: {key: {type, instructions, criteria}}}
    ──► {answers: {key: {type, probabilities, noul|choice|score, confidence}},
         usage, latency_ms}

  GET  {base}/v1/models      the loaded checkpoint — provenance, and the readiness probe

The server owns everything this wire does not: it renders an object state into
text, keeps questions from reading each other, and applies the checkpoint's own
calibration. So the dialect's whole job is naming: turn our question types into
its `criteria` shapes, and its answers back into scores under OUR option keys.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Mapping, Optional

import httpx

from app.api.modules.foundation_service_providers.logic.base import LogicDialect
from app.api.modules.foundation_service_providers.logic.models import (
    Choice, Noul, Question, Readout, Score,
)
from app.api.modules.foundation_service_providers.logic.transforms import as_options

logger = logging.getLogger(__name__)


class QuestionsWire(LogicDialect):
    """One request per state; the server isolates the questions inside it."""

    def __init__(self, **config):
        super().__init__(**config)
        self._meta: Optional[Dict[str, Any]] = None

    def headers(self) -> dict:
        """Keyless by default — Kev has no auth, which is why it stays on loopback."""
        if getattr(self.quirks, "auth_header", "none") == "bearer" and self.api_key:
            return {"Authorization": f"Bearer {self.api_key}"}
        return {}

    # ── contract ─────────────────────────────────────────────────────────────

    async def ask(self, state: Any, questions: Mapping[str, Question], *,
                  model_name: Optional[str] = None) -> Dict[str, Readout]:
        payload = {
            "state": state,
            "model": model_name or self.quirks.model_name,
            "questions": {key: _encode(question) for key, question in questions.items()},
        }
        data = await self._post(self.descriptor.path, payload)
        answers = data.get("answers") or {}
        meta = await self.meta()

        readouts: Dict[str, Readout] = {}
        for key, question in questions.items():
            answer = answers.get(key)
            if answer is None:
                continue                      # the engine reports which key is missing
            readouts[key] = Readout(
                scores=_scores(question, answer),
                kind="probs",                 # the server already normalised and calibrated
                provenance={**meta,
                            "confidence": answer.get("confidence"),
                            "latency_ms": data.get("latency_ms")},
            )
        return readouts

    # ── endpoint facts ───────────────────────────────────────────────────────

    async def meta(self) -> Dict[str, Any]:
        """Checkpoint provenance, fetched once per adapter.

        Kev answers ``{"models": [{id, run, base, temperature}]}``; an
        OpenAI-shaped server would answer ``{"data": [...]}``. Neither shape is
        contractual, so every field is optional: a missing one costs an
        unlabelled answer, never a failed decision.

        ``run`` is preferred over ``id`` as the model's identity because it names
        the checkpoint that actually answered — ``kev-latest`` says nothing a
        stored decision could be traced back to.
        """
        if self._meta is None:
            try:
                response = await self.client.get(self.url("/v1/models"))
                response.raise_for_status()
                body = response.json()
                listed = body.get("models") or body.get("data")
                entry = listed[0] if isinstance(listed, list) and listed else body
                self._meta = {
                    "model": entry.get("run") or entry.get("id") or entry.get("model") or "",
                    # Only a real revision. The base model is a different fact,
                    # and calling it one would make a stored answer claim a
                    # provenance it does not have; it rides the listing instead.
                    "revision": entry.get("revision"),
                    "temperature": entry.get("temperature"),
                }
            except Exception as e:                      # provenance is a nicety, not the answer
                logger.debug("logic/%s: /v1/models unavailable: %s", self.provider_key, e)
                self._meta = {}
        return self._meta

    async def _post(self, path: str, payload: dict) -> dict:
        try:
            response = await self.client.post(self.url(path), json=payload)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = e.response.text[:300]
            if e.response.status_code == 422:
                # The server validated our request and rejected it: a malformed
                # question is our bug, so say so rather than retrying it forever.
                raise ValueError(f"{self.provider_key} rejected the questions: {body}") from e
            raise RuntimeError(f"{self.provider_key} HTTP {e.response.status_code}: {body}") from e
        except Exception as e:
            raise RuntimeError(f"{self.provider_key} decision request failed: {e}") from e


# ── naming ────────────────────────────────────────────────────────────────────


def _encode(question: Question) -> dict:
    """Our question type → the System One shape. Criteria go over as declared."""
    if isinstance(question, Noul):
        criteria = {k: v for k, v in (("true", question.true), ("false", question.false)) if v}
        out = {"type": "noul", "instructions": question.instructions}
        if criteria:
            out["criteria"] = criteria
        return out
    if isinstance(question, Choice):
        return {"type": "choice", "instructions": question.instructions,
                "criteria": dict(question.criteria)}
    if isinstance(question, Score):
        return {"type": "score", "instructions": question.instructions,
                "criteria": list(question.levels)}
    raise TypeError(f"Not a question: {type(question).__name__}")


def _scores(question: Question, answer: Mapping[str, Any]) -> Dict[str, float]:
    """The server's answer → scores under our option keys.

    A noul answers with one number, the probability of yes; the other side is
    what remains. Choice and score answer with a distribution already keyed the
    way ``as_options`` names them — option name, and level index as a string.
    """
    if isinstance(question, Noul):
        yes = float(answer.get("noul", 0.0))
        return {"true": yes, "false": 1.0 - yes}
    served = answer.get("probabilities") or {}
    return {option.key: float(served.get(option.key, 0.0))
            for option in as_options(question)}
