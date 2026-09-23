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

import logging
from typing import Any, Dict, List, Optional

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
