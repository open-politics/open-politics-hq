"""Addressing, scope and the row table.

Every case here is a rule from ``docs/plans/observation-model/MVP.md`` that was
measured broken on run 15010 before it was written down. The numbers in the
docstrings are the observed failures, kept so a regression reads as the thing it
actually breaks rather than as an assertion changing.
"""
from __future__ import annotations

import pytest

from app.api.modules.annotation.panel_config import NodeRole, Projection
from app.api.modules.graph import gql, rows

SECTIONS = frozenset({"observations", "places", "actors", "interests"})


def _clauses(q: str, section: str) -> list[str]:
    return gql.row_predicate_sql(
        gql.parse(q), "NULL", section=section, sections=SECTIONS,
    )[0]


# ── The `:` operator ──────────────────────────────────────────────────────────


def test_colon_filters_rows_for_an_unreserved_key():
    """``modality:done`` returned 0 nodes: `:` was not a row operator, so the
    most natural spelling in the language became a substring search on node
    names and emptied the canvas without saying anything."""
    q = gql.parse("modality:done")
    assert [(c.key, c.op, c.value) for c in q.row_conditions] == [
        ("modality", "==", "done"),
    ]
    assert q.text == ""


def test_colon_and_equals_are_one_operator():
    assert gql.parse("modality:done").row_conditions == \
        gql.parse("modality==done").row_conditions


@pytest.mark.parametrize("token,attr", [
    ("type:Person", "types"),
    ("kind:occurrence", "kinds"),
    ("role:via", "roles"),
    ("predicate:funds", "predicates"),
])
def test_reserved_prefixes_keep_their_meaning(token, attr):
    """`:` becoming an operator must not demote the reserved vocabulary."""
    q = gql.parse(token)
    assert getattr(q, attr)
    assert not q.row_conditions


def test_malformed_reserved_prefix_stays_visible():
    """`hops:2-orgin` is a typo in a RESERVED token. Reinterpreting it as a
    filter on a field called `hops` would be a second silent misreading."""
    q = gql.parse('from:"X" hops:2-orgin')
    assert q.hops is None
    assert "hops:2-orgin" in q.text
    assert not q.row_conditions


# ── Addressing ────────────────────────────────────────────────────────────────


def test_qualified_path_addresses_only_its_own_section():
    """`observations.magnitude>1e5` evaluated against `places` compiles to
    ``NULL > 100000`` — false for every row — so filtering one section deleted
    five. Measured: 102 nodes → 24."""
    assert _clauses("observations.magnitude>100000", "observations")
    assert _clauses("observations.magnitude>100000", "places") == []


def test_unqualified_condition_is_silent_about_sections_without_the_field():
    """A filter narrows what it can speak about. A row that never mentions the
    key is out of scope, not a non-match."""
    for section in ("observations", "places"):
        (clause,) = _clauses("magnitude>100000", section)
        assert "NOT (elem ? 'magnitude')" in clause


def test_section_qualified_condition_stays_strict():
    """Naming the section is what says you mean all of it — so an observation
    with no magnitude does drop, unlike the unqualified case above."""
    (clause,) = _clauses("observations.magnitude>100000", "observations")
    assert "NOT (elem ?" not in clause


def test_star_is_optional_in_a_path():
    """`by[*].type` and `by.type` are one path: whether a segment explodes is a
    property of the data, not of how someone spelled it."""
    a = _clauses("observations.by[*].type:Person", "observations")
    b = _clauses("observations.by.type:Person", "observations")
    assert a == b
    assert "jsonb_path_exists" in a[0]
    assert "$.by.type" in a[0]


def test_nested_path_binds_its_value():
    """The jsonpath is inlined (it cannot be a bind parameter), so the VALUE
    must be bound and the path shape restricted instead."""
    clauses, params = gql.row_predicate_sql(
        gql.parse('observations.serves.name:"nominee structuring"'),
        "NULL", section="observations", sections=SECTIONS,
    )
    assert "nominee structuring" not in clauses[0]
    assert "nominee structuring" in params.values()


def test_a_path_segment_that_is_not_an_identifier_is_refused():
    """The jsonpath is inlined, so its SHAPE is what has to be restricted.

    Exercised through ``_row_accessor`` directly: the tokenizer's key charset
    already rejects most of this, and a test that passes because the token never
    arrived proves nothing about the guard it claims to check.
    """
    hostile = gql.RowCondition(key="observations.by'; DROP TABLE x--.type",
                               op="==", value="P")
    assert gql._row_accessor(hostile, "observations", SECTIONS) is None
    safe = gql.RowCondition(key="observations.by.type", op="==", value="P")
    assert gql._row_accessor(safe, "observations", SECTIONS) == "$.by.type"


def test_bare_section_name_addresses_no_field():
    """`SECTION:` restricts which sections are read; a section name in a
    comparison must not silently become a column."""
    assert _clauses("observations:anything", "observations") == []


# ── ANY(…) at tier 1 ──────────────────────────────────────────────────────────


def test_any_unions_its_branches_row_conditions():
    """`ANY(observations.kind:payment, observations.kind:statement)` returned
    all 102 nodes of run 15010: the alternatives' row halves were dropped, so a
    union silently widened to the whole graph — indistinguishable from a correct
    broad answer."""
    (clause,) = _clauses(
        "ANY(observations.kind:payment, observations.kind:statement)",
        "observations",
    )
    assert clause.startswith("((") and " OR " in clause


def test_any_with_a_branch_that_has_no_row_scope_does_not_filter_rows():
    """`ANY(type:Person, observations.kind:payment)` is decided after assembly.
    Filtering rows here would delete the very rows the Person branch needs."""
    assert _clauses("ANY(type:Person, observations.kind:payment)", "observations") == []


def test_any_branch_addressed_elsewhere_leaves_this_section_alone():
    assert _clauses(
        "ANY(observations.kind:payment, observations.kind:statement)", "places",
    ) == []


# ── Notes ─────────────────────────────────────────────────────────────────────


def test_reserved_kind_colliding_with_a_field_is_reported():
    """`kind:` means occurrence|entity, and the observation model's contracts
    state an act's type in a field literally called `kind`. The most natural
    query on that data returns an empty canvas that looks like a true negative."""
    q = gql.parse("kind:payment")
    assert q.kinds == ["payment"]
    assert any("kind:payment" in n for n in q.notes)
    assert any("observations.kind" in n or "<section>.kind" in n for n in q.notes)
    assert any("type:payment" in n for n in q.notes)


def test_a_real_node_kind_is_not_reported():
    assert gql.parse("kind:occurrence").notes == []


# ── Columns ───────────────────────────────────────────────────────────────────


def _proj(**kw) -> Projection:
    return Projection(path="document.observations[*]", **kw)


def test_roles_become_columns_under_their_own_names():
    """"Halász → Corvus via a/c 8820" reads; three columns called
    "participant" do not, and the model was asked for the distinction."""
    p = _proj(nodes=[NodeRole(path="by"), NodeRole(path="to"), NodeRole(path="via")])
    cols = rows.columns_for(p, [])
    assert [c.key for c in cols] == ["by", "to", "via"]
    assert all(c.ref == "entity" for c in cols)


def test_a_roster_row_is_its_own_entity():
    """An empty role path means the element IS the entity. Emitting a column
    called "self" produced an empty column while the entity's own `name` came
    back marked as inferred — the one fully declared section, reported as a
    guess."""
    p = Projection(path="document.places[*]", nodes=[NodeRole(path="")])
    cols = rows.columns_for(p, [{"name": "Trieste", "type": "Location"}])
    assert [c.key for c in cols] == [rows._SELF]
    cells = rows.cells_for(
        {"name": "Trieste", "type": "Location"}, cols, lambda n, t: "nid",
    )
    assert cells[rows._SELF] == {
        "name": "Trieste", "type": "Location", "nodeId": "nid",
    }


def test_undeclared_keys_are_shown_but_marked():
    """S5 — nothing the data contains is hidden by default. But a column the
    engine guessed must not look as authoritative as one the schema stated."""
    cols = rows.columns_for(_proj(nodes=[NodeRole(path="by")]), [{"tone": "hostile"}])
    by_key = {c.key: c for c in cols}
    assert by_key["by"].source == "declared"
    assert by_key["tone"].source == "shape"


def test_show_selects_and_orders():
    p = _proj(nodes=[NodeRole(path="by"), NodeRole(path="to")], weight="magnitude")
    cols = rows.columns_for(p, [], show=["magnitude", "by"])
    assert [c.key for c in cols] == ["magnitude", "by"]


def test_show_reaches_inside_a_column():
    """`SHOW:by.name` asks for the payer's NAME, not for the payer.

    Truncating it to its last segment matched nothing on observations, so the
    column was silently dropped and the table fell back to showing everything —
    the reader asked one question and got twenty columns."""
    p = _proj(nodes=[NodeRole(path="by")])
    rows_in = [{"by": [{"name": "Halász", "type": "Person"}]}]
    cols = rows.columns_for(p, rows_in, show=["by.name"])
    assert [c.key for c in cols] == ["by.name"]
    assert rows.cells_for(rows_in[0], cols, None) == {"by.name": ["Halász"]}


def test_show_accepts_the_section_prefix_at_any_depth():
    p = _proj(nodes=[NodeRole(path="by")])
    rows_in = [{"by": [{"name": "Halász", "type": "Person"}]}]
    a = rows.columns_for(p, rows_in, show=["observations.by.name"])
    b = rows.columns_for(p, rows_in, show=["by.name"])
    assert [c.key for c in a] == [c.key for c in b] == ["by.name"]


def test_a_derived_column_reports_what_it_found():
    """Nothing declared it — it is an address someone wrote, so the only honest
    description is what came back."""
    p = _proj(nodes=[NodeRole(path="by")])
    rows_in = [{"by": [{"name": "A", "type": "Person"}]}]
    (col,) = rows.columns_for(p, rows_in, show=["by.type"])
    assert col.source == "shape"


def test_show_accepts_a_qualified_column():
    """The addressing grammar cannot be true in filters and false in
    projections."""
    p = _proj(nodes=[NodeRole(path="by")])
    assert [c.key for c in rows.columns_for(p, [], show=["observations.by"])] == ["by"]


def test_a_multi_valued_cell_stays_one_cell():
    """Exploding a projection multiplies rows and makes every count downstream
    a lie. A payment with two payers is one payment."""
    cols = rows.columns_for(_proj(nodes=[NodeRole(path="by")]), [])
    cells = rows.cells_for(
        {"by": [{"name": "A", "type": "Person"}, {"name": "B", "type": "Person"}]},
        cols, lambda n, t: f"id-{n}",
    )
    assert cells["by"] == [
        {"name": "A", "type": "Person", "nodeId": "id-A"},
        {"name": "B", "type": "Person", "nodeId": "id-B"},
    ]


def test_grounds_never_become_a_column():
    """Justification rides every row through one component; a cell called
    "justification" holding a nested object is not that."""
    cols = rows.columns_for(_proj(nodes=[NodeRole(path="by")]), [
        {"justification": {"reasoning": "why", "text_spans": [{"text_snippet": "q"}]}},
    ])
    assert "justification" not in {c.key for c in cols}


def test_grounds_are_read_from_either_shape():
    got = rows._grounds(
        {"justification": {"reasoning": "why", "text_spans": [{"text_snippet": "q"}]}},
    )
    assert got == {"reasoning": "why", "quote": "q"}


# ── CLUSTER ───────────────────────────────────────────────────────────────────


def _nodes(*specs):
    from app.api.modules.graph.schemas import GraphNodeData
    return [
        GraphNodeData(**{"id": str(i), "name": f"n{i}", "type": t,
                         "frequency": 1, **kw})
        for i, (t, kw) in enumerate(specs)
    ]


def _clustered(q: str, nodes, edges=None):
    from app.api.modules.graph.channels import parse_channels
    from app.api.modules.graph.stream import attach_clusters
    attach_clusters(nodes, edges or [], parse_channels(q))
    return [n.cluster for n in nodes]


def test_cluster_resolves_a_reserved_key():
    nodes = _nodes(("Person", {}), ("Organization", {}), ("Person", {}))
    assert _clustered("CLUSTER:type", nodes) == ["Person", "Organization", "Person"]


def test_a_comma_list_is_a_compound_key_not_two_clusterings():
    """`CLUSTER:type,kind` is one pile per distinct pair. Two clusterings would
    be two forces fighting over the same node."""
    nodes = _nodes(("Person", {"kind": "entity"}), ("Event", {"kind": "occurrence"}))
    assert _clustered("CLUSTER:type,kind", nodes) == [
        "Person · entity", "Event · occurrence",
    ]


def test_a_qualified_key_means_the_datas_own_field():
    """Exactly as in the filter half. Without this,
    `CLUSTER:observations.kind` returned two groups called `entity` and
    `occurrence` — a confident answer to a question nobody asked."""
    nodes = _nodes(
        ("Act", {"kind": "occurrence", "properties": {"kind": "payment"}}),
        ("Act", {"kind": "occurrence", "properties": {"kind": "statement"}}),
    )
    assert _clustered("CLUSTER:observations.kind", nodes) == ["payment", "statement"]
    assert _clustered("CLUSTER:kind", nodes) == ["occurrence", "occurrence"]


def test_a_node_with_no_value_joins_no_group():
    """"Everything else" is not a group, and drawing it as one puts a labelled
    box around the residue."""
    nodes = _nodes(("Person", {"properties": {"domain": "political"}}),
                   ("Person", {}))
    assert _clustered("CLUSTER:domain", nodes) == ["political", None]


def test_no_binding_no_clusters():
    """An unconfigured panel stays force-directed. A grouping that appears on
    its own is indistinguishable from a finding."""
    nodes = _nodes(("Person", {}), ("Person", {}))
    assert _clustered("type:Person", nodes) == [None, None]


def test_a_key_that_matches_nothing_is_reported():
    """The canvas would look identical to one with no CLUSTER at all."""
    from app.api.modules.graph.stream import cluster_notes
    _clustered("CLUSTER:nonsense", _nodes(("Person", {})))
    assert any("matched no node" in n for n in cluster_notes())


def test_the_legend_states_what_was_placed_and_what_was_not():
    """S4 — a number on screen states its denominator."""
    from app.api.modules.graph.stream import cluster_legend
    _clustered("CLUSTER:domain", _nodes(
        ("Person", {"properties": {"domain": "political"}}), ("Person", {}),
    ))
    line, *resolution = cluster_legend()
    assert "1 of 2 nodes" in line and "1 with no value" in line
    # …and how the key was read, because an inference nobody can see is
    # indistinguishable from a coincidence.
    assert resolution and "domain" in resolution[0]


def _edge(src, tgt, pred="by"):
    from app.api.modules.graph.schemas import GraphEdgeData
    # `role` as well as `predicate`: a role edge carries the SLOT it filled,
    # which is what a role-walked cluster key reads.
    return GraphEdgeData(source=src, target=tgt, predicate=pred, role=pred,
                         weight=1)


def test_a_role_is_walked_not_read():
    """`observations.by` names the payer SLOT, and a payer is at the far end of
    an edge — it never lands in the property bag, so reading it as a column
    found nothing however deep the path went."""
    nodes = _nodes(
        ("payment", {"kind": "occurrence"}),   # 0 — the act
        ("Person", {"roles": ["by"]}),         # 1 — who paid
        ("Organization", {}),                  # 2 — who was paid
    )
    nodes[1].name = "Halász"
    edges = [_edge("0", "1", "by"), _edge("0", "2", "to")]
    for key in ("CLUSTER:observations.by", "CLUSTER:observations.by.name"):
        got = _clustered(key, nodes, edges)
        assert got[0] == "Halász", key      # the act, by its payer
        assert got[2] == "Halász", key      # and the recipient, same act


def test_a_type_name_clusters_by_the_neighbour_of_that_type():
    """`CLUSTER:Interest` means "pile these by the interest they serve". Reading
    it as a column name is why both of the obvious queries did nothing."""
    nodes = _nodes(
        ("Person", {}),                     # 0 — an actor
        ("payment", {"kind": "occurrence"}), # 1 — the act it made
        ("Interest", {}),                   # 2 — what the act serves
    )
    nodes[2].name = "nominee structuring"
    edges = [_edge("0", "1"), _edge("1", "2", "serves")]
    got = _clustered("CLUSTER:Interest", nodes, edges)
    # One hop THROUGH the occurrence: an actor never touches an interest
    # directly, it makes a payment that serves one.
    assert got[0] == "nominee structuring"


def test_a_section_name_reaches_the_types_it_minted():
    """`CLUSTER:Interests` — the section — without either word being written
    down anywhere in the engine."""
    nodes = _nodes(("Person", {}), ("Interest", {"source_paths": ["document.interests[*]"]}))
    nodes[1].name = "sovereign exemption"
    edges = [_edge("0", "1", "serves")]
    assert _clustered("CLUSTER:Interests", nodes, edges)[0] == "sovereign exemption"


def test_neighbour_ties_break_stably():
    """A cluster that moves when nothing changed reads as a finding and is an
    artefact."""
    nodes = _nodes(("Person", {}), ("Interest", {}), ("Interest", {}))
    nodes[1].name, nodes[2].name = "beta", "alpha"
    edges = [_edge("0", "1", "serves"), _edge("0", "2", "serves")]
    assert _clustered("CLUSTER:Interest", nodes, edges)[0] == "alpha"


# ── Section choice ────────────────────────────────────────────────────────────


def test_section_names_come_from_the_contract():
    projs = [Projection(path="document.observations[*]"),
             Projection(path="document.places[*]")]
    assert set(rows.section_names(projs)) == {"observations", "places"}


def test_requested_section_wins():
    projs = [Projection(path="document.observations[*]", about="self"),
             Projection(path="document.places[*]")]
    assert rows.choose_section(projs, ["places"]).path == "document.places[*]"


def test_claims_are_preferred_over_stations_by_declared_role():
    """A table of the acts answers a question; a table of the cast is a
    glossary. Decided on the declared ROLE, so a contract calling its claims
    `findings` sorts identically to one calling them `observations`."""
    events = Projection(path="document.events[*]", about="self", role="step")
    obs = Projection(path="document.observations[*]", about="self", role="companion")
    assert rows.choose_section([events, obs]) is obs


def test_rosters_are_not_the_default():
    roster = Projection(path="document.actors[*]", role="body")
    obs = Projection(path="document.observations[*]", about="self", role="companion")
    assert rows.choose_section([roster, obs]) is obs


@pytest.mark.parametrize("raw,head,segments", [
    ("ACTORS.[*].type", "actors", ("type",)),
    ("observations.by[*].name", "observations", ("by", "name")),
    ("Interests", "interests", ()),
])
def test_paths_parse_case_and_star_insensitively(raw, head, segments):
    fp = rows.parse_path(raw)
    assert (fp.head, fp.segments) == (head, segments)


# ── WEIGHT ────────────────────────────────────────────────────────────────────


def _measure(q: str, nodes, edges=()):
    from app.api.modules.graph.channels import parse_channels
    from app.api.modules.graph.measures import measure_nodes, parse_measure
    spec = parse_measure(parse_channels(q).get("WEIGHT"))
    return spec, measure_nodes(spec, nodes, edges)


def test_weight_reads_a_field_not_only_a_method_word():
    """`WEIGHT:` used to accept six reserved words and silently drop anything
    else, so `WEIGHT:magnitude` sized by `gathers`. Measured on run 15010:
    `WEIGHT:magnitude` and `WEIGHT:gathers` produced IDENTICAL sizes, and the
    largest node "by magnitude" was a city."""
    nodes = _nodes(
        ("payment", {"properties": {"magnitude": 1000}}),
        ("payment", {"properties": {"magnitude": 1}}),
    )
    spec, sized = _measure("WEIGHT:magnitude", nodes)
    assert spec.fields == ("magnitude",)
    assert sized.sizes[nodes[0].id] > sized.sizes[nodes[1].id]


def test_a_reserved_measure_still_wins():
    spec, _ = _measure("WEIGHT:degree", _nodes(("Person", {})))
    assert spec.terms == ("degree",) and spec.fields == ()


def test_a_qualified_field_addresses_the_same_quantity():
    """On a NODE the section half is already spent — it came from somewhere."""
    a, _ = _measure("WEIGHT:magnitude", _nodes(("x", {})))
    b, _ = _measure("WEIGHT:observations.magnitude", _nodes(("x", {})))
    assert a.fields == ("magnitude",) and b.fields == ("observations.magnitude",)


def test_a_field_that_reaches_nothing_is_reported_and_falls_back():
    """A reported failure must not also blank the canvas: every node at zero is
    a picture, and an unreadable one."""
    nodes = _nodes(("Person", {"frequency": 5}), ("Person", {"frequency": 1}))
    _, sized = _measure("WEIGHT:nope", nodes)
    assert any("could not size by nope" in n for n in sized.notes)
    assert any("gathers" in n for n in sized.notes)
    assert sized.sizes[nodes[0].id] > sized.sizes[nodes[1].id]


def test_the_render_states_what_was_asked_for():
    """The legend printed `WEIGHT:gathers` for a query that said `magnitude`."""
    spec, _ = _measure("WEIGHT:magnitude(ref:median)", _nodes(("x", {})))
    assert spec.render() == "WEIGHT:magnitude(ref:median)"


# ── S1 — a clause that reaches nothing says so ────────────────────────────────


@pytest.mark.parametrize("q,name", [
    ("VECTOR:interests", "VECTOR"),
    ("STEPS:events", "STEPS"),
    ("ANCHOR:places", "ANCHOR"),
    ("AXIS:time", "AXIS"),
    ("DISCONNECT:observations", "DISCONNECT"),
])
def test_a_deferred_binding_reports_that_it_lands_nothing(q, name):
    """`VECTOR:interests` printed a confident legend line describing a fold that
    reaches no renderer. Worse than silence: silence is ambiguous, a legend is a
    claim."""
    from app.api.modules.graph.channels import parse_channels, unwired
    (note,) = unwired(parse_channels(q))
    assert note.startswith(f"{name}:") and "reaches no renderer" in note


@pytest.mark.parametrize("q", ["CLUSTER:type", "WEIGHT:degree", "SECTION:places",
                               "SHOW:by,to"])
def test_a_wired_binding_says_nothing(q):
    from app.api.modules.graph.channels import parse_channels, unwired
    assert unwired(parse_channels(q)) == []


def test_by_is_reported_as_deferred():
    """It parses as free text, so writing it narrows the canvas by name-matching
    "by" and reports nothing."""
    assert any("BY is not implemented" in n
               for n in gql.parse("type:Person BY place").notes)


# ── Composition: a comma is OR, on every token ────────────────────────────────


def test_a_comma_is_or_on_a_row_condition_too():
    """`observations.kind:payment,acquisition` compiled to a literal match on
    the string "payment,acquisition" and returned nothing. A comma had been OR
    for the reserved prefixes since the beginning and for nothing else — one
    composition rule, documented, true in half the language."""
    (cond,) = gql.parse("observations.kind:payment,acquisition").row_conditions
    assert cond.op == "in"
    assert cond.values == ("payment", "acquisition")


def test_a_single_value_is_not_a_set():
    (cond,) = gql.parse("observations.kind:payment").row_conditions
    assert cond.op == "==" and cond.values == ()


def test_a_comma_in_a_comparison_is_not_a_range():
    """Pretending it were would be a second meaning for the same punctuation."""
    (cond,) = gql.parse("magnitude>1,2").row_conditions
    assert cond.op == ">"


def test_a_value_set_compiles_to_one_any():
    clauses, params = gql.row_predicate_sql(
        gql.parse("observations.kind:payment,acquisition"),
        "NULL", section="observations", sections=SECTIONS,
    )
    assert "= ANY(" in clauses[0]
    assert ["payment", "acquisition"] in params.values()


def test_a_value_set_on_a_nested_path_ors_its_probes():
    """jsonpath has no membership test that can take a bound array."""
    (clause,) = gql.row_predicate_sql(
        gql.parse("observations.by.type:Person,Organization"),
        "NULL", section="observations", sections=SECTIONS,
    )[0]
    assert clause.count("jsonb_path_exists") == 2 and " OR " in clause


# ── F2 — four edge kinds ──────────────────────────────────────────────────────


def _kind(pred, role=None, src_kind="entity"):
    from app.api.modules.graph.stream import _edge_kind
    return _edge_kind(pred, role, {"kind": src_kind}, {"kind": "entity"})


def test_containment_is_recognised_however_it_was_minted():
    """A containment edge is containment whether it came from a role slot or a
    relation. Asking where it came from would give two answers for one fact."""
    for p in ("within", "part_of", "during", "contains"):
        assert _kind(p) == "contains", p
        assert _kind(p, src_kind="occurrence") == "contains", p


def test_a_sequence_is_its_own_kind():
    assert _kind("follows") == "follows"
    assert _kind("precedes") == "follows"


def test_an_edge_out_of_an_occurrence_is_that_act_s_cast():
    """136 of run 15010's 192 edges. Drawn at the weight of a finding, they are
    most of why the canvas reads as noise."""
    assert _kind("by", role="by", src_kind="occurrence") == "role"
    assert _kind("via", role="via", src_kind="occurrence") == "role"


def test_everything_else_is_a_relation():
    """The honest default: it asserts least about how to draw it."""
    assert _kind("owns") == "relation"
    assert _kind(None) == "relation"


def test_the_conventional_vocabulary_wins_over_the_structure():
    # `during` out of an occurrence is still containment, not cast.
    assert _kind("during", role="during", src_kind="occurrence") == "contains"


def test_a_declared_property_reaches_the_edge_not_only_the_node():
    """Edge properties were EMPTY without a panel config — measured 0 of 192 on
    run 15010 — because edge forwarding read the PANEL's list rather than the
    projection's. `edgeEpistemics` reads `properties.modality`, so every denial
    painted exactly like an assertion."""
    from app.api.modules.graph.stream import _aggregate_forward_properties
    # A field with no spec still forwards, with `first` — the only aggregation
    # that cannot invent a value, and a modality is a label not a quantity.
    out = _aggregate_forward_properties({"modality": ["denied", "denied"]}, [])
    assert out == {"modality": "denied"}
