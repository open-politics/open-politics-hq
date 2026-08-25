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
    serves:"port access"+           …rolled up through `subsumes`; the `+`
                                    survives quoting, and every interest worth
                                    rolling up is multi-word
    confidence>0.8                  row property        (SQL pushdown)
    field:document.observations[*]  restrict to one projection
    after:2020 before:2023          temporal overlap
    from:"Angela Merkel" hops:2     traversal (hops count ACTOR steps)
    from:"E1" from:"E2"             AND — reachable from BOTH (co-presence)
    from:"E1","E2"                  OR  — reachable from EITHER
    degree>3  weight>2              graph-shape predicates
    converge>0.6                    interest affinity between two actors
    converge>0.6 contact>2          …and nothing within two hops joins them:
                                    alignment the graph does not explain
    near:"Berlin"<200km             spatial window

**``converge`` and ``contact`` are two tokens on purpose.** They were one
number — ``cosine × distancePenalty(hops)`` — and the penalty was pinned to 0
at one hop, so a shared interest (exactly two hops, through the interest node)
capped the result at 0.5 and ``converge>0.6`` was empty by arithmetic. A
distance penalty is not a weight; it is a **set difference written as a
multiplication**, and multiplying cannot express one.

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
from app.core.filters import scalar_of

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
#:
#: ``:`` is an operator here and means exactly what ``==`` means. It is tried
#: **after** ``_PREFIX_RE``, so every reserved prefix keeps its meaning and only
#: an unrecognised ``foo:bar`` reaches this rule — which is the whole fix: on
#: run 15010 ``modality:done`` used to fall through to a substring search on
#: node names and return an empty canvas, silently, for the most natural
#: spelling in the language. ``:`` is also the Lucene / KQL / JQL spelling and
#: therefore the one a model reaches for first.
_CMP_RE = re.compile(
    r"^([a-zA-Z_][a-zA-Z0-9_.\[\]*]*)\s*(>=|<=|==|!=|>|<|:)\s*(.+)$"
)
#: ``near:"Berlin"<200km`` — the radius rides on the value.
_RADIUS_RE = re.compile(r"^(.*?)\s*<\s*([0-9.]+)\s*(km|mi)?$", re.IGNORECASE)

Op = Literal[">", "<", ">=", "<=", "==", "!=", "in"]


# ─── The grammar, once ───────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class TokenDoc:
    """One token of the filter grammar, described in one place.

    The grammar used to be written out four times — this module's docstring,
    ``GRAPH_QUERY.md``, ``GQL_PREFIXES``/``GQL_EXAMPLES`` in the TypeScript
    mirror, and the MCP tool description — so adding one token meant eight hand
    edits and the four copies taught different things. They are generated from
    here now.

    ``semantics`` is **not optional**, and that is the lesson from the copy
    that worked best: the MCP description was the most useful of the four
    precisely because it carried the gotchas rather than the syntax. A table of
    ``(prefix, hint)`` pairs would generate a *worse* prompt than the one it
    replaced.
    """

    token: str
    tier: int
    """1 pushed into SQL · 2 on the assembled graph · 3 traversal. Drives the
    bar's pill colour, and it is the honest cost signal: tier 1 scales with the
    corpus, tiers 2 and 3 are bounded by the node cap."""
    hint: str
    semantics: str | None = None
    example: str | None = None
    values: str | None = None
    """Which declared value space this draws from, for autocomplete and for the
    context packet — ``interests`` means "the run's interest roster", not a
    literal."""

    @property
    def prefix(self) -> str:
        """``serves:<interest>`` → ``serves:``. Empty for comparison tokens."""
        head = self.token.split(":", 1)[0]
        return f"{head}:" if ":" in self.token and "<" not in head else ""


TOKENS: tuple[TokenDoc, ...] = (
    TokenDoc("<text>", 2, "Free text — substring match on node names.",
             semantics="An unparseable token becomes this rather than an "
                       "error, so a half-typed query is harmless. The cost is "
                       "that a typo'd prefix silently becomes a name search.",
             example="merkel"),
    TokenDoc("type:<type>", 2, "Node entity type; an occurrence's node_type too.",
             semantics="An IDENTITY filter: it selects, and never blocks a "
                       "traversal path.",
             example="type:Person,Organization", values="entity types"),
    TokenDoc("kind:<kind>", 2, "occurrence (happened) vs entity (persists).",
             example="kind:occurrence", values="occurrence | entity"),
    TokenDoc("role:<role>", 2, "The slot a node occupied in its occurrence.",
             semantics="With `degree>` this becomes role-SCOPED degree, which "
                       "is how an intermediary is discovered rather than "
                       "declared: `via` in 340 payments is a finding, 340 "
                       "connections is a shrug.",
             example="role:via degree>20", values="role slots"),
    TokenDoc("serves:<interest>", 2, "The why axis — who serves this interest.",
             semantics="A trailing `+` rolls up through `subsumes` and walks "
                       "`furthers` backward, so a mundane licensing delay "
                       "reaches the plan it belongs to. The `+` survives "
                       "quoting, which matters because interests are "
                       "multi-word far more often than not.",
             example='serves:"port privatisation"+', values="interests"),
    TokenDoc("predicate:<pred>", 1, "Edge predicate.",
             example="predicate:funds,owns", values="predicates"),
    TokenDoc("field:<path>", 1, "Restrict to one projection.",
             semantics="The scan for every other projection never happens, so "
                       "this is the cheapest filter in the language.",
             example="field:document.observations[*]", values="projection paths"),
    TokenDoc("SECTION:<section>", 1, "Restrict to one section, by its own name.",
             semantics="The readable spelling of `field:` — the engine resolves "
                       "`places` to `document.places[*]` against this run, so "
                       "nobody has to know the contract's internal path to ask "
                       "about its content. Same tier, same cost: a skipped "
                       "projection is a scan that never happens.",
             example="SECTION:places", values="section names"),
    TokenDoc("<field><op><value>", 1, "Any column on the exploded row.",
             semantics="Numeric comparisons are guarded: a non-numeric value "
                       "compares as NULL rather than raising.",
             example="confidence>0.8"),
    TokenDoc("doc.<field><op><value>", 1, "A field on the DOCUMENT, not the row.",
             semantics="Climbs out of the exploded row to the annotation's own "
                       "object. The row is what happened; the document is "
                       "where it was said.",
             example="doc.relevance>0.7"),
    TokenDoc("label==<name>", 2, "The node's own name, matched EXACTLY.",
             semantics="Exact where bare free text is a substring, because "
                       "asking for one occurrence by name should not also "
                       "return nine that merely contain it.",
             example='label=="Deutsche Bank"'),
    TokenDoc("degree><n>", 2, "Edge count on the surviving subgraph.",
             semantics="Counts edges whose far end was filtered out, so "
                       "`role:via degree>20` still answers 'how many payments "
                       "does this bank route'. Corrupted by corpus mix in a "
                       "mixed infospace — see WEIGHT(ref:corpus).",
             example="degree>3"),
    TokenDoc("weight><n>", 2, "Edge attestation.", example="weight>2"),
    TokenDoc("mentions><n>", 2, "How often a node was named.", example="mentions>5"),
    TokenDoc("converge><n>", 2, "Interest affinity between two actors, [-1, 1].",
             semantics="A cosine over interest profiles, and NOTHING else. It "
                       "used to be multiplied by a distance penalty, which "
                       "capped it at 0.5 forever because sharing an interest "
                       "puts two actors at exactly two hops. Pair with "
                       "`contact` for the finding.",
             example="converge>0.6 contact>2"),
    TokenDoc("contact><n>", 2, "Graph distance, in hops, to the actor it converges with.",
             semantics="Unreachable pairs pass every floor: no path at all is "
                       "the STRONGEST form of 'without contact', not a missing "
                       "value.",
             example="converge>0.6 contact>2"),
    TokenDoc("after:<date>", 2, "Interval overlap — undated items are KEPT.",
             example="after:2020-01"),
    TokenDoc("before:<date>", 2, "Interval overlap — undated items are KEPT.",
             example="before:2023"),
    TokenDoc("near:<place><<n>km", 2, "Within a radius of a geocoded node.",
             example='near:"Berlin"<200km', values="place names"),
    TokenDoc("from:<name>", 3, "Traversal seed — substring match on node names.",
             semantics="Separate `from:` tokens INTERSECT (reachable from "
                       "BOTH — the co-presence question); commas inside one "
                       "token union.",
             example='from:"E1" from:"E2"'),
    TokenDoc("hops:<n>", 3, "How far to walk. Default 1, max 10.",
             semantics="Hops count ACTOR steps — occurrences are contracted, "
                       "so actor→occurrence→actor is ONE hop. `-origin` and "
                       "`-paths` each SUBTRACT, in any order.",
             example="hops:2-origin-paths"),
    TokenDoc("ANY(<q>, <q>)", 2, "The union of several sub-queries.",
             semantics="The one grouping form. Composes by intersection with "
                       "everything else, so ANY(...) type:Organization reads "
                       "as it looks. A pinned node, edge, cluster and interest "
                       "are each already a query fragment, which is what makes "
                       "a pin page one string.",
             example='ANY(label=="Acme", serves:"port access"+) type:Organization'),
)


def token_table() -> list[dict[str, Any]]:
    """``TOKENS`` as plain dicts — for the TS mirror and the context packet."""
    return [
        {
            "token": t.token, "tier": t.tier, "hint": t.hint,
            "semantics": t.semantics, "example": t.example, "values": t.values,
        }
        for t in TOKENS
    ]


def grammar_block() -> str:
    """The filter half of the grammar, as prose, from :data:`TOKENS`.

    Sibling of ``channels.grammar_block``. Together they are the whole
    language, generated, so the MCP tool description and the in-bar reference
    cannot teach different things.
    """
    lines = [
        "GQL filters what is in the set. Space is AND, a comma inside a value "
        "is OR, a leading `-` is NOT, quotes carry spaces.",
        "",
        "Three tiers — only the first reaches SQL:",
        "  1  row scope       filtered rows never enter the aggregation",
        "  2  graph shape     needs the assembled graph (degree, intervals)",
        "  3  traversal       BFS over the assembled edge set, last",
        "",
    ]
    for tier in (1, 2, 3):
        lines.append(f"TIER {tier}")
        for t in TOKENS:
            if t.tier != tier:
                continue
            lines.append(f"  {t.token:<26} {t.hint}")
            if t.semantics:
                lines.append(f"  {'':<26} → {t.semantics}")
            if t.example:
                lines.append(f"  {'':<26} e.g. {t.example}")
        lines.append("")
    return "\n".join(lines)

#: Keys that name a graph-shape property rather than a row field. A bare
#: ``degree>3`` must not be pushed into SQL looking for a ``degree`` column.
_SHAPE_KEYS = frozenset({
    "degree", "weight", "mentions", "frequency",
    # Two readings of the same pair, deliberately separate. ``converge`` is
    # affinity, ``contact`` is graph distance in hops. Multiplying them into one
    # residual capped the answer at 0.5 forever; see :func:`_converging`.
    "converge", "contact",
})
#: Climbs out of the exploded row to the annotation's document object.
_DOC_PREFIX = "doc."
#: The node's rendered display name, matched exactly.
_LABEL_KEYS = frozenset({"label", "name"})

#: ``doc.<key>`` names that resolve to a COLUMN on ``annotation`` rather than a
#: path inside its JSON value. Cast to text so they compile through the same
#: comparison machinery as every other condition — one code path, one set of
#: operators, one numeric gate.
_DOC_COLUMNS: dict[str, str] = {
    "asset_id": "a.asset_id::text",
    "run_id": "a.run_id::text",
    "schema_id": "a.schema_id::text",
    "id": "a.id::text",
}


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
    #: Set when a comma list gave several accepted values — `kind:a,b`. The
    #: engine compiles them to one `= ANY(...)`, which is what a comma has
    #: always meant everywhere else in the language.
    values: tuple[str, ...] = ()

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

    notes: list[str] = field(default_factory=list)
    """What the reader has to know to trust the answer.

    The language's failure mode has never been an error — it is a query that
    parses, runs, and returns a plausible wrong set. ``kind:payment`` on a
    contract whose acts state their type in a field called ``kind`` returns an
    empty canvas; ``ANY(a:1, b:2)`` used to return the whole graph. Both look
    exactly like a true negative and a true positive.

    So anything the parser resolves in a way the writer might not have meant
    lands here and is rendered as an amber pill. Never an exception: a
    half-typed query is a normal state of a text box, and refusing to run it is
    worse than running it and saying what happened.
    """

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
    alternatives: list["GraphQuery"] = field(default_factory=list)
    """``ANY(<q>, <q>, …)`` — the union of several sub-queries.

    The one grouping form in the language, and the reason it exists is pins: a
    pinned node, a pinned edge, a pinned cluster and a pinned interest vector
    are each already expressible as a query fragment, so a pin *page* is their
    union and nothing more. Without grouping there is nowhere to put the comma.

    Composes by intersection with whatever else the query says, so
    ``ANY(label=="A", serves:"port access"+) type:Organization`` reads as it
    looks: either of those, narrowed to organisations. This also closes the
    subquery-seed gap the filter reference has listed as missing."""

    # --- tier boundaries, so callers don't guess ---

    @property
    def has_row_scope(self) -> bool:
        """Anything compilable into the read query.

        Includes an ``ANY(…)`` whose every branch speaks at this tier — the
        union compiles to one ``OR`` in the same WHERE. Branches that mix tiers
        are decided after assembly, and reporting row scope for those would ask
        the SQL to filter rows a later tier still needs.
        """
        return bool(
            self.predicates or self.excluded_predicates
            or self.row_conditions or self.doc_conditions
            or (self.alternatives
                and all(a.row_conditions for a in self.alternatives))
        )

    @property
    def has_post(self) -> bool:
        """Anything that can only run on the assembled graph."""
        return bool(
            self.text or self.types or self.excluded_types or self.shape_conditions
            or self.after or self.before or self.seeds or self.near or self.roles
            or self.kinds or self.serves or self.label_conditions
            or self.alternatives
        )

    @property
    def is_empty(self) -> bool:
        return not (self.has_row_scope or self.has_post or self.fields)


# ─── Parse ──────────────────────────────────────────────────────────────────


_ANY_RE = re.compile(r"\bANY\s*\(", re.IGNORECASE)


def _split_commas_at_depth_zero(body: str) -> list[str]:
    """Comma-split, ignoring commas inside quotes or nested parens."""
    out, buf, depth, quote = [], [], 0, None
    for ch in body:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "'\"":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == "," and depth == 0:
            out.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    if buf:
        out.append("".join(buf))
    return [s for s in (x.strip() for x in out) if s]


def _extract_any(raw: str) -> tuple[str, list[str]]:
    """Pull every ``ANY(...)`` group out, returning the rest and the bodies.

    Done before tokenising because the shared AQL tokenizer splits on spaces
    and knows nothing about parentheses — it would shred ``ANY(a, b c)`` into
    pieces that each parse to something plausible and wrong. An unclosed
    ``ANY(`` is left in the string as free text rather than raising, keeping
    the half-typed case harmless like every other token.
    """
    bodies: list[str] = []
    out: list[str] = []
    i = 0
    while True:
        m = _ANY_RE.search(raw, i)
        if not m:
            out.append(raw[i:])
            break
        out.append(raw[i:m.start()])
        depth, j, quote = 1, m.end(), None
        while j < len(raw) and depth:
            ch = raw[j]
            if quote:
                if ch == quote:
                    quote = None
            elif ch in "'\"":
                quote = ch
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            j += 1
        if depth:                       # never closed — leave it alone
            out.append(raw[m.start():])
            break
        bodies.append(raw[m.end():j - 1])
        i = j
    return "".join(out), bodies


def parse(raw: str | None) -> GraphQuery:
    """Parse a GQL string. Never raises — an unparseable token becomes free
    text, matching AQL's behaviour and keeping a half-typed query harmless.
    """
    q = GraphQuery()
    if not raw or not raw.strip():
        return q

    # `BY` is not a channel and not a filter — it is the fold clause, deferred
    # in the MVP. It parses as free text today, which means writing it narrows
    # the canvas by name-matching "by" and reports nothing.
    if re.search(r"\bBY\s+[a-z_]", raw, re.IGNORECASE):
        q.notes.append(
            "BY is not implemented yet — the fold clause is deferred, and this "
            "token currently does nothing",
        )

    raw, any_bodies = _extract_any(raw)
    for body in any_bodies:
        for part in _split_commas_at_depth_zero(body):
            sub = parse(part)
            if sub.has_post or sub.has_row_scope:
                q.alternatives.append(sub)
    if not raw.strip():
        return q

    text_parts: list[str] = []
    for token in _tokenize(raw.strip()):
        m = _PREFIX_RE.match(token)
        if m:
            negated, prefix, rest = m.group(1) == "-", m.group(2), m.group(3)
            if _apply_prefix(q, prefix, rest, negated):
                continue
            if prefix in RESERVED_PREFIXES:
                # A **reserved** prefix that refused its value is malformed —
                # `hops:2-orgin`. Now that `:` is a row-condition operator it
                # would otherwise be reinterpreted as a filter on a field
                # called `hops`, which is a second silent misreading of an
                # already-wrong token. Falls to free text so it stays visible.
                text_parts.append(_strip_quotes(token))
                continue
            # Unknown prefix — falls through to the comparison rule, where
            # `foo:bar` becomes a row condition. That is the point: an
            # unreserved `modality:done` is a filter on the row, not a
            # substring search for the word "done" in node names.

        cmp_m = _CMP_RE.match(token)
        if cmp_m:
            key, op, val = cmp_m.group(1), cmp_m.group(2), _strip_quotes(cmp_m.group(3))
            # `:` is `==`. Normalised at the boundary so nothing downstream has
            # to know two spellings exist — one operator set, one code path.
            op = "==" if op == ":" else op
            cond = RowCondition(key=key, op=op, value=val)  # type: ignore[arg-type]
            # **A comma is OR over values, on every token.** It already was for
            # the reserved prefixes (`type:Person,Organization`) and was not for
            # a row condition, so `observations.kind:payment,acquisition`
            # compiled to a literal match against the string
            # "payment,acquisition" and returned nothing. One composition rule,
            # stated in the docs, true in one half of the language.
            #
            # Equality only: `magnitude>1,2` is not a range and pretending it is
            # would be a second meaning for the same punctuation.
            if op == "==" and "," in val:
                alts = tuple(v.strip() for v in val.split(",") if v.strip())
                if len(alts) > 1:
                    cond = RowCondition(key=key, op="in", value=val,  # type: ignore[arg-type]
                                        values=alts)
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


#: Prefixes the language owns. A token spelling one of these means what the
#: grammar says it means, whatever a schema happens to call its own fields —
#: which is why `kind:payment` cannot filter an observation's `kind` column and
#: `observations.kind:payment` is the spelling that can.
RESERVED_PREFIXES: frozenset[str] = frozenset({
    "type", "predicate", "pred", "field", "role", "kind", "serves",
    "after", "before", "from", "hops", "near",
})


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
        vals = [v.strip().lower() for v in _parse_comma_values(rest)]
        q.kinds.extend(vals)
        # `kind:` is RESERVED and means occurrence-vs-entity. The observation
        # model's own contracts state an act's type in a field literally called
        # `kind` — so the most natural query anyone would write on that data,
        # `kind:payment`, hits the reserved word, matches neither node kind, and
        # returns an empty canvas that looks exactly like a true negative.
        #
        # The collision is not resolvable by preference: demoting the reserved
        # meaning would break every query that means it, and promoting it
        # silently is what happens today. So it is REPORTED, with both spellings
        # that do work.
        for v in vals:
            if v not in ("occurrence", "entity"):
                q.notes.append(
                    f"kind:{v} — `kind:` is reserved for occurrence|entity. "
                    f"For a field called kind write `<section>.kind:{v}`; "
                    f"for a node's declared type write `type:{v}`.",
                )
    elif prefix == "serves":
        for v in _parse_comma_values(rest):
            # **Strip the rollup marker before the quotes, not after.**
            # ``_parse_comma_values`` unquotes, so ``serves:"port access"+``
            # arrived here as ``port access"+`` — the trailing quote sat between
            # the value and the ``+``, the suffix test failed, and the whole
            # token became a literal search for an interest whose name ends in
            # a plus sign. It matched nothing and reported nothing, and since
            # every interest worth rolling up is multi-word, the ``+`` operator
            # was unreachable for exactly the queries it exists to serve.
            v = v.strip()
            if v.endswith("+"):
                q.serves_rollup = True
                v = v[:-1].strip()
            v = _strip_quotes(v)
            if v.endswith("+"):          # ``serves:"port access+"`` — inside
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

    if q.alternatives:
        # ``ANY(a, b) type:Organization`` — the union of the branches, then
        # narrowed by whatever else the query says. Each branch runs the whole
        # pipeline, so a branch may traverse, filter on shape, or be a bare
        # label; that is the property that lets a pin page be one string.
        union: set[str] = set()
        for alt in q.alternatives:
            alt_nodes, _ = apply_to_graph(alt, nodes, edges)
            union |= {n.id for n in alt_nodes}
        kept &= union

    if q.serves:
        kept &= _serving(q, nodes, edges)

    converge_conds = [c for c in q.shape_conditions if c.key.lower() == "converge"]
    contact_conds = [c for c in q.shape_conditions if c.key.lower() == "contact"]
    if converge_conds or contact_conds:
        # Paired over the STRUCTURAL set, not the identity-filtered one. A pair
        # is the unit here, so filtering first removes the partner and the
        # finding with it — ``converge>0.6 label=="Acme"`` would answer nothing
        # because Acme has nobody left to converge with. Same trap the
        # traversal had.
        kept &= _converging(converge_conds, contact_conds, nodes, edges, reachable)

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
    # Values are magnitudes; the direction lives in the KEY
    # (``stream._profile_key`` appends a pole marker). Negatives are still
    # accepted rather than filtered, because a profile written by an older run
    # carries the signed form and dropping half of it would silently overstate
    # similarity — the exact drift the parity fixture exists to catch.
    #
    # Zero is dropped. Under the two-sided key a zero can only mean an entry
    # nobody contributed to; it can no longer mean "cancelled out", which is
    # what made dropping it destroy the ambivalence finding.
    out = {
        str(k): float(v) for k, v in g.items()
        if isinstance(v, (int, float)) and float(v) != 0
    }
    return out or None


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    dot = sum(v * b[k] for k, v in a.items() if k in b)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na <= 0 or nb <= 0:
        return 0.0
    # Clamped, because floating point does not respect the definition: two
    # identical profiles come out at 1.0000000000000002, and `converge>1.0`
    # then matches every pair that should have been the ceiling. The old
    # distance multiplication hid this by scaling everything down.
    return max(-1.0, min(1.0, dot / (na * nb)))


#: What ``contact`` reports for a pair nothing connects.
#:
#: **Infinite, not a large number.** These are the *most* uncontacted pairs
#: there are, so they must pass every floor a person can type — and a finite
#: sentinel silently excludes them the moment someone writes a threshold above
#: it, which is the strongest form of the finding disappearing without a word.
_NO_CONTACT = float("inf")


def _converging(
    conds: list[RowCondition],
    contact_conds: list[RowCondition],
    nodes: list[Any],
    edges: list[Any],
    allowed: set[str],
) -> set[str]:
    """Nodes in at least one pair passing every ``converge``/``contact`` test.

    ``converge`` is affinity — ``cosine(profileA, profileB)``, spanning
    ``[-1, 1]``. ``contact`` is graph distance between the same two, in hops.

    **These were one number and should never have been.** The residual used to
    be ``cosine × distancePenalty(hops)``, with the penalty pinned to 0.0 at one
    hop and rising toward 1.0 with distance. The intent was right — two actors
    who already work together converging on an interest is a description, not a
    finding — but a penalty is not how you say it. Sharing an interest puts two
    actors at *exactly two hops* through the interest node itself, where the
    penalty is 0.5, so the residual could never exceed 0.5 and ``converge>0.6``
    was empty by arithmetic. It appears as a worked example in three documents.

    The distance penalty was never a weight. It was a **set difference**
    implemented as multiplication, and you cannot multiply your way to a set
    operation. So the two are separate tests over the same pair::

        converge>0.6                  aligned, whoever they are
        converge>0.6 contact>2        aligned, and nothing within two hops
                                      joins them — the actual finding
        converge>0.6 contact<2        aligned and already working together

    Mirrors ``hud/convergence.ts``, because a pane and a query disagreeing about
    the same number would be worse than having only one of them. The pane ranks
    pairs; this filters the graph to the actors in them, so
    ``serves:X+ converge>0.6 contact>2`` composes with everything else.
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
            if not all(_cmp(sim, c.op, c.numeric) for c in conds):
                continue
            hops = dists.get(b.id, _NO_CONTACT)
            if not all(_cmp(float(hops), c.op, c.numeric) for c in contact_conds):
                continue
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
    section: str | None = None,
    sections: "frozenset[str] | set[str] | None" = None,
) -> tuple[list[str], dict[str, Any]]:
    """SQL fragments for the row-scope tier, evaluated on the lateral ``elem``.

    *predicate_expr* is the projection's already-built predicate accessor, so
    a projection that calls its predicate ``relation`` still filters correctly.

    *doc_accessor* is ``(path, param_prefix) -> (sql, params)`` for a path on
    the **annotation root**, supplied by the caller because only it knows the
    three storage conventions an annotation may be written in. Absent, ``doc.``
    conditions are skipped rather than silently mis-scoped onto the row.

    *section* is the section being read right now and *sections* is every
    section name this run has. Together they make a condition **addressable**:
    ``observations.magnitude>100000`` filters observations and leaves places
    alone, where the same condition written bare narrows every section that
    states a magnitude and is silent about the ones that do not. See
    ``_row_accessor``, and ``MVP.md`` "Addressing".

    Values are bound, never inlined. Numeric-looking comparands cast to float
    via the same regex gate ``AnnotationQuery`` uses, so one dirty cell can't
    fault the whole scan.
    """
    clauses: list[str] = []
    params: dict[str, Any] = {}
    sections = sections or frozenset()

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
    # ``ANY(a, b)`` — the alternatives' ROW halves, unioned.
    #
    # They were dropped entirely: `row_predicate_sql` read only the top-level
    # conditions, so `ANY(observations.kind:payment, observations.kind:statement)`
    # filtered nothing and returned all 102 nodes of run 15010. A union that
    # silently widens to the whole graph is worse than one that refuses, because
    # it is indistinguishable from a correct broad answer.
    #
    # An alternative with NO row conditions makes the union vacuous — its branch
    # is decided post-assembly (`ANY(type:Person, observations.kind:payment)`),
    # and filtering rows for it here would delete the very rows its own tier
    # needs. So the union applies only when every branch speaks at this tier.
    if q.alternatives:
        branches: list[str] = []
        for j, alt in enumerate(q.alternatives):
            if not alt.row_conditions:
                branches = []
                break
            sub_clauses, sub_params = row_predicate_sql(
                alt, predicate_expr, f"{param_prefix}_a{j}", doc_accessor,
                section, sections,
            )
            if sub_clauses:
                params.update(sub_params)
                branches.append("(" + " AND ".join(sub_clauses) + ")")
        if branches:
            clauses.append("(" + " OR ".join(branches) + ")")

    scoped: list[tuple[str, RowCondition, str]] = []
    #: Conditions whose absence must not delete the row — see ``_row_accessor``.
    lenient: set[str] = set()
    for i, c in enumerate(q.row_conditions):
        acc = _row_accessor(c, section, sections)
        if acc is None:
            # Addressed to a different section. Skipping is the whole point:
            # `observations.magnitude>1e5` is a statement about observations,
            # and evaluating it against `places` yields NULL > 1e5 = false,
            # which silently deletes every place in the graph.
            continue
        pname = f"{param_prefix}_rc{i}"
        scoped.append((acc, c, pname))
        if "." not in c.key:
            lenient.add(pname)
    for i, c in enumerate(q.doc_conditions):
        # A handful of `doc.` keys are COLUMNS on the annotation, not fields in
        # its JSON. `doc.asset_id` is the one that matters: it is how "show this
        # document in the graph" is written, and there is no path in any payload
        # that carries it — the row's own identity lives in the table.
        col = _DOC_COLUMNS.get(c.key.strip().lower())
        if col:
            scoped.append((col, c, f"{param_prefix}_dc{i}"))
            continue
        if doc_accessor is None:
            continue
        acc_sql, acc_params = doc_accessor(
            f"document.{c.key}", param_prefix=f"{param_prefix}_dc{i}p",
        )
        params.update(acc_params)
        scoped.append((acc_sql, c, f"{param_prefix}_dc{i}"))

    for acc, c, pname in scoped:
        num = c.numeric
        if acc.startswith("$."):
            # A jsonpath predicate: the comparison happens INSIDE the path, so
            # the array unwrapping and the test are one expression and a row
            # with three payers matches when any of them does.
            op = "==" if c.op in ("==", "=") else c.op
            # `CAST(:p AS text)`, never `:p::text` — SQLAlchemy's bind-parameter
            # regex ends with a `(?!:)` lookahead, so a parameter followed by
            # PostgreSQL's `::` cast operator is not recognised as a parameter
            # at all and the statement fails to compile.
            if op == "!=":
                params[pname] = c.value
                clauses.append(
                    f"NOT jsonb_path_exists(elem, '{acc} ? (@ == $v)', "
                    f"jsonb_build_object('v', to_jsonb(CAST(:{pname} AS text))))"
                )
                continue
            if op == "in":
                # One `jsonb_path_exists` per accepted value, ORed: jsonpath has
                # no membership test that can take a bound array.
                parts = []
                for k, v in enumerate(c.values):
                    pn = f"{pname}_{k}"
                    params[pn] = v
                    parts.append(
                        f"jsonb_path_exists(elem, '{acc} ? (@ == $v)', "
                        f"jsonb_build_object('v', to_jsonb(CAST(:{pn} AS text))))"
                    )
                frag = "(" + " OR ".join(parts) + ")"
                if pname in lenient:
                    frag = f"(NOT jsonb_path_exists(elem, '{acc}') OR {frag})"
                clauses.append(frag)
                continue
            cast = "float" if num is not None and op not in ("==",) else "text"
            params[pname] = num if cast == "float" else c.value
            frag = (
                f"jsonb_path_exists(elem, '{acc} ? (@ {op} $v)', "
                f"jsonb_build_object('v', to_jsonb(CAST(:{pname} AS {cast}))))"
            )
            if pname in lenient:
                frag = f"(NOT jsonb_path_exists(elem, '{acc}') OR {frag})"
            clauses.append(frag)
            continue

        if num is not None and c.op in (">", "<", ">=", "<="):
            params[pname] = num
            # Gate the cast: an LLM-extracted column is free text, and a
            # strict ``::float`` raises on the first non-numeric cell.
            frag = (
                f"(CASE WHEN ({acc}) ~ '^[[:space:]]*-?[0-9]+(\\.[0-9]+)?[[:space:]]*$' "
                f"THEN ({acc})::float ELSE NULL END) {c.op} :{pname}"
            )
        elif c.op == "in":
            params[pname] = list(c.values)
            frag = f"({acc}) = ANY(:{pname})"
        elif c.op in ("==", "="):
            params[pname] = c.value
            frag = f"({acc}) = :{pname}"
        elif c.op == "!=":
            params[pname] = c.value
            frag = f"COALESCE({acc}, '') <> :{pname}"
        else:
            params[pname] = c.value
            frag = f"({acc}) {c.op} :{pname}"

        if pname in lenient:
            # **A filter narrows what it can speak about and stays silent about
            # the rest.** An unqualified condition is a statement about rows
            # that HAVE the key; a row that never mentions it is not a
            # non-match, it is out of scope. Without this,
            # ``magnitude>100000`` compiles to ``NULL > 100000`` on every place,
            # actor, interest and event — and took run 15010 from 102 nodes to
            # 24, deleting five sections to filter one. Qualified conditions
            # (``observations.magnitude>…``) stay strict: naming the section is
            # what says you mean all of it.
            key = c.key.replace(chr(39), chr(39) * 2)
            frag = f"(NOT (elem ? '{key}') OR ({frag}))"
        clauses.append(frag)

    return clauses, params


def _row_accessor(
    c: RowCondition, section: str | None, sections: "frozenset[str] | set[str]",
) -> str | None:
    """SQL for one row condition's left-hand side, or ``None`` to skip it here.

    Three cases, decided by whether the key's head names a section of this run:

    .. code-block:: text

        observations.magnitude   head IS a section
                                   · reading observations → `elem->>'magnitude'`
                                   · reading anything else → None, skip it
        by[*].type               head is NOT a section → a path INSIDE the row,
                                   walked with `#>>`; `[*]` is dropped because
                                   whether a segment explodes is a property of
                                   the data, not of how it was spelled
        magnitude                a bare key on the row

    Returning ``None`` rather than a false predicate is the point. The two are
    identical in SQL and opposite in meaning: a false predicate says *this row
    fails*, and skipping says *this condition is not about this section*.
    """
    key = c.key.replace("[*]", "").strip()
    head, _, rest = key.partition(".")
    if head.lower() in sections:
        if section is not None and head.lower() != section.lower():
            return None
        key = rest
        if not key:
            # `SECTION:` restricts which sections are read; a bare section name
            # in a comparison addresses no field and must not become one.
            return None
    parts = [p for p in key.split(".") if p]
    if len(parts) == 1:
        # `scalar_of`, not `->>`: an entity slot holds `{name, type}`, and
        # `at:"Berlin"` means the name. One rule, shared with the dimension
        # side (`core.filters`), so what a group key reads as is what a filter
        # compares against — see `scalar_of`'s docstring.
        return scalar_of(f"elem->'{parts[0].replace(chr(39), chr(39) * 2)}'")
    if not all(_SAFE_SEGMENT.match(p) for p in parts):
        return None
    # A path reaching INTO the row is a jsonpath, not a `#>>` chain, because
    # `#>>` cannot cross an array: `by` is a multi-valued slot, so
    # `elem #>> '{by,type}'` returns NULL for every row that has one.
    #
    # Postgres jsonpath defaults to **lax** mode, which auto-unwraps arrays —
    # so `$.by.type` matches whether `by` holds one object or five. That is
    # exactly the rule the grammar promises ("`[*]` is optional and inferred"),
    # implemented by the database rather than by us guessing arity from a
    # sample. Existential by construction, which is also the promised meaning
    # of a multi-valued path in a FILTER.
    return "$." + ".".join(parts)


#: Path segments safe to inline into a jsonpath literal. The jsonpath itself
#: cannot be a bind parameter, so the value is bound and the *shape* is
#: restricted instead.
_SAFE_SEGMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


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
