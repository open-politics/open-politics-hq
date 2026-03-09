"""
Celery-based event bus for lifecycle transitions.

Layer 0 infrastructure. Dispatches by task name strings — never imports from domain modules.
Subscribers register Celery task names; the bus calls celery_app.send_task().
"""

import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)

# Subscriber registry: event_name -> list of (task_name, args_key, filter_key, filter_value)
# args_key: if set, pass args=[payload[args_key]]; else args=[payload]
# filter_key/filter_value: if set, only dispatch when payload[filter_key] == filter_value
_subscribers: Dict[str, list[tuple[str, str | None, str | None, Any]]] = {}


def emit(event_name: str, payload: Dict[str, Any]) -> None:
    """
    Emit an event: dispatch to registered Celery task subscribers via send_task().
    Fire-and-forget; does not block.
    """
    try:
        from app.core.celery_app import celery_app

        for task_name, args_key, filter_key, filter_value in _subscribers.get(event_name, []):
            try:
                if filter_key is not None and payload.get(filter_key) != filter_value:
                    continue
                if args_key is not None and args_key in payload:
                    celery_app.send_task(task_name, args=[payload[args_key]], kwargs={})
                else:
                    celery_app.send_task(task_name, args=[payload], kwargs={})
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
) -> None:
    """
    Register a Celery task to be invoked when an event is emitted.
    task_name is the Celery task name string (e.g. "resume_flow_execution").
    args_key: if set, pass payload[args_key] as the single arg; else pass full payload.
    filter_key/filter_value: if set, only dispatch when payload[filter_key] == filter_value.
    Called at worker startup when domain modules load.
    """
    if event_name not in _subscribers:
        _subscribers[event_name] = []
    entry = (task_name, args_key, filter_key, filter_value)
    if entry not in _subscribers[event_name]:
        _subscribers[event_name].append(entry)


def get_subscribers(event_name: str) -> list[tuple[str, str | None, str | None, Any]]:
    """Return list of (task_name, args_key, filter_key, filter_value) for an event (for testing)."""
    return _subscribers.get(event_name, []).copy()
