"""Routes for the logic domain — run a decision, and keep one if it was any good.

Two halves, deliberately unconnected:

``POST /judge``      runs a decision NOW and returns the distribution. Ephemeral:
                     nothing is written, nothing is scheduled, and it works the
                     same whether the decision was ever saved.
``/decisions`` CRUD  a notebook. Name, description, one JSONB dump. Nothing
                     points at a Decision, so deleting one is a delete.

The saved config is never parsed here. A decision is validated by *running* it,
which is the only check that means anything, and the panel is where its shape is
still being worked out — see ``modules/logic/models.py``.
"""

import json
import logging
from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.api.dependency_injection import get_db
from app.api.modules.identity_infospace_user.access import Access, Capability, Requires
from app.api.modules.foundation_service_providers import ProviderError, resolve
from app.api.modules.foundation_service_providers.logic import Choice, Noul, Score
from app.models import Decision

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/infospaces/{infospace_id}/logic", tags=["Logic"])


# ── wire shapes ──────────────────────────────────────────────────────────────


class QuestionIn(BaseModel):
    """One question, in the System One shape the panel builds."""
    type: str                                   # noul | choice | score
    instructions: str
    #: noul → {"true": …, "false": …} · choice → {key: description} · score → [levels]
    criteria: Optional[Any] = None


class JudgeRequest(BaseModel):
    state: Any                                  # str | dict | list — the evidence
    questions: Dict[str, QuestionIn] = Field(min_length=1)
    provider_key: Optional[str] = None          # override, else the configured default
    model_name: Optional[str] = None


class AnswerOut(BaseModel):
    kind: str
    value: Any                                  # noul: p(yes) · choice: key · score: mean
    probabilities: Dict[str, float]
    confidence: float
    pick: str
    margin: float
    mass: Optional[float] = None
    legend: Optional[Dict[str, str]] = None
    model: str = ""
    wire: str = ""
    temperature: Optional[float] = None


class JudgeResponse(BaseModel):
    provider_key: str
    answers: Dict[str, AnswerOut]


class DraftRequest(BaseModel):
    """Prose in, questions out. The evidence rides along so they fit it."""
    prose: str
    state: Optional[Any] = None
    #: Whose language setting to spend — "chat" (someone is waiting) or
    #: "annotation". Anything else falls through to their `default`.
    context: str = "chat"


class DraftResponse(BaseModel):
    """The draft, in the exact shape ``/judge`` takes — one contract out."""
    questions: Dict[str, QuestionIn]


# What the writer must produce. Stricter than ``QuestionIn``, and deliberately:
# `criteria` there is `Any`, because the wire accepts three shapes, so a schema
# built from it tells a model nothing and it guesses — a score came back keyed
# like a choice. Here the per-type shape is IN the schema, so structured output
# constrains generation instead of a paragraph asking it to behave. The public
# contract above is untouched; these exist only between here and the model.

class _NoulDraft(BaseModel):
    type: Literal["noul"]
    instructions: str
    criteria: Optional[Dict[str, str]] = None      # {"true": …, "false": …}


class _ChoiceDraft(BaseModel):
    type: Literal["choice"]
    instructions: str
    criteria: Dict[str, str] = Field(min_length=2, max_length=16)   # {option: description}


class _ScoreDraft(BaseModel):
    type: Literal["score"]
    instructions: str
    criteria: List[str] = Field(min_length=2, max_length=16)        # levels, lowest first


class _Drafted(BaseModel):
    questions: Dict[str, Annotated[
        Union[_NoulDraft, _ChoiceDraft, _ScoreDraft], Field(discriminator="type")
    ]]


class DecisionIn(BaseModel):
    name: str
    description: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict)


class DecisionOut(BaseModel):
    id: int
    uuid: str
    name: str
    description: Optional[str] = None
    config: Dict[str, Any]


def _question(key: str, q: QuestionIn):
    """Panel JSON → a typed question. The only parsing this module does."""
    criteria = q.criteria
    if q.type == "noul":
        sides = criteria or {}
        return Noul(q.instructions, true=sides.get("true"), false=sides.get("false"))
    if q.type == "choice":
        if not isinstance(criteria, dict) or not criteria:
            raise HTTPException(422, f"{key}: a choice needs criteria {{option: description}}")
        return Choice(q.instructions, criteria)
    if q.type == "score":
        if not isinstance(criteria, list) or len(criteria) < 2:
            raise HTTPException(422, f"{key}: a score needs at least two levels")
        return Score(q.instructions, tuple(criteria))
    raise HTTPException(422, f"{key}: unknown question type {q.type!r}")


# ── run one ──────────────────────────────────────────────────────────────────


@router.post("/judge", response_model=JudgeResponse)
async def judge(
    *,
    body: JudgeRequest,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    db: Session = Depends(get_db),
) -> Any:
    """Decide these questions about this state, now. Writes nothing."""
    # Parse before resolving: a question we cannot ask is wrong whether or not a
    # provider is configured, and "no logic provider" is a useless thing to hear
    # about a malformed choice.
    questions = {key: _question(key, q) for key, q in body.questions.items()}

    try:
        provider = resolve("logic", body.provider_key, body.model_name,
                           infospace_id=access.infospace_id, session=db)
    except ProviderError as e:
        # Unconfigured or unreachable is the operator's problem to fix, and the
        # message already says which — pass it through rather than a bare 500.
        raise HTTPException(400, str(e))

    try:
        answers = await provider.judge(body.state, questions, model_name=provider.model)
    except ValueError as e:
        raise HTTPException(422, str(e))            # a question we cannot ask
    except Exception as e:
        logger.warning("logic/%s failed to judge: %s", provider.provider_key, e)
        raise HTTPException(502, f"{provider.provider_key} could not answer: {e}")

    return JudgeResponse(
        provider_key=provider.provider_key,
        answers={
            key: AnswerOut(
                kind=a.kind, value=a.value, probabilities=a.probabilities,
                confidence=a.confidence, pick=a.pick, margin=a.margin, mass=a.mass,
                legend=a.legend, model=a.model, wire=a.wire, temperature=a.temperature,
            )
            for key, a in answers.items()
        },
    )


# ── draft one ────────────────────────────────────────────────────────────────


_DRAFT_SYSTEM = """\
You write the questions for a decision engine. Reply with JSON matching the \
schema and nothing else — no explanation, no code fence.

What each type is for, and the criteria it takes:

* noul   — a yes/no call. criteria is optional: {"true": "...", "false": "..."} \
  only where the two sides need spelling out.
* choice — pick one of several. criteria is {option_key: description}. The model \
  deciding sees ONLY the descriptions, never the keys, so each description has \
  to stand on its own: "Delivery status, delays, lost packages", not "shipping".
* score  — a rating on a scale. criteria is an ordered list of level \
  descriptions, lowest first.

Rules that decide whether the decision is answerable:

* Keys are for the caller's code: short, snake_case, stable.
* Two to sixteen options. One option is not a decision, and past sixteen the \
  readout backends run out of answer slots.
* One question per decision. "Which team, and is it urgent" is two questions, \
  and asking them separately is what makes each probability mean something.
* Ask only what the evidence could answer. A question whose answer is not in \
  the text returns a confident number about nothing.
* Where a decision could be "not enough information", make that an explicit \
  option rather than leaving the model to spread its uncertainty.
"""


@router.post("/draft", response_model=DraftResponse)
async def draft(
    *,
    body: DraftRequest,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    db: Session = Depends(get_db),
) -> Any:
    """Prose → proposed questions. Optional, and it decides nothing.

    The draft lands in the form for a person to edit and run; nothing here
    judges anything. Same seam as the graph assistant: the writer proposes, a
    person commits.
    """
    from app.api.modules.foundation_service_providers import (
        get_configured_foundation_provider,
    )

    # The user's own language settings, through the normal cascade — infospace
    # config → owner defaults → deployment default. `context` picks which of
    # their overrides applies, so "the model I talk to" means what it says.
    configured = get_configured_foundation_provider(
        db, access.infospace_id, "language", context=body.context,
    )
    try:
        writer = resolve(
            "language",
            configured.provider_key if configured else None,
            configured.model_name if configured else None,
            infospace_id=access.infospace_id, context=body.context, session=db,
        )
    except ProviderError as e:
        raise HTTPException(
            400,
            f"No language model available for this infospace: {e}. Set one under "
            f"the infospace's providers, or in your own defaults.",
        )

    evidence = json.dumps(body.state, ensure_ascii=False, default=str)[:8000] if body.state else ""
    reply = await writer.generate(
        messages=[
            {"role": "system", "content": _DRAFT_SYSTEM},
            {"role": "user", "content": (f"EVIDENCE\n{evidence}\n\n" if evidence else "")
                                        + f"WHAT I WANT TO DECIDE\n{body.prose}"},
        ],
        model_name=writer.model,
        response_format=_Drafted.model_json_schema(),
    )

    text = (getattr(reply, "content", None) or "").strip()
    if text.startswith("```"):                      # models fence things
        text = text.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        # The FIRST json value, not the whole string. A model that has answered
        # often keeps talking — a second object, a closing remark — and
        # `json.loads` rejects the lot over text nobody needed. `raw_decode`
        # stops where the draft ends.
        start = text.find("{")
        draft, _ = json.JSONDecoder().raw_decode(text[start:] if start >= 0 else text)
        # Validate against the strict shape, hand back the public one.
        written = _Drafted(**draft)
        return DraftResponse(questions={
            key: QuestionIn(**q.model_dump()) for key, q in written.questions.items()
        })
    except Exception as e:
        # The draft is unusable, and retrying the same prompt rarely helps — say
        # what broke AND what came back, so the prose can be sharpened instead.
        logger.warning("logic draft from %s did not parse: %s", writer.provider_key, e)
        raise HTTPException(502, f"The model's draft could not be read ({e}): {text[:200]}")


# ── keep one ─────────────────────────────────────────────────────────────────


@router.get("/decisions", response_model=List[DecisionOut])
def list_decisions(
    *,
    access: Access = Requires(scope=None),
    db: Session = Depends(get_db),
) -> Any:
    """Saved decisions in this infospace, newest first."""
    rows = db.exec(
        select(Decision)
        .where(Decision.infospace_id == access.infospace_id)
        .order_by(Decision.created_at.desc())
    ).all()
    return list(rows)


@router.post("/decisions", response_model=DecisionOut)
def save_decision(
    *,
    body: DecisionIn,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    db: Session = Depends(get_db),
) -> Any:
    """Keep one. The config is stored as sent — nothing here reads it."""
    row = Decision(
        name=body.name, description=body.description, config=body.config,
        infospace_id=access.infospace_id, user_id=access.user_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/decisions/{decision_id}", status_code=204)
def delete_decision(
    *,
    decision_id: int,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    db: Session = Depends(get_db),
) -> None:
    """Throw one away. Nothing references it, so there is nothing to cascade."""
    row = db.get(Decision, decision_id)
    if not row or row.infospace_id != access.infospace_id:
        raise HTTPException(404, "Decision not found")
    db.delete(row)
    db.commit()
