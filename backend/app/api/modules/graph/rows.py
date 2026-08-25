"""The rows behind the picture.

A section is a relation in the relational sense, its ``{name, type}`` references
are foreign keys into the roster sections, and the assembled graph is **one
join** of it. For a long time the join was the only thing on the wire, so every
pane tried to read the rows back off it — which cannot work, because assembly is
lossy in one direction:

.. code-block:: text

    { by: Halász  to: Corvus  via: a/c 8820  kind: payment  when: 2016-01-12
      magnitude: 250000  justification: "transfer TX-4400 cleared via …" }
                  │
                  │  assemble()          ← one proposition becomes 5 fragments
                  ▼
      1 occurrence node + 4 role edges, justification stranded on the node
                  │
                  │  a pane folds NODES
                  ▼
            "payment ×8"                 ← unrecoverable

This module ships the left-hand side alongside the right, so a pane can render
the proposition instead of a count of its pieces. See
``docs/plans/observation-model/ROWS_AND_FORCES.md`` §1 and ``MVP.md`` §4.

Three things live here, and nothing else:

* **addressing** — one path shape (``observations.by[*].name``) resolved
  against this run's contract, shared by filters and projections so the two
  cannot disagree about what a path means;
* **columns** — what a section's table has in it, from the declarations;
* **cells** — the row's values, with entity references carrying the node id the
  assembler minted, which is what makes selection one thing across two surfaces.

The SQL lives on :meth:`AnnotationGraphSource.section_rows`, deliberately: it
rebuilds the predicate from the same helpers the canvas uses, so ``MVP`` S3 —
*the canvas and the table are the same filter, always* — holds by construction
rather than by discipline.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.api.modules.annotation.panel_config import NodeRole, Projection

logger = logging.getLogger(__name__)

__all__ = [
    "FieldPath", "RowColumn", "SectionRows",
    "parse_path", "resolve_path", "section_names", "section_of",
    "columns_for", "cells_for", "choose_section",
]

#: Keys that carry an entity's name inside a reference object, in precedence
#: order. Mirrors what the assembler coerces; a row may say ``name`` or the
#: triplet family may say ``subject_name``.
_NAME_KEYS = ("name", "label", "title", "value")
_TYPE_KEYS = ("type", "entity_type", "kind")

#: Row keys that are never columns — they are the row's grounds, rendered by
#: every surface through one component rather than sitting in a cell.
_GROUNDS_KEYS = frozenset({"justification", "evidence", "grounds", "citation"})

#: Column key for a roster row, where the element itself is the entity.
_SELF = "@self"


# ── Addressing ────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class FieldPath:
    """A parsed ``observations.by[*].name``.

    ``head`` is the section name as written; ``segments`` is everything inside
    the row. ``[*]`` is dropped on parse and never reappears: whether a segment
    explodes is a property of the *data*, not of how someone spelled it. That is
    what lets ``by.name``, ``by[*].name`` and ``by.[*].name`` be one path — a
    model writes all three interchangeably and none of them should be a failure.
    """

    head: str
    segments: tuple[str, ...] = ()

    @property
    def is_bare(self) -> bool:
        """No dotted remainder — the token addresses a section, not a field."""
        return not self.segments

    @property
    def rel(self) -> str:
        """The path relative to the exploded row element."""
        return ".".join(self.segments)

    def __str__(self) -> str:  # pragma: no cover - display only
        return ".".join((self.head, *self.segments))


def parse_path(raw: str) -> FieldPath:
    """``ACTORS.[*].type`` → ``FieldPath("actors", ("type",))``.

    Case is folded because section names are the analyst's own words and asking
    them to match the contract's casing is a tax with no return. The reserved
    rule is untouched: an UPPERCASE token *with a colon* is a channel, and this
    function never sees one.
    """
    cleaned = (raw or "").strip().replace("[*]", "").replace("..", ".")
    parts = [p for p in cleaned.split(".") if p]
    if not parts:
        return FieldPath("")
    return FieldPath(parts[0].strip().lower(), tuple(p.strip() for p in parts[1:]))


def section_of(path: str) -> str:
    """``document.observations[*]`` → ``observations``.

    The **last** segment, where :func:`parse_path` takes the first — because a
    contract path is written outward-in (``document.observations[*]``) and a
    user-written address is written inward-out (``observations.by.name``). One
    function for both looks tempting and yields a section called ``document``.
    """
    return (path or "").rsplit(".", 1)[-1].removesuffix("[*]").strip().lower()


def section_names(projections: list[Projection]) -> dict[str, Projection]:
    """This run's section names → their projections, lowercased.

    The name is the last segment of the projection path, which is what the
    schema author called the section and therefore the only spelling anyone
    would reach for. ``document.observations[*]`` → ``observations``.
    """
    out: dict[str, Projection] = {}
    for p in projections or ():
        path = getattr(p, "path", "") or ""
        if not path:
            continue
        out.setdefault(section_of(path), p)
    return out


def resolve_path(
    raw: str, projections: list[Projection],
) -> tuple[Projection | None, FieldPath]:
    """Split a written path into *which section* and *what inside it*.

    Returns ``(None, path)`` when the head names no section in this run — which
    is a **reportable** outcome, not an empty result. An unresolvable path that
    silently filters to nothing is the failure this whole grammar exists to
    remove: on run 15010 ``political_relevance>8`` returns an empty canvas with
    no signal at all, and a reader cannot tell a wrong question from a true
    negative.
    """
    fp = parse_path(raw)
    if not fp.head:
        return None, fp
    return section_names(projections).get(fp.head), fp


# ── Columns ───────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class RowColumn:
    """One column of a section's table.

    ``kind`` is the declared axis kind, which is what lets the renderer draw a
    metric as a bar and a nominal as a chip without a per-column switch existing
    anywhere in the UI. ``ref`` marks the columns whose cells carry node ids, so
    the table can highlight the canvas and the canvas can filter the table
    without either knowing the other's shape.
    """

    key: str
    label: str
    kind: str = "nominal"
    ref: str | None = None          # "entity" when the cell holds node refs
    #: The entity type this column's values are, when the role declared one.
    #: Needed because a schema may write an entity slot as bare strings —
    #: `["HBRK Associates Inc.", "Unnamed foundation"]` — and a name alone
    #: cannot mint a node id, which is `hash(name + type)`.
    entity_type: str | None = None
    unit: str | None = None
    #: Where this column came from — a declaration, or the shape of the data.
    #: Shown in the UI, because a column the engine guessed and a column the
    #: schema stated should not look equally authoritative.
    source: str = "declared"
    #: How many rows of the SECTION fill this column, and a few of the values.
    #: Counted over the whole section rather than the page — the fields worth
    #: warning someone about are the rare ones, and a page-scoped count reports
    #: those as empty. `None` when no census ran.
    filled: int | None = None
    examples: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        d = {"key": self.key, "label": self.label, "kind": self.kind,
             "source": self.source}
        if self.ref:
            d["ref"] = self.ref
        if self.entity_type:
            d["entityType"] = self.entity_type
        if self.unit:
            d["unit"] = self.unit
        if self.filled is not None:
            d["filled"] = self.filled
        if self.examples:
            d["examples"] = list(self.examples)
        return d


def _role_columns(proj: Projection) -> list[RowColumn]:
    """A column per entity-bearing slot, in declaration order.

    The label is the role's own — ``by``, ``to``, ``via`` — because that word is
    the finding. "Halász → Corvus via a/c 8820" reads; "participant, participant,
    participant" does not, and the model was asked for the distinction.
    """
    out: list[RowColumn] = []
    for role in proj.nodes or ():
        path = (role.path or "").replace("[*]", "")
        if not path:
            # The roster case: the element **is** the entity, so there is no
            # key to read. Emitting a column called "self" produced a header
            # over an empty column while the entity's own `name` came back
            # marked as inferred — the one section whose meaning is entirely
            # declared, reported as guesswork.
            out.append(RowColumn(
                key=_SELF, label=role.label or "name", kind="nominal",
                ref="entity", entity_type=role.type_const,
            ))
            continue
        out.append(RowColumn(
            key=path, label=role.label or path, kind="nominal", ref="entity",
            entity_type=role.type_const,
        ))
    return out


def _binding_columns(proj: Projection) -> list[RowColumn]:
    """The row's own bindings — identity, time, place, magnitude.

    Read off the declaration rather than off the data, so a section that happens
    to be empty in this run still shows the shape it promises.
    """
    out: list[RowColumn] = []
    if proj.node_name:
        out.append(RowColumn(proj.node_name, proj.node_name, "nominal"))
    if proj.node_type_path:
        out.append(RowColumn(proj.node_type_path, proj.node_type_path, "nominal"))
    if proj.predicate:
        out.append(RowColumn(proj.predicate, proj.predicate, "nominal"))

    t = proj.time
    if t and t.active:
        # A start/end pair is ONE interval column, not two nominal ones —
        # `when → until` is a single fact and splitting it makes the table
        # ask the reader to re-join what the model already joined.
        for p in (t.at, t.start, t.end):
            if p:
                out.append(RowColumn(p, p, "interval"))
    pb = proj.place_binding
    if pb and pb.active:
        for p in (pb.at, pb.start, pb.end, pb.kind):
            if p:
                out.append(RowColumn(p, p, "spatial"))
    if proj.weight:
        out.append(RowColumn(proj.weight, proj.weight, "metric"))
    for spec in proj.properties or ():
        fld = getattr(spec, "field", None)
        if fld:
            out.append(RowColumn(fld, fld, "nominal"))
    return out


def _kind_of(values: list[Any]) -> str:
    """The axis kind a column's values imply, when nothing declared one.

    Deliberately coarse — metric or nominal. Guessing `ordinal` from strings
    that happen to sort would produce a ladder nobody authored, and a wrong
    ladder is worse than an honest pile.
    """
    seen = [v for v in values if v not in (None, "")]
    if seen and all(isinstance(v, (int, float)) and not isinstance(v, bool)
                    for v in seen):
        return "metric"
    return "nominal"


def _is_entity_ref(v: Any) -> bool:
    """A ``{name, type}`` object, or a list of them."""
    if isinstance(v, list):
        return bool(v) and _is_entity_ref(v[0])
    return isinstance(v, dict) and any(k in v for k in _NAME_KEYS)


def columns_for(
    proj: Projection,
    elements: list[dict[str, Any]],
    show: list[str] | None = None,
    census: dict[str, dict[str, Any]] | None = None,
) -> list[RowColumn]:
    """The table's columns: declarations first, then whatever the rows also hold.

    Declared columns come first and in declaration order, because that order is
    the schema author's statement about what matters. Undeclared keys present in
    the data follow, marked ``source="shape"`` — they are shown rather than
    dropped (``MVP`` S5: nothing the data contains is hidden by default) but they
    do not get to look as authoritative as a declaration.

    ``show`` is the ``SHOW:`` projection. It selects **and orders**; a name it
    asks for that no row carries is simply absent, and the caller reports it —
    an unknown column must not silently produce an empty table.
    """
    section = section_of(getattr(proj, "path", "") or "")
    cols: list[RowColumn] = []
    seen: set[str] = set()

    def _add(c: RowColumn) -> None:
        if c.key and c.key not in seen and c.key not in _GROUNDS_KEYS:
            seen.add(c.key)
            cols.append(c)

    for c in _role_columns(proj):
        _add(c)
    for c in _binding_columns(proj):
        # A place binding of `at.name` beside a role of `at` is the same fact
        # twice — the binding reaches *into* the entity the role already shows.
        # Two columns, one of them a bare string, reads as two different places.
        if "." in c.key and c.key.split(".", 1)[0] in seen:
            continue
        _add(c)

    # Whatever else the rows actually carry. `sorted` because dict order across
    # a page of rows is not stable enough to make a column order out of.
    roster = _SELF in seen
    extra: dict[str, list[Any]] = {}
    for el in elements:
        for k, v in (el or {}).items():
            if k in seen or k in _GROUNDS_KEYS:
                continue
            # A roster row IS its entity, so its `name`/`type` are already the
            # `@self` column's two halves. Listing them again would show one
            # thing three times.
            if roster and k in (*_NAME_KEYS, *_TYPE_KEYS):
                continue
            extra.setdefault(k, []).append(v)
    for k in sorted(extra):
        vals = extra[k]
        _add(RowColumn(
            key=k, label=k,
            kind="nominal" if _is_entity_ref(vals[0]) else _kind_of(vals),
            ref="entity" if _is_entity_ref(vals[0]) else None,
            source="shape",
        ))

    def _stamp(out: list[RowColumn]) -> list[RowColumn]:
        """Attach section-wide fill counts. Done once here rather than at each
        construction site, so a column built by any of the three routes —
        declared role, declared binding, found in the data — reports coverage
        the same way or not at all."""
        if census is None:
            return out
        for c in out:
            # A declared column the census never saw is filled ZERO times, not
            # an unknown number. Leaving it None would render "declared but
            # never filled" identically to "we did not look", and the first is
            # a finding about the corpus while the second is a shrug.
            stat = census.get(c.key) or {}
            c.filled = int(stat.get("filled") or 0)
            c.examples = tuple(stat.get("examples") or ())
        return out

    if not show:
        return _stamp(cols)

    by_key = {c.key.lower(): c for c in cols}
    if any(s.strip() == "*" for s in show):
        return _stamp(cols)
    picked: list[RowColumn] = []
    for name in show:
        # `SHOW:observations.by` and `SHOW:by` address the same column — the
        # qualified form is what a writer reaches for when several sections are
        # in play, and refusing it would make the addressing grammar true in
        # filters and false in projections.
        fp = parse_path(name)
        segs = list(fp.segments)
        # A path may start with this section's own name, and it is the same
        # column either way.
        if segs and fp.head == section:
            rel = ".".join(segs)
        elif segs:
            rel = ".".join([fp.head, *segs])
        else:
            rel = fp.head
        col = by_key.get(rel.lower()) or by_key.get(name.strip().lower())
        if col is None and "." in rel:
            # **A path INTO a column is a column.** `SHOW:by.name` asks for the
            # payer's name, not for the payer — and truncating it to its last
            # segment (`name`) matched nothing on observations, so the column
            # was silently dropped and the table fell back to showing
            # everything. The reader asked one question and got twenty columns.
            #
            # `cells_for` already walks nested paths and flattens arrays, so the
            # only thing missing was a column to hang the path on.
            col = _derived_column(rel, elements)
        if col and col not in picked:
            picked.append(col)
    return _stamp(picked or cols)


def _derived_column(rel: str, elements: list[dict[str, Any]]) -> RowColumn | None:
    """A column for a path that reaches INSIDE another column.

    Kind and reference-ness are read from what the rows actually hold, because
    nothing declared this column — it is an address someone wrote, and the only
    honest description of it is what comes back.
    """
    segs = tuple(rel.split("."))
    seen = [v for v in (_read(el, segs) for el in elements) if v not in (None, "", [])]
    if not seen and elements:
        return None
    flat: list[Any] = []
    for v in seen:
        flat.extend(v if isinstance(v, list) else [v])
    return RowColumn(
        key=rel, label=rel, source="shape",
        kind="nominal" if _is_entity_ref(flat[:1]) else _kind_of(flat),
        ref="entity" if flat and _is_entity_ref(flat[0]) else None,
    )


# ── Cells ─────────────────────────────────────────────────────────────────────


def _read(el: Any, segments: tuple[str, ...]) -> Any:
    """Walk a path into a row, flattening arrays as it goes.

    Flattening is what makes ``[*]`` optional: a segment that lands on a list
    maps over it rather than failing, so ``by.name`` reads the names out of a
    multi-valued slot exactly as ``by[*].name`` does.
    """
    cur: Any = el
    for seg in segments:
        if isinstance(cur, list):
            out = [x.get(seg) for x in cur if isinstance(x, dict)]
            cur = [x for x in out if x is not None]
        elif isinstance(cur, dict):
            cur = cur.get(seg)
        else:
            return None
    return cur


def _ref(v: dict[str, Any], node_id: Any) -> dict[str, Any]:
    name = next((str(v[k]) for k in _NAME_KEYS if v.get(k)), "")
    typ = next((str(v[k]) for k in _TYPE_KEYS if v.get(k)), "")
    out: dict[str, Any] = {"name": name}
    if typ:
        out["type"] = typ
    if name and node_id is not None:
        out["nodeId"] = node_id(name, typ)
    return out


def _cell(v: Any, node_id: Any, entity_type: str | None = None) -> Any:
    """One value, with entity references resolved to node ids.

    A multi-valued slot stays **one cell**. Exploding it into N rows would
    multiply the table and make every count downstream a lie — the row is the
    proposition, and a payment with two payers is one payment.

    **A bare string in an entity slot is an entity.** Plenty of schemas write
    one that way — `["HBRK Associates Inc.", "Unnamed foundation"]` — and the
    assembler has always coerced it. Leaving it as a raw value here is what put
    a JSON array on screen where two names belonged, and cost the cell its node
    ids, so clicking it selected nothing.
    """
    if isinstance(v, list):
        return [_cell(x, node_id, entity_type) for x in v]
    if isinstance(v, dict):
        if any(k in v for k in _NAME_KEYS):
            return _ref(v, node_id)
        return v
    if entity_type is not None and isinstance(v, str) and v.strip():
        return _ref({"name": v.strip(), "type": entity_type}, node_id)
    return v


def _grounds(el: dict[str, Any]) -> dict[str, Any] | None:
    """The row's justification, in the one shape every surface renders.

    Justification belongs to a **row**, not to a node. Hanging it on nodes is
    what produced an evidence pane that ranked node labels by a value of 1.
    """
    for key in ("justification", "evidence", "grounds"):
        raw = el.get(key)
        if isinstance(raw, dict):
            spans = raw.get("text_spans") or raw.get("spans") or []
            quote = None
            if isinstance(spans, list) and spans:
                first = spans[0]
                quote = (
                    first.get("text_snippet") or first.get("text")
                    if isinstance(first, dict) else str(first)
                )
            reasoning = raw.get("reasoning") or raw.get("text")
            if quote or reasoning:
                return {"reasoning": reasoning, "quote": quote}
        elif isinstance(raw, str) and raw.strip():
            return {"reasoning": raw.strip(), "quote": None}
    return None


def cells_for(
    element: dict[str, Any],
    columns: list[RowColumn],
    node_id: Any = None,
) -> dict[str, Any]:
    """A row's values, keyed by column.

    ``node_id`` is ``(name, type) -> str``, supplied by the caller because only
    the assembler knows the dedup mode its ids were minted under. Passing it in
    rather than importing it keeps this module free of the graph's assembly
    order — and keeps the two id derivations provably the same function.
    """
    out: dict[str, Any] = {}
    for col in columns:
        if col.key == _SELF:
            ref = _ref(element, node_id)
            if ref.get("name"):
                out[col.key] = ref
            continue
        v = _read(element, tuple(col.key.split("."))) if "." in col.key \
            else element.get(col.key)
        if v is None or v == [] or v == "":
            continue
        out[col.key] = _cell(
            v,
            node_id if col.ref == "entity" else None,
            col.entity_type if col.ref == "entity" else None,
        )
    return out


# ── The page ──────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class SectionRows:
    """One section's rows, projected — the table half of a graph view."""

    section: str
    path: str
    columns: list[RowColumn] = field(default_factory=list)
    items: list[dict[str, Any]] = field(default_factory=list)
    total: int = 0
    cursor_next: str | None = None
    #: Anything the reader must know to trust the numbers: an unresolved
    #: ``SHOW:`` name, a section that could not be found, a truncated page.
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "section": self.section,
            "path": self.path,
            "columns": [c.as_dict() for c in self.columns],
            "items": self.items,
            "total": self.total,
            "cursorNext": self.cursor_next,
            "notes": self.notes,
        }


def choose_section(
    projections: list[Projection],
    requested: list[str] | None = None,
) -> Projection | None:
    """Which section the table shows.

    ``SECTION:`` names it. Absent, prefer a section whose rows are *things that
    happened* (``about: self``, minting an occurrence) over a roster — a table
    of the acts answers a question where a table of the cast is a glossary.

    Among those, the declared **role** breaks the tie, in the order below. This
    is reading a declaration, not preferring a noun: ``role`` is closed
    vocabulary in ``annotation/sections.py`` and a contract that calls its
    claims ``findings`` sorts identically to one that calls them
    ``observations``.

    The choice is deterministic and always stated in the table's notes, because
    a default nobody can see is a magic layout — and one click of ``SECTION:``
    overrides it.
    """
    by_name = section_names(projections)
    for name in requested or ():
        proj = by_name.get(parse_path(name).head)
        if proj is not None:
            return proj

    #: Claims before stations before connections. A claim is what a document
    #: asserts happened; a step is where it sits; an edge is a relation between
    #: two things already listed elsewhere.
    order = {"companion": 0, "step": 1, "edge": 2, "body": 3}
    acts = [
        p for p in projections or ()
        if getattr(p, "about", None) == "self"
        and getattr(p, "node_kind", "occurrence") != "entity"
        and getattr(p, "role", None) != "attachment"
    ]
    if acts:
        return min(
            enumerate(acts),
            key=lambda t: (order.get(getattr(t[1], "role", "") or "", 9), t[0]),
        )[1]
    return (projections or [None])[0]
