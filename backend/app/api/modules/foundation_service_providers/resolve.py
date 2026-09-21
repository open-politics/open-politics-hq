"""
resolve.py — a declaration becomes a live object.

  resolve(capability, infospace_id)

    1  context       infospace config ──► owner config ──► ProviderSelection
                      one DB round-trip

    2  credentials   runtime_key ────────────► per-call BYOK   ◄── wins
                      owner.encrypted ────────► per-user
                      Setting.read ───────────► deployment key
                         only if foundation.access grants it

    3  construct     dialect module imported NOW, lazily
                      missing package ──► ProviderError, not ImportError

    4  features      PROVIDES fns bound on ──► hasattr(p, "pull_model")

    5  spec          declared ──► dialect baseline.  zero I/O.

                                ▼
                      Resolved  .model  .provider_key  .spec

  NOT IN THIS FILE
    primitives.py   the vocabulary above. Read that first.
    providers.py    the declarations.
    base.py         Adapter — client, headers, url, sse/ndjson.
    user_config.py  what a user or infospace chose. Read by step 1.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import partial
from importlib import import_module
from typing import Any, Dict, List, Optional

from sqlmodel import Session

from app.core.config import AppSettings
from app.core.security import CredentialDecryptionError

from app.api.modules.foundation_service_providers.models import ModelSpec
from app.api.modules.foundation_service_providers.user_config import (
    SELECTABLE_ENRICHERS, ProviderSelection,
)
from app.api.modules.foundation_service_providers.primitives import (
    ProviderDescriptor, ProviderError, Resolved, Setting, _domains,
    _refresh_capabilities, _system_default_provider_key, descriptor_for, list_providers,
)

logger = logging.getLogger(__name__)



# Access gate


def _provider_access(settings: AppSettings, capability: str, provider_key: str) -> Optional[str]:
    """Grant for this pair: "all" / "superuser" / "byok" / "none" / None."""
    return settings.access_level(capability, provider_key)


def _first_available_default(capability: str, settings: AppSettings) -> Optional[str]:
    """The deployment default for a domain — first usable entry of `use`.

    `foundation.use.<cap>` is comma-separated: an ordered preference, not a list
    of equals. Usable means registered and not blocked. No I/O — reachability is
    not probed, so a permitted provider that is down raises rather than silently
    resolving to something else.
    """
    raw = _system_default_provider_key(capability, settings)
    if not raw:
        return None
    candidates = [c.strip().lower() for c in raw.split(",") if c.strip()]
    for key in candidates:
        desc = descriptor_for(capability, key)
        if desc and not _is_access_blocked(settings, desc):
            return key
    return candidates[0] if candidates else None


def _is_access_blocked(settings: AppSettings, desc: ProviderDescriptor) -> bool:
    """Blocked when explicitly `none`, or when a KEYED provider is unlisted.

    Default-deny is scoped to providers carrying an ``api_key`` — the only ones
    where an unconfigured entry could spend the deployment's money. A keyless
    provider has nothing to leak, so silence about it must not brick the stack.
    `byok` is how a keyed provider says "usable, our key stays ours".
    """
    level = _provider_access(settings, desc.capability, desc.provider_key)
    if level == "none":
        return True
    return level is None and desc.requires_api_key


def _env_key_if_granted(
    settings: AppSettings, desc: ProviderDescriptor, owner_is_superuser: bool
) -> Optional[str]:
    """Deployment key, only on an explicit `all` / `superuser` grant.

    Allow-list, not a deny-list: byok, none and unlisted all get nothing, so a
    level nobody anticipated fails closed by construction.
    """
    if not desc.endpoint.api_key:
        return None
    access = _provider_access(settings, desc.capability, desc.provider_key)
    if access not in ("all", "superuser"):
        return None
    if access == "superuser" and not owner_is_superuser:
        return None
    return getattr(settings, desc.endpoint.api_key.attr, None) or None


# Selection and credential context


@dataclass
class _Context:
    """Everything resolve needs from the database — one round trip."""
    selection: Optional[ProviderSelection]
    encrypted_credentials: Optional[str]
    owner_is_superuser: bool


def _load_from_session(
    session: Session, capability: str, infospace_id: int, context: Optional[str]
) -> _Context:
    from app.api.modules.identity_infospace_user.models import Infospace, User
    from app.api.modules.foundation_service_providers.user_config import (
        EnrichmentConfig, ProviderDefaults,
    )

    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        raise ProviderError(f"Unknown infospace: {infospace_id}")

    owner = session.get(User, infospace.owner_id)
    if not owner:
        raise ProviderError(f"Infospace {infospace_id} has no owner")

    selection: Optional[ProviderSelection] = None

    if capability in SELECTABLE_ENRICHERS and infospace.enrichment_config is not None:
        ec = infospace.enrichment_config
        if isinstance(ec, dict):
            ec = EnrichmentConfig(**ec)
        selection = ec.provider_for(capability)

    if selection is None and owner.provider_defaults is not None:
        pd = owner.provider_defaults
        if isinstance(pd, dict):
            pd = ProviderDefaults(**pd)
        selection = pd.provider_for(capability, context)

    return _Context(
        selection=selection,
        encrypted_credentials=owner.encrypted_credentials,
        owner_is_superuser=bool(getattr(owner, "is_superuser", False)),
    )


def _load_context(
    capability: str, infospace_id: Optional[int], context: Optional[str],
    session: Optional[Session],
) -> _Context:
    if infospace_id is None:
        return _Context(selection=None, encrypted_credentials=None, owner_is_superuser=False)
    if session is not None:
        return _load_from_session(session, capability, infospace_id, context)
    from app.core.db import engine
    with Session(engine) as s:
        return _load_from_session(s, capability, infospace_id, context)


def get_configured_foundation_provider(
    session: Session, infospace_id: int, capability: str, *, context: Optional[str] = None,
) -> Optional[ProviderSelection]:
    """Effective selection for (infospace, domain) via the cascade.

    Walks the same path ``resolve()`` does — ``infospace.enrichment_config`` →
    ``owner.provider_defaults`` — and deliberately does not consult deployment
    system defaults. It answers "has the user picked anything", so it is the
    precondition helper for callers that want to reject before credential lookup.
    """
    if capability not in _domains:
        raise ProviderError(f"Unknown capability: {capability}")
    return _load_from_session(session, capability, infospace_id, context).selection


def _decrypt_owner_credentials(encrypted: Optional[str]) -> Dict[str, str]:
    """Decrypt once. ``{}`` only when nothing is stored.

    Propagates ``CredentialDecryptionError`` for a present-but-undecryptable blob
    rather than masking it as "no credentials".
    """
    if not encrypted:
        return {}
    from app.core.security import decrypt_credentials
    return decrypt_credentials(encrypted)


# Construction


def _build_config(
    desc: ProviderDescriptor, settings: AppSettings, api_key: Optional[str],
    owner_is_superuser: bool,
) -> dict:
    """Build constructor kwargs from the endpoint + an optional api_key.

    Defence in depth: refuses to read the deployment key without an explicit
    foundation.access grant, so code that bypasses ``resolve()`` still cannot
    leak the credential.
    """
    ep = desc.endpoint
    config: dict = {"quirks": _resolve_quirks(desc.quirks, settings), "descriptor": desc}

    if ep.api_key:
        if api_key:
            config["api_key"] = api_key
        else:
            env_grant = _env_key_if_granted(settings, desc, owner_is_superuser)
            if env_grant:
                config["api_key"] = env_grant
            elif getattr(settings, ep.api_key.attr, None):
                raise ProviderError(
                    f"Provider '{desc.capability}/{desc.provider_key}' has a deployment API "
                    f"key but no grant. Add it under foundation.access."
                    f"{desc.capability}.{desc.provider_key} in HQ.yml "
                    f"(all | superuser), or let the infospace owner supply their own."
                )

    if ep.base_url:
        config["base_url"] = ep.base_url.read(settings)

    if desc.binding.extra:
        # One calling convention: (settings, models). No arity sniffing.
        config.update(desc.binding.extra(settings, desc.models))

    return config


def _resolve_quirks(quirks: Any, settings: AppSettings) -> Any:
    """Read any ``Setting`` a quirk holds, so flags can be operator-editable.

    A quirk is usually a literal, but some are deployment config — the OCR engine
    language, a required User-Agent. Holding a ``Setting`` keeps those in the
    declaration while still being settable from ``HQ.yml``.
    """
    if quirks is None:
        return None
    overrides = {
        f: value.read(settings)
        for f, value in vars(quirks).items()
        if isinstance(value, Setting)
    }
    if not overrides:
        return quirks
    from dataclasses import replace as _replace
    return _replace(quirks, **overrides)


def _load(dotted_module: str, name: str) -> Any:
    module = import_module(dotted_module)
    return getattr(module, name)


def _compose_features(instance: Any, desc: ProviderDescriptor) -> None:
    """Bind each feature's functions onto the instance.

    The feature module declares ``PROVIDES`` next to its functions, so the
    declaration never restates names that could drift. A feature module is
    imported only when a provider that declares it is constructed.
    """
    for feat in desc.features:
        mod = import_module(f"{desc.domain.package}.features.{feat.module}")
        for fn_name in getattr(mod, "PROVIDES", ()):
            setattr(instance, fn_name, partial(getattr(mod, fn_name), instance))


def _construct(desc: ProviderDescriptor, config: dict) -> Any:
    """Lazily import the dialect adapter, build it, wrap it in the domain's
    engine if it has one, then compose features onto the result."""
    dialect = desc.binding.dialect
    try:
        adapter_cls = _load(f"{desc.domain.package}.dialects.{dialect.module}", dialect.adapter)
        adapter = instance = adapter_cls(**config)
    except ImportError as e:
        # Missing package: structural, so ProviderError makes @task block, not retry.
        raise ProviderError(
            f"{desc.capability}/{desc.provider_key} needs a dependency this "
            f"deployment does not have: {e}. Install it, or select another "
            f"{desc.capability} provider."
        ) from e

    if desc.domain.engine:
        mod_name, cls_name = desc.domain.engine.rsplit(".", 1)
        engine_cls = _load(f"{desc.domain.package}.{mod_name}", cls_name)
        instance = engine_cls(adapter, desc)

    # Bound to the OUTERMOST object; `host` is a dialect's way back to a feature.
    _compose_features(instance, desc)
    if adapter is not instance:
        setattr(adapter, "host", instance)
    return instance


# Model capability cascade


def _resolve_spec(desc: ProviderDescriptor, model: Optional[str]) -> Optional[ModelSpec]:
    """Capability facts for the resolved model, with zero I/O.

        declared spec  →  dialect baseline

    A runtime-discovered spec is the third source but needs a network call, so
    ``list_models()`` is the door for that and the caller merges it. Declared
    models are curated defaults, not an allowlist, so an undeclared name falls
    back to the baseline rather than to a ``None`` that reads as "supports nothing".
    """
    baseline = desc.binding.dialect.baseline
    if model is None:
        return baseline
    declared = desc.get_model(model)
    if declared is None:
        return baseline
    return declared.merged_with(baseline)


def get_model_spec(capability: str, provider_key: str,
                   model_name: Optional[str]) -> Optional[ModelSpec]:
    """The same cascade, for a caller holding names rather than a resolution.

    ``resolve()`` already hands back ``Resolved.spec``; prefer that where you
    have it. This door exists for the callers that only know the strings.
    """
    desc = descriptor_for(capability, provider_key)
    return _resolve_spec(desc, model_name) if desc else None


# resolve


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
        capability:    a registered domain name — "language" | "embedding" |
                       "ocr" | "geocoding" | "storage" | "scraping" | "web_search"
        provider_key:  specific endpoint. When None, comes from infospace
                       config / owner defaults / deployment default.
        model:         model name. When None, comes from config. An undeclared
                       name is accepted — declared specs are curated defaults.
        infospace_id:  required wherever the domain declares ``per_user``;
                       optional for pure infrastructure (storage, scraping).
        context:       "chat" | "annotation" — language only, ignored elsewhere.
        runtime_key:   BYOK for this call. Highest priority in the credential chain.
        session:       reuse an open DB session instead of opening one.

    Returns:
        ``Resolved`` — delegates to the instance, carries ``.model``,
        ``.provider_key`` and ``.spec``.

    Raises:
        ``ProviderError`` on unknown domain, unconfigured provider, missing
        credentials, a model-required violation, or a deployment-level block.
    """
    from app.core.config import settings

    if capability not in _domains:
        raise ProviderError(f"Unknown capability: {capability}")

    if _domains[capability].per_user and infospace_id is None:
        raise ProviderError(
            f"{capability} resolve requires infospace_id for credential resolution"
        )

    ctx = _load_context(capability, infospace_id, context, session)

    # ── provider key: explicit → infospace/owner selection → deployment default ──
    if provider_key is None and ctx.selection is not None:
        provider_key = ctx.selection.provider_key
    if provider_key is None:
        provider_key = _first_available_default(capability, settings)
    if provider_key is None:
        raise ProviderError(f"No {capability} provider configured")
    provider_key = provider_key.lower()

    desc = descriptor_for(capability, provider_key)
    if not desc:
        raise ProviderError(f"Unknown {capability} provider: {provider_key}")

    if _is_access_blocked(settings, desc):
        raise ProviderError(f"{capability}/{provider_key} is blocked in this deployment")

    # model: explicit → selection → None. NO membership check: specs rank, never fence.
    if model is None and ctx.selection is not None \
            and ctx.selection.provider_key.lower() == provider_key:
        model = ctx.selection.model_name
    if model is None and desc.model_required:
        raise ProviderError(f"{capability}/{provider_key} requires a model selection")

    instance = _instantiate(desc, ctx, runtime_key, settings)
    return Resolved(instance, model=model, provider_key=provider_key,
                    spec=_resolve_spec(desc, model))


def _instantiate(desc: ProviderDescriptor, ctx: _Context,
                 runtime_key: Optional[str], settings: AppSettings) -> Any:
    """Credential chain, then build. Everything except model handling.

    Split out so ``list_models()`` can reach an endpoint without inventing a
    placeholder model name.
    """
    api_key: Optional[str] = None
    if desc.requires_api_key:
        if runtime_key:
            api_key = runtime_key
        else:
            try:
                stored = _decrypt_owner_credentials(ctx.encrypted_credentials)
            except CredentialDecryptionError as e:
                raise ProviderError(
                    f"Stored credentials for {desc.capability}/{desc.provider_key} are "
                    f"undecryptable (key rotation may be in progress). {e}"
                ) from e
            ck = desc.endpoint.credential_key
            api_key = stored.get(ck) if ck else None
            if not api_key:
                api_key = _env_key_if_granted(settings, desc, ctx.owner_is_superuser)
        if not api_key:
            raise ProviderError(
                f"No credentials for {desc.capability}/{desc.provider_key}. Store a key "
                f"in your profile, or ask the operator for foundation.access."
                f"{desc.capability}.{desc.provider_key}: all in HQ.yml"
            )

    return _construct(desc, _build_config(desc, settings, api_key, ctx.owner_is_superuser))


# list_models


async def list_models(
    capability: str,
    provider_key: str,
    *,
    infospace_id: Optional[int] = None,
    runtime_key: Optional[str] = None,
    session: Optional[Session] = None,
) -> List[ModelSpec]:
    """Curated specs first, then everything the endpoint reports right now.

    Listing models is what you do before you have one, so it does not sit behind
    ``resolve()``'s model handling. Declared specs come first and are never
    dropped — they are the ranked set a picker surfaces at the top. Models the
    declaration doesn't know about are appended.
    """
    desc = descriptor_for(capability, provider_key)
    if not desc:
        raise ProviderError(f"Unknown {capability} provider: {provider_key}")

    declared = list(desc.models)
    known = {m.name for m in declared}

    if not any("list_models" in getattr(
            import_module(f"{desc.domain.package}.features.{f.module}"), "PROVIDES", ())
            for f in desc.features):
        return declared

    from app.core.config import settings

    try:
        ctx = _load_context(capability, infospace_id, None, session)
        endpoint = _instantiate(desc, ctx, runtime_key, settings)
    except ProviderError as e:
        logger.info("list_models: cannot reach %s/%s (%s) — returning declared specs only",
                    capability, provider_key, e)
        return declared

    try:
        discovered = await endpoint.list_models()
    except Exception as e:  # a live endpoint that is down must not break a picker
        logger.warning("list_models: %s/%s discovery failed: %s", capability, provider_key, e)
        return declared

    return declared + [m for m in discovered if m.name not in known]


# Availability probes


def is_capability_available(capability: str, settings: AppSettings) -> bool:
    """Is any provider for this domain available? The dispatch filter's circuit
    breaker. Settings and grants only: no DB, no per-infospace credential lookup."""
    if capability not in _domains:
        return False
    for _pk, desc in list_providers(capability):
        if _is_access_blocked(settings, desc):
            continue
        return True
    return False


def probe_providers(settings: Optional[AppSettings] = None) -> Dict[str, list]:
    """Log what this deployment can reach, and on whose credential.

    Runs at worker start. What matters to an operator is not "is a key present"
    but whose key gets used, so every non-blocked provider is listed with its
    access mode:

        local       keyless, runs on this machine or network
        open        keyless, public service
        all         deployment key, shared with every infospace
        superuser   deployment key, superuser-owned infospaces only
        byok        users bring their own key
        byok*       a deployment key exists but no grant shares it
    """
    if settings is None:
        from app.core.config import settings as _settings
        settings = _settings

    status: Dict[str, list] = {}
    parts, shared = [], []

    for capability in sorted(_domains):
        found = []
        for pk, desc in sorted(list_providers(capability)):
            if _is_access_blocked(settings, desc):
                continue

            if not desc.requires_api_key:
                mode = "local" if desc.is_local else "open"
            else:
                grant = _provider_access(settings, capability, pk)
                has_env = bool(getattr(settings, desc.endpoint.api_key.attr, None))
                if has_env and grant in ("all", "superuser"):
                    mode = grant
                    shared.append(f"{capability}/{pk}={grant}")
                else:
                    mode = "byok*" if has_env else "byok"
            found.append(f"{pk} ({mode})")

        status[capability] = found
        parts.append(f"{capability}: {', '.join(found) if found else 'none'}")

    logger.info("[PROVIDERS] %s", " | ".join(parts))
    logger.info(
        "[PROVIDERS] deployment keys shared with users: %s",
        ", ".join(shared) if shared else "none (every keyed provider is BYOK)",
    )
    return status


# Load declarations
# providers.py imports every domain package, then runs the @provider decorators.

from app.api.modules.foundation_service_providers.providers import *  # noqa: E402,F401,F403

_refresh_capabilities()


def _validate_foundation_names() -> None:
    """Every name in the foundation block must refer to something that exists.

    Shape is checked in config.py; names can only be checked here, once the
    declarations are loaded. Unchecked, ``access.langauge.openai: all`` grants
    nothing and says nothing — indistinguishable from a deliberate BYOK
    deployment. The reachability gate cannot cover `use` and `providers` either:
    it keys on the address, and an unknown name simply has none.
    """
    from app.core.config import HQ_CONFIG_FILE, settings

    problems: List[str] = []

    def known_in(capability: str) -> str:
        return ", ".join(sorted(pk for pk, _ in list_providers(capability))) or "none"

    for cap, entries in (settings.FOUNDATION_ACCESS or {}).items():
        cap_l = cap.lower()
        if cap_l not in _domains:
            problems.append(
                f"foundation.access.{cap}: no such capability. "
                f"Known: {', '.join(sorted(_domains))}"
            )
            continue
        for provider in entries:
            if descriptor_for(cap_l, provider) is None:
                problems.append(
                    f"foundation.access.{cap}.{provider}: not a {cap_l} provider. "
                    f"Known: {known_in(cap_l)}"
                )

    # A comma list hides a bad entry, because the ones after it still answer.
    for capability, chosen in settings.chosen_providers:
        where = ("deployment.storage.use" if capability == "storage"
                 else f"foundation.use.{capability}")
        for entry in [c.strip() for c in str(chosen or "").split(",") if c.strip()]:
            if descriptor_for(capability, entry) is None:
                problems.append(
                    f"{where}: {entry!r} is not a {capability} provider. "
                    f"Known: {known_in(capability)}"
                )

    # `providers.openia.base_url` leaves the real openai on its default, so the
    # edit looks made and does nothing.
    every_provider = {pk for d in _domains for pk, _ in list_providers(d)}
    for provider in (settings.FOUNDATION_PROVIDERS or {}):
        if provider.lower() not in every_provider:
            problems.append(
                f"foundation.providers.{provider}: no provider by that name. "
                f"Known: {', '.join(sorted(every_provider))}"
            )

    if problems:
        raise ProviderError(
            f"Invalid foundation config in {HQ_CONFIG_FILE}:\n  " + "\n  ".join(problems)
        )


_validate_foundation_names()
