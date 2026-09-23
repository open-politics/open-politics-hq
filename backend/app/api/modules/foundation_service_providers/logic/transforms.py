"""
logic/transforms.py — shared shaping. Every wire and every question kind funnels
through here, so there is one place to tune what a decision means.

  as_options(question)      Noul/Choice/Score ──► Option[]   THE key vocabulary
  render_state(state)       dict/list ──► text               (client-side wires only)
  raw_messages(...)         the readout prompt                PROMPT_VERSION, hashed
  temper · softmax          logits ──► probabilities
  confidence(probs)         how far from a coin toss
  to_answer(...)            Readout ──► Answer                the single shaping path

Two rules this file exists to enforce:

* **One key vocabulary.** ``as_options`` decides what an option is called —
  ``true``/``false`` for a noul, the caller's own keys for a choice, the level
  index for a score. Every wire reports scores under those keys, so nothing
  above the dialect knows which wire answered.
* **One prompt.** The readout wire's prompt lives here, not in the dialect, so
  a second readout wire cannot quietly ask a different question.

  NOT IN THIS FILE
    models.py   the types below.
    engine.py   validation, aggregation, provenance.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.api.modules.foundation_service_providers.logic.models import (
    Answer, Choice, Noul, Option, Question, Readout, Score,
)

#: The readout prompt's identity. It travels on every Answer produced by a
#: readout wire, because changing the wording changes every probability.
PROMPT_VERSION = "logic-options-v1"

SYSTEM = (
    "Apply the supplied criterion to the supplied evidence. Choose exactly one listed option. "
    "Respond with only its uppercase letter, with no explanation or reasoning."
)


# ── questions ─────────────────────────────────────────────────────────────────


def as_options(question: Question) -> Tuple[Option, ...]:
    """The options a question offers, in wire order.

    A choice option with no description gets its key as one: a bare letter with
    nothing behind it tells a readout model nothing. The System One wire keeps
    passing the caller's declaration verbatim — a trained server reads a null
    description as "the name is the description" — so this substitution only
    ever reaches wires that need prose.
    """
    if isinstance(question, Noul):
        return (Option("true", question.true or "Yes"),
                Option("false", question.false or "No"))
    if isinstance(question, Choice):
        return tuple(Option(key, description or key)
                     for key, description in question.criteria.items())
    if isinstance(question, Score):
        return tuple(Option(str(index), level)
                     for index, level in enumerate(question.levels))
    raise TypeError(f"Not a question: {type(question).__name__}")


def legend_for(question: Question) -> Optional[Dict[str, str]]:
    """Score only: index → level text, so a caller can render a mean of 1.44."""
    if isinstance(question, Score):
        return {str(i): level for i, level in enumerate(question.levels)}
    return None


def render_state(state: Any) -> str:
    """A state as text — how the engine measures one, not how a wire sends one.

    Strings pass through; anything else serialises as JSON. Used to size a state
    against ``trained_state_tokens``. Wires keep structure: a System One server
    labels objects itself, and the readout prompt nests the state as real JSON
    rather than an escaped string, which is the shape its results were measured on.
    """
    if isinstance(state, str):
        return state
    return json.dumps(state, ensure_ascii=False)


def raw_messages(state: Any, question: Question,
                 options: Sequence[Option]) -> List[Dict[str, str]]:
    """The readout prompt: evidence first, so questions about one state share a prefix."""
    payload = {
        "evidence": state,
        "criterion": question.instructions,
        "options": [{"letter": letter, "description": option.description}
                    for letter, option in zip(_letters(len(options)), options)],
    }
    return [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]


def _letters(count: int, alphabet: str = "ABCDEFGHIJKLMNOP") -> str:
    return alphabet[:count]


def prompt_hash(text: str) -> str:
    """Identity of one rendered prompt, for the provenance a stored answer carries."""
    return hashlib.sha256(text.encode()).hexdigest()


# ── numbers ───────────────────────────────────────────────────────────────────


def softmax(values: Sequence[float]) -> List[float]:
    """Stable softmax. Raises on a non-finite input rather than emitting NaN."""
    if not values:
        raise ValueError("softmax needs at least one value")
    if any(not math.isfinite(v) for v in values):
        raise ValueError(f"non-finite scores: {list(values)}")
    top = max(values)
    weights = [math.exp(v - top) for v in values]
    total = sum(weights)
    return [w / total for w in weights]


def temper(values: Sequence[float], temperature: Optional[float]) -> List[float]:
    """Divide logits by a calibration temperature. None or 1.0 leaves them alone.

    Temperature never reorders anything — the argmax is identical either way.
    What it changes is how far the winner sits from the rest, which is the part
    a threshold reads.
    """
    if temperature in (None, 1.0) or not temperature:
        return list(values)
    return [v / temperature for v in values]


def confidence(probabilities: Sequence[float], *, ordered: bool = False) -> float:
    """How decided the distribution is, on 0..1. A spread, not an accuracy rate.

    Two formulas, because the options mean different things:

    * unordered (noul, choice) — distance from a uniform guess,
      ``(p_max - 1/K) / (1 - 1/K)``, TypeSafe's published formula.
    * ordered (score) — distance from the modal level,
      ``1 - E|level - mode| / (L - 1)``. Levels are a scale: mass on the
      neighbouring level is near-agreement, mass at the far end is not, and the
      unordered formula cannot tell those apart.

    Using one formula for both would make a threshold mean different things on
    the two wires, since a System One server derives the ordered one itself and
    a readout wire leaves it to us.
    """
    count = len(probabilities)
    if count <= 1:
        return 1.0
    if ordered:
        mode = max(range(count), key=probabilities.__getitem__)
        drift = sum(p * abs(i - mode) for i, p in enumerate(probabilities))
        return max(0.0, 1.0 - drift / (count - 1))
    floor = 1.0 / count
    return max(0.0, (max(probabilities) - floor) / (1.0 - floor))


# ── the shaping path ──────────────────────────────────────────────────────────


def to_answer(question: Question, readout: Readout, *, quirks, model: str = "",
              wire: str = "") -> Answer:
    """``Readout`` → ``Answer``: normalise, calibrate, and name the result.

    The only place probabilities come into existence. A wire that already
    normalised (``kind="probs"``) is renormalised over the declared options —
    a server that answered about options we did not ask for would otherwise
    leak into the distribution — and a wire that read logits is tempered first.
    """
    options = as_options(question)
    keys = [option.key for option in options]

    if readout.kind == "logits":
        floor = min(readout.scores.values()) if readout.scores else 0.0
        values = temper([readout.scores.get(key, floor) for key in keys],
                        getattr(quirks, "temperature", None))
        probabilities = softmax(values)
    else:
        raw = [max(0.0, float(readout.scores.get(key, 0.0))) for key in keys]
        total = sum(raw)
        if total <= 0:
            raise ValueError(f"no probability mass over {keys}")
        probabilities = [value / total for value in raw]
        temperature = getattr(quirks, "temperature", None)
        if temperature not in (None, 1.0) and temperature:
            # Re-calibrating an already-normalised distribution: back to logits,
            # temper, forward again. Same operation, same invariance.
            probabilities = softmax(temper([math.log(max(p, 1e-12))
                                            for p in probabilities], temperature))

    distribution = dict(zip(keys, probabilities))
    # A server that computed confidence is believed; one that did not (a readout
    # wire, or Kev on a noul) gets the spread. Same rule for every wire.
    served = readout.provenance.get("confidence")
    spread = (float(served) if served is not None
              else confidence(probabilities, ordered=isinstance(question, Score)))

    if isinstance(question, Noul):
        value: Any = distribution["true"]
    elif isinstance(question, Score):
        value = sum(index * probability
                    for index, probability in enumerate(probabilities))
    else:
        value = max(distribution, key=distribution.__getitem__)

    return Answer(
        kind=question.kind,
        probabilities=distribution,
        value=value,
        confidence=spread,
        model=readout.provenance.get("model") or model,
        wire=wire,
        revision=readout.provenance.get("revision"),
        temperature=readout.provenance.get("temperature",
                                           getattr(quirks, "temperature", None)),
        mass=readout.mass,
        legend=legend_for(question),
    )
