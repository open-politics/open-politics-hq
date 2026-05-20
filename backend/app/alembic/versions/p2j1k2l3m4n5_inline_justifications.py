"""Inline justifications: drop Justification table + lift schema configs into output_contract.

Two coordinated data movements:

1. Per-schema ``field_specific_justification_configs`` is lifted into the
   schema's ``output_contract`` directly. Each entry like::

       "summary": {"enabled": true, "custom_prompt": "...", "rigor_level": ...}

   becomes inline keys on that field's property::

       output_contract.properties.summary.include_justification = true
       output_contract.properties.summary.justification_prompt   = "..."

   The dict column itself is dropped after the lift.

2. Any surviving rows in ``justification`` are backfilled into their parent
   annotation's ``value`` JSONB so nothing is lost. By P1's go-live the writer
   was already silent, so this is defensive — typically zero rows. Then the
   table is dropped along with its FK relationship.

Idempotent: re-running over an already-lifted schema is a no-op because the
configs column is gone after the first run, and the value JSONB skip-clobbers
any key already present.

Revision ID: p2j1k2l3m4n5
Revises: a2v3w4x5y6z7
Create Date: 2026-04-29

"""
from __future__ import annotations

import json
import logging

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision = "p2j1k2l3m4n5"
down_revision = "a2v3w4x5y6z7"
branch_labels = None
depends_on = None


logger = logging.getLogger("alembic.inline_justifications")


def _find_property_anywhere(contract: dict, field_name: str) -> dict | None:
    """Find a property by name, recursing into nested ``properties`` blocks.

    HQ schemas use a hierarchical layout:
      output_contract.properties.document.properties.<field>
      output_contract.properties.per_image.items.properties.<field>
      output_contract.properties.per_audio.items.properties.<field>

    The legacy ``field_specific_justification_configs`` keys reference fields
    by their leaf name, not by their full path — so this walker drills through
    the nested wrappers (object.properties + array.items.properties) to find
    the matching leaf. Returns the property dict (mutable reference) or None.
    """
    if not isinstance(contract, dict):
        return None
    stack: list[dict] = [contract]
    while stack:
        node = stack.pop()
        props = node.get("properties") if isinstance(node, dict) else None
        if not isinstance(props, dict):
            continue
        if field_name in props and isinstance(props[field_name], dict):
            return props[field_name]
        # Recurse: object children have their own ``properties``; array items
        # may have ``items.properties`` for array<object>.
        for child in props.values():
            if not isinstance(child, dict):
                continue
            if isinstance(child.get("properties"), dict):
                stack.append(child)
            items = child.get("items")
            if isinstance(items, dict) and isinstance(items.get("properties"), dict):
                stack.append(items)
    return None


def _lift_configs_into_contract(contract: dict, configs: dict) -> dict:
    """Walk configs and write ``include_justification`` + ``justification_prompt``
    into the corresponding property anywhere in the schema (top-level, inside
    ``document``, inside per-modality wrappers, or inside array<object> items).

    Returns the modified contract (same dict, mutated). Properties that can't
    be located are skipped with a warning — the config entry is stale relative
    to the contract.
    """
    if not isinstance(contract, dict):
        return contract or {}
    if not isinstance(contract.get("properties"), dict):
        return contract
    for field_name, cfg in (configs or {}).items():
        if not isinstance(cfg, dict):
            continue
        enabled = cfg.get("enabled", False)
        if not enabled:
            continue
        prop = _find_property_anywhere(contract, field_name)
        if prop is None:
            logger.warning(
                "config references field '%s' not present in output_contract; skipping",
                field_name,
            )
            continue
        # Don't clobber if already inline (idempotency).
        if "include_justification" not in prop:
            prop["include_justification"] = True
        custom = cfg.get("custom_prompt")
        if custom and "justification_prompt" not in prop:
            prop["justification_prompt"] = custom
        rigor = cfg.get("rigor_level")
        if rigor is not None and "justification_rigor_level" not in prop:
            prop["justification_rigor_level"] = rigor
    return contract


def _backfill_justifications_into_annotations(conn) -> int:
    """Read every justification row and write its content into the parent
    annotation's value JSONB. Returns the number of rows lifted.

    Layout choice mirrors the inline shape used by the structured-output
    pipeline: ``{field}_justification`` for parent-level fields,
    ``_thinking_trace`` for the dedicated thinking key.
    """
    rows = conn.execute(text("""
        SELECT j.id,
               j.annotation_id,
               j.field_name,
               j.reasoning,
               j.evidence_payload,
               a.value
        FROM justification j
        JOIN annotation a ON a.id = j.annotation_id
    """)).fetchall()

    if not rows:
        return 0

    by_annotation: dict[int, dict] = {}
    for r in rows:
        ann_id = r.annotation_id
        if ann_id not in by_annotation:
            by_annotation[ann_id] = dict(r.value or {})
        value = by_annotation[ann_id]
        field_name = (r.field_name or "").strip()
        reasoning = r.reasoning
        if not field_name or not reasoning:
            continue
        target_key = (
            "_thinking_trace"
            if field_name == "_thinking_trace"
            else f"{field_name}_justification"
        )
        if target_key in value:
            # Already inline — don't overwrite.
            continue
        payload: dict = {"reasoning": reasoning}
        evidence = r.evidence_payload
        if isinstance(evidence, dict) and evidence:
            payload.update(evidence)
        value[target_key] = payload

    # Write back. One UPDATE per annotation; small enough for any realistic
    # remainder (we expect zero in practice).
    lifted = 0
    for ann_id, value in by_annotation.items():
        conn.execute(
            text("UPDATE annotation SET value = CAST(:v AS jsonb) WHERE id = :id"),
            {"v": json.dumps(value), "id": ann_id},
        )
        lifted += 1
    return lifted


def upgrade() -> None:
    bind = op.get_bind()

    # ── 1. Lift per-schema justification configs into output_contract ──────
    schemas = bind.execute(text("""
        SELECT id, output_contract, field_specific_justification_configs
        FROM annotationschema
        WHERE field_specific_justification_configs IS NOT NULL
          AND field_specific_justification_configs::text != '{}'
    """)).fetchall()

    lifted_schemas = 0
    for s in schemas:
        contract = s.output_contract or {}
        configs = s.field_specific_justification_configs or {}
        new_contract = _lift_configs_into_contract(dict(contract), configs)
        bind.execute(
            text("""
                UPDATE annotationschema
                SET output_contract = CAST(:c AS jsonb)
                WHERE id = :id
            """),
            {"c": json.dumps(new_contract), "id": s.id},
        )
        lifted_schemas += 1
    logger.info("Lifted justification configs inline on %d schemas.", lifted_schemas)

    # ── 2. Backfill any remaining Justification rows into annotation.value ──
    lifted_annotations = _backfill_justifications_into_annotations(bind)
    logger.info(
        "Backfilled %d annotations with leftover Justification rows.",
        lifted_annotations,
    )

    # ── 3. Drop the column ────────────────────────────────────────────────
    op.drop_column("annotationschema", "field_specific_justification_configs")

    # ── 4. Drop the index + table ─────────────────────────────────────────
    op.drop_index("ix_justification_annotation_field", table_name="justification")
    op.drop_table("justification")


def downgrade() -> None:
    """Best-effort restore. The column comes back as an empty dict on every
    schema (the lifted data stays inline — re-extracting is lossy because we'd
    need to round-trip the inline keys back into the legacy shape). The table
    is recreated empty. This is a one-way migration in practice.
    """
    op.create_table(
        "justification",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("annotation_id", sa.Integer(), nullable=False),
        sa.Column("field_name", sa.String(), nullable=True),
        sa.Column("reasoning", sa.Text(), nullable=True),
        sa.Column("evidence_payload", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["annotation_id"], ["annotation.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_justification_annotation_field",
        "justification",
        ["annotation_id", "field_name"],
    )
    op.add_column(
        "annotationschema",
        sa.Column(
            "field_specific_justification_configs",
            sa.JSON(),
            nullable=True,
            server_default="{}",
        ),
    )
