"""Contract resolution — the contract a *run* actually executes.

A stored ``output_contract`` says what to extract. A run may additionally bind
an entity field to a **canon**, so the model is told which types the vocabulary
admits and which properties to fill. That binding cannot live in the stored
contract: the same schema runs against different canons, and the canon's
contents change between runs.

So the run resolves its contract once, up front:

.. code-block:: text

    stored contract ─┐
    SchemaMap ───────┼─▶ resolve_contract() ─▶ effective contract
    canon bindings ──┘                              │
                                                    ├─▶ split_schema_for_extraction
                                                    ├─▶ create_pydantic_model_from_json_schema
                                                    └─▶ _format_prop_line (the prompt)

**Why this seam.** All three downstream consumers read *from the contract*.
Rewriting it once upstream gets the Pydantic constraint **and** the prompt
rendering for free — no per-consumer injection code, nothing to keep in sync.
Same technique as ``routes/annotation_schemas.py:_lift_configs_into_contract``,
one level up.

**Two injections**, per :class:`CanonBinding.inject` / ``inject_properties``:

==================== ======================================================
``types``            the canon's type list onto the entity's ``type``
                     property as ``enum`` + ``x-entityTypeList``. Cheap
                     (tens of tokens), and it removes the
                     ``Person``/``person``/``Politician`` fragmentation at
                     the source — the type *is* the resolution key, so its
                     casing decides identity.
``inject_properties`` a nested ``properties`` object built from
                     ``Canon.type_schemas[type]``, so the model fills the
                     slots the canon declares for that type (birthdate,
                     current_job, …).
==================== ======================================================

**Entity *names* are deliberately never injected.** Earlier drafts of this
module offered ``names_guided`` (the known names as prompt guidance) and
``names_strict`` (as a Pydantic ``Literal``). Both were removed: a name list
large enough to be useful is large enough to distort the prompt, and neither
mode found a use case that canon resolution doesn't serve better *after*
extraction. Identity is a **resolution** problem, not a prompting one —
`graph/resolution.py` (alias match → embedding similarity → ``CanonProposal``)
is where it belongs, and constraining the model would only hide the mentions
that most need reviewing. Types constrain, names resolve.
"""

from __future__ import annotations

import copy
import logging
from typing import TYPE_CHECKING, Any, Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.api.modules.annotation.schema_map import (
    ENTITY_SHAPES,
    CanonTie,
    FieldNode,
    SchemaMap,
)

if TYPE_CHECKING:
    from sqlmodel import Session

logger = logging.getLogger(__name__)

__all__ = [
    "CanonBinding",
    "FieldInjection",
    "ResolutionReport",
    "InjectMode",
    "effective_bindings",
    "locate_node",
    "resolve_contract",
]


InjectMode = Literal["none", "types"]

#: A type list this long says the canon is uncurated rather than that the field
#: really admits that many kinds — worth a look before every prompt carries it.
TYPES_COST_WARN = 50

#: Rough chars-per-token. Only used for the estimate the preview shows.
_CHARS_PER_TOKEN = 4


# ─── Binding ────────────────────────────────────────────────────────────────


class CanonBinding(BaseModel):
    """The effective canon binding for one field path.

    Produced by :func:`effective_bindings` from the schema's ``x-canon``
    default merged with the run's per-path override. Carries no defaults of its
    own beyond "inject nothing" — an unbound field must cost nothing.
    """

    model_config = ConfigDict(frozen=True)

    canon_id: int | None = None
    type: str | None = None
    """The canon entry type this field fills. Durable and canon-blind."""
    types: tuple[str, ...] = ()
    """Subset of the canon's types to draw from. Empty = every type."""
    inject: InjectMode = "none"
    inject_properties: bool = False

    @property
    def active(self) -> bool:
        return self.inject != "none" or self.inject_properties


class FieldInjection(BaseModel):
    """What was actually injected at one path."""

    model_config = ConfigDict(frozen=True)

    path: str
    canon_id: int
    inject: InjectMode
    types: tuple[str, ...] = ()
    properties: tuple[str, ...] = ()
    est_tokens: int = 0


class ResolutionReport(BaseModel):
    """Per-run summary of everything injected.

    Surfaced by ``POST /runs/preview-bindings``, which resolves without starting
    a run — so the launch dialog and the companion can both see exactly what a
    binding will do to the prompt, and which bindings landed nowhere.
    """

    fields: tuple[FieldInjection, ...] = ()
    warnings: tuple[str, ...] = Field(default_factory=tuple)

    @property
    def injected_types(self) -> int:
        return sum(len(f.types) for f in self.fields)

    @property
    def est_tokens_per_asset(self) -> int:
        """Added prompt tokens per asset. The injection sits in the cached
        prefix, so this is the *cache-write* cost once per asset — not a
        per-turn multiplier."""
        return sum(f.est_tokens for f in self.fields)

    @property
    def active(self) -> bool:
        return bool(self.fields)


# ─── Binding resolution ─────────────────────────────────────────────────────


def effective_bindings(
    smap: SchemaMap,
    run_bindings: dict[str, Any] | None = None,
    *,
    run_canon_ids: Iterable[int] = (),
    default_canon_id: int | None = None,
) -> dict[str, CanonBinding]:
    """Merge schema ``x-canon`` defaults with the run's per-path overrides.

    The run wins **per key**, not wholesale — a schema declaring
    ``inject: "types"`` and a run overriding only ``inject_properties`` keeps
    the type injection.

    Canon precedence, highest first: the run's override, the run's declared
    frame (``run.canon_ids[0]``), the schema's authoring-time preference,
    the infospace default. This mirrors
    ``graph/tasks/curation.py:_resolve_target_canon`` minus its ``graph_id``
    branch — at annotation time no graph is in play yet, so the run's declared
    frame is the truth. Constraining types against a canon that curation will
    not resolve into would be worse than not constraining at all.

    Only entity-shaped paths are considered; a binding on anything else is
    ignored (there is no ``{name, type}`` to constrain).
    """
    overrides = run_bindings if isinstance(run_bindings, dict) else {}
    primary_run_canon = next(iter(run_canon_ids), None)

    out: dict[str, CanonBinding] = {}
    for node in smap.fields:
        if node.shape not in ENTITY_SHAPES:
            continue
        tie: CanonTie = node.canon or CanonTie()
        ov = overrides.get(node.path)
        ov = ov if isinstance(ov, dict) else {}

        inject = ov.get("inject", tie.inject)
        if inject not in ("none", "types"):
            logger.warning(
                "canon binding for %s has unknown inject=%r; treating as none",
                node.path, inject,
            )
            inject = "none"

        raw_types = ov.get("types", tie.types) or ()
        binding = CanonBinding(
            canon_id=(
                ov.get("canon_id")
                or primary_run_canon
                or tie.canon_id
                or default_canon_id
            ),
            type=ov.get("type", tie.type) or node.entity_type,
            types=tuple(t for t in raw_types if isinstance(t, str) and t.strip()),
            inject=inject,
            inject_properties=bool(ov.get("inject_properties", tie.inject_properties)),
        )
        if binding.active:
            out[node.path] = binding

    # Run overrides that landed nowhere. A run's bindings outlive schema edits
    # and are hand- or LLM-written, so "path doesn't exist" and "path isn't an
    # entity field" are live mistakes. Emitting the binding anyway lets
    # ``resolve_contract`` report it instead of the request vanishing — silence
    # here reads as "injection is configured" while nothing happens.
    #
    # Schema-side ``x-canon`` on a non-entity field stays silent by contrast:
    # the editor doesn't offer it, so it isn't a mistake a user can make.
    for path, ov in overrides.items():
        if path in out or not isinstance(ov, dict):
            continue
        requested = ov.get("inject", "none") != "none" or bool(ov.get("inject_properties"))
        if not requested:
            continue
        out[path] = CanonBinding(
            canon_id=ov.get("canon_id") or primary_run_canon or default_canon_id,
            type=ov.get("type"),
            types=tuple(
                t for t in (ov.get("types") or ())
                if isinstance(t, str) and t.strip()
            ),
            inject=ov.get("inject", "none") if ov.get("inject") in (
                "none", "types",
            ) else "none",
            inject_properties=bool(ov.get("inject_properties")),
        )
    return out


# ─── Contract navigation ────────────────────────────────────────────────────


def locate_node(contract: dict, path: str) -> dict | None:
    """The JSON Schema property node at a :class:`SchemaMap` path.

    Walks the same structure ``schema_map._walk_node`` produced the path from,
    so the two cannot disagree: a segment carrying ``[*]`` means the next
    segment lives under ``items.properties``, otherwise under ``properties``.

    Returns the *property* node. For an ``array_entity`` the entity extensions
    live one level deeper, on ``node["items"]`` — callers use
    :func:`entity_carrier` rather than reaching in themselves.
    """
    if not isinstance(contract, dict) or not path:
        return None
    node: Any = contract
    parts = [p for p in path.split(".") if p]
    for i, part in enumerate(parts):
        exploded = part.endswith("[*]")
        key = part[:-3] if exploded else part
        props = node.get("properties")
        if not isinstance(props, dict) or key not in props:
            return None
        node = props[key]
        if not isinstance(node, dict):
            return None
        if i < len(parts) - 1 and exploded:
            items = node.get("items")
            if not isinstance(items, dict):
                return None
            node = items
    return node


def entity_carrier(node: dict, shape: str) -> dict | None:
    """The dict carrying an entity's ``x-entity*`` extensions.

    A scalar ``entity`` carries them itself; an ``array_entity`` carries them
    on its ``items``. Same asymmetry ``schema_map._entity_meta`` reads.
    """
    if shape == "entity":
        return node
    items = node.get("items")
    return items if isinstance(items, dict) else None


# ─── Canon reads ────────────────────────────────────────────────────────────


def _canon_types(session: "Session", canon_id: int) -> list[str]:
    """Every type the canon knows — declared in ``type_schemas`` or observed on
    an entry. A canon may declare a type shape before any entry exists, and
    constraining to it is exactly the point on a fresh canon.
    """
    from sqlalchemy import text

    from app.api.modules.graph.models import Canon

    observed = [
        r[0] for r in session.execute(
            text("SELECT DISTINCT type FROM canon_entry WHERE canon_id = :cid"),
            {"cid": canon_id},
        ).fetchall()
        if r[0]
    ]
    canon = session.get(Canon, canon_id)
    declared = list((canon.type_schemas or {}).keys()) if canon else []

    seen: dict[str, str] = {}
    for t in declared + observed:
        if isinstance(t, str) and t.strip():
            seen.setdefault(t.strip().lower(), t.strip())
    return sorted(seen.values(), key=str.lower)



_CANON_PROP_TO_JSON: dict[str, dict[str, Any]] = {
    "text": {"type": "string"},
    "number": {"type": "number"},
    "integer": {"type": "integer"},
    "boolean": {"type": "boolean"},
    "date": {"type": "string", "format": "date"},
    "url": {"type": "string", "format": "uri"},
    "list": {"type": "array", "items": {"type": "string"}},
}


def _canon_property_schema(
    session: "Session", canon_id: int, types: Iterable[str],
) -> tuple[dict[str, Any], list[str]]:
    """Build a JSON Schema ``properties`` map from ``Canon.type_schemas``.

    Union across the binding's types — a field accepting Politician *or* Party
    asks for the union of both shapes, since one row is only ever one type and
    the unused slots simply stay unfilled. First declaration of a name wins on
    collision, and required-ness is dropped: a property the canon marks
    required for its own editor should not fail extraction when the document
    doesn't mention it.
    """
    from app.api.modules.graph.models import Canon

    canon = session.get(Canon, canon_id)
    schemas = (canon.type_schemas or {}) if canon else {}
    if not schemas:
        return {}, []

    wanted = [t.strip().lower() for t in types if isinstance(t, str) and t.strip()]
    props: dict[str, Any] = {}
    for tname, defs in schemas.items():
        if wanted and str(tname).strip().lower() not in wanted:
            continue
        for d in defs or []:
            if not isinstance(d, dict):
                continue
            name = str(d.get("name") or "").strip()
            if not name or name in props:
                continue
            leaf = dict(_CANON_PROP_TO_JSON.get(
                str(d.get("type") or "text").strip().lower(),
                _CANON_PROP_TO_JSON["text"],
            ))
            desc = d.get("description")
            if isinstance(desc, str) and desc.strip():
                leaf["description"] = desc.strip()
            props[name] = leaf
    return props, sorted(props)


# ─── The rewrite ────────────────────────────────────────────────────────────


def _est_tokens(values: Iterable[str]) -> int:
    joined = ", ".join(values)
    return (len(joined) + _CHARS_PER_TOKEN - 1) // _CHARS_PER_TOKEN if joined else 0


def resolve_contract(
    output_contract: dict,
    smap: SchemaMap,
    bindings: dict[str, CanonBinding],
    *,
    session: "Session",
) -> tuple[dict, ResolutionReport]:
    """Rewrite *output_contract* with the canon vocabulary each binding asks for.

    Returns ``(effective_contract, report)``. The input is never mutated. With
    no active bindings the contract is returned unchanged (same object) and the
    report is empty — an unbound run pays nothing.
    """
    active = {p: b for p, b in bindings.items() if b.active and b.canon_id}
    if not active:
        return output_contract, ResolutionReport()

    contract = copy.deepcopy(output_contract)
    injections: list[FieldInjection] = []
    warnings: list[str] = []

    for path, binding in active.items():
        node_meta: FieldNode | None = smap.get(path)
        if node_meta is None:
            # A run binding outlives schema edits: rename or delete the field
            # and the stored binding still points at the old path. Silence here
            # would look like "injection is on" while nothing happened.
            warnings.append(
                f"{path}: no such field in the contract; binding ignored "
                f"(was the schema edited after this run was configured?)"
            )
            continue
        node = locate_node(contract, path)
        if node is None:
            warnings.append(f"{path}: no such field in the contract; binding ignored")
            continue
        carrier = entity_carrier(node, node_meta.shape)
        if carrier is None:
            warnings.append(f"{path}: not an entity field; binding ignored")
            continue

        written_types: tuple[str, ...] = ()
        written_props: tuple[str, ...] = ()

        # ── types ───────────────────────────────────────────────────────────
        # Also the scope ``inject_properties`` reads its shapes from: a property
        # bag is only meaningful for the types it was declared on.
        type_scope = list(binding.types) or _canon_types(session, binding.canon_id)
        if binding.inject == "types" and type_scope:
            type_prop = (carrier.setdefault("properties", {})).setdefault(
                "type", {"type": "string"},
            )
            type_prop["x-entityTypeList"] = list(type_scope)
            type_prop["enum"] = list(type_scope)
            carrier["x-entityTypeConstrained"] = True
            if len(type_scope) == 1:
                carrier["x-entityType"] = type_scope[0]
            written_types = tuple(type_scope)

            if len(type_scope) > TYPES_COST_WARN:
                warnings.append(
                    f"{path}: {len(type_scope)} types ride every prompt for this "
                    f"run. That usually means the canon is uncurated rather than "
                    f"that the field admits that many kinds — consider a type "
                    f"subset."
                )

        # ── properties ──────────────────────────────────────────────────────
        if binding.inject_properties:
            prop_schema, prop_names = _canon_property_schema(
                session, binding.canon_id, type_scope,
            )
            if prop_schema:
                carrier.setdefault("properties", {})["properties"] = {
                    "type": "object",
                    "description": (
                        "Properties this entity's canon declares for its type. "
                        "Fill what the document supports; leave the rest out."
                    ),
                    "properties": prop_schema,
                }
                written_props = tuple(prop_names)
            else:
                warnings.append(
                    f"{path}: inject_properties is on but the canon declares no "
                    f"property shape for {', '.join(type_scope) or 'any type'}."
                )

        if written_types or written_props:
            injections.append(FieldInjection(
                path=path,
                canon_id=binding.canon_id,
                inject=binding.inject,
                types=written_types,
                properties=written_props,
                est_tokens=_est_tokens(written_types) + _est_tokens(written_props),
            ))

    report = ResolutionReport(fields=tuple(injections), warnings=tuple(warnings))
    if report.active:
        logger.info(
            "resolve_contract: %d field(s) bound — %d types, ~%d tokens/asset",
            len(report.fields), report.injected_types, report.est_tokens_per_asset,
        )
    for w in warnings:
        logger.warning("resolve_contract: %s", w)
    return contract, report


def resolve_for_run(
    session: "Session",
    output_contract: dict,
    smap: SchemaMap,
    *,
    run_bindings: dict[str, Any] | None = None,
    run_canon_ids: Iterable[int] = (),
    default_canon_id: int | None = None,
) -> tuple[dict, ResolutionReport]:
    """:func:`effective_bindings` + :func:`resolve_contract` in one call.

    The single entry point the annotate task and the preflight route share, so
    neither reimplements the binding merge.
    """
    bindings = effective_bindings(
        smap, run_bindings,
        run_canon_ids=run_canon_ids,
        default_canon_id=default_canon_id,
    )
    return resolve_contract(output_contract, smap, bindings, session=session)


def resolve_for_annotation_run(
    session: "Session",
    run: Any,
    output_contract: dict,
) -> tuple[dict, ResolutionReport]:
    """Resolve a contract for a specific :class:`AnnotationRun`.

    Reads the binding inputs off the run and its infospace so callers don't
    assemble them by hand: overrides from ``run.configuration['canon_bindings']``,
    the declared frame from ``run.canon_ids``, and the fallback from
    ``Infospace.default_canon_id``.

    The :class:`SchemaMap` is built from the contract being resolved (not the
    stored one) so map paths and :func:`locate_node`'s walk cannot diverge if an
    upstream step reshaped the contract.

    Never raises on a bad binding: a malformed or stale binding lands as a
    warning on the report and the contract passes through. Extraction failing
    because a canon binding was mistyped would be the wrong trade.
    """
    from app.models import Infospace

    from app.api.modules.annotation.schema_map import (
        SchemaRefCycleError,
        schema_map_for,
    )

    try:
        smap = schema_map_for(output_contract)
    except SchemaRefCycleError as e:
        logger.warning(
            "resolve_for_annotation_run: cyclic x-ref (%s) — skipping canon injection", e,
        )
        return output_contract, ResolutionReport()

    cfg = run.configuration if isinstance(getattr(run, "configuration", None), dict) else {}
    infospace = session.get(Infospace, run.infospace_id)

    try:
        return resolve_for_run(
            session, output_contract, smap,
            run_bindings=cfg.get("canon_bindings"),
            run_canon_ids=list(getattr(run, "canon_ids", None) or []),
            default_canon_id=getattr(infospace, "default_canon_id", None),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "resolve_for_annotation_run: canon injection failed for run %s: %s",
            getattr(run, "id", "?"), e, exc_info=True,
        )
        return output_contract, ResolutionReport(
            warnings=(f"canon injection failed: {e}",),
        )
