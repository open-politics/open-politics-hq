"""Tests for Phase 0 graph stream extensions.

Covers:
  - edge_weight_mode variants (count / property / sum_property / avg_property /
    max_property / count_times_property)
  - forward_properties with per-field aggregation specs (first / sum / avg / max)
  - edge_group_by (edges split across group values)
  - node_group_by (first-seen-wins per node)
  - null_policy handling on edge weight
"""
from __future__ import annotations

import asyncio
import json as _json

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.panel_config import ForwardPropertySpec
from app.api.modules.annotation.query import AnnotationQuery
from app.api.modules.graph.stream import (
    AnnotationGraphSource,
    collect_graph,
)


@pytest.fixture(scope="module")
def pg_engine():
    from app.core.config import settings
    return create_engine(str(settings.SQLALCHEMY_DATABASE_URI), echo=False)


@pytest.fixture
def db(pg_engine):
    connection = pg_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


# ─── fixture helpers (copied from test_graph_stream.py shape) ──────────────


def _user(db, suffix: str) -> int:
    result = db.execute(
        text(
            "INSERT INTO \"user\" (email, hashed_password, is_active, is_superuser, "
            "email_verified, full_name, created_at, updated_at) "
            "VALUES (:email, 'x', true, false, true, 'T', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"email": f"gse_{suffix}@t.local"},
    )
    return int(result.scalar())


def _infospace(db, uid: int, name: str) -> int:
    result = db.execute(
        text(
            "INSERT INTO infospace (name, owner_id, uuid, created_at) "
            "VALUES (:n, :u, gen_random_uuid()::text, now()) RETURNING id"
        ),
        {"n": name, "u": uid},
    )
    return int(result.scalar())


def _schema(db, iid: int, uid: int, name: str = "s") -> int:
    result = db.execute(
        text(
            "INSERT INTO annotationschema (name, description, output_contract, instructions, "
            "infospace_id, user_id, version, is_active, uuid, created_at, updated_at) "
            "VALUES (:n, 'd', '{}'::jsonb, 'i', :iid, :uid, '1.0', true, "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"n": name, "iid": iid, "uid": uid},
    )
    return int(result.scalar())


def _run(db, iid: int, uid: int, name: str) -> int:
    result = db.execute(
        text(
            "INSERT INTO annotationrun (name, description, configuration, "
            "infospace_id, user_id, status, uuid, created_at, updated_at, "
            "include_parent_context, context_window, trigger_type, run_type, "
            "follow_on_version_change) "
            "VALUES (:n, 'd', '{}'::jsonb, :iid, :uid, 'PENDING', "
            "gen_random_uuid()::text, now(), now(), false, 0, 'MANUAL', 'ONE_OFF', false) "
            "RETURNING id"
        ),
        {"n": name, "iid": iid, "uid": uid},
    )
    return int(result.scalar())


def _asset(db, iid: int, uid: int, title: str) -> int:
    result = db.execute(
        text(
            "INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, "
            "uuid, processing_status, stub, created_at, updated_at) "
            "VALUES (:t, 'ARTICLE', :iid, :uid, CAST(:bids AS int[]), "
            "gen_random_uuid()::text, 'READY', false, now(), now()) RETURNING id"
        ),
        {"t": title, "iid": iid, "uid": uid, "bids": []},
    )
    return int(result.scalar())


def _annotation(db, iid, uid, run_id, schema_id, asset_id, value):
    result = db.execute(
        text(
            "INSERT INTO annotation (run_id, schema_id, asset_id, value, status, "
            "infospace_id, user_id, timestamp, uuid, created_at, updated_at) "
            "VALUES (:r, :s, :a, CAST(:v AS jsonb), 'SUCCESS', :iid, :uid, now(), "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"r": run_id, "s": schema_id, "a": asset_id, "v": _json.dumps(value), "iid": iid, "uid": uid},
    )
    return int(result.scalar())


# Build a tiny graph where A→B appears 3 times with confidence [0.6, 0.8, 1.0]
# and one "party" field for grouping.
@pytest.fixture
def weighted_fixture(db):
    uid = _user(db, "w")
    iid = _infospace(db, uid, "gse-weight")
    sid = _schema(db, iid, uid)
    asset = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    # Three repeats of A→B with different confidences, two parties.
    _annotation(db, iid, uid, r, sid, asset, {
        "party": "FDP",
        "triplets": [{
            "subject_name": "A", "subject_type": "person",
            "predicate": "knows",
            "object_name": "B", "object_type": "org",
            "confidence": 0.6,
        }],
    })
    _annotation(db, iid, uid, r, sid, asset, {
        "party": "FDP",
        "triplets": [{
            "subject_name": "A", "subject_type": "person",
            "predicate": "knows",
            "object_name": "B", "object_type": "org",
            "confidence": 0.8,
        }],
    })
    _annotation(db, iid, uid, r, sid, asset, {
        "party": "SPD",
        "triplets": [{
            "subject_name": "A", "subject_type": "person",
            "predicate": "knows",
            "object_name": "B", "object_type": "org",
            "confidence": 1.0,
        }],
    })
    # One unrelated edge for group-split safety check.
    _annotation(db, iid, uid, r, sid, asset, {
        "party": "SPD",
        "triplets": [{
            "subject_name": "C", "subject_type": "person",
            "predicate": "knows",
            "object_name": "D", "object_type": "org",
            "confidence": 0.5,
        }],
    })
    return {"iid": iid, "uid": uid, "run": r}


# ─── edge_weight_mode ──────────────────────────────────────────────────────


def test_edge_weight_mode_count_default(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(query=aq, triplet_field="triplets")
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.predicate == "knows" and e.group_value is None)
    # Edges are aggregated within-window; count mode keeps computed_weight = count
    # which equals weight since no group-by splits them.
    assert ab.computed_weight == float(ab.weight)


def test_edge_weight_mode_property(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="property",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab_edges = [e for e in result.edges if "knows" == e.predicate]
    # "property" mode uses first-seen value. Non-null.
    assert all(e.computed_weight is not None for e in ab_edges)


def test_edge_weight_mode_sum_property(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="sum_property",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    # A→B appears 3 times with confidences 0.6 + 0.8 + 1.0 = 2.4
    ab = next(e for e in result.edges if e.source != e.target and e.predicate == "knows"
              and e.properties.get("__ignored", None) is None
              and e.weight == 3)
    assert ab.computed_weight == pytest.approx(2.4)


def test_edge_weight_mode_avg_property(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="avg_property",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    # avg(0.6, 0.8, 1.0) = 0.8
    assert ab.computed_weight == pytest.approx(0.8)


def test_edge_weight_mode_max_property(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="max_property",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    assert ab.computed_weight == pytest.approx(1.0)


def test_edge_weight_mode_count_times_property(db, weighted_fixture):
    """"Strong repeating connections get thicker": count × avg(property)."""
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="count_times_property",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    # 3 * avg(0.6, 0.8, 1.0) = 3 * 0.8 = 2.4
    assert ab.computed_weight == pytest.approx(2.4)


# ─── forward_properties ────────────────────────────────────────────────────


def test_forward_properties_first(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        forward_properties=[ForwardPropertySpec(field="confidence", agg="first")],
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    # first-seen value is the one from the most recent annotation (ORDER BY DESC)
    assert ab.properties.get("confidence") is not None


def test_forward_properties_avg(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        forward_properties=[ForwardPropertySpec(field="confidence", agg="avg")],
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    assert ab.properties.get("confidence") == pytest.approx(0.8)


def test_forward_properties_sum_and_max(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        forward_properties=[
            ForwardPropertySpec(field="confidence", agg="sum"),
        ],
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    assert ab.properties.get("confidence") == pytest.approx(2.4)


# ─── edge_group_by ─────────────────────────────────────────────────────────


def test_edge_group_by_splits_edges(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_group_by="party",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    # A→B has 2 FDP occurrences and 1 SPD occurrence → 2 edges (one per group).
    ab_edges = [e for e in result.edges
                if any(n.id == e.source and n.name == "A" for n in result.nodes)
                and any(n.id == e.target and n.name == "B" for n in result.nodes)]
    group_values = {e.group_value for e in ab_edges}
    assert group_values == {"FDP", "SPD"}
    # FDP count = 2, SPD count = 1
    fdp_edge = next(e for e in ab_edges if e.group_value == "FDP")
    spd_edge = next(e for e in ab_edges if e.group_value == "SPD")
    assert fdp_edge.weight == 2
    assert spd_edge.weight == 1


# ─── node_group_by ─────────────────────────────────────────────────────────


def test_node_group_by_attaches_to_node(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        node_group_by="party",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    # Each node has some group_value attached (first-seen per node).
    a_node = next(n for n in result.nodes if n.name == "A")
    assert a_node.group_value in ("FDP", "SPD")


# ─── null_policy ───────────────────────────────────────────────────────────


def test_null_policy_skip_default(db):
    """Rows without the edge_weight_field contribute 0 to numeric aggregations."""
    uid = _user(db, "np")
    iid = _infospace(db, uid, "gse-np")
    sid = _schema(db, iid, uid)
    asset = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    # Two annotations, only one has confidence.
    _annotation(db, iid, uid, r, sid, asset, {
        "triplets": [{
            "subject_name": "X", "subject_type": "person",
            "predicate": "knows",
            "object_name": "Y", "object_type": "org",
            "confidence": 0.5,
        }],
    })
    _annotation(db, iid, uid, r, sid, asset, {
        "triplets": [{
            "subject_name": "X", "subject_type": "person",
            "predicate": "knows",
            "object_name": "Y", "object_type": "org",
            # no confidence field
        }],
    })

    aq = AnnotationQuery(db, iid).scope(None).runs([r])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="avg_property",
        null_policy="skip",
    )
    result = asyncio.run(collect_graph(db, iid, source, chunk_size=10))

    xy = next(e for e in result.edges if e.weight == 2)
    # Only one row has confidence=0.5 — avg of a single value = 0.5
    assert xy.computed_weight == pytest.approx(0.5)


def test_null_policy_zero_includes_nulls_as_zero(db):
    uid = _user(db, "np2")
    iid = _infospace(db, uid, "gse-np2")
    sid = _schema(db, iid, uid)
    asset = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    _annotation(db, iid, uid, r, sid, asset, {
        "triplets": [{
            "subject_name": "X", "subject_type": "person",
            "predicate": "knows",
            "object_name": "Y", "object_type": "org",
            "confidence": 1.0,
        }],
    })
    _annotation(db, iid, uid, r, sid, asset, {
        "triplets": [{
            "subject_name": "X", "subject_type": "person",
            "predicate": "knows",
            "object_name": "Y", "object_type": "org",
        }],
    })

    aq = AnnotationQuery(db, iid).scope(None).runs([r])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="avg_property",
        null_policy="zero",
    )
    result = asyncio.run(collect_graph(db, iid, source, chunk_size=10))

    xy = next(e for e in result.edges if e.weight == 2)
    # avg(1.0, 0.0) = 0.5 under "zero" policy (NULL coerced to 0)
    assert xy.computed_weight == pytest.approx(0.5)


# ─── node_group_by: order independence ─────────────────────────────────────
#
# Pure aggregation, so these drive ``stream_graph`` with a hand-built source
# rather than the database — the behaviour under test is atom *ordering*, and
# fabricating a specific order through SQL is both fragile and beside the point.


class _StubSource:
    """Minimal :class:`GraphSource` — yields the atoms it was handed."""

    def __init__(self, windows, **cfg):
        self._windows = windows
        self.node_group_by = cfg.get("node_group_by")
        self.edge_group_by = cfg.get("edge_group_by")
        self.edge_weight_mode = cfg.get("edge_weight_mode", "count")
        self.forward_properties = cfg.get("forward_properties", [])
        self.null_policy = cfg.get("null_policy", "skip")
        self.dedup = cfg.get("dedup", "exact")

    async def windows(self, chunk_size):
        for w in self._windows:
            yield w


def _occurrence_atoms():
    """One occurrence with one participant, plus the roster row naming them.

    The occurrence's role-edge carries **empty properties** by design —
    participants inherit nothing from the row they appear in, which is what
    stops one payment's date smearing across everyone named in it.
    """
    from app.api.modules.graph.stream import NodeRow, TripletRow

    occurrence = NodeRow(
        annotation_id=1, name="1:obs:1", type="Payment",
        properties={"_is_occurrence": True, "_node_group_subj": "Payment",
                    "_node_group_obj": "Payment", "_t0": "2020-01-01"},
        source_path="obs[*]", role=None,
    )
    role_edge = TripletRow(
        annotation_id=1, subject_name="1:obs:1", subject_type="Payment",
        predicate="payer", object_name="Alice", object_type="Person",
        properties={}, source_path="obs[*]",
        subject_role=None, object_role="payer",
    )
    roster = NodeRow(
        annotation_id=1, name="Alice", type="Person",
        properties={"_node_group_subj": "Germany"},
        source_path="actors[*]", role="actor",
    )
    return occurrence, role_edge, roster


@pytest.mark.parametrize("order", ["occurrence_first", "roster_first"])
def test_node_group_by_is_order_independent(db, order):
    """A participant's group value must not depend on which projection was read
    first.

    Regression. ``first-seen wins`` latched the ``None`` that an occurrence's
    role-edge carries, so an actor reached through an occurrence before their
    roster row kept no group value at all — and which happened first was a
    coin flip on projection declaration order. Colour-by and cluster-by
    silently changed answer with it.
    """
    from app.api.modules.graph.stream import stream_graph

    occurrence, role_edge, roster = _occurrence_atoms()
    window = (
        [occurrence, role_edge, roster] if order == "occurrence_first"
        else [roster, occurrence, role_edge]
    )

    async def _collect():
        nodes = []
        source = _StubSource([window], node_group_by="country")
        async for chunk in stream_graph(db, 1, source, chunk_size=50):
            nodes.extend(chunk.nodes)
        return nodes

    nodes = asyncio.run(_collect())
    alice = next(n for n in nodes if n.name == "Alice")
    assert alice.group_value == "Germany"


def test_occurrence_participants_do_not_inherit_the_rows_interval(db):
    """The empty ``properties`` dict on a role-edge is the scoping fix.

    Without it a person's interval becomes the union of every act they ever
    appeared in, and the time slider filters on a fiction.
    """
    from app.api.modules.graph.stream import stream_graph

    occurrence, role_edge, _ = _occurrence_atoms()

    async def _collect():
        nodes = []
        source = _StubSource([[occurrence, role_edge]])
        async for chunk in stream_graph(db, 1, source, chunk_size=50):
            nodes.extend(chunk.nodes)
        return nodes

    nodes = asyncio.run(_collect())
    by_name = {n.name: n for n in nodes}
    assert by_name["1:obs:1"].t0 == "2020-01-01"
    assert by_name["1:obs:1"].kind == "occurrence"
    assert by_name["Alice"].t0 is None
    assert by_name["Alice"].kind == "entity"


def test_document_supplied_id_still_links_when_a_label_is_set(db):
    """A row references another by the identifier the DOCUMENT gave it.

    Regression, and an architectural one: the node slot collapsed identity and
    display into a single ``name``, so setting ``node_label`` — which every
    shipped template does for every occurrence — overwrote the id another row
    points at. The typeless fold then had nothing to match, and the evidence
    edge landed on a phantom node beside the occurrence it grounds.
    """
    from app.api.modules.graph.stream import NodeRow, TripletRow, stream_graph

    transfer = NodeRow(
        annotation_id=1, name="TX-1", type="Transfer",
        properties={"_is_occurrence": True, "_node_label": "EUR 4m"},
        source_path="document.transfers[*]", role=None,
    )
    evidence = NodeRow(
        annotation_id=1, name="EX-4", type="Evidence",
        properties={"_is_occurrence": True, "_node_label": "he paid it himself"},
        source_path="document.evidence[*]", role=None,
    )
    # `supports` is typeless — the archetype it grounds is not knowable here.
    supports = TripletRow(
        annotation_id=1, subject_name="EX-4", subject_type="Evidence",
        predicate="supports", object_name="TX-1", object_type="",
        properties={}, source_path="document.evidence[*]",
        subject_role=None, object_role="supports",
    )

    async def _collect():
        nodes, edges = [], []
        source = _StubSource([[transfer, evidence, supports]])
        async for chunk in stream_graph(db, 1, source, chunk_size=50):
            nodes.extend(chunk.nodes)
            edges.extend(chunk.edges)
        return nodes, edges

    nodes, edges = asyncio.run(_collect())
    by_id = {n.id: n for n in nodes}

    # No phantom: exactly one Transfer, and nothing left over named TX-1.
    assert len(nodes) == 2, [n.name for n in nodes]
    transfer_node = next(n for n in nodes if n.type == "Transfer")
    assert transfer_node.name == "EUR 4m"      # display survives

    # …and the supports edge reaches it.
    assert len(edges) == 1
    assert by_id[edges[0].target].type == "Transfer"
    assert edges[0].predicate == "supports"


# ─── The document rung ─────────────────────────────────────────────────────


def test_document_rung_places_and_dates_what_it_mentions(db):
    """The weakest rung of both ladders, and it behaves differently per axis.

    Place is **additive** — it joins ``places[]`` tagged ``source: "doc"`` so
    the ladder can rank a filing's subject below a stated site. Time is a
    **fallback** — ``t0`` is single-valued, so unioning the document's date in
    would stretch every node to it and make the slider lie.
    """
    from app.api.modules.graph.stream import NodeRow, stream_graph

    dated = NodeRow(
        annotation_id=7, name="Meeting-1", type="Encounter",
        properties={"_is_occurrence": True, "_t0": "2014-06-02",
                    "_place": "Valletta"},
        source_path="document.encounters[*]", role=None,
    )
    undated = NodeRow(
        annotation_id=7, name="Acme Ltd", type="Organization",
        properties={}, source_path="document.actors[*]", role="actor",
    )

    class _WithDoc(_StubSource):
        doc_anchors = {7: {"place": "Malta", "time": "2015-01-01"}}

    async def _collect():
        nodes = []
        async for chunk in stream_graph(db, 1, _WithDoc([[dated, undated]]), chunk_size=9):
            nodes.extend(chunk.nodes)
        return nodes

    by_name = {n.name: n for n in asyncio.run(_collect())}

    # The dated occurrence keeps its own clock and its own site, and gains
    # Malta as a weaker second place.
    meeting = by_name["Meeting-1"]
    assert meeting.t0 == "2014-06-02", "a row's own date must win"
    rungs = {p.place: p.source for p in meeting.places}
    assert rungs == {"Valletta": "row", "Malta": "doc"}

    # The undated actor inherits rather than falling out of the timeline.
    acme = by_name["Acme Ltd"]
    assert acme.t0 == "2015-01-01"
    assert [(p.place, p.source) for p in acme.places] == [("Malta", "doc")]
    assert acme.place == "Malta"


def test_document_rung_never_places_an_interest(db):
    """A motive is not somewhere. Same guard as the geocoder's."""
    from app.api.modules.graph.stream import NodeRow, stream_graph

    interest = NodeRow(
        annotation_id=7, name="opacity", type="Interest",
        properties={}, source_path="document.interests[*]", role=None,
    )

    class _WithDoc(_StubSource):
        doc_anchors = {7: {"place": "Malta", "time": "2015-01-01"}}

    async def _collect():
        nodes = []
        async for chunk in stream_graph(db, 1, _WithDoc([[interest]]), chunk_size=9):
            nodes.extend(chunk.nodes)
        return nodes

    node = asyncio.run(_collect())[0]
    assert node.places == []
    assert node.place is None


# ─── A row's forwarded fields land on the node the row is ABOUT ────────────


def test_occurrence_carries_its_forwarded_properties(db):
    """`GraphNode.properties` was declared on the wire and never populated.

    So an exhibit's stance, source and locator were read off an empty dict and
    the evidence pane fell back to the node's label — and a statement's
    modality never reached the client at all, leaving a denial to render
    exactly like an assertion.
    """
    from app.api.modules.graph.stream import NodeRow, TripletRow, stream_graph

    statement = NodeRow(
        annotation_id=3, name="ST-1", type="Statement",
        properties={
            "_is_occurrence": True,
            "_node_label": "He never visited the island",
            "_t0": "2016-05-03",
            "fp__modality": "denies",
            "_inline_justification": {
                "reasoning": "witness answered in the negative",
                "text_spans": [{"text_snippet": "I did not."}],
            },
        },
        source_path="document.statements[*]", role=None,
    )
    speaker = TripletRow(
        annotation_id=3, subject_name="ST-1", subject_type="Statement",
        predicate="speaker", object_name="A Witness", object_type="Person",
        properties={}, source_path="document.statements[*]",
        subject_role=None, object_role="speaker",
    )

    async def _collect():
        nodes = []
        source = _StubSource([[statement, speaker]])
        async for chunk in stream_graph(db, 1, source, chunk_size=20):
            nodes.extend(chunk.nodes)
        return nodes

    by_type = {n.type: n for n in asyncio.run(_collect())}
    stmt = by_type["Statement"]

    # The modality rides on the node, so the quote grounding it can inherit it.
    assert stmt.properties.get("modality") == "denies"
    # …and the justification is on the node too, which is what makes an inline
    # justification serve as evidence without a second extraction pass.
    assert len(stmt.evidence) == 1
    assert stmt.evidence[0]["text_spans"][0]["text_snippet"] == "I did not."

    # The participant inherits neither. A witness is not "denies".
    assert by_type["Person"].properties == {}
    assert by_type["Person"].evidence == []


# ─── Citations point forward, and merge onto the exhibit ───────────────────


@pytest.mark.parametrize("order", ["citing_row_first", "exhibit_first"])
def test_a_citation_merges_onto_the_exhibit_it_names(db, order):
    """`cites` on the citing row replaces `supports` on the evidence row.

    The old direction asked a model to name the id of a row it had already
    emitted — bookkeeping across an open-ended generation, against ids that
    mostly do not exist. A citation is in the sentence being read, so copying
    the label is extraction. Both sides land on ``name + type``, so the graph
    is the same and nothing had to be remembered.
    """
    from app.api.modules.graph.stream import NodeRow, TripletRow, stream_graph

    statement = NodeRow(
        annotation_id=1, name="1:statements:1", type="Statement",
        properties={"_is_occurrence": True, "_node_label": "He never visited"},
        source_path="document.statements[*]", role=None,
    )
    cites = TripletRow(
        annotation_id=1, subject_name="1:statements:1", subject_type="Statement",
        predicate="cites", object_name="Exhibit C", object_type="Evidence",
        properties={}, source_path="document.statements[*]",
        subject_role=None, object_role="cites",
    )
    exhibit = NodeRow(
        annotation_id=1, name="Exhibit C", type="Evidence",
        properties={"_is_occurrence": True, "_node_label": "I did not.",
                    "fp__stance": "contradicts", "fp__locator": "p. 14"},
        source_path="document.evidence[*]", role=None,
    )
    window = ([statement, cites, exhibit] if order == "citing_row_first"
              else [exhibit, statement, cites])

    async def _collect():
        nodes, edges = [], []
        async for chunk in stream_graph(db, 1, _StubSource([window]), chunk_size=20):
            nodes.extend(chunk.nodes)
            edges.extend(chunk.edges)
        return nodes, edges

    nodes, edges = asyncio.run(_collect())

    # One exhibit, not an exhibit plus a phantom reference to it.
    assert len(nodes) == 2, [n.name for n in nodes]
    ev = next(n for n in nodes if n.type == "Evidence")
    assert ev.properties == {"stance": "contradicts", "locator": "p. 14"}
    assert ev.name == "I did not."

    # …and it is an occurrence whichever projection was read first. Reached as
    # the far end of a `cites` edge before its own row, it used to latch
    # ``entity`` and drop out of `kind:occurrence` entirely.
    assert ev.kind == "occurrence"

    assert len(edges) == 1 and edges[0].predicate == "cites"
    assert edges[0].target == ev.id


# ─── node_kind — what the minted node IS, not which array it came from ─────


def test_an_about_self_row_can_mint_an_entity(db):
    """An exhibit exists whether or not anyone cites it, so it is an entity —
    even though its row lives in an ``about: self`` array, because that is the
    only branch that mints a node.

    Without this, ``kind:`` reported which array a row landed in: "show me
    everything that happened" returned documents alongside the acts they ground.
    """
    from app.api.modules.graph.stream import NodeRow, stream_graph

    act = NodeRow(
        annotation_id=1, name="1:obs:1", type="Payment",
        properties={"_is_occurrence": True}, source_path="obs[*]", role=None,
    )
    exhibit = NodeRow(
        annotation_id=1, name="Exhibit C", type="Evidence",
        properties={},                       # node_kind="entity" → no marker
        source_path="evidence[*]", role=None,
    )

    async def _collect():
        nodes = []
        async for chunk in stream_graph(db, 1, _StubSource([[act, exhibit]]), chunk_size=9):
            nodes.extend(chunk.nodes)
        return nodes

    by_type = {n.type: n for n in asyncio.run(_collect())}
    assert by_type["Payment"].kind == "occurrence"
    assert by_type["Evidence"].kind == "entity"
    # `node_type` mirrors into `type` only for occurrences — an entity's type is
    # already its type, and duplicating it would double-count in a legend.
    assert by_type["Payment"].node_type == "Payment"
    assert by_type["Evidence"].node_type is None
