"""Measures — what sizes a node, and the denominator it is measured against.

``gql`` decides what is in the set. ``channels`` decides what the set does.
This decides *how big each thing is*, which sounds like a rendering detail and
is not: size is the channel a reader trusts first, and it is the one most
easily made to lie.

Three decisions, and each is written in the query rather than buried here:

.. code-block:: text

    WEIGHT:<measure>            what quantity          gathers · degree · numeric …
           (ref:<denominator>)  compared to what       median · mentions · corpus …
           (scale:<mapping>)    how it becomes size    auto · linear · log · rank

**Why a denominator is a first-class term.** Normalisation used to be whatever
the code that computed a number happened to do, which meant it could not be
argued with, and three separate open problems stayed open because each wanted a
different one:

* one consignment worth EUR 41,000,000 among four hundred worth EUR 10,000 —
  ``ref:median`` makes it 4,000× typical, which is the finding, while the four
  hundred sit at 1.0 and stay legible;
* "well attested *relative to how much was said*" had no name at all — sorting
  by count surfaces the dense corpus, sorting by evidence surfaces the sparse
  one, and ``ref:mentions`` is the third order neither gives;
* degree across a mixed corpus is a popularity contest between corpora —
  ``ref:corpus`` computes it within a stratum instead.

One primitive, and it is visible in the bar.

**Why the engine refuses a linear scale.** Node area carries roughly one and a
half orders of magnitude before a reader stops being able to compare two of
them. Money spans seven. Drawing that linearly does not exaggerate the largest
value, it erases every other value — four hundred invoices become four hundred
identical dots. So a request for ``linear`` over a wide range is declined, a
log scale is used, and the legend says so. A refusal nobody is told about is
indistinguishable from a bug.

Spec: ``docs/plans/observation-model/CHANNELS.md`` §4.1 and GRAMMAR §1.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median as _median
from typing import Any, Callable, Iterable

from app.api.modules.graph.channels import (
    LINEAR_RANGE_LIMIT,
    REFS,
    SCALES,
    WEIGHTS,
    resolve_scale,
)

__all__ = [
    "MeasureSpec", "SizedNodes", "MEASURES",
    "parse_measure", "measure_nodes", "normalise", "apply_scale",
]


# ─── The measures ────────────────────────────────────────────────────────────

#: How each measure reads a raw quantity off an assembled node. Degree and the
#: neighbour count need the edge set, so they are filled in by
#: :func:`measure_nodes` rather than being closures over nothing.
MEASURES: dict[str, Callable[[Any], float]] = {
    # What sits inside or under it. The default, and deliberately not `degree`:
    # degree is why a hearing with forty participants swallows the scene while
    # the thin shell company on a five-step chain — the entire finding in a
    # concealment case — renders as a speck.
    "gathers": lambda n: float(getattr(n, "frequency", 0) or 0),
    "numeric": lambda n: abs(float(getattr(n, "magnitude", 0) or 0)),
    "evidence": lambda n: float(len(getattr(n, "evidence", None) or ())),
    "docs": lambda n: float(len(getattr(n, "source_annotation_ids", None) or ())),
    "mentions": lambda n: float(getattr(n, "frequency", 0) or 0),
}


@dataclass(frozen=True, slots=True)
class MeasureSpec:
    """One ``WEIGHT:`` binding, resolved.

    ``terms`` is a composite — each is normalised to 0–1 over the *same*
    population and summed. Normalising each over a different population is how
    a composite comes to mean nothing, so the population is chosen once (see
    :func:`measure_nodes`) and every term shares it.
    """

    terms: tuple[str, ...] = ("gathers",)
    ref: str = "none"
    scale: str = "auto"
    #: Terms that were not reserved measures and are read as **field paths** on
    #: the row instead — `WEIGHT:magnitude`, `WEIGHT:observations.magnitude`.
    #: Same three-rung ladder as `CLUSTER:`, because a writer who learned it in
    #: one binding will use it in the other.
    fields: tuple[str, ...] = ()
    #: What could not be read at all. Reported, never silently defaulted.
    unknown: tuple[str, ...] = ()

    def render(self) -> str:
        out = "WEIGHT:" + ",".join(self.terms + self.fields)
        opts = [f"{k}:{v}" for k, v in (("ref", self.ref), ("scale", self.scale))
                if v not in ("none", "auto")]
        return out + (f"({','.join(opts)})" if opts else "")


@dataclass
class SizedNodes:
    """Per-node size in ``[0, 1]``, plus what the engine did to get there.

    ``legend`` is not decoration. Every entry is a decision a reader would
    otherwise have to reverse-engineer from the picture — which scale, which
    denominator, over which population — and a size channel whose rules are
    invisible is a size channel that can be made to say anything.
    """

    sizes: dict[str, float] = field(default_factory=dict)
    legend: list[str] = field(default_factory=list)
    #: What could not be done with what was written. **Amber, not neutral** —
    #: the legend says what the engine DID and a note says what it could not do
    #: with your query, and a failed binding rendered in the legend's voice
    #: reads as a setting rather than a warning.
    notes: list[str] = field(default_factory=list)
    #: Set when the engine overrode what was asked for.
    refused: str | None = None


def parse_measure(binding: Any | None) -> MeasureSpec:
    """A ``channels.Binding`` for ``WEIGHT`` → a resolved spec.

    Unknown terms fall back to the default rather than raising: the bar is a
    text field a person types into, and a half-written measure should shrink
    nothing to zero.
    """
    if binding is None:
        return MeasureSpec()
    terms: list[str] = []
    fields: list[str] = []
    opts: dict[str, str] = {}
    for sel in getattr(binding, "selectors", ()) or ():
        opts.update(getattr(sel, "options", None) or {})
        name = (getattr(sel, "path", "") or "").strip().lower()
        if not name:
            continue
        if name in WEIGHTS:
            terms.append(name)
        else:
            # **Not a reserved measure, so it is a field.** `WEIGHT:magnitude`
            # used to be dropped here and silently replaced by `gathers` — the
            # engine sized by a completely different quantity and the legend
            # said so in words nobody reads as a correction. Measured:
            # `WEIGHT:magnitude` and `WEIGHT:gathers` produced identical sizes,
            # and the largest node "by magnitude" was a city.
            #
            # A field path is the honest reading of a word that is not a method
            # word, and it is the same ladder `CLUSTER:` walks.
            fields.append(name)
    ref = (opts.get("ref") or "none").strip().lower()
    scale = (opts.get("scale") or "auto").strip().lower()
    return MeasureSpec(
        terms=tuple(terms) or (() if fields else ("gathers",)),
        fields=tuple(fields),
        ref=ref if ref in REFS else "none",
        scale=scale if scale in SCALES else "auto",
    )


# ─── Denominators ────────────────────────────────────────────────────────────


def _denominator(ref: str, values: list[float], node: Any,
                 raw: Callable[[Any], float]) -> float:
    """The number one value is divided by, for the chosen reference."""
    positives = [v for v in values if v > 0]
    if not positives:
        return 1.0
    if ref == "median":
        return float(_median(positives))
    if ref == "mean":
        return sum(positives) / len(positives)
    if ref == "max":
        return max(positives)
    if ref == "mentions":
        # How much was said about it, as the denominator: a claim repeated in
        # forty documents and a claim stated once, both attested once, are not
        # equally well attested.
        return max(1.0, float(getattr(node, "frequency", 0) or 0))
    return 1.0


def normalise(values: dict[str, float], ref: str, nodes: list[Any]) -> dict[str, float]:
    """Divide each value by the reference denominator.

    ``corpus`` and ``role`` are *stratified* references: the denominator is
    computed within the group a node belongs to rather than across everything,
    which is the whole point — a corpus that talks more should not win every
    degree-derived finding.
    """
    if ref in ("none", ""):
        return dict(values)

    by_id = {getattr(n, "id", None): n for n in nodes}

    if ref in ("corpus", "role"):
        groups: dict[str, list[str]] = {}
        for nid in values:
            groups.setdefault(_stratum(by_id.get(nid), ref), []).append(nid)
        out: dict[str, float] = {}
        for _, ids in groups.items():
            local = [values[i] for i in ids]
            den = _denominator("median", local, None, lambda _n: 0.0)
            for i in ids:
                out[i] = values[i] / den if den else 0.0
        return out

    den_values = list(values.values())
    out = {}
    for nid, v in values.items():
        den = _denominator(ref, den_values, by_id.get(nid), lambda _n: 0.0)
        out[nid] = v / den if den else 0.0
    return out


def _stratum(node: Any, ref: str) -> str:
    """Which population a node is compared within.

    ``corpus`` has no home in the model yet — it is not a section, not a
    channel, and it gates the validity of every count in a mixed infospace.
    The projection path is the closest honest stand-in: rows from different
    schemas are different corpora far more often than not. Named here so the
    approximation is visible rather than assumed.
    """
    if node is None:
        return ""
    if ref == "role":
        roles = getattr(node, "roles", None) or ()
        return sorted(roles)[0] if roles else ""
    paths = getattr(node, "source_paths", None) or ()
    return sorted(paths)[0] if paths else ""


# ─── Scales ──────────────────────────────────────────────────────────────────


def apply_scale(values: dict[str, float], scale: str) -> dict[str, float]:
    """Map values onto ``[0, 1]`` by the chosen scale. Assumes it is legal."""
    if not values:
        return {}
    if scale == "rank":
        # Position only — magnitude is discarded on purpose. Rank is exact
        # where area is ±30%, so when the question is "which is largest" a
        # ranked list answers it better than any circle can.
        order = sorted(values, key=lambda k: values[k])
        last = max(1, len(order) - 1)
        return {nid: i / last for i, nid in enumerate(order)}

    if scale == "log":
        logged = {k: math.log1p(max(0.0, v)) for k, v in values.items()}
        hi = max(logged.values(), default=0.0)
        return {k: (v / hi if hi > 0 else 0.0) for k, v in logged.items()}

    hi = max(values.values(), default=0.0)
    return {k: (max(0.0, v) / hi if hi > 0 else 0.0) for k, v in values.items()}


# ─── The whole pass ──────────────────────────────────────────────────────────


def _field_reader(path: str) -> Callable[[Any], float]:
    """Read a numeric off a node by field path — the third rung of the ladder.

    `magnitude` is a column on the node and also a first-class slot on it, so
    both are tried; a qualified `observations.magnitude` addresses the same
    thing, because on a NODE the section half is already spent (the node came
    from somewhere) and the leaf is what identifies the quantity.

    Non-numeric reads as zero rather than raising: a model-extracted column is
    free text, and one dirty cell must not blank the channel.
    """
    leaf = path.rsplit(".", 1)[-1].strip().lower()

    def read(n: Any) -> float:
        v = (getattr(n, "properties", None) or {}).get(leaf)
        if v is None:
            v = getattr(n, leaf, None)
        try:
            return abs(float(v))
        except (TypeError, ValueError):
            return 0.0

    return read


def measure_nodes(
    spec: MeasureSpec,
    nodes: list[Any],
    edges: Iterable[Any] = (),
) -> SizedNodes:
    """Size every node, and record what was decided.

    Each composite term is normalised over the **same** population — the nodes
    passed in — before being summed. Normalising each over a different one is
    how "degree plus amount" comes to mean nothing in particular, and the
    population ends up in the legend so cross-role sizes are not silently
    compared.
    """
    out = SizedNodes()
    if not nodes:
        return out

    degree: dict[str, int] = {}
    neighbours: dict[str, set[str]] = {}
    for e in edges:
        s, t = getattr(e, "source", None), getattr(e, "target", None)
        if s is None or t is None:
            continue
        degree[s] = degree.get(s, 0) + 1
        degree[t] = degree.get(t, 0) + 1
        neighbours.setdefault(s, set()).add(t)
        neighbours.setdefault(t, set()).add(s)

    readers: dict[str, Callable[[Any], float]] = dict(MEASURES)
    readers["degree"] = lambda n: float(degree.get(getattr(n, "id", None), 0))
    readers["connections"] = lambda n: float(
        len(neighbours.get(getattr(n, "id", None), ()))
    )

    for f in spec.fields:
        readers[f] = _field_reader(f)

    combined: dict[str, float] = {getattr(n, "id", ""): 0.0 for n in nodes}
    unread: list[str] = []
    for term in (*spec.terms, *spec.fields):
        read = readers.get(term)
        if read is None:
            continue
        if term in spec.fields and not any(read(n) for n in nodes):
            # The path resolved to nothing numeric on any node. Sizing by it
            # would make every node identical, which looks exactly like sizing
            # being off — so it is reported and skipped.
            unread.append(term)
            continue
        raw = {getattr(n, "id", ""): max(0.0, read(n)) for n in nodes}
        referenced = normalise(raw, spec.ref, nodes)

        lo = min((v for v in referenced.values() if v > 0), default=0.0)
        hi = max(referenced.values(), default=0.0)
        scale, note = resolve_scale(spec.scale, lo, hi)
        if note and not out.refused:
            out.refused = note
            out.legend.append(note)

        scaled = apply_scale(referenced, scale)
        for nid, v in scaled.items():
            combined[nid] = combined.get(nid, 0.0) + v

        out.legend.append(
            f"{term}"
            + (f" ÷ {spec.ref}" if spec.ref not in ("none", "") else "")
            + f" · {scale} scale"
            + (f" · range {hi / lo:,.0f}×" if lo > 0 and hi > lo else "")
        )

    # A composite is an average, not a sum: summing makes "degree,amount" twice
    # the size of "degree" for reasons that have nothing to do with the data.
    # Counted over what CONTRIBUTED — a term that read nothing is not a term
    # the average should be diluted by.
    n_terms = max(1, len(spec.terms) + len(spec.fields) - len(unread))
    out.sizes = {k: v / n_terms for k, v in combined.items()}
    out.legend.append(f"normalised over {len(nodes):,} nodes")
    if unread:
        # S1/S2 — a binding that reached nothing must say so. Silently falling
        # back to the default is how `WEIGHT:magnitude` sized by `gathers` for
        # months while the legend described a measure nobody asked for.
        out.notes.append(
            "could not size by " + ", ".join(unread)
            + " — no node carries a number there",
        )
        if not any(combined.values()):
            # …and a reported failure must not also blank the canvas. Every node
            # at zero is a picture, and an unreadable one; the default measure
            # is at least a picture the legend already explains.
            out.notes.append("fell back to gathers")
            fallback = {getattr(n, "id", ""): max(0.0, readers["gathers"](n))
                        for n in nodes}
            referenced = normalise(fallback, spec.ref, nodes)
            lo = min((v for v in referenced.values() if v > 0), default=0.0)
            hi = max(referenced.values(), default=0.0)
            out.sizes = apply_scale(referenced, resolve_scale(spec.scale, lo, hi)[0])
    return out
