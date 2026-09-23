"""
logic/provider.py — the Logic Domain.

   base.py    LogicProvider ─┐
   models.py  LogicQuirks   ─┴──►  Logic = Domain(…)
                                      │
   dialects/__init__.py  ──►  questions · raw
   providers.py          ──►  Logic(dialect=…, quirks=…) per endpoint
"""

from __future__ import annotations

from app.api.modules.foundation_service_providers.primitives import Domain
from app.api.modules.foundation_service_providers.logic.base import LogicProvider
from app.api.modules.foundation_service_providers.logic.models import LogicQuirks


Logic = Domain(
    name="logic",
    description="Classification, Decisions, Routing & Ranking for atomic decision making",
    protocol=LogicProvider,
    package="app.api.modules.foundation_service_providers.logic",
    engine="engine.Judge",
    quirks_type=LogicQuirks,
    # Unlike language, a deployment MAY answer for everyone: a decision backend is
    # infrastructure, like ocr or geocoding, and `foundation.use.logic` names it.
    system_default="LOGIC_PROVIDER_TYPE",
)
