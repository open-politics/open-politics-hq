"""
Provider Registry — single-entry resolution.
=============================================

One public function: ``resolve(capability, ...)``. It loads owner credentials
from the infospace, applies PROVIDER_ACCESS rules, constructs the provider, and
returns a ``Resolved`` wrapper carrying ``.model`` and ``.provider_key``.

Provider declarations live in ``providers.py`` (imported at the bottom so the
``@provider`` decorator populates the registry on first import).

Three public exports:
- ``resolve()``    — build a provider instance
- ``Resolved``     — return type, delegates to the instance, carries model metadata
- ``ProviderError`` — raised on any failure

Nothing else is public. Callers never see credentials, descriptors, or config
dicts. If you need to construct a provider, you call ``resolve``.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Type

from sqlmodel import Session

from app.core.config import AppSettings
from app.core.security import CredentialDecryptionError
from app.api.modules.foundation_service_providers.base import (
    ModelSpec,
    LLMModelSpec,
    EmbeddingModelSpec,
    ProviderSelection,
    StorageProvider,
    ScrapingProvider,
    WebSearchProvider,
    EmbeddingProvider,
    GeocodingProvider,
    OcrProvider,
    LanguageModelProvider,
)

logger = logging.getLogger(__name__)


# ── Errors & Return Type ──────────────────────────────────────────────────────


class ProviderError(RuntimeError):
    """Raised by resolve() for any failure to produce a provider instance.

    The message is user-facing — it should tell a human operator what to fix.
    """


class Resolved:
    """Delegates attribute access to the provider instance.

    Carries the resolved ``model`` and ``provider_key`` so callers can feed them
    back into provider methods (``p.generate(messages, model_name=p.model)``)
    without re-plumbing configuration.
    """
    __slots__ = ("_instance", "model", "provider_key")

    def __init__(self, instance: Any, model: Optional[str], provider_key: str):
        object.__setattr__(self, "_instance", instance)
        object.__setattr__(self, "model", model)
        object.__setattr__(self, "provider_key", provider_key)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._instance, name)

    def __repr__(self) -> str:
        return f"Resolved(provider_key={self.provider_key!r}, model={self.model!r})"


# ── Framework: Setting, Capability, ProviderDescriptor ───────────────────────


class Setting:
    """Reference to an AppSettings attribute, resolved at construction time."""
    __slots__ = ("attr_name", "default")

    def __init__(self, attr_name: str, default=None):
        self.attr_name = attr_name
        self.default = default


class Capability:
    """One capability binding for a provider declaration.

    ``model_required=True`` means resolve raises ProviderError if no model is
    determined from args or config. Set False for providers with a single
    fixed implementation (Tesseract, NominatimAPI, SearXNG, MinIO, ...).
    """
    __slots__ = ("impl", "models", "extra", "model_required")

    def __init__(
        self,
        impl: str,
        *,
        models=None,
        extra=None,
        model_required: bool = True,
    ):
        self.impl = impl
        self.models = models or []
        self.extra = extra
        self.model_required = model_required


@dataclass
class ProviderDescriptor:
    """Internal runtime descriptor — one per (capability, provider_key) pair."""
    capability: str                                # "language", "embedding", ...
    protocol: Type                                 # LanguageModelProvider, ...
    provider_key: str                              # "openai", "ollama", ...
    impl: str                                      # "module.ClassName" under implemented/
    credential_key: Optional[str] = None
    api_key_setting: Optional[str] = None
    base_url_setting: Optional[str] = None
    base_url_default: Optional[str] = None
    extra_config: Optional[Callable] = None
    models: List[ModelSpec] = field(default_factory=list)
    contexts: Set[str] = field(default_factory=set)
    model_required: bool = True

    @property
    def requires_api_key(self) -> bool:
        return self.api_key_setting is not None

    @property
    def is_local(self) -> bool:
        return bool(self.contexts & {"local", "self_hosted"})

    def get_model(self, name: str) -> Optional[ModelSpec]:
        return next((m for m in self.models if m.name == name), None)


# ── Registry core ─────────────────────────────────────────────────────────────

_registry: Dict[tuple[str, str], ProviderDescriptor] = {}

# Capability → Protocol mapping. Sole source of truth for capability name lookups.
CAPABILITIES: Dict[str, Type] = {
    "language":   LanguageModelProvider,
    "embedding":  EmbeddingProvider,
    "ocr":        OcrProvider,
    "geocoding":  GeocodingProvider,
    "storage":    StorageProvider,
    "scraping":   ScrapingProvider,
    "web_search": WebSearchProvider,
}

# System-default provider-key env var per capability. Used when neither the
# infospace config nor the owner's defaults supply a provider_key.
# Only capabilities listed here have a system default. Language/embedding do not.
_SYSTEM_DEFAULT_SETTINGS: Dict[str, str] = {
    "storage":    "STORAGE_PROVIDER_TYPE",
    "scraping":   "SCRAPING_PROVIDER_TYPE",
    "geocoding":  "GEOCODING_PROVIDER_TYPE",
    "ocr":        "OCR_PROVIDER_TYPE",
    "web_search": "WEB_SEARCH_PROVIDER_TYPE",
}


def _register(descriptor: ProviderDescriptor) -> None:
    key = (descriptor.capability, descriptor.provider_key.lower())
    if key in _registry:
        logger.warning("Overwriting provider registration: %s", key)
    _registry[key] = descriptor


def _get_descriptor(capability: str, provider_key: str) -> Optional[ProviderDescriptor]:
    return _registry.get((capability, provider_key.lower()))


def list_providers(capability: str) -> list[tuple[str, ProviderDescriptor]]:
    """All registered providers for a capability. Public — used by discovery UIs."""
    return [(pk, desc) for (cap, pk), desc in _registry.items() if cap == capability]


def get_model_spec(capability: str, provider_key: str, model_name: str) -> Optional[ModelSpec]:
    """Read a static model spec from the declaration registry (no credentials needed).

    Returns None if the provider or model isn't declared. Useful for dimension
    lookups and capability flags where constructing a provider would be overkill.
    """
    desc = _get_descriptor(capability, provider_key)
    if not desc:
        return None
    return desc.get_model(model_name)


def _system_default_provider_key(capability: str, settings: AppSettings) -> Optional[str]:
    attr = _SYSTEM_DEFAULT_SETTINGS.get(capability)
    if not attr:
        return None
    val = getattr(settings, attr, None)
    return val.lower() if val else None


# ── @provider decorator ──────────────────────────────────────────────────────


def provider(cls):
    """Class decorator: reads Capability attributes, registers ProviderDescriptors."""
    key = cls.key
    api_key = getattr(cls, "api_key", None)
    base_url = getattr(cls, "base_url", None)
    credential_key = getattr(cls, "credential_key", key if api_key else None)
    contexts = getattr(cls, "contexts", set())

    for cap_name, protocol in CAPABILITIES.items():
        cap = getattr(cls, cap_name, None)
        if not isinstance(cap, Capability):
            continue
        desc = ProviderDescriptor(
            capability=cap_name,
            protocol=protocol,
            provider_key=key,
            impl=cap.impl,
            credential_key=credential_key,
            api_key_setting=api_key.attr_name if api_key else None,
            base_url_setting=base_url.attr_name if base_url else None,
            base_url_default=base_url.default if base_url else None,
            extra_config=cap.extra,
            models=list(cap.models),
            contexts=set(contexts),
            model_required=cap.model_required,
        )
        _register(desc)
    return cls


# ── Access gate ──────────────────────────────────────────────────────────────


def _provider_access(settings: AppSettings, capability: str, provider_key: str) -> Optional[str]:
    """PROVIDER_ACCESS value for this (capability, provider_key) pair.

    Returns "all" / "superuser" / "none" / None (unset).
    """
    return settings.provider_access.get(f"{capability}_{provider_key.lower()}")


def _is_access_blocked(settings: AppSettings, desc: ProviderDescriptor) -> bool:
    """True if PROVIDER_ACCESS explicitly blocks this provider. Used as a hard gate."""
    return _provider_access(settings, desc.capability, desc.provider_key) == "none"


def _env_key_if_granted(
    settings: AppSettings,
    desc: ProviderDescriptor,
    owner_is_superuser: bool,
) -> Optional[str]:
    """Deployment env key if PROVIDER_ACCESS grants it for this owner, else None.

    Default (unset): env key is NOT shared. Users must bring their own key.
    =all:            env key available to any infospace owner.
    =superuser:      env key available only when infospace owner is a superuser.
    =none:           provider explicitly blocked (caller should check separately).
    """
    if not desc.api_key_setting:
        return None
    access = _provider_access(settings, desc.capability, desc.provider_key)
    if access is None or access == "none":
        return None
    if access == "superuser" and not owner_is_superuser:
        return None
    return getattr(settings, desc.api_key_setting, None) or None


# ── Resolution: internal context loader ──────────────────────────────────────


@dataclass
class _Context:
    """Everything resolve needs from the database — one round trip."""
    selection: Optional[ProviderSelection]   # from enrichment_config or provider_defaults
    encrypted_credentials: Optional[str]     # owner's stored keys (or None if no infospace)
    owner_is_superuser: bool                 # for PROVIDER_ACCESS=superuser gating


def _load_from_session(
    session: Session,
    capability: str,
    infospace_id: int,
    context: Optional[str],
) -> _Context:
    """Load selection + owner credentials in one session. Used by resolve()."""
    from app.api.modules.identity_infospace_user.models import Infospace, User
    from app.api.modules.foundation_service_providers.base import (
        EnrichmentConfig,
        ProviderDefaults as PD,
    )

    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        raise ProviderError(f"Unknown infospace: {infospace_id}")

    owner = session.get(User, infospace.owner_id)
    if not owner:
        raise ProviderError(f"Infospace {infospace_id} has no owner")

    # Selection: EnrichmentConfig first (embedding/ocr/geocoding),
    # then owner's ProviderDefaults (all capabilities, language uses context override).
    selection: Optional[ProviderSelection] = None

    enrichment_caps = {"embedding", "ocr", "geocoding"}
    if capability in enrichment_caps and infospace.enrichment_config is not None:
        ec = infospace.enrichment_config
        if isinstance(ec, dict):
            ec = EnrichmentConfig(**ec)
        sel = ec.get_selection(capability)
        if sel is not None:
            selection = sel

    if selection is None and owner.provider_defaults is not None:
        pd = owner.provider_defaults
        if isinstance(pd, dict):
            pd = PD(**pd)
        selection = pd.get(capability, context)

    return _Context(
        selection=selection,
        encrypted_credentials=owner.encrypted_credentials,
        owner_is_superuser=bool(getattr(owner, "is_superuser", False)),
    )


def _load_context(
    capability: str,
    infospace_id: Optional[int],
    context: Optional[str],
    session: Optional[Session],
) -> _Context:
    """Load context — wraps _load_from_session with session management.

    When infospace_id is None, returns an empty context (no selection,
    no credentials, non-superuser). Valid for keyless infrastructure resolves
    (storage, scraping at the deployment level).
    """
    if infospace_id is None:
        return _Context(selection=None, encrypted_credentials=None, owner_is_superuser=False)

    if session is not None:
        return _load_from_session(session, capability, infospace_id, context)

    from app.core.db import engine
    with Session(engine) as s:
        return _load_from_session(s, capability, infospace_id, context)


# ── Effective-selection lookup (for preconditions, not construction) ────────


def get_selection(
    session: Session,
    infospace_id: int,
    capability: str,
    *,
    context: Optional[str] = None,
) -> Optional[ProviderSelection]:
    """Effective provider selection for (infospace, capability) via the cascade.

    Walks the same path ``resolve()`` does: ``infospace.enrichment_config`` →
    ``owner.provider_defaults``. Does **not** consult deployment system defaults —
    that's ``resolve()``'s job, and it's forbidden for embedding anyway.

    Use this as the precondition helper before calling ``resolve()``: it tells
    you whether the user (or their infospace) has picked a provider/model, which
    is the right gate for routes and tasks that want to reject fast before
    credential lookup.
    """
    if capability not in CAPABILITIES:
        raise ProviderError(f"Unknown capability: {capability}")
    return _load_from_session(session, capability, infospace_id, context).selection


# ── Resolution: construction ─────────────────────────────────────────────────


_IMPL_PREFIX = "app.api.modules.foundation_service_providers.implemented"


def _build_config(
    desc: ProviderDescriptor,
    settings: AppSettings,
    api_key: Optional[str],
    owner_is_superuser: bool,
) -> dict:
    """Build constructor kwargs from descriptor + optional api_key.

    Defense-in-depth guard: refuses to read the env key unless an explicit
    PROVIDER_ACCESS grant is in place. If new internal code ever bypasses
    resolve() and lands here without an api_key, the env key stays secret.
    """
    config: dict = {}
    if desc.api_key_setting:
        if api_key:
            config["api_key"] = api_key
        else:
            env_grant = _env_key_if_granted(settings, desc, owner_is_superuser)
            if env_grant:
                config["api_key"] = env_grant
            else:
                env_val = getattr(settings, desc.api_key_setting, None)
                if env_val:
                    raise ProviderError(
                        f"Provider '{desc.capability}/{desc.provider_key}' has a system "
                        f"API key but no PROVIDER_ACCESS grant. Set "
                        f"PROVIDER_ACCESS_{desc.capability.upper()}_{desc.provider_key.upper()}=all "
                        f"or provide credentials via the infospace owner."
                    )
    if desc.base_url_setting:
        url = getattr(settings, desc.base_url_setting, None)
        config["base_url"] = url or desc.base_url_default
    elif desc.base_url_default:
        config["base_url"] = desc.base_url_default
    if desc.extra_config:
        import inspect
        sig = inspect.signature(desc.extra_config)
        params = list(sig.parameters.keys())
        if len(params) >= 2:
            config.update(desc.extra_config(settings, desc.models))
        else:
            config.update(desc.extra_config(settings))
    return config


def _construct(desc: ProviderDescriptor, config: dict) -> Any:
    """Lazy-import the implementation class and instantiate it."""
    module_name, class_name = desc.impl.rsplit(".", 1)
    module = __import__(f"{_IMPL_PREFIX}.{module_name}", fromlist=[class_name])
    impl_class = getattr(module, class_name)
    return impl_class(**config)


# ── Resolution: the one public function ──────────────────────────────────────


def resolve(
    capability: str,
    provider_key: Optional[str] = None,
    model: Optional[str] = None,
    *,
    infospace_id: Optional[int] = None,
    context: Optional[str] = None,
    runtime_key: Optional[str] = None,
    session: Optional[Session] = None,
) -> Resolved:
    """Resolve a provider instance. One function, six arguments.

    Args:
        capability:    "language" | "embedding" | "ocr" | "geocoding" |
                       "storage" | "scraping" | "web_search"
        provider_key:  Specific provider ("anthropic", "ollama"...). When None,
                       selection comes from infospace config / owner defaults.
        model:         Model name. When None, selection comes from config.
        infospace_id:  Required for credential-bearing capabilities. Optional
                       for pure infrastructure (storage, scraping) at the
                       deployment level.
        context:       "chat" | "annotation" — only used for language capability.
                       Ignored elsewhere.
        runtime_key:   BYOK: user-supplied API key for this specific call.
                       Highest priority in the credential chain.
        session:       Optional DB session to reuse (avoids opening a new one
                       in request contexts that already have ``db``).

    Returns:
        Resolved — delegates attribute access to the provider instance, carries
        ``.model`` and ``.provider_key``.

    Raises:
        ProviderError — on unknown capability, unconfigured provider, missing
        credentials, model-required violation, or deployment-level block.
    """
    from app.core.config import settings

    if capability not in CAPABILITIES:
        raise ProviderError(f"Unknown capability: {capability}")

    # Credential-bearing capabilities require infospace context. Infrastructure
    # capabilities (storage, scraping) may omit it for deployment-level resolves.
    credential_bearing = capability in {"language", "embedding", "ocr", "geocoding", "web_search"}
    if credential_bearing and infospace_id is None:
        raise ProviderError(
            f"{capability} resolve requires infospace_id for credential resolution"
        )

    # Load selection + credentials + owner status in one DB trip (or skip, if no infospace).
    ctx = _load_context(capability, infospace_id, context, session)

    # ── Provider key: explicit arg → infospace/owner selection → system default ──
    if provider_key is None and ctx.selection is not None:
        provider_key = ctx.selection.provider_key
    if provider_key is None:
        provider_key = _system_default_provider_key(capability, settings)
    if provider_key is None:
        raise ProviderError(f"No {capability} provider configured")
    provider_key = provider_key.lower()

    desc = _get_descriptor(capability, provider_key)
    if not desc:
        raise ProviderError(f"Unknown {capability} provider: {provider_key}")

    if _is_access_blocked(settings, desc):
        raise ProviderError(f"{capability}/{provider_key} is blocked in this deployment")

    # ── Model: explicit arg → selection (if same provider) → None ──
    if model is None and ctx.selection is not None and ctx.selection.provider_key.lower() == provider_key:
        model = ctx.selection.model_name
    if model is None and desc.model_required:
        raise ProviderError(
            f"{capability}/{provider_key} requires a model selection"
        )
    if model is not None and desc.models:
        if not desc.get_model(model):
            available = ", ".join(m.name for m in desc.models)
            raise ProviderError(
                f"Model '{model}' not available on {provider_key}. Available: {available}"
            )

    # ── Credential chain (keyed providers only) ──
    api_key: Optional[str] = None
    if desc.requires_api_key:
        if runtime_key:
            api_key = runtime_key
        else:
            try:
                stored = _decrypt_owner_credentials(ctx.encrypted_credentials)
            except CredentialDecryptionError as e:
                # An undecryptable blob is NOT "no credentials" — masking it as
                # such would push the user to re-save and hit the wipe hazard.
                raise ProviderError(
                    f"Stored credentials for {capability}/{provider_key} are undecryptable "
                    f"(key rotation may be in progress). {e}"
                ) from e
            api_key = stored.get(desc.credential_key) if desc.credential_key else None
            if not api_key:
                env_grant = _env_key_if_granted(settings, desc, ctx.owner_is_superuser)
                if env_grant:
                    api_key = env_grant
        if not api_key:
            raise ProviderError(
                f"No credentials for {capability}/{provider_key}. "
                f"Store a key in your profile or ask the operator to set "
                f"PROVIDER_ACCESS_{capability.upper()}_{provider_key.upper()}=all"
            )

    config = _build_config(desc, settings, api_key, ctx.owner_is_superuser)
    instance = _construct(desc, config)
    return Resolved(instance, model=model, provider_key=provider_key)


def _decrypt_owner_credentials(encrypted: Optional[str]) -> Dict[str, str]:
    """Helper: decrypt once. {} only when nothing is stored.

    Propagates CredentialDecryptionError for a present-but-undecryptable blob —
    the caller wraps it into a distinct ProviderError. Never swallows to {}.
    """
    if not encrypted:
        return {}
    from app.core.security import decrypt_credentials
    return decrypt_credentials(encrypted)


# ── Capability availability (for circuit breakers) ──────────────────────────


def is_capability_available(capability: str, settings: AppSettings) -> bool:
    """Cheap deployment-level probe: is any provider for this capability available?

    Used by the dispatch filter as a circuit breaker. Checks only settings and
    PROVIDER_ACCESS grants — no DB calls, no per-infospace credential lookup.
    """
    if capability not in CAPABILITIES:
        return False
    for pk, desc in list_providers(capability):
        if _is_access_blocked(settings, desc):
            continue
        if not desc.requires_api_key:
            return True
        # Keyed providers: available if either PROVIDER_ACCESS grants the env key
        # or at least one infospace owner could plausibly have a stored key.
        # We can't know the latter without a DB scan — so we return True if the
        # provider is declared and not blocked. Full check happens at resolve-time.
        if getattr(settings, desc.api_key_setting, None):
            return True
        # Even without env key, users may have stored credentials.
        return True
    return False


# ── Startup probe ─────────────────────────────────────────────────────────────


def probe_providers(settings: Optional[AppSettings] = None) -> Dict[str, list]:
    """Probe all registered providers and return status summary. Called at worker startup."""
    if settings is None:
        from app.core.config import settings as _settings
        settings = _settings

    status: Dict[str, list] = {}
    parts = []

    for capability in CAPABILITIES:
        providers_found = []
        for pk, desc in list_providers(capability):
            if _is_access_blocked(settings, desc):
                continue
            has_key = (not desc.requires_api_key) or (
                desc.api_key_setting and getattr(settings, desc.api_key_setting, None)
            )
            if has_key:
                access = _provider_access(settings, capability, pk) or ("all" if desc.is_local else "byok")
                providers_found.append(f"{pk} ({access})")
        if providers_found:
            status[capability] = providers_found
            parts.append(f"{capability}: {', '.join(providers_found)}")
        else:
            status[capability] = []
            parts.append(f"{capability}: not configured")

    logger.info("[PROVIDERS] %s", " | ".join(parts))

    # Honest surface: state exactly which deployment env keys are actually
    # SHARED with users (keyed provider + env key present + explicit grant).
    # Everything else keyed is BYOK regardless of whether an env key exists.
    shared = []
    for capability in CAPABILITIES:
        for pk, desc in list_providers(capability):
            if not desc.requires_api_key or _is_access_blocked(settings, desc):
                continue
            if not (desc.api_key_setting and getattr(settings, desc.api_key_setting, None)):
                continue
            grant = _provider_access(settings, capability, pk)
            if grant in ("all", "superuser"):
                shared.append(f"{capability}/{pk}={grant}")
    logger.info(
        "[PROVIDERS] shared env keys: %s",
        ", ".join(shared) if shared else "none (all keyed providers are BYOK)",
    )
    return status


# ── Load provider declarations (populates _registry) ─────────────────────────
# providers.py imports Setting, Capability, provider from this module, then the
# @provider decorators execute and call _register().

from app.api.modules.foundation_service_providers.providers import *  # noqa: E402, F401, F403
