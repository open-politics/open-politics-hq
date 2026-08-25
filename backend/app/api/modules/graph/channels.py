"""Channels — the half of the query language that binds rather than filters.

``gql`` decides *what is in the set*. This decides *what the set does*: which
section gives direction, what sizes a node, what groups it, what comes off the
canvas and into a pane.

.. code-block:: text

    TYPE:  FROM:  HOPS:  after:  degree>       FILTERS   gql.py
    VECTOR:  STEPS:  WEIGHT:  CLUSTER:         BINDINGS  here
    DOCS:  EVIDENCE:  OBSERVATIONS:  LANES:    SINKS     here
    CONNECT:  DISCONNECT:  SHOW:  HIDE:        PLACEMENT here

**Why the query and not the schema.** A layout role is situational — the same
section is a vector in one question and a step in the next. The analyst knows
which; the schema author cannot. A declaration on a contract is still useful,
but as the *opening move* (see :func:`infer_defaults`), not the mechanism.

**One reserved rule, and it carries the whole language:**

    UPPERCASE is a channel. lowercase is a path or a value.

So ``OBSERVATIONS:`` is the sink and ``observations`` is the section, and
``DISCONNECT:OBSERVATIONS`` reads a channel while ``OBSERVATIONS:observations``
writes one. Without the rule those two collapse into one word, which is the
first thing that would go wrong.

Everything here is data — :data:`CHANNELS` is the single source the frontend
mirror, the MCP tool description and the LLM prompt are all generated from. The
filter half is written out four times and adding a token means eight hand
edits; this half starts with one table so it never gets there.

Spec: ``docs/plans/observation-model/CHANNELS.md``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

__all__ = [
    "CHANNELS", "PLACEMENTS", "WEIGHTS", "REFS", "SCALES",
    "VECTOR_FOLDS", "VECTOR_SPACES", "FRAME_COST", "DIMENSIONS",
    "LINEAR_RANGE_LIMIT",
    "PANE_PRESETS", "PanePreset", "preset_for",
    "Channel", "Selector", "Binding", "ChannelQuery",
    "parse_channels", "grammar_block", "infer_defaults", "unwired",
    "resolve_scale", "resolve_vector_fold", "frames_spent",
]

Sink = Literal["layout", "pane", "placement", "filter"]


# ─── The table ───────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Channel:
    """A (sink · default selector · default display) triple.

    Naming the channel picks all three. Giving it a selector overrides the
    first and keeps the rest — which is what makes ``EVIDENCE:observations`` a
    deliberate lens (observations rendered *as* grounds) rather than a mistake.
    """

    name: str
    sink: Sink
    hint: str
    #: How the default selector is found when the clause names none. A role
    #: name resolves through the schema's own declarations, so a section called
    #: `motives` supplies the vector without being named `interests`.
    default_role: str | None = None
    #: Display keys this channel understands inside ``(...)``.
    options: tuple[str, ...] = ()
    #: **Does writing this change the picture?**
    #:
    #: The language's oldest failure is a clause that parses, is documented,
    #: is generated into the MCP description and the ✨ prompt, and reaches no
    #: renderer — so writing it and writing nothing produce identical pictures
    #: (``FAULTS`` F1). `VECTOR:interests` even printed a confident legend line
    #: describing a fold that nothing implements, which is worse than silence:
    #: silence is ambiguous, a legend is a claim.
    #:
    #: So every channel declares whether it lands, here, beside its hint —
    #: because the two go stale together or not at all. ``False`` makes the bar
    #: pill it amber and stops the legend asserting anything.
    wired: bool = True


CHANNELS: tuple[Channel, ...] = (
    # ── layout ──────────────────────────────────────────────────────────────
    Channel("VECTOR", "layout", wired=False, default_role="vector", options=("fold", "space"),
            hint="Each distinct value becomes a space anchor; members are "
                 "pulled toward it. This is the direction the scene has. "
                 "`fold` says how N values collapse when there is no room for "
                 "them; `space` says where the result is spent."),
    Channel("STEPS", "layout", wired=False, default_role="step",
            hint="An ordered chain. Containment nests, sequence gives "
                 "direction. Never synthesised from dates."),
    Channel("ANCHOR", "layout", wired=False, default_role="anchor",
            hint="Hard position from outside — coordinates where they exist. "
                 "Not only places: a channel, a docket, anything that "
                 "positions without being positioned."),
    Channel("AXIS", "layout", wired=False,
            hint="One metric quantity on one axis. `time` is the usual one."),
    Channel("CLUSTER", "layout",
            hint="Grouping key — colour, and a soft pull. A comma-list is a "
                 "COMPOUND key: `label,type` means one group per distinct pair."),
    Channel("WEIGHT", "layout", options=("ref", "scale"),
            hint="Size. A comma-list is a COMPOSITE: each term normalised to "
                 "0–1 and summed. Default `gathers`; `degree` is available and "
                 "is deliberately not the default. `ref` names a denominator "
                 "(`median` finds the outlier), `scale` the mapping."),
    # ── sinks ───────────────────────────────────────────────────────────────
    #
    # **One channel, and the name is the analyst's.** There used to be six
    # sinks here — NODEINFO DOCS OBSERVATIONS EVIDENCE LANES CLUSTERS — which
    # is a hardcoded noun list living in the file that exists to delete
    # hardcoded noun lists. It fails the project's own test: anything fixed
    # that is not an axis kind, a stage, a set relation or a traversal is a bug
    # we have not found yet. The seventh finding always wanted a seventh sink.
    #
    # A pane is a name and a query. The name resolves against `PANE_PRESETS`
    # for a starting binding and is otherwise just a label, so
    # `PANEL:Consignments` is as first-class as `PANEL:Evidence` and neither is
    # known to the grammar.
    Channel("PANEL", "pane", options=("kind", "follow", "show", "group"),
            hint="Creates a pane. The name resolves against the preset table "
                 "for a starting binding — an unrecognised name gets a plain "
                 "list, which you then point wherever you like."),
    # ── filter, in channel spelling ─────────────────────────────────────────
    #
    # The one channel that NARROWS rather than binds, and it earns the
    # exception by being the address space's own name. `field:` wants a
    # projection path — `field:document.places[*]` — which is the schema's
    # internal spelling of a thing the analyst calls "places". Making someone
    # learn `document.…[*]` to say "only the places section" is asking them to
    # know the contract's shape to ask a question about its content.
    #
    # Resolved to `field:` against the run's projections (see
    # `resolve_sections`), so it inherits the cheapest filter in the language:
    # a skipped projection is a scan that never happens.
    Channel("SECTION", "filter",
            hint="Restrict to one section, by its own name — `SECTION:places` "
                 "rather than `field:document.places[*]`. A dotted suffix "
                 "reaches a field inside it."),
    # ── placement ───────────────────────────────────────────────────────────
    Channel("CONNECT", "placement", wired=False,
            hint="On the canvas, attached where it belongs — a document at the "
                 "node it appears at most."),
    Channel("UNCONNECTED", "placement", wired=False,
            hint="On the canvas, unattached: positioned from its own "
                 "properties rather than its edges."),
    Channel("DISCONNECT", "placement", wired=False,
            hint="Off the canvas. Still in the data, still fills panes, still "
                 "counts for degree and traversal."),
    # ── projection ──────────────────────────────────────────────────────────
    #
    # Was "into a pane" and consumed by nothing. It is now the projection — the
    # clause every mature query language has and this one did not: SQL SELECT,
    # Cypher RETURN, SPARQL SELECT, SQL/PGQ COLUMNS(...), Splunk `| table`.
    #
    # Its ARITY picks the surface, which is `GRAMMAR §4`'s mechanism aimed at
    # the input it was always right for. Folding NODES into a ranked list is a
    # layout problem wearing a table's clothes; projecting COLUMNS OF ROWS is a
    # genuinely tabular one.
    Channel("SHOW", "projection",
            hint="Columns of the row table. `SHOW:by,to,magnitude`. Arity picks "
                 "the surface: one column ranks, two cross, more tabulate, `*` "
                 "is the whole row. A path may be qualified — `SHOW:"
                 "observations.by` and `SHOW:by` address the same column."),
    Channel("HIDE", "placement", wired=False, hint="Not fetched at all."),
)

#: Alternative spellings, resolved before lookup.
#:
#: `SELECT` is here for one reason and it is worth stating: it is the strongest
#: prior any language model has, and honouring it costs one dict entry. The
#: project's rule after surveying the field — *never invent a spelling where a
#: famous one exists* — cuts both ways, and this is the cheap half.
ALIASES: dict[str, str] = {
    "SELECT": "SHOW",
    "COLUMNS": "SHOW",
    "SIZE": "WEIGHT",
}

BY_NAME: dict[str, Channel] = {c.name: c for c in CHANNELS}


@dataclass(frozen=True, slots=True)
class PanePreset:
    """A starting binding for a pane, chosen by its name.

    **Data, not grammar.** Nothing in the parser knows these words exist; a
    name that misses the table is not an error, it is a pane called that with
    a plain list in it. Adding a preset is adding a row.

    ``role`` resolves through the schema's own declarations rather than naming
    a section, which is what lets ``PANEL:Motives`` land on the vector preset
    in a contract that never says "interests". ``path`` is for the handful of
    presets that address something other than a section.
    """

    name: str
    hint: str
    #: Declared layout role whose sections this pane shows, if any.
    role: str | None = None
    #: A literal address, when the pane is not about a role.
    path: str | None = None
    #: Surface kind, when the preset means a specific one. Otherwise inferred
    #: from the fold shape.
    kind: str | None = None
    #: What the pane follows — the panel's query, or the current selection.
    follow: str = "lens"


#: Presets, keyed by lowercased pane name. Extend freely — this list carries no
#: weight in the language.
PANE_PRESETS: tuple[PanePreset, ...] = (
    # The one an empty bar opens with, beside `node`. Not a fold of the graph:
    # the server projects one section's ROWS and ships them beside the nodes,
    # so this pane shows the proposition a row states rather than a count of
    # the fragments assembly left of it. `graph/rows.py`.
    PanePreset("rows", path="rows", kind="table",
               hint="The records behind the picture. `SECTION:` picks which, "
                    "`SHOW:` picks the columns."),
    PanePreset("observations", role="companion", kind="items",
               hint="The acts themselves, grouped by the CLUSTER key."),
    PanePreset("evidence", role="attachment", kind="items",
               hint="Grounds — quote, locator, stance."),
    PanePreset("places", role="anchor", kind="map",
               hint="Where things happened, ranked by how much did."),
    PanePreset("interests", role="vector", kind="items",
               hint="The why axis: what the activity serves, and who converges."),
    PanePreset("steps", role="step", kind="lanes",
               hint="The chain, in order, along the time axis."),
    PanePreset("docs", path="docs", kind="docs",
               hint="One row per document: the sections and fields it filled, "
                    "and the part of the canvas it produced. The one surface "
                    "that runs source → graph."),
    PanePreset("node", path="any", kind="detail", follow="selection",
               hint="Everything known about the focused node."),
    PanePreset("activity", path="any", kind="lanes",
               hint="How much happened when — a fold with no row key."),
    PanePreset("clusters", path="any", kind="list",
               hint="The groups the CLUSTER key produced, with counts and spans."),
)

PRESETS_BY_NAME: dict[str, PanePreset] = {p.name: p for p in PANE_PRESETS}


def preset_for(pane_name: str) -> PanePreset | None:
    """The preset a pane name starts from, if any. Case-insensitive."""
    return PRESETS_BY_NAME.get(pane_name.strip().lower())


def resolve_sections(q: "ChannelQuery", projections: list[Any]) -> list[str]:
    """``SECTION:places`` → the ``field:`` tokens that mean it.

    A section is addressed by **its own name**, whatever the schema calls it,
    and this turns that name back into the projection path the engine filters
    on. Matched on the path's last segment so ``places`` finds
    ``document.places[*]`` without anyone writing either half.

    A name that matches nothing returns nothing rather than a filter that
    excludes everything: an unrecognised section is a typo, and answering a
    typo with an empty canvas is the failure mode this whole language is
    trying to remove. It surfaces as an amber pill instead.
    """
    selectors = q.selectors_for("SECTION")
    if not selectors:
        return []

    by_section: dict[str, str] = {}
    for p in projections or ():
        path = getattr(p, "path", "") or ""
        if path:
            by_section[path.rsplit(".", 1)[-1].removesuffix("[*]").lower()] = path

    out: list[str] = []
    for sel in selectors:
        # `places` or `places.kind` — the section is the head, and a dotted
        # suffix is a field inside it that `field:` does not address, so it is
        # dropped here and left to a row condition.
        head = (sel.path or "").split(".", 1)[0].strip().lower()
        path = by_section.get(head)
        if path and path not in out:
            out.append(path)
    return out


def unresolved_sections(q: "ChannelQuery", projections: list[Any]) -> list[str]:
    """Section names in the query that this run has no projection for."""
    selectors = q.selectors_for("SECTION")
    if not selectors:
        return []
    known = {
        (getattr(p, "path", "") or "").rsplit(".", 1)[-1].removesuffix("[*]").lower()
        for p in projections or ()
    }
    return [
        sel.path for sel in selectors
        if (sel.path or "").split(".", 1)[0].strip().lower() not in known
    ]

#: Filter prefixes ``gql`` owns. Listed here so an UPPERCASE spelling of one —
#: ``TYPE:Person`` beside ``VECTOR:interests`` — is passed through lowercased
#: rather than reported as an unknown channel.
#:
#: The reserved rule is about *case*, and applying it only to bindings would
#: mean a query reads in two cases for no reason a user could state. So:
#: uppercase is a CLAUSE, of either half; lowercase is a path or a value.
FILTER_PREFIXES: frozenset[str] = frozenset({
    "type", "predicate", "pred", "field", "role", "kind", "serves",
    "after", "before", "from", "hops", "near",
})

#: Placement values, in the order a UI should offer them. Mirrors the layer
#: view's existing `canvas | pane | linked | off`, because a second vocabulary
#: for one idea is how the two come to disagree.
PLACEMENTS: tuple[str, ...] = ("connect", "unconnected", "show", "disconnect", "hide")

#: What ``WEIGHT`` can read. ``degree`` is present and is NOT the default: it
#: is why events swallow a scene, and why a thin node on a long path — the
#: entire finding in a concealment chain — renders as a speck.
WEIGHTS: dict[str, str] = {
    "gathers": "what sits inside or under it — contained steps, acts during it, "
               "interests it subsumes, distinct drivers",
    "degree": "edge count",
    "connections": "distinct neighbours, ignoring multiplicity",
    "numeric": "the largest numeric field on the row (magnitude, amount)",
    "evidence": "grounding quotes and citing documents",
    "docs": "how many documents attest it",
}

#: What ``WEIGHT:x(ref:…)`` divides by.
#:
#: **A denominator you can read.** Normalisation was previously a policy buried
#: in whoever computed the number; naming it makes it a term of the query, and
#: three separate unsolved problems turn out to be the same one:
#:
#: * ``median`` — "what is unusually large". A EUR 41M consignment among EUR
#:   10k ones is 4000× the median, which is the finding, and it survives a log
#:   scale. Four hundred ordinary invoices sit at 1.0 and stay legible.
#: * ``mentions`` — "well attested *relative to how much was said*". Sorting by
#:   count surfaces the dense corpus; sorting by evidence surfaces the sparse
#:   one; this is the third sort order that neither gives.
#: * ``corpus`` — degree within its own stratum, so a corpus that talks more
#:   does not win every degree-derived finding.
#: * ``role`` — measured against peers doing the same job.
REFS: dict[str, str] = {
    "none": "the raw measure (default)",
    "median": "divided by the population median — deviation from typical",
    "mean": "divided by the population mean",
    "max": "as a fraction of the largest",
    "mentions": "divided by how often the thing was named",
    "corpus": "normalised within its own corpus",
    "role": "normalised among nodes of the same declared role",
}

#: How a measure maps onto radius.
#:
#: Node **area** carries roughly one and a half orders of magnitude before a
#: reader stops being able to compare two of them. Money spans seven. A linear
#: map across that range is not a tuning choice that came out badly, it is a
#: false statement, so the engine refuses it and says which scale it used
#: instead — see :func:`resolve_scale`.
SCALES: dict[str, str] = {
    "auto": "linear while the range is small, log once it is not (default)",
    "linear": "value ∝ radius. Refused when the dynamic range exceeds "
              "LINEAR_RANGE_LIMIT",
    "log": "log1p — the honest default for money and counts",
    "rank": "position in the sorted population, ignoring magnitude entirely",
}

#: Above this ratio between the largest and smallest positive value, a linear
#: size map stops being readable and ``scale:auto`` switches to log.
LINEAR_RANGE_LIMIT = 100.0

#: How N vector values collapse when there is no dimension left for them.
VECTOR_FOLDS: dict[str, str] = {
    "embed": "positions from the similarity of the value labels, so adjacency "
             "between vectors becomes itself a finding (default)",
    "hierarchy": "one dimension: depth in the `subsumes` tree",
    "sphere": "evenly spaced. Honest, and adjacency then means nothing — the "
              "safe fallback, never the default",
}

#: Where a folded vector is spent.
VECTOR_SPACES: dict[str, str] = {
    "residual": "the freedom left INSIDE an anchor's cell. A node pinned at "
                "Trieste in 2014 still has a neighbourhood; the vector places "
                "it within that. Large-scale adjacency stays geography and "
                "time, small-scale becomes affinity (default)",
    "z": "the vertical — only available when AXIS:time is unbound",
    "colour": "not a position at all: the honest zero-dimension answer",
}

#: What each frame costs, in dimensions. Geography is two because a coordinate
#: is a pair; everything else is one.
#:
#: The arithmetic is right and the *popover* was wrong — asking an analyst to
#: "spend three axes across four frames" is a budget UI for a decision they
#: should never have to make. The engine spends, folds the overflow, and says
#: what it did.
FRAME_COST: dict[str, int] = {"geo": 2, "time": 1, "vector": 1, "event": 1}

#: There are three dimensions. This is not a budget to negotiate.
DIMENSIONS = 3


# ─── Parsing ─────────────────────────────────────────────────────────────────

#: A channel clause. Uppercase name, colon, then selectors. The name is
#: anchored to uppercase so a lowercase `type:` stays a filter and reaches
#: `gql` untouched.
_CLAUSE_RE = re.compile(r"^([A-Z][A-Z0-9_]*):(.*)$", re.S)

#: `path.value("literal")` — the value refinement. Quotes optional but
#: recommended, since a value may contain anything.
_VALUE_RE = re.compile(r"""\.value\(\s*(['"]?)(.*?)\1\s*\)\s*$""", re.S)

#: `(show:name, group:kind)` — display options, never selection.
_OPTIONS_RE = re.compile(r"\((.*)\)\s*$", re.S)


@dataclass(frozen=True, slots=True)
class Selector:
    """One address in the doc → section → field → value space."""

    path: str
    """``any`` · ``docs`` · a section · ``section.field``.

    **Data, always.** Placement clauses used to be able to name a *channel*
    instead — ``DISCONNECT:OBSERVATIONS`` took the pane off the canvas while
    ``DISCONNECT:observations`` took the section off it. Two meanings
    distinguished only by case is the collision the uppercase rule exists to
    prevent, and the rule was being used to create one. With panes named by the
    analyst there is no channel left to address: a placement moves data, and a
    pane is a pane."""
    value: str | None = None
    """A ``.value(...)`` refinement — one member of a roster, one value of a
    field."""
    options: dict[str, str] = field(default_factory=dict)
    """Display keys. **Never selection** — mixing the two is how a filter comes
    to hide inside a display setting."""

    def render(self) -> str:
        out = self.path
        if self.value is not None:
            out += f'.value("{self.value}")'
        if self.options:
            out += "(" + ",".join(f"{k}:{v}" for k, v in self.options.items()) + ")"
        return out


@dataclass(frozen=True, slots=True)
class Binding:
    channel: Channel
    selectors: tuple[Selector, ...]

    def render(self) -> str:
        return f"{self.channel.name}:" + ",".join(s.render() for s in self.selectors)


@dataclass(slots=True)
class ChannelQuery:
    """The binding half of one query string.

    ``rest`` is everything this parser did not claim, handed on to ``gql``
    verbatim — the two halves compose in one string and neither needs to know
    the other's vocabulary.
    """

    bindings: list[Binding] = field(default_factory=list)
    rest: str = ""
    unknown: list[str] = field(default_factory=list)
    """Clauses that LOOKED like a channel — uppercase, colon — and named none.
    Reported rather than silently demoted to free text, because a model writing
    `SECTOR:finance` would otherwise get a plausible substring match back."""

    def get(self, name: str) -> Binding | None:
        """The FIRST binding for a channel. See :meth:`all` before using it."""
        for b in self.bindings:
            if b.channel.name == name:
                return b
        return None

    def all(self, name: str) -> list[Binding]:
        """Every binding for a channel.

        A channel may be written more than once — `SECTION:places
        SECTION:events SECTION:interests` reads naturally and is how a person
        types it. `get` returns only the first, so a caller using it silently
        honoured one clause and discarded the rest: three sections asked for,
        one section drawn, no error. Anything that can repeat must use this.
        """
        return [b for b in self.bindings if b.channel.name == name]

    def selectors_for(self, name: str) -> list[Selector]:
        """Every selector across every binding of a channel, in order."""
        return [s for b in self.all(name) for s in b.selectors]

    def placement_of(self, target: str) -> str | None:
        """Which placement verb names *target*, if any."""
        for b in self.bindings:
            if b.channel.sink != "placement":
                continue
            for s in b.selectors:
                if s.path == target:
                    return b.channel.name.lower()
        return None

    def render(self) -> str:
        parts = [b.render() for b in self.bindings]
        if self.rest.strip():
            parts.append(self.rest.strip())
        return " ".join(parts)


def _split_top(text: str) -> list[str]:
    """Split on whitespace, but never inside quotes or parentheses.

    A selector may hold both — ``EVIDENCE:observations.value("a b")(show:name)``
    — so a naive ``.split()`` would shred exactly the expressive part.
    """
    out: list[str] = []
    buf: list[str] = []
    depth = 0
    quote: str | None = None
    for ch in text:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "'\"":
            quote = ch
            buf.append(ch)
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch.isspace() and depth == 0:
            if buf:
                out.append("".join(buf))
                buf = []
            continue
        buf.append(ch)
    if buf:
        out.append("".join(buf))
    return out


def _parse_selector(raw: str) -> Selector:
    text = raw.strip()
    options: dict[str, str] = {}

    m = _OPTIONS_RE.search(text)
    if m and not text.rstrip().endswith(')') is False:
        # Only treat a trailing `(...)` as options when it is NOT a value
        # refinement — `.value(x)` ends in a paren too.
        if not _VALUE_RE.search(text):
            for pair in m.group(1).split(","):
                if ":" in pair:
                    k, _, v = pair.partition(":")
                    options[k.strip()] = v.strip().strip("'\"")
            text = text[: m.start()].strip()

    value: str | None = None
    vm = _VALUE_RE.search(text)
    if vm:
        value = vm.group(2)
        text = text[: vm.start()].strip()
        om = _OPTIONS_RE.search(text)
        if om:
            for pair in om.group(1).split(","):
                if ":" in pair:
                    k, _, v = pair.partition(":")
                    options[k.strip()] = v.strip().strip("'\"")
            text = text[: om.start()].strip()

    # `section.` is an optional disambiguating prefix for the case where a
    # section is named like a channel.
    if text.lower().startswith("section."):
        text = text[len("section."):]

    return Selector(path=text, value=value, options=options)


def unwired(q: "ChannelQuery") -> list[str]:
    """Clauses in this query that parse and reach no renderer.

    ``FAULTS`` F1, made reportable. The failure was never that these do
    nothing — a half-built feature is normal — it is that they do nothing
    *silently*, and one of them printed a legend line describing work it had
    not done. A reader cannot tell an unimplemented binding from a binding
    whose data happened to be empty, and both look like the picture is right.
    """
    return [
        f"{b.channel.name}: is parsed but reaches no renderer yet — "
        f"it changes nothing on this canvas"
        for b in q.bindings if not b.channel.wired
    ]


def parse_channels(q: str) -> ChannelQuery:
    """Split one query string into bindings and everything else.

    Deliberately permissive about what a selector *addresses* — whether
    ``motives`` is a real section is a question for the run, not the grammar,
    and answering it here would make the parser need a schema.
    """
    out = ChannelQuery()
    if not q or not q.strip():
        return out

    leftovers: list[str] = []
    for token in _split_top(q):
        m = _CLAUSE_RE.match(token)
        if not m:
            leftovers.append(token)
            continue
        name, rest = m.group(1), m.group(2).strip()
        name = ALIASES.get(name, name)
        if name.lower() in FILTER_PREFIXES:
            # `TYPE:Person` is `type:Person`. Handed to gql in the spelling it
            # knows, so a user may write either case throughout.
            leftovers.append(f"{name.lower()}:{rest}")
            continue
        channel = BY_NAME.get(name)
        if channel is None:
            # Looked like a channel and named none. Reported, not demoted:
            # silently becoming free text is how a hallucinated clause returns
            # a plausible substring match.
            out.unknown.append(token)
            continue
        if not rest:
            leftovers.append(token)
            continue
        selectors = tuple(_parse_selector(s) for s in _split_selectors(rest))
        out.bindings.append(Binding(channel=channel, selectors=selectors))

    out.rest = " ".join(leftovers)
    return out


def _split_selectors(rest: str) -> list[str]:
    """Comma-split, respecting quotes and parens.

    A comma means OR at the value level, a COMPOUND key for ``CLUSTER`` and a
    COMPOSITE for ``WEIGHT`` — three meanings, all of them a list, none of them
    a fallback chain. A fallback would make a query's meaning depend on which
    data happened to be missing.
    """
    out: list[str] = []
    buf: list[str] = []
    depth = 0
    quote: str | None = None
    for ch in rest:
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


# ─── Defaults ────────────────────────────────────────────────────────────────


def infer_defaults(projections: list[Any]) -> ChannelQuery:
    """The query an empty bar means, from what the schema declared.

    Three rungs, and this is where ``x-graph`` earns its keep: a section that
    declares ``role: vector`` supplies ``VECTOR:<its name>`` without anyone
    naming ``interests``. The declaration stopped being the mechanism and became
    the opening move, which is a better job for it — a schema author states a
    sensible default and an analyst overrides it per question, with nobody
    editing a contract to ask something different.

    The result is meant to be shown in the bar, greyed. An invisible default is
    a magic layout; a visible one is a starting point.
    """
    by_role: dict[str, list[str]] = {}
    for p in projections or ():
        role = getattr(p, "role", None)
        path = getattr(p, "path", "") or ""
        if not role or not path:
            continue
        section = path.rsplit(".", 1)[-1].removesuffix("[*]")
        by_role.setdefault(role, []).append(section)

    out = ChannelQuery()
    for channel in CHANNELS:
        if not channel.default_role:
            continue
        sections = by_role.get(channel.default_role)
        if not sections:
            continue
        out.bindings.append(Binding(
            channel=channel,
            selectors=tuple(Selector(path=s) for s in sections),
        ))

    # **Two panes, not seven.** ``MVP`` §5.
    #
    # The default set used to be one pane per declared role, and every one of
    # them folded NODES into a ranked list: `payment ×8`, `Shell S1 · 1`, a
    # Places pane that could not fill by construction. The rule that killed
    # them — *a pane that lists nodes with a count is a pane that failed to be a
    # layout* — leaves exactly two things worth opening with:
    #
    #   rows   the records behind the picture, with real columns
    #   node   whatever is selected, rendered whole
    #
    # The other presets survive as DATA: `PANEL:places` still resolves, so
    # nothing is unreachable. They are simply no longer what an empty bar means.
    # `docs` is the third because it is the other direction. Every other
    # surface goes graph → source: find a node, ask where it came from. This
    # goes source → graph, and a corpus you cannot read back from is one you
    # have to trust rather than check.
    panes = [Selector(path="rows"), Selector(path="docs"), Selector(path="node")]
    out.bindings.append(Binding(channel=BY_NAME["PANEL"], selectors=tuple(panes)))

    # **No DISCONNECT default.** It used to contract every companion section off
    # the canvas as a density measure, and contraction deletes the row's payload
    # with it: edges carry no properties, so an act's magnitude, time, interest
    # and justification vanished along with its node. The panel then offered an
    # "observations" pane asking for exactly what this had removed.
    #
    # An MVP that silently deletes data fails S5 before it renders. Occurrences
    # are visible; density is answered by CLUSTER, which is a layout question,
    # not by deletion, which is a data one.
    if not out.get("WEIGHT"):
        out.bindings.append(Binding(
            channel=BY_NAME["WEIGHT"], selectors=(Selector(path="gathers"),)))
    return out


# ─── Resolution — what the engine decided, and what it will say it decided ───


def resolve_scale(requested: str | None, lo: float, hi: float) -> tuple[str, str | None]:
    """Pick the size scale, and a note when the pick was not what was asked.

    Returns ``(scale, note)``. ``note`` is non-None exactly when the engine
    overrode the request, and it is meant to be shown — a refusal nobody is
    told about is indistinguishable from a bug.

    ``linear`` is refused rather than honoured over a wide range because the
    channel cannot carry it: area is readable across about 1.5 orders of
    magnitude and a EUR-41M-against-EUR-10k population spans four. Drawing it
    linearly does not exaggerate the finding, it erases everything else.
    """
    want = (requested or "auto").strip().lower()
    if want not in SCALES:
        want = "auto"
    span = (hi / lo) if lo > 0 and hi > 0 else float("inf") if hi > 0 else 1.0

    if want == "auto":
        return ("log", None) if span > LINEAR_RANGE_LIMIT else ("linear", None)
    if want == "linear" and span > LINEAR_RANGE_LIMIT:
        return "log", (
            f"linear refused — the largest value is {span:,.0f}× the smallest, "
            f"and node area carries about {LINEAR_RANGE_LIMIT:,.0f}×. Using log."
        )
    return want, None


def resolve_vector_fold(binding: Binding | None, spent: int) -> tuple[str, str, str | None]:
    """``(fold, space, note)`` for the vector channel, given what is left.

    Overflow **folds**; it never refuses and it is never silent. With a geo
    floor and a time axis there is no third dimension for a vector, and the
    honest thing is to place it in the freedom the anchors leave rather than to
    drop it or to fight them for an axis.
    """
    opts: dict[str, str] = {}
    for sel in (binding.selectors if binding else ()):
        opts.update(sel.options)
    fold = (opts.get("fold") or "embed").strip().lower()
    space = (opts.get("space") or "").strip().lower()
    if fold not in VECTOR_FOLDS:
        fold = "embed"
    if space not in VECTOR_SPACES:
        space = ""

    free = max(0, DIMENSIONS - spent)
    if space:
        return fold, space, None
    if free >= 1:
        return fold, "z", None
    return fold, "residual", (
        f"{spent}/{DIMENSIONS} dimensions spent — vector folded to residual "
        f"placement ({VECTOR_FOLDS[fold].split(',')[0]})"
    )


def frames_spent(q: ChannelQuery) -> tuple[int, list[str]]:
    """How many dimensions the bound layout channels consume, and which."""
    spent, names = 0, []
    if q.get("ANCHOR"):
        spent += FRAME_COST["geo"]
        names.append("geo")
    axis = q.get("AXIS")
    if axis:
        spent += FRAME_COST["time"]
        names.append("time")
    return spent, names


# ─── Generated documentation ─────────────────────────────────────────────────


def grammar_block() -> str:
    """The channel half of the grammar, as prose, from the table.

    Generated because the filter half is written out four times — the ``gql``
    docstring, three tables in ``graph_query_language.ts`` and the MCP tool
    description — and adding one token there means eight hand edits, twice. The
    MCP description and the LLM prompt both read this.
    """
    lines = [
        "CHANNELS bind what the filters selected. UPPERCASE is a channel, "
        "lowercase is a path or a value.",
        "",
        "Address space, coarse to fine:",
        "  docs · <section> · <section>.<field> · <section>.value(\"…\")· any",
        "Sections are addressed by THEIR OWN NAME, whatever the schema calls "
        "them.",
        "",
    ]
    for sink, title in (("layout", "LAYOUT — bind onto the canvas"),
                        ("pane", "PANES — a name and a query"),
                        ("placement", "PLACEMENT — whether it is drawn")):
        lines.append(title)
        for c in CHANNELS:
            if c.sink != sink:
                continue
            opts = f"  options: {', '.join(c.options)}" if c.options else ""
            lines.append(f"  {c.name + ':':<14} {c.hint}{opts}")
        lines.append("")

    def block(title: str, table: dict[str, str], note: str = "") -> None:
        lines.append(title)
        if note:
            lines.append(f"  {note}")
        for k, v in table.items():
            lines.append(f"  {k:<12} {v}")
        lines.append("")

    block("WEIGHT can read:", WEIGHTS)
    block("WEIGHT(ref:…) — the denominator, written:", REFS,
          "Normalisation is a term of the query, not a hidden policy.")
    block("WEIGHT(scale:…) — how a measure becomes a radius:", SCALES,
          "A range wider than "
          f"{LINEAR_RANGE_LIMIT:,.0f}× refuses `linear` and says so.")
    block("VECTOR(fold:…) — how N values collapse:", VECTOR_FOLDS)
    block("VECTOR(space:…) — where the fold is spent:", VECTOR_SPACES,
          f"There are {DIMENSIONS} dimensions. Geo costs "
          f"{FRAME_COST['geo']}, time {FRAME_COST['time']}; when nothing is "
          "left the vector folds rather than fights for an axis.")

    lines.append("PANEL presets — a starting binding, chosen by the pane's name:")
    lines.append("  (data, not grammar: an unknown name is a pane called that)")
    for p in PANE_PRESETS:
        lines.append(f"  {p.name:<12} {p.hint}")
    return "\n".join(lines)
