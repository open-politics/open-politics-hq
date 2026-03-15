"""
Infospace backup @task functions.

- process_backup: execute PENDING InfospaceBackup records
- cleanup_expired_backups: delete expired backups
- auto_backup: create automatic backups for infospaces missing recent ones
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import func, text
from sqlalchemy.sql import exists
from sqlmodel import select

from app.api.modules.sharing.models import BackupStatus, InfospaceBackup
from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)


@task("process_backup",
      check=lambda iid: (
          select(InfospaceBackup.id)
          .where(
              InfospaceBackup.infospace_id == iid,
              InfospaceBackup.status == BackupStatus.PENDING,
          )
          .order_by(InfospaceBackup.created_at)
      ),
      schedule=None,
      triggers=["backup.created"],
      batch=1,
      self_chain=True,
      queue="default",
      timeout=3600,
      tags=frozenset({"backup"}))
def process_backup(ctx: TaskContext, backup_ids: list[int]):
    """Execute PENDING infospace backups."""
    from app.api.modules.foundation_service_providers.base import StorageProvider
    from app.api.modules.sharing.services.backup_service import BackupService

    storage = ctx.provider(StorageProvider)

    for backup_id in backup_ids:
        # Atomic claim
        with ctx.session() as session:
            backup = session.get(InfospaceBackup, backup_id)
            if not backup or backup.status != BackupStatus.PENDING:
                continue
            backup.status = BackupStatus.RUNNING
            session.add(backup)
            session.commit()

        try:
            async def _execute(bid):
                with ctx.session() as session:
                    svc = BackupService(session=session, storage_provider=storage, settings=ctx.settings)
                    return await svc.execute_backup(bid, {})

            success = run_async_in_celery(_execute, backup_id)

            if success:
                ctx.stat("done")
            else:
                with ctx.session() as session:
                    backup = session.get(InfospaceBackup, backup_id)
                    if backup:
                        backup.status = BackupStatus.FAILED
                        backup.error_message = "Backup execution returned failure"
                        session.add(backup)
                        session.commit()
                ctx.stat("failed")

        except Exception as e:
            logger.error("Backup %d failed: %s", backup_id, e, exc_info=True)
            with ctx.session() as session:
                backup = session.get(InfospaceBackup, backup_id)
                if backup:
                    backup.status = BackupStatus.FAILED
                    backup.error_message = str(e)[:500]
                    session.add(backup)
                    session.commit()
            ctx.item_failed(backup_id)
            ctx.stat("failed")


@task("cleanup_expired_backups",
      check=lambda iid: (
          select(InfospaceBackup.id)
          .where(
              InfospaceBackup.infospace_id == iid,
              InfospaceBackup.status == BackupStatus.COMPLETED,
              InfospaceBackup.expires_at.isnot(None),
              InfospaceBackup.expires_at <= func.now(),
          )
      ),
      schedule=43200,
      batch=50,
      queue="default",
      tags=frozenset({"backup"}))
def cleanup_expired(ctx: TaskContext, backup_ids: list[int]):
    """Delete expired infospace backups."""
    from app.api.modules.foundation_service_providers.base import StorageProvider
    from app.api.modules.sharing.services.backup_service import BackupService

    storage = ctx.provider(StorageProvider)

    with ctx.session() as session:
        svc = BackupService(session=session, storage_provider=storage, settings=ctx.settings)
        cleaned = 0
        for backup_id in backup_ids:
            try:
                backup = session.get(InfospaceBackup, backup_id)
                if backup:
                    run_async_in_celery(svc.delete_backup, backup_id)
                    cleaned += 1
            except Exception as e:
                logger.warning("Failed to clean backup %d: %s", backup_id, e)
        ctx.stat("done", cleaned)


@task("auto_backup",
      check=lambda iid: (
          select(text(str(iid)))
          .where(
              ~exists(
                  select(InfospaceBackup.id).where(
                      InfospaceBackup.infospace_id == iid,
                      InfospaceBackup.backup_type == "auto",
                      InfospaceBackup.status == BackupStatus.COMPLETED,
                      InfospaceBackup.created_at > func.now() - text("interval '24 hours'"),
                  )
              )
          )
      ),
      schedule=86400,
      batch=1,
      queue="default",
      timeout=3600,
      tags=frozenset({"backup"}))
def auto_backup(ctx: TaskContext, _ids: list[int]):
    """Create automatic backup for infospace if no recent auto backup exists."""
    from app.api.modules.foundation_service_providers.base import StorageProvider
    from app.api.modules.sharing.services.backup_service import BackupService
    from app.api.modules.identity_infospace_user.models import Infospace
    from app.schemas import InfospaceBackupCreate

    storage = ctx.provider(StorageProvider)

    with ctx.session() as session:
        infospace = session.get(Infospace, ctx.infospace_id)
        if not infospace:
            return

        svc = BackupService(session=session, storage_provider=storage, settings=ctx.settings)
        backup_data = InfospaceBackupCreate(
            name=f"Auto Backup - {infospace.name}",
            description="Automatic backup",
            backup_type="auto",
            include_sources=True,
            include_schemas=True,
            include_runs=True,
            include_datasets=True,
            include_annotations=True,
        )
        backup = svc.create_backup(
            infospace_id=infospace.id,
            user_id=infospace.owner_id,
            backup_data=backup_data,
        )
        ctx.stat("done")
        logger.info("Created auto backup %d for infospace %d", backup.id, infospace.id)
