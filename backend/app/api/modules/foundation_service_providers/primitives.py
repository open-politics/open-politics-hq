"""
primitives.py — the vocabulary a declaration is written in.

  Setting     a reference to an AppSettings field
  Dialect and Feature each carry .domain: Domain — asserted in __call__

  Domain.__call__(dialect, features, quirks, models, …) ──► Binding
       wrong-domain dialect/feature ──► AssertionError, at import
       wrong-shape call             ──► TypeError, at import

  @provider
       one Endpoint (key/name/api_key/base_url/contexts) shared by every
       Binding on the class; the attribute name must equal the domain name
                    │
                    ▼
       Endpoint + Binding ──► ProviderDescriptor ──► _registry[(cap, key)]

  Resolved         what resolve() hands back
  ProviderError    every resolution failure

  NOT IN THIS FILE
    resolve.py     turns a descriptor into a live object.
    providers.py   the declarations themselves.
    models.py      ModelSpec and its subclasses.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Type

from app.core.config import AppSettings

from app.api.modules.foundation_service_providers.models import ModelSpec

logger = logging.getLogger(__name__)


# Errors and return type


class ProviderError(RuntimeError):
    """Any failure to produce a provider instance. The message is user-facing."""


class Resolved:
    """Delegates attribute access to the provider instance.

    Carries the resolved ``model``, ``provider_key`` and ``spec`` so callers can
    feed them back into provider methods (``p.generate(messages,
    model_name=p.model)``) and read capability facts (``p.spec.supports_tools``).
    ``hasattr(p, "pull_model")`` works through ``__getattr__``.
    """
    __slots__ = ("_instance", "model", "provider_key", "spec")

    def __init__(self, instance: Any, model: Optional[str], provider_key: str,
                 spec: Optional[ModelSpec] = None):
        object.__setattr__(self, "_instance", instance)
        object.__setattr__(self, "model", model)
        object.__setattr__(self, "provider_key", provider_key)
        object.__setattr__(self, "spec", spec)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._instance, name)

    def __repr__(self) -> str:
        return f"Resolved(provider_key={self.provider_key!r}, model={self.model!r})"


# Declaration vocabulary


@dataclass(frozen=True)
class Setting:
    """An ``AppSettings`` field, plus what a key picker shows.

    ``attr`` names a declared field; that field's default is the only default.
    """
    attr: str
    label: Optional[str] = None
    url: Optional[str] = None

    def read(self, settings: AppSettings) -> Any:
        return getattr(settings, self.attr, None)


@dataclass(frozen=True)
class Dialect:
    """A wire packaging — how a request and its reply are shaped.

    Named for the shape, never for a vendor: ``blocks`` / ``turns`` / ``items``,
    not ``anthropic`` / ``chat`` / ``openai``. One dialect commonly serves
    several endpoints (``osm`` serves both Nominatim deployments; ``indexed``
    serves OpenAI, Voyage and Jina) — that many-to-one is the whole point.

    ``module`` is a file stem under ``<domain package>/dialects/``; the import
    happens on first construction, never at startup.
    """
    name: str
    domain: "Domain"
    module: str
    adapter: str
    baseline: Optional[ModelSpec] = None   # what any model on this wire can do
    path: Optional[str] = None             # default endpoint path, if the wire fixes one
    quirks_type: Optional[Type] = None     # the Quirks class THIS wire reads


@dataclass(frozen=True)
class Feature:
    """An optional API surface an endpoint exposes.

    The module declares ``PROVIDES = ("list_models", ...)`` next to the
    functions themselves, so the declaration never restates names that could
    drift. Each named function is bound onto the constructed instance with the
    instance as its first argument, so it reads and calls exactly like a method.
    """
    name: str
    domain: "Domain"
    module: str


@dataclass(frozen=True)
class Binding:
    """What a ``Domain`` call produces — the registry's unit of registration."""
    domain: "Domain"
    dialect: Dialect
    features: Tuple[Feature, ...] = ()
    quirks: Any = None
    models: Tuple[ModelSpec, ...] = ()
    extra: Optional[Callable] = None        # (settings, models) -> ctor kwargs
    model_required: bool = True
    path: Optional[str] = None              # overrides the dialect's default path


@dataclass(frozen=True)
class Domain:
    """One capability. Calling it binds a provider to it.

    The call signature *is* the legal-option set — there is no ``accepts`` list
    for a framework to interpret and no generic ``Capability`` with
    mutually-exclusive slots. A wrong-shape binding is a ``TypeError`` at
    import; a wrong-domain dialect is an ``AssertionError`` at import.

    ``engine`` names the loop that sits above the wire, where one exists:
    language has the turn loop, embedding has the batch loop. It lives here and
    never on the declaration, so a provider always says ``language = Language(...)``.
    """
    name: str
    protocol: Type
    package: str                            # dotted path of this domain's package
    #: One line, for the humans picking a provider. Declared here so the setup UI
    #: reads the domain instead of keeping its own table of capability blurbs.
    description: str = ""
    engine: Optional[str] = None            # "module.ClassName" under the package
    system_default: Optional[str] = None    # settings field holding the deployment default key
    quirks_type: Optional[Type] = None      # this domain's Quirks dataclass
    #: Resolution looks up per-infospace credentials, so resolve() demands an
    #: infospace_id. False for pure infrastructure — storage, scraping.
    per_user: bool = True

    # Filled by __post_init__/.dialect()/.feature() — a Dialect needs its Domain first.
    dialects: SimpleNamespace = field(default=None, init=False, compare=False, repr=False)
    features: SimpleNamespace = field(default=None, init=False, compare=False, repr=False)

    def __post_init__(self):
        # The namespaces declarations read as `Language.dialects.blocks`.
        object.__setattr__(self, "dialects", SimpleNamespace())
        object.__setattr__(self, "features", SimpleNamespace())
        _domains[self.name] = self

    def __call__(
        self,
        *,
        dialect: Dialect,
        features: Tuple[Feature, ...] = (),
        quirks: Any = None,
        models: Tuple[ModelSpec, ...] = (),
        extra: Optional[Callable] = None,
        model_required: bool = True,
        path: Optional[str] = None,
    ) -> Binding:
        assert dialect.domain is self, (
            f"{dialect.name!r} is a {dialect.domain.name} dialect — "
            f"{self.name} cannot use it"
        )
        for f in features:
            assert f.domain is self, (
                f"feature {f.name!r} belongs to {f.domain.name}, not {self.name}"
            )
        # A quirk is typed by the dialect that READS it — see MAP.md.
        qt = dialect.quirks_type or self.quirks_type
        if qt is not None:
            if quirks is None:
                quirks = qt()          # defaults, so no adapter writes `or Quirks()`
            else:
                assert isinstance(quirks, qt), (
                    f"{type(quirks).__name__} cannot be read by the {dialect.name!r} "
                    f"dialect — it takes {qt.__name__}"
                )
        return Binding(
            domain=self, dialect=dialect, features=tuple(features), quirks=quirks,
            models=tuple(models), extra=extra, model_required=model_required,
            path=path,
        )

    def dialect(self, name: str, module: str, adapter: str, **kw) -> Dialect:
        """Declare one of this domain's dialects, and expose it on ``.dialects``.

        Called from the domain package's ``__init__``, which is what makes
        ``Language.dialects.blocks`` resolvable at declaration time while the
        dialect's *module* stays unimported until something is constructed.
        """
        d = Dialect(name=name, domain=self, module=module, adapter=adapter, **kw)
        setattr(self.dialects, name, d)
        return d

    def feature(self, name: str, module: str) -> Feature:
        """Declare one of this domain's features, and expose it on ``.features``."""
        f = Feature(name=name, domain=self, module=module)
        setattr(self.features, name, f)
        return f


@dataclass(frozen=True)
class Endpoint:
    """The addressable half of a declaration — who we talk to, with what key."""
    key: str
    name: str
    description: str = ""
    api_key: Optional[Setting] = None
    base_url: Optional[Setting] = None
    credential_key: Optional[str] = None
    contexts: frozenset = frozenset()

    @property
    def requires_api_key(self) -> bool:
        return self.api_key is not None

    @property
    def is_local(self) -> bool:
        return bool(self.contexts & {"local", "self_hosted"})


@dataclass
class ProviderDescriptor:
    """Internal runtime descriptor — one per (domain, provider_key) pair."""
    endpoint: Endpoint
    binding: Binding

    # Flattened accessors so call sites read the same as they used to.
    @property
    def capability(self) -> str:
        return self.binding.domain.name

    @property
    def domain(self) -> Domain:
        return self.binding.domain

    @property
    def provider_key(self) -> str:
        return self.endpoint.key

    @property
    def models(self) -> Tuple[ModelSpec, ...]:
        return self.binding.models

    @property
    def model_required(self) -> bool:
        return self.binding.model_required

    @property
    def requires_api_key(self) -> bool:
        return self.endpoint.requires_api_key

    @property
    def is_local(self) -> bool:
        return self.endpoint.is_local

    @property
    def path(self) -> Optional[str]:
        """Where this endpoint's requests go — its override, else the dialect's.

        A dialect is a packaging, not a URL: Ollama speaks the ``turns`` packaging
        but serves it at ``/api/chat``, not the dialect default ``/chat/completions``.
        """
        return self.binding.path or self.binding.dialect.path

    @property
    def quirks(self) -> Any:
        return self.binding.quirks

    @property
    def features(self) -> Tuple[Feature, ...]:
        return self.binding.features

    def get_model(self, name: str) -> Optional[ModelSpec]:
        """A declared spec by name, or None. Declared models are curated defaults,
        not an allowlist — an undeclared name still resolves."""
        return next((m for m in self.binding.models if m.name == name), None)


# Registry state

_domains: Dict[str, Domain] = {}
_registry: Dict[Tuple[str, str], ProviderDescriptor] = {}

#: {domain name: protocol}. Filled by _refresh_capabilities() once the
#: declarations are loaded, so it is a view over what registered rather than a
#: hand-maintained table.
CAPABILITIES: Dict[str, Type] = {}


def _refresh_capabilities() -> Dict[str, Type]:
    CAPABILITIES.clear()
    CAPABILITIES.update({name: d.protocol for name, d in _domains.items()})
    return CAPABILITIES


def _register(descriptor: ProviderDescriptor) -> None:
    key = (descriptor.capability, descriptor.provider_key.lower())
    if key in _registry:
        logger.warning("Overwriting provider registration: %s", key)
    _registry[key] = descriptor


def descriptor_for(capability: str, provider_key: str) -> Optional[ProviderDescriptor]:
    """One descriptor, or None. ``user_config.py`` uses it for save-time checks."""
    return _registry.get((capability, provider_key.lower()))


def domain_for(name: str) -> Optional[Domain]:
    """One registered domain, or None — its protocol, engine and description.

    ``CAPABILITIES`` answers "which domains exist"; this answers "what is this
    one", so a UI can render a domain without restating what the declaration
    already says.
    """
    return _domains.get(name)


def list_providers(capability: str) -> List[Tuple[str, ProviderDescriptor]]:
    """All registered providers for a domain. Used by discovery UIs."""
    return [(pk, desc) for (cap, pk), desc in _registry.items() if cap == capability]


def capabilities_for(provider_key: str) -> Set[str]:
    """Every domain this endpoint serves.

    ``openai`` serves language and embedding; ``ollama`` serves language,
    embedding and ocr. Saving one credential therefore clears structural blocks
    across several domains — ``core/tasks.py`` uses this for that.
    """
    key = provider_key.lower()
    return {cap for (cap, pk) in _registry if pk == key}


def _system_default_provider_key(capability: str, settings: AppSettings) -> Optional[str]:
    domain = _domains.get(capability)
    if not domain or not domain.system_default:
        return None
    val = getattr(settings, domain.system_default, None)
    return val.lower() if val else None


# @provider


def provider(cls):
    """Class decorator: read every ``Binding`` off the declaration and register it.

    The attribute name must equal the bound domain's name, so ``langauge =
    Language(...)`` fails at import with the fix in the message.
    """
    key = cls.key
    api_key: Optional[Setting] = getattr(cls, "api_key", None)
    endpoint = Endpoint(
        key=key,
        name=getattr(cls, "name", key),
        description=getattr(cls, "description", ""),
        api_key=api_key,
        base_url=getattr(cls, "base_url", None),
        credential_key=getattr(cls, "credential_key", key if api_key else None),
        contexts=frozenset(getattr(cls, "contexts", ())),
    )

    found = False
    for attr, value in vars(cls).items():
        if not isinstance(value, Binding):
            continue
        assert attr == value.domain.name, (
            f"{cls.__name__}.{attr} binds the {value.domain.name!r} domain — "
            f"rename the attribute to {value.domain.name!r}"
        )
        _register(ProviderDescriptor(endpoint=endpoint, binding=value))
        found = True

    assert found, f"{cls.__name__} declares no domains — nothing to register"
    return cls
