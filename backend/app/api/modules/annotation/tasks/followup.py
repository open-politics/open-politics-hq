"""
Annotation follow-up @task: create annotation runs for versioned assets
missing annotations whose previous version had annotations from runs
with follow_on_version_change=True.
"""

import logging

from sqlalchemy.sql import exists
from sqlmodel import Session, select

from app.api.modules.annotation.models import Annotation, AnnotationRun, RunSchemaLink
from app.api.modules.content.models import Asset, ProcessingStatus
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)


@task("version_gap_annotation",
      check=lambda iid: (
          select(Asset.id)
          .where(
              Asset.infospace_id == iid,
              Asset.processing_status == ProcessingStatus.READY,
              Asset.previous_asset_id.isnot(None),
              ~exists().where(Annotation.asset_id == Asset.id),
              exists(
                  select(1).select_from(Annotation)
                  .join(AnnotationRun, Annotation.run_id == AnnotationRun.id)
                  .where(
                      Annotation.asset_id == Asset.previous_asset_id,
                      AnnotationRun.follow_on_version_change == True,
                  )
              ),
              Asset.is_superseded == False,
              Asset.parent_is_superseded == False,
          )
      ),
      schedule=300,
      batch=10,
      tags=frozenset({"annotation"}))
def version_gap(ctx: TaskContext, ids: list[int]):
    """Create follow-up annotation runs for versioned assets missing annotations."""
    from app.api.modules.content.types import get_content_type_registry
    from app.api.modules.annotation.services.annotation_service import AnnotationService
    from app.schemas import AnnotationRunCreate

    with ctx.session() as session:
        ann_svc = AnnotationService(session=session)

        for asset_id in ids:
            try:
                asset = session.get(Asset, asset_id)
                if not asset or not asset.previous_asset_id:
                    continue
                prev_id = asset.previous_asset_id

                # Find run IDs that had annotations on prev and have follow_on_version_change
                run_ids = session.exec(
                    select(AnnotationRun.id)
                    .join(Annotation, Annotation.run_id == AnnotationRun.id)
                    .where(
                        Annotation.asset_id == prev_id,
                        AnnotationRun.follow_on_version_change == True,
                    )
                    .distinct()
                ).all()

                if not run_ids:
                    continue

                # Resolve target asset IDs: if container, use children; else use self
                registry = get_content_type_registry()
                is_container = registry.is_container(asset.kind)
                if is_container:
                    children = session.exec(
                        select(Asset.id).where(Asset.parent_asset_id == asset_id)
                    ).all()
                    target_ids = list(children) if children else [asset_id]
                else:
                    target_ids = [asset_id]

                if not target_ids:
                    continue

                # Create one follow-up run per source run (distinct schema/config)
                seen_keys: set = set()
                for run_id in run_ids:
                    source_run = session.get(AnnotationRun, run_id)
                    if not source_run:
                        continue
                    schema_ids = session.exec(
                        select(RunSchemaLink.schema_id).where(RunSchemaLink.run_id == run_id)
                    ).all()
                    schema_ids = [s for s in schema_ids if s]
                    if not schema_ids:
                        continue
                    key = (tuple(sorted(schema_ids)), tuple(sorted((source_run.configuration or {}).items())))
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    run_in = AnnotationRunCreate(
                        name=f"Version follow-up of run {source_run.id}",
                        description=f"Re-annotation after content version change (previous_asset_id={prev_id})",
                        schema_ids=schema_ids,
                        target_asset_ids=target_ids,
                        configuration=source_run.configuration or {},
                        follow_on_version_change=False,
                        trigger_type="version_followup",
                        trigger_context={
                            "previous_asset_id": prev_id,
                            "source_run_id": source_run.id,
                            "new_asset_id": asset_id,
                        },
                    )
                    new_run = ann_svc.create_run(
                        user_id=source_run.user_id,
                        infospace_id=source_run.infospace_id,
                        run_in=run_in,
                        queue_task=True,
                    )
                    new_run.parent_run_id = source_run.id
                    session.add(new_run)
                    session.commit()
                    logger.info(
                        "Created follow-up run %d for versioned asset %d (source run %d)",
                        new_run.id, asset_id, source_run.id
                    )
                ctx.stat("done")
            except Exception as e:
                logger.warning("version_gap: failed for asset %d: %s", asset_id, e)
                ctx.item_failed(asset_id)
                ctx.stat("failed")
