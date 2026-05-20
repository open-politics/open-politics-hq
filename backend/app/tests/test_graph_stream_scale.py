"""Scale tests for ``stream_graph`` — Phase 4.8.

Opt-in (``pytest -m scale``). Requires the fixture seeded by
``app/tests/fixtures/scale/seed_5m_annotations.sql`` already present in the
test database. Fails the test early if the seed hasn't run.

Assertions (per ROADMAP invariant + EXECUTION.md §4.8):
  * First chunk latency < 500ms
  * Peak memory during the iteration stays under 100MB
  * At least one chunk arrives (stream isn't empty)

The streaming path must NEVER materialize the full 5M result set in Python;
these assertions catch a regression that drops ``top_n_*`` caps or that
switches the iterator back to a blocking materialization.
"""

from __future__ import annotations

import time
import tracemalloc

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.query import AnnotationQuery
from app.api.modules.graph.stream import AnnotationGraphSource, stream_graph

pytestmark = pytest.mark.scale


@pytest.fixture(scope="module")
def scale_engine():
    from app.core.config import settings
    return create_engine(str(settings.SQLALCHEMY_DATABASE_URI), echo=False)


@pytest.fixture(scope="module")
def scale_db(scale_engine):
    with Session(scale_engine) as s:
        yield s


def _infospace_id(session) -> int:
    row = session.exec(
        text("SELECT id FROM infospace WHERE name = 'scale-5m' LIMIT 1")
    ).first()
    if not row:
        pytest.skip(
            "scale fixture not seeded — run "
            "`psql < app/tests/fixtures/scale/seed_5m_annotations.sql` "
            "against the test DB before `pytest -m scale`."
        )
    return int(row[0])


async def test_stream_graph_bounded_memory_on_5m_annotations(scale_db):
    iid = _infospace_id(scale_db)

    # 500k rows (one run) — large enough to expose non-streaming impls.
    # The seed's round-robin puts ~50k annotations per run; stream across all
    # runs isn't feasible here, so we take a single run + cap at top_n.
    row = scale_db.exec(
        text("SELECT id FROM annotationrun WHERE infospace_id = :iid ORDER BY id LIMIT 1").bindparams(iid=iid)
    ).first()
    run_id = int(row[0])

    aq = AnnotationQuery(scale_db, iid).scope(None).runs([run_id])
    source = AnnotationGraphSource(query=aq, triplet_field="triplets")

    tracemalloc.start()
    first_chunk_ms: float | None = None
    chunk_count = 0
    start = time.perf_counter()

    async for chunk in stream_graph(
        scale_db, iid, source,
        top_n_nodes=1000, top_n_edges=5000, chunk_size=500,
    ):
        if first_chunk_ms is None:
            first_chunk_ms = (time.perf_counter() - start) * 1000
        chunk_count += 1

    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert chunk_count > 0, "stream yielded zero chunks"
    assert first_chunk_ms is not None and first_chunk_ms < 500, (
        f"first chunk took {first_chunk_ms:.1f}ms (budget: <500ms)"
    )
    assert peak < 100 * 1024 * 1024, (
        f"peak memory {peak / 1024 / 1024:.1f}MB exceeded 100MB ceiling"
    )


def test_aggregate_on_5m_bounded(scale_db):
    """aggregate() should never materialize rows client-side.

    GROUP BY runs in Postgres; Python sees only bucket counts. Peak memory
    must stay well under the stream ceiling.
    """
    iid = _infospace_id(scale_db)
    aq = AnnotationQuery(scale_db, iid).scope(None)

    tracemalloc.start()
    start = time.perf_counter()
    agg = aq.aggregate("sentiment")
    elapsed_ms = (time.perf_counter() - start) * 1000
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert len(agg.buckets) >= 1
    assert agg.total_count >= 1000, "fixture has too few annotations"
    # Latency budget is generous (5M-row GROUP BY is heavy) but peak
    # memory must remain bounded — aggregation is SQL-pushdown.
    assert peak < 50 * 1024 * 1024, (
        f"aggregate() peak memory {peak / 1024 / 1024:.1f}MB exceeded budget"
    )
    assert elapsed_ms < 30_000, (
        f"aggregate() took {elapsed_ms:.0f}ms — exceeds 30s budget"
    )
