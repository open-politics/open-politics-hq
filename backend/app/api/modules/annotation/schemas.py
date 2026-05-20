"""Annotation domain schemas.

Pydantic models for request/response shapes that are specific to annotations —
typed params for ``@task(params_model=...)``-decorated workers and their route
bodies live here.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ─── Geocoding (first user-action instance) ─────────────────────────────────


class GeocodeParams(BaseModel):
    """Typed params for the ``geocode`` @task.

    ``annotation_ids`` is resolved at the route (scope-filtered) so the task
    trusts its inputs — the standard @task contract.
    """

    run_id: int
    field_path: str = Field(
        description="Dotted/bracketed path into annotation.value, "
        "e.g. 'annotations[*].location' or 'location.name'",
    )
    annotation_ids: list[int] = Field(
        default_factory=list,
        description="Explicit annotation ids. Empty = all in run.",
    )


class GeocodeActionRequest(BaseModel):
    """Body for POST /runs/{run_id}/action/geocode."""

    field_path: str
    annotation_ids: list[int] | None = None
