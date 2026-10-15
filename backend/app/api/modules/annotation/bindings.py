"""Where and when a row is — per section, for any schema, in any language.

A section's rows sit somewhere in space and time only if something says where
to read that from. Four rungs can say it, strongest first::

    picked       the reader chose a field (or chose none) for this section
    declared     the contract says so — the section's `x-graph` time/place
                 binding, a geo-frame section, an `x-ref` into one
    structural   time: the first field DECLARED a date (`format: date`)
    discovered   place: the first field whose VALUES turn out to be somewhere —
                 they resolve to coordinates, or into the geo canon

No rung reads a field's name. A Portuguese schema with a `local` field typed
`Lugar` lands on the map the moment its values resolve, and a field called
`location` whose values are company names never does.

Plans are pure functions of a SchemaMap plus two inputs that need the database
— which paths are spatial, and what the reader picked — so the same plan can be
rebuilt anywhere without re-reading anything. :func:`discover_spatial` is the
one function here that touches data.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal, Mapping

from app.api.modules.annotation.schema_map import FieldNode, SchemaMap, strip_explosions

if TYPE_CHECKING:
    from sqlmodel import Session

    from app.api.modules.annotation.query import AnnotationQuery

logger = logging.getLogger(__name__)

__all__ = [
    "Binding", "SectionPlan", "SchemaPlan", "Pick",
    "DOCUMENT", "plan_schema", "discover_spatial", "spatial_from",
    "undecided_places", "section_key",
]

#: The pseudo-section every schema has: the annotation itself, as one row.
#: What a flat schema (no arrays at all) is made of, and what "where is this
#: document about" reads.
DOCUMENT = "@document"

BindingSource = Literal["picked", "declared", "structural", "discovered", "none"]

#: Shapes whose values can name a place.
_PLACE_SHAPES = frozenset({
    "entity", "array_entity", "string", "enum_string", "array_string", "array_string_enum",
})
#: Shapes whose values can be read as a time. A date first; a string only when
#: a reader picks it (it may still be ISO), never inferred.
_TIME_SHAPES = frozenset({"date", "string"})
#: Shapes that make a top-level field a section.
_SECTION_SHAPES = frozenset({"array_object", "array_entity", "triplet"})

#: Discovery thresholds. A path is spatial when at least this many of its most
#: frequent values hit, and they are at least this share of what was sampled.
_MIN_HITS = 3
_MIN_SHARE = 0.5
_SAMPLE = 100
_CACHE_TTL = 300.0


@dataclass(frozen=True, slots=True)
class Binding:
    path: str | None
    """An absolute map path (``document.events[*].at``), or None."""
    source: BindingSource = "none"

    def to_wire(self) -> dict[str, Any]:
        return {"path": self.path, "source": self.source}


@dataclass(frozen=True, slots=True)
class Pick:
    """A reader's choice for one section. ``...`` (unset) means "infer";
    ``None`` means "this section has no time/place" — a real answer."""

    time: Any = ...
    place: Any = ...


@dataclass(frozen=True, slots=True)
class SectionPlan:
    key: str
    """``<schema_id>:<path>`` — stable across requests, what picks are keyed by."""
    schema_id: int
    path: str | None
    """The section's array path (``document.events[*]``); None for the document."""
    label: str
    kind: Literal["section", "document"]
    time: Binding
    place: Binding
    time_candidates: tuple[str, ...] = ()
    place_candidates: tuple[str, ...] = ()
    frame: str | None = None
    """The section's declared frame — ``interest`` sections are never placed."""

    def relative(self, path: str) -> str:
        """``document.events[*].at`` → ``at``, against this section's rows."""
        if self.path is None or path == self.path:
            return ""
        prefix = self.path + "."
        return path[len(prefix):] if path.startswith(prefix) else path

    def to_wire(self) -> dict[str, Any]:
        return {
            "key": self.key, "schema_id": self.schema_id, "path": self.path,
            "label": self.label, "kind": self.kind, "frame": self.frame,
            "time": self.time.to_wire(), "place": self.place.to_wire(),
            "time_candidates": list(self.time_candidates),
            "place_candidates": list(self.place_candidates),
        }


@dataclass(frozen=True, slots=True)
class SchemaPlan:
    schema_id: int
    name: str
    smap: SchemaMap = field(repr=False)
    document: SectionPlan = field(repr=False)
    sections: tuple[SectionPlan, ...] = ()

    @property
    def all(self) -> tuple[SectionPlan, ...]:
        return (self.document, *self.sections)

    @property
    def flat(self) -> bool:
        """No sections — the document is the only row there is."""
        return not self.sections


def section_key(schema_id: int, path: str | None) -> str:
    return f"{schema_id}:{path or DOCUMENT}"


# ─── Plans ──────────────────────────────────────────────────────────────────


def _frames(smap: SchemaMap) -> dict[str, str]:
    """Section path (no markers) → its declared frame."""
    out: dict[str, str] = {}
    for n in smap.fields:
        if n.container is None and n.path.endswith("[*]"):
            frame = n.graph_frame or (smap.section_decls.get(n.path) or {}).get("frame")
            if frame:
                out[strip_explosions(n.path)] = frame
    return out


def _framed_elsewhere(node: FieldNode, frames: Mapping[str, str]) -> bool:
    """Does this entity field name things that live in a non-geo framed section
    — events, interests? Then its values are acts or motives, not places, and
    it is no candidate. Declared, so no word list needed."""
    targets = [f"{node.section}.{t}" for t in node.ref_targets]
    return bool(targets) and all(frames.get(t) not in (None, "geo") for t in targets)


def _place_candidates(nodes: list[FieldNode], frames: Mapping[str, str]) -> tuple[str, ...]:
    return tuple(
        n.path for n in nodes
        if n.shape in _PLACE_SHAPES and not _framed_elsewhere(n, frames)
    )


def _time_candidates(nodes: list[FieldNode]) -> tuple[str, ...]:
    # Dates first: they are what a reader is most likely to want.
    dated = [n.path for n in nodes if n.shape == "date"]
    texts = [n.path for n in nodes if n.shape in _TIME_SHAPES and n.shape != "date"]
    return tuple(dated + texts)


def _declared(section_path: str, decl: Mapping[str, Any], key: str,
              have: set[str]) -> str | None:
    """A declared binding, if the field it names exists."""
    binding = decl.get(key)
    if not isinstance(binding, dict):
        return None
    for slot in ("at", "start"):
        rel = binding.get(slot)
        if isinstance(rel, str) and rel:
            path = f"{section_path}.{rel.removesuffix('.name')}"
            if path in have:
                return path
    return None


def _choose(pick: Any, declared: str | None, inferred: str | None,
            inferred_source: BindingSource) -> Binding:
    if pick is not ...:
        return Binding(pick, "picked" if pick else "none")
    if declared:
        return Binding(declared, "declared")
    if inferred:
        return Binding(inferred, inferred_source)
    return Binding(None, "none")


def plan_schema(
    schema_id: int,
    name: str,
    smap: SchemaMap,
    *,
    spatial: frozenset[str] = frozenset(),
    picks: Mapping[str, Pick] | None = None,
) -> SchemaPlan:
    """Every section of one schema, with where/when to read each row.

    ``spatial`` is the discovered set (:func:`discover_spatial`); declared
    places come from ``smap.place_paths`` and need nothing from the database.
    """
    picks = picks or {}
    have = {n.path for n in smap.fields}
    places = set(smap.place_paths) | set(spatial)
    frames = _frames(smap)

    def declared_or(inferred: str | None) -> str | None:
        return inferred if inferred in smap.place_paths else None

    top = [n for n in smap.fields if n.container is None and "[*]" not in n.path]
    doc_key = section_key(schema_id, None)
    doc_pick = picks.get(doc_key, Pick())
    doc_place = next((n.path for n in top
                      if n.path in places and n.shape in _PLACE_SHAPES), None)
    document = SectionPlan(
        key=doc_key, schema_id=schema_id, path=None, label="Document", kind="document",
        time=_choose(doc_pick.time, None,
                     next((n.path for n in top if n.shape == "date"), None), "structural"),
        place=_choose(doc_pick.place, declared_or(doc_place), doc_place, "discovered"),
        time_candidates=_time_candidates(top),
        place_candidates=_place_candidates(top, frames),
    )

    sections: list[SectionPlan] = []
    for node in smap.fields:
        if node.container is not None or node.shape not in _SECTION_SHAPES:
            continue
        path = node.path if node.path.endswith("[*]") else f"{node.path}[*]"
        key = section_key(schema_id, path)
        pick = picks.get(key, Pick())
        decl = smap.section_decls.get(path) or {}
        frame = frames.get(strip_explosions(path))
        inner = list(smap.in_container(path))

        if frame == "interest":
            # A motive is not somewhere. Never placed, whatever is picked.
            place = Binding(None, "none")
        else:
            # A roster is a population, and whether a population is a set of
            # places is the contract's to say (`frame: geo`). Sampling it would
            # put an actors roster on the map because some actors are states.
            roster_place = path if path in smap.place_paths else None
            first_inner = next((n.path for n in inner if n.path in places), None)
            inferred = roster_place or first_inner
            place = _choose(pick.place,
                            _declared(path, decl, "place", have) or declared_or(inferred),
                            inferred, "discovered")

        # A field the declaration names as the END of the interval is never
        # promoted to its start — even when the start it names is missing.
        ends = {f"{path}.{rel}" for rel in [(decl.get("time") or {}).get("end")] if rel}
        time_ = _choose(pick.time, _declared(path, decl, "time", have),
                        next((n.path for n in inner
                              if n.shape == "date" and n.path not in ends), None),
                        "structural")

        own_candidates = (path,) if node.shape == "array_entity" else ()
        sections.append(SectionPlan(
            key=key, schema_id=schema_id, path=path,
            label=strip_explosions(path).rsplit(".", 1)[-1], kind="section",
            time=time_, place=place,
            time_candidates=_time_candidates(inner),
            place_candidates=() if frame == "interest"
            else own_candidates + _place_candidates(inner, frames),
            frame=frame,
        ))

    return SchemaPlan(schema_id=schema_id, name=name, smap=smap,
                      document=document, sections=tuple(sections))


# ─── Discovery ──────────────────────────────────────────────────────────────

_discovery_cache: dict[tuple, tuple[float, dict[str, tuple[int, int]]]] = {}


def discover_spatial(
    session: "Session",
    aq: "AnnotationQuery",
    smap: SchemaMap,
    *,
    infospace_id: int,
    canon_ids: tuple[int, ...] = (),
    geo_canon_id: int | None = None,
    cache_key: tuple = (),
    only: set[str] | None = None,
) -> dict[str, tuple[int, int]]:
    """``path → (hits, sampled)`` for every undeclared place candidate.

    A path's most frequent values are resolved through the canon ladder
    (:func:`graph.places.resolve_places`); a value **hits** when it is located
    or lives in the geo canon. Use :func:`spatial_from` to turn this into the
    set a plan wants — the raw numbers ride to the client so a picker can say
    *"at — 41 of 44 resolve"*.

    ``only`` limits sampling to the paths a plan actually needs to decide,
    which on a schema that declares its places is usually none at all.
    Cached per ``cache_key`` for five minutes.
    """
    from app.api.modules.graph.places import resolve_places

    key = (cache_key, tuple(sorted(only)) if only is not None else None)
    hit = _discovery_cache.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_TTL:
        return hit[1]

    frames = _frames(smap)
    declared = set(smap.place_paths)
    candidates = [
        p for p in _place_candidates(list(smap.fields), frames)
        if p not in declared and (only is None or p in only)
    ]
    out: dict[str, tuple[int, int]] = {}
    for path in candidates:
        try:
            values = [v.value for v in aq.distinct_values(path, limit=_SAMPLE)]
        except Exception:  # noqa: BLE001 — one odd path must not sink the rest
            logger.warning("discover_spatial: sampling %r failed", path, exc_info=True)
            session.rollback()
            continue
        if not values:
            continue
        resolved = resolve_places(session, infospace_id, values,
                                  canon_ids=canon_ids, geo_canon_id=geo_canon_id)
        hits = sum(1 for p in resolved.values() if p.located or p.in_geo_canon)
        out[path] = (hits, len(resolved))

    _discovery_cache[key] = (time.monotonic(), out)
    return out


def spatial_from(stats: Mapping[str, tuple[int, int]]) -> frozenset[str]:
    """The paths whose sample is convincingly somewhere."""
    return frozenset(
        p for p, (hits, n) in stats.items()
        if (hits >= _MIN_HITS and hits / n >= _MIN_SHARE) or (0 < n <= 2 and hits == n)
    )


def undecided_places(plan: SchemaPlan) -> set[str]:
    """Candidate paths discovery still has to settle — those of every section
    (and the document) whose place was neither declared nor picked."""
    def silent(path: str) -> bool:
        # Discovery fills only where the contract said nothing. A field whose
        # `x-ref` names its vocabulary has been declared — and if that
        # vocabulary is "actors, places or interests", the contract has already
        # said it is only sometimes a place. A picker may still choose it.
        node = plan.smap.get(path)
        return node is not None and not node.ref_targets

    return {
        path for s in plan.all
        if s.place.source not in ("declared", "picked") and s.frame != "interest"
        for path in s.place_candidates
        if path != s.path and silent(path)   # a roster's own elements are declared
    }
