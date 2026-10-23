"""What a revision would change, read against what a run has made.

    changes(session, run, schema, to) -> SchemaChanges

Two schema maps, the one the run reads through and the one it would read
through (its draft, or the head it is pinned behind), diffed field by field —
and every change scored against the run's own annotations, so the question
"what does this cost?" is answered by the data rather than by the diff:

    added      n annotations missing it                → fill
    removed    n values kept, unread; what reads it    → nothing to do, but see who reads it
    retyped    n values that no longer fit             → re-read
    narrowed   n values outside the new vocabulary     → re-read
    widened    old values still fit                    → nothing
    reworded   the prompt says something else          → re-read if it matters
    instructions                                       → the same, for the whole schema

**Breaking** means some value the run holds no longer fits the contract;
anything less is **additive**: the old reads stand, new fields can be filled.

Values are looked at latest first, up to ``LOOK``; the answer says how many
were looked at, so a count is never presented as more than it is. What reads a
field is found in the run's saved dashboard — panels, their filters, axes,
aliases and saved sets — by the field's path, in any of the spellings a panel
writes it.
"""
from __future__ import annotations

import json
import re
from typing import Any, Literal, Optional

from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session

from app.api.modules.annotation.drafts import draft_for
from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema
from app.api.modules.annotation.revisions import contract_at, revision_for
from app.api.modules.annotation.schema_map import FieldNode, SchemaMap, iter_values, schema_map_for, strip_explosions

#: Annotations looked at, latest first.
LOOK = 2000

ChangeKind = Literal["added", "removed", "retyped", "narrowed", "widened", "reworded", "instructions"]

_STRINGY = {"string", "date", "enum_string"}
_LISTS = {"array_string", "array_string_enum", "array_number", "array_object", "array_entity", "triplet"}


class FieldChange(BaseModel):
    path: str
    kind: ChangeKind
    label: Optional[str] = None
    before: Optional[str] = None
    after: Optional[str] = None
    affected: int = 0
    """Added: annotations without it. Removed: annotations holding a value.
    Retyped, narrowed: values that no longer fit."""
    read_by: list[str] = []
    """Panels of the run's dashboard that read the field."""


class TypeDrop(BaseModel):
    type: str
    decisions: int
    """The run's entity decisions naming the type."""


class SchemaChanges(BaseModel):
    reads: int
    """The revision the run reads now."""
    to: Literal["draft", "head"]
    verdict: Literal["same", "additive", "breaking"]
    changes: list[FieldChange]
    dropped_types: list[TypeDrop]
    annotations: int
    """The run's annotations of the schema."""
    looked_at: int


def _filled(v: Any) -> bool:
    return v is not None and (not isinstance(v, (list, dict, str)) or len(v) > 0)


def _fits(v: Any, node: FieldNode) -> bool:
    """Does a value read under an older contract still fit *node*?"""
    shape = node.shape
    if shape in _LISTS:
        if not isinstance(v, list):
            return False
        if shape == "array_string_enum" and node.enum:
            return all(x in node.enum for x in v)
        return True
    if shape in _STRINGY:
        return isinstance(v, str) and (shape != "enum_string" or not node.enum or v in node.enum)
    if shape == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if shape == "boolean":
        return isinstance(v, bool)
    if shape == "object":
        return isinstance(v, dict)
    if shape == "entity":
        return isinstance(v, (dict, str))
    return True


def _types(node: FieldNode) -> set[str]:
    return {t.upper() for t in (node.entity_type, *node.alternate_types) if t}


def _entity_type(v: Any) -> Optional[str]:
    return v.get("type").upper() if isinstance(v, dict) and isinstance(v.get("type"), str) else None


def _vocabulary(node: FieldNode) -> tuple[set[str], str]:
    """What a field's values are drawn from, and what to call it."""
    if node.is_entity:
        return _types(node), "types"
    return set(node.enum), "values"


def _containers(path: str) -> list[str]:
    """Every field *path* sits inside: ``a.b[*].c`` → ``a``, ``a.b[*]``."""
    parts = path.split(".")
    return [".".join(parts[:i]) for i in range(1, len(parts))]


def _diff(old: SchemaMap, new: SchemaMap) -> list[tuple[str, ChangeKind, Optional[FieldNode], Optional[FieldNode], str | None, str | None]]:
    before = {n.path: n for n in old.fields}
    after = {n.path: n for n in new.fields}
    out = []
    for path, n in after.items():
        if path not in before:
            out.append((path, "added", None, n, None, n.shape))
    for path, o in before.items():
        n = after.get(path)
        if n is None:
            out.append((path, "removed", o, None, o.shape, None))
            continue
        if o.shape != n.shape:
            out.append((path, "retyped", o, n, o.shape, n.shape))
            continue
        was, what = _vocabulary(o)
        now, _ = _vocabulary(n)
        if was != now and (was or now):
            gone, came = was - now, now - was
            # An empty vocabulary is an open one: closing it narrows, opening widens.
            narrowed = (bool(gone) and bool(now)) or (not was and bool(now))
            out.append((path, "narrowed" if narrowed else "widened", o, n,
                        ", ".join(sorted(gone)) or f"open {what}", ", ".join(sorted(came)) or f"open {what}"))
        elif (o.description or "") != (n.description or "") or (o.label or "") != (n.label or ""):
            out.append((path, "reworded", o, n, o.description, n.description))
    # A field added or removed with the field it sits in is said by that one.
    whole = {(c[0], c[1]) for c in out if c[1] in ("added", "removed")}
    out = [c for c in out if not any(
        (p, c[1]) in whole for p in _containers(c[0]))]
    # In the order the new contract reads, what it dropped after.
    order = {n.path: i for i, n in enumerate(new.fields)}
    for i, n in enumerate(old.fields):
        order.setdefault(n.path, len(new.fields) + i)
    return sorted(out, key=lambda c: order[c[0]])


def _affected(kind: ChangeKind, path: str, old: Optional[FieldNode], new: Optional[FieldNode],
              values: list[Any]) -> int:
    if kind == "added":
        return sum(1 for v in values if not any(_filled(h.value) for h in iter_values(v, path)))
    if kind == "removed":
        return sum(1 for v in values if any(_filled(h.value) for h in iter_values(v, path)))
    if kind == "retyped":
        return sum(1 for v in values for h in iter_values(v, path) if _filled(h.value) and not _fits(h.value, new))
    if kind == "narrowed":
        if new.is_entity:
            keep = _types(new)
            if not keep:
                return 0
            return sum(1 for v in values for h in iter_values(v, path)
                       for e in (h.value if isinstance(h.value, list) else [h.value])
                       if (t := _entity_type(e)) and t not in keep)
        return sum(1 for v in values for h in iter_values(v, path) if _filled(h.value) and not _fits(h.value, new))
    return 0


_MARKERS = re.compile(r"\[(?:\*|\d+)\]")


def _panels(run: AnnotationRun) -> list[tuple[str, str]]:
    """``(name, text)`` per saved panel, its config flattened to one string
    with array markers dropped — the spelling every reference can be found in."""
    views = run.views_config
    dashboards = views if isinstance(views, list) else [views] if isinstance(views, dict) else []
    out = []
    for d in dashboards:
        for p in (d.get("panels") or []) if isinstance(d, dict) else []:
            if isinstance(p, dict):
                out.append((str(p.get("name") or p.get("type") or "Panel"),
                            _MARKERS.sub("", json.dumps(p, default=str))))
    return out


def _read_by(path: str, section: str, panels: list[tuple[str, str]]) -> list[str]:
    full = strip_explosions(path)
    rel = full[len(section) + 1:] if full.startswith(section + ".") else full
    # The field, or anything inside it, at the start of a string or a query term.
    pattern = re.compile(rf'(?:^|["\s(:])(?:{re.escape(section)}\.)?{re.escape(rel)}(?=["\s.,)]|$)')
    return [name for name, body in panels if pattern.search(body)]


def changes(session: Session, run: AnnotationRun, schema: AnnotationSchema,
            to: Literal["draft", "head"]) -> SchemaChanges:
    reads = revision_for(session, run, schema)
    old_contract, old_instructions = contract_at(session, schema, reads)
    if to == "draft":
        draft = draft_for(session, run, schema)
        if draft is None:
            raise LookupError(f"run {run.id} has no draft of schema {schema.id}")
        new_contract, new_instructions = draft.output_contract, draft.instructions
    else:
        new_contract, new_instructions = schema.output_contract, schema.instructions

    old_map, new_map = schema_map_for(old_contract), schema_map_for(new_contract)
    args = {"r": run.id, "s": schema.id}
    total = session.execute(text(
        "SELECT count(*) FROM annotation WHERE run_id = :r AND schema_id = :s AND status = 'SUCCESS'"
    ), args).scalar() or 0
    values = session.execute(text("""
        SELECT value FROM annotation WHERE run_id = :r AND schema_id = :s AND status = 'SUCCESS'
        ORDER BY id DESC LIMIT :n
    """), {**args, "n": LOOK}).scalars().all()
    panels = _panels(run)

    out: list[FieldChange] = []
    for path, kind, o, n, before, after in _diff(old_map, new_map):
        node = n or o
        out.append(FieldChange(
            path=path, kind=kind, label=node.label, before=before, after=after,
            affected=_affected(kind, path, o, n, values),
            read_by=_read_by(path, node.section, panels) if kind in ("removed", "retyped", "narrowed") else [],
        ))
    if (old_instructions or "") != (new_instructions or ""):
        out.append(FieldChange(path="", kind="instructions", before=old_instructions, after=new_instructions))

    gone = set().union(*(_types(n) for n in old_map.entity_fields())) - \
        set().union(*(_types(n) for n in new_map.entity_fields()))
    dropped: list[TypeDrop] = []
    if gone:
        counts = dict(session.execute(text("""
            SELECT upper(t), count(*) FROM (
                SELECT a_type AS t FROM entity_decision WHERE run_id = :r
                UNION ALL SELECT b_type FROM entity_decision WHERE run_id = :r
            ) x GROUP BY 1
        """), {"r": run.id}).all())
        dropped = [TypeDrop(type=t, decisions=counts.get(t, 0)) for t in sorted(gone)]

    breaking = any(c.kind in ("retyped", "narrowed") and c.affected for c in out)
    return SchemaChanges(
        reads=reads, to=to,
        verdict="breaking" if breaking else "additive" if out else "same",
        changes=out, dropped_types=dropped, annotations=total, looked_at=len(values),
    )
