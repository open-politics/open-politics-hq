"""
Package cleanup @task.

Deactivates expired packages so they no longer block operations like unsealing.
"""

import logging

from sqlalchemy import func, text, true
from sqlmodel import select

from app.api.modules.sharing.models import Package
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)


@task("cleanup_expired_packages",
      check=lambda iid: (
          select(Package.id)
          .where(
              Package.infospace_id == iid,
              Package.is_active == true(),
              Package.expires_at.isnot(None),
              Package.expires_at < func.now(),
          )
      ),
      schedule=3600,  # hourly sweep
      batch=100,
      tags=frozenset({"sharing", "cleanup"}))
def cleanup_expired_packages(ctx: TaskContext, package_ids: list[int]):
    """Deactivate expired packages."""
    with ctx.session() as session:
        result = session.execute(
            text("UPDATE package SET is_active = false WHERE id = ANY(:pids) AND is_active = true"),
            {"pids": package_ids},
        )
        session.commit()
        count = result.rowcount
    ctx.stat("packages_deactivated")(count)
    logger.info(f"Deactivated {count} expired packages")
