"""The overview stream — a run's front door, delivered in stages.

    POST /infospaces/{iid}/runs/{run_id}/overview         (SSE)
    POST /infospaces/{iid}/runs/{run_id}/overview/assets  (JSON) — the assets
         behind one place or entity; see :func:`overview_assets`

    frame     denominators + the watermark         ~10 ms
    plan      sections, where/when each is read,   ~1 s first time, cached after
              and the discovery numbers behind it
    buckets   map + histogram + section counts     one statement
    entities  who, ranked, canon-merged            one statement
    ready     the initial load is complete
    ── then, while the run can still change ──
    frame · buckets · entities      again, each time the run commits new rows
                                    (coalesced), as a full replacement
    deadline  after 30 min; the client reconnects

Every stage opens its own short-lived session. A stream may stay open for half
an hour, and a pooled connection held that long sits *idle in transaction* —
which, among other things, blocks every migration on the tables it touched.

Results are cached per ``(run, watermark, basis)``: reopening a panel on a run
that has not changed costs nothing, and a live run invalidates naturally
because its watermark moves.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.api.modules.annotation import live
from app.api.modules.annotation import overview as ov
from app.api.modules.annotation.bindings import Pick
from app.api.modules.identity_infospace_user.access import Access, Requires
from app.core.db import engine
from app.core.filters import MergeMap
from app.core.recent import Recent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/infospaces/{infospace_id}/runs", tags=["Overview"])

class OverviewBindings(BaseModel):
    """A reader's choice for one section. A key that is present overrides the
    inference — ``null`` meaning "this section has no time/place" — and a key
    that is absent leaves it to the plan."""

    model_config = {"extra": "forbid"}

    time: str | None = None
    place: str | None = None


class OverviewRequest(BaseModel):
    bindings: dict[str, OverviewBindings] = Field(
        default_factory=dict,
        description="Per-section overrides, keyed `<schema_id>:<section path>` "
                    "or `<schema_id>:@document`.",
    )
    merge_maps: list[MergeMap] = Field(
        default_factory=list, description="Panel-local value aliases.",
    )
    within: str | None = Field(
        default=None,
        description="An entity identity (`entry:<id>` or `name:<key>`, as the "
                    "entities stage ships them): read only the assets that name it.",
    )
    follow: bool = Field(
        default=True,
        description="Keep the stream open and push replacements while the run "
                    "can still change.",
    )


def _picks(body: OverviewRequest) -> dict[str, Pick]:
    out: dict[str, Pick] = {}
    for key, b in body.bindings.items():
        given = b.model_fields_set
        out[key] = Pick(
            time=b.time if "time" in given else ...,
            place=b.place if "place" in given else ...,
        )
    return out


# ─── Cache ──────────────────────────────────────────────────────────────────

_CACHE: Recent[dict[str, Any]] = Recent(32)


# ─── Stages ─────────────────────────────────────────────────────────────────


class _Run:
    """One stream's view of its run: opens a fresh scope per stage."""

    def __init__(self, access: Access, run_id: int, body: OverviewRequest) -> None:
        self.access = access
        self.run_id = run_id
        self.body = body
        self.picks = _picks(body)
        self.plans: list[Any] = []
        self.discovery: dict[int, dict[str, tuple[int, int]]] = {}

    def _with_scope(self, fn: Callable[[ov.RunScope], Any]) -> Any:
        with Session(engine) as session:
            scope = ov.open_scope(session, self.access, self.run_id,
                                  panel_merge_maps=self.body.merge_maps)
            return fn(scope)

    def basis(self, scope: ov.RunScope) -> str:
        """Everything that changes what a count *means* without adding rows."""
        raw = json.dumps({
            "b": self.body.model_dump(mode="json", exclude={"follow"}),
            "aliases": [m.model_dump(mode="json") for m in scope.merge_maps],
            "canon": [list(scope.canon_ids), scope.geo_canon_id],
            "scope": repr(scope.package_scope),
        }, sort_keys=True, default=str)
        return hashlib.sha1(raw.encode()).hexdigest()[:16]

    def frame(self) -> dict[str, Any]:
        def go(scope: ov.RunScope) -> dict[str, Any]:
            out = ov.frame(scope)
            out["basis"] = self.basis(scope)
            return out
        return self._with_scope(go)

    def plan(self) -> dict[str, Any]:
        def go(scope: ov.RunScope) -> dict[str, Any]:
            self.plans, self.discovery = ov.schema_plans(scope, self.picks)
            return {
                "schemas": [{
                    "id": p.schema_id, "name": p.name, "flat": p.flat,
                    "sections": [s.to_wire() for s in p.all],
                    "discovery": {path: list(v) for path, v in
                                  self.discovery.get(p.schema_id, {}).items()},
                } for p in self.plans],
            }
        return self._with_scope(go)

    def readings(self) -> tuple[dict[str, Any], dict[str, Any]]:
        within = self.body.within
        return (self._with_scope(lambda s: ov.buckets(s, self.plans, within=within)),
                self._with_scope(lambda s: ov.entities(s, self.plans, within=within)))


def _event(kind: str, data: Any, watermark: int) -> ServerSentEvent:
    return ServerSentEvent(data=data, event=kind, id=str(watermark))


@router.post("/{run_id}/overview", response_class=EventSourceResponse)
async def overview_stream(
    *,
    run_id: int,
    body: OverviewRequest,
    request: Request,
    access: Access = Requires(scope=None),
):
    """The run's overview, in stages, then live. See the module docstring for
    the event sequence. Every event's ``id`` is the watermark it describes."""
    try:
        access.require_in_scope("run_ids", run_id)
        run = _Run(access, run_id, body)

        started = time.monotonic()
        frame = await asyncio.to_thread(run.frame)
        watermark = frame["watermark"]
        yield _event("frame", frame, watermark)

        plan = await asyncio.to_thread(run.plan)
        yield _event("plan", plan, watermark)

        key = (access.infospace_id, run_id, watermark, frame["basis"])
        cached = _CACHE.get(key)
        if cached:
            buckets, entities = cached["buckets"], cached["entities"]
        else:
            buckets, entities = await asyncio.to_thread(run.readings)
            _CACHE.put(key, {"buckets": buckets, "entities": entities})
        yield _event("buckets", buckets, watermark)
        yield _event("entities", entities, watermark)
        yield _event("ready", {"ms": int((time.monotonic() - started) * 1000),
                               "cached": bool(cached)}, watermark)

        if not body.follow or not live.is_open(frame):
            return

        # ── Follow ──────────────────────────────────────────────────────
        async for finished in live.changes(access.infospace_id, run_id,
                                           is_disconnected=request.is_disconnected):
            frame = await asyncio.to_thread(run.frame)
            if frame["watermark"] == watermark and not finished:
                continue
            watermark = frame["watermark"]
            yield _event("frame", frame, watermark)
            buckets, entities = await asyncio.to_thread(run.readings)
            _CACHE.put((access.infospace_id, run_id, watermark, frame["basis"]),
                       {"buckets": buckets, "entities": entities})
            yield _event("buckets", buckets, watermark)
            yield _event("entities", entities, watermark)
        yield _event("deadline", {}, watermark)

    except asyncio.CancelledError:
        return
    except Exception as e:  # noqa: BLE001 — an SSE stream reports, it does not 500
        logger.exception("overview stream failed for run %s", run_id)
        yield ServerSentEvent(data={"detail": str(e)}, event="error")


# ─── Drill-down ─────────────────────────────────────────────────────────────


class OverviewWindow(BaseModel):
    """The time strip's brush: inclusive cell starts at the reading's grain."""

    start: str
    end: str
    grain: str


class OverviewAssetsRequest(BaseModel):
    """One count, opened. The reading it came from travels with it, so the
    list is cut from exactly the rows that count was made of."""

    bindings: dict[str, OverviewBindings] = Field(default_factory=dict)
    merge_maps: list[MergeMap] = Field(default_factory=list)
    within: str | None = None
    place: str | None = Field(default=None, description="A place identity from `buckets.places.id`.")
    entity: str | None = Field(default=None, description="An entity identity from `entities.items[].id`.")
    sections: list[str] | None = Field(
        default=None,
        description="Section keys the reading counts, dated by row; omitted = every stream, dated by asset — as Assets mode counts.",
    )
    window: OverviewWindow | None = None
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=200)


class OverviewAsset(BaseModel):
    id: int
    title: str | None = None
    kind: str | None = None
    created_at: str | None = None
    t: str | None = Field(default=None, description="The asset's time as the reading dates it.")
    n: int = Field(description="Rows placing it there, or mentions of the entity.")


class OverviewAssetsPage(BaseModel):
    items: list[OverviewAsset]
    total: int
    offset: int
    spellings: list[str] = Field(description="Every spelling the identity was matched on.")


@router.post("/{run_id}/overview/assets", response_model=OverviewAssetsPage)
def overview_assets(
    *,
    run_id: int,
    body: OverviewAssetsRequest,
    access: Access = Requires(scope=None),
) -> Any:
    """The assets behind one place or one entity of an overview reading, most
    rows (or mentions) first, paged."""
    from fastapi import HTTPException

    access.require_in_scope("run_ids", run_id)
    if (body.place is None) == (body.entity is None):
        raise HTTPException(status_code=422, detail="Give exactly one of place or entity.")
    picks = _picks(OverviewRequest(bindings=body.bindings))
    with Session(engine) as session:
        try:
            scope = ov.open_scope(session, access, run_id, panel_merge_maps=body.merge_maps)
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        plans, _ = ov.schema_plans(scope, picks)
        w = body.window
        try:
            return ov.assets_for(
                scope, plans,
                place=body.place, entity=body.entity, within=body.within,
                sections=body.sections,
                window=(w.start, w.end) if w else None,
                grain=w.grain if w else "month",
                asset_time=body.sections is None,
                offset=body.offset, limit=body.limit,
            )
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
