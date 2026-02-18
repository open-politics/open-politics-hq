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


@contextmanager
def task_context(
    providers: list[str] | None = None,
):
    """
    Context manager for task execution: yields (session, providers_dict).

    Usage:
        with task_context(providers=["storage", "embedding"]) as (session, prov):
            storage = prov["storage"]
            embedding = prov["embedding"]
            # ... do work
            session.commit()

    Providers are created via app.api.providers.factory and cached per invocation.
    """
    from app.core.db import engine
    from app.core.config import settings

    providers = providers or []
    prov_dict: dict[str, Any] = {}

    if "storage" in providers:
        from app.api.providers.factory import create_storage_provider
        prov_dict["storage"] = create_storage_provider(settings)
    if "scraping" in providers:
        from app.api.providers.factory import create_scraping_provider
        prov_dict["scraping"] = create_scraping_provider(settings)
    if "embedding" in providers:
        from app.api.providers.factory import create_embedding_provider
        prov_dict["embedding"] = create_embedding_provider(settings)
    if "model_registry" in providers:
        from app.api.providers.factory import create_model_registry
        reg = create_model_registry(settings)
        prov_dict["model_registry"] = reg
    if "geocoding" in providers:
        from app.api.providers.factory import create_geocoding_provider
        prov_dict["geocoding"] = create_geocoding_provider(settings)

    with Session(engine) as session:
        yield session, prov_dict


def self_chaining_task(
    task_fn: Callable[..., dict[str, Any] | tuple[dict[str, Any], tuple, dict]],
) -> Callable[..., Any]:
    """
    Decorator for Celery tasks that process batches and chain themselves if more work remains.

    The wrapped task must return either:
    - A dict (final result), or
    - A tuple (result_dict, chain_args, chain_kwargs) to trigger self-chaining.

    Example:
        @celery.task(bind=True)
        @self_chaining_task
        def my_batch_task(self, bundle_id: int, cursor: int = 0):
            with Session(engine) as session:
                batch = get_batch(session, bundle_id, cursor, size=100)
                if not batch:
                    return {"done": True}
                process(batch)
                session.commit()
                if has_more(session, bundle_id, cursor + len(batch)):
                    return {"processed": len(batch)}, (bundle_id, cursor + len(batch)), {}
                return {"processed": len(batch)}
    """

    from functools import wraps

    @wraps(task_fn)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        result = task_fn(self, *args, **kwargs)
        if isinstance(result, tuple):
            if len(result) != 3:
                raise ValueError(
                    "self_chaining_task: expected (result, chain_args, chain_kwargs)"
                )
            res, chain_args, chain_kwargs = result
            # Chain by invoking the same task again (self is the Celery task when bind=True)
            self.apply_async(args=chain_args, kwargs=chain_kwargs)
            logger.debug(
                "Chained %s with args=%s kwargs=%s",
                getattr(self, "name", "task"),
                chain_args,
                chain_kwargs,
            )
            return res
        return result

    return wrapper
