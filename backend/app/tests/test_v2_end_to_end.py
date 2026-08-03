"""The v2 vocabulary, from a generated contract to an assembled graph.

Every other test pins one seam. This one runs the whole chain the way a user
does — `templates.py` builds the contract and the projections, a realistic
annotation is written against it, and the graph comes out of the same engine
the panel calls. If the vocabulary and the engine ever disagree about what a
row means, this is where it shows.

The fixture is one court filing: two deposition lines and a payment, an exhibit
both lines cite, a named case they all belong to, a seat and a counsel tie.
"""
from __future__ import annotations

import asyncio

import pytest
from sqlmodel import text

from app.api.modules.annotation.panel_config import Projection
from app.api.modules.annotation.query import AnnotationQuery
from app.api.modules.annotation.templates import (
    build_contract, build_doc_anchors, build_projections,
)
from app.api.modules.graph.stream import AnnotationGraphSource, collect_graph

from app.tests.test_graph_stream import (  # noqa: F401 — fixture helpers
    _annotation, _asset, _infospace, _run, _schema_with, _user, db, pg_engine,
)

ARCHETYPES = ["statements", "citations", "seats", "memberships"]


def _ent(name: str, etype: str) -> dict:
    return {"name": name, "type": etype}


@pytest.fixture
def court_graph(db):
    """One filing, run through the shipped `testimony` template."""
    contract = build_contract("full", ARCHETYPES)
    uid = _user(db, "v2e2e")
    iid = _infospace(db, uid, "v2-e2e")
    sid = _schema_with(db, iid, uid, contract, "v2-testimony")
    asset = _asset(db, iid, uid, "filing")
    run = _run(db, iid, uid, "r")

    _annotation(db, iid, uid, run, sid, asset, {"document": {
        "actors": [_ent("Virginia Giuffre", "Person"),
                   _ent("Ghislaine Maxwell", "Person"),
                   _ent("Boies Schiller", "Organization")],
        "places": [_ent("New York", "Location"), _ent("London", "Location")],
        "instruments": [_ent("Acct 4471", "Account")],
        "interests": [_ent("legal_shielding", "Interest")],

        "events": [{
            "name": "15-cv-07433", "kind": "case",
            "when": "2015-09-21", "until": "2017-05-01",
            "at": _ent("New York", "Location"),
        }],

        "observations": [
            {   # a denial, citing an exhibit, inside the case
                "kind": "testimony",
                "by": [_ent("Ghislaine Maxwell", "Person")],
                "concerns": [_ent("Virginia Giuffre", "Person")],
                "at": _ent("New York", "Location"),
                "when": "2016-04-22",
                "covers_from": "2002-01-01", "covers_until": "2003-12-31",
                "modality": "denied",
                "cites": [_ent("Exhibit C", "Evidence")],
                "during": [_ent("15-cv-07433", "Event")],
                "justification": {"reasoning": "answered in the negative",
                                  "text_spans": [{"text_snippet": "I did not."}]},
            },
            {   # an assertion citing the SAME exhibit — degree over it is the point
                "kind": "testimony",
                "by": [_ent("Virginia Giuffre", "Person")],
                "concerns": [_ent("Ghislaine Maxwell", "Person")],
                "when": "2016-05-03",
                "modality": "asserted",
                "cites": [_ent("Exhibit C", "Evidence")],
                "during": [_ent("15-cv-07433", "Event")],
                "justification": {"text_spans": [{"text_snippet": "She was there."}]},
            },
            {   # a payment routed through an INSTRUMENT — the `via` union
                "kind": "payment",
                "by": [_ent("Boies Schiller", "Organization")],
                "to": [_ent("Virginia Giuffre", "Person")],
                "via": [_ent("Acct 4471", "Account")],
                "when": "2016-06-01", "magnitude": 25000,
                "modality": "done",
                "serves": [_ent("legal_shielding", "Interest")],
                "during": [_ent("15-cv-07433", "Event")],
            },
        ],

        "attributes": [{
            "subject": _ent("Boies Schiller", "Organization"),
            "kind": "seat", "place": _ent("New York", "Location"),
            "from": "2015-01-01",
        }],

        "relations": [{
            "from": _ent("Boies Schiller", "Organization"),
            "predicate": "represents",
            "to": _ent("Virginia Giuffre", "Person"),
            "from_date": "2015-09-21",
        }],

        "evidence": [{
            "name": "Exhibit C", "kind": "deposition", "stance": "contradicts",
            "locator": "p. 14", "quote": "flight manifest, 3 March",
        }],

        "at": _ent("New York", "Location"),
        "dated": "2016-06-15",
        "ref": "15-cv-07433",
    }})

    anchors = build_doc_anchors("full")
    aq = AnnotationQuery(db, iid).scope(None).runs([run])
    source = AnnotationGraphSource(
        query=aq,
        projections=[Projection(**p) for p in build_projections("full", ARCHETYPES)],
        doc_place=anchors["doc_place"], doc_time=anchors["doc_time"],
        # Panel-wide, so it needs the FULL path — a bare key resolves at the
        # annotation root, where there is no `modality`, and every edge comes
        # back ungrouped. Silent: the graph renders, and every denial paints
        # like an assertion.
        edge_group_by="document.observations[*].modality",
    )
    result = asyncio.run(collect_graph(
        db, iid, source, top_n_nodes=None, top_n_edges=None))
    return result


def _by_name(result):
    return {n.name: n for n in result.nodes}


# ─── The rosters and the linking payoff ─────────────────────────────────────


def test_a_name_used_in_three_rows_is_one_node(court_graph):
    """The whole point of rosters. Giuffre is in `actors`, in one row's `by`,
    another's `concerns`, and a payment's `to` — and is ONE node."""
    matches = [n for n in court_graph.nodes if n.name == "Virginia Giuffre"]
    assert len(matches) == 1, [n.type for n in matches]
    assert matches[0].kind == "entity"


def test_the_union_merges_an_instrument_into_a_via_slot(court_graph):
    """`via` refs [actors, instruments] and is typed Organization|…|Account.
    The account named in the roster and the one routing the payment are one."""
    accounts = [n for n in court_graph.nodes if n.name == "Acct 4471"]
    assert len(accounts) == 1
    assert accounts[0].type == "Account"


# ─── One array, many kinds ──────────────────────────────────────────────────


def test_node_type_comes_from_the_row(court_graph):
    """`node_type_path: kind` — one observations array, three acts, two types."""
    occ = {n.name: n.type for n in court_graph.nodes if n.kind == "occurrence"}
    assert sorted(set(occ.values())) == ["Event", "testimony", "payment"] or \
        sorted(set(occ.values())) == ["Event", "payment", "testimony"]
    assert "Observation" not in occ.values(), "the pinned fallback should not fire"


def test_the_generic_roles_become_named_edges(court_graph):
    """`by`/`to`/`via` are what make role-scoped degree a cross-domain query."""
    roles = {e.role for e in court_graph.edges}
    assert {"by", "to", "via", "concerns", "cites", "during", "serves"} <= roles


def test_via_degree_finds_the_instrument(court_graph):
    """The facilitator question, which before v2 worked only for transfers."""
    acct = _by_name(court_graph)["Acct 4471"]
    via_edges = [e for e in court_graph.edges
                 if e.role == "via" and e.target == acct.id]
    assert len(via_edges) == 1


# ─── The referent layer ─────────────────────────────────────────────────────


def test_the_event_is_one_node_identified_by_its_name(court_graph):
    ev = [n for n in court_graph.nodes if n.type == "Event"]
    assert len(ev) == 1
    assert ev[0].name == "15-cv-07433"
    assert ev[0].t0 == "2015-09-21"


def test_every_claim_that_named_the_case_converges_on_it(court_graph):
    """Three observations, one event — scattered facts shown to be one story."""
    ev = next(n for n in court_graph.nodes if n.type == "Event")
    during = [e for e in court_graph.edges if e.role == "during" and e.target == ev.id]
    assert len(during) == 3


# ─── Grounds ────────────────────────────────────────────────────────────────


def test_the_exhibit_is_an_entity_not_an_occurrence(court_graph):
    """It exists whether or not anyone cites it — `node_kind: entity`. Without
    this, `kind:occurrence` returns documents alongside the acts they ground."""
    ex = _by_name(court_graph)["flight manifest, 3 March"]
    assert ex.kind == "entity"
    assert ex.type == "Evidence"
    assert ex.properties == {"stance": "contradicts", "kind": "deposition",
                             "locator": "p. 14"}


def test_two_claims_citing_one_exhibit_give_it_degree_two(court_graph):
    """The forward citation, and the reason an exhibit gets a name at all."""
    ex = _by_name(court_graph)["flight manifest, 3 March"]
    cites = [e for e in court_graph.edges if e.role == "cites" and e.target == ex.id]
    assert len(cites) == 2


def test_the_quote_rides_on_the_row_it_grounds(court_graph):
    denial = next(n for n in court_graph.nodes
                  if n.type == "testimony" and n.properties.get("modality") == "denied")
    assert denial.evidence[0]["text_spans"][0]["text_snippet"] == "I did not."


def test_modality_reaches_the_node_and_splits_the_edges(court_graph):
    """Load-bearing twice: the evidence pane reads it as a stance, and
    `edge_group_by: modality` paints a denial differently from an assertion."""
    kinds = {n.properties.get("modality") for n in court_graph.nodes
             if n.type == "testimony"}
    assert kinds == {"denied", "asserted"}
    assert {"denied", "asserted"} <= {e.group_value for e in court_graph.edges}


# ─── The two clocks, and the ladders ────────────────────────────────────────


def test_the_second_clock_is_separate_from_the_first(court_graph):
    """A 2016 deposition describing 2002 — the cursor scrubs one, bars span
    the other. Collapsing them is what makes a timeline lie."""
    denial = next(n for n in court_graph.nodes
                  if n.type == "testimony" and n.properties.get("modality") == "denied")
    assert denial.t0 == "2016-04-22"
    assert denial.a0 == "2002-01-01" and denial.a1 == "2003-12-31"


def test_participants_inherit_nothing_from_the_rows_they_appear_in(court_graph):
    """The scoping fix. A person's interval must not be the union of every act
    they were ever named in.

    She still gets the FILING's date — that is the document rung doing its job,
    and the two rules are different: a row's date is the row's, a document's
    date is a fallback for anything that has none.
    """
    maxwell = _by_name(court_graph)["Ghislaine Maxwell"]
    assert maxwell.t0 != "2016-04-22", "took the deposition row's own date"
    assert maxwell.t0 == "2016-06-15", "should fall back to the filing date"


def test_the_document_rung_places_and_dates_what_has_nothing_of_its_own(court_graph):
    """A filing about New York, dated 2016 — the weakest step of both ladders."""
    maxwell = _by_name(court_graph)["Ghislaine Maxwell"]
    assert [(p.place, p.source) for p in maxwell.places] == [("New York", "doc")]

    # An undated actor inherits the filing's date rather than falling out of
    # the timeline; a row with its own date keeps it (see the test above).
    payment = next(n for n in court_graph.nodes if n.type == "payment")
    assert payment.t0 == "2016-06-01"


def test_an_attribute_writes_onto_its_subject_and_mints_nothing(court_graph):
    """A seat is a property, not a thing that happened."""
    firm = _by_name(court_graph)["Boies Schiller"]
    seats = [p for p in firm.places if p.source == "attribute"]
    assert [(p.place, p.kind) for p in seats] == [("New York", "seat")]
    assert firm.kind == "entity"


def test_a_relation_is_an_edge_and_not_a_node(court_graph):
    rep = [e for e in court_graph.edges if e.predicate == "represents"]
    assert len(rep) == 1
    assert not any(n.type == "represents" for n in court_graph.nodes)


# ─── A schema in the pattern graphs itself ──────────────────────────────────


def _derived():
    from app.api.modules.annotation.panel_config import (
        GraphConfig, derive_doc_anchors, resolve_projections,
    )
    from app.api.modules.annotation.schema_map import schema_map_for
    smap = schema_map_for(build_contract("full", ARCHETYPES))
    # No projections declared — exactly what a panel configured through the
    # legacy axis popover (or not configured at all) hands the engine.
    return (
        {p.path: p for p in resolve_projections(GraphConfig(), smap=smap)},
        derive_doc_anchors(smap),
    )


def test_an_unconfigured_panel_projects_every_section():
    """The legacy fallback synthesised exactly ONE projection over
    `cfg.source`, so a v2 schema showed one array and silently dropped the
    rosters, the events and the evidence — the whole point of the schema."""
    by_path, _ = _derived()
    assert set(by_path) == {
        "document.actors[*]", "document.places[*]", "document.instruments[*]",
        "document.interests[*]", "document.events[*]", "document.observations[*]",
        "document.attributes[*]", "document.relations[*]", "document.evidence[*]",
    }


def test_about_comes_from_the_section_name():
    """The model's own rule (HANDOVER §6). It is also the only way to get
    `attributes` right — a property row is never inferable from shape, because
    `{who, place, from, to}` is structurally identical to an encounter."""
    by_path, _ = _derived()
    assert by_path["document.observations[*]"].about == "self"
    assert by_path["document.events[*]"].about == "self"
    assert by_path["document.evidence[*]"].about == "self"
    assert by_path["document.attributes[*]"].about == "subject"
    assert by_path["document.relations[*]"].about == "between"


def test_rosters_stay_rosters():
    """Roles are resolved BEFORE `about` is inferred — a roster is only
    recognisable as one once its single empty-path role exists. Inferring in
    the other order made every roster an occurrence."""
    by_path, _ = _derived()
    for r in ("actors", "places", "instruments", "interests"):
        p = by_path[f"document.{r}[*]"]
        assert p.about is None, r
        assert len(p.nodes) == 1 and not p.nodes[0].path, r


def test_the_derived_bindings_are_the_ones_the_template_ships():
    by_path, _ = _derived()
    obs = by_path["document.observations[*]"]
    assert obs.node_type_path == "kind"
    assert obs.time and obs.time.start == "when"
    assert obs.activity and obs.activity.start == "covers_from"   # the 2nd clock
    assert obs.place_binding and obs.place_binding.at == "at.name"
    assert obs.weight == "magnitude"
    assert obs.evidence and obs.evidence.path == "justification"

    ev = by_path["document.evidence[*]"]
    assert ev.node_kind == "entity"      # an exhibit did not happen
    assert ev.nodes == []                # it relates to nothing until cited


def test_the_document_rung_is_derived_too():
    """The weakest rung, and on the first real run the only reason 12 of 14
    statements had a timestamp — the model had written "Wednesday"."""
    _, anchors = _derived()
    assert anchors == {"doc_place": "document.at.name", "doc_time": "document.dated"}


def test_an_explicit_projection_still_wins():
    from app.api.modules.annotation.panel_config import (
        GraphConfig, Projection, resolve_projections,
    )
    from app.api.modules.annotation.schema_map import schema_map_for
    smap = schema_map_for(build_contract("full", ARCHETYPES))
    out = resolve_projections(
        GraphConfig(projections=[Projection(path="document.observations[*]")]),
        smap=smap)
    assert [p.path for p in out] == ["document.observations[*]"]


# ─── The label an occurrence reads under ────────────────────────────────────
#
# Identity and display are separate concerns, and the template got the display
# half wrong: `node_label: "kind"` is the same string the node's *type* already
# carries, so every act in a section rendered under one word. On run #12424 the
# items pane offered two rows, "testimony" and "statement", and neither told you
# anything the type column did not.


def test_an_occurrence_is_labelled_by_who_was_in_it(court_graph):
    labels = {n.name for n in court_graph.nodes if n.kind == "occurrence"}
    assert "payment · Boies Schiller → Virginia Giuffre · 2016-06-01" in labels
    # Two testimonies, same kind, DIFFERENT labels — the thing `kind` could
    # never give us. And no dangling arrow where `to` is empty: an arrow claims
    # a relationship between two participants, so a run of joiners collapses to
    # the dot rather than leaving `Maxwell → 2016-04-22`.
    assert "testimony · Ghislaine Maxwell · 2016-04-22" in labels
    assert "testimony · Virginia Giuffre · 2016-05-03" in labels
    assert not any("→ 2016" in l for l in labels), "an arrow pointing at a date"


def test_an_empty_role_leaves_no_dangling_separator():
    """`"{kind} · {by} → {to}"` on a row with no `to` must not render an arrow
    pointing at nothing. Handled by cleaning the ends rather than by growing
    conditional syntax for the template, which would make it a language."""
    from app.api.modules.graph.stream import _label_alias, _render_label
    from app.api.modules.annotation.panel_config import NodeRole

    per_role = [
        (NodeRole(path="by", label="by"), [("Maxwell", "Person")]),
        (NodeRole(path="to", label="to"), []),
    ]
    # `kind` is the only NON-role token, so it is the row's column 0. Read the
    # alias from the helper rather than hardcoding it — that is the same
    # coupling the two production callers have.
    row = type("_Row", (), {_label_alias("kind", 0): "testimony"})()

    assert _render_label(row, "{kind} · {by} → {to}", per_role) \
        == "testimony · Maxwell"


def test_a_role_token_is_not_selected_as_a_column():
    """The two callers must filter identically — the alias is positional, so a
    role left in the list shifts every column after it onto the wrong value."""
    from app.api.modules.graph.stream import _label_fields
    assert _label_fields("{kind} · {by} → {to}", ["by", "to", "at"]) == ["kind"]
    assert _label_fields("{kind} · {by}", []) == ["kind", "by"]


# ─── The asset rung — the bottom of the time ladder ─────────────────────────


def test_the_asset_timestamp_dates_what_the_document_never_dated(db):
    """`TimeBinding`'s docstring promised a four-rung ladder ending at
    `asset.event_timestamp`; the code stopped at three.

    On run #12424 the model left `document.dated` empty, so **every node in the
    graph was untimed** — no scrubber, no activity bars, no lanes — over a
    corpus whose two assets carry exact publication timestamps. We were asking a
    model for a date the database already had.

    `event_timestamp` only, never `created_at`: when we ingested a 1970s memo
    says nothing about the memo.
    """
    contract = build_contract("full", ARCHETYPES)
    uid = _user(db, "assetrung")
    iid = _infospace(db, uid, "asset-rung")
    sid = _schema_with(db, iid, uid, contract, "ar-testimony")
    asset = _asset(db, iid, uid, "undated filing")
    db.execute(text("UPDATE asset SET event_timestamp = :ts WHERE id = :i"),
               {"ts": "2026-07-15T18:08:15", "i": asset})
    run = _run(db, iid, uid, "r")

    _annotation(db, iid, uid, run, sid, asset, {"document": {
        "actors": [_ent("Todd Blanche", "Person")],
        "observations": [{
            "kind": "testimony",
            "by": [_ent("Todd Blanche", "Person")],
            "when": "",          # ← "Wednesday", discarded upstream
        }],
        "dated": "",             # ← the model declined rung 3
    }})

    anchors = build_doc_anchors("full")
    aq = AnnotationQuery(db, iid).scope(None).runs([run])
    result = asyncio.run(collect_graph(db, iid, AnnotationGraphSource(
        query=aq,
        projections=[Projection(**p) for p in build_projections("full", ARCHETYPES)],
        doc_place=anchors["doc_place"], doc_time=anchors["doc_time"],
    ), top_n_nodes=None, top_n_edges=None))

    assert result.nodes, "nothing assembled"
    assert all(n.t0 for n in result.nodes), \
        f"untimed: {[n.name for n in result.nodes if not n.t0]}"
    assert all(n.t0.startswith("2026-07-15") for n in result.nodes)


def test_a_stated_document_date_still_outranks_the_asset(db):
    """Rung 3 is a claim about the document and rung 4 is a fact about the file.
    The claim is the more specific of the two and must win where it exists —
    a filing published today can be dated last March, and it is."""
    contract = build_contract("full", ARCHETYPES)
    uid = _user(db, "rung3wins")
    iid = _infospace(db, uid, "rung3-wins")
    sid = _schema_with(db, iid, uid, contract, "r3-testimony")
    asset = _asset(db, iid, uid, "filing scraped late")
    db.execute(text("UPDATE asset SET event_timestamp = :ts WHERE id = :i"),
               {"ts": "2026-07-15T18:08:15", "i": asset})
    run = _run(db, iid, uid, "r")

    _annotation(db, iid, uid, run, sid, asset, {"document": {
        "actors": [_ent("Todd Blanche", "Person")],
        "dated": "2016-03-04",
    }})

    anchors = build_doc_anchors("full")
    aq = AnnotationQuery(db, iid).scope(None).runs([run])
    result = asyncio.run(collect_graph(db, iid, AnnotationGraphSource(
        query=aq,
        projections=[Projection(**p) for p in build_projections("full", ARCHETYPES)],
        doc_place=anchors["doc_place"], doc_time=anchors["doc_time"],
    ), top_n_nodes=None, top_n_edges=None))

    blanche = _by_name(result)["Todd Blanche"]
    assert blanche.t0.startswith("2016-03-04")


def test_a_rows_own_date_still_outranks_both(db):
    """The ladder only ever fills what is empty. A row that dated itself keeps
    its date — unioning the document's in would stretch every node to the
    filing date and quietly make the slider lie."""
    contract = build_contract("full", ARCHETYPES)
    uid = _user(db, "rowwins")
    iid = _infospace(db, uid, "row-wins")
    sid = _schema_with(db, iid, uid, contract, "rw-testimony")
    asset = _asset(db, iid, uid, "filing")
    db.execute(text("UPDATE asset SET event_timestamp = :ts WHERE id = :i"),
               {"ts": "2026-07-15T18:08:15", "i": asset})
    run = _run(db, iid, uid, "r")

    _annotation(db, iid, uid, run, sid, asset, {"document": {
        "actors": [_ent("Todd Blanche", "Person")],
        "observations": [{
            "kind": "testimony",
            "by": [_ent("Todd Blanche", "Person")],
            "when": "2016-04-22",
        }],
    }})

    anchors = build_doc_anchors("full")
    aq = AnnotationQuery(db, iid).scope(None).runs([run])
    result = asyncio.run(collect_graph(db, iid, AnnotationGraphSource(
        query=aq,
        projections=[Projection(**p) for p in build_projections("full", ARCHETYPES)],
        doc_place=anchors["doc_place"], doc_time=anchors["doc_time"],
    ), top_n_nodes=None, top_n_edges=None))

    occ = [n for n in result.nodes if n.kind == "occurrence"]
    assert occ and occ[0].t0.startswith("2016-04-22")
    # …while the actor, who has no date of his own, inherits the asset's.
    assert _by_name(result)["Todd Blanche"].t0.startswith("2026-07-15")


# ─── The orderings — what makes a frame zoomable ────────────────────────────
#
# Position can only come from four spaces: time, geo, interest and event. Three
# of the four need a HIERARCHY to be zoomable or orderable, and the contract
# supplied marks without them — `serves:X+` walked a `subsumes` edge no prompt
# had ever produced. These pin that the orderings are now both declarable and
# reach the graph as edges.


@pytest.fixture
def ordered_graph(db):
    """One filing that states its hierarchies: a hearing inside a case, an
    interest that advances another, a city inside a country."""
    contract = build_contract("full", ARCHETYPES)
    uid = _user(db, "orderings")
    iid = _infospace(db, uid, "orderings")
    sid = _schema_with(db, iid, uid, contract, "ord-testimony")
    asset = _asset(db, iid, uid, "filing")
    run = _run(db, iid, uid, "r")

    _annotation(db, iid, uid, run, sid, asset, {"document": {
        "actors": [_ent("Boies Schiller", "Organization")],
        "places": [_ent("Valletta", "Location"), _ent("Malta", "Location")],
        "interests": [_ent("legal_shielding", "Interest"),
                      _ent("reputational_defence", "Interest")],

        "events": [
            {"name": "15-cv-07433", "kind": "case", "when": "2015-09-21"},
            {"name": "the 4 March hearing", "kind": "case", "when": "2016-03-04",
             "within": _ent("15-cv-07433", "Event")},
            {"name": "the 9 May hearing", "kind": "case", "when": "2016-05-09",
             "within": _ent("15-cv-07433", "Event"),
             "follows": _ent("the 4 March hearing", "Event")},
        ],

        "observations": [{
            "kind": "testimony",
            "by": [_ent("Boies Schiller", "Organization")],
            "when": "2016-03-04",
            "at": _ent("Valletta", "Location"),
            "serves": [_ent("legal_shielding", "Interest")],
            "during": [_ent("the 4 March hearing", "Event")],
        }],

        "relations": [
            # Containment across two rosters, and advancement inside one. Both
            # were undeclarable before: `from`/`to` referenced `actors` alone.
            {"from": _ent("Valletta", "Location"), "predicate": "part_of",
             "to": _ent("Malta", "Location")},
            {"from": _ent("legal_shielding", "Interest"), "predicate": "furthers",
             "to": _ent("reputational_defence", "Interest")},
        ],
        "dated": "2016-06-15",
    }})

    anchors = build_doc_anchors("full")
    aq = AnnotationQuery(db, iid).scope(None).runs([run])
    return asyncio.run(collect_graph(db, iid, AnnotationGraphSource(
        query=aq,
        projections=[Projection(**p) for p in build_projections("full", ARCHETYPES)],
        doc_place=anchors["doc_place"], doc_time=anchors["doc_time"],
    ), top_n_nodes=None, top_n_edges=None))


def test_an_event_nests_inside_another(ordered_graph):
    """`within` is the frame primitive — one field name, one meaning, in every
    frame that has one. Zoom-out is "walk `within` one level"."""
    by = _by_name(ordered_graph)
    case, hearing = by["15-cv-07433"], by["the 4 March hearing"]
    assert any(e.role == "within" and e.source == hearing.id and e.target == case.id
               for e in ordered_graph.edges)


def test_events_carry_a_sequence(ordered_graph):
    """`follows` orders undated events and, more importantly, orders events
    whose dates do not: a filing follows a complaint filed the same day."""
    by = _by_name(ordered_graph)
    first, second = by["the 4 March hearing"], by["the 9 May hearing"]
    assert any(e.role == "follows" and e.source == second.id and e.target == first.id
               for e in ordered_graph.edges)


def test_a_place_nests_inside_a_place(ordered_graph):
    """Containment for the geo frame. It lives in `relations` rather than as a
    field on the roster item because an entity slot is a closed {name, type}
    shape — ``schema_map`` does not walk into one, so a `within` field there
    would be extracted and then reach nothing."""
    by = _by_name(ordered_graph)
    assert any(
        e.predicate == "part_of"
        and e.source == by["Valletta"].id and e.target == by["Malta"].id
        for e in ordered_graph.edges
    ), [(e.source, e.predicate, e.target) for e in ordered_graph.edges]


def test_one_interest_furthers_another(ordered_graph):
    """The vector. Advancement, not containment — and the ordering a document
    will actually state."""
    by = _by_name(ordered_graph)
    assert any(
        e.predicate == "furthers"
        and e.source == by["legal_shielding"].id
        and e.target == by["reputational_defence"].id
        for e in ordered_graph.edges
    )


def test_serves_rolls_up_through_furthers(ordered_graph):
    """The payoff, and the thing that was silently broken: `serves:X+` walks
    `_SUBSUMES`, which knew only containment. An act serving a narrow goal must
    surface when you ask about the goal it advances."""
    from app.api.modules.graph import gql
    q = gql.parse("serves:reputational_defence+")
    nodes, _ = gql.apply_to_graph(q, list(ordered_graph.nodes), list(ordered_graph.edges))
    names = {n.name for n in nodes}
    assert "Boies Schiller" in names, (
        "the actor whose act serves the narrower interest should roll up")

    plain = gql.parse("serves:reputational_defence")
    only, _ = gql.apply_to_graph(plain, list(ordered_graph.nodes), list(ordered_graph.edges))
    assert "Boies Schiller" not in {n.name for n in only}, (
        "without `+` the rollup must not happen, or the flag means nothing")


# ─── Valence — the signed interest profile ──────────────────────────────────


@pytest.fixture
def valence_graph(db):
    """Three actors and one interest. A pursues it, B pursues it, C works
    against it. Before `opposes`, all three looked identical."""
    contract = build_contract("full", ARCHETYPES)
    uid = _user(db, "valence")
    iid = _infospace(db, uid, "valence")
    sid = _schema_with(db, iid, uid, contract, "val-testimony")
    asset = _asset(db, iid, uid, "wire copy")
    run = _run(db, iid, uid, "r")

    _annotation(db, iid, uid, run, sid, asset, {"document": {
        "actors": [_ent("A", "Organization"), _ent("B", "Organization"),
                   _ent("C", "Organization")],
        "interests": [_ent("market_access", "Interest")],
        "observations": [
            {"kind": "filing", "by": [_ent("A", "Organization")],
             "serves": [_ent("market_access", "Interest")], "when": "2016-01-01"},
            {"kind": "filing", "by": [_ent("B", "Organization")],
             "serves": [_ent("market_access", "Interest")], "when": "2016-02-01"},
            {"kind": "filing", "by": [_ent("C", "Organization")],
             "opposes": [_ent("market_access", "Interest")], "when": "2016-03-01"},
        ],
        "dated": "2016-06-15",
    }})

    aq = AnnotationQuery(db, iid).scope(None).runs([run])
    return asyncio.run(collect_graph(db, iid, AnnotationGraphSource(
        query=aq,
        projections=[Projection(**p) for p in build_projections("full", ARCHETYPES)],
        node_group_by="neighbours:Interest",
    ), top_n_nodes=None, top_n_edges=None))


def test_opposing_an_interest_subtracts_from_the_profile(valence_graph):
    """A profile built by counting cannot tell pursuing a goal from frustrating
    it. Signing it is what makes an adversary distinguishable from an ally —
    and from a stranger, who has no entry at all."""
    by = _by_name(valence_graph)
    assert by["A"].group_value == {"market_access": 1.0}
    assert by["B"].group_value == {"market_access": 1.0}
    assert by["C"].group_value == {"market_access": -1.0}


def test_the_residual_reads_opposition_as_negative(valence_graph):
    """Cosine over signed vectors spans [-1, 1]: allies positive, adversaries
    negative. `converge>` therefore keeps meaning what it always meant, and
    opposition becomes expressible rather than invisible."""
    from app.api.modules.graph import gql
    prof = {n.name: gql._profile_of(n) for n in valence_graph.nodes}
    assert gql._cosine(prof["A"], prof["B"]) == pytest.approx(1.0)
    assert gql._cosine(prof["A"], prof["C"]) == pytest.approx(-1.0)


def test_pursuing_and_opposing_one_interest_nets_to_nothing(db):
    """Ambivalence is the honest reading, and a zero entry is dropped: it is no
    information, not a weak signal."""
    from app.api.modules.graph import gql
    contract = build_contract("full", ARCHETYPES)
    uid = _user(db, "ambivalent")
    iid = _infospace(db, uid, "ambivalent")
    sid = _schema_with(db, iid, uid, contract, "amb-testimony")
    asset = _asset(db, iid, uid, "wire copy")
    run = _run(db, iid, uid, "r")
    _annotation(db, iid, uid, run, sid, asset, {"document": {
        "actors": [_ent("D", "Organization")],
        "interests": [_ent("market_access", "Interest")],
        "observations": [
            {"kind": "filing", "by": [_ent("D", "Organization")],
             "serves": [_ent("market_access", "Interest")], "when": "2016-01-01"},
            {"kind": "filing", "by": [_ent("D", "Organization")],
             "opposes": [_ent("market_access", "Interest")], "when": "2016-02-01"},
        ],
    }})
    aq = AnnotationQuery(db, iid).scope(None).runs([run])
    g = asyncio.run(collect_graph(db, iid, AnnotationGraphSource(
        query=aq,
        projections=[Projection(**p) for p in build_projections("full", ARCHETYPES)],
        node_group_by="neighbours:Interest",
    ), top_n_nodes=None, top_n_edges=None))

    d = _by_name(g)["D"]
    assert d.group_value == {"market_access": 0.0}
    assert gql._profile_of(d) is None, "a cancelled entry is not a weak signal"


def test_a_run_of_joiners_collapses_to_one(court_graph):
    """An empty token in the MIDDLE of a template leaves two adjacent joiners,
    and trimming only the ends never reaches it — `payment · P2 → · 2016-01-12`
    when `to` is blank. Only `·` and `→` collapse: `-` is structural at a
    label's edge and a legitimate character inside one, so including it turned
    `2016-01-12` into `2016- 01- 12`."""
    from app.api.modules.graph.stream import _tidy_label
    # The dot wins: an arrow claims a relationship between two participants,
    # so keeping it would read as though the date were the recipient.
    assert _tidy_label("arms_transfer · Unit-7 →  · 2016-08-05") \
        == "arms_transfer · Unit-7 · 2016-08-05"
    assert _tidy_label("payment · P2 → Shell S1 · 2016-01-12") \
        == "payment · P2 → Shell S1 · 2016-01-12"
    assert _tidy_label("statement ·  · ") == "statement"


def test_repeated_acts_get_distinguishable_labels(court_graph):
    """A repeating method — the exact thing Case 2 hunts for — produces many
    rows with identical participants. Without the date they collapse to a
    handful of labels on the canvas and are unreadable in a list."""
    occ = [n for n in court_graph.nodes if n.kind == "occurrence"]
    names = [n.name for n in occ]
    assert len(names) == len(set(names)), \
        f"{len(names) - len(set(names))} occurrences share a label"
