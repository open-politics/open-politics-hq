"""
Task primitives for self-chaining batch processing and provider context.

Provides:
- @self_chaining_task: decorator for batch tasks that commit and chain if work remains
- task_context: context manager yielding (session, providers) for task execution
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import contextmanager
from typing import Any, TypeVar

from sqlmodel import Session

logger = logging.getLogger(__name__)

T = TypeVar("T")

_provider_cache: dict[str, Any] = {}
_cache_config_hash: str | None = None


def _settings_hash() -> str:
    """Hash of config values that affect provider construction."""
    from app.core.config import settings

    keys = [
        settings.STORAGE_PROVIDER_TYPE,
        getattr(settings, "OCR_PROVIDER_TYPE", ""),
        getattr(settings, "SCRAPING_PROVIDER_TYPE", ""),
        getattr(settings, "GEOCODING_PROVIDER_TYPE", ""),
    ]
    return "|".join(str(k) for k in keys)


def _get_cached_provider(key: str, factory: Callable[[], Any]) -> Any:
    global _cache_config_hash
    current_hash = _settings_hash()
    if _cache_config_hash != current_hash:
        _provider_cache.clear()
        _cache_config_hash = current_hash
    if key not in _provider_cache:
        _provider_cache[key] = factory()
    return _provider_cache[key]


def clear_provider_cache() -> None:
    """Explicit invalidation. Call after config change or for testing."""
    global _cache_config_hash
    _provider_cache.clear()
    _cache_config_hash = None


def get_provider_cache_status() -> dict[str, Any]:
    """Return cache status for debugging."""
    return {
        "cache_size": len(_provider_cache),
        "cached_providers": list(_provider_cache.keys()),
    }


@contextmanager
def task_context(
    providers: list[str] | None = None,
):
    """
    Context manager for task execution: yields (session, providers_dict).

    Usage:
        with task_context(providers=["storage", "embedding"]) as (session, prov):
            storage = prov["storage"]
            # ... do work
            session.commit()

    Providers are resolved via registry.resolve() using system defaults and cached per worker.
    """
    from app.core.db import engine
    from app.core.config import settings

    providers = providers or []
    prov_dict: dict[str, Any] = {}

    _NAME_TO_PROTO: dict[str, str] = {
        "storage": "StorageProvider",
        "scraping": "ScrapingProvider",
        "embedding": "EmbeddingProvider",
        "geocoding": "GeocodingProvider",
        "ocr": "OcrProvider",
    }

    for name in providers:
        proto_class_name = _NAME_TO_PROTO.get(name)
        if not proto_class_name:
            logger.warning("Unknown provider name in task_context: %s", name)
            continue

        def _factory(pcn=proto_class_name, _name=name):
            import app.api.modules.foundation_service_providers.base as base
            from app.api.modules.foundation_service_providers.registry import (
                resolve,
                system_default_type_key,
            )

            protocol = getattr(base, pcn)
            type_key = system_default_type_key(protocol, settings)
            if not type_key:
                raise ValueError(
                    f"No system default configured for '{pcn}'. "
                    f"Set the corresponding env var (e.g. STORAGE_PROVIDER_TYPE)."
                )
            provider = resolve(protocol, type_key, settings)
            if not provider:
                raise ValueError(f"Provider '{pcn}/{type_key}' not available via resolve()")
            return provider

        prov_dict[name] = _get_cached_provider(name, _factory)

    with Session(engine) as session:
        yield session, prov_dict


MAX_CHAIN_DEPTH = 50  # safety valve: max self-chain iterations before yielding


def self_chaining_task(
    task_fn: Callable[..., dict[str, Any] | tuple[dict[str, Any], tuple, dict]],
) -> Callable[..., Any]:
    """
    Decorator for Celery tasks that process batches and chain themselves if more work remains.

    The wrapped task must return either:
    - A dict (final result), or
    - A tuple (result_dict, chain_args, chain_kwargs) to trigger self-chaining.

    When chain depth reaches MAX_CHAIN_DEPTH, re-queues with 10s delay and resets depth
    to give other tasks a chance (backpressure).
    """

    from functools import wraps

    @wraps(task_fn)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        depth = kwargs.pop("_chain_depth", 0)
        result = task_fn(self, *args, **kwargs)
        if isinstance(result, tuple):
            if len(result) != 3:
                raise ValueError(
                    "self_chaining_task: expected (result, chain_args, chain_kwargs)"
                )
            res, chain_args, chain_kwargs = result
            if depth >= MAX_CHAIN_DEPTH:
                logger.warning(
                    "Chain depth limit (%d) reached for %s; re-queuing with reset depth after delay",
                    MAX_CHAIN_DEPTH,
                    getattr(self, "name", "task"),
                )
                chain_kwargs["_chain_depth"] = 0
                self.apply_async(args=chain_args, kwargs=chain_kwargs, countdown=10)
            else:
                chain_kwargs["_chain_depth"] = depth + 1
                self.apply_async(args=chain_args, kwargs=chain_kwargs)
            logger.debug(
                "Chained %s depth=%d",
                getattr(self, "name", "task"),
                depth,
            )
            return res
        return result

    return wrapper
