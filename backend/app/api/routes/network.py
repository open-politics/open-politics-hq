"""The network stream — a run's whole graph, shipped for the GPU.

    POST /infospaces/{iid}/runs/{run_id}/network          (SSE)
    POST /infospaces/{iid}/runs/{run_id}/network/assets   (JSON) — the assets
         behind a set of the graph's annotations; see :func:`network_assets`
    POST /infospaces/{iid}/runs/{run_id}/network/where    (JSON) — the assets
         whose annotations carry a value; see :func:`network_where`
    POST /infospaces/{iid}/runs/{run_id}/network/weigh    (JSON) — a number,
         or a meaning, as a weight per annotation; see :func:`network_weigh`
    POST /infospaces/{iid}/runs/{run_id}/network/describe (JSON) — some of the
         run's documents in words; see :func:`network_describe`

    frame     denominators + the watermark (the overview's frame)
    building  every few seconds while the graph assembles: elapsed time
    network   the graph, as columns — see ``graph/network.py``
    ready     the initial load is complete
    ── then, while the run can still change ──
    frame · network     again, after each burst of commits, as a full replacement
    deadline  after 30 min; the client reconnects

Same graph as the knowledge-graph panel for the same query string — both are
configured by ``graph/reading.py`` — but read under the overview's run scope
(``overview.open_scope``) rather than a Formula, and shipped lean: what
positions and paints each node, and the way back to the documents behind it.

Results are cached per ``(run, watermark, basis)``, like the overview's: a
graph is minutes of work on a big run and nothing at all to reopen.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.api.modules.annotation import live
from app.api.modules.annotation import overview as ov
from app.api.modules.graph import network as net
from app.api.modules.graph.reading import collect, configure
from app.api.modules.identity_infospace_user.access import Access, Requires
from app.api.routes.overview import OverviewAsset
from app.core.db import engine
from app.core.filters import MergeMap
from app.core.recent import Recent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/infospaces/{infospace_id}/runs", tags=["Network"])

#: How often a building graph says it is still building. Also what keeps a
#: proxy from closing a stream that has been silent for minutes.
HEARTBEAT_SECONDS = 5.0

#: Graphs kept per process. Each is a run's whole graph in columns — a few MB.
_CACHE: Recent[dict[str, Any]] = Recent(8)


class NetworkRequest(BaseModel):
    q: str | None = Field(default=None, description="The graph query (GQL), as the graph panel writes it.")
    merge_maps: list[MergeMap] = Field(default_factory=list, description="Panel-local value aliases.")
    max_nodes: int | None = Field(
        default=None, ge=1, le=1_000_000,
        description="Keep the most frequent nodes only. Omitted = the whole graph.",
    )
    follow: bool = Field(default=True, description="Keep the stream open while the run can change.")


class _Run:
    """One stream's view of its run: a fresh scope per read, as the overview does."""

    def __init__(self, access: Access, run_id: int, body: NetworkRequest) -> None:
        self.access, self.run_id, self.body = access, run_id, body

    def _scope(self, session: Session) -> ov.RunScope:
        return ov.open_scope(session, self.access, self.run_id,
                             panel_merge_maps=self.body.merge_maps)

    def frame(self) -> dict[str, Any]:
        with Session(engine) as session:
            scope = self._scope(session)
            out = ov.frame(scope)
            out["basis"] = hashlib.sha1(json.dumps({
                "b": self.body.model_dump(mode="json", exclude={"follow"}),
                "aliases": [m.model_dump(mode="json") for m in scope.merge_maps],
                "scope": repr(scope.package_scope),
            }, sort_keys=True, default=str).encode()).hexdigest()[:16]
            return out

    def network(self) -> dict[str, Any]:
        started = time.monotonic()
        with Session(engine) as session:
            aq = self._scope(session).query()
            source, parsed = configure(aq, q=self.body.q)
            graph = collect(aq, source, parsed, top_n_nodes=self.body.max_nodes, top_n_edges=None)
            out = net.pack(session, graph)
        cap = self.body.max_nodes
        out["meta"] = {
            "ms": int((time.monotonic() - started) * 1000),
            "capped": cap is not None and len(out["nodes"]["id"]) >= cap,
        }
        return out


def _event(kind: str, data: Any, watermark: int) -> ServerSentEvent:
    return ServerSentEvent(data=data, event=kind, id=str(watermark))


async def _built(run: _Run, watermark: int):
    """Build the graph off the loop, saying so every few seconds; the graph
    itself is the last thing yielded."""
    started = time.monotonic()
    task = asyncio.ensure_future(asyncio.to_thread(run.network))
    while True:
        done, _ = await asyncio.wait({task}, timeout=HEARTBEAT_SECONDS)
        if done:
            yield task.result()
            return
        yield _event("building", {"elapsed_ms": int((time.monotonic() - started) * 1000)}, watermark)


@router.post("/{run_id}/network", response_class=EventSourceResponse)
async def network_stream(
    *,
    run_id: int,
    body: NetworkRequest,
    request: Request,
    access: Access = Requires(scope=None),
):
    """The run's graph, then live. See the module docstring for the event
    sequence. Every event's ``id`` is the watermark it describes."""
    try:
        access.require_in_scope("run_ids", run_id)
        run = _Run(access, run_id, body)

        started = time.monotonic()
        frame = await asyncio.to_thread(run.frame)
        watermark = frame["watermark"]
        yield _event("frame", frame, watermark)

        async def read(watermark: int, basis: str):
            key = (access.infospace_id, run_id, watermark, basis)
            graph = _CACHE.get(key)
            if graph is None:
                async for item in _built(run, watermark):
                    if isinstance(item, ServerSentEvent):
                        yield item
                    else:
                        graph = item
                _CACHE.put(key, graph)
            yield _event("network", graph, watermark)

        cached = _CACHE.get((access.infospace_id, run_id, watermark, frame["basis"])) is not None
        async for event in read(watermark, frame["basis"]):
            yield event
        yield _event("ready", {"ms": int((time.monotonic() - started) * 1000),
                               "cached": cached}, watermark)

        if not body.follow or not live.is_open(frame):
            return
        async for finished in live.changes(access.infospace_id, run_id,
                                           is_disconnected=request.is_disconnected):
            frame = await asyncio.to_thread(run.frame)
            if frame["watermark"] == watermark and not finished:
                continue
            watermark = frame["watermark"]
            yield _event("frame", frame, watermark)
            async for event in read(watermark, frame["basis"]):
                yield event
        yield _event("deadline", {}, watermark)

    except asyncio.CancelledError:
        return
    except Exception as e:  # noqa: BLE001 — an SSE stream reports, it does not 500
        logger.exception("network stream failed for run %s", run_id)
        yield ServerSentEvent(data={"detail": str(e)}, event="error")


# ─── Opening a selection ─────────────────────────────────────────────────────


class NetworkAssetsRequest(BaseModel):
    """A selection, by the annotations behind it — one node's ``ann`` slice,
    or the union of several."""

    annotations: list[int] = Field(max_length=200_000)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=200)


class NetworkAssetsPage(BaseModel):
    items: list[OverviewAsset]
    total: int
    offset: int


@router.post("/{run_id}/network/assets", response_model=NetworkAssetsPage)
def network_assets(
    *,
    run_id: int,
    body: NetworkAssetsRequest,
    access: Access = Requires(scope=None),
) -> Any:
    """The assets behind a selection of the graph, most annotations first, paged.
    ``n`` is how many of the selection's annotations each asset holds."""
    access.require_in_scope("run_ids", run_id)
    with Session(engine) as session:
        try:
            scope = ov.open_scope(session, access, run_id)
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        return net.assets_of(scope, body.annotations, offset=body.offset, limit=body.limit)


# ─── Gathering by value ──────────────────────────────────────────────────────


class ValueTerm(BaseModel):
    """A condition on the run's annotation values — ``sentiment = negative``,
    ``topics ~ energy``, ``severity > 7``. Values are alternatives; a
    comparison takes one, a number."""

    path: str = Field(description="A field path, as the schema map writes it (`topics[*]`).")
    op: Literal["=", "~", ">", ">=", "<", "<="] = Field(
        description="`=` is one of the values; `~` contains one; `> >= < <=` compare the number there to the value.")
    values: list[str] = Field(min_length=1, max_length=50)


class AssetsWhere(BaseModel):
    assets: list[int]


@router.post("/{run_id}/network/where", response_model=AssetsWhere)
def network_where(
    *,
    run_id: int,
    body: ValueTerm,
    access: Access = Requires(scope=None),
) -> Any:
    """The run's assets with an annotation, of any of its schemas, whose value
    at ``path`` matches — what the client gathers a value's nodes by, through
    each node's annotations. (The 0/1 case of ``/network/weigh``, which it
    folds into in time.)"""
    access.require_in_scope("run_ids", run_id)
    with Session(engine) as session:
        try:
            scope = ov.open_scope(session, access, run_id)
            return {"assets": net.assets_where(scope, body.path, body.op, body.values)}
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e


# ─── Weighing by value ───────────────────────────────────────────────────────


class WeighRequest(BaseModel):
    """A condition read as a weight — the shape of a ``FieldCondition``, so
    every graded source arrives the same way. ``value`` reads the number
    itself; ``gt ge lt le between`` read it against ``value`` as 0 or 1;
    ``about`` reads a meaning — ``value`` a phrase or alternatives, ``like``
    documents whose centroid is one more, ``path`` ``$`` — and, given
    ``labels``, the reader's node names by what they say."""

    path: str = Field(description="A field path, as the schema map writes it (`document.severity`, `actors[*].stance`); `$` for `about`.")
    operator: Literal["value", "gt", "ge", "lt", "le", "between", "about"] = "value"
    value: Any = None
    labels: list[str] | None = Field(
        default=None, max_length=500_000,
        description="`about` only: node names to weigh by their own vectors — the *said* basis. Omitted = none.",
    )
    like: list[int] | None = Field(
        default=None, max_length=20_000,
        description="`about` only: documents of the run whose centroid is one more alternative — a held room's snapshot.",
    )


class WeightColumn(BaseModel):
    """Weights by id: listed ids have a basis, the rest are absent."""

    ids: list[int]
    weights: list[float]


class WeightScale(BaseModel):
    by: Literal["declared", "rank", "threshold", "none"]
    min: float | None = None
    max: float | None = None
    quantiles: list[float] | None = Field(
        default=None,
        description="`rank` only: the raw value (a score, a cosine) at each twentieth of the rank, lowest first.",
    )


class LabelWeights(BaseModel):
    """Weights by name: listed names have a vector, the rest are absent."""

    names: list[str]
    weights: list[float]
    scale: WeightScale


class ElementWeights(BaseModel):
    """Weights per array element, by the annotation and the entity the element
    names — a number that belongs to the entities in an array, read as each
    one's own (an actor's stance)."""

    annotation: list[int]
    name: list[str]
    weights: list[float]
    scale: WeightScale


class Weights(BaseModel):
    """A field's weights per annotation, 0…1; the plane folds them onto its
    nodes (mean over the annotations that have one). ``scale`` is how the
    numbers were read, and their range. ``label`` is ``about``'s said basis,
    when names were asked about: a node takes its own name's weight.
    ``element``, for a number inside an array of entities: each entity takes
    the elements that name it, and other nodes none."""

    annotation: WeightColumn
    scale: WeightScale
    label: LabelWeights | None = None
    element: ElementWeights | None = None


@router.post("/{run_id}/network/weigh", response_model=Weights)
def network_weigh(
    *,
    run_id: int,
    body: WeighRequest,
    access: Access = Requires(scope=None),
) -> Any:
    """A number in the run's annotations, or a meaning, as a weight per
    annotation — what a surface is raised from and what pulls nodes to their
    value.

    Sync, so the whole read — scope, scans, session — stays on one worker
    thread and off the event loop the network streams beat on. ``about``
    awaits its provider on a loop of its own there."""
    access.require_in_scope("run_ids", run_id)
    with Session(engine) as session:
        try:
            scope = ov.open_scope(session, access, run_id)
            if body.operator == "about":
                return asyncio.run(net.about(scope, body.value, labels=body.labels, like=body.like))
            return net.weigh(scope, body.path, body.operator, body.value)
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e


# ─── Reading in words ────────────────────────────────────────────────────────


class DescribeRequest(BaseModel):
    """Some of the run's documents — a room's — to read in words."""

    documents: list[int] = Field(max_length=20_000)
    labels: list[str] = Field(
        default_factory=list, max_length=50_000,
        description="Names to read the meaning in, by their own vectors — the room's.",
    )
    passages: int = Field(default=3, ge=0, le=10)
    terms: int = Field(default=8, ge=0, le=30)


class ReadingPassage(BaseModel):
    asset_id: int
    title: str
    text: str
    similarity: float


class ReadingTerm(BaseModel):
    text: str
    similarity: float


class Reading(BaseModel):
    """What the documents are about, apart from the rest of the run: their
    passages and the names closest to it, best first. ``documents`` were read;
    ``embedded`` of them have chunks, which the reading stands on."""

    passages: list[ReadingPassage]
    terms: list[ReadingTerm]
    documents: int
    embedded: int


@router.post("/{run_id}/network/describe", response_model=Reading)
def network_describe(
    *,
    run_id: int,
    body: DescribeRequest,
    access: Access = Requires(scope=None),
) -> Any:
    """Documents of the run in words — the meaning that sets them apart from
    the rest of it, as passages and names. A room's reading. Sync, as weigh."""
    access.require_in_scope("run_ids", run_id)
    with Session(engine) as session:
        try:
            scope = ov.open_scope(session, access, run_id)
            return asyncio.run(net.describe(
                scope, body.documents, body.labels, passages=body.passages, terms=body.terms,
            ))
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
