"""
Graph maintenance @task functions.

Periodic maintenance: retire superseded entity references, re-resolve singletons.
"""

from sqlalchemy import text, or_
from sqlmodel import select

from app.api.modules.graph.models import EntityCanonical, FragmentCuration, GraphEdge
from app.api.modules.content.models import Asset
from app.models import Annotation
from app.core.tasks import TaskContext, task


@task("superseded_entity_retire",
      check=lambda iid: (
          select(FragmentCuration.id)
          .join(Annotation, FragmentCuration.annotation_id == Annotation.id)
          .join(Asset, Annotation.asset_id == Asset.id)
          .where(Asset.infospace_id == iid)
          .where(FragmentCuration.source_asset_superseded == False)
          .where(Asset.is_superseded == True)
      ),
      schedule=21600,
      batch=50, tags=frozenset({"graph"}))
def retire_superseded(ctx: TaskContext, ids: list[int]):
    """Flag FragmentCuration entries whose source asset is superseded."""
    with ctx.session() as session:
        for curation_id in ids:
            curation = session.get(FragmentCuration, curation_id)
            if curation and not curation.source_asset_superseded:
                curation.source_asset_superseded = True
        session.commit()
        ctx.stat("done", len(ids))


@task("re_resolve_singletons",
      check=lambda iid: (
          select(EntityCanonical.id)
          .where(EntityCanonical.infospace_id == iid)
          .where(text("(aliases IS NULL OR jsonb_array_length(COALESCE(aliases::jsonb, '[]'::jsonb)) <= 1)"))
      ),
      schedule=21600,
      batch=20, max_concurrency=1, tags=frozenset({"graph"}))
def re_resolve(ctx: TaskContext, ids: list[int]):
    """Re-resolve singleton entities for deduplication."""
    from app.api.modules.graph.resolution import find_by_alias

    with ctx.session() as session:
        merged = 0
        for eid in ids:
            entity = session.get(EntityCanonical, eid)
            if not entity:
                continue
            other = find_by_alias(
                session, entity.infospace_id, entity.canonical_name,
                entity.entity_type, graph_id=entity.graph_id,
                exclude_entity_id=entity.id,
            )
            if not other:
                continue
            # Merge entity into other
            all_aliases = set(other.aliases or [])
            all_aliases.add(entity.canonical_name)
            all_aliases.update(entity.aliases or [])
            other.aliases = list(all_aliases)
            merged_props = dict(other.properties or {})
            merged_props.update(entity.properties or {})

            # Update GraphEdge FK references
            for ge in session.exec(
                select(GraphEdge).where(
                    or_(
                        GraphEdge.subject_entity_id == entity.id,
                        GraphEdge.object_entity_id == entity.id,
                    )
                )
            ).all():
                if ge.subject_entity_id == entity.id:
                    ge.subject_entity_id = other.id
                if ge.object_entity_id == entity.id:
                    ge.object_entity_id = other.id
                session.add(ge)
            # Update FragmentCuration FK references
            for fc in session.exec(
                select(FragmentCuration).where(
                    or_(
                        FragmentCuration.subject_entity_id == entity.id,
                        FragmentCuration.object_entity_id == entity.id,
                        FragmentCuration.entity_canonical_id == entity.id,
                    )
                )
            ).all():
                if fc.subject_entity_id == entity.id:
                    fc.subject_entity_id = other.id
                if fc.object_entity_id == entity.id:
                    fc.object_entity_id = other.id
                if fc.entity_canonical_id == entity.id:
                    fc.entity_canonical_id = other.id
                session.add(fc)

            session.delete(entity)
            other.properties = merged_props
            session.add(other)
            session.commit()
            merged += 1

        ctx.stat("done", merged)
