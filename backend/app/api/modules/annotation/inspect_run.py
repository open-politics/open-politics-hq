"""Assess a run against the observation model, from the command line.

    docker compose exec -T backend python -m app.api.modules.annotation.inspect_run 12424

Reviewing a run by hand means a dozen ad-hoc queries and a judgement call about
what "good" looks like. This encodes the judgement: the conventions a schema in
this model is supposed to obey, checked against what a model actually wrote.

It reports three things, in the order they matter:

**Fill** — which bindings the model populated. A field the graph depends on and
the model never fills is the single most useful thing to learn from a run, and
it is invisible from the canvas because an empty binding renders as *nothing*
rather than as an error.

**Discipline** — the conventions that make linking work. Names used in a row and
absent from their roster; the same name in two rosters with two types (which
splits into two nodes, because identity is ``name + type``); invented event
names; unparseable dates.

**The graph** — what actually assembles, so a fill rate can be read against the
thing it produces.

Read-only. Nothing here writes.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from collections import Counter, defaultdict
from typing import Any

from sqlmodel import Session, text

from app.api.modules.annotation.panel_config import (
    GraphConfig, Projection, derive_doc_anchors, resolve_projections,
)
from app.api.modules.annotation.schema_map import schema_map_for
from app.core.db import engine

#: Bindings whose absence quietly costs a capability, and what it costs.
#: Only reported for sections the contract actually declares.
WATCHED: dict[str, dict[str, str]] = {
    "observations": {
        "kind": "node type — without it every act is one undifferentiated type",
        "by": "who acted",
        "via": "the hub slot; role:via degree is the facilitator question",
        "to": "who it was done to",
        "when": "the time cursor",
        "modality": "edge painting AND evidence stance; empty renders as asserted",
        "magnitude": "size and sort",
        "serves": "the why axis; interest clustering and converge>",
        "opposes": "valence; without it a profile cannot tell an ally from an "
                   "adversary, only a stranger",
        "during": "the referent layer; lanes by event",
        "cites": "the link to named grounds",
        "justification": "the quote behind the claim",
    },
    "statements": {  # v1 vocabulary, still in the wild
        "speaker": "who said it", "modality": "edge painting and evidence stance",
        "said_on": "the time cursor", "refers_to_start": "the second clock",
        "serves": "the why axis", "justification": "the quote behind the claim",
    },
    "events": {"name": "identity — an event without one cannot be referenced",
               "when": "the band on the timeline"},
    "attributes": {"subject": "what the property is about",
                   "from": "the interval; without it nothing drifts on the slider"},
    "relations": {"predicate": "what the link is", "from_date": "the interval"},
    "evidence": {"name": "identity — what `cites` points at",
                 "quote": "the words", "stance": "how it bears"},
}

ROSTERS = ("actors", "instruments", "objects", "places", "interests")


def _doc(value: Any) -> dict:
    """Annotations are stored wrapped or unwrapped; both are in the wild."""
    if isinstance(value, dict):
        inner = value.get("document")
        return inner if isinstance(inner, dict) else value
    return {}


def _filled(v: Any) -> bool:
    if v is None:
        return False
    if isinstance(v, (list, dict, str)):
        return len(v) > 0
    return True


#: Types that are their OWN section rather than roster members. A `during` names
#: an event and a `cites` names an exhibit; neither belongs in a roster, so
#: counting them as orphans reported a schema obeying the model as breaking it.
_NON_ROSTER_TYPES = frozenset({"event", "evidence"})


def _names(v: Any, *, roster_only: bool = False) -> list[str]:
    """Entity names out of a slot, scalar or list.

    ``roster_only`` drops references to sections that are not rosters, which is
    what the orphan check wants — an event is named in ``events[*]`` and an
    exhibit in ``evidence[*]``.
    """
    items = v if isinstance(v, list) else [v]
    out = []
    for i in items:
        if not (isinstance(i, dict) and isinstance(i.get("name"), str)
                and i["name"].strip()):
            continue
        if roster_only and str(i.get("type", "")).strip().lower() in _NON_ROSTER_TYPES:
            continue
        out.append(i["name"])
    return out


def inspect(run_id: int) -> None:
    from app.api.modules.graph.stream import _as_ts

    with Session(engine) as s:
        run = s.execute(
            text("SELECT id, name, status, infospace_id FROM annotationrun WHERE id=:r"),
            {"r": run_id},
        ).fetchone()
        if not run:
            print(f"run {run_id}: not found")
            return
        rows = s.execute(
            text("""SELECT a.id, a.schema_id, sc.name, a.value FROM annotation a
                    JOIN annotationschema sc ON sc.id = a.schema_id
                    WHERE a.run_id = :r"""), {"r": run_id}).fetchall()
        if not rows:
            print(f"run {run_id}: no annotations")
            return
        schema_id = rows[0][1]
        contract = s.execute(
            text("SELECT output_contract FROM annotationschema WHERE id=:i"),
            {"i": schema_id}).scalar()

    props = (contract.get("properties") or {})
    sections = list((props.get("document", {}).get("properties") or props).keys())

    print(f"RUN {run[0]} · {run[1]} · {run[2]}")
    print(f"schema {schema_id} · {rows[0][2]} · {len(rows)} annotations")
    print(f"sections: {', '.join(sections)}")

    # ── fill ────────────────────────────────────────────────────────────────
    counts: dict[str, Counter] = defaultdict(Counter)
    totals: Counter = Counter()
    roster_of: dict[str, set[str]] = defaultdict(set)
    type_of: dict[str, set[str]] = defaultdict(set)
    referenced: set[str] = set()
    bad_dates: list[tuple[str, str]] = []
    event_names: set[str] = set()
    cited: set[str] = set()
    evidence_names: set[str] = set()

    for _aid, _sid, _sname, value in rows:
        doc = _doc(value)
        for r in ROSTERS:
            for e in (doc.get(r) or []):
                if isinstance(e, dict) and e.get("name"):
                    roster_of[r].add(e["name"])
                    type_of[e["name"]].add(f"{r}:{e.get('type')}")
        for name in (doc.get("events") or []):
            if isinstance(name, dict) and name.get("name"):
                event_names.add(name["name"])
        for ev in (doc.get("evidence") or []):
            if isinstance(ev, dict) and ev.get("name"):
                evidence_names.add(ev["name"])

        for section, watched in WATCHED.items():
            for row in (doc.get(section) or []):
                if not isinstance(row, dict):
                    continue
                totals[section] += 1
                for fld in watched:
                    if _filled(row.get(fld)):
                        counts[section][fld] += 1
                for k, v in row.items():
                    referenced.update(_names(v, roster_only=True))
                    if k in ("when", "until", "said_on", "from", "to", "from_date",
                             "covers_from", "covers_until") and isinstance(v, str) and v.strip():
                        if _as_ts(v) is None:
                            bad_dates.append((f"{section}.{k}", v))
                for c in _names(row.get("cites")):
                    cited.add(c)

    print()
    print("── FILL " + "─" * 62)
    for section, watched in WATCHED.items():
        n = totals[section]
        if not n:
            continue
        print(f"\n  {section}[*]  ({n} rows)")
        for fld, why in watched.items():
            got = counts[section][fld]
            bar = "█" * round(10 * got / n) + "·" * (10 - round(10 * got / n))
            flag = "  ← EMPTY" if got == 0 else ("" if got == n else "  ← partial")
            print(f"    {fld:16} {got:3}/{n:<3} {bar}{flag}")
            if got == 0:
                print(f"    {'':16} costs: {why}")

    # ── discipline ──────────────────────────────────────────────────────────
    print()
    print("── DISCIPLINE " + "─" * 56)
    all_roster = {n for names in roster_of.values() for n in names}
    orphans = sorted(referenced - all_roster)
    print(f"\n  rosters: " + " · ".join(f"{k} {len(v)}" for k, v in roster_of.items() if v))
    print(f"  names referenced in rows: {len(referenced)}")
    if orphans:
        print(f"  NOT in any roster: {len(orphans)}  ← these still become nodes,")
        print(f"     but the roster is meant to be the vocabulary")
        for o in orphans[:8]:
            print(f"       {o}")
    else:
        print("  every referenced name is in a roster  ✓")

    split = {n: t for n, t in type_of.items() if len(t) > 1}
    if split:
        print(f"\n  SAME NAME, DIFFERENT TYPE — splits into {len(split)} pairs of nodes")
        print("     identity is name+type, so these do not merge:")
        for n, t in list(split.items())[:8]:
            print(f"       {n:34} {sorted(t)}")
    else:
        print("  no name carries two types  ✓")

    if bad_dates:
        print(f"\n  UNPARSEABLE DATES: {len(bad_dates)}  ← fall back to the doc rung,")
        print("     which usually saves the timeline but hides a prompt problem")
        for path, v in bad_dates[:6]:
            print(f"       {path:28} {v!r}")

    dangling = sorted(cited - evidence_names)
    if cited:
        print(f"\n  citations: {len(cited)} distinct, {len(dangling)} with no evidence row")
        for d in dangling[:5]:
            print(f"       {d}")
    if event_names:
        print(f"  events named: {len(event_names)}  {sorted(event_names)[:5]}")

    # ── the graph ───────────────────────────────────────────────────────────
    print()
    print("── GRAPH " + "─" * 61)
    _assemble(run[3], run_id, contract)

    # ── what the PANEL is actually showing ──────────────────────────────────
    print()
    print("── PANEL " + "─" * 61)
    _panel(run_id)


def _assemble(infospace_id: int, run_id: int, contract: dict) -> None:
    """Build the graph the way the panel does, from inferred projections."""
    from app.api.modules.annotation.query import AnnotationQuery
    from app.api.modules.graph.stream import AnnotationGraphSource, collect_graph

    smap = schema_map_for(contract)
    # No projections declared → the engine derives them from the schema map,
    # which is exactly what an unconfigured panel now gets.
    resolved = resolve_projections(GraphConfig(), smap=smap)
    # …and so are the doc anchors. Omitting them here reported `timed 0/12` on a
    # run the panel times perfectly well, which is the one thing a tool like
    # this must never do: the whole point is to say what the user will see.
    anchors = derive_doc_anchors(smap)

    print("  derived projections (what an unconfigured panel would run):")
    for p in resolved:
        roles = ", ".join(r.label or r.path for r in p.nodes) or "—"
        bound = [k for k in ("node_type_path", "time", "place", "activity",
                             "weight", "evidence") if getattr(p, k, None)]
        kind = "" if p.node_kind == "occurrence" else f" [{p.node_kind}]"
        print(f"    {p.path:32} about={str(p.about):8}{kind} {' · '.join(bound)}")
        print(f"    {'':32} roles: {roles}")

    with Session(engine) as s:
        aq = AnnotationQuery(s, infospace_id).scope(None).runs([run_id])
        src = AnnotationGraphSource(
            query=aq, projections=list(resolved),
            doc_place=anchors["doc_place"], doc_time=anchors["doc_time"])
        result = asyncio.run(collect_graph(
            s, infospace_id, src, top_n_nodes=None, top_n_edges=None))

    print(f"\n  {len(result.nodes)} nodes · {len(result.edges)} edges")
    print("  by kind: " + json.dumps(dict(Counter(n.kind for n in result.nodes))))
    print("  by type: " + json.dumps(dict(Counter(n.type for n in result.nodes).most_common(10))))
    roles = Counter(e.role for e in result.edges if e.role)
    if roles:
        print("  edge roles: " + json.dumps(dict(roles.most_common(12))))
    print(f"  timed: {sum(1 for n in result.nodes if n.t0)}/{len(result.nodes)}"
          f"   placed: {sum(1 for n in result.nodes if n.places)}/{len(result.nodes)}"
          f"   with quotes: {sum(1 for n in result.nodes if n.evidence)}/{len(result.nodes)}")


def _panel(run_id: int) -> None:
    """What the run's own graph panel is configured to show.

    Distinct from the section above, which asks *what could be graphed*. This
    asks what a user opening the run actually sees — and the gap between the
    two is the thing worth knowing.

    An empty ``projections`` no longer means "one array": ``resolve_projections``
    derives the full set from the schema map and only falls back to the legacy
    ``source`` when nothing is derivable. So the honest report is that the
    section above *is* what this panel runs — the stale version of this warning
    sent a reader chasing a bug that had already been fixed.
    """
    with Session(engine) as s:
        vc = s.execute(
            text("SELECT views_config FROM annotationrun WHERE id=:r"),
            {"r": run_id}).scalar()

    panels = [
        p for v in (vc or []) if isinstance(v, dict)
        for p in (v.get("panels") or []) if p.get("type") == "graph"
    ]
    if not panels:
        print("  no graph panel on this run")
        return

    for p in panels:
        cfg = p.get("panel_config") or {}
        projections = cfg.get("projections") or []
        print(f"  {p.get('name')!r}")
        if projections:
            print(f"    {len(projections)} projections:")
            for pr in projections:
                bound = [k for k in ("about", "node_type_path", "node_name",
                                     "time", "place", "activity", "weight",
                                     "evidence", "properties") if pr.get(k)]
                print(f"      {pr.get('path'):34} {' · '.join(bound) or 'path only'}")
        else:
            src = cfg.get("source")
            print("    projections: none configured — the panel DERIVES them")
            print("    from the schema map, so it runs exactly the set above.")
            if src:
                print(f"    source: {src!r}  (legacy; ignored while derivation succeeds)")
            print("    Which is the intended state: a schema written in the")
            print("    model graphs itself. The panel's two surfaces are the")
            print("    axis budget (three axes, four frames) and the layer")
            print("    stack (these projections, read off the wire).")
        for k in ("q", "node_group_by", "edge_group_by", "doc_place", "doc_time"):
            if cfg.get(k):
                print(f"    {k}: {cfg[k]!r}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("run_id", type=int)
    inspect(ap.parse_args().run_id)


if __name__ == "__main__":
    main()
