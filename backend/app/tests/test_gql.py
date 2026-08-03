"""GQL semantics — parse and ``apply_to_graph``.

Pure functions over an assembled graph, so no database: the point of these is
the *meaning* of a combined query, which is where GQL has actually gone wrong.

The fixture is the travel-records case from the observation model: an
occurrence (a flight, a meeting) is a node, participants hang off it by
role-labelled edges, and no participant-to-participant edge exists. That shape
is what makes traversal subtle — every actor-to-actor connection runs *through*
a node of a different type.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from app.api.modules.graph import gql


@dataclass
class N:
    id: str
    name: str
    type: str
    kind: str = "entity"
    roles: list = field(default_factory=list)
    frequency: int = 1
    t0: str | None = None
    t1: str | None = None
    lat: float | None = None
    lon: float | None = None
    place: str | None = None
    magnitude: float | None = None
    group_value: object = None


@dataclass
class E:
    source: str
    target: str
    predicate: str
    weight: int = 1
    role: str | None = None
    computed_weight: float | None = None
    t0: str | None = None
    t1: str | None = None


@pytest.fixture
def travel():
    """Epstein —flight1— Alice —meeting1— Bob, plus an unrelated meeting2.

    Every link is bipartite through an occurrence, and each occurrence carries
    a Location. Nothing connects Person to Person directly.
    """
    nodes = [
        N("ep", "Jeffrey Epstein", "Person"),
        N("al", "Alice", "Person"),
        N("bo", "Bob", "Person"),
        N("ca", "Carol", "Person"),
        N("da", "Dave", "Person"),
        N("f1", "1:flights:1", "Flight", kind="occurrence", t0="2002-05-01"),
        N("m1", "1:meets:1", "Meeting", kind="occurrence", t0="2003-06-01"),
        N("m2", "1:meets:2", "Meeting", kind="occurrence", t0="2003-06-01"),
        # ``roles`` is what ``_touch_node`` accumulates from the edges that
        # named the node — a place reached through an ``at`` edge carries it.
        N("tet", "Teterboro", "Location", roles=["at"]),
        N("par", "Paris", "Location", roles=["at"]),
        N("tok", "Tokyo", "Location", roles=["at"]),
    ]
    edges = [
        E("f1", "ep", "on_board", role="on_board"),
        E("f1", "al", "on_board", role="on_board"),
        E("f1", "tet", "at", role="at"),
        E("m1", "al", "attendee", role="attendee"),
        E("m1", "bo", "attendee", role="attendee"),
        E("m1", "par", "at", role="at"),
        E("m2", "ca", "attendee", role="attendee"),
        E("m2", "da", "attendee", role="attendee"),
        E("m2", "tok", "at", role="at"),
    ]
    return nodes, edges


def _names(nodes) -> set[str]:
    return {n.name for n in nodes}


# ─── Identity filters select; they do not block paths ───────────────────────


def test_type_filter_with_traversal_returns_that_type_within_reach(travel):
    """``type:Location from:"E1" hops:2`` — the places near E1, plus E1.

    Regression. Filtering nodes before walking removed the seed itself (E1 is a
    Person, not a Location), so the query returned an empty graph — the filter
    silently made itself unsatisfiable.

    ``-paths`` here isolates the *selection*; see
    :func:`test_paths_are_shown_by_default` for what a bare ``hops:2`` adds.
    """
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('type:Location from:"Jeffrey Epstein" hops:2-paths'), nodes, edges,
    )
    assert _names(kept) == {"Jeffrey Epstein", "Teterboro", "Paris"}
    assert "Tokyo" not in _names(kept)   # Carol and Dave are not near Epstein


def test_type_filter_does_not_sever_the_path_through_occurrences(travel):
    """``type:Person from:"E1" hops:2`` must still reach Bob.

    Regression. Person↔Person runs through a Flight and a Meeting, and a
    ``type:`` filter deleted exactly those — so the walk could not move and
    returned the seed alone. ``_adjacency`` contracts occurrences, but only if
    they survive long enough to be contracted.
    """
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('type:Person from:"Jeffrey Epstein" hops:2-paths'), nodes, edges,
    )
    assert _names(kept) == {"Jeffrey Epstein", "Alice", "Bob"}


def test_traversal_without_type_filter_keeps_the_connective_occurrences(travel):
    """No identity filter → the occurrences that justify the walk come back."""
    nodes, edges = travel
    kept, kept_edges = gql.apply_to_graph(
        gql.parse('from:"Jeffrey Epstein" hops:2'), nodes, edges,
    )
    assert {"Jeffrey Epstein", "Alice", "Bob"} <= _names(kept)
    assert {"1:flights:1", "1:meets:1"} <= _names(kept)
    assert "1:meets:2" not in _names(kept)     # connects nobody we reached
    assert kept_edges, "the reached subgraph should keep its edges"


def test_hops_counts_actor_steps_not_graph_steps(travel):
    """One hop from Epstein is Alice — not the flight that carried them.

    The flight still *renders* (it is what connects them), but it did not
    consume the hop: Bob, two actor-steps away, is absent.
    """
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('type:Person from:"Jeffrey Epstein" hops:1-paths'), nodes, edges,
    )
    assert _names(kept) == {"Jeffrey Epstein", "Alice"}

    with_paths, _ = gql.apply_to_graph(
        gql.parse('type:Person from:"Jeffrey Epstein" hops:1'), nodes, edges,
    )
    assert "1:flights:1" in _names(with_paths)
    assert "Bob" not in _names(with_paths)


# ─── Structural filters DO bound the walk ───────────────────────────────────


def test_time_window_bounds_the_traversal(travel):
    """``before:`` is structural — a 2003 meeting is not a route in 2002."""
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('type:Person from:"Jeffrey Epstein" hops:2 before:2002-12'),
        nodes, edges,
    )
    assert "Bob" not in _names(kept)          # only reachable via the 2003 meeting
    assert {"Jeffrey Epstein", "Alice"} <= _names(kept)


# ─── Seed groups ────────────────────────────────────────────────────────────


def test_separate_from_tokens_intersect(travel):
    """``from:"A" from:"B"`` is reachable-from-both — the co-presence question."""
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('from:"Jeffrey Epstein" from:"Bob" hops:2'), nodes, edges,
    )
    # Alice is the only person within two hops of both.
    assert "Alice" in _names(kept)
    assert "Carol" not in _names(kept) and "Dave" not in _names(kept)


def test_comma_inside_one_token_unions(travel):
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('type:Person from:"Jeffrey Epstein","Carol" hops:1-paths'),
        nodes, edges,
    )
    assert {"Jeffrey Epstein", "Alice", "Carol", "Dave"} == _names(kept)


def test_unsatisfiable_seed_yields_empty_not_everything(travel):
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(gql.parse('from:"Nobody At All"'), nodes, edges)
    assert kept == []


# ─── Plain filters, unchanged ───────────────────────────────────────────────


def test_type_filter_alone(travel):
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(gql.parse("type:Location"), nodes, edges)
    assert _names(kept) == {"Teterboro", "Paris", "Tokyo"}


def test_kind_separates_occurrences_from_entities(travel):
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(gql.parse("kind:occurrence"), nodes, edges)
    assert _names(kept) == {"1:flights:1", "1:meets:1", "1:meets:2"}


def test_excluded_type(travel):
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(gql.parse("-type:Location"), nodes, edges)
    assert "Teterboro" not in _names(kept)
    assert "Alice" in _names(kept)


def test_role_filter_selects_by_the_slot_a_node_occupied(travel):
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(gql.parse("role:at"), nodes, edges)
    assert _names(kept) == {"Teterboro", "Paris", "Tokyo"}


def test_role_scoped_degree_counts_edges_whose_far_end_was_filtered(travel):
    """``role:at degree>0`` must not answer zero.

    The ``at`` edges run occurrence → place, and ``role:at`` removes the
    occurrences from the node set. Counting only surviving edges would leave
    every place at degree 0 — which is why ``edge_props_ok`` is split out from
    the endpoint check. This is the mechanism that discovers an intermediary:
    "``via`` in 340 payments" is a finding, "340 connections" is not.
    """
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(gql.parse("role:at degree>0"), nodes, edges)
    assert _names(kept) == {"Teterboro", "Paris", "Tokyo"}


def test_empty_query_is_a_passthrough(travel):
    nodes, edges = travel
    kept, kept_edges = gql.apply_to_graph(gql.parse(""), nodes, edges)
    assert len(kept) == len(nodes) and len(kept_edges) == len(edges)


# ─── The origin of a traversal ──────────────────────────────────────────────


def test_the_origin_survives_an_identity_filter(travel):
    """``type:Location from:"E1"`` keeps E1 on screen.

    You typed a name; the graph answering without it is disorienting — and
    under a type filter the seed is usually the one node that *cannot* match,
    because you asked for Locations and the anchor is a Person.
    """
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('type:Location from:"Jeffrey Epstein" hops:2-paths'), nodes, edges,
    )
    assert _names(kept) == {"Jeffrey Epstein", "Teterboro", "Paris"}


def test_hops_minus_origin_drops_it(travel):
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('type:Location from:"Jeffrey Epstein" hops:2-origin-paths'),
        nodes, edges,
    )
    assert _names(kept) == {"Teterboro", "Paris"}


def test_minus_origin_parses_the_depth(travel):
    q = gql.parse('from:"X" hops:3-origin')
    assert q.hops == 3 and q.keep_origin is False
    assert gql.parse('from:"X" hops:3').keep_origin is True


def test_origin_is_not_resurrected_when_the_walk_found_nothing(travel):
    """An unsatisfiable seed still means an empty answer, not a lone node."""
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(gql.parse('from:"Nobody At All" hops:2'), nodes, edges)
    assert kept == []


# ─── hops flags: -origin and -paths, in any order ───────────────────────────


@pytest.mark.parametrize("raw,hops,origin,paths", [
    ("hops:2",              2, True,  True),
    ("hops:2-origin",       2, False, True),
    ("hops:2-path",         2, True,  False),
    ("hops:2-paths",        2, True,  False),
    ("hops:2-origin-path",  2, False, False),
    ("hops:2-path-origin",  2, False, False),
    ("hops:3-origin-paths", 3, False, False),
])
def test_hops_flag_combinations_parse(raw, hops, origin, paths):
    q = gql.parse(f'from:"X" {raw}')
    assert (q.hops, q.keep_origin, q.keep_paths) == (hops, origin, paths)


def test_unknown_hops_flag_falls_back_to_free_text():
    """A typo must be visible, not silently ignored."""
    q = gql.parse('from:"X" hops:2-orgin')
    assert q.hops is None
    assert "hops:2-orgin" in q.text


def test_paths_are_shown_by_default(travel):
    """``type:Location from:"E1" hops:2`` shows how each place connects back.

    A traversal's answer is a path, not a set. Under a type filter the entire
    "how" — the flight, the meeting, the person in between — is made of nodes
    that filter excludes by construction, so selecting strictly returns a
    scatter of dots with the reasoning removed.
    """
    nodes, edges = travel
    kept, kept_edges = gql.apply_to_graph(
        gql.parse('type:Location from:"Jeffrey Epstein" hops:2'), nodes, edges,
    )
    names = _names(kept)
    assert {"Teterboro", "Paris"} <= names          # the answer
    assert "Jeffrey Epstein" in names               # the anchor
    assert {"Alice", "1:flights:1", "1:meets:1"} <= names   # the how
    assert "Tokyo" not in names and "Carol" not in names
    assert kept_edges, "a connected answer must keep its edges"


def test_minus_paths_returns_only_the_selection(travel):
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('type:Location from:"Jeffrey Epstein" hops:2-paths'), nodes, edges,
    )
    assert _names(kept) == {"Jeffrey Epstein", "Teterboro", "Paris"}


def test_minus_origin_minus_paths_is_the_bare_answer(travel):
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('type:Location from:"Jeffrey Epstein" hops:2-origin-paths'),
        nodes, edges,
    )
    assert _names(kept) == {"Teterboro", "Paris"}


def test_kind_occurrence_with_traversal_is_not_empty(travel):
    """Regression: identity intersected against actors only, so asking for the
    occurrences around a seed answered nothing at all."""
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(
        gql.parse('kind:occurrence from:"Jeffrey Epstein" hops:2-paths'), nodes, edges,
    )
    assert {"1:flights:1", "1:meets:1"} <= _names(kept)
    assert "1:meets:2" not in _names(kept)


# ─── label= and doc. ────────────────────────────────────────────────────────


def test_label_is_exact_where_free_text_is_substring(travel):
    nodes, edges = travel
    exact, _ = gql.apply_to_graph(gql.parse('label=="Paris"'), nodes, edges)
    assert _names(exact) == {"Paris"}
    loose, _ = gql.apply_to_graph(gql.parse('Pari'), nodes, edges)
    assert _names(loose) == {"Paris"}
    assert gql.apply_to_graph(gql.parse('label=="Pari"'), nodes, edges)[0] == []


def test_label_not_equals(travel):
    nodes, edges = travel
    kept, _ = gql.apply_to_graph(gql.parse('type:Location label!="Tokyo"'), nodes, edges)
    assert _names(kept) == {"Teterboro", "Paris"}


def test_label_is_tier_two_not_pushed_into_sql():
    q = gql.parse('label=="Acme"')
    assert q.label_conditions and not q.row_conditions
    assert q.has_post and not q.has_row_scope


def test_doc_conditions_are_tier_one_and_strip_the_prefix():
    q = gql.parse('doc.relevance>0.7 doc.title=="Docket 12" confidence>0.5')
    assert [(c.key, c.op, c.value) for c in q.doc_conditions] == [
        ("relevance", ">", "0.7"), ("title", "==", "Docket 12"),
    ]
    assert [c.key for c in q.row_conditions] == ["confidence"]
    assert q.has_row_scope


def test_doc_conditions_compile_against_the_annotation_root():
    """They must resolve on ``a.value``, not on the exploded element."""
    seen: list[str] = []

    def _doc_accessor(path, param_prefix):
        seen.append(path)
        return (f"a.value #>> '{{{path}}}'", {})

    q = gql.parse("doc.relevance>0.7")
    clauses, _ = gql.row_predicate_sql(q, "NULL", doc_accessor=_doc_accessor)
    assert seen == ["document.relevance"]
    assert clauses and "a.value" in clauses[0] and "elem->>" not in clauses[0]


def test_doc_conditions_are_skipped_without_an_accessor():
    """Better no filter than one silently pointed at the wrong scope."""
    q = gql.parse("doc.relevance>0.7")
    clauses, _ = gql.row_predicate_sql(q, "NULL")
    assert clauses == []


# ─── converge> — the residual, as a query token ─────────────────────────────


@pytest.fixture
def converging():
    """Two pairs that share an interest profile, at different graph distances.

    near_a/near_b work together directly. far_a/far_b never touch. Both pairs
    converge on the same interests — which is exactly the distinction the
    residual exists to draw.
    """
    # Two DISTINCT profiles, one per pair — otherwise every cross-pair also
    # converges at infinite distance, which is correct but tests nothing.
    near = {"opacity": 8.0, "financial_gain": 3.0}
    far = {"tax_minimisation": 9.0, "legal_shielding": 2.0}
    nodes = [
        N("na", "Near A", "Organization", roles=[]),
        N("nb", "Near B", "Organization"),
        N("fa", "Far A", "Organization"),
        N("fb", "Far B", "Organization"),
        N("m1", "1:meets:1", "Meeting", kind="occurrence"),
    ]
    # `profile`, not `group_value`. The affinity vector has its own field so a
    # panel grouping by roles cannot be cosined — `{via: 340}` against
    # `{via: 12}` scores a perfect 1.0 and means only that both are
    # intermediaries a lot. See `GraphNodeData.profile`.
    nodes[0].profile = dict(near)
    nodes[1].profile = dict(near)
    nodes[2].profile = dict(far)
    nodes[3].profile = dict(far)
    # Near A and Near B are one actor-hop apart (through a shared meeting).
    edges = [
        E("m1", "na", "with", role="with"),
        E("m1", "nb", "with", role="with"),
    ]
    return nodes, edges


def test_converge_drops_the_pair_that_already_works_together(converging):
    """One hop apart and converging is a description, not a finding — the
    penalty is zero there, so the residual is zero however similar they are."""
    nodes, edges = converging
    kept, _ = gql.apply_to_graph(gql.parse("converge>0.5"), nodes, edges)
    names = _names(kept)
    assert "Near A" not in names and "Near B" not in names


def test_converge_surfaces_the_pair_the_graph_does_not_connect(converging):
    """Identical profiles, nothing joining them — coordination without contact,
    or independent response to one incentive. Distinguishing those IS the work."""
    nodes, edges = converging
    kept, _ = gql.apply_to_graph(gql.parse("converge>0.5"), nodes, edges)
    assert {"Far A", "Far B"} <= _names(kept)


def test_converge_ignores_nodes_with_no_profile(converging):
    """The profile is computed from the edge set by `attach_neighbour_profiles`;
    a node without one has nothing to converge on."""
    nodes, edges = converging
    nodes.append(N("x", "No Profile", "Organization"))
    kept, _ = gql.apply_to_graph(gql.parse("converge>0.5"), nodes, edges)
    assert "No Profile" not in _names(kept)


def test_converge_is_tier_two_not_a_row_condition():
    q = gql.parse("converge>0.6")
    assert [c.key for c in q.shape_conditions] == ["converge"]
    assert not q.row_conditions
    assert q.has_post and not q.has_row_scope


def test_converge_composes_with_an_identity_filter(converging):
    nodes, edges = converging
    kept, _ = gql.apply_to_graph(
        gql.parse('converge>0.5 label=="Far A"'), nodes, edges)
    assert _names(kept) == {"Far A"}


def test_the_residual_has_a_ceiling_of_one(converging):
    """Identical profiles with no path between them is the maximum: cosine 1
    times a full distance penalty. Nothing scores above it, so a threshold at
    or over 1 is empty by construction."""
    nodes, edges = converging
    assert {"Far A", "Far B"} <= _names(
        gql.apply_to_graph(gql.parse("converge>0.99"), nodes, edges)[0])
    assert gql.apply_to_graph(gql.parse("converge>1.0"), nodes, edges)[0] == []


def test_partial_overlap_scores_below_identical(converging):
    """A pair sharing one interest of two ranks under a pair sharing both."""
    nodes, edges = converging
    nodes[3].profile = {"tax_minimisation": 9.0, "opacity": 5.0}
    loose = _names(gql.apply_to_graph(gql.parse("converge>0.5"), nodes, edges)[0])
    tight = _names(gql.apply_to_graph(gql.parse("converge>0.9"), nodes, edges)[0])
    assert {"Far A", "Far B"} <= loose
    assert "Far A" not in tight
