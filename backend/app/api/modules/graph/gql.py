"""GQL — the graph query language.

AQL's sibling. Same tokenizer, same ``[-]prefix:value`` grammar, same
comma-is-OR / space-is-AND / ``-``-is-NOT rules — so anyone who learned the
asset search bar already knows this one. What's added is the part a graph needs
and a flat list doesn't: **hops**.

.. code-block:: text

    merkel                          free text on node names
    type:Person  -type:Location     node type (an occurrence's node_type too)
    kind:occurrence  kind:entity    something that happened vs something that persists
    predicate:funds,owns            edge predicate
    role:via                        the role a participant plays
    role:via degree>20              role-SCOPED degree — how an intermediary
                                    is discovered rather than declared
    serves:opacity                  the WHY axis — who serves this interest
    serves:territorial_control+     …rolled up through `subsumes`
    confidence>0.8                  row property        (SQL pushdown)
    field:document.observations[*]  restrict to one projection
    after:2020 before:2023          temporal overlap
    from:"Angela Merkel" hops:2     traversal (hops count ACTOR steps)
    from:"E1" from:"E2"             AND — reachable from BOTH (co-presence)
    from:"E1","E2"                  OR  — reachable from EITHER
    degree>3  weight>2              graph-shape predicates
    near:"Berlin"<200km             spatial window

**Three tiers, and only the first touches SQL.** That split is the whole
design — it decides what can be pushed down and what fundamentally cannot:

1. **Row scope** — ``predicate:``, ``confidence>0.8``, ``field:``. Evaluated
   while reading rows, so filtered rows never enter the aggregation. Compiled
   per projection by ``AnnotationGraphSource`` against its own lateral element,
   which is why these are expressed *relative to the row* rather than as
   absolute JSONB paths: one query works across every projection.
2. **Graph-shape predicates** — ``type:``, ``degree>``, ``weight>``, ``after:``,
   ``near:``. These read properties that only exist *after* aggregation
   (degree needs the whole edge set; ``t0`` is a union across atoms), so no
   amount of cleverness pushes them into SQL.
3. **Traversal** — ``from:`` + ``hops:``. BFS over the assembled edge set.

**The honest limit.** Tiers 2 and 3 run over the *capped projection* — the
top-N nodes ``stream_graph`` kept, not the true graph. ``hops:3`` on a
5M-annotation run traverses that view. Surface it in the UI ("projection: top
1000 nodes") rather than implying otherwise. The eventual fix pushes ``from:``
down as a row predicate and iterates in SQL, which is the same grammar and no
user-visible change.
"""

from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Literal

from app.api.modules.content.query import _parse_comma_values, _strip_quotes, _tokenize

logger = logging.getLogger(__name__)

__all__ = [
    "GraphQuery",
    "RowCondition",
    "NearClause",
    "apply_to_graph",
    "parse",
]


_PREFIX_RE = re.compile(r"^(-)?([a-z_]+):([\s\S]+)$")
#: ``key`` + comparison + value, e.g. ``confidence>0.8`` or ``degree>=3``.
_CMP_RE = re.compile(r"^([a-zA-Z_][a-zA-Z0-9_.]*)\s*(>=|<=|==|!=|>|<)\s*(.+)$")
#: ``near:"Berlin"<200km`` — the radius rides on the value.
_RADIUS_RE = re.compile(r"^(.*?)\s*<\s*([0-9.]+)\s*(km|mi)?$", re.IGNORECASE)

Op = Literal[">", "<", ">=", "<=", "==", "!="]

#: Keys that name a graph-shape property rather than a row field. A bare
#: ``degree>3`` must not be pushed into SQL looking for a ``degree`` column.
_SHAPE_KEYS = frozenset({"degree", "weight", "mentions", "frequency", "converge"})
#: Climbs out of the exploded row to the annotation's document object.
_DOC_PREFIX = "doc."
#: The node's rendered display name, matched exactly.
_LABEL_KEYS = frozenset({"label", "name"})


@dataclass(frozen=True, slots=True)
class RowCondition:
    """A tier-1 predicate on a row key, relative to the exploded element.

    Row-relative rather than an absolute JSONB path so one query applies across
    every projection: ``confidence>0.8`` filters the confidence column of
    whichever array each projection reads.
    """

    key: str
    op: Op
    value: str

    @property
    def numeric(self) -> float | None:
        try:
            return float(self.value)
        except (TypeError, ValueError):
            return None


@dataclass(frozen=True, slots=True)
class NearClause:
    name: str
    radius_km: float


@dataclass
class GraphQuery:
    """A parsed GQL string. Mirrors ``content.query.ParsedQuery``'s shape."""

    text: str = ""
    types: list[str] = field(default_factory=list)
    excluded_types: list[str] = field(default_factory=list)
    predicates: list[str] = field(default_factory=list)
    excluded_predicates: list[str] = field(default_factory=list)
    fields: list[str] = field(default_factory=list)
    row_conditions: list[RowCondition] = field(default_factory=list)
    doc_conditions: list[RowCondition] = field(default_factory=list)
    """``doc.<field><op><value>`` — one level **up** from the exploded row, on
    the annotation's own document object.

    Tier 1 like ``row_conditions``, and for the same reason: a document-level
    predicate is the cheapest filter in the system — it discards whole
    annotations before a single row is exploded. It is also the one the
    questions actually start from. *"Only filings the model scored relevant"*
    and *"only this docket"* scope everything downstream, and without it you
    can only narrow the graph after paying to build all of it."""
    label_conditions: list[RowCondition] = field(default_factory=list)
    """``label=<value>`` — the node's display name, exactly.

    Tier 2: a label is what ``node_label`` rendered, which exists only after
    aggregation. Distinct from bare free text, which is a substring match on
    the same string — ``label=="Acme"`` is one node, ``Acme`` is every node
    that mentions it."""
    shape_conditions: list[RowCondition] = field(default_factory=list)
    after: str | None = None
    before: str | None = None
    seeds: list[list[str]] = field(default_factory=list)
    """One group per ``from:`` token. Comma inside a token is OR; separate
    tokens are **AND**, and the frontiers intersect.

    This is what makes *"who boarded planes with E1 **and** E2"* expressible.
    Seeds used to be a flat list, so every ``from:`` unioned — the co-presence
    question, which is the whole point of an occurrence with many participants,
    could not be asked at all.
    """
    hops: int | None = None
    keep_origin: bool = True
    """Does the seed itself survive the identity filters?

    Yes, by default. ``type:Location from:"E1" hops:2`` asks for the places
    around E1 — and E1 is not a Location, so the honest filter would drop the
    one node that explains why those places are on screen. The origin is the
    anchor of the question, not a result of it. ``hops:2-origin`` opts out for
    the cases where you genuinely want only the far end."""
    keep_paths: bool = True
    """Do the nodes that *connect* the results come back?

    Yes, by default. ``type:Location from:"E1" hops:2`` selects places, but
    every place hangs off an occurrence and every occurrence off an actor — so
    selecting strictly would return a scatter of unconnected dots and throw
    away the answer to "how". The connective nodes are re-admitted even where
    the identity filter would not have chosen them, because a traversal's
    output is a *path*, not a set. ``hops:2-paths`` opts out."""
    near: NearClause | None = None
    roles: list[str] = field(default_factory=list)
    serves: list[str] = field(default_factory=list)
    """``serves:opacity`` — nodes that participate in an occurrence serving
    that interest, plus the interest and the occurrences themselves.

    The ``why`` axis gets its own prefix rather than riding a generic
    "connected-to" form because it is the fourth quarter of the model and the
    question people actually type. ``serves:X+`` rolls up through ``subsumes``,
    so a licensing delay reaches the plan it belongs to — which is the whole
    point of an interest hierarchy: no actor ever states the plan, the
    structure reveals it."""
    serves_rollup: bool = False
    kinds: list[str] = field(default_factory=list)
    """``kind:occurrence`` / ``kind:entity``. Separate from ``type:`` because
    they answer different questions: ``kind`` is *what sort of node* (something
    that happened vs something that persists), ``type`` is the declared kind of
    thing — ``Payment``, ``Person``. An occurrence's ``node_type`` mirrors into
    ``type``, so ``type:Payment`` needs no new grammar."""

    # --- tier boundaries, so callers don't guess ---

    @property
    def has_row_scope(self) -> bool:
        """Anything compilable into the read query."""
        return bool(
            self.predicates or self.excluded_predicates
            or self.row_conditions or self.doc_conditions
        )

    @property
    def has_post(self) -> bool:
        """Anything that can only run on the assembled graph."""
        return bool(
            self.text or self.types or self.excluded_types or self.shape_conditions
            or self.after or self.before or self.seeds or self.near or self.roles
            or self.kinds or self.serves or self.label_conditions
        )

    @property
    def is_empty(self) -> bool:
        return not (self.has_row_scope or self.has_post or self.fields)


# ─── Parse ──────────────────────────────────────────────────────────────────


def parse(raw: str | None) -> GraphQuery:
    """Parse a GQL string. Never raises — an unparseable token becomes free
    text, matching AQL's behaviour and keeping a half-typed query harmless.
    """
    q = GraphQuery()
    if not raw or not raw.strip():
        return q

    text_parts: list[str] = []
    for token in _tokenize(raw.strip()):
        m = _PREFIX_RE.match(token)
        if m:
            negated, prefix, rest = m.group(1) == "-", m.group(2), m.group(3)
            if _apply_prefix(q, prefix, rest, negated):
                continue
            # Unknown prefix — fall through to free text rather than silently
            # dropping what the user typed.

        cmp_m = _CMP_RE.match(token)
        if cmp_m:
            key, op, val = cmp_m.group(1), cmp_m.group(2), _strip_quotes(cmp_m.group(3))
            cond = RowCondition(key=key, op=op, value=val)  # type: ignore[arg-type]
            low = key.lower()
            if low in _SHAPE_KEYS:
                q.shape_conditions.append(cond)
            elif low.startswith(_DOC_PREFIX):
                # ``doc.relevance>0.7`` — climbs out of the exploded row and
                # evaluates against the annotation's own document object. The
                # row is what happened; the document is where it was said.
                q.doc_conditions.append(
                    RowCondition(key=key[len(_DOC_PREFIX):], op=op, value=val)  # type: ignore[arg-type]
                )
            elif low in _LABEL_KEYS:
                # ``label=="Acme Ltd"`` — the node's own display name. Exact by
                # default, where bare free text is a substring match; asking for
                # one occurrence by name should not also return nine others that
                # merely contain it.
                q.label_conditions.append(cond)
            else:
                q.row_conditions.append(cond)
            continue

        text_parts.append(_strip_quotes(token))

    q.text = " ".join(p for p in text_parts if p).strip()
    return q


def _apply_prefix(q: GraphQuery, prefix: str, rest: str, negated: bool) -> bool:
    """Handle one ``prefix:value`` token. Returns False for unknown prefixes."""
    if prefix == "type":
        (q.excluded_types if negated else q.types).extend(_parse_comma_values(rest))
    elif prefix in ("predicate", "pred"):
        target = q.excluded_predicates if negated else q.predicates
        target.extend(_parse_comma_values(rest))
    elif prefix == "field":
        q.fields.extend(_parse_comma_values(rest))
    elif prefix == "role":
        q.roles.extend(_parse_comma_values(rest))
    elif prefix == "kind":
        q.kinds.extend(v.strip().lower() for v in _parse_comma_values(rest))
    elif prefix == "serves":
        for v in _parse_comma_values(rest):
            v = v.strip()
            if v.endswith("+"):
                q.serves_rollup = True
                v = v[:-1].strip()
            if v:
                q.serves.append(v)
    elif prefix == "after":
        q.after = _strip_quotes(rest)
    elif prefix == "before":
        q.before = _strip_quotes(rest)
    elif prefix == "from":
        # Each token is its own AND-group; commas inside it are OR.
        group = [v for v in _parse_comma_values(rest) if v.strip()]
        if group:
            q.seeds.append(group)
    elif prefix == "hops":
        # ``hops:<n>`` plus any number of ``-flag`` suffixes, in any order.
        #
        # **A ``-flag`` always subtracts.** Both things it can subtract are on
        # by default, because a traversal you can read is one that shows you
        # the anchor you named and how each result connects back to it:
        #
        #   hops:2               the neighbourhood, with origin and connections
        #   hops:2-origin        …without the node you started from
        #   hops:2-paths         …without the connective tissue: only what the
        #                        identity filter actually selected
        #   hops:2-origin-paths  both, in either order
        #
        # Anything else fails the token rather than being ignored, so a typo
        # shows up as a free-text pill instead of silently changing nothing.
        parts = [p.strip().lower() for p in _strip_quotes(rest).strip().split("-")]
        if not parts:
            return False
        for flag in parts[1:]:
            if flag == "origin":
                q.keep_origin = False
            elif flag in ("path", "paths"):
                q.keep_paths = False
            else:
                return False
        try:
            # Clamped: hops beyond a handful reaches the whole component on any
            # real graph, so a large value is always a typo rather than intent.
            q.hops = max(0, min(int(parts[0]), 10))
        except ValueError:
            return False
    elif prefix == "near":
        rm = _RADIUS_RE.match(rest)
        if rm:
            name = _strip_quotes(rm.group(1).strip())
            radius = float(rm.group(2))
            if (rm.group(3) or "km").lower() == "mi":
                radius *= 1.609344
            q.near = NearClause(name=name, radius_km=radius)
        else:
            # No radius given — a sane default beats rejecting the token.
            q.near = NearClause(name=_strip_quotes(rest), radius_km=50.0)
    else:
        return False
    return True


# ─── Tier 2 + 3: apply to the assembled graph ───────────────────────────────


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def _cmp(lhs: float | None, op: str, rhs: float | None) -> bool:
    if lhs is None or rhs is None:
        return False
    if op == ">":
        return lhs > rhs
    if op == "<":
        return lhs < rhs
    if op == ">=":
        return lhs >= rhs
    if op == "<=":
        return lhs <= rhs
    if op == "==":
        return lhs == rhs
    if op == "!=":
        return lhs != rhs
    return False


def _overlaps(t0: str | None, t1: str | None, after: str | None, before: str | None) -> bool:
    """Does an interval intersect ``[after, before]``?

    Untimed atoms pass. The window narrows what *has* time rather than hiding
    what doesn't — a graph where half the nodes are undated should not lose
    them the moment a date filter is typed. Comparison is lexicographic, which
    is chronological for the ISO strings the engine emits.
    """
    if t0 is None and t1 is None:
        return True
    if before is not None and t0 is not None and t0 > before:
        return False
    # ``t1 is None`` means open-ended — still alive, so an ``after`` bound
    # can never exclude it.
    if after is not None and t1 is not None and t1 < after:
        return False
    return True


def _haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def apply_to_graph(q: GraphQuery, nodes: list[Any], edges: list[Any]) -> tuple[list, list]:
    """Filter an assembled graph by the post-aggregation half of *q*.

    Order matters and is deliberate:

    1. node predicates → a kept-node set
    2. edges pruned to kept endpoints, then edge predicates (weight, time)
    3. ``degree`` — computed on the *surviving* edges, because a degree filter
       means "well connected in what I'm looking at", not "in the raw graph"
    4. traversal from seeds, last, over the **structural** graph (below)
    5. drop orphaned edges

    **Identity filters select; they do not block paths.** ``type``, ``-type``,
    ``kind``, ``role`` and free text say *what you want to see*. Time, space and
    the edge predicates say *what graph you are in*. Only the second kind
    constrains a traversal, and keeping them apart is what makes
    ``type:Location from:"E1" hops:2`` mean "the places within two hops of E1".

    Folding them together — filter everything first, then walk what survives —
    reads plausibly and fails two ways, both silently:

    * The seed is usually not of the type you asked for. ``type:Location
      from:"E1"`` filtered E1 out before he could seed, so the answer was
      **empty**.
    * Every actor-to-actor connection runs *through* an occurrence, and a
      ``type:`` filter deletes those. ``type:Person from:"Merkel" hops:2``
      pruned away the very edges :func:`_adjacency` contracts, so the walk
      could not move and returned the seed alone.

    A path-scoped constraint ("walk only through people") is a real, different
    query. It wants its own token; it was never what ``type:`` meant.

    Returns new lists; inputs are untouched.
    """
    if not q.has_post:
        return nodes, edges

    types = {_norm(t) for t in q.types}
    ex_types = {_norm(t) for t in q.excluded_types}
    roles = {_norm(r) for r in q.roles}
    text = _norm(q.text)

    # near: resolve the anchor from the graph's own geocoded nodes.
    origin: tuple[float, float] | None = None
    if q.near:
        want = _norm(q.near.name)
        for n in nodes:
            if getattr(n, "lat", None) is None:
                continue
            if _norm(getattr(n, "name", "")) == want or _norm(getattr(n, "place", "")) == want:
                origin = (n.lat, n.lon)
                break
        if origin is None:
            logger.info("gql near:%r — no geocoded node matches; ignoring", q.near.name)

    kinds = {_norm(k) for k in q.kinds}

    def node_structural_ok(n: Any) -> bool:
        """When and where — the graph the question is being asked *of*.

        These bound the world, so a traversal must respect them: "two hops from
        E1 in 2003" should not route through a 2019 meeting.
        """
        if (q.after or q.before) and not _overlaps(
            getattr(n, "t0", None), getattr(n, "t1", None), q.after, q.before,
        ):
            return False
        if origin is not None and q.near is not None:
            lat, lon = getattr(n, "lat", None), getattr(n, "lon", None)
            if lat is None or lon is None:
                return False   # a spatial window is meaningless for unplaced nodes
            if _haversine_km(origin[0], origin[1], lat, lon) > q.near.radius_km:
                return False
        return True

    def node_identity_ok(n: Any) -> bool:
        """What sort of thing — the answer you want back.

        Never applied to a traversal's path. You are asking which Locations sit
        near E1, not for a route made only of Locations.
        """
        ntype = _norm(getattr(n, "type", ""))
        if kinds and _norm(getattr(n, "kind", "entity")) not in kinds:
            return False
        if types and ntype not in types:
            return False
        if ntype in ex_types:
            return False
        if text and text not in _norm(getattr(n, "name", "")):
            return False
        if roles and not (roles & {_norm(r) for r in (getattr(n, "roles", None) or ())}):
            return False
        for c in q.label_conditions:
            name = _norm(getattr(n, "name", ""))
            want = _norm(c.value)
            if c.op in ("==", "="):
                if name != want:
                    return False
            elif c.op == "!=":
                if name == want:
                    return False
            # Ordering operators on a label are meaningless; ignore rather than
            # reject, so a half-typed `label>` does not empty the canvas.
        return True

    # The world the traversal walks, before anything about *what* is wanted.
    reachable = {n.id for n in nodes if node_structural_ok(n)}
    kept = {n.id for n in nodes if n.id in reachable and node_identity_ok(n)}

    if q.serves:
        kept &= _serving(q, nodes, edges)

    converge_conds = [c for c in q.shape_conditions if c.key.lower() == "converge"]
    if converge_conds:
        # Paired over the STRUCTURAL set, not the identity-filtered one. A pair
        # is the unit here, so filtering first removes the partner and the
        # finding with it — ``converge>0.6 label=="Acme"`` would answer nothing
        # because Acme has nobody left to converge with. Same trap the
        # traversal had.
        kept &= _converging(converge_conds, nodes, edges, reachable)

    def edge_props_ok(e: Any) -> bool:
        """Everything about an edge that does not depend on its endpoints.

        Split out because role-scoped degree has to count edges whose *other*
        end was filtered away. ``role:via degree>20`` asks "how many payments
        does this bank route", and the payments themselves are occurrences that
        ``role:`` just excluded from the node set — counting only surviving
        edges would answer zero, every time.
        """
        if (q.after or q.before) and not _overlaps(
            getattr(e, "t0", None), getattr(e, "t1", None), q.after, q.before,
        ):
            return False
        for c in q.shape_conditions:
            if c.key.lower() != "weight":
                continue
            val = getattr(e, "computed_weight", None)
            if val is None:
                val = getattr(e, "weight", None)
            if not _cmp(
                float(val) if val is not None else None, c.op, c.numeric,
            ):
                return False
        return True

    def edge_ok(e: Any) -> bool:
        return e.source in kept and e.target in kept and edge_props_ok(e)

    live_edges = [e for e in edges if edge_ok(e)]

    # degree / mentions — on the surviving subgraph, not the raw one.
    degree_conds = [c for c in q.shape_conditions if c.key.lower() == "degree"]
    count_conds = [
        c for c in q.shape_conditions if c.key.lower() in ("mentions", "frequency")
    ]
    if degree_conds or count_conds:
        # **Role-scoped degree.** With a ``role:`` in play, ``degree>`` counts
        # only edges in that role. "Bank C is ``via`` in 340 payments" is a
        # finding; "Bank C has 340 connections" is a shrug — and counting every
        # edge would let an entity qualify on connections that have nothing to
        # do with the role being asked about. This is how an intermediary is
        # discovered rather than declared.
        # With a role in play, count over every edge in that role — including
        # ones whose far end the node filter removed. Without one, count the
        # surviving subgraph: "well connected in what I'm looking at".
        degree_edges = (
            [e for e in edges
             if edge_props_ok(e) and _norm(getattr(e, "role", None)) in roles]
            if roles else live_edges
        )
        degree: dict[str, int] = {}
        for e in degree_edges:
            degree[e.source] = degree.get(e.source, 0) + 1
            degree[e.target] = degree.get(e.target, 0) + 1
        kept = {
            nid for nid in kept
            if all(_cmp(float(degree.get(nid, 0)), c.op, c.numeric) for c in degree_conds)
        }
        by_id = {n.id: n for n in nodes}
        kept = {
            nid for nid in kept
            if all(
                _cmp(float(getattr(by_id[nid], "frequency", 0) or 0), c.op, c.numeric)
                for c in count_conds
            )
        }
        live_edges = [e for e in live_edges if e.source in kept and e.target in kept]

    # Traversal last — over the structural graph, so the walk can pass through
    # the occurrences and the off-type entities that actually connect things,
    # and the identity filter then selects from what it reached.
    if q.seeds:
        trav_edges = [
            e for e in edges
            if e.source in reachable and e.target in reachable and edge_props_ok(e)
        ]
        t = _traverse(q, nodes, trav_edges, reachable)
        # Identity selects from the neighbourhood the walk found — including
        # its occurrences, or ``kind:occurrence from:"E1"`` would intersect
        # against actors only and answer nothing.
        kept &= t.neighbourhood
        if t.neighbourhood:
            # The origin stays unless asked to leave. You typed a name; the
            # graph answering without it is disorienting, and under an identity
            # filter the seed is usually the one node that *cannot* match — E1
            # is a Person, and you asked for Locations.
            if q.keep_origin:
                kept |= t.origins
            # …and so is everything that connects the answers to it.
            if q.keep_paths:
                kept |= _connective(kept, t)
                kept |= {
                    occ for occ, members in t.occurrences.items()
                    if len(members & kept) >= min(2, len(members))
                }
        # Rebuild from the full edge set, not from ``live_edges``. Those were
        # pruned to endpoints surviving the *identity* filter, so an edge to a
        # node the traversal just re-admitted was already gone — and the answer
        # came back as unconnected dots with the connections computed and then
        # discarded.
        live_edges = [
            e for e in edges
            if e.source in kept and e.target in kept and edge_props_ok(e)
        ]
    else:
        live_edges = [e for e in live_edges if e.source in kept and e.target in kept]

    return [n for n in nodes if n.id in kept], live_edges


#: How far apart two actors can be before the walk gives up. An interest graph
#: is small and the penalty is flat past a handful of hops anyway.
_CONVERGE_MAX_HOPS = 6
#: Pairwise, so this is quadratic. Bounded rather than unbounded because the
#: alternative is a query that works on a demo and hangs on a real corpus.
_CONVERGE_MAX_ACTORS = 400


def _profile_of(node: Any) -> dict[str, float] | None:
    """A node's interest vector, when it has one.

    Written by :func:`stream.attach_neighbour_profiles` — computed from the
    edge set, never asserted by a row.
    """
    # `profile`, never `group_value`. That slot holds whatever the panel asked
    # to group by, and this function will cosine any dict it is handed: under
    # `node_group_by: "roles"` it held a role histogram, so `converge>` scored
    # two intermediaries a perfect 1.0 for both being intermediaries a lot.
    # Reading the typed field makes that unreachable rather than unlikely.
    g = getattr(node, "profile", None)
    if not isinstance(g, dict):
        return None
    # Negatives are kept. A profile is signed — an act that OPPOSES an interest
    # subtracts (``stream.OPPOSING_ROLES``) — and filtering to positives threw
    # away exactly the half that makes adversaries distinguishable from
    # strangers. Zero is still dropped: it means the entry cancelled out, which
    # is no information rather than a weak signal.
    out = {
        str(k): float(v) for k, v in g.items()
        if isinstance(v, (int, float)) and float(v) != 0
    }
    return out or None


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    dot = sum(v * b[k] for k, v in a.items() if k in b)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na > 0 and nb > 0 else 0.0


def _distance_penalty(hops: int | None) -> float:
    """Zero at one hop, rising toward 1 with distance.

    **This is the whole idea.** Two actors who already work together converging
    on an interest is not a finding — it is a description. The same convergence
    across six hops, with nothing joining them, is either coordination without
    contact or an independent response to the same incentive, and telling those
    two apart is the analytical work. Unreachable pairs get the full weight.
    """
    if hops is None:
        return 1.0
    if hops <= 1:
        return 0.0
    return 1.0 - 1.0 / hops


def _converging(
    conds: list[RowCondition], nodes: list[Any], edges: list[Any], allowed: set[str],
) -> set[str]:
    """Nodes in at least one pair whose convergence residual passes.

    ``residual = cosine(profileA, profileB) × distancePenalty(hops)``

    Mirrors ``hud/convergence.ts`` exactly, because a pane and a query that
    disagreed about the same number would be worse than having only one of
    them. The pane ranks pairs; this filters the graph to the actors in them,
    so ``serves:X+ converge>0.6`` composes with everything else.
    """
    actors = [
        n for n in nodes
        if n.id in allowed
        and _norm(getattr(n, "kind", "entity")) != "occurrence"
        and _profile_of(n) is not None
    ][:_CONVERGE_MAX_ACTORS]
    if len(actors) < 2:
        return set()

    profiles = {n.id: _profile_of(n) for n in actors}
    adjacency, _ = _adjacency(nodes, edges, {n.id for n in nodes})

    def hops_between(start: str, targets: set[str]) -> dict[str, int]:
        seen = {start: 0}
        frontier = {start}
        for depth in range(1, _CONVERGE_MAX_HOPS + 1):
            nxt = {
                peer for nid in frontier
                for peer in adjacency.get(nid, ())
                if peer not in seen
            }
            if not nxt:
                break
            for peer in nxt:
                seen[peer] = depth
            frontier = nxt
        return {t: seen[t] for t in targets if t in seen}

    ids = {n.id for n in actors}
    out: set[str] = set()
    for i, a in enumerate(actors):
        dists = hops_between(a.id, ids)
        for b in actors[i + 1:]:
            if a.id in out and b.id in out:
                continue
            sim = _cosine(profiles[a.id], profiles[b.id])
            if sim <= 0:
                continue
            residual = sim * _distance_penalty(dists.get(b.id))
            if all(_cmp(residual, c.op, c.numeric) for c in conds):
                out.add(a.id)
                out.add(b.id)
    return out


#: Predicates a ``serves:X+`` rollup follows to reach the acts that belong to a
#: broader goal. Two different claims, both worth following, and the difference
#: is worth keeping in mind when reading a result:
#:
#: * **containment** — ``subsumes``/``includes``/``comprises``. X is made up of
#:   Y; a mundane licensing delay rolls up to the plan it is a component of.
#: * **advancement** — ``furthers``. Y is not part of X and advances it anyway.
#:   This is the ordering that gives an interest a *direction* rather than a
#:   nesting, and the one an author is realistically able to state: documents
#:   say "to secure confirmation, and thereby control of the department" far
#:   more often than they lay out a taxonomy.
#:
#: ``furthers`` is here rather than in a second set because the rollup question
#: — *what acts bear on this goal* — has the same answer for both, and two
#: tokens meaning almost the same thing is how a query language stops being
#: readable.
#:
#: **They point in opposite directions, and that is the whole subtlety.**
#: "A subsumes B" runs broad → narrow, so rolling up from A walks *forward*.
#: "B furthers A" runs narrow → broad, because that is how the sentence reads
#: and how a document states it — so rolling up from A walks *backward*. Putting
#: both in one set and walking forward silently expanded nothing, which is a
#: rollup that returns the interest alone and looks like "no acts serve this".
_SUBSUMES = frozenset({"subsumes", "includes", "comprises"})
#: Same rollup, edge reversed. See above.
_FURTHERS = frozenset({"furthers", "advances", "supports_goal"})


def _serving(
    q: GraphQuery, nodes: list[Any], edges: list[Any],
) -> set[str]:
    """Everything that serves one of ``q.serves`` — the ``why`` filter.

    Returns the interest itself, the occurrences serving it, **and** their
    participants. All three are wanted: the actors are the answer, the
    occurrences are what they did, and the interest anchors the cluster. A
    filter that kept only the actors would strip the evidence out from under
    the finding.

    With ``+``, the target set first expands down the interest hierarchy, so
    ``serves:territorial_control+`` reaches a licensing delay nobody would have
    thought to ask for. Two edge families, walked in opposite directions —
    ``subsumes`` forward, ``furthers`` backward (see the sets above). Traversal
    is breadth-first with a visited set — an interest graph is small, and a
    cycle must not hang a query.
    """
    by_id = {n.id: n for n in nodes}
    wants = {_norm(s) for s in q.serves}

    targets = {
        n.id for n in nodes
        if _norm(getattr(n, "name", "")) in wants
    }
    if not targets:
        return set()

    if q.serves_rollup:
        # Expand down the hierarchy: X, plus everything that rolls up to X —
        # what X subsumes, and what furthers X.
        frontier, seen = set(targets), set(targets)
        while frontier:
            nxt: set[str] = set()
            for e in edges:
                pred = _norm(getattr(e, "predicate", ""))
                if pred in _SUBSUMES:
                    if e.source in frontier and e.target not in seen:
                        nxt.add(e.target)
                elif pred in _FURTHERS:
                    if e.target in frontier and e.source not in seen:
                        nxt.add(e.source)
            if not nxt:
                break
            seen |= nxt
            frontier = nxt
        targets = seen

    # Occurrences touching a target interest, then their participants.
    occurrences = {
        e.source for e in edges
        if e.target in targets
        and (by_id.get(e.source) is not None)
        and getattr(by_id[e.source], "kind", "entity") == "occurrence"
    }
    participants = {
        e.target for e in edges if e.source in occurrences
    }
    return targets | occurrences | participants


def _adjacency(
    nodes: list[Any], edges: list[Any], allowed: set[str],
) -> tuple[dict[str, set[str]], set[str]]:
    """Undirected adjacency, with **occurrences contracted**.

    A hop means "one step to another actor". Once a row is a node, an actor and
    their neighbour are two edges apart rather than one — ``actor → payment →
    actor`` — so a literal BFS silently halves the reach of every ``hops:``
    query ever written. Contracting occurrences restores the user's meaning:
    the participants of an occurrence become adjacent to each other, and the
    occurrence itself is reachable but does not consume a hop.

    Returns ``(adjacency, occurrence_members)`` — the second maps each
    occurrence to its participants, so callers can re-admit the occurrences
    that sit between reached actors. You asked who is two hops away, but you
    still want to see *what* connected them.
    """
    occurrences = {
        n.id for n in nodes
        if n.id in allowed and getattr(n, "kind", "entity") == "occurrence"
    }
    incident: dict[str, set[str]] = {}
    adjacency: dict[str, set[str]] = {}

    for e in edges:
        s, t = e.source, e.target
        for a, b in ((s, t), (t, s)):
            if a in occurrences and b not in occurrences:
                incident.setdefault(a, set()).add(b)
        if s not in occurrences and t not in occurrences:
            adjacency.setdefault(s, set()).add(t)
            adjacency.setdefault(t, set()).add(s)

    # Participants of one occurrence are one hop from each other.
    for members in incident.values():
        for m in members:
            adjacency.setdefault(m, set()).update(members - {m})
    return adjacency, incident


@dataclass
class Traversal:
    """What a walk found, kept separate from what will be *shown*.

    The identity filter has no say in any of this — it selects afterwards, from
    ``neighbourhood``. Keeping the two apart is what lets ``-paths`` be a
    presentation choice rather than a different traversal.
    """

    #: Every actor within ``hops``, and the occurrences that join them.
    neighbourhood: set[str] = field(default_factory=set)
    #: Actors only — the walk contracts occurrences, so these are its real steps.
    actors: set[str] = field(default_factory=set)
    #: What the ``from:`` tokens matched.
    origins: set[str] = field(default_factory=set)
    #: BFS predecessor per actor, for reconstructing the route back to an origin.
    parents: dict[str, str] = field(default_factory=dict)
    #: occurrence id -> its participants.
    occurrences: dict[str, set[str]] = field(default_factory=dict)


def _traverse(
    q: GraphQuery, nodes: list[Any], edges: list[Any], allowed: set[str],
) -> Traversal:
    """BFS from ``from:`` seeds, ``hops:`` deep, within *allowed*.

    Seeds match on node name (case-insensitive, substring) so a user can type
    part of a label. ``hops`` defaults to 1 — asking to start *from* something
    without saying how far obviously means its neighbours, not just itself.
    A seed that matches nothing yields an empty graph rather than the whole
    thing: silently ignoring the constraint would be the worse surprise.

    **Seed groups intersect.** ``from:"E1" from:"E2"`` reaches what is within
    ``hops`` of *both*, which is how co-presence is asked. Commas inside one
    token still union, so ``from:"E1","E2"`` keeps the old meaning.

    Hops count **actor** steps (see :func:`_adjacency`). The occurrences that
    link reached actors are added back at the end, because the answer to "who
    is near E1" is not useful without what put them there.

    Returns a :class:`Traversal` — the neighbourhood, the origins, and the BFS
    tree. The caller decides what of it to show.
    """
    groups = [[_norm(s) for s in g if s.strip()] for g in q.seeds]
    groups = [g for g in groups if g]
    if not groups:
        return Traversal()

    adjacency, occ_members = _adjacency(nodes, edges, allowed)
    actor_nodes = [n for n in nodes if n.id in allowed and n.id not in occ_members]
    depth = q.hops if q.hops is not None else 1

    origins: set[str] = set()
    parents: dict[str, str] = {}
    reached_per_group: list[set[str]] = []
    for wants in groups:
        frontier = {
            n.id for n in actor_nodes
            if any(w in _norm(getattr(n, "name", "")) for w in wants)
        }
        if not frontier:
            # An unsatisfiable seed means an empty answer.
            return Traversal(origins=origins, occurrences=occ_members)
        origins |= frontier
        reached = set(frontier)
        for _ in range(depth):
            nxt: set[str] = set()
            for nid in frontier:
                for peer in adjacency.get(nid, ()):
                    if peer in allowed and peer not in reached and peer not in nxt:
                        nxt.add(peer)
                        # First arrival wins, so the recorded route is a
                        # shortest one — which is the route worth drawing.
                        parents.setdefault(peer, nid)
            if not nxt:
                break
            reached |= nxt
            frontier = nxt
        reached_per_group.append(reached)

    actors = set.intersection(*reached_per_group)
    if not actors:
        return Traversal(origins=origins, parents=parents, occurrences=occ_members)

    # The occurrences that *justify* the traversal — the ones joining two
    # reached actors. Touching a single reached actor is not enough: a second
    # flight that E2 took without E1 does not belong in "one hop from E1", and
    # admitting it would show a connection the traversal never made.
    #
    # A one-participant occurrence (a statement, a filing) is the exception —
    # it connects nobody by construction, so it rides along with its author.
    joined = {
        occ for occ, members in occ_members.items()
        if len(members & actors) >= min(2, len(members))
    }
    return Traversal(
        neighbourhood=actors | joined,
        actors=actors,
        origins=origins,
        parents=parents,
        occurrences=occ_members,
    )


def _connective(kept: set[str], t: Traversal) -> set[str]:
    """The nodes that make *kept* a picture rather than a scatter.

    Each selected node's route back to its origin, plus the occurrences along
    the way. A traversal's answer is a path — *"Paris is two hops from Epstein"*
    is only worth showing alongside *how*, and under an identity filter the
    entire "how" is made of nodes that filter excludes by construction.
    """
    out: set[str] = set()
    frontier: set[str] = set()
    for nid in kept:
        members = t.occurrences.get(nid)
        if members:
            # An occurrence stands in the actor graph through its participants.
            reachable_members = members & t.actors
            out |= reachable_members
            frontier |= reachable_members
        else:
            frontier.add(nid)

    for nid in frontier:
        cur, guard = nid, 0
        while cur in t.parents and guard < 64:
            cur = t.parents[cur]
            out.add(cur)
            guard += 1

    return out


# ─── Tier 1: row-scope compilation ──────────────────────────────────────────


def row_predicate_sql(
    q: GraphQuery,
    predicate_expr: str,
    param_prefix: str = "gql",
    doc_accessor: Any = None,
) -> tuple[list[str], dict[str, Any]]:
    """SQL fragments for the row-scope tier, evaluated on the lateral ``elem``.

    *predicate_expr* is the projection's already-built predicate accessor, so
    a projection that calls its predicate ``relation`` still filters correctly.

    *doc_accessor* is ``(path, param_prefix) -> (sql, params)`` for a path on
    the **annotation root**, supplied by the caller because only it knows the
    three storage conventions an annotation may be written in. Absent, ``doc.``
    conditions are skipped rather than silently mis-scoped onto the row.

    Values are bound, never inlined. Numeric-looking comparands cast to float
    via the same regex gate ``AnnotationQuery`` uses, so one dirty cell can't
    fault the whole scan.
    """
    clauses: list[str] = []
    params: dict[str, Any] = {}

    if q.predicates:
        params[f"{param_prefix}_pred"] = [p.strip().lower() for p in q.predicates]
        clauses.append(f"LOWER(TRIM({predicate_expr})) = ANY(:{param_prefix}_pred)")
    if q.excluded_predicates:
        params[f"{param_prefix}_npred"] = [
            p.strip().lower() for p in q.excluded_predicates
        ]
        clauses.append(
            f"COALESCE(LOWER(TRIM({predicate_expr})), '') "
            f"<> ALL(:{param_prefix}_npred)"
        )

    # Row conditions read the exploded element; ``doc.`` conditions read the
    # annotation's document object one level up. Same operators, same binding,
    # same numeric gate — only the accessor differs, so they compile together.
    scoped: list[tuple[str, RowCondition, str]] = [
        (f"elem->>'{c.key.replace(chr(39), chr(39) * 2)}'", c, f"{param_prefix}_rc{i}")
        for i, c in enumerate(q.row_conditions)
    ]
    if q.doc_conditions and doc_accessor is not None:
        for i, c in enumerate(q.doc_conditions):
            acc_sql, acc_params = doc_accessor(
                f"document.{c.key}", param_prefix=f"{param_prefix}_dc{i}p",
            )
            params.update(acc_params)
            scoped.append((acc_sql, c, f"{param_prefix}_dc{i}"))

    for acc, c, pname in scoped:
        num = c.numeric
        if num is not None and c.op in (">", "<", ">=", "<="):
            params[pname] = num
            # Gate the cast: an LLM-extracted column is free text, and a
            # strict ``::float`` raises on the first non-numeric cell.
            clauses.append(
                f"(CASE WHEN ({acc}) ~ '^[[:space:]]*-?[0-9]+(\\.[0-9]+)?[[:space:]]*$' "
                f"THEN ({acc})::float ELSE NULL END) {c.op} :{pname}"
            )
        elif c.op in ("==", "="):
            params[pname] = c.value
            clauses.append(f"({acc}) = :{pname}")
        elif c.op == "!=":
            params[pname] = c.value
            clauses.append(f"COALESCE({acc}, '') <> :{pname}")
        else:
            params[pname] = c.value
            clauses.append(f"({acc}) {c.op} :{pname}")

    return clauses, params


def projection_allowed(q: GraphQuery, path: str) -> bool:
    """Does ``field:`` admit this projection?

    Skipping a whole projection is strictly better than filtering its rows
    afterwards — the scan never happens. Compared explosion-insensitively so
    ``field:document.observations`` and ``…[*]`` both work.
    """
    if not q.fields:
        return True
    want = {f.replace("[*]", "").strip().lower() for f in q.fields}
    return path.replace("[*]", "").strip().lower() in want
