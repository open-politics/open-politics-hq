"""
logic dialects — how a decision request and its reply are shaped.

  questions   TypeSafe's System One: one state, many isolated questions, one
              POST. Kev serves it locally; Jev serves it hosted.
  raw         next-token readout on any llama-server: no decision training, no
              packing, one forward pass per question over a cached prefix.

Both answer the same ``ask`` and return ``Readout``s keyed the same way, so the
engine above them cannot tell which replied.
"""

from app.api.modules.foundation_service_providers.logic.provider import Logic
from app.api.modules.foundation_service_providers.logic.models import (
    QuestionsQuirks, RawQuirks,
)


Logic.dialect("questions", module="questions", adapter="QuestionsWire",
              path="/v1/systemone", quirks_type=QuestionsQuirks)

Logic.dialect("raw", module="raw", adapter="RawReadout",
              path="/completion", quirks_type=RawQuirks)
