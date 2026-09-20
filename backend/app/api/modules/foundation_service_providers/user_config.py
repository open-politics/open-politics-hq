"""
user_config.py — what a user or infospace has *chosen*.
=======================================================

  Infospace.enrichment_config ──► EnrichmentConfig   per-infospace, opt-in
       ocr, geocoding            True | ProviderSelection | None
       embedding                 ProviderSelection | None (never bare True)
       language_detection, quality_score, hash       True | None
                    │
                    ▼        resolve() checks the infospace config FIRST
  owner.provider_defaults ──► ProviderDefaults       per-user
       language                  LanguageDefaults(default/chat/annotation)
       embedding, web_search, ocr, geocoding         ProviderSelection | None
                    │
                    ▼
  deployment default   Domain.system_default, in primitives.py

  ProviderSelection(provider_key, model_name, dimension=None)
       the one unit both configs bind down to

  BACK-COMPAT, in the constructors only
    ProviderSelection.type_key  ──► provider_key
    ProviderDefaults.search     ──► web_search

  SELECTABLE_ENRICHERS ◄── derived from EnrichmentConfig.model_fields,
                            never hand-listed

  NOT IN THIS FILE
    primitives.py  descriptor_for() — what a selection is checked against.
    resolve.py     walks this cascade — resolve()'s step 1, "context".

  Validated at save time only — checking on read would lock users out
  of older config.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class ProviderSelection(BaseModel):
    """A typed provider+model choice."""
    provider_key: str
    model_name: Optional[str] = None
    # For variable-dimension models; inert until a `matryoshka` feature reads it.
    dimension: Optional[int] = None

    class Config:
        populate_by_name = True

    @classmethod
    def __get_validators__(cls):
        yield cls._compat_validator

    @classmethod
    def _compat_validator(cls, v):
        if isinstance(v, dict) and "type_key" in v and "provider_key" not in v:
            v = {**v, "provider_key": v.pop("type_key")}
        return v

    def __init__(self, **data):
        # Backwards compat with rows written before the rename.
        if "type_key" in data and "provider_key" not in data:
            data["provider_key"] = data.pop("type_key")
        elif "type_key" in data:
            data.pop("type_key")
        super().__init__(**data)

    @property
    def type_key(self) -> str:
        """Backwards-compat accessor."""
        return self.provider_key


class LanguageDefaults(BaseModel):
    """Language defaults with context-specific overrides.

    ``default`` is the base choice. ``chat`` and ``annotation`` override it for
    those contexts; ``resolve(context=...)`` checks the override first.
    """
    default: Optional[ProviderSelection] = None
    chat: Optional[ProviderSelection] = None
    annotation: Optional[ProviderSelection] = None

    def resolve(self, context: Optional[str] = None) -> Optional[ProviderSelection]:
        if context:
            override = getattr(self, context, None)
            if override:
                return override
        return self.default


class ProviderDefaults(BaseModel):
    """A user's per-domain provider preferences.

    Completeness checks live in ``validate_provider_defaults()`` — call it from
    save-path endpoints only. The model itself stays permissive so existing DB
    rows with partial selections still deserialize.
    """
    language: Optional[LanguageDefaults] = None
    embedding: Optional[ProviderSelection] = None
    web_search: Optional[ProviderSelection] = None
    ocr: Optional[ProviderSelection] = None
    geocoding: Optional[ProviderSelection] = None

    def __init__(self, **data):
        # "search" was the field's first name.
        if "search" in data and "web_search" not in data:
            data["web_search"] = data.pop("search")
        elif "search" in data:
            data.pop("search")
        super().__init__(**data)

    def provider_for(
        self, capability: str, context: Optional[str] = None
    ) -> Optional[ProviderSelection]:
        """Configured provider for a domain, with optional context override."""
        cap = getattr(self, capability, None)
        if cap is None:
            return None
        if isinstance(cap, LanguageDefaults):
            return cap.resolve(context)
        return cap


class EnrichmentConfig(BaseModel):
    """Per-infospace enrichment configuration. Every enricher is opt-in.

    Each field is either ``True`` (enable with system defaults), a
    ``ProviderSelection`` (enable with a specific provider+model), or
    ``None``/missing (disabled).

    Embedding is always ``ProviderSelection`` — you cannot embed without
    choosing a provider and a model, because the vector dimension depends on it.
    """
    ocr: Optional[bool | ProviderSelection] = None
    geocoding: Optional[bool | ProviderSelection] = None
    language_detection: Optional[bool] = None
    quality_score: Optional[bool] = None
    hash: Optional[bool] = None
    embedding: Optional[ProviderSelection] = None
    embedding_dimension_override: Optional[int] = None

    def is_enabled(self, enricher_name: str) -> bool:
        val = getattr(self, enricher_name, None)
        if val is None:
            return False
        if isinstance(val, bool):
            return val
        if isinstance(val, (ProviderSelection, dict)):
            return True
        return False

    def provider_for(self, capability: str) -> Optional[ProviderSelection]:
        val = getattr(self, capability, None)
        if isinstance(val, dict):
            return ProviderSelection(**val)
        if isinstance(val, ProviderSelection):
            return val
        return None


#: Enrichment fields carrying a ProviderSelection. Derived, never hand-listed.
SELECTABLE_ENRICHERS = tuple(
    name for name, f in EnrichmentConfig.model_fields.items()
    if "ProviderSelection" in str(f.annotation)
)


# ── Save-time validation ──────────────────────────────────────────────────────
# Save-time only: validating on read would lock users out of older config.


def _assert_model_required(capability: str, sel: Optional[ProviderSelection]) -> None:
    """Raise ``ValueError`` if the provider needs a model and none is set.

    This is a *presence* check, not a membership check — an undeclared model
    name is perfectly legal (declared specs are curated defaults, not an
    allowlist). We only insist that *some* model was chosen where one is needed.
    """
    if sel is None or not sel.provider_key:
        return
    from app.api.modules.foundation_service_providers.primitives import descriptor_for
    desc = descriptor_for(capability, sel.provider_key)
    if desc and desc.model_required and not sel.model_name:
        raise ValueError(
            f"{capability}/{sel.provider_key} requires a model_name — selection is incomplete"
        )


def validate_provider_defaults(pd: ProviderDefaults) -> None:
    """Save-time checks on a ProviderDefaults value. Raises ``ValueError``."""
    if pd.language is not None:
        _assert_model_required("language", pd.language.default)
        _assert_model_required("language", pd.language.chat)
        _assert_model_required("language", pd.language.annotation)
    _assert_model_required("embedding", pd.embedding)
    _assert_model_required("web_search", pd.web_search)
    _assert_model_required("ocr", pd.ocr)
    _assert_model_required("geocoding", pd.geocoding)


def validate_enrichment_config(ec: EnrichmentConfig) -> None:
    """Save-time checks on an EnrichmentConfig value. Raises ``ValueError``."""
    for cap in SELECTABLE_ENRICHERS:
        val = getattr(ec, cap, None)
        if isinstance(val, ProviderSelection):
            _assert_model_required(cap, val)
