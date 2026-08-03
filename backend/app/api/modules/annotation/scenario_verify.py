"""The six investigation shapes, as questions with known answers.

    docker compose exec -T backend python -m app.api.modules.annotation.scenario_verify <run_id>

Each case in ``docs/plans/observation-model/INVESTIGATION.md`` is a query over
the hand-written scenario corpus whose right answer is known in advance. That
turns "does the machinery answer the six cases" from an opinion into an
assertion, and it is why the corpus is fabricated: over a model-produced run a
failure could be the prompt, the corpus or the engine, and there is no way to
tell which.

The same definitions back ``app/tests/test_scenario_cases.py``, so the cases are
regression tests rather than a script somebody remembers to run.
"""

from __future__ import annotations

import argparse
import asyncio
from typing import Any, Callable, NamedTuple

from sqlmodel import Session, text

from app.api.modules.annotation.panel_config import (
    GraphConfig, derive_doc_anchors, resolve_projections,
)
from app.api.modules.annotation.query import AnnotationQuery
from app.api.modules.annotation.schema_map import schema_map_for
from app.api.modules.graph import gql
from app.api.modules.graph.stream import AnnotationGraphSource, collect_graph
from app.core.db import engine


def assemble(session: Session, run_id: int, infospace_id: int, *,
             node_group_by: str | None = "neighbours:Interest") -> Any:
    """The graph exactly as an unconfigured panel would build it."""
    sid = session.execute(text(
        "SELECT schema_id FROM annotation WHERE run_id = :r LIMIT 1"
    ), {"r": run_id}).scalar()
    contract = session.execute(text(
        "SELECT output_contract FROM annotationschema WHERE id = :i"
    ), {"i": sid}).scalar()

    smap = schema_map_for(contract)
    anchors = derive_doc_anchors(smap)
    return asyncio.run(collect_graph(
        session, infospace_id,
        AnnotationGraphSource(
            query=AnnotationQuery(session, infospace_id).scope(None).runs([run_id]),
            projections=resolve_projections(GraphConfig(), smap=smap),
            doc_place=anchors["doc_place"], doc_time=anchors["doc_time"],
            node_group_by=node_group_by,
        ),
        top_n_nodes=None, top_n_edges=None,
    ))


def run_query(graph: Any, q: str) -> tuple[list, list]:
    parsed = gql.parse(q)
    return gql.apply_to_graph(parsed, list(graph.nodes), list(graph.edges))


class Case(NamedTuple):
    id: str
    label: str
    query: str
    #: ``(graph, nodes, edges) -> (ok, what_we_saw)``. Returning the observation
    #: rather than a bare bool is what makes a failure diagnosable.
    check: Callable[[Any, list, list], tuple[bool, str]]
    #: What the shape needs that does NOT exist yet, if anything.
    blocked_by: str | None = None


def _names(nodes: list) -> set[str]:
    return {n.name for n in nodes}


# ─── Case 1 — convergence without contact ────────────────────────────────────


def _c1(graph, nodes, edges):
    elites = {"Piotr Zieliński", "Sofia Duarte", "Ilona Vaher"}
    got = _names(nodes) & elites
    # The finding is the ABSENCE of a path, so the assertion is two-sided:
    # all three must surface, and none may be connected to another.
    ids = {n.id for n in graph.nodes if n.name in elites}
    between = [e for e in graph.edges if e.source in ids and e.target in ids]
    ok = got == elites and not between
    return ok, f"{sorted(got)} · {len(between)} edges among them"


def _c1_residual(graph, nodes, edges):
    """The residual itself: high affinity × high distance."""
    prof = {n.name: gql._profile_of(n) for n in graph.nodes}
    pairs = [("Piotr Zieliński", "Sofia Duarte"), ("Piotr Zieliński", "Ilona Vaher")]
    sims = [gql._cosine(prof[a], prof[b])
            for a, b in pairs if prof.get(a) and prof.get(b)]
    ok = bool(sims) and all(s > 0.9 for s in sims)
    return ok, f"cosine {[round(s, 2) for s in sims]} (want > 0.9, unconnected)"


# ─── Case 2 — a repeating method ─────────────────────────────────────────────


def _c2(graph, nodes, edges):
    """The hub is discovered by role-scoped degree, not by degree."""
    hub = next((n for n in nodes if n.name == "Meridian Bank a/c 4471"), None)
    if hub is None:
        return False, "the routing account is absent"
    via = [e for e in graph.edges if e.role == "via" and e.target == hub.id]
    return len(via) >= 5, f"the routing account is `via` in {len(via)} acts"


def _c2_motif(graph, nodes, edges):
    """The motif itself — group by (kind, role-type signature)."""
    sig: dict[tuple, int] = {}
    for n in graph.nodes:
        if n.kind != "occurrence":
            continue
        roles = tuple(sorted({
            (e.role, next((m.type for m in graph.nodes if m.id == e.target), ""))
            for e in graph.edges if e.source == n.id and e.role
        }))
        sig[(n.type, roles)] = sig.get((n.type, roles), 0) + 1
    top = max(sig.values()) if sig else 0
    return top >= 8, f"largest identical shape: {top} rows"


# ─── Case 3 — a concealed chain ──────────────────────────────────────────────


def _c3(graph, nodes, edges):
    """Four hops from the beneficial owner to the asset, every shell thin."""
    by_name = {n.name: n for n in graph.nodes}
    chain = ["Tomás Ferreira", "Corvus Holdings Ltd", "Larimar Capital S.A.", "Selene Trading Ltd",
             "Molo IV warehouse, Trieste"]
    if any(c not in by_name for c in chain):
        return False, f"missing: {[c for c in chain if c not in by_name]}"
    links = 0
    for a, b in zip(chain, chain[1:]):
        if any(e.source == by_name[a].id and e.target == by_name[b].id
               for e in graph.edges):
            links += 1
    degs = {s: sum(1 for e in graph.edges
                   if by_name[s].id in (e.source, e.target))
            for s in ("Corvus Holdings Ltd", "Larimar Capital S.A.", "Selene Trading Ltd")}
    return links == 4, f"{links}/4 hops · shell degrees {degs}"


# ─── Case 4 — asymmetry, concealed ───────────────────────────────────────────


def _c4(graph, nodes, edges):
    """Stated vs revealed: the regulator's profile must carry both signs."""
    r = next((n for n in graph.nodes if n.name == "Federal Procurement Review Board"), None)
    if r is None or not isinstance(r.group_value, dict):
        return False, "the review board has no interest profile"
    p = r.group_value
    stated = p.get("regulatory neutrality", 0)
    revealed = p.get("vendor market position", 0)
    return stated < 0 < revealed or (stated and revealed), \
        f"neutrality {stated:+g} · vendor position {revealed:+g}"


# ─── Case 5 — divergence across domains ──────────────────────────────────────


def _c5(graph, nodes, edges):
    """One PAIR, opposite signs across two domains.

    The fixture found the gap here, which is what a fixture is for. The
    interest profile is **actor-scoped**: it aggregates every act an actor took,
    across every counterpart. So X's hostility toward Y and X's warmth toward Z
    land in the same `political alignment` bucket and cancel to zero — the
    arithmetic is right and the finding is destroyed, because Case 5 is about a
    *pair* and the profile has no pair dimension.

    Computed here the way it would have to be computed for real, to show the
    shape of what is missing: walk actor → occurrence → counterpart and keep the
    counterpart on the key.
    """
    pair: dict[tuple[str, str, str], float] = {}
    by_id = {n.id: n for n in graph.nodes}
    for occ in graph.nodes:
        if occ.kind != "occurrence":
            continue
        inc = [e for e in graph.edges if e.source == occ.id]
        actors = [by_id[e.target].name for e in inc
                  if e.role == "by" and e.target in by_id]
        others = [by_id[e.target].name for e in inc
                  if e.role in ("with", "to", "concerns") and e.target in by_id]
        for e in inc:
            tgt = by_id.get(e.target)
            if not tgt or tgt.type != "Interest" or e.role not in ("serves", "opposes"):
                continue
            sign = -1.0 if e.role == "opposes" else 1.0
            for a in actors:
                for b in others:
                    pair[(a, b, tgt.name)] = pair.get((a, b, tgt.name), 0.0) + sign

    xy_econ = pair.get(("Directorate of Materiel Procurement", "Adriatic Systems AG", "incumbent renewal"), 0)
    xy_pol = pair.get(("Directorate of Materiel Procurement", "Adriatic Systems AG", "regulatory neutrality"), 0)
    flipped = xy_econ > 0 > xy_pol
    # The actor-scoped profile, for contrast — this is what the engine gives.
    x = next((n for n in graph.nodes if n.name == "Directorate of Materiel Procurement"), None)
    got = (x.group_value or {}) if x else {}
    return flipped, (
        f"pair X→Y: economic {xy_econ:+g} political {xy_pol:+g} — the flip. "
        f"actor-scoped profile collapses it to {got.get('political alignment', 0):+g}"
    )


# ─── Case 6 — how it unfolded ────────────────────────────────────────────────


def _c6(graph, nodes, edges):
    """Three days along one event spine, over nested places.

    Scoped to the incident's own occurrences — counting every dated node in the
    corpus made this pass on 22 "days" that had nothing to do with it, which is
    a check that could never fail.
    """
    by_name = {n.name: n for n in graph.nodes}
    strike = by_name.get("the Trieste leg")
    if strike is None:
        return False, "the event is absent"

    # Occurrences that declared themselves part of the strike.
    on_spine = {e.source for e in graph.edges
                if e.role == "during" and e.target == strike.id}
    days = sorted({n.t0[:10] for n in graph.nodes
                   if n.id in on_spine and n.t0})

    INNER, OUTER = "Trieste", "Friuli Venezia Giulia"
    nested = any(
        e.predicate == "part_of"
        and e.source == by_name[INNER].id
        and e.target == by_name[OUTER].id
        for e in graph.edges
    ) if {INNER, OUTER} <= set(by_name) else False

    within = any(e.role == "within" and e.source == strike.id
                 for e in graph.edges)
    ok = len(days) == 3 and nested and within
    return ok, (f"{len(days)} days on the spine {days} · "
                f"place nesting {nested} · event nesting {within}")


CASES: list[Case] = [
    Case("1", "convergence without contact",
         'serves:"erode multilateral oversight"+', _c1),
    Case("1r", "…and the residual says so", "", _c1_residual),
    Case("2", "a repeating method — the hub", "role:via", _c2),
    Case("2m", "…and the motif itself", "", _c2_motif,
         blocked_by="no `motif:` token — group_by reads a field, not a shape"),
    Case("3", "a concealed chain", "", _c3,
         blocked_by="no `path>N` token — degree> finds the wrong nodes"),
    Case("4", "asymmetry, concealed", "", _c4),
    Case("5", "divergence across domains", "", _c5,
         blocked_by="the interest profile is ACTOR-scoped; Case 5 needs it "
                    "PAIR-scoped, or X→Y hostility and X→Z warmth cancel"),
    Case("6", "how it unfolded", "", _c6,
         blocked_by="no place-granularity frame; nesting exists, zoom does not"),
]


def report(run_id: int, infospace_id: int | None = None) -> int:
    with Session(engine) as s:
        if infospace_id is None:
            infospace_id = int(s.execute(text(
                "SELECT infospace_id FROM annotationrun WHERE id = :r"
            ), {"r": run_id}).scalar())
        graph = assemble(s, run_id, infospace_id)

    print(f"\n  {len(graph.nodes)} nodes · {len(graph.edges)} edges")
    timed = sum(1 for n in graph.nodes if n.t0)
    placed = sum(1 for n in graph.nodes if n.places)
    quoted = sum(1 for n in graph.nodes if n.evidence)
    profiled = sum(1 for n in graph.nodes if isinstance(n.group_value, dict))
    print(f"  timed {timed}/{len(graph.nodes)} · placed {placed} · "
          f"quoted {quoted} · profiled {profiled}\n")

    print("── THE SIX SHAPES " + "─" * 52)
    failures = 0
    for c in CASES:
        nodes, edges = run_query(graph, c.query) if c.query else (
            list(graph.nodes), list(graph.edges))
        try:
            ok, saw = c.check(graph, nodes, edges)
        except Exception as exc:  # noqa: BLE001 — a broken check is a failure
            ok, saw = False, f"{type(exc).__name__}: {exc}"
        mark = "✅" if ok else "❌"
        failures += 0 if ok else 1
        print(f"  {mark} {c.id:3} {c.label:34} {saw}")
        if c.query:
            print(f"        {c.query}   → {len(nodes)}n {len(edges)}e")
        if c.blocked_by:
            print(f"        ⊘ {c.blocked_by}")
    print()
    return failures


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("run_id", type=int)
    raise SystemExit(1 if report(ap.parse_args().run_id) else 0)


if __name__ == "__main__":
    main()
