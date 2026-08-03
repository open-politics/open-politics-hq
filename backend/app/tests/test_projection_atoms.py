"""What a projection mints, at the atom level.

``_atoms_for_row`` is the fan-out every graph goes through and it is pure — a
SQL row in, atoms out — so these drive it directly rather than through Postgres.
The aggregation-level behaviour lives in ``test_graph_stream_extensions.py``;
this pins the half that decides *what the atoms say*.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.api.modules.annotation.panel_config import NodeRole, Projection
from app.api.modules.graph.stream import AnnotationGraphSource, NodeRow, TripletRow


def _source() -> AnnotationGraphSource:
    """A source with no query — ``_atoms_for_row`` only reads its knobs."""
    return AnnotationGraphSource(query=None)


def _row(**kw):
    kw.setdefault("annotation_id", 1)
    kw.setdefault("ord", 1)
    return SimpleNamespace(**kw)


def _fan(proj: Projection, row, roles: list[NodeRole]):
    atoms = _source()._atoms_for_row(row, proj, roles)
    nodes = [a for a in atoms if isinstance(a, NodeRow)]
    edges = [a for a in atoms if isinstance(a, TripletRow)]
    return nodes, edges


# ─── node_kind ──────────────────────────────────────────────────────────────


def test_about_self_mints_an_occurrence_by_default():
    proj = Projection(path="obs[*]", about="self", node_type="Payment")
    nodes, _ = _fan(proj, _row(r0_val="Acme"),
                    [NodeRole(path="by", label="by", type_const="Organization")])
    assert nodes[0].type == "Payment"
    assert nodes[0].properties.get("_is_occurrence") is True


def test_node_kind_entity_mints_something_that_did_not_happen():
    """An exhibit is a document — it exists whether or not anyone cites it."""
    proj = Projection(path="evidence[*]", about="self",
                      node_kind="entity", node_type="Evidence")
    nodes, _ = _fan(proj, _row(), [])
    assert nodes[0].type == "Evidence"
    assert "_is_occurrence" not in nodes[0].properties


def test_an_unpinned_entity_still_gets_a_filterable_type():
    proj = Projection(path="evidence[*]", about="self", node_kind="entity")
    nodes, _ = _fan(proj, _row(), [])
    assert nodes[0].type == "Entity"


# ─── node_type_path ─────────────────────────────────────────────────────────


def test_node_type_is_read_from_the_row_when_a_path_is_given():
    """One `observations[*]` array, a `kind` column, and `type:Payment` still
    filters — which is what lets a label collapse many sections into one."""
    proj = Projection(path="obs[*]", about="self",
                      node_type="Act", node_type_path="kind")
    for declared, expected in (("Payment", "Payment"), ("Meeting", "Meeting")):
        nodes, _ = _fan(proj, _row(occ_type=declared), [])
        assert nodes[0].type == expected


def test_a_blank_row_type_falls_back_to_the_pinned_one():
    proj = Projection(path="obs[*]", about="self",
                      node_type="Act", node_type_path="kind")
    for blank in (None, "", "   "):
        nodes, _ = _fan(proj, _row(occ_type=blank), [])
        assert nodes[0].type == "Act", blank


def test_the_row_type_reaches_the_edges_too():
    """Participant edges name the occurrence as their subject, so a per-row
    type has to appear on both or the edge points at a node that is not there."""
    proj = Projection(path="obs[*]", about="self", node_type_path="kind")
    nodes, edges = _fan(
        proj, _row(occ_type="Payment", r0_val="Acme"),
        [NodeRole(path="by", label="by", type_const="Organization")],
    )
    assert nodes[0].type == "Payment"
    assert edges[0].subject_type == "Payment"
    assert edges[0].predicate == "by"
    # …and the participant still inherits nothing.
    assert edges[0].properties == {}


def test_no_path_means_the_pinned_type_wins_even_if_the_row_has_a_kind():
    """A stray `occ_type` on the row must not leak in when nothing asked for it."""
    proj = Projection(path="obs[*]", about="self", node_type="Payment")
    nodes, _ = _fan(proj, _row(occ_type="Meeting"), [])
    assert nodes[0].type == "Payment"


# ─── the two compose ────────────────────────────────────────────────────────


def test_kind_and_type_are_independent():
    proj = Projection(path="sources[*]", about="self",
                      node_kind="entity", node_type_path="kind")
    nodes, _ = _fan(proj, _row(occ_type="Deposition"), [])
    assert nodes[0].type == "Deposition"
    assert "_is_occurrence" not in nodes[0].properties
