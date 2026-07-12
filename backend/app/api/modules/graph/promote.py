"""Promote run-scoped folds into a canon — the run-decision → canon seam.

A *fold* (``{keep, names, type}``) is a human merge decision made in a run's
working canvas. Promoting it persists that decision as canon identity, so the
next run resolves it for free ("settle once, dedup forever"). Promote is
**additive and idempotent** — it never mutates the run's config; re-promoting
just re-asserts the same aliases/merge.

It composes the resolution layer (exact/alias only — the user already decided
these are one, so no embeddings are needed) with the canon data-op
``combine_entries`` (when a fold's members already resolve to *distinct* canon
entries, the fold asserts they're one → merge them).

Three fold sources, normalized to one shape:
- ``run.graph_config["entity_merges"]`` — entity-typed merges.
- ``run.views_config`` ``MergeMap``s — value folds; their type defaults to the
  leaf field name (each field's folds get their own partition + a meaningful
  type), else the reserved ``"value"``.
- ``run.views_config`` ``globalVariableSplitting`` blocks — the variable-splitting
  value aliases (``valueAliasesByField`` / legacy ``valueAliases``), the same
  value-canonicalization the dashboards apply at display time. Promoting them
  makes the canon the durable source of truth for those aliases.
``type`` stays NOT NULL throughout — a value fold is a real, if generic, type,
not a null (null-object pattern).
"""
import logging
from typing import Any, Dict, Iterator, List, Optional

from sqlalchemy import select as sa_select
from sqlmodel import Session

from app.api.modules.graph.models import CanonEntry
from app.api.modules.graph.services.canon_service import combine_entries

logger = logging.getLogger(__name__)

VALUE_TYPE_FALLBACK = "value"


def _leaf_field(field_path: str) -> str:
    """Leaf segment of a merge-map field path → a value fold's default type.

    ``document.topics`` → ``topics``; ``{doc,topics}`` → ``topics``; ``sender`` →
    ``sender``. Empty / unusable → ``""`` (caller falls back to ``"value"``).
    """
    if not field_path:
        return ""
    cleaned = field_path.strip().strip("{}")
    parts = [p for p in cleaned.replace(",", ".").split(".") if p and not p.isdigit()]
    return parts[-1] if parts else ""


def _iter_merge_maps(obj: Any) -> Iterator[Dict[str, Any]]:
    """Find every ``MergeMap``-shaped dict ({field_path, entries}) anywhere in a
    views_config tree — nesting-agnostic, so it survives panel/view reshapes."""
    if isinstance(obj, dict):
        if isinstance(obj.get("field_path"), str) and isinstance(obj.get("entries"), list):
            yield obj
        for v in obj.values():
            yield from _iter_merge_maps(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _iter_merge_maps(v)


def _iter_value_alias_blocks(obj: Any) -> Iterator[Dict[str, Any]]:
    """Find every variable-splitting block anywhere in a views_config tree — a
    dict carrying ``valueAliasesByField`` or legacy ``valueAliases``. Nesting-
    agnostic (mirrors ``_iter_merge_maps``), so it survives dashboard reshapes and
    the views_config-as-list-or-dict ambiguity."""
    if isinstance(obj, dict):
        if isinstance(obj.get("valueAliasesByField"), dict) or isinstance(obj.get("valueAliases"), dict):
            yield obj
        for v in obj.values():
            yield from _iter_value_alias_blocks(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _iter_value_alias_blocks(v)


def _folds_from_alias_map(aliases_map: Any, vtype: str) -> List[Dict[str, Any]]:
    """``{canonical: [aliases]}`` → ``[{keep, names, type}]`` (skips empty keeps)."""
    folds: List[Dict[str, Any]] = []
    if not isinstance(aliases_map, dict):
        return folds
    for canonical, aliases in aliases_map.items():
        keep = (canonical or "").strip()
        if keep:
            folds.append({"keep": keep, "names": list(aliases or []), "type": vtype})
    return folds


def normalize_run_folds(run: Any) -> List[Dict[str, Any]]:
    """All fold sources → one ``[{keep, names, type}]`` list (deduped, typed)."""
    folds: List[Dict[str, Any]] = []

    gc = getattr(run, "graph_config", None) or {}
    for g in gc.get("entity_merges", []) if isinstance(gc, dict) else []:
        keep = (g.get("keep") or "").strip()
        if keep:
            folds.append({
                "keep": keep,
                "names": list(g.get("names", [])),
                "type": (g.get("type") or "UNKNOWN"),
            })

    views_config = getattr(run, "views_config", None) or []

    for mm in _iter_merge_maps(views_config):
        leaf = _leaf_field(mm.get("field_path", ""))
        for e in mm.get("entries", []):
            keep = (e.get("keep") or "").strip()
            if keep:
                folds.append({
                    "keep": keep,
                    "names": list(e.get("names", [])),
                    "type": (e.get("type") or leaf or VALUE_TYPE_FALLBACK),
                })

    # Variable-splitting value aliases. Prefer per-field map (type per field);
    # fall back to the legacy single map keyed by the block's fieldKey.
    for block in _iter_value_alias_blocks(views_config):
        by_field = block.get("valueAliasesByField")
        if isinstance(by_field, dict) and by_field:
            for field_path, aliases_map in by_field.items():
                folds.extend(_folds_from_alias_map(aliases_map, _leaf_field(field_path) or VALUE_TYPE_FALLBACK))
        else:
            folds.extend(_folds_from_alias_map(
                block.get("valueAliases"),
                _leaf_field(block.get("fieldKey", "")) or VALUE_TYPE_FALLBACK,
            ))

    return folds


def canon_value_merge_maps(session: Session, canon_id: int, field_paths: List[str]) -> List[Any]:
    """Read-time inverse of value-fold promotion: project a canon's value-typed
    entries back into ``MergeMap``s keyed by the query's field paths, so a panel
    grouping on a field auto-canonicalizes its values from the canon — the
    durable counterpart to run-local valueAliases. Promote once, every future
    run on this canon groups for free.

    One query over the canon for all leaf types; one ``MergeMap`` per field path
    that has matching entries. Type matching is by leaf field name (so
    ``document.party`` and ``email.party`` share the canon's ``party`` vocabulary).
    """
    from app.core.filters import MergeMap, MergeMapEntry

    paths = [p for p in dict.fromkeys(field_paths) if p]
    if not paths:
        return []
    path_leaf = {p: _leaf_field(p) for p in paths}
    leaves = list({lf for lf in path_leaf.values() if lf})
    if not leaves:
        return []

    rows = session.execute(
        sa_select(CanonEntry.type, CanonEntry.canonical, CanonEntry.aliases)
        .where(CanonEntry.canon_id == canon_id, CanonEntry.type.in_(leaves))
    ).all()

    by_type: Dict[str, List[Any]] = {}
    for etype, canonical, aliases in rows:
        keep = (canonical or "").strip()
        if not keep:
            continue
        names = [str(a) for a in (aliases or []) if str(a).strip()]
        if keep not in names:  # canonical must map to itself so an exact raw value folds cleanly
            names = [keep, *names]
        by_type.setdefault(etype, []).append(MergeMapEntry(keep=keep, names=names))

    maps: List[Any] = []
    for p in paths:
        entries = by_type.get(path_leaf[p])
        if not entries:
            continue
        try:  # field_path is validated; skip anything not a valid merge-map path
            maps.append(MergeMap(field_path=p, entries=entries))
        except ValueError:
            logger.debug("canon_value_merge_maps: skipping invalid field_path %r", p)
            continue
    return maps


def _preload_alias_index(session: Session, canon_id: int, types: List[str]) -> Dict[tuple, int]:
    """One query → ``(type, normalized_name) → entry_id`` for every alias/canonical
    in the canon for the given types. Replaces per-member ``find_by_alias`` SQL so
    promoting a value field of hundreds of canonicals is one query, not N."""
    index: Dict[tuple, int] = {}
    if not types:
        return index
    rows = session.execute(
        sa_select(CanonEntry.id, CanonEntry.type, CanonEntry.canonical, CanonEntry.aliases)
        .where(CanonEntry.canon_id == canon_id, CanonEntry.type.in_(types))
    ).all()
    for eid, etype, canonical, aliases in rows:
        for name in [canonical, *(aliases or [])]:
            norm = (str(name) if name is not None else "").strip().lower()
            if norm:
                index[(etype, norm)] = eid
    return index


def promote_folds(
    session: Session,
    infospace_id: int,
    canon_id: int,
    folds: List[Dict[str, Any]],
    log_user_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Persist run folds into a canon. Caller owns the transaction (no commit).

    Per fold: resolve every member (keep + names) against the canon by
    exact/alias within its type. If none match → create. If members resolve to
    one entry → extend its aliases. If members resolve to *distinct* entries →
    the fold says they're one, so ``combine_entries`` them into the keep. Either
    way, every member string ends up an alias of the keep entry.

    Resolution uses a single preloaded alias index (kept fresh as folds create /
    merge entries), so the whole promote is one read regardless of fold count.
    """
    created = merged = extended = skipped = 0
    entries: List[Dict[str, Any]] = []

    types = list({(f.get("type") or "UNKNOWN") for f in folds})
    index = _preload_alias_index(session, canon_id, types)

    def lookup(etype: str, name: str) -> Optional[CanonEntry]:
        norm = (name or "").strip().lower()
        eid = index.get((etype, norm)) if norm else None
        return session.get(CanonEntry, eid) if eid else None

    def reindex(entry: CanonEntry) -> None:
        for name in [entry.canonical, *(entry.aliases or [])]:
            norm = (str(name) if name is not None else "").strip().lower()
            if norm:
                index[(entry.type, norm)] = entry.id

    for fold in folds:
        keep = (fold.get("keep") or "").strip()
        etype = fold.get("type") or "UNKNOWN"
        names = [n for n in (fold.get("names") or []) if (n or "").strip()]
        if not keep:
            skipped += 1
            continue
        members = list(dict.fromkeys([keep, *names]))  # order-preserving dedup

        matched: Dict[int, CanonEntry] = {}
        for m in members:
            e = lookup(etype, m)
            if e:
                matched[e.id] = e

        if not matched:
            ent = CanonEntry(
                infospace_id=infospace_id, canon_id=canon_id,
                canonical=keep, type=etype, aliases=members, provenance_type="manual",
            )
            session.add(ent)
            session.flush()
            reindex(ent)
            created += 1
            entries.append({"keep": keep, "type": etype, "status": "created", "entry_id": ent.id})
            continue

        keep_entry = lookup(etype, keep) or next(iter(matched.values()))
        other_ids = [eid for eid in matched if eid != keep_entry.id]
        if other_ids:
            keep_entry = combine_entries(
                session, canon_id=canon_id,
                entry_ids=[keep_entry.id, *other_ids], keep_id=keep_entry.id,
                canonical=keep, log_user_id=log_user_id,
            )
            merged += 1
            status = "merged"
        else:
            extended += 1
            status = "extended"

        # combine_entries unions the merged entries' aliases; literal member
        # strings that were never their own entry must still become aliases.
        alias_set = set(keep_entry.aliases or [])
        alias_set.update(members)
        keep_entry.canonical = keep
        keep_entry.aliases = list(alias_set)
        keep_entry.provenance_type = "manual"
        session.add(keep_entry)
        session.flush()
        reindex(keep_entry)
        entries.append({"keep": keep, "type": etype, "status": status, "entry_id": keep_entry.id})

    summary = {"created": created, "merged": merged, "extended": extended, "skipped": skipped, "entries": entries}
    logger.info("promote_folds: canon %s — %s", canon_id, {k: v for k, v in summary.items() if k != "entries"})
    return summary
