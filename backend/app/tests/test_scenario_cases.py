"""The six investigation shapes, as regression tests.

`docs/plans/observation-model/INVESTIGATION.md` names six shapes of
investigation and argues the machinery should answer all of them. This is that
argument, executable.

**The corpus is fabricated on purpose.** Over a model-produced run, a failing
case could be the prompt, the corpus or the engine, and there is no way to tell
which — which is exactly the position the panel work kept getting stuck in. The
scenario is hand-written and perfectly filled, so a failure here is unambiguous:
the machinery is wrong.

The complement still matters and is a different test: whether a model *can*
produce a run like this one. That needs a docket and a real run.
"""
from __future__ import annotations

import pytest

from app.api.modules.annotation import scenario
from app.api.modules.annotation.scenario_verify import CASES, assemble, run_query

from app.tests.test_graph_stream import db, pg_engine  # noqa: F401


@pytest.fixture(scope="function")
def mega(db):
    ids = scenario.seed(db, owner_email="scenario-test@local")
    return assemble(db, ids["run"], ids["infospace"]), ids


def test_the_corpus_assembles(mega):
    graph, ids = mega
    assert ids["documents"] == 20
    assert len(graph.nodes) > 40, "the mega-corpus should be a real graph"
    # Every node dated: rows date themselves, and the asset rung catches the
    # rest. A fixture with untimed nodes could not test a time frame at all.
    untimed = [n.name for n in graph.nodes if not n.t0]
    assert not untimed, f"untimed: {untimed}"


def test_rosters_are_the_vocabulary(mega):
    """The model's own rule, and the fixture must obey it or it tests nothing:
    every name used in a row appears in a roster, so one name is one node."""
    graph, _ = mega
    dupes = {}
    for n in graph.nodes:
        dupes.setdefault(n.name, set()).add(n.type)
    split = {k: sorted(v) for k, v in dupes.items() if len(v) > 1}
    assert not split, f"one name, two types: {split}"


@pytest.mark.parametrize("case", CASES, ids=[c.id for c in CASES])
def test_investigation_shape(mega, case):
    graph, _ = mega
    nodes, edges = (run_query(graph, case.query) if case.query
                    else (list(graph.nodes), list(graph.edges)))
    ok, saw = case.check(graph, nodes, edges)
    assert ok, f"{case.label}: {saw}"


# ─── What the fixture proved is still missing ───────────────────────────────
#
# These pass today by computing, in the test, what the engine does not. Kept as
# tests rather than as prose because the day one of them can be deleted is the
# day the gap closed, and a comment cannot tell you that.


def test_the_interest_profile_cannot_express_a_pair(mega):
    """Case 5's real limit, pinned.

    The profile is actor-scoped: every act an actor took, across every
    counterpart, in one bucket per interest. So State X being hostile to Y and
    warm to Z politically cancels to zero — right arithmetic, destroyed finding,
    because Case 5 is about a *pair*.
    """
    graph, _ = mega
    x = next(n for n in graph.nodes if n.name == "Directorate of Materiel Procurement")
    assert x.group_value.get("regulatory neutrality") == 0, (
        "if this is non-zero the profile grew a pair dimension — delete this "
        "test and un-block Case 5")


def test_magnitude_dominates_a_profile(mega):
    """A design consequence worth having in front of us.

    Profile weight is the occurrence's magnitude when it has one, so an
    uncalibrated 1–10 salience outvotes ten unweighted acts. Deliberate — a
    large act should pull harder — but `magnitude` is *not a measurement*
    (STATUS §5), and here a single `magnitude: 9` ruling swamps the regulator's
    stated position by 9:1.
    """
    graph, _ = mega
    r = next(n for n in graph.nodes if n.name == "Federal Procurement Review Board")
    assert r.group_value["regulatory neutrality"] == -8, (
        "one asserted neutrality (+1) minus one magnitude-9 ruling that opposed "
        "it (−9). The sign is the finding; the size is an artefact of an "
        "uncalibrated field.")


# ─── Frames — what can hold an axis ─────────────────────────────────────────


def test_every_frame_can_position_something(mega):
    """A frame with no fill is not an axis, and the control has to be able to
    say so *before* the click rather than after — the failure `anchors.ts`
    already names is "a mostly-empty map with a blob over the ocean"."""
    from app.api.modules.graph.stream import frame_coverage
    graph, _ = mega
    cov = frame_coverage(graph.nodes, graph.edges)
    assert set(cov) == {"time", "geo", "place_named", "interest", "event"}
    for frame, c in cov.items():
        assert c["have"] > 0, f"{frame} cannot position anything"
        assert c["have"] <= c["of"]
    # Time is the frame the ladder guarantees; the others are corpus-dependent.
    assert cov["time"]["have"] == cov["time"]["of"]


def test_interests_are_never_geocoded(mega):
    """A motive is not somewhere. Pinning one to a map would give an inference
    the visual authority of a verifiable fact."""
    graph, _ = mega
    interests = [n for n in graph.nodes if n.type == "Interest"]
    assert interests
    assert all(n.lat is None for n in interests)


def test_the_default_axis_budget_is_the_block():
    """geo takes the plane because it is the only frame whose coordinates are
    not our opinion; time takes the vertical because every node has one; the
    interest frame is left FREE, so an unpinned interest drifts to the
    spatiotemporal centre of what serves it and its POSITION becomes an answer.
    """
    from app.api.modules.annotation.panel_config import AxisBudget, GraphConfig
    b = GraphConfig().axes
    assert (b.plane, b.up, b.pin) == ("geo", "time", True)
    assert b.spent == 3, "geo is a plane; a 3-axis budget is exactly spent"
    assert set(b.free) == {"interest", "event"}


def test_the_budget_refuses_to_overspend():
    from app.api.modules.annotation.panel_config import AxisBudget
    with pytest.raises(ValueError):
        AxisBudget(plane="geo", up="geo")       # one frame, both slots
    # A 1D frame on the plane leaves room, which is how the field view works.
    assert AxisBudget(plane="interest", up="time").spent == 2


# ─── The panel's two surfaces, over the wire ────────────────────────────────


def test_an_unconfigured_panel_renders_the_whole_schema(db):
    """No projections, no triplet field, no axis config — and a graph.

    `_graph_source` used to raise here. The guard predated derived projections
    and refused the exact case they exist for; it stayed hidden only because
    the panel always sends a legacy `triplet_field` alongside, so anything that
    did not — the companion, an API caller — got an error instead of a graph.
    """
    from app.api.modules.annotation.formula import Formula
    from app.api.modules.annotation.formula_query import FormulaQuery
    from app.api.routes.annotation_runs import GraphParams, _graph_kwargs, _graph_meta

    ids = scenario.seed(db, owner_email="scenario-wire@local")

    class _Access:
        infospace_id = ids["infospace"]
        user_id = ids["user"]
        scope = None
        def __getattr__(self, k):  # noqa: D105
            return None

    fq = FormulaQuery(db, _Access(), [ids["run"]], Formula(id="f", name="f"))
    gp = GraphParams()
    gr = fq.graph_view(**_graph_kwargs(gp))
    assert len(gr.nodes) > 40

    meta = _graph_meta(fq, gp, gr)

    by_path = {l["path"]: l for l in meta["layers"]}
    assert len(by_path) == 9, sorted(by_path)

    # The counts are what makes an empty layer visible at a glance — the most
    # common reason a pane is blank and the least visible from the canvas.
    assert by_path["document.observations[*]"]["nodes"] > 0
    assert by_path["document.observations[*]"]["edges"] > 0
    assert by_path["document.relations[*]"]["edges"] > 0
    assert by_path["document.actors[*]"]["edges"] == 0, "a roster mints no edges"

    # `about` is resolved, not guessed — it is what decides whether a row
    # becomes a node, a property or a connection.
    assert by_path["document.actors[*]"]["about"] is None
    assert by_path["document.observations[*]"]["about"] == "self"
    assert by_path["document.attributes[*]"]["about"] == "subject"
    assert by_path["document.relations[*]"]["about"] == "between"
    assert by_path["document.evidence[*]"]["node_kind"] == "entity"

    assert set(meta["frames"]) == {"time", "geo", "place_named", "interest", "event"}


# ─── The place ladder's scalar mirror ───────────────────────────────────────


def test_a_place_is_at_itself(mega):
    """The document rung must never relocate a place that knows where it is.

    Every label a node carries is a geocoding lookup key, so whichever resolved
    last was writing the node's coordinate — and Trieste, mentioned in a filing
    *about* Friuli Venezia Giulia, was drawn at the region's centroid. The doc
    rung means "this is weakly about there"; it is not a whereabouts.
    """
    graph, _ = mega
    by = {n.name: n for n in graph.nodes}
    assert by["Trieste"].lat == pytest.approx(45.649, abs=0.01)
    assert by["Friuli Venezia Giulia"].lat == pytest.approx(46.164, abs=0.01)
    assert by["Trieste"].lat != by["Friuli Venezia Giulia"].lat


def test_an_occurrence_pins_at_its_own_site(mega):
    """The other half: something that is somewhere without BEING somewhere still
    needs a coordinate, or the geo frame has only places in it and the whole
    point of hard-pinning acts is lost."""
    graph, _ = mega
    shipment = next(n for n in graph.nodes
                    if n.kind == "occurrence" and n.name.startswith("shipment"))
    assert shipment.lat == pytest.approx(45.649, abs=0.01), "at Trieste, its `at`"


def test_the_scalar_mirrors_the_strongest_rung(mega):
    """`places` accumulates and disagreement between rungs is a finding — but
    `place`/`lat`/`lon` are single-valued, and mirroring `places[0]` mirrored
    *insertion order*, i.e. whichever annotation happened to stream first."""
    from app.api.modules.graph.stream import strongest_place
    from app.api.modules.graph.schemas import NodePlace

    mixed = [
        NodePlace(place="from the filing", source="doc"),
        NodePlace(place="the stated site", source="row"),
        NodePlace(place="a seat", source="attribute"),
    ]
    assert strongest_place(mixed).place == "the stated site"
    assert strongest_place(list(reversed(mixed))).place == "the stated site"


def test_every_place_in_the_fixture_is_real(mega):
    """Coordinates are neutral facts and an invented place name is useless — no
    provider can geocode "Capital-X", so the geo frame could only ever be filled
    by the curated table and never by the geocoding action a real corpus uses.
    Actors stay abstract; places do not."""
    graph, _ = mega
    places = [n for n in graph.nodes if n.type == "Location"]
    assert places
    assert all(n.lat is not None for n in places), \
        [n.name for n in places if n.lat is None]
    assert not any(n.name.startswith(("Capital-", "Sector-", "Territory-"))
                   for n in places)
