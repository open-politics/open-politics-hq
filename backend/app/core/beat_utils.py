"""
DEPRECATED: This module is kept for backward compatibility.
New code should use app.api.services.beat_service.BeatService instead.
"""
import warnings
from sqlmodel import Session
from app.core.db import engine
from app.core.celery_app import celery
# from app.api.services.beat_service import BeatService # <-- This module does not exist

warnings.warn(
    "beat_utils is deprecated and relies on a non-existent BeatService. Functionality may be limited.",
    DeprecationWarning,
    stacklevel=2
)

# def _get_beat_service() -> BeatService:
#     """Gets a BeatService instance using the default configuration."""
#     # This would instantiate the non-existent BeatService
#     # return BeatService(db=Session(engine), celery_app=celery)
#     raise NotImplementedError("BeatService is not implemented.")

def add_or_update_schedule(recurring_task_id: int, schedule_str: str, is_enabled: bool) -> None:
    """
    DEPRECATED: Use BeatService.add_or_update_schedule instead.
    Adds or updates a Celery Beat schedule entry for a RecurringTask.
    (Currently non-functional due to missing BeatService)
    """
    warnings.warn(
        "add_or_update_schedule relies on a non-existent BeatService and is non-functional.",
        DeprecationWarning,
        stacklevel=2
    )
    # service = _get_beat_service()
    # service.add_or_update_schedule(recurring_task_id, schedule_str, is_enabled)
    pass # No-op

def remove_schedule(recurring_task_id: int) -> None:
    """
    DEPRECATED: Use BeatService.remove_schedule instead.
    Removes a Celery Beat schedule entry for a RecurringTask.
    (Currently non-functional due to missing BeatService)
    """
    warnings.warn(
        "remove_schedule relies on a non-existent BeatService and is non-functional.",
        DeprecationWarning,
        stacklevel=2
    )
    # service = _get_beat_service()
    # service.remove_schedule(recurring_task_id)
    pass # No-op 