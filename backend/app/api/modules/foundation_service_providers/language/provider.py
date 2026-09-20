"""
language/provider.py — the Domain itself.

   base.py    LanguageModelProvider ─┐
   quirks.py  LanguageQuirks        ─┴──►  Language = Domain(…)
                                              │
   dialects/__init__.py  ──►  blocks · turns · items
   features/__init__.py  ──►  six optional surfaces
   providers.py          ──►  Language(dialect=…, quirks=…) per endpoint

   No system_default: a language provider and model must be chosen, never
   inherited from a deployment env var.
"""

from __future__ import annotations

from app.api.modules.foundation_service_providers.primitives import Domain
from app.api.modules.foundation_service_providers.language.base import LanguageModelProvider
from app.api.modules.foundation_service_providers.language.quirks import LanguageQuirks


Language = Domain(
    name="language",
    protocol=LanguageModelProvider,
    package="app.api.modules.foundation_service_providers.language",
    engine="engine.DialectProvider",
    quirks_type=LanguageQuirks,
    # No system_default: language must be chosen, never inherited from env.
)
