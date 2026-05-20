"""Formula composition — resolve ``@formula_name[k1, k2].col`` references.

The intelligence layer's ``derive`` and ``source_formula`` verbs let one
formula read another's output relation. This module owns the resolver:

- ``resolve_formula(name, dashboard_config)`` — look up a saved Formula
  by name on a run's ``DashboardConfig.formulas[]`` array.
- ``DashboardFormulaLookup`` — implements ``app.core.expr.FormulaLookup``
  by running each referenced formula on demand and indexing its output
  blob by ``output_keys``.

A small per-instance cache prevents re-running a source formula multiple
times within a single composed evaluation (rate-of-rates, lean-of-lean).
Cross-request persistence is intentionally not implemented — composition
runs synchronously inside one ``AnnotationQuery.projection()`` call.

See ``docs/intelligence/HOW_TO.md`` § Composition for the user-facing
picture and ``docs/plans/intelligence-primitive/02_formula_grammar.md``
for the implementation plan.
"""

from __future__ import annotations

import logging
from typing import Any

from app.api.modules.annotation.formula import Formula
from app.core.expr import FormulaLookup

logger = logging.getLogger(__name__)


def resolve_formula(name: str, dashboard_config: dict | None) -> Formula:
    """Look up a saved Formula by name on the dashboard config's
    ``formulas[]`` array and return the typed :class:`Formula`.

    The dashboard config shape mirrors what the frontend persists:

    .. code-block:: jsonc

        {
          "panels": [...],
          "formulas": [
            {"id": "...", "name": "firm_active_quarters", "group": [...], ...},
            ...
          ],
          ...
        }

    Raises
    ------
    ValueError
        When no formula with that name exists in the dashboard.
    """
    formulas = (dashboard_config or {}).get("formulas") or []
    if not isinstance(formulas, list):
        raise ValueError(
            f"DashboardConfig.formulas must be a list; got {type(formulas).__name__}"
        )
    for f in formulas:
        if not isinstance(f, dict):
            continue
        if f.get("name") == name:
            return Formula.model_validate(f)
    raise ValueError(f"Formula {name!r} not found in dashboard")


class DashboardFormulaLookup(FormulaLookup):
    """A FormulaLookup that resolves against a run's DashboardConfig.

    Construct once per ``AnnotationQuery.projection()`` call. The lookup
    runs each source formula on demand and indexes its output blob by the
    declared ``output_keys``; subsequent lookups for the same formula hit
    a per-instance cache.

    The ``run_formula`` callable is supplied by the caller — typically a
    closure over the parent ``AnnotationQuery`` that clones the query,
    swaps the projection, and materialises. We don't import
    ``AnnotationQuery`` here to avoid a circular dependency.
    """

    def __init__(
        self,
        dashboard_config: dict | None,
        run_formula,  # Callable[[Formula], list[dict]]
    ) -> None:
        self.dashboard_config = dashboard_config
        self.run_formula = run_formula
        # Cache: formula_name → {key_tuple: row_dict}.
        self._cache: dict[str, dict[tuple[Any, ...], dict[str, Any]]] = {}
        # Cycle guard: formulas currently being materialised on this lookup.
        self._active: set[str] = set()

    def _materialise(self, formula_name: str) -> dict[tuple[Any, ...], dict[str, Any]]:
        if formula_name in self._cache:
            return self._cache[formula_name]
        if formula_name in self._active:
            logger.warning(
                "Composition cycle on @%s — returning empty lookup", formula_name
            )
            self._cache[formula_name] = {}
            return {}
        self._active.add(formula_name)
        try:
            try:
                formula = resolve_formula(formula_name, self.dashboard_config)
            except ValueError:
                logger.warning(
                    "Formula %r not found in dashboard; lookups return None",
                    formula_name,
                )
                self._cache[formula_name] = {}
                return {}

            # ``rows`` are OutputRow dicts: {keys:{}, measures:{}, ...}.
            # Structural errors (evidence-mode source, invalid shape) propagate
            # so the author sees a real message; only unexpected runtime errors
            # degrade to empty lookup.
            try:
                rows = self.run_formula(formula)
            except ValueError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.warning("Failed to run source formula %r: %s", formula_name, e)
                self._cache[formula_name] = {}
                return {}
        finally:
            self._active.discard(formula_name)

        # ``rows`` are OutputRow dicts: {keys:{}, measures:{}, ...}. Keys
        # named in ``output_keys`` may live in either ``keys`` (dim values)
        # or ``measures`` (derive output) — derives let formulas bucketise
        # raw aggregates and compose onto the buckets.
        keys: list[str] = list(formula.output_keys or [])
        index: dict[tuple[Any, ...], dict[str, Any]] = {}

        def _keypart(row: Any, k: str) -> Any:
            rk = row.get("keys") if isinstance(row, dict) else None
            if isinstance(rk, dict) and k in rk:
                return rk[k]
            rm = row.get("measures") if isinstance(row, dict) else None
            if isinstance(rm, dict) and k in rm:
                return rm[k]
            return None

        for i, row in enumerate(rows):
            rkeys = row.get("keys") if isinstance(row, dict) else None
            rkeys = rkeys if isinstance(rkeys, dict) else {}
            if not keys:
                key_tuple = (
                    tuple(rkeys[k] for k in sorted(rkeys)) if rkeys else (i,)
                )
            else:
                key_tuple = tuple(_keypart(row, k) for k in keys)
            index[key_tuple] = row

        self._cache[formula_name] = index
        return index

    def lookup(
        self,
        formula_name: str,
        keys: tuple[Any, ...],
        column: str | None,
    ) -> Any:
        index = self._materialise(formula_name)
        row = index.get(keys)
        if row is None:
            return None
        if column is None:
            return row
        # measures carry both aggregates AND derives; keys are the group
        # dimensions. Measures win (composed formulas reference rate cols).
        for source in ("measures", "keys"):
            container = row.get(source)
            if isinstance(container, dict) and column in container:
                return container[column]
        return row.get(column)


def attach_formula_lookup(aq, dashboard_config: dict | None) -> None:
    """Wire ``@formula[k].col`` composition onto an AnnotationQuery for a
    request. The closure clones the query's run scope, materialises the
    referenced Formula via the engine, and returns its OutputRows as dicts.
    The sub-query shares the same lookup so nested composition resolves."""
    from app.api.modules.annotation.query import AnnotationQuery

    lookup = DashboardFormulaLookup(dashboard_config, None)

    def run_formula(f) -> list[dict[str, Any]]:
        sub = AnnotationQuery(aq._session, aq._infospace_id)
        sub._run_ids = list(aq._run_ids)
        sub._package_scope = aq._package_scope
        # Don't silently truncate source formulas at the default limit=100;
        # composition needs the whole keyspace to do its joins.
        sub._limit = 5000
        sub._formula_lookup = lookup  # nested @formula resolves too
        rel = sub.relation(f)
        # Composition onto an evidence-mode source is a foot-gun: evidence
        # rows carry no aggregated measures, so @evidence[k].col is always
        # None. Reject loudly so the author retargets at the aggregate.
        if rel.evidence_mode:
            raise ValueError(
                f"composition source @{f.name!r} is in evidence mode "
                f"(raw rows, no aggregated measures). Composition requires "
                f"an aggregate source — drop the 'top' measure or snippet."
            )
        return [r.model_dump() for r in rel.rows]

    lookup.run_formula = run_formula
    aq._formula_lookup = lookup
