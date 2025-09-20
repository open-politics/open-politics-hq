from typing import List, Optional, Dict, Any
from sqlmodel import Session, select
from datetime import datetime, timezone
import logging

from app.models import (
    Monitor,
    Bundle,
    AnnotationSchema,
    Task,
    AnnotationRun,
    Annotation,
    User
)
from app.schemas import MonitorCreate, MonitorUpdate
from app.api.services.service_utils import validate_infospace_access
from app.api.services.annotation_service import AnnotationService
from app.api.services.task_service import TaskService

logger = logging.getLogger(__name__)

class MonitorService:
    def __init__(self, session: Session, annotation_service: AnnotationService, task_service: TaskService):
        self.session = session
        self.annotation_service = annotation_service
        self.task_service = task_service

    def create_monitor(self, monitor_in: MonitorCreate, user_id: int, infospace_id: int) -> Monitor:
        validate_infospace_access(self.session, infospace_id, user_id)

        target_bundles = []
        if monitor_in.target_bundle_ids:
            for bundle_id in monitor_in.target_bundle_ids:
                bundle = self.session.get(Bundle, bundle_id)
                if not bundle or bundle.infospace_id != infospace_id:
                    raise ValueError(f"Bundle ID {bundle_id} not found in infospace {infospace_id}.")
                target_bundles.append(bundle)
        
        target_schemas = []
        if monitor_in.target_schema_ids:
            for schema_id in monitor_in.target_schema_ids:
                schema = self.session.get(AnnotationSchema, schema_id)
                if not schema or schema.infospace_id != infospace_id:
                    raise ValueError(f"Schema ID {schema_id} not found in infospace {infospace_id}.")
                target_schemas.append(schema)

        from app.schemas import TaskCreate
        task_in = TaskCreate(
            name=f"Monitor: {monitor_in.name}",
            type="MONITOR", # A new task type
            schedule=monitor_in.schedule,
            configuration={"monitor_id": 0} # Placeholder
        )
        # Assuming TaskService handles the creation and Celery Beat update
        created_task = self.task_service.create_task(user_id=user_id, infospace_id=infospace_id, task_in=task_in)

        db_monitor = Monitor.model_validate(monitor_in, update={
            "user_id": user_id,
            "infospace_id": infospace_id,
            "linked_task_id": created_task.id
        })
        db_monitor.target_bundles = target_bundles
        db_monitor.target_schemas = target_schemas
        
        self.session.add(db_monitor)
        self.session.commit()
        self.session.refresh(db_monitor)

        # Update task config with the real monitor_id
        created_task.configuration["monitor_id"] = db_monitor.id
        self.session.add(created_task)
        self.session.commit()

        return db_monitor

    def get_monitor(self, monitor_id: int, user_id: int, infospace_id: int) -> Optional[Monitor]:
        validate_infospace_access(self.session, infospace_id, user_id)
        monitor = self.session.get(Monitor, monitor_id)
        if monitor and monitor.infospace_id == infospace_id:
            return monitor
        return None

    def list_monitors(self, user_id: int, infospace_id: int, skip: int = 0, limit: int = 100) -> List[Monitor]:
        validate_infospace_access(self.session, infospace_id, user_id)
        monitors = self.session.exec(
            select(Monitor).where(Monitor.infospace_id == infospace_id).offset(skip).limit(limit)
        ).all()
        return monitors

    def update_monitor(self, monitor_id: int, monitor_in: MonitorUpdate, user_id: int, infospace_id: int) -> Optional[Monitor]:
        validate_infospace_access(self.session, infospace_id, user_id)
        db_monitor = self.session.get(Monitor, monitor_id)
        if not db_monitor or db_monitor.infospace_id != infospace_id:
            return None

        update_data = monitor_in.model_dump(exclude_unset=True)
        schedule_changed = "schedule" in update_data and db_monitor.linked_task.schedule != update_data["schedule"]

        for key, value in update_data.items():
            if key == "target_bundle_ids":
                db_monitor.target_bundles = [self.session.get(Bundle, b_id) for b_id in value]
            elif key == "target_schema_ids":
                db_monitor.target_schemas = [self.session.get(AnnotationSchema, s_id) for s_id in value]
            else:
                setattr(db_monitor, key, value)
        
        self.session.add(db_monitor)
        
        if schedule_changed:
            from app.schemas import TaskUpdate
            task_update = TaskUpdate(schedule=update_data["schedule"])
            self.task_service.update_task(db_monitor.linked_task_id, user_id, infospace_id, task_update)

        self.session.commit()
        self.session.refresh(db_monitor)
        return db_monitor

    def delete_monitor(self, monitor_id: int, user_id: int, infospace_id: int) -> bool:
        validate_infospace_access(self.session, infospace_id, user_id)
        monitor = self.session.get(Monitor, monitor_id)
        if not monitor or monitor.infospace_id != infospace_id:
            return False
        
        # Delete the associated task first
        self.task_service.delete_task(monitor.linked_task_id, user_id, infospace_id)
        
        self.session.delete(monitor)
        self.session.commit()
        return True

    def execute_monitor(self, monitor_id: int):
        monitor = self.session.get(Monitor, monitor_id)
        if not monitor:
            raise ValueError(f"Monitor {monitor_id} not found.")

        # 1. Get all assets that have ever been processed by this monitor
        processed_asset_ids = set(
            row[0] for row in self.session.exec(
                select(Annotation.asset_id)
                .join(AnnotationRun)
                .where(AnnotationRun.monitor_id == monitor_id)
            ).all()
        )

        # 2. Get all current assets from all target bundles
        current_asset_ids = set()
        for bundle in monitor.target_bundles:
            for asset in bundle.assets:
                current_asset_ids.add(asset.id)

        # 3. Find the new assets
        new_asset_ids = list(current_asset_ids - processed_asset_ids)

        if not new_asset_ids:
            logger.info(f"Monitor {monitor_id}: No new assets to process.")
            monitor.last_checked_at = datetime.now(timezone.utc)
            self.session.add(monitor)
            self.session.commit()
            return

        # 4. Create and trigger a new AnnotationRun for the new assets
        from app.schemas import AnnotationRunCreate
        run_in = AnnotationRunCreate(
            name=f"{monitor.name} - {datetime.now(timezone.utc).isoformat()}",
            description=f"Automated run from Monitor {monitor.id}",
            target_asset_ids=new_asset_ids,
            schema_ids=[s.id for s in monitor.target_schemas],
            configuration=monitor.run_config_override or {}
        )
        
        new_run = self.annotation_service.create_run(
            user_id=monitor.user_id,
            infospace_id=monitor.infospace_id,
            run_in=run_in
        )
        
        # Link the new run back to this monitor
        new_run.monitor_id = monitor.id
        # Copy monitor.views_config into run.views_config for reproducibility
        try:
            new_run.views_config = monitor.views_config or []
        except Exception:
            pass
        self.session.add(new_run)
        
        monitor.last_checked_at = datetime.now(timezone.utc)
        self.session.add(monitor)
        self.session.commit()
        
        logger.info(f"Monitor {monitor_id}: Triggered AnnotationRun {new_run.id} for {len(new_asset_ids)} new assets.")
        
    # ... other CRUD methods (get, list, update, delete) would follow ... 