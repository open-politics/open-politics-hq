"""Geocoding action — the first ``@task(params_model=...)`` instance.

User clicks "Enable Geo" on the map panel → route resolves scoped annotation
ids → ``geocode.delay(ids, iid, params=GeocodeParams(...))`` → task streams
progress via ``ctx.send(topic='annotation.geocoding', ...)``. The map panel
subscribes on the ``/stream`` endpoint and pushes markers as resolved events
arrive.

No DB migration. No per-action Job model. Results land on
``Entity.properties["coords"]``; the run disappears.

Canon scoping: results land in the infospace's ``default_geo_canon_id`` when
set, otherwise ``default_canon_id`` (the General canon every infospace has).
The geocoding-specific canon wiring is structure-ready; full integration
(consult canon for cached coords *before* hitting the provider) is a
follow-up. For now, geocoded entities just live in the chosen canon.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlmodel import select

from app.api.modules.annotation.models import Annotation
from app.api.modules.annotation.schemas import GeocodeParams
from app.api.modules.graph.models import Entity
from app.api.modules.graph.resolution import resolve_entities_batch
from app.core.task_utils import run_async_in_celery
from app.core.tasks import TaskContext, task
from app.models import Infospace

logger = logging.getLogger(__name__)


def _round_ring(ring: list, ndigits: int = 4) -> list:
    """Round every coordinate in a linear ring and drop adjacent duplicates.

    GeoJSON rings are ``[[lon, lat], ...]``. Rounding to 4 decimals is ~10m
    accuracy at the equator — overkill for visual rendering but keeps the
    polygon recognizable. Adjacent-dedup collapses degenerate vertices left
    behind by rounding.
    """
    out: list = []
    last = None
    for pt in ring:
        if not isinstance(pt, list) or len(pt) < 2:
            continue
        try:
            rp = [round(float(pt[0]), ndigits), round(float(pt[1]), ndigits)]
        except (TypeError, ValueError):
            continue
        if rp == last:
            continue
        out.append(rp)
        last = rp
    # Re-close ring if simplification dropped the closing duplicate.
    if len(out) >= 3 and out[0] != out[-1]:
        out.append(list(out[0]))
    return out


def _simplify_geometry(geom: dict | None, ndigits: int = 4) -> dict | None:
    """Round and dedupe coordinates in a GeoJSON Polygon/MultiPolygon/LineString.

    Returns ``None`` if the input is missing/malformed or simplification
    produces a degenerate result. Other geometry types (Point, etc.) are
    returned untouched after coord rounding.
    """
    if not isinstance(geom, dict):
        return None
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not gtype or coords is None:
        return None
    try:
        if gtype == "Polygon":
            rings = [_round_ring(r, ndigits) for r in coords if isinstance(r, list)]
            rings = [r for r in rings if len(r) >= 4]
            if not rings:
                return None
            return {"type": "Polygon", "coordinates": rings}
        if gtype == "MultiPolygon":
            polys = []
            for poly in coords:
                if not isinstance(poly, list):
                    continue
                rings = [_round_ring(r, ndigits) for r in poly if isinstance(r, list)]
                rings = [r for r in rings if len(r) >= 4]
                if rings:
                    polys.append(rings)
            if not polys:
                return None
            return {"type": "MultiPolygon", "coordinates": polys}
        if gtype == "Point":
            if isinstance(coords, list) and len(coords) >= 2:
                return {
                    "type": "Point",
                    "coordinates": [round(float(coords[0]), ndigits), round(float(coords[1]), ndigits)],
                }
            return None
        # LineString / MultiLineString / GeometryCollection — pass through as-is.
        # Nominatim rarely returns these for forward geocoding; if it does,
        # the frontend can still accept them as Mapbox sources.
        return geom
    except Exception:
        return None


def _extract_location_strings(annotation: Annotation, field_path: str) -> list[str]:
    """Walk ``annotation.value`` along ``field_path`` and collect location strings.

    Supports simple dot paths (``location.name``) and explode wildcards
    (``annotations[*].location`` — emits one string per element).

    Mirrors ``core.filters.jsonb_accessor``'s three-convention COALESCE so
    paths work uniformly across storage layouts: the annotation task writes
    schema outputs flat at the value root, while pickers emit
    ``document.<field>`` paths. Both must resolve.
    """
    if not isinstance(annotation.value, dict):
        return []

    def _walk_path(parts: list[str]) -> list[str]:
        out: list[str] = []

        def _emit_leaf(node: Any) -> None:
            """Coerce a leaf value into one or more location strings.

            Handles four shapes:
              - plain string → emit if non-empty.
              - list of strings → emit each non-empty.
              - entity-typed dict (``{name, ...}``) → emit ``name``.
              - list of entity dicts → emit each ``name``.
            """
            if isinstance(node, str):
                s = node.strip()
                if s:
                    out.append(s)
                return
            if isinstance(node, dict):
                # Entity-typed field — dive into the canonical name slot.
                name = node.get("name")
                if isinstance(name, str) and name.strip():
                    out.append(name.strip())
                return
            if isinstance(node, list):
                for item in node:
                    _emit_leaf(item)

        def _step(node: Any, i: int) -> None:
            if i == len(parts):
                _emit_leaf(node)
                return
            part = parts[i]
            if part == "*":
                if isinstance(node, list):
                    for item in node:
                        _step(item, i + 1)
                return
            if isinstance(node, dict) and part in node:
                _step(node[part], i + 1)

        _step(annotation.value, 0)
        return out

    parts = field_path.replace("[*]", ".*").split(".")
    results = _walk_path(parts)
    # Fallback: schema paths are prefixed ``document.`` but the annotation
    # task stores ``result["document"]`` directly at the value root, so try
    # the unwrapped form too. Union with the primary result.
    if not results and parts and parts[0] == "document" and len(parts) > 1:
        results = _walk_path(parts[1:])
    return results


@task(
    "geocode",
    queue="external_api",
    capability="geocoding",
    params_model=GeocodeParams,
    tags=frozenset({"geocoding"}),
    max_concurrency=2,
    timeout=600,
)
def geocode(ctx: TaskContext, annotation_ids: list[int], params: GeocodeParams):
    """Resolve every location string in the selected annotations to coordinates.

    For each unique location: find/create ``Entity`` (``entity_type=location``)
    in the infospace's geo canon (or default canon as fallback), call the
    geocoding provider, patch ``properties.coords``, emit
    ``ctx.send(event='resolved', ...)`` so the map panel can place the marker.

    The entity itself carries the result — re-running the action on the same
    data is cheap (cache hit via ``properties.coords``).
    """

    topic = "annotation.geocoding"
    resource_id = f"{params.run_id}:{ctx.task_id or 'direct'}"

    if not annotation_ids:
        logger.warning(
            "geocode: empty annotation_ids — route resolved zero ids for run=%s field_path=%r",
            params.run_id, params.field_path,
        )
        ctx.send(topic, resource_id, "done", {"total": 0, "skipped": "empty selection"})
        return

    geocoder = ctx.provider("geocoding")

    with ctx.session() as session:
        annotations = session.exec(
            select(Annotation).where(Annotation.id.in_(annotation_ids))
        ).all()
        if not annotations:
            logger.warning(
                "geocode: no annotations matched ids=%s for run=%s",
                annotation_ids, params.run_id,
            )
            ctx.send(topic, resource_id, "done", {"total": 0})
            return
        logger.info(
            "geocode: loaded %s annotations for run=%s field_path=%r ids=%s",
            len(annotations), params.run_id, params.field_path,
            [a.id for a in annotations],
        )

        strings: list[str] = []
        seen: set[str] = set()
        per_annotation_extraction: list[dict] = []
        for ann in annotations:
            extracted = _extract_location_strings(ann, params.field_path)
            per_annotation_extraction.append({
                "annotation_id": ann.id,
                "asset_id": ann.asset_id,
                "value_keys": list(ann.value.keys()) if isinstance(ann.value, dict) else None,
                "value_type": type(ann.value).__name__,
                "value_sample": (
                    {k: ann.value[k] for k in list(ann.value.keys())[:5]}
                    if isinstance(ann.value, dict) else None
                ),
                "extracted_count": len(extracted),
                "extracted_sample": extracted[:3] if extracted else [],
            })
            for s in extracted:
                if s.lower() not in seen:
                    seen.add(s.lower())
                    strings.append(s)

        # Always log extraction outcome so the user can see whether
        # extraction yielded 0/N strings and what the value shapes are
        # without having to dig into SSE payloads.
        logger.warning(
            "geocode: extraction outcome — total_strings=%s, per_annotation=%s",
            len(strings), per_annotation_extraction,
        )
        if not strings:
            ctx.send(topic, resource_id, "done", {
                "total": 0, "skipped": "no location strings at field_path",
                "diag": per_annotation_extraction,
            })
            return

        logger.info("geocode: %s unique location strings: %s", len(strings), strings[:10])
        ctx.send(topic, resource_id, "started", {"count": len(strings)})

        # Resolve canon: prefer geo canon, fall back to general default.
        infospace = session.get(Infospace, ctx.infospace_id)
        canon_id = (
            infospace.default_geo_canon_id
            or infospace.default_canon_id
        ) if infospace else None
        logger.info(
            "geocode: canon resolution — infospace=%s geo_canon_id=%s default_canon_id=%s chosen=%s",
            ctx.infospace_id,
            getattr(infospace, "default_geo_canon_id", None),
            getattr(infospace, "default_canon_id", None),
            canon_id,
        )
        if canon_id is None:
            logger.warning(
                "geocode: bailing — no canon configured for infospace=%s",
                ctx.infospace_id,
            )
            ctx.send(topic, resource_id, "done", {
                "total": 0, "skipped": "no default canon for infospace",
            })
            return

        # Resolve names → Entity rows in the chosen canon.
        entity_map = run_async_in_celery(
            resolve_entities_batch,
            session,
            infospace_id=ctx.infospace_id,
            canon_id=canon_id,
            entities=[(s, "location") for s in strings],
            use_embeddings=False,
        )
        logger.info(
            "geocode: resolve_entities_batch returned %s entities (requested %s)",
            len(entity_map or {}), len(strings),
        )

        resolved_count = 0
        skipped_count = 0

        for ent in (entity_map or {}).values():
            if not isinstance(ent, Entity):
                continue
            existing_props = ent.properties or {}
            existing_coords = existing_props.get("coords")
            existing_bbox = existing_props.get("bbox")
            existing_geometry = existing_props.get("geometry")

            # Full cache hit: coords + bbox + geometry already persisted.
            # Replay the payload without touching the provider.
            if existing_coords and existing_bbox and existing_geometry:
                ctx.send(topic, resource_id, "resolved", {
                    "entity_id": ent.id,
                    "name": ent.canonical_name,
                    "coords": existing_coords,
                    "display_name": existing_props.get("display_name"),
                    "bbox": existing_bbox,
                    "geometry": existing_geometry,
                    "cached": True,
                })
                resolved_count += 1
                continue

            # Partial cache miss: any of coords/bbox/geometry missing. Ask
            # the provider so legacy entries can backfill the new fields.
            # The merge below only fills missing keys, so cached values stay
            # authoritative.
            try:
                geo = run_async_in_celery(geocoder.geocode, ent.canonical_name)
            except Exception as e:
                logger.warning("Geocode failed for %r: %s", ent.canonical_name, e)
                if existing_coords:
                    # Provider failed but we still have coords — emit them so
                    # the marker stays on the map; bbox/geometry just won't
                    # backfill this round.
                    ctx.send(topic, resource_id, "resolved", {
                        "entity_id": ent.id,
                        "name": ent.canonical_name,
                        "coords": existing_coords,
                        "display_name": existing_props.get("display_name"),
                        "bbox": existing_bbox,
                        "geometry": existing_geometry,
                        "cached": True,
                    })
                    resolved_count += 1
                    continue
                skipped_count += 1
                ctx.item_failed(ent.id)
                continue

            if not geo or not geo.get("coordinates"):
                if existing_coords:
                    # Provider returned nothing but coords are cached — replay.
                    ctx.send(topic, resource_id, "resolved", {
                        "entity_id": ent.id,
                        "name": ent.canonical_name,
                        "coords": existing_coords,
                        "display_name": existing_props.get("display_name"),
                        "bbox": existing_bbox,
                        "geometry": existing_geometry,
                        "cached": True,
                    })
                    resolved_count += 1
                    continue
                skipped_count += 1
                continue

            # Provider contract (see foundation_service_providers/implemented/*):
            # ``bbox`` normalized to ``[south, north, west, east]`` floats;
            # ``geometry`` is raw GeoJSON (Polygon/MultiPolygon for admin
            # boundaries, Point for POIs/cities). We simplify geometry to
            # 4-decimal precision before persisting/emitting so SSE payloads
            # stay lean (~10m accuracy is plenty for overview maps).
            coords = existing_coords or geo["coordinates"]  # cache wins on conflicts
            bbox = existing_bbox or geo.get("bbox")
            raw_geometry = geo.get("geometry")
            geometry = existing_geometry or _simplify_geometry(raw_geometry)
            new_props = dict(existing_props)
            new_props["coords"] = coords
            if "display_name" in geo and "display_name" not in new_props:
                new_props["display_name"] = geo["display_name"]
            if bbox:
                new_props["bbox"] = bbox
            if geometry:
                new_props["geometry"] = geometry
            ent.properties = new_props
            session.add(ent)
            resolved_count += 1
            ctx.stat("geocoded", 1)

            ctx.send(topic, resource_id, "resolved", {
                "entity_id": ent.id,
                "name": ent.canonical_name,
                "coords": coords,
                "display_name": new_props.get("display_name"),
                "bbox": bbox,
                "geometry": geometry,
                # Tag as cached only when we didn't actually resolve fresh coords.
                "cached": bool(existing_coords),
            })

        session.commit()
        logger.info(
            "geocode: completed — resolved=%s skipped=%s (entities iterated=%s)",
            resolved_count, skipped_count, len(entity_map or {}),
        )

    ctx.send(topic, resource_id, "done", {
        "total": resolved_count + skipped_count,
        "resolved": resolved_count,
        "skipped": skipped_count,
    })
