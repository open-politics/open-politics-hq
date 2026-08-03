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
    "CHANNELS", "PLACEMENTS", "WEIGHTS", "Channel", "Selector", "Binding",
    "ChannelQuery", "parse_channels", "grammar_block", "infer_defaults",
]

Sink = Literal["layout", "pane", "placement"]


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


CHANNELS: tuple[Channel, ...] = (
    # ── layout ──────────────────────────────────────────────────────────────
    Channel("VECTOR", "layout", default_role="vector",
            hint="Each distinct value becomes a space anchor; members are "
                 "pulled toward it. This is the direction the scene has."),
    Channel("STEPS", "layout", default_role="step",
            hint="An ordered chain. Containment nests, sequence gives "
                 "direction. Never synthesised from dates."),
    Channel("ANCHOR", "layout", default_role="anchor",
            hint="Hard position from outside — coordinates where they exist. "
                 "Not only places: a channel, a docket, anything that "
                 "positions without being positioned."),
    Channel("AXIS", "layout",
            hint="One metric quantity on one axis. `time` is the usual one."),
    Channel("CLUSTER", "layout",
            hint="Grouping key — colour, and a soft pull. A comma-list is a "
                 "COMPOUND key: `label,type` means one group per distinct pair."),
    Channel("WEIGHT", "layout",
            hint="Size. A comma-list is a COMPOSITE: each term normalised to "
                 "0–1 and summed. Default `gathers`; `degree` is available and "
                 "is deliberately not the default."),
    # ── sinks ───────────────────────────────────────────────────────────────
    Channel("NODEINFO", "pane", options=("show",),
            hint="Full detail for the focused node — typed annotations, "
                 "provenance, statistics."),
    Channel("DOCS", "pane", options=("show",),
            hint="The documents themselves, with their corpus."),
    Channel("OBSERVATIONS", "pane", default_role="companion", options=("show", "group"),
            hint="A list of acts, grouped by the CLUSTER key."),
    Channel("EVIDENCE", "pane", default_role="attachment", options=("show",),
            hint="Grounds — quote, locator, stance."),
    Channel("LANES", "pane", options=("rows", "clock"),
            hint="Rows keyed by a step, x by the axis."),
    Channel("CLUSTERS", "pane", options=("show",),
            hint="The groups the CLUSTER key produced, with counts and spans."),
    # ── placement ───────────────────────────────────────────────────────────
    Channel("CONNECT", "placement",
            hint="On the canvas, attached where it belongs — a document at the "
                 "node it appears at most."),
    Channel("UNCONNECTED", "placement",
            hint="On the canvas, unattached: positioned from its own "
                 "properties rather than its edges."),
    Channel("DISCONNECT", "placement",
            hint="Off the canvas. Still in the data, still fills panes, still "
                 "counts for degree and traversal."),
    Channel("SHOW", "placement", hint="Into a pane."),
    Channel("HIDE", "placement", hint="Not fetched at all."),
)

BY_NAME: dict[str, Channel] = {c.name: c for c in CHANNELS}

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
    """``any`` · ``docs`` · a section · ``section.field`` · a channel name when
    the clause is a placement (``DISCONNECT:OBSERVATIONS``)."""
    value: str | None = None
    """A ``.value(...)`` refinement — one member of a roster, one value of a
    field."""
    options: dict[str, str] = field(default_factory=dict)
    """Display keys. **Never selection** — mixing the two is how a filter comes
    to hide inside a display setting."""

    @property
    def is_channel_ref(self) -> bool:
        """Does this address a channel rather than data? Placement clauses do."""
        return self.path in BY_NAME

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
        for b in self.bindings:
            if b.channel.name == name:
                return b
        return None

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

    # The dense layer comes off the canvas by default. Companions are an order
    # of magnitude more numerous than anything else, and drawing them all is
    # what makes a first look at a real corpus unreadable.
    if by_role.get("companion"):
        out.bindings.append(Binding(
            channel=BY_NAME["DISCONNECT"],
            selectors=(Selector(path="OBSERVATIONS"),),
        ))
    if not out.get("WEIGHT"):
        out.bindings.append(Binding(
            channel=BY_NAME["WEIGHT"], selectors=(Selector(path="gathers"),)))
    return out


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
                        ("pane", "SINKS — fill a pane"),
                        ("placement", "PLACEMENT — whether it is drawn")):
        lines.append(title)
        for c in CHANNELS:
            if c.sink != sink:
                continue
            opts = f"  options: {', '.join(c.options)}" if c.options else ""
            lines.append(f"  {c.name + ':':<14} {c.hint}{opts}")
        lines.append("")
    lines.append("WEIGHT can read:")
    for k, v in WEIGHTS.items():
        lines.append(f"  {k:<12} {v}")
    return "\n".join(lines)
