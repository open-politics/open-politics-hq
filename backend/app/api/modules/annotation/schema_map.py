"""SchemaMap — what an ``output_contract`` *means*, and how to read values against it.

An ``AnnotationSchema.output_contract`` is a JSON Schema decorated with HQ
extensions (``x-entityField``, ``x-ref``, ``x-canon``, ``x-fromSource``…). Six
places used to re-derive "what shape is this field" from that raw dict —
``curation.py``, ``annotate.py``, ``stream.py``, and three frontend modules —
and they had already drifted. This module is the single answer.

Two things come out of a walk:

1. **Shape per path.** Which paths are entities, which are triplet arrays,
   which look like time or place. Consumers stop pattern-matching raw JSON
   Schema.
2. **Vocabularies.** ``x-ref`` declares that one field reuses another's
   definition. The adapter *expands* the target at save time, so the stored
   contract holds two independent copies and only ``x-ref`` records that they
   are the same vocabulary. Resolving those refs into equivalence classes is
   what lets curation, the graph projection, and back-propagation know that
   ``document.observations[*].statement_by`` and ``document.entities[*]`` name
   the same population.

**Path grammar.** Array nodes carry ``[*]`` — ``document.observations[*]`` is
the array, ``document.observations[*].claim`` a leaf inside its items. This
matches what the frontend RolePicker emits and what
``core.filters.parse_explosion_chain`` consumes. Note that a path may carry
more than one ``[*]``; ``core.filters._PATH_RE`` (single explosion) applies to
*filter conditions*, not to this map.

**Entity internals are not walked.** ``{name, type, additional_types}`` is a
closed system shape, not user schema — emitting it would triple the map for no
consumer. The contract is: given an entity path, the name leaf is
``<path>.name``. A canon-injected ``properties`` bag (see
``contract_resolution``) *is* user-meaningful and IS walked.

This is a pure function of the contract it is handed — so the map of a
*resolved* contract legitimately differs from the map of the stored one.

**Reading values.** A map path is only useful with something that reads an
annotation value at it, so the reader lives here too: :func:`iter_values`
walks a concrete ``annotation.value`` along a map path, and
:func:`iter_entity_refs` narrows that to ``(name, type)`` pairs. Both return
the *concrete* path with array indices substituted
(``document.observations[2].statement_by``) — that string is what
``FragmentCuration.fragment_path`` records, so curation gets per-mention
idempotency for free.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.api.modules.annotation.sections import DECL_EXTENSION, sanitize_decl

__all__ = [
    "FieldShape",
    "OBJECT_NAME_KEYS",
    "OBJECT_TYPE_KEYS",
    "PREDICATE_KEYS",
    "SUBJECT_NAME_KEYS",
    "SUBJECT_TYPE_KEYS",
    "CanonTie",
    "FieldNode",
    "SchemaMap",
    "SchemaRefCycleError",
    "ValueHit",
    "build_schema_map",
    "iter_entity_refs",
    "iter_values",
    "schema_map_for",
    "strip_explosions",
]


# ─── Shapes ─────────────────────────────────────────────────────────────────
#
# Mirrors the frontend ``FieldShape`` union in ``lib/annotations/fieldPaths.ts``
# so the served map needs no translation at the boundary.

FieldShape = Literal[
    "string",
    "number",
    "boolean",
    "date",
    "enum_string",
    "array_string",
    "array_string_enum",
    "array_number",
    "object",
    "array_object",
    "triplet",
    "entity",
    "array_entity",
    "unknown",
]

#: Shapes that carry an entity reference (``{name, type, …}``) as their value.
ENTITY_SHAPES: frozenset[str] = frozenset({"entity", "array_entity"})


class SchemaRefCycleError(ValueError):
    """An ``x-ref`` chain loops back on itself.

    Mirrors the frontend ``SchemaRefCycleError`` (``lib/annotations/adapters.ts``)
    so both sides fail the same way on the same contract. ``cycle_path`` lists
    the field paths forming the loop, in traversal order.
    """

    def __init__(self, cycle_path: list[str]) -> None:
        super().__init__(f"Reference cycle detected: {' → '.join(cycle_path)}")
        self.cycle_path = cycle_path


# ─── Triplet vocabulary ─────────────────────────────────────────────────────
#
# Schemas in the wild name a triplet's endpoints half a dozen ways. These are
# THE alias sets — used for detection here, for role inference in
# ``panel_config.resolve_projections``, and for the read-side COALESCE in
# ``graph/stream.py``. Keeping one copy is the point: they lived in two places
# with *different* contents, so a schema using ``from``/``to`` read correctly at
# stream time but wasn't recognised as a triplet at detection time.
#
# Order matters — more specific first, so a row carrying both ``subject`` and
# ``subject_name`` resolves to the richer key.

SUBJECT_NAME_KEYS = ("subject_name", "subject", "source_name", "source", "head", "from")
OBJECT_NAME_KEYS = ("object_name", "object", "target_name", "target", "tail", "to")
SUBJECT_TYPE_KEYS = ("subject_type", "source_type", "head_type", "from_type")
OBJECT_TYPE_KEYS = ("object_type", "target_type", "tail_type", "to_type")
PREDICATE_KEYS = ("predicate", "relation", "relationship", "type", "label")

# Detection is narrower than reading on purpose. ``type`` and ``label`` are
# ordinary field names — admitting them as predicate evidence would classify
# any ``[{source, target, type}]`` array as a graph field. Reading stays
# permissive; classifying does not.
_DETECT_PREDICATE_KEYS = ("predicate", "relation", "relationship")


def _is_triplet_item(item_def: Any) -> bool:
    """Does an array's ``items`` schema describe a subject→predicate→object row?

    Property name of the *array* is irrelevant — multi-graph-field schemas key
    by user-facing name, legacy schemas key under ``"triplets"``. Shape decides.
    """
    if not isinstance(item_def, dict):
        return False
    props = item_def.get("properties")
    if not isinstance(props, dict):
        return False
    keys = set(props)
    return (
        any(k in keys for k in SUBJECT_NAME_KEYS)
        and any(k in keys for k in OBJECT_NAME_KEYS)
        and any(k in keys for k in _DETECT_PREDICATE_KEYS)
    )


def _is_entity_node(node: Any) -> bool:
    """An entity-typed node carries the ``x-entityField`` extension.

    Set by ``adapters.ts:buildEntityObjectSchema`` for both scalar ``entity``
    fields and ``array_entity`` items. Runtime value is always the object
    ``{name, type, additional_types}``.
    """
    return isinstance(node, dict) and node.get("x-entityField") is True


def infer_shape(node: Any) -> FieldShape:
    """Coarse runtime shape of one JSON Schema node.

    Order matters: the HQ extensions (entity, triplet) win over the declared
    ``type``, because both are structurally ``object`` / ``array`` and would
    otherwise collapse into the generic branches.
    """
    if not isinstance(node, dict):
        return "unknown"

    if _is_entity_node(node):
        return "entity"

    declared = node.get("type")

    if declared == "array":
        items = node.get("items")
        if _is_triplet_item(items):
            return "triplet"
        if _is_entity_node(items):
            return "array_entity"
        if not isinstance(items, dict):
            return "array_string"
        item_type = items.get("type")
        if item_type == "object":
            return "array_object"
        if item_type in ("number", "integer"):
            return "array_number"
        if item_type == "string" and isinstance(items.get("enum"), list):
            return "array_string_enum"
        return "array_string"

    if declared == "string":
        if isinstance(node.get("enum"), list) and node["enum"]:
            return "enum_string"
        if node.get("format") in ("date", "date-time"):
            return "date"
        return "string"
    if declared in ("integer", "number"):
        return "number"
    if declared == "boolean":
        return "boolean"
    if declared == "object":
        return "object"
    return "unknown"


# ─── Time / place candidates ────────────────────────────────────────────────
#
# Schema-side mirrors of the frontend's ``fieldDetection.ts`` heuristics. That
# module needs a sample value (it inspects the extracted string); here we only
# have the declaration, so we key on the name pattern plus the declared format.
# These are *candidates* offered to a role picker, never an automatic binding.

_TIME_NAME_RE = re.compile(
    r"(timestamp|datetime|date|_at$|^at$|time|when|start|end|since|until|period)",
    re.IGNORECASE,
)
_PLACE_NAME_RE = re.compile(
    r"(location|place|city|country|region|geo|coordinates?|address|venue|where)",
    re.IGNORECASE,
)
#: Entity types that mark an entity field as a place anchor regardless of name.
_PLACE_ENTITY_TYPES = frozenset({"location", "place", "city", "country", "region", "geo"})


def _leaf_name(path: str) -> str:
    """Last path segment, explosion marker stripped (``a.b[*].c`` → ``c``)."""
    return path.rsplit(".", 1)[-1].removesuffix("[*]")


def _is_time_candidate(node: FieldNode) -> bool:
    if node.shape == "date":
        return True
    if node.shape not in ("string", "number", "enum_string"):
        return False
    return bool(_TIME_NAME_RE.search(_leaf_name(node.path)))


def _is_place_candidate(node: FieldNode) -> bool:
    if node.shape in ENTITY_SHAPES:
        declared = (node.entity_type or "").strip().lower()
        if declared in _PLACE_ENTITY_TYPES:
            return True
        return bool(_PLACE_NAME_RE.search(_leaf_name(node.path)))
    if node.shape not in ("string", "enum_string", "array_string", "array_string_enum"):
        return False
    return bool(_PLACE_NAME_RE.search(_leaf_name(node.path)))


# ─── Nodes ──────────────────────────────────────────────────────────────────


class CanonTie(BaseModel):
    """A field's declared canon binding, parsed from ``x-canon``.

    ``type`` is the durable, canon-blind half: a run can point the schema at
    any canon and the tie still means the same thing. ``canon_id`` is a soft
    authoring-time preference — the run's own canon wins at resolution (see
    ``graph/tasks/curation.py:_resolve_target_canon``).

    ``types`` / ``inject`` / ``inject_properties`` are the injection controls
    consumed by ``contract_resolution``. Parsed here so the map is the one
    place that reads ``x-canon``; a contract that predates them simply gets
    the defaults.
    """

    model_config = ConfigDict(frozen=True)

    type: str | None = None
    canon_id: int | None = None
    types: tuple[str, ...] = ()
    """Subset of the canon's types this field draws from. Empty = all."""
    inject: Literal["none", "types"] = "none"
    inject_properties: bool = False


class FieldNode(BaseModel):
    """One addressable field in a contract."""

    model_config = ConfigDict(frozen=True)

    path: str
    shape: FieldShape
    section: str
    """Section this field lives under — ``document``, ``per_image``, …"""
    container: str | None = None
    """Nearest enclosing array path (with ``[*]``), or None at section root.
    This is the LATERAL a projection explodes to reach this leaf."""
    label: str | None = None
    description: str | None = None
    entity_type: str | None = None
    """``x-entityType`` — the primary type, and the canon resolution key."""
    alternate_types: tuple[str, ...] = ()
    enum: tuple[str, ...] = ()
    """Declared value vocabulary. ``x-entityEnum`` for entities, ``enum``
    otherwise. Present whether or not it is enforced on the wire."""
    type_constrained: bool = True
    """``x-entityTypeConstrained`` — is the type list enforced as a Literal?"""
    ref_targets: tuple[str, ...] = ()
    """``x-ref`` targets, verbatim (section-relative, no explosion markers).

    **A list, because one role can draw from several populations.** A payment's
    ``via`` is an intermediary bank *or* a routing account; a claim's
    ``concerns`` can be an actor, a place or an instrument. Declaring a single
    target forced those fields to lie about where their vocabulary comes from,
    or to declare nothing at all.

    Merging never depended on this — node identity is ``name + type``, so a
    multi-typed field already collapses onto whichever roster supplied the
    name. What ``x-ref`` adds is the *declaration*: it tells ``SchemaMap`` two
    paths name one population, which is what propagates a closed enum and what
    lets a picker offer the right names.
    """
    canon: CanonTie | None = None
    justification: bool = False
    """``include_justification`` — this field emits an inline justification."""
    from_source: str | None = None
    to_source: str | None = None
    """Triplet fields only: ``x-fromSource`` / ``x-toSource`` anchors."""
    graph_role: str | None = None
    """``x-graph.role`` — what this section does in the LAYOUT.

    Mirrored onto the field so a picker can say *"this section is a STEP"*
    without re-deriving it. The full declaration lives on
    :attr:`SchemaMap.section_decls`; only the two labels are lifted here,
    because a nested dict on a frozen per-field model would land on
    ``AnnotationSchemaRead.schema_map`` and in the generated TS types for no
    consumer."""
    graph_frame: str | None = None
    """``x-graph.frame`` — which of time · geo · interest · event this section
    CONSTITUTES. Not "can be positioned in": ``places`` constitutes geo,
    ``interests`` constitutes interest, and an observation constitutes none of
    them while being positioned by all four."""

    @property
    def ref_target(self) -> str | None:
        """The first ``x-ref`` target. Kept for callers written before a field
        could draw from more than one roster; read ``ref_targets`` instead."""
        return self.ref_targets[0] if self.ref_targets else None

    @property
    def is_entity(self) -> bool:
        return self.shape in ENTITY_SHAPES

    @property
    def array_path(self) -> str | None:
        """This node's own array path (no ``[*]``) when it is an array."""
        return self.path[:-3] if self.path.endswith("[*]") else None


# ─── The map ────────────────────────────────────────────────────────────────


class SchemaMap(BaseModel):
    """Resolved meaning of one ``output_contract``.

    A Pydantic model rather than a dataclass so the *same* object is both the
    internal structure and the wire shape — it serializes onto
    ``AnnotationSchemaRead`` and generates the frontend's TS types directly,
    with no parallel DTO to drift from. Construction cost is paid once per
    distinct contract thanks to :func:`schema_map_for`'s cache.
    """

    model_config = ConfigDict(frozen=True)

    fields: tuple[FieldNode, ...] = ()
    vocabularies: dict[str, tuple[str, ...]] = Field(default_factory=dict)
    """Vocabulary equivalence classes: anchor path → every path that resolves
    through it (the anchor itself is NOT included). An anchor is a field no
    ``x-ref`` chain leads out of."""
    entity_paths: tuple[str, ...] = ()
    triplet_paths: tuple[str, ...] = ()
    time_paths: tuple[str, ...] = ()
    place_paths: tuple[str, ...] = ()
    section_decls: dict[str, dict[str, Any]] = Field(default_factory=dict)
    """Section array path (with ``[*]``) → its sanitized ``x-graph``.

    **What a section IS, said by the schema rather than guessed from its name.**
    Path-keyed because every consumer is path-scoped: ``derive_projections``
    builds one projection per path, ``resolve_frames`` asks which paths
    constitute a frame, and ``meta.layers`` reports per path.

    Only top-level arrays appear here — a declaration on a nested row is not a
    section declaration, and is ignored rather than honoured somewhere
    surprising. Empty for every contract written before declarations existed,
    which is exactly why ``derive_projections`` keeps a name-table rung."""

    # --- lookup ---

    def get(self, path: str) -> FieldNode | None:
        """Exact lookup, then explosion-insensitive — so a caller may pass
        ``document.events.when`` when the map holds ``document.events[*].when``.
        """
        for node in self.fields:
            if node.path == path:
                return node
        target = strip_explosions(path)
        for node in self.fields:
            if strip_explosions(node.path) == target:
                return node
        return None

    def anchor_for(self, path: str) -> str:
        """The vocabulary anchor a path resolves through — itself when it is
        one, or when it participates in no ref chain.

        This is what back-propagation writes into and what the graph projection
        uses to decide that two paths name the same population.
        """
        node = self.get(path)
        canonical = node.path if node else path
        for anchor, members in self.vocabularies.items():
            if canonical == anchor or canonical in members:
                return anchor
        return canonical

    def in_container(self, container: str) -> tuple[FieldNode, ...]:
        """Every field whose nearest enclosing array is *container*."""
        target = strip_explosions(container)
        return tuple(
            n for n in self.fields
            if n.container and strip_explosions(n.container) == target
        )

    def entity_fields(self) -> tuple[FieldNode, ...]:
        return tuple(n for n in self.fields if n.is_entity)


def strip_explosions(path: str) -> str:
    """``a.b[*].c`` → ``a.b.c``. Used wherever two path spellings must compare
    equal — ``x-ref`` targets are written without markers, map paths carry them.
    """
    return path.replace("[*]", "")


# ─── Walk ───────────────────────────────────────────────────────────────────


def _parse_canon(node: dict) -> CanonTie | None:
    """Parse ``x-canon`` off a field node.

    Two emission sites exist in the wild: ``adapters.ts`` writes ``x-canon``
    onto the *property* node in its generic branch (so an ``array_entity``
    carries it on the array), while ``buildEntityObjectSchema`` — used for
    scalar ``entity`` fields — currently emits none at all. Checking the node
    then its ``items`` covers both without caring which branch produced the
    contract.
    """
    raw = node.get("x-canon")
    if not isinstance(raw, dict):
        items = node.get("items")
        raw = items.get("x-canon") if isinstance(items, dict) else None
    if not isinstance(raw, dict):
        return None
    inject = raw.get("inject")
    if inject not in ("none", "types"):
        inject = "none"
    types = raw.get("types")
    return CanonTie(
        type=raw.get("type") or None,
        canon_id=raw.get("canon_id") if isinstance(raw.get("canon_id"), int) else None,
        types=tuple(t for t in types if isinstance(t, str)) if isinstance(types, list) else (),
        inject=inject,
        inject_properties=bool(raw.get("inject_properties")),
    )


def _ext_source(node: dict, shape: FieldShape) -> dict:
    """The node carrying HQ's ``x-`` extensions for this field.

    A scalar ``entity`` carries them itself; an ``array_entity`` carries them on
    ``items`` — both are built by ``adapters.ts:buildEntityObjectSchema``, so the
    two hold identical extensions at different depths. Every reader of an
    extension on an entity node has to make this hop, and each used to make it
    inline. ``x-ref`` was the one that didn't, which silently dropped the
    declared vocabulary of every multi-valued role (``by``, ``with``, ``to``,
    ``via``) — the most common entity shape there is.

    Non-entity nodes carry their extensions directly, so they pass through.
    """
    if shape not in ENTITY_SHAPES:
        return node
    source = node if shape == "entity" else node.get("items")
    return source if isinstance(source, dict) else {}


def _parse_enum(node: dict, shape: FieldShape) -> tuple[str, ...]:
    """Declared vocabulary, whichever key carries it for this shape.

    Entities keep their names in ``x-entityEnum`` and mirror them into ``enum``
    only when constrained — so reading ``x-entityEnum`` first reports the
    vocabulary regardless of enforcement.
    """
    if shape in ENTITY_SHAPES:
        source = _ext_source(node, shape)
        raw = source.get("x-entityEnum")
        if isinstance(raw, list):
            return tuple(str(v) for v in raw)
        name_prop = (source.get("properties") or {}).get("name") or {}
        raw = name_prop.get("x-entityEnum") or name_prop.get("enum")
        return tuple(str(v) for v in raw) if isinstance(raw, list) else ()
    raw = node.get("enum")
    if isinstance(raw, list):
        return tuple(str(v) for v in raw)
    items = node.get("items")
    if isinstance(items, dict) and isinstance(items.get("enum"), list):
        return tuple(str(v) for v in items["enum"])
    return ()


def _entity_meta(node: dict, shape: FieldShape) -> tuple[str | None, tuple[str, ...], bool]:
    """``(entity_type, alternate_types, type_constrained)`` for an entity node.

    Reads from wherever this shape carries its extensions — see
    :func:`_ext_source`.
    """
    source = _ext_source(node, shape)
    primary = source.get("x-entityType")
    if not primary:
        type_prop = (source.get("properties") or {}).get("type") or {}
        primary = type_prop.get("x-entityTypeDeclared")
    alternates = source.get("x-entityAlternateTypes")
    return (
        str(primary) if primary else None,
        tuple(str(t) for t in alternates) if isinstance(alternates, list) else (),
        source.get("x-entityTypeConstrained") is not False,
    )


def _walk_node(
    key: str,
    node: Any,
    parent_path: str,
    section: str,
    container: str | None,
    out: list[FieldNode],
    decls: dict[str, dict[str, Any]] | None = None,
) -> None:
    """Emit *node* and recurse. Mirrors ``fieldPaths.ts:walkNode``'s path rules:
    an array node's own path carries ``[*]``, and its item properties hang off
    that exploded path.

    ``decls`` accumulates :data:`sections.DECL_EXTENSION` declarations found on
    **section** nodes — top-level arrays. A declaration anywhere else parses to
    the two mirrored labels and nothing more, because a row inside a section is
    not a section and honouring it would make ``x-graph`` mean two things.
    """
    # Local import: ``task_utils`` reaches ``app.schemas``, which reaches back
    # here for ``AnnotationSchemaRead.schema_map``. One reader, no cycle.
    from app.core.task_utils import justification_flag

    if not isinstance(node, dict):
        return

    shape = infer_shape(node)
    dot_path = f"{parent_path}.{key}" if parent_path else key
    is_array = node.get("type") == "array"
    path = f"{dot_path}[*]" if is_array else dot_path

    entity_type, alternates, constrained = (
        _entity_meta(node, shape) if shape in ENTITY_SHAPES else (None, (), True)
    )

    decl = sanitize_decl(node.get(DECL_EXTENSION))
    if decl and decls is not None and is_array and container is None:
        decls[path] = decl

    out.append(FieldNode(
        path=path,
        shape=shape,
        section=section,
        container=container,
        label=node.get("title") if isinstance(node.get("title"), str) else None,
        description=node.get("description") if isinstance(node.get("description"), str) else None,
        entity_type=entity_type,
        alternate_types=alternates,
        enum=_parse_enum(node, shape),
        type_constrained=constrained,
        # ``or node`` is the fallback for a hand-authored contract that put the
        # ref on the array rather than on its items; the adapter and the
        # templates both write it on the items.
        ref_targets=_parse_refs(_ext_source(node, shape).get("x-ref") or node.get("x-ref")),
        canon=_parse_canon(node),
        # Same both-ways reading, and for the same reason — but `_ext_source`
        # only hops to `items` for ENTITY shapes, and a claim section is an
        # `array_object`. This read the array node ALONE, so every claim section
        # reported `justification: False` to every consumer of the map while its
        # contract said True. `justification_flag` is the one reader the two
        # extraction paths share; imported here rather than at module scope
        # because `task_utils` reaches `app.schemas`, which reaches back here.
        justification=justification_flag(node)[0],
        from_source=node.get("x-fromSource") if isinstance(node.get("x-fromSource"), str) else None,
        to_source=node.get("x-toSource") if isinstance(node.get("x-toSource"), str) else None,
        graph_role=(decl or {}).get("role"),
        graph_frame=(decl or {}).get("frame"),
    ))

    # Entity internals ({name, type, additional_types}) are a closed system
    # shape — not walked. A canon-injected ``properties`` bag is user-declared
    # and is.
    if shape in ENTITY_SHAPES:
        source = node if shape == "entity" else (node.get("items") or {})
        bag = (source.get("properties") or {}).get("properties")
        if isinstance(bag, dict) and isinstance(bag.get("properties"), dict):
            for ck, cdef in bag["properties"].items():
                _walk_node(ck, cdef, f"{path}.properties", section, container, out, decls)
        return

    if node.get("type") == "object" and isinstance(node.get("properties"), dict):
        for ck, cdef in node["properties"].items():
            _walk_node(ck, cdef, dot_path, section, container, out, decls)
        return

    if is_array:
        items = node.get("items")
        if isinstance(items, dict) and isinstance(items.get("properties"), dict):
            # Items of an array<object> (including triplet rows) hang off the
            # exploded path, and that path becomes their container.
            for ck, cdef in items["properties"].items():
                _walk_node(ck, cdef, path, section, path, out, decls)


def _parse_refs(raw: Any) -> tuple[str, ...]:
    """``x-ref`` as one target or several. Order preserved, blanks dropped."""
    if isinstance(raw, str):
        return (raw,) if raw.strip() else ()
    if isinstance(raw, list):
        return tuple(r for r in raw if isinstance(r, str) and r.strip())
    return ()


def _resolve_vocabularies(nodes: list[FieldNode]) -> dict[str, tuple[str, ...]]:
    """Fold ``x-ref`` references into ``anchor → members``.

    ``x-ref`` targets are section-relative and written without explosion
    markers (``mails.sender`` targets ``document.mails[*].sender``), matching
    ``adapters.ts:findFieldByPath`` which descends ``items.properties``
    transparently. So resolution compares on ``(section, stripped path)``.

    **References form a DAG, not a chain.** A field may draw from several
    rosters at once — a ``via`` that is an intermediary *or* a routing account
    — so a node can reach more than one anchor and is registered under each.
    Following a single link was what forced every role to pick one population
    and misdescribe itself.

    Traversal is depth-first to the terminal anchors, with a visited set. A
    loop raises :class:`SchemaRefCycleError`, same as the editor does on save.
    A ref whose target does not exist is skipped — the contract is already
    stored, and failing the whole map over one dangling pointer would take down
    every consumer for a field nobody can reach anyway.
    """
    by_key: dict[tuple[str, str], FieldNode] = {
        (n.section, strip_explosions(n.path)): n for n in nodes
    }

    def targets_of(node: FieldNode) -> list[FieldNode]:
        out: list[FieldNode] = []
        for raw in node.ref_targets:
            stripped = strip_explosions(raw)
            # Targets are section-relative; accept a fully-qualified form too.
            hit = (
                by_key.get((node.section, f"{node.section}.{stripped}"))
                or by_key.get((node.section, stripped))
            )
            if hit is not None:
                out.append(hit)
        return out

    def anchors_of(node: FieldNode) -> list[str]:
        """Every terminal this node's references reach."""
        found: list[str] = []
        seen: set[str] = {node.path}

        def walk(cursor: FieldNode, trail: list[str]) -> None:
            nxt = targets_of(cursor)
            if not nxt:
                # A terminal. The node itself is not its own anchor.
                if cursor.path != node.path and cursor.path not in found:
                    found.append(cursor.path)
                return
            for t in nxt:
                if t.path in trail:
                    raise SchemaRefCycleError([*trail, t.path])
                seen.add(t.path)
                walk(t, [*trail, t.path])

        walk(node, [node.path])
        return found

    members: dict[str, list[str]] = {}
    for node in nodes:
        if not node.ref_targets:
            continue
        for anchor in anchors_of(node):
            members.setdefault(anchor, []).append(node.path)

    return {anchor: tuple(paths) for anchor, paths in members.items()}


def build_schema_map(output_contract: Any) -> SchemaMap:
    """Walk an ``output_contract`` into a :class:`SchemaMap`.

    Handles both HQ's hierarchical shape (fields under ``document`` /
    ``per_*``) and the flat shape some older and MCP-authored schemas use —
    the same two layouts ``core.task_utils.split_schema_for_extraction`` and
    ``annotate.detect_schema_structure`` already accommodate.

    Raises :class:`SchemaRefCycleError` if the contract's ``x-ref`` chains loop.
    """
    if not isinstance(output_contract, dict):
        return SchemaMap()
    props = output_contract.get("properties")
    if not isinstance(props, dict):
        return SchemaMap()

    nodes: list[FieldNode] = []
    decls: dict[str, dict[str, Any]] = {}
    for key, node in props.items():
        if not isinstance(node, dict):
            continue
        is_section = (
            (node.get("type") == "object" and isinstance(node.get("properties"), dict))
            or (
                node.get("type") == "array"
                and isinstance(node.get("items"), dict)
                and isinstance(node["items"].get("properties"), dict)
                and key.startswith("per_")
            )
        ) and (key == "document" or key.startswith("per_"))

        if is_section:
            # The section wrapper itself is not an addressable field; its
            # children root at the section name.
            if node.get("type") == "array":
                base, container = f"{key}[*]", f"{key}[*]"
                child_props = node["items"]["properties"]
            else:
                base, container = key, None
                child_props = node["properties"]
            for ck, cdef in child_props.items():
                _walk_node(ck, cdef, base, key, container, nodes, decls)
        else:
            # Flat contract — fields sit directly at the root.
            _walk_node(key, node, "", "document", None, nodes, decls)

    vocabularies = _resolve_vocabularies(nodes)

    return SchemaMap(
        fields=tuple(nodes),
        vocabularies=vocabularies,
        section_decls=decls,
        entity_paths=tuple(n.path for n in nodes if n.is_entity),
        triplet_paths=tuple(n.path for n in nodes if n.shape == "triplet"),
        time_paths=tuple(n.path for n in nodes if _is_time_candidate(n)),
        place_paths=tuple(n.path for n in nodes if _is_place_candidate(n)),
    )


# ─── Reading values at map paths ─────────────────────────────────────────────


class ValueHit(BaseModel):
    """One concrete value found at a map path.

    ``path`` has array markers replaced by real indices, so it addresses this
    exact occurrence — ``document.observations[2].statement_by``. That is the
    string ``FragmentCuration.fragment_path`` stores.
    """

    model_config = ConfigDict(frozen=True)

    path: str
    value: Any


def _walk_value(
    node: Any, parts: list[str], i: int, prefix: str, out: list[ValueHit],
) -> None:
    if i == len(parts):
        out.append(ValueHit(path=prefix, value=node))
        return
    part = parts[i]
    explode = part.endswith("[*]")
    key = part[:-3] if explode else part
    if not isinstance(node, dict) or key not in node:
        return
    child = node[key]
    child_prefix = f"{prefix}.{key}" if prefix else key
    if not explode:
        _walk_value(child, parts, i + 1, child_prefix, out)
        return
    # Lenient on cardinality: a field declared as an array that came back as a
    # single object still yields its one value. The model does this routinely,
    # and there is no ambiguity in recovering it — the SQL side reaches the
    # same outcome via ``safe_array_elements`` returning empty for scalars,
    # except there the data is simply lost.
    items = child if isinstance(child, list) else ([child] if child is not None else [])
    for idx, item in enumerate(items):
        _walk_value(item, parts, i + 1, f"{child_prefix}[{idx}]", out)


def iter_values(value: Any, path: str) -> list[ValueHit]:
    """Every concrete value in *value* at map *path*.

    Honours the same three storage conventions as
    ``core.filters.jsonb_value_accessor``, because the annotation task and the
    model between them produce all three for the same declared field:

    1. **nested** — ``{"document": {"entities": [...]}}``
    2. **document-unwrapped** — ``{"entities": [...]}``; the task stores
       ``result["document"]`` at the value root (``annotate.py``)
    3. **flat dotted key** — ``{"document.entities": [...]}``

    First convention that yields anything wins — the walker's analogue of
    COALESCE. Returns ``[]`` for a path that resolves nowhere.
    """
    if not isinstance(value, dict) or not path:
        return []
    parts = [p for p in path.split(".") if p]
    if not parts:
        return []

    out: list[ValueHit] = []

    # (1) nested
    _walk_value(value, parts, 0, "", out)
    if out:
        return out

    # (2) document-unwrapped
    if parts[0] == "document" and len(parts) > 1:
        _walk_value(value, parts[1:], 0, "document", out)
        if out:
            return out

    # (3) flat dotted key — longest matching literal prefix at the root.
    stripped = [p.removesuffix("[*]") for p in parts]
    for k in range(len(parts), 0, -1):
        flat_key = ".".join(stripped[:k])
        if flat_key not in value:
            continue
        node = value[flat_key]
        prefix = flat_key
        # The last consumed segment may itself have carried an explosion.
        if parts[k - 1].endswith("[*]"):
            items = node if isinstance(node, list) else ([node] if node is not None else [])
            for idx, item in enumerate(items):
                _walk_value(item, parts, k, f"{prefix}[{idx}]", out)
        else:
            _walk_value(node, parts, k, prefix, out)
        if out:
            return out

    return out


def iter_entity_refs(value: Any, path: str) -> list[tuple[str, str, str]]:
    """``(name, type, concrete_path)`` for every entity reference at *path*.

    An entity value is the object ``{name, type, additional_types}``. Bare
    strings are accepted too — the model emits ``["Merkel"]`` instead of
    ``[{"name": "Merkel"}]`` often enough that dropping those would lose real
    mentions, and a string is unambiguously the name.

    Blank names are skipped; a missing type yields ``""``, which callers
    coerce against the field's declared type (the anchor's vocabulary wins).
    """
    out: list[tuple[str, str, str]] = []
    for hit in iter_values(value, path):
        node = hit.value
        if isinstance(node, str):
            name = node.strip()
            if name:
                out.append((name, "", hit.path))
            continue
        if isinstance(node, dict):
            name = node.get("name")
            if isinstance(name, str) and name.strip():
                etype = node.get("type")
                out.append((
                    name.strip(),
                    etype.strip() if isinstance(etype, str) else "",
                    hit.path,
                ))
            continue
        # A list here means the declared shape had one fewer explosion than the
        # data carries (e.g. `entities` declared scalar, emitted as a list).
        if isinstance(node, list):
            for idx, item in enumerate(node):
                for n, t, _ in iter_entity_refs({"_": item}, "_"):
                    out.append((n, t, f"{hit.path}[{idx}]"))
    return out


@lru_cache(maxsize=512)
def _cached_map(contract_json: str) -> SchemaMap:
    return build_schema_map(json.loads(contract_json))


def schema_map_for(output_contract: Any) -> SchemaMap:
    """Cached :func:`build_schema_map`, keyed on the contract's content.

    The map is a pure function of the contract, so content *is* the cache key —
    no invalidation to get wrong when a schema is edited in place. Hot callers
    (curation walks one map per annotation, the annotate task one per asset)
    pay the walk once per distinct contract per worker.

    Falls back to an uncached build if the contract isn't JSON-serializable,
    so a caller can never be broken by the cache layer.

    **Not ``sort_keys``.** The key used to be a sorted dump, and the cached map
    was then built by parsing that sorted dump back — so every consumer saw the
    contract's sections in ALPHABETICAL order rather than the order they were
    authored in. Two contracts differing only in key order are genuinely two
    different maps (field order differs), so order-insensitive caching was
    answering a question nobody asked, at the cost of silently reordering every
    projection. The extra cache entry for a re-ordered contract is the honest
    trade.
    """
    try:
        return _cached_map(json.dumps(output_contract, sort_keys=True, default=str))
    except (TypeError, ValueError):
        return build_schema_map(output_contract)
