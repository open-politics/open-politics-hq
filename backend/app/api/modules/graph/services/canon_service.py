"""Canon portability + pure data-ops.

A canon is a portable value: serialize it to a plain dict (a file), import that
dict into any infospace. This module owns the pure data-ops that live *inside*
the canon — serialize / materialize (= deserialize = import = commit) / combine.
The decision logic (resolution, proposals — both need an embedding provider)
stays *outside*, in ``resolution.py`` / ``tasks/proposals.py``.

Wire format (``format: "canon/v1"``) carries only portable fields:
- canon: uuid, external_id, name, description, tags, type_schemas
- entry: uuid, external_id, canonical, aliases, type, additional_types, tags,
  parents, properties

Local-only fields never travel: id, infospace_id, embeddings, provenance_type.
Embeddings are recomputed lazily on first fuzzy resolve (per-provider/model, so
they can't be shared meaningfully across deployments).

Identity on import is carried by ``external_id`` (deterministic merge). ``uuid``
is globally unique in this DB, so it is preserved only when globally free
(best-effort lineage across deployments) and regenerated on collision — which is
what lets the same file import into two infospaces of one DB without clashing.
``parents`` stay as portable string refs; a ref that doesn't resolve is
*unresolved*, never broken, so each canon still imports standalone.
"""
import logging
from typing import Any, Dict, List, Optional, Type

from sqlalchemy import or_
from sqlmodel import Session, SQLModel, select

from app.api.modules.graph.models import (
    Canon,
    CanonEntry,
    EntityEditLog,
    EntityRelationship,
    FragmentCuration,
    GraphEdge,
)

logger = logging.getLogger(__name__)

WIRE_FORMAT = "canon/v1"


# ─── Serialize ────────────────────────────────────────────────────────────


def _entry_to_portable(entry: CanonEntry) -> Dict[str, Any]:
    return {
        "uuid": entry.uuid,
        "external_id": entry.external_id,
        "canonical": entry.canonical,
        "aliases": list(entry.aliases or []),
        "type": entry.type,
        "additional_types": list(entry.additional_types or []),
        "tags": list(entry.tags or []),
        "parents": list(entry.parents or []),
        "properties": dict(entry.properties or {}),
    }


def serialize_canon(session: Session, canon_id: int) -> Dict[str, Any]:
    """Serialize a canon + its entries to the portable wire format (read-only).

    Excludes local-only fields (id, infospace_id, embeddings, provenance_type)
    — the result is a standalone file that imports into any deployment.
    """
    canon = session.get(Canon, canon_id)
    if not canon:
        raise ValueError(f"Canon {canon_id} not found")
    entries = session.exec(
        select(CanonEntry).where(CanonEntry.canon_id == canon_id)
    ).all()
    return {
        "format": WIRE_FORMAT,
        "canon": {
            "uuid": canon.uuid,
            "external_id": canon.external_id,
            "name": canon.name,
            "description": canon.description,
            "tags": list(canon.tags or []),
            "type_schemas": dict(canon.type_schemas or {}),
        },
        "entries": [_entry_to_portable(e) for e in entries],
    }


# ─── Materialize (= deserialize = import = commit) ──────────────────────────


def _free_uuid(session: Session, model: Type[SQLModel], candidate: Optional[str]) -> Optional[str]:
    """Return ``candidate`` if no row of ``model`` already holds it (uuid is
    globally unique), else ``None`` so the model's default_factory mints a fresh
    one. Best-effort lineage preservation without risking a unique violation.
    """
    if not candidate:
        return None
    exists = session.exec(select(model.id).where(model.uuid == candidate)).first()
    return candidate if exists is None else None


def _merge_entry(entry: CanonEntry, data: Dict[str, Any]) -> None:
    """Apply imported entry data onto an existing row — enrich, don't clobber.

    Scalars (canonical, type) take the imported value; list fields union;
    properties overlay (imported keys win, locally-filled keys survive).
    """
    if data.get("canonical"):
        entry.canonical = data["canonical"]
    if data.get("type"):
        entry.type = data["type"]
    entry.aliases = _union(entry.aliases, data.get("aliases"))
    entry.additional_types = _union(entry.additional_types, data.get("additional_types"))
    entry.tags = _union(entry.tags, data.get("tags"))
    entry.parents = _union(entry.parents, data.get("parents"))
    merged = dict(entry.properties or {})
    merged.update(data.get("properties") or {})
    entry.properties = merged


def _union(existing: Optional[List[str]], incoming: Optional[List[str]]) -> List[str]:
    """Order-preserving union of two string lists."""
    out = list(existing or [])
    seen = set(out)
    for v in incoming or []:
        if v not in seen:
            out.append(v)
            seen.add(v)
    return out


def materialize_canon(
    session: Session,
    infospace_id: int,
    payload: Dict[str, Any],
    into_canon_id: Optional[int] = None,
) -> Canon:
    """Materialize a serialized canon into the infospace (= import = commit).

    Deterministic merge by ``external_id``: a canon matches an existing row in
    the infospace by external_id (or is the explicit ``into_canon_id``); an entry
    matches within its canon by external_id; otherwise a new row is created.
    Entries without an external_id always create (no key to dedup on). ``parents``
    are stored as portable string refs, never resolved to FKs. Embeddings are
    not imported.

    Caller owns the transaction (this flushes to assign ids, never commits).
    """
    fmt = payload.get("format")
    if fmt and fmt != WIRE_FORMAT:
        raise ValueError(f"Unsupported canon format: {fmt!r}")
    canon_data: Dict[str, Any] = payload.get("canon") or {}
    entries_data: List[Dict[str, Any]] = payload.get("entries") or []

    # ── Canon: explicit target, else match by external_id, else create ──
    canon: Optional[Canon] = None
    if into_canon_id is not None:
        canon = session.get(Canon, into_canon_id)
        if not canon or canon.infospace_id != infospace_id:
            raise ValueError(f"Canon {into_canon_id} not in infospace {infospace_id}")
    else:
        ext = canon_data.get("external_id")
        if ext:
            canon = session.exec(
                select(Canon).where(
                    Canon.infospace_id == infospace_id, Canon.external_id == ext
                )
            ).first()
        if canon is None:
            kwargs: Dict[str, Any] = {
                "infospace_id": infospace_id,
                "external_id": ext,
                "name": canon_data.get("name") or "Imported canon",
                "description": canon_data.get("description"),
                "tags": list(canon_data.get("tags") or []),
            }
            safe = _free_uuid(session, Canon, canon_data.get("uuid"))
            if safe:
                kwargs["uuid"] = safe
            canon = Canon(**kwargs)
            session.add(canon)
            session.flush()

    # type_schemas overlay: imported per-type shape declarations enrich the
    # canon's own (imported keys win per type), mirroring the property overlay.
    incoming_ts = canon_data.get("type_schemas") or {}
    if incoming_ts:
        canon.type_schemas = {**(canon.type_schemas or {}), **incoming_ts}
        session.add(canon)

    # ── Entries: match within canon by external_id, else create ──
    added = updated = 0
    for data in entries_data:
        ext = data.get("external_id")
        existing: Optional[CanonEntry] = None
        if ext:
            existing = session.exec(
                select(CanonEntry).where(
                    CanonEntry.canon_id == canon.id, CanonEntry.external_id == ext
                )
            ).first()
        if existing is not None:
            _merge_entry(existing, data)
            session.add(existing)
            updated += 1
            continue
        kwargs = {
            "infospace_id": infospace_id,
            "canon_id": canon.id,
            "external_id": ext,
            "canonical": data.get("canonical") or "",
            "type": data.get("type") or "",
            "aliases": list(data.get("aliases") or []),
            "additional_types": list(data.get("additional_types") or []),
            "tags": list(data.get("tags") or []),
            "parents": list(data.get("parents") or []),
            "properties": dict(data.get("properties") or {}),
        }
        safe = _free_uuid(session, CanonEntry, data.get("uuid"))
        if safe:
            kwargs["uuid"] = safe
        session.add(CanonEntry(**kwargs))
        added += 1

    session.flush()
    logger.info(
        "materialize_canon: canon %s (%s) — %d added, %d updated",
        canon.id, canon.name, added, updated,
    )
    return canon


# ─── Combine (merge entries) ────────────────────────────────────────────────


def combine_entries(
    session: Session,
    canon_id: int,
    entry_ids: List[int],
    keep_id: Optional[int] = None,
    canonical: Optional[str] = None,
    log_user_id: Optional[int] = None,
) -> CanonEntry:
    """Merge entries within one canon into a single keep-entry.

    The one implementation behind both merge routes. Unions aliases +
    additional_types; overlays properties (merged entries fill/override the
    keep's keys); rewires every FK reference (GraphEdge source/target,
    FragmentCuration source/target/entry, EntityRelationship a/b with canonical
    order preserved and collapsed pairs dropped); deletes the losers; writes one
    ``EntityEditLog`` audit row capturing the pre-merge states.

    All entries must already belong to ``canon_id`` (raises ``ValueError``
    otherwise). Caller owns the transaction (this flushes, never commits).
    """
    if len(entry_ids) < 2:
        raise ValueError("At least 2 entry IDs required for merge")

    entries: List[CanonEntry] = []
    for eid in entry_ids:
        ent = session.get(CanonEntry, eid)
        if not ent or ent.canon_id != canon_id:
            raise ValueError(f"Entry {eid} not in canon {canon_id}")
        entries.append(ent)

    keep_id = keep_id or entry_ids[0]
    keep = next((e for e in entries if e.id == keep_id), entries[0])

    # Capture original states before any mutation — for an accurate audit row.
    prev = {
        e.id: {"canonical": e.canonical, "aliases": list(e.aliases or []),
               "properties": dict(e.properties or {})}
        for e in entries
    }

    all_aliases = set(keep.aliases or [])
    all_additional_types = set(keep.additional_types or [])
    merged_properties = dict(keep.properties or {})
    for ent in entries:
        if ent.id != keep.id:
            all_aliases.add(ent.canonical)
            all_aliases.update(ent.aliases or [])
            all_additional_types.update(ent.additional_types or [])
            merged_properties.update(ent.properties or {})
    if canonical is not None:
        keep.canonical = canonical
    keep.aliases = list(all_aliases)
    keep.additional_types = list(all_additional_types)
    keep.properties = merged_properties
    keep.provenance_type = "manual"

    merged_ids = {e.id for e in entries if e.id != keep.id}
    if merged_ids:
        for ge in session.exec(
            select(GraphEdge).where(or_(
                GraphEdge.source_entry_id.in_(merged_ids),
                GraphEdge.target_entry_id.in_(merged_ids),
            ))
        ).all():
            if ge.source_entry_id in merged_ids:
                ge.source_entry_id = keep.id
            if ge.target_entry_id in merged_ids:
                ge.target_entry_id = keep.id
            session.add(ge)
        for fc in session.exec(
            select(FragmentCuration).where(or_(
                FragmentCuration.source_entry_id.in_(merged_ids),
                FragmentCuration.target_entry_id.in_(merged_ids),
                FragmentCuration.entry_id.in_(merged_ids),
            ))
        ).all():
            if fc.source_entry_id in merged_ids:
                fc.source_entry_id = keep.id
            if fc.target_entry_id in merged_ids:
                fc.target_entry_id = keep.id
            if fc.entry_id in merged_ids:
                fc.entry_id = keep.id
            session.add(fc)
        # Canonical order (entry_a_id < entry_b_id) must hold after rewrite;
        # a pair that collapses to a == b is dropped.
        for rel in session.exec(
            select(EntityRelationship).where(or_(
                EntityRelationship.entry_a_id.in_(merged_ids),
                EntityRelationship.entry_b_id.in_(merged_ids),
            ))
        ).all():
            new_a = keep.id if rel.entry_a_id in merged_ids else rel.entry_a_id
            new_b = keep.id if rel.entry_b_id in merged_ids else rel.entry_b_id
            if new_a == new_b:
                session.delete(rel)
                continue
            new_a, new_b = sorted((new_a, new_b))
            rel.entry_a_id = new_a
            rel.entry_b_id = new_b
            session.add(rel)

    for ent in entries:
        if ent.id != keep.id:
            session.delete(ent)

    session.add(keep)
    session.add(EntityEditLog(
        entry_id=keep.id,
        action="merge",
        performed_by=f"user:{log_user_id}" if log_user_id is not None else "system:merge",
        previous_state={"merged_entry_ids": entry_ids, "merged_states": prev},
    ))
    session.flush()
    return keep
