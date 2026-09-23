"""
logic/models.py — the vocabulary one decision is written in.

  Noul · Choice · Score          a question, as a caller declares it
        │
        ▼   transforms.as_options
  Option[]                       what every wire actually scores
        │
        ▼   <dialect>.ask
  Readout                        scores + where they came from — ALL a dialect returns
        │
        ▼   transforms.to_answer
  Answer                         probabilities · pick · confidence · provenance

  LogicQuirks      read by the engine and every wire — including what the
                   endpoint's model takes, since it serves exactly one
    ├── QuestionsQuirks   the System One wire (kev · typesafe)
    └── RawQuirks         the next-token readout wire (any llama-server)

  NOT IN THIS FILE
    transforms.py  every conversion drawn above — the one place a decision is shaped.
    base.py        the two contracts (LogicProvider, LogicDialect).
    engine.py      the loop that runs them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar, Dict, Literal, Mapping, Optional, Sequence, Union


# ── questions ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Option:
    """One answer a question offers. ``key`` is what the caller gets back."""
    key: str
    description: str = ""


@dataclass(frozen=True, slots=True)
class Noul:
    """A yes/no question. The answer is the probability of yes.

    ``true`` / ``false`` describe the two sides where the wording needs it; the
    System One API takes both as optional criteria.
    """
    instructions: str
    true: Optional[str] = None
    false: Optional[str] = None
    kind: ClassVar[str] = "noul"


@dataclass(frozen=True, slots=True)
class Choice:
    """Pick one option. ``criteria`` maps an option key to its description.

    The key is the caller's vocabulary — an entity id, a bundle name, a queue —
    and never reaches the model, which sees only the description.
    """
    instructions: str
    criteria: Mapping[str, Optional[str]]
    kind: ClassVar[str] = "choice"


@dataclass(frozen=True, slots=True)
class Score:
    """A rating over ordered levels, lowest first. The answer is a mean level."""
    instructions: str
    levels: Sequence[str]
    kind: ClassVar[str] = "score"


Question = Union[Noul, Choice, Score]


# ── answers ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Readout:
    """What a dialect returns, and the whole of it.

    ``scores`` are keyed by option key. A wire that reads next-token logits says
    so with ``kind="logits"`` and the engine normalises; a wire whose server
    already normalised says ``kind="probs"``. ``mass`` is the probability that
    landed on the answer slots at all — a readout-only signal, and a good one:
    low mass means the model wanted to say something else entirely.
    """
    scores: Dict[str, float]
    kind: Literal["probs", "logits"] = "probs"
    mass: Optional[float] = None
    provenance: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Answer:
    """One decided question.

    ``value`` is the kind's natural answer: the probability of yes for a noul,
    the winning key for a choice, the mean level for a score. ``probabilities``
    is always the full distribution, because the distribution is the point —
    a single label throws away the part a caller thresholds on.

    Probabilities are conditional on the options supplied. Calibrated ones say
    so through ``temperature``; treat the rest as an ordering, not a rate.
    """
    kind: str
    probabilities: Dict[str, float]
    value: Union[str, float]
    confidence: float
    model: str = ""
    wire: str = ""
    revision: Optional[str] = None
    temperature: Optional[float] = None
    mass: Optional[float] = None
    #: Score only: level index → the level's text, so a caller can render a mean.
    legend: Optional[Dict[str, str]] = None

    def p(self, key: str) -> float:
        """Probability of one option. Unknown keys are 0.0, never a KeyError."""
        return self.probabilities.get(key, 0.0)

    @property
    def pick(self) -> str:
        """The most likely option key."""
        return max(self.probabilities, key=self.probabilities.__getitem__)

    @property
    def margin(self) -> float:
        """Gap between the two most likely options; 1.0 when there is only one.

        The threshold worth reaching for when the question is "is this decided",
        as opposed to ``confidence``, which asks "how far from a coin toss".
        """
        ranked = sorted(self.probabilities.values(), reverse=True)
        return ranked[0] - ranked[1] if len(ranked) > 1 else 1.0


# ── quirks ────────────────────────────────────────────────────────────────────
#
# There is no LogicModelSpec. A decision endpoint serves one model, chosen when
# the process starts, so what the model can take is a fact about the ENDPOINT —
# not something a caller picks per request. It lives here, where a picker cannot
# offer a choice the server will ignore.


@dataclass(frozen=True)
class LogicQuirks:
    """Read by the engine, and by every wire under it.

    Only what genuinely varies per ENDPOINT lives here. Who renders the state and
    who computes confidence are decided by the wire and are the same for every
    endpoint speaking it, so they are code in the dialect, not config here.
    """

    #: Calibration temperature applied to logits. None leaves the endpoint's own
    #: calibration alone. May hold a ``Setting``: ``resolve`` reads it from
    #: HQ.yml, so an operator can tune an endpoint without a code change.
    temperature: Optional[float] = None

    #: Option ceiling of the wire this endpoint speaks.
    max_options: int = 16

    #: The state length this endpoint's model was TRAINED on. Not a limit — the
    #: server takes more — but past it the answer is extrapolation, so the engine
    #: says so once in the log. 0 means no claim, and no warning.
    trained_state_tokens: int = 0

    #: How many requests this endpoint serves at once — the width of the
    #: semaphore in ``judge_many``. Kev answers one at a time and says so.
    parallel: int = 1


@dataclass(frozen=True)
class QuestionsQuirks(LogicQuirks):
    """`questions` — TypeSafe's System One shape. Kev serves it, so does Jev."""

    #: Which header carries the credential. (kev: keyless; typesafe: bearer.)
    auth_header: Literal["none", "bearer"] = "none"

    #: What goes in the request's `model` field when the caller named none.
    model_name: str = "kev-latest"

    #: What the System One API documents. The readout wire's 16 answer letters
    #: are the other end of this range.
    max_options: int = 255


@dataclass(frozen=True)
class RawQuirks(LogicQuirks):
    """`raw` — next-token readout on any llama-server. No decision training."""

    #: llama-server's `chat_template_kwargs` key that turns the GGUF's own
    #: reasoning off — a readout must not spend its one token on a <think>.
    no_thinking_template_kwarg: Optional[str] = "enable_thinking"

    #: How many next-token probabilities to ask for. The answer letters have to
    #: land inside this window; anything below it is bounded by the window's floor.
    top_n: int = 64

    #: Answer slots, in order. Each must be one token under the server's
    #: tokenizer — the dialect verifies that rather than assuming it.
    labels: str = "ABCDEFGHIJKLMNOP"

    #: One llama-server slot holds the state's KV cache, so consecutive questions
    #: about one state reuse it instead of re-reading the document.
    slot: Optional[int] = 0
