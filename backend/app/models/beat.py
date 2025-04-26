from sqlalchemy_celery_beat.models import PeriodicTask, CrontabSchedule, IntervalSchedule
from sqlmodel import SQLModel, Field
from datetime import datetime
from typing import Optional

class BeatScheduleBase(SQLModel):
    """Base model for beat schedule entries."""
    name: str = Field(index=True)
    task: str  # The task to run
    enabled: bool = True
    crontab_minute: str
    crontab_hour: str
    crontab_day_of_week: str
    crontab_day_of_month: str
    crontab_month_of_year: str
    timezone: str = "UTC"

class BeatScheduleCreate(BeatScheduleBase):
    """Model for creating a new beat schedule."""
    pass

class BeatScheduleUpdate(SQLModel):
    """Model for updating a beat schedule."""
    enabled: Optional[bool] = None
    crontab_minute: Optional[str] = None
    crontab_hour: Optional[str] = None
    crontab_day_of_week: Optional[str] = None
    crontab_day_of_month: Optional[str] = None
    crontab_month_of_year: Optional[str] = None
    timezone: Optional[str] = None

class BeatScheduleRead(BeatScheduleBase):
    """Model for reading a beat schedule."""
    id: int
    created_at: datetime
    updated_at: datetime 