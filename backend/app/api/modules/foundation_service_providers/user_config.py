"""
user_config.py — what a user or infospace has *chosen*.

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

  BACK-COMPAT, for rows written before the renames
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

from pydantic import BaseModel, model_validator


class ProviderSelection(BaseModel):
    """A typed provider+model choice."""
    provider_key: str
    model_name: Optional[str] = None
    # For variable-dimension models; inert until a `matryoshka` feature reads it.
    dimension: Optional[int] = None

    model_config = {"populate_by_name": True}

    @model_validator(mode="before")
    @classmethod
    def _accept_type_key(cls, data):
        """`type_key` was this field's first name; stored rows still carry it."""
        if isinstance(data, dict) and "type_key" in data:
            data = {**data}
            data.setdefault("provider_key", data["type_key"])
            data.pop("type_key")
        return data


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

    Completeness checks live in ``validate_provider_defaults()``, called from
    save-path endpoints only — the model itself stays permissive so DB rows with
    partial selections still deserialize.
    """
    language: Optional[LanguageDefaults] = None
    embedding: Optional[ProviderSelection] = None
    web_search: Optional[ProviderSelection] = None
    ocr: Optional[ProviderSelection] = None
    geocoding: Optional[ProviderSelection] = None

    @model_validator(mode="before")
    @classmethod
    def _accept_search(cls, data):
        """`search` was `web_search`'s first name."""
        if isinstance(data, dict) and "search" in data:
            data = {**data}
            data.setdefault("web_search", data["search"])
            data.pop("search")
        return data

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
    """What one infospace says about the enrichers. Three states per field:

      True | ProviderSelection   on, the second one naming provider and model
      False                      off, overriding the deployment
      None / absent              not stated — the deployment's default stands

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

    def state_of(self, enricher_name: str) -> Optional[bool]:
        """This infospace's answer for one enricher, or None for "not stated"."""
        val = getattr(self, enricher_name, None)
        if val is None:
            return None
        if isinstance(val, bool):
            return val
        return True      # a ProviderSelection is a choice, so it is an enable

    def provider_for(self, capability: str) -> Optional[ProviderSelection]:
        val = getattr(self, capability, None)
        if isinstance(val, dict):
            return ProviderSelection(**val)
        if isinstance(val, ProviderSelection):
            return val
        return None


def enricher_enabled(
    enricher_name: str,
    config: Optional[EnrichmentConfig],
    *,
    deployment_default: bool,
) -> bool:
    """Deployment default, unless this infospace said otherwise about this one.

    Silence is the point: turning ocr on must not turn hash off.
    """
    stated = config.state_of(enricher_name) if config is not None else None
    return deployment_default if stated is None else stated


#: Enrichment fields carrying a ProviderSelection. Derived, never hand-listed.
SELECTABLE_ENRICHERS = tuple(
    name for name, f in EnrichmentConfig.model_fields.items()
    if "ProviderSelection" in str(f.annotation)
)


# Save-time validation. Validating on read would lock users out of older config.


def _assert_model_required(capability: str, sel: Optional[ProviderSelection]) -> None:
    """Raise ``ValueError`` if the provider needs a model and none is set.

    A presence check, not a membership check: an undeclared model name is legal,
    so this only insists that some model was chosen where one is needed.
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
