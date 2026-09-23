"""
logic — a state and typed questions in, probabilities out.

  models.py      the data        Noul · Choice · Score · Option · Readout · Answer
  transforms.py  shared shaping  THE place a decision is shaped
  base.py        the contracts   LogicProvider · LogicDialect
  provider.py    the Domain      Logic = Domain(name="logic", …)
  engine.py      the loop        Judge — validate · aggregate · shape · provenance
       │
       ▼
  dialects/  ──►  questions (System One: kev · typesafe) · raw (llama-server readout)

    p = resolve("logic", infospace_id=5)
    await p.judge(article.text_content, {
        "relevant": Noul("Does this report on a concrete political event?"),
        "queue":    Choice("Which desk should take it?", {"politics": …, "business": …}),
    })

One state, many questions, one request: that is the unit every wire optimises,
and the reason a caller batches by state rather than by question.

A probability here is conditional on the options supplied and is not a measured
accuracy rate. Calibrated endpoints say so on the Answer (`temperature`); for the
rest, treat it as an ordering and validate a threshold on your own data.
"""

from app.api.modules.foundation_service_providers.logic.models import (
    Answer, Choice, LogicQuirks, Noul, Option, Question,
    QuestionsQuirks, RawQuirks, Readout, Score,
)
from app.api.modules.foundation_service_providers.logic.base import (
    LogicDialect, LogicProvider,
)
from app.api.modules.foundation_service_providers.logic.provider import Logic

# Register the wires and surfaces. Must follow the Domain they attach to.
from app.api.modules.foundation_service_providers.logic import dialects, features  # noqa: F401


__all__ = [
    "Logic", "LogicProvider", "LogicDialect",
    "LogicQuirks", "QuestionsQuirks", "RawQuirks",
    "Noul", "Choice", "Score", "Question", "Option", "Answer", "Readout",
]
