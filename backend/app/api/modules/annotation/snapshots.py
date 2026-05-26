"""Observation snapshots — immutable frozen outputs of formulas.

The intelligence layer's persistence story for *findings*: when a formula
strikes — when its output answers a question the journalist wants to keep —
the user snapshots it. The snapshot inlines the formula body, records the
output relation, and pins down the schema(s) it was computed against. From
then on, the snapshot is read-only: editing the source Formula does not
mutate prior Observations.

See ``docs/intelligence/HOW_TO.md`` § Observations and
``docs/plans/intelligence-primitive/03_observations_and_dossier.md`` for
the picture.

The persistence layer is JSON-in-DashboardConfig. v1 keeps it light; when
cross-run sharing or evidence pinning earns its keep, we promote to a real
``observation`` table. The trigger conditions live in the plan doc.
"""

from __future__ import annotations

import logging
import secrets
import string
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from app.api.modules.annotation.formula import Formula
from app.api.modules.annotation.query import OutputRow

logger = logging.getLogger(__name__)


# ─── ID generation ──────────────────────────────────────────────────────────


_NANOID_ALPHABET = string.ascii_letters + string.digits


def _nanoid(size: int = 16) -> str:
    """Lightweight nanoid for snapshot ids. Cryptographically random."""
    return "".join(secrets.choice(_NANOID_ALPHABET) for _ in range(size))


# ─── The Observation snapshot model ─────────────────────────────────────────


class Observation(BaseModel):
    """One snapshot of a formula's output relation.

    The formula body is *inlined* at snapshot time so the snapshot stays
    self-describing — editing the source Formula later does not mutate
    this Observation. Re-snapshotting after edits creates a new one.

    There is no per-row provenance: **the inlined formula + run is the
    provenance**. Re-running the same Formula over an unchanged run yields
    the same relation because the query is the same. (Evidence-mode rows
    carry their own ``annotation_id`` in ``output_blob`` intrinsically.)
    """

    id: str = Field(default_factory=_nanoid)
    formula_inline: Formula
    formula_name: str
    computed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    output_blob: list[OutputRow] = Field(default_factory=list)
    output_keys: list[str] = Field(default_factory=list)
    run_id: int
    schema_id_snapshot: int | None = None
    notes: str | None = None
    """Optional per-observation note — a journalist's quick sketch alongside
    the dossier-level ``notes_md``."""


# ─── Persistence helpers — read/write on AnnotationRun.views_config ─────────


def _dashboard_dict(run) -> dict[str, Any]:
    """Return the run's views_config as a dict, normalising legacy shapes.

    The frontend persists ``DashboardConfig`` (a dict) on
    ``AnnotationRun.views_config``, but some legacy runs may carry an empty
    list. This normalises so callers always work with a dict.
    """
    cfg = run.views_config
    if isinstance(cfg, dict):
        return cfg
    if isinstance(cfg, list):
        # Legacy shape — a bare list of panels. Wrap into a dict so the
        # snapshot routes can stash observations[] alongside.
        return {"panels": cfg}
    return {}


def list_observations(run) -> list[Observation]:
    """Read all snapshots saved on the run's dashboard."""
    cfg = _dashboard_dict(run)
    raw = cfg.get("observations") or []
    out: list[Observation] = []
    for item in raw:
        # Skip legacy saved-projections (renamed to Formula in M2) — those
        # have a `projection` field, not `formula_inline`. The frontend
        # migrator promotes them to `formulas[]`, but be defensive here.
        if not isinstance(item, dict):
            continue
        if "formula_inline" not in item:
            continue
        try:
            out.append(Observation.model_validate(item))
        except Exception as e:  # noqa: BLE001
            logger.warning("Skipping malformed Observation: %s", e)
    return out


def get_observation(run, obs_id: str) -> Observation | None:
    """Look up a single snapshot by id."""
    for obs in list_observations(run):
        if obs.id == obs_id:
            return obs
    return None


def append_observation(run, obs: Observation) -> None:
    """Append a snapshot to the run's dashboard config (in memory).

    Caller is responsible for committing the SQLAlchemy session. Mutates
    ``run.views_config`` in place using a fresh dict so SQLAlchemy detects
    the change on JSONB columns (which don't track in-place mutation by
    default).
    """
    cfg = dict(_dashboard_dict(run))  # shallow copy so SQLAlchemy sees a new dict
    existing = list(cfg.get("observations") or [])
    existing.append(obs.model_dump(mode="json"))
    cfg["observations"] = existing
    run.views_config = cfg


def remove_observation(run, obs_id: str) -> bool:
    """Drop a snapshot from the run's dashboard config. Returns True when
    one was removed, False when no observation with that id existed."""
    cfg = dict(_dashboard_dict(run))
    existing = list(cfg.get("observations") or [])
    new_list = [o for o in existing if not (isinstance(o, dict) and o.get("id") == obs_id)]
    if len(new_list) == len(existing):
        return False
    cfg["observations"] = new_list
    run.views_config = cfg
    return True


# ─── Snapshot computation ───────────────────────────────────────────────────


def snapshot_from_formula(
    *,
    run,
    relation,
    formula_name: str | None = None,
    formula: Formula | None = None,
    note: str | None = None,
    schema_id: int | None = None,
) -> Observation:
    """Freeze an :class:`OutputRelation` into an immutable Observation.

    The Formula body is inlined into the Observation so the snapshot is
    self-describing forever. No per-row provenance is stored — the inlined
    formula + run *is* the provenance (evidence rows carry their own
    annotation id in ``output_blob``).

    Provide either ``formula_name`` (looked up on the run's dashboard
    ``formulas[]``) or ``formula`` (used inline — for snapshots of ad-hoc
    inline-bound panels that aren't in the intelligence formula list).
    Exactly one must be set.

    Parameters
    ----------
    run: the AnnotationRun the snapshot attaches to.
    formula_name: saved Formula name (inlined; stub Formula if deleted).
    formula: explicit Formula body (used as-is, no lookup).
    relation: the ``OutputRelation`` from ``AnnotationQuery.relation``.
    note / schema_id: optional sketch / schema pin.
    """
    if (formula_name is None) == (formula is None):
        raise ValueError(
            "snapshot_from_formula requires exactly one of formula_name or formula"
        )

    if formula is not None:
        body = formula
        snap_name = formula.name
    else:
        from app.api.modules.annotation.formulas import resolve_formula
        cfg = _dashboard_dict(run)
        try:
            body = resolve_formula(formula_name, cfg)  # type: ignore[arg-type]
        except ValueError:
            body = Formula(id="_deleted", name=formula_name or "_deleted")
        snap_name = formula_name  # type: ignore[assignment]

    return Observation(
        formula_inline=body,
        formula_name=snap_name,
        output_blob=list(relation.rows),
        output_keys=list(relation.output_keys),
        run_id=run.id,
        schema_id_snapshot=schema_id,
        notes=note,
    )
