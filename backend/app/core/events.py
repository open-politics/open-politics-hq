"""
Celery-based event bus for lifecycle transitions.

Layer 0 infrastructure. Dispatches by task name strings — never imports from domain modules.
"""

import logging
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

# Subscriber registry: event_name -> list of (task_name, args_key, filter_key, filter_value, null_prefix, gate)
_subscribers: Dict[str, list[tuple[str, str | None, str | None, Any, bool, Optional[Callable]]]] = {}


def _queue_for_task(task_name: str) -> str | None:
    """Look up the declared queue for a task from the registry."""
    try:
        from app.core.tasks import get_task_registry
        desc = get_task_registry().get(task_name)
        return desc.queue if desc else None
    except Exception:
        return None


def emit(event_name: str, payload: Dict[str, Any]) -> None:
    """Dispatch to registered Celery task subscribers. Fire-and-forget; does not block."""
    try:
        from app.core.celery_app import celery_app

        for task_name, args_key, filter_key, filter_value, null_prefix, gate in _subscribers.get(event_name, []):
            try:
                if gate is not None and not gate():
                    continue
                if filter_key is not None and payload.get(filter_key) != filter_value:
                    continue
                queue = _queue_for_task(task_name)
                if args_key is not None and args_key in payload:
                    val = payload[args_key]
                    args = [None, val] if null_prefix else [val]
                    celery_app.send_task(task_name, args=args, kwargs={}, queue=queue)
                else:
                    celery_app.send_task(task_name, args=[payload], kwargs={}, queue=queue)
            except Exception as e:
                logger.warning(f"Event bus: failed to dispatch {task_name} for {event_name}: {e}")
    except Exception as e:
        logger.warning(f"Event bus: emit failed for {event_name}: {e}")


def subscribe(
    event_name: str,
    task_name: str,
    args_key: str | None = None,
    filter_key: str | None = None,
    filter_value: Any = None,
    null_prefix: bool = False,
    gate: Callable | None = None,
) -> None:
    """
    Register a Celery task to be invoked when an event is emitted.
    Called at worker startup when domain modules load.
    """
    if event_name not in _subscribers:
        _subscribers[event_name] = []
    entry = (task_name, args_key, filter_key, filter_value, null_prefix, gate)
    if entry not in _subscribers[event_name]:
        _subscribers[event_name].append(entry)


def get_subscribers(event_name: str) -> list[tuple[str, str | None, str | None, Any, bool, Optional[Callable]]]:
    return _subscribers.get(event_name, []).copy()
