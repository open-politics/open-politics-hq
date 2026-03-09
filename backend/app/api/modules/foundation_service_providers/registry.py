"""
Provider Registry
=================

Framework and machinery for provider registration. Defines the declarative
primitives (``Setting``, ``Capability``, ``@provider`` decorator,
``ProviderDescriptor``) and the registry core (``_registry``, lookup functions,
lazy construction via ``_build_config`` / ``get_provider``).

Provider declarations live in ``providers.py`` — imported at the bottom of this
file so that the registry is populated on first import.
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Type

from app.core.config import AppSettings
from app.api.modules.foundation_service_providers.base import (
    ModelSpec,
    LLMModelSpec,
    EmbeddingModelSpec,
    StorageProvider,
    ScrapingProvider,
    WebSearchProvider,
    EmbeddingProvider,
    GeocodingProvider,
    OcrProvider,
    LanguageModelProvider,
)

logger = logging.getLogger(__name__)


# ── Framework ─────────────────────────────────────────────────────────────────


class Setting:
    """Reference to an AppSettings attribute, resolved at construction time."""
    __slots__ = ("attr_name", "default")

    def __init__(self, attr_name: str, default=None):
        self.attr_name = attr_name
        self.default = default


class Capability:
    """One capability binding for a provider declaration."""
    __slots__ = ("impl", "models", "extra")

    def __init__(self, impl: str, *, models=None, extra=None):
        self.impl = impl            # "module.ClassName" relative to implemented/
        self.models = models or []   # List[ModelSpec]
        self.extra = extra           # callable(settings[, models]) -> dict, or None


@dataclass
class ProviderDescriptor:
    """Internal runtime descriptor — one per (protocol, type_key) pair."""
    protocol: Type
    type_key: str
    impl: str                                     # "module.ClassName"
    credential_key: Optional[str] = None
    api_key_setting: Optional[str] = None
    base_url_setting: Optional[str] = None
    base_url_default: Optional[str] = None
    extra_config: Optional[Callable] = None
    models: List[ModelSpec] = field(default_factory=list)
    contexts: Set[str] = field(default_factory=set)

    @property
    def requires_api_key(self) -> bool:
        return self.api_key_setting is not None

    @property
    def is_local(self) -> bool:
        return bool(self.contexts & {"local", "self_hosted"})

    def get_model(self, name: str) -> Optional[ModelSpec]:
        return next((m for m in self.models if m.name == name), None)


# ── Registry core ─────────────────────────────────────────────────────────────

_registry: Dict[tuple[Type, str], ProviderDescriptor] = {}


def register_provider(descriptor: ProviderDescriptor) -> None:
    key = (descriptor.protocol, descriptor.type_key.lower())
    if key in _registry:
        logger.warning("Overwriting provider registration: %s", key)
    _registry[key] = descriptor


def get_descriptor(protocol: Type, type_key: str) -> Optional[ProviderDescriptor]:
    return _registry.get((protocol, type_key.lower()))


def list_providers(protocol: Type) -> list[tuple[str, ProviderDescriptor]]:
    return [(k, v) for (p, k), v in _registry.items() if p == protocol]


# ── Construction ──────────────────────────────────────────────────────────────

_IMPL_PREFIX = "app.api.modules.foundation_service_providers.implemented"


def _build_config(
    desc: ProviderDescriptor,
    settings: AppSettings,
    api_key_override: Optional[str] = None,
) -> dict:
    """Build constructor kwargs from declarative descriptor fields."""
    config: dict = {}
    if desc.api_key_setting:
        key = api_key_override or getattr(settings, desc.api_key_setting, None)
        if key:
            config["api_key"] = key
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


def get_provider(
    protocol: Type,
    type_key: str,
    settings: AppSettings,
    api_key_override: Optional[str] = None,
) -> Any:
    """Lazy-import and construct a provider instance."""
    key = (protocol, type_key.lower())
    desc = _registry.get(key)
    if not desc:
        raise ValueError(f"No provider registered for {protocol.__name__} type_key={type_key}")
    config = _build_config(desc, settings, api_key_override=api_key_override)
    # Parse impl: "module.ClassName"
    parts = desc.impl.rsplit(".", 1)
    module_name, class_name = parts[0], parts[1]
    module = __import__(f"{_IMPL_PREFIX}.{module_name}", fromlist=[class_name])
    impl_class = getattr(module, class_name)
    return impl_class(**config)


# ── @provider decorator ──────────────────────────────────────────────────────

_CAPABILITY_PROTOCOLS: Dict[str, Type] = {
    "language":   LanguageModelProvider,
    "embedding":  EmbeddingProvider,
    "ocr":        OcrProvider,
    "geocoding":  GeocodingProvider,
    "storage":    StorageProvider,
    "scraping":   ScrapingProvider,
    "web_search": WebSearchProvider,
}


def provider(cls):
    """Class decorator: reads Capability attributes, registers ProviderDescriptors."""
    key = cls.key
    api_key = getattr(cls, "api_key", None)
    base_url = getattr(cls, "base_url", None)
    # credential_key defaults to key when the provider takes an api_key
    credential_key = getattr(cls, "credential_key", key if api_key else None)
    contexts = getattr(cls, "contexts", set())

    for attr_name, protocol in _CAPABILITY_PROTOCOLS.items():
        cap = getattr(cls, attr_name, None)
        if not isinstance(cap, Capability):
            continue
        desc = ProviderDescriptor(
            protocol=protocol,
            type_key=key,
            impl=cap.impl,
            credential_key=credential_key,
            api_key_setting=api_key.attr_name if api_key else None,
            base_url_setting=base_url.attr_name if base_url else None,
            base_url_default=base_url.default if base_url else None,
            extra_config=cap.extra,
            models=list(cap.models),
            contexts=set(contexts),
        )
        register_provider(desc)
    return cls


# ── Access & capability protocol prefix ───────────────────────────────────────

_PROTOCOL_ACCESS_PREFIX: Dict[str, str] = {
    "StorageProvider": "storage",
    "ScrapingProvider": "scraping",
    "WebSearchProvider": "websearch",
    "EmbeddingProvider": "embedding",
    "GeocodingProvider": "geocoding",
    "OcrProvider": "ocr",
    "LanguageModelProvider": "language",
}

# System-default type_key settings — protocols that have a single deployment-wide default.
# Protocols not listed here (LLM, Embedding, WebSearch) have no system default;
# type_key must come from a domain object or user preference.
_SYSTEM_DEFAULT_SETTINGS: Dict[str, str] = {
    "StorageProvider": "STORAGE_PROVIDER_TYPE",
    "ScrapingProvider": "SCRAPING_PROVIDER_TYPE",
    "GeocodingProvider": "GEOCODING_PROVIDER_TYPE",
    "OcrProvider": "OCR_PROVIDER_TYPE",
}


def _access_prefix(protocol: Type) -> str:
    return _PROTOCOL_ACCESS_PREFIX.get(
        protocol.__name__,
        protocol.__name__.lower().replace("provider", ""),
    )


def system_default_type_key(protocol: Type, settings: AppSettings) -> Optional[str]:
    """Get the deployment-wide default type_key for a protocol, if one exists."""
    attr = _SYSTEM_DEFAULT_SETTINGS.get(protocol.__name__)
    if not attr:
        return None
    val = getattr(settings, attr, None)
    return val.lower() if val else None


# ── Resolution ────────────────────────────────────────────────────────────────


def is_accessible(
    desc: ProviderDescriptor,
    settings: AppSettings,
) -> bool:
    """Is this provider allowed in this deployment?"""
    prefix = _access_prefix(desc.protocol)
    access_key = f"{prefix}_{desc.type_key}"
    access = settings.provider_access.get(access_key)
    if access is None:
        return desc.is_local
    return access != "none"


def is_capability_available(protocol: Type, settings: AppSettings) -> bool:
    """
    Is there any usable provider for this capability in this deployment?

    Used as a circuit breaker in dispatch — if no provider can possibly work,
    skip the watcher entirely and save the query + task overhead.
    """
    for type_key, desc in list_providers(protocol):
        if not is_accessible(desc, settings):
            continue
        if not desc.requires_api_key:
            return True
        if desc.api_key_setting and getattr(settings, desc.api_key_setting, None):
            return True
    return False


def resolve(
    protocol: Type,
    type_key: str,
    settings: AppSettings,
    credentials: Optional[Dict[str, str]] = None,
) -> Optional[Any]:
    """
    Resolve a provider instance.

    Caller determines type_key (from domain object, user default, or system setting).
    Caller provides credentials (merged runtime + stored keys, or empty dict).
    This function checks access, satisfies credential requirements, and constructs.

    Returns the provider instance or None.
    """
    desc = get_descriptor(protocol, type_key)
    if not desc:
        return None
    if not is_accessible(desc, settings):
        return None
    if not desc.requires_api_key:
        return get_provider(protocol, type_key, settings)
    key = (credentials or {}).get(desc.credential_key)
    if not key and desc.api_key_setting:
        key = getattr(settings, desc.api_key_setting, None)
    if not key:
        return None
    return get_provider(protocol, type_key, settings, api_key_override=key)


def load_credentials(
    session: Any,
    user_id: int,
    runtime_keys: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Load and merge user credentials for provider resolution."""
    from app.core.security import merge_credentials as _merge
    from app.models import User

    user = session.get(User, user_id)
    encrypted = user.encrypted_credentials if user else None
    return _merge(encrypted, runtime_keys)


# ── Model discovery ───────────────────────────────────────────────────────────


def discover_models(
    protocol: Type,
    settings: AppSettings,
    credentials: Optional[Dict[str, str]] = None,
) -> List[dict]:
    """
    Discover available models for a capability.

    Iterates all registered providers for the protocol, checks accessibility
    and credential availability, then collects model specs.
    """
    results: List[dict] = []

    for type_key, desc in list_providers(protocol):
        if not is_accessible(desc, settings):
            continue
        if desc.requires_api_key:
            cred = (credentials or {}).get(desc.credential_key)
            if not cred and desc.api_key_setting:
                cred = getattr(settings, desc.api_key_setting, None)
            if not cred:
                continue

        if desc.models:
            for spec in desc.models:
                entry: dict = {"name": spec.name, "provider": type_key}
                if isinstance(spec, LLMModelSpec):
                    entry.update({
                        "supports_tools": spec.supports_tools,
                        "supports_streaming": spec.supports_streaming,
                        "supports_thinking": spec.supports_thinking,
                        "supports_multimodal": spec.supports_multimodal,
                        "supports_structured_output": spec.supports_structured_output,
                    })
                    if spec.max_tokens:
                        entry["max_tokens"] = spec.max_tokens
                    if spec.context_length:
                        entry["context_length"] = spec.context_length
                elif isinstance(spec, EmbeddingModelSpec):
                    entry["dimension"] = spec.dimension
                    entry["max_sequence_length"] = spec.max_sequence_length
                if spec.description:
                    entry["description"] = spec.description
                results.append(entry)
        else:
            try:
                provider_instance = resolve(protocol, type_key, settings, credentials)
                if provider_instance and hasattr(provider_instance, "discover_models"):
                    import asyncio
                    try:
                        loop = asyncio.get_running_loop()
                    except RuntimeError:
                        loop = None
                    if loop and loop.is_running():
                        pass
                    else:
                        discovered = asyncio.run(provider_instance.discover_models())
                        for model_info in discovered:
                            if hasattr(model_info, "name"):
                                results.append({"name": model_info.name, "provider": type_key})
                            elif isinstance(model_info, str):
                                results.append({"name": model_info, "provider": type_key})
            except Exception as e:
                logger.debug("Runtime model discovery failed for %s: %s", type_key, e)

    return results


# ── Startup probe ─────────────────────────────────────────────────────────────


def probe_providers(settings: Optional[AppSettings] = None) -> Dict[str, str]:
    """Probe all configured provider types and return status summary. Called at worker startup."""
    if settings is None:
        from app.core.config import settings as _settings
        settings = _settings

    protocols = [
        ("Storage", StorageProvider),
        ("OCR", OcrProvider),
        ("Embedding", EmbeddingProvider),
        ("LLM", LanguageModelProvider),
        ("Geocoding", GeocodingProvider),
        ("Web Search", WebSearchProvider),
    ]

    status: Dict[str, str] = {}
    parts = []

    for label, protocol in protocols:
        found = False
        for tk, desc in list_providers(protocol):
            if is_accessible(desc, settings):
                if not desc.requires_api_key or (
                    desc.api_key_setting and getattr(settings, desc.api_key_setting, None)
                ):
                    access_key = f"{_access_prefix(protocol)}_{tk}"
                    access = settings.provider_access.get(access_key)
                    if access is None:
                        access = "all" if desc.is_local else "none"
                    status[label] = f"{tk} ({access})"
                    parts.append(f"{label}: {tk} \u2713 ({access})")
                    found = True
                    break
        if not found:
            status[label] = "not configured"
            parts.append(f"{label}: not configured")

    logger.info("[PROVIDERS] %s", " | ".join(parts))
    return status


# ── Load provider declarations (populates _registry) ─────────────────────────
# providers.py imports Setting, Capability, provider from this module, then
# the @provider decorators execute and call register_provider().
# Re-export convenience getters so existing "from .registry import get_*" works.

from app.api.modules.foundation_service_providers.providers import (  # noqa: E402, F401
    get_storage_provider,
    get_scraping_provider,
    get_web_search_provider,
    get_embedding_provider,
    get_geocoding_provider,
    get_ocr_provider,
)
