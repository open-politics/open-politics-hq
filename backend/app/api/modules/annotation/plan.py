"""What a run needs to read an asset — made once, read by every asset.

.. code-block:: text

    language_for(session, run)                  the model the run reads with
    prepare(session, run, schema, language)  →  SchemaPlan
        the contract at the run's revision · validate the shape · simplify for
        the endpoint · resolve the run's canon bindings · the output models ·
        the prompt · the Phase A/B split

A run reads every asset through these. So does everything else that reads on a
run's behalf — retrying one annotation or all of them, and (next) a trial and a
fill — so what they write is extracted the way its siblings were.

They used to be built three times, in the run loop, the batch retry and the
single retry, and the copies had drifted: the single retry skipped canon
resolution and the two-phase split, asked the model for the media-mapping key
under a name nothing reads, and resolved its model without the run's model
name — or with no provider at all when the run named none. The batch retry
skipped the endpoint simplification and the shape checks. Each copy was right
about something the others were not.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from pydantic import BaseModel
from sqlmodel import Session

from app.api.modules.annotation.contract_resolution import resolve_for_annotation_run
from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema
from app.api.modules.annotation.revisions import contract_at, revision_for
from app.core.task_utils import create_pydantic_model_from_json_schema, split_schema_for_extraction

logger = logging.getLogger(__name__)

#: Asked of every schema with per-media sections, so demultiplexing can put each
#: item back on the media it describes. The key is what ``demultiplex_results``
#: and the Pydantic builder read.
MEDIA_MAPPING = (
    "--- System Data Mapping Instructions ---\n"
    "For each item you generate that corresponds to a specific media input (e.g., an item "
    "in a 'per_image' list, 'per_audio' list, etc.), you MUST include a field named "
    "'system_asset_source_uuid'. Its value MUST be the exact UUID string that was provided "
    "to you in the input prompt for that specific media item. This is critical for "
    "correctly associating your analysis with the source media."
)


class SchemaUnusable(ValueError):
    """A schema that cannot be run as it stands. The message says why, naming
    the schema, so a run can report it and carry on with the others."""


@dataclass(frozen=True)
class SchemaPlan:
    """One schema, ready to read assets for one run."""

    schema: AnnotationSchema
    #: The schema revision read through; what every annotation it makes records.
    rev: int
    #: The contract the run executes: that revision's, simplified for the
    #: endpoint, canon-resolved.
    contract: dict[str, Any]
    #: Which sections apply to which media (``detect_schema_structure``).
    structure: dict[str, Any]
    output_model: type[BaseModel]
    instructions: str
    #: ``array<object>`` fields Phase B extracts; empty means single-shot only.
    list_fields: list[dict[str, Any]] = field(default_factory=list)
    phase_a_model: Optional[type[BaseModel]] = None
    #: Bindings the run's canon could not apply — the contract ran without them.
    warnings: tuple[str, ...] = ()


def language_for(session: Session, run: AnnotationRun):
    """The language model *run* reads with.

    Only what the run pins is passed on — an endpoint, a model, its own key for
    that endpoint (BYOK). Everything it leaves out comes from the saved
    selection for annotation (infospace, then owner) and then the deployment,
    which is where it usually lives. Read the model back off the result
    (``.model``, ``.provider_key``), never off the run's configuration: for a
    run that pins nothing, that is the only place the chosen model is said.
    """
    from app.api.modules.foundation_service_providers import resolve

    cfg = run.configuration or {}
    # Under every key runs have been saved with.
    provider_key = cfg.get("provider") or cfg.get("ai_provider")
    model = cfg.get("model") or cfg.get("ai_model") or cfg.get("model_name")
    keys = cfg.get("api_keys") or {}
    return resolve(
        "language", provider_key, model,
        infospace_id=run.infospace_id,
        context="annotation",
        runtime_key=keys.get(provider_key) if provider_key else None,
        session=session,
    )


def prepare(
    session: Session,
    run: AnnotationRun,
    schema: AnnotationSchema,
    language: Any,
    *,
    instructions: Optional[str] = None,
) -> SchemaPlan:
    """Make *schema* ready to read assets for *run* with *language* (from
    ``language_for``). ``instructions`` stands in for the schema's own (a
    retry's added guidance) and is completed the same way. Raises
    :class:`SchemaUnusable`."""
    def unusable(why: str) -> SchemaUnusable:
        return SchemaUnusable(f"Schema {schema.id} ({schema.name}) {why}")

    rev = revision_for(session, run, schema)
    contract, own_instructions = contract_at(session, schema, rev)
    if not validate_hierarchical_schema(contract):
        raise unusable("mixes per-media sections with other top-level keys")

    contract = simplify_schema_for_model(contract, language.model, language.provider_key)
    if contract.get("type") != "object" or "properties" not in contract:
        raise unusable("is not an object schema with properties")

    # Every consumer below reads from the contract — the output models, the
    # Phase A/B split, the prompt renderer — so one canon rewrite here
    # constrains all three. A run with no canon binding gets it back unchanged.
    contract, canon = resolve_for_annotation_run(session, run, contract)
    if canon.active:
        logger.info(
            "Schema %s canon injection — %s types, ~%s tokens/asset",
            schema.id, canon.injected_types, canon.est_tokens_per_asset,
        )

    structure = detect_schema_structure(contract)
    if not structure.get("document_fields"):
        raise unusable("has no document fields")

    # Per-field justifications are opted into on the contract; the run-level
    # switch can suppress all of them.
    justifications = (run.configuration or {}).get("justifications_enabled", True)
    name = schema.name.replace(" ", "_")
    try:
        output_model = create_pydantic_model_from_json_schema(
            model_name=f"DynamicOutput_{name}_{schema.id}",
            json_schema=contract,
            justifications_enabled=justifications,
        )
    except Exception as e:
        raise unusable(f"could not be built into an output model: {e}") from e
    if not output_model.model_fields:
        raise unusable("has no fields")

    # Only what the researcher wrote, and the mapping the media sections need.
    # No hidden prompt injection.
    text = (own_instructions or "") if instructions is None else instructions
    if structure.get("per_modality_fields"):
        text = f"{text}\n\n{MEDIA_MAPPING}" if text else MEDIA_MAPPING

    # Two-phase extraction: Phase A reads the bounded fields, Phase B the
    # array<object> ones whose length only the document decides. Without
    # list fields, or a Phase A model, the engine reads single-shot.
    scalars, list_fields = split_schema_for_extraction(contract)
    phase_a_model = None
    if list_fields:
        try:
            phase_a_model = create_pydantic_model_from_json_schema(
                model_name=f"PhaseA_{name}_{schema.id}",
                json_schema=scalars,
                justifications_enabled=justifications,
            )
        except Exception as e:
            logger.warning("Schema %s: no Phase A model, so single-shot only: %s", schema.id, e)
            list_fields = []

    return SchemaPlan(
        schema=schema,
        rev=rev,
        contract=contract,
        structure=structure,
        output_model=output_model,
        instructions=text,
        list_fields=list_fields,
        phase_a_model=phase_a_model,
        warnings=tuple(f"Schema {schema.id} canon binding: {w}" for w in canon.warnings),
    )


# ─── The contract's shape ────────────────────────────────────────────────────


def validate_hierarchical_schema(output_contract: dict) -> bool:
    """A contract either has no per-media sections (it is all document) or has
    only ``document`` and ``per_*`` at the top — never both kinds mixed."""
    sections = {k for k in output_contract if k == "document" or k.startswith("per_")}
    if not sections:
        return True
    others = set(output_contract) - sections
    if others:
        logger.warning("Schema mixes per-media sections with other top-level keys: %s", others)
        return False
    return True


def simplify_schema_for_model(schema: dict, model_name: Optional[str], provider_key: Optional[str] = None) -> dict:
    """Shorten long descriptions for small self-hosted models (Ollama), keeping
    every field. Any other endpoint gets the schema back unchanged."""
    if provider_key not in ("ollama",):
        return schema

    def truncate(part: dict, limit: int = 200) -> dict:
        if not isinstance(part, dict):
            return part
        out = part.copy()
        if isinstance(out.get("description"), str) and len(out["description"]) > limit:
            out["description"] = out["description"][:limit] + "..."
        if isinstance(out.get("properties"), dict):
            out["properties"] = {k: truncate(v, limit) for k, v in out["properties"].items()}
        if "items" in out:
            out["items"] = truncate(out["items"], limit)
        return out

    simplified = truncate(schema)
    if simplified != schema:
        logger.info("Truncated long descriptions in schema for Ollama model %s (all fields preserved)", model_name)
    return simplified


def detect_schema_structure(output_contract: dict) -> dict:
    """Which sections apply to which media: ``document_fields`` (the document's
    schema) and ``per_modality_fields`` (``{modality: item schema}``). A contract
    with no sections is all document."""
    structure: dict[str, Any] = {"document_fields": {}, "per_modality_fields": {}}

    top = output_contract
    if output_contract.get("type") == "object" and "properties" in output_contract:
        top = output_contract["properties"]

    for key, value in top.items():
        if key == "document":
            structure["document_fields"] = value
        elif key.startswith("per_"):
            if isinstance(value, dict) and value.get("type") == "array" and "items" in value:
                structure["per_modality_fields"][key[4:]] = value["items"]
            else:
                logger.warning("Per-media section '%s' is not an array schema with items; skipped.", key)

    if not structure["document_fields"] and not structure["per_modality_fields"]:
        if output_contract.get("type") == "object" and "properties" in output_contract:
            structure["document_fields"] = output_contract
    return structure
