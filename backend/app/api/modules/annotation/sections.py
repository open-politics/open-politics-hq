"""What a section IS — declared, not inferred from its name.

The observation model gives a section three independent properties, and until
now all three were read off the literal string ``"observations"``:

.. code-block:: text

    about   →  graph STRUCTURE   node? edge? property?
    role    →  LAYOUT            what pulls, what is labelled, what recedes
    frame   →  POSITION          which of the four spaces this section CONSTITUTES

Name a section ``motives`` and it got none of them. Not an error — silence: no
``about``, no bindings, no frame, no layout role, and a graph that renders
something plausible and wrong. Which made the model's generality a lie, because
"any method, any data" stops at "as long as you spell it our way".

So the contract carries the statement (``x-graph`` on the section's array node)
and everyone else reads it. This module is the vocabulary plus the conventional
table for the names the model itself prescribes — which is now a *fallback for
contracts written before declarations existed*, not the mechanism.

It imports nothing from the package on purpose. ``templates`` stamps from it,
``schema_map`` parses against it, ``panel_config`` derives from it, and the MCP
companion generates its prose from it; a leaf module is what keeps that a star
rather than a cycle.

See ``docs/plans/observation-model/INVESTIGATION.md`` §7.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

__all__ = [
    "ROLES", "FRAMES", "DECL_KEYS", "SECTIONS", "DECL_EXTENSION",
    "sanitize_decl", "decl_for_name",
]

#: The JSON Schema extension key a section declares itself with.
DECL_EXTENSION = "x-graph"

#: What a section DOES in the layout. The method vocabulary — situational and
#: re-pointable, unlike the ontology vocabulary (actor · place · interest · …)
#: which the schema author fixes when they write the section.
#:
#: ``role = f(section)`` is a DEFAULT, not an identity. That is precisely what
#: makes a projection re-pointable: interests are a vector until you are tracing
#: goal-succession, at which point they are steps.
ROLES: tuple[str, ...] = (
    "vector",      # gives direction
    "step",        # a station on a vector
    "anchor",      # absolute position, from outside
    "body",        # moves along, gathers at steps
    "companion",   # rides a step — ZERO layout weight
    "edge",        # a connection, never a node
    "attachment",  # never positioned at all
)

#: Spaces that can give a node a POSITION. Mirrors ``panel_config.Frame`` and
#: the frontend's ``axes.ts``; ``test_sections.py`` asserts the three agree.
#:
#: **Closed at four, deliberately.** The count is not a preference — it is what
#: survives asking *does distance in this dimension mean anything*, and the
#: whole axis budget (3 axes, ``FRAME_COST``) is built on it. An unrecognised
#: value is dropped rather than propagated.
FRAMES: tuple[str, ...] = ("time", "geo", "interest", "event")

#: Keys a declaration may carry. Everything here is a ``Projection`` field
#: except ``role`` and ``frame``, which the projection gains — a declaration IS
#: a path-less projection, which is what lets the bindings live in one place
#: instead of being restated in ``panel_config``.
DECL_KEYS: frozenset[str] = frozenset({
    "about", "role", "frame", "label",
    "node_kind", "node_type", "node_type_path", "node_name", "node_label",
    "predicate", "time", "place", "activity", "weight", "evidence", "properties",
})

#: The conventional declaration per prescribed section name.
#:
#: Was two dicts in ``panel_config`` (``_SECTION_ABOUT`` and
#: ``_SECTION_BINDINGS``) plus a third copy in ``templates.build_projections``
#: and a fourth in prose in the MCP server. One of those had already drifted —
#: the MCP docstring still described v1's ``objects[]``/``participants`` long
#: after the rename, so every companion-authored schema was v1-shaped and
#: derived no graph bindings at all.
#:
#: This is now the definition. ``build_contract`` stamps it into the contract,
#: ``derive_projections`` reads it back, and the two are asserted equal.
SECTIONS: dict[str, dict[str, Any]] = {
    # ── Populations. Declared once; every name used anywhere refers to these.
    "actors": {"role": "body"},
    "instruments": {"role": "step"},
    "places": {"role": "anchor", "frame": "geo"},
    "interests": {"role": "vector", "frame": "interest"},

    # ── Referents. The occasion an act belongs to.
    "events": {
        "about": "self", "role": "step", "frame": "event",
        "node_type": "Event", "node_name": "name", "node_label": "name",
        "time": {"start": "when", "end": "until"},
        "place": {"at": "at.name"},
        "properties": [{"field": "kind"}],
        # The events section is emitted with `justify=True`, so its rows carry
        # a justification and it belongs on the evidence rail. `_SECTION_BINDINGS`
        # omitted this while `build_projections` had it — the two copies had
        # already drifted, and a derived panel silently dropped every event's
        # grounds. Exactly the failure one definition removes.
        "evidence": {"path": "justification"},
    },

    # ── Claims. What is asserted.
    "observations": {
        "about": "self", "role": "companion",
        "node_type": "Observation", "node_type_path": "kind", "node_name": "id",
        # Labelled by who was in it, not by what kind it was — `kind` is already
        # the node's *type*, so using it as the label too renders every act in
        # the section under one word. `when` disambiguates: a repeating method
        # produces many rows with identical participants, which is precisely
        # what Case 2 hunts for.
        "node_label": "{kind} · {by} → {to} · {when}",
        "weight": "magnitude",
        "time": {"start": "when", "end": "until"},
        "activity": {"start": "covers_from", "end": "covers_until"},
        "place": {"at": "at.name"},
        "properties": [{"field": "modality"}],
        "evidence": {"path": "justification"},
    },
    "attributes": {
        # NEVER inferable from shape — `{who, place, from, to}` is structurally
        # identical to an encounter. The declaration is the only thing that can
        # say a row is a property of its subject rather than an act.
        "about": "subject", "role": "companion",
        "place": {"at": "place.name", "kind": "kind"},
        "time": {"start": "from", "end": "until"},
        "weight": "magnitude",
        "properties": [{"field": "kind"}, {"field": "value"}],
        "evidence": {"path": "justification"},
    },
    "relations": {
        "about": "between", "role": "edge",
        "predicate": "predicate",
        "time": {"start": "from_date", "end": "until"},
        "evidence": {"path": "justification"},
    },

    # ── Grounds. On whose word.
    "evidence": {
        "about": "self", "role": "attachment",
        "node_kind": "entity", "node_type": "Evidence",
        "node_name": "name", "node_label": "quote",
        "properties": [{"field": "stance"}, {"field": "kind"},
                       {"field": "locator"}],
    },

    # ── v1 vocabulary, still in the wild. Kept so an old contract derives what
    #    it always did; nothing emits this name any more.
    "statements": {
        "about": "self", "role": "companion",
        "node_type": "Statement", "node_name": "id", "node_label": "claim",
        "time": {"at": "said_on"},
        "place": {"at": "at.name"},
        "activity": {"start": "refers_to_start", "end": "refers_to_end"},
        "properties": [{"field": "modality"}],
        "evidence": {"path": "justification"},
    },
}


def sanitize_decl(raw: Any) -> dict[str, Any] | None:
    """One ``x-graph`` value, narrowed to what the model can actually mean.

    Anything outside :data:`DECL_KEYS` is dropped, as is a ``role`` or ``frame``
    outside its closed set. Dropped with a warning rather than raised on: a
    contract is user data, and one bad key in one section must not make a whole
    schema unopenable. The binding sub-shapes are NOT validated here —
    ``Projection(**spec)`` already does that, and doing it twice is how two
    validators come to disagree.
    """
    if not isinstance(raw, dict):
        if raw is not None:
            logger.warning("x-graph: expected an object, got %r", type(raw).__name__)
        return None

    out: dict[str, Any] = {}
    for key, value in raw.items():
        if key not in DECL_KEYS:
            logger.warning("x-graph: unknown key %r, ignored", key)
            continue
        if value is None:
            continue          # an explicit null means "unset", not "the value None"
        if key == "role" and value not in ROLES:
            logger.warning("x-graph: unknown role %r, ignored", value)
            continue
        if key == "frame" and value not in FRAMES:
            logger.warning("x-graph: unknown frame %r, ignored", value)
            continue
        out[key] = value
    return out or None


def decl_for_name(section: str) -> dict[str, Any] | None:
    """The conventional declaration for a prescribed section name.

    The second rung of the ladder in ``derive_projections``: a contract that
    declares nothing still derives exactly what it always did, because these
    values are the ones the old name tables held. Returns a copy — callers put
    it straight into a ``Projection`` and Pydantic will happily keep a
    reference to a nested dict otherwise.
    """
    decl = SECTIONS.get((section or "").strip().lower())
    if decl is None:
        return None
    import copy
    return copy.deepcopy(decl)
