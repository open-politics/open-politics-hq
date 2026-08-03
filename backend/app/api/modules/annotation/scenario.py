"""The mega-scenario — one corpus that exercises all six investigation shapes.

    docker compose exec -T backend python -m app.api.modules.annotation.scenario
    docker compose exec -T backend python -m app.api.modules.annotation.scenario --verify

**This is a fixture, not a demo.** The annotations are written by hand and are
perfectly filled: every ordering stated, every valence signed, every clock used,
every office given a start and an end. That is the point. Whether a language
model fills a contract well and whether the panel can read one that *is* filled
are different questions, and testing them together means neither can be worked
on — a blank pane could be a bad prompt, a bad corpus, or a bad projection, and
you cannot tell which.

So this fixes one half. Given a run that lands correctly, does the machinery
answer the questions in `docs/plans/observation-model/INVESTIGATION.md`, and can
the views in `SPATIAL.md` draw it? Each of the six cases is a query over this
corpus with a known right answer.

**One story, not six.** The cases are facets of a single procurement matter, so
entities recur across them and the clusters genuinely link: the vendor in the
award case is the counterparty in the divergence case, the shells in the
ownership chain hold the property the movement case tracks, and the official
paying into the chain is one of the figures in the convergence set. A fixture
where each case had its own disjoint cast would test six graphs, not one.

The corpus is deliberately mixed — wire copy, court filings, a leaked registry,
a message dump, NGO field reports — because §2 of INVESTIGATION is about what
breaks when corpora are combined, and a fixture that is all one kind cannot
show it.

**Real geography, invented parties.** Every place is real and carries real
coordinates, because a coordinate is a neutral fact and an invented one is
useless — no provider can geocode "Capital-X", so the geo frame could only ever
be filled by a curated table and never by the geocoding action a real corpus
would use. The people and companies are invented but ordinary: this corpus
alleges bribery, concealed ownership and an arms movement, and attaching those
to identifiable real parties would put fabricated criminal claims into a
database that gets exported and shared. Realistic names give the panel
everything it needs — natural string lengths, plausible clustering, real
geocoding — without that.

What the fixture deliberately exercises, beyond the six cases:

.. code-block:: text

    EXTENTS       offices and registrations carry `from`/`until`, so a node
                  spans time rather than sitting at an instant
    CONTAINMENT   events nest three deep, so enclosure has something to draw
    SEQUENCE      a five-step `follows` chain, so direction is not a single hop
    ELEVATION     the interest tree is three levels, so height has a range
    TRAILS        one unit crosses four places over four days
    MOTIF         one payment shape, eight times, two accounts
    THIN PATH     a four-hop ownership chain of degree-2 shells
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from typing import Any, Iterable

from sqlmodel import Session, select, text

from app.api.modules.annotation.templates import build_contract
from app.core.db import engine

ARCHETYPES = [
    "statements", "transfers", "movements", "encounters",
    "holdings", "seats", "memberships", "citations",
]

# ─── The cast ────────────────────────────────────────────────────────────────

PERSON, ORG, STATE = "Person", "Organization", "State"
LOC, INTEREST, EVENT, EVIDENCE = "Location", "Interest", "Event", "Evidence"
ACCOUNT, PROPERTY, DOCUMENT = "Account", "Property", "Document"


def e(name: str, etype: str) -> dict[str, str]:
    return {"name": name, "type": etype}


# People. Invented, ordinary, and long enough to test a label that has to fit.
HALASZ = "Andrej Halász"           # State Secretary, pays into the chain
KOEHLER = "Marta Köhler"           # procurement director, signs the award
FERREIRA = "Tomás Ferreira"        # Lisbon lawyer, the nominee
VAHER = "Ilona Vaher"              # Tallinn, convergence set
DUARTE = "Sofia Duarte"            # Lisbon, convergence set
ZIELINSKI = "Piotr Zieliński"      # Vienna, convergence set
BELLINI = "Dario Bellini"          # Trieste logistics
AAS = "Katrin Aas"                 # Review Board rapporteur

# Organisations.
DIRECTORATE = "Directorate of Materiel Procurement"
BOARD = "Federal Procurement Review Board"
COMMITTEE = "Parliamentary Public Accounts Committee"
INSPECTORATE = "Ministry Inspectorate General"
ADRIATIC = "Adriatic Systems AG"          # the winning vendor
NORDKAP = "Nordkap Defence Solutions"     # excluded on a formality
HELIOS = "Helios Marine Engineering"      # the third bidder
MONITOR = "Adriatic Monitoring Initiative"  # the NGO
LOGISTICS = "Bellini Logistica Srl"

# The shells, in the order the chain runs.
CORVUS = "Corvus Holdings Ltd"            # Road Town
LARIMAR = "Larimar Capital S.A."          # Panama City
SELENE = "Selene Trading Ltd"             # Valletta

# Instruments.
ACCT_A = "Meridian Bank a/c 4471"
ACCT_B = "Meridian Bank a/c 8820"
PROPERTY_TS = "Molo IV warehouse, Trieste"
SYSTEMS = "CS-9 coastal surveillance systems"


#: The why-axis, three levels deep so ELEVATION has a range to express.
#: `furthers` runs narrow → broad, which is how a document states it and why
#: `serves:X+` walks it backward.
INTEREST_TREE = [
    # narrow                                    → broad
    ("procurement review avoidance",            "erode multilateral oversight"),
    ("erode multilateral oversight",            "sovereign exemption"),
    ("nominee structuring",                     "beneficial ownership concealment"),
    ("beneficial ownership concealment",        "sovereign exemption"),
    ("incumbent renewal",                       "vendor market position"),
    ("vendor market position",                  "economic advantage"),
]

INTEREST_DOMAINS = {
    "sovereign exemption": "political",
    "erode multilateral oversight": "political",
    "procurement review avoidance": "legal",
    "beneficial ownership concealment": "legal",
    "nominee structuring": "legal",
    "regulatory neutrality": "legal",
    "vendor market position": "economic",
    "incumbent renewal": "economic",
    "economic advantage": "economic",
    "coastal surveillance capability": "security",
    "maritime interdiction": "security",
}

#: Places nest, city → region → country, so CONTAINMENT has a geographic case
#: as well as an event one. `part_of` between two Locations was undeclarable
#: until `relations.from`/`to` were widened past `actors`.
PLACE_TREE = [
    ("Vienna", "Austria"),
    ("Valletta", "Malta"),
    ("Road Town", "British Virgin Islands"),
    ("Panama City", "Panama"),
    ("Lisbon", "Portugal"),
    ("Tallinn", "Estonia"),
    ("Nicosia", "Cyprus"),
    ("Luxembourg City", "Luxembourg"),
    ("Zurich", "Switzerland"),
    ("Trieste", "Friuli Venezia Giulia"),
    ("Friuli Venezia Giulia", "Italy"),
    ("Koper", "Slovenia"),
    ("Rijeka", "Croatia"),
    ("Bari", "Apulia"),
    ("Apulia", "Italy"),
]

#: Real coordinates, so the GEO frame is exercisable — and so the map floor in
#: SPATIAL's VIEW B has something to pin to. Placed on curated ``CanonEntry``
#: rows rather than asset facets because that is the rung a hand-curated corpus
#: would use, and the one that overwrites rather than defers.
PLACE_COORDS: dict[str, tuple[float, float]] = {
    "Vienna": (48.2082, 16.3738),        "Austria": (47.5162, 14.5501),
    "Valletta": (35.8989, 14.5146),      "Malta": (35.9375, 14.3754),
    "Road Town": (18.4286, -64.6185),
    "British Virgin Islands": (18.4207, -64.6400),
    "Panama City": (8.9824, -79.5199),   "Panama": (8.5380, -80.7821),
    "Lisbon": (38.7223, -9.1393),        "Portugal": (39.3999, -8.2245),
    "Tallinn": (59.4370, 24.7536),       "Estonia": (58.5953, 25.0136),
    "Nicosia": (35.1856, 33.3823),       "Cyprus": (35.1264, 33.4299),
    "Luxembourg City": (49.6116, 6.1319), "Luxembourg": (49.8153, 6.1296),
    "Zurich": (47.3769, 8.5417),         "Switzerland": (46.8182, 8.2275),
    "Trieste": (45.6495, 13.7768),
    "Friuli Venezia Giulia": (46.1640, 13.0780),
    "Italy": (41.8719, 12.5674),
    "Koper": (45.5481, 13.7302),         "Slovenia": (46.1512, 14.9955),
    "Rijeka": (45.3271, 14.4422),        "Croatia": (45.1000, 15.2000),
    "Bari": (41.1171, 16.8719),          "Apulia": (40.7928, 16.8645),
}


def _justify(quote: str, reasoning: str = "") -> dict[str, Any]:
    return {
        "reasoning": reasoning or "stated in the document",
        "text_spans": [{"text_snippet": quote}],
    }


def _doc(**sections: Any) -> dict[str, Any]:
    """One annotation payload, with the rosters filled from what the rows use.

    Deriving the rosters rather than writing them by hand is not laziness: the
    model's own rule is that *every name used anywhere must appear in its
    roster*, and a fixture that states the rule and then violates it by
    oversight would be testing the wrong thing.
    """
    doc: dict[str, Any] = {k: v for k, v in sections.items() if v is not None}

    seen: dict[str, dict[str, str]] = {}

    def collect(node: Any) -> None:
        if isinstance(node, dict):
            if set(node) >= {"name", "type"} and isinstance(node.get("name"), str):
                seen.setdefault(f"{node['name']}\x00{node['type']}", node)
                return
            for v in node.values():
                collect(v)
        elif isinstance(node, list):
            for v in node:
                collect(v)

    collect({k: v for k, v in doc.items()
             if k not in ("actors", "places", "instruments", "interests")})

    buckets: dict[str, list[dict[str, str]]] = {
        "actors": [], "places": [], "instruments": [], "interests": [],
    }
    for ref in seen.values():
        t = ref["type"]
        if t in (PERSON, ORG, STATE):
            buckets["actors"].append(ref)
        elif t == LOC:
            buckets["places"].append(ref)
        elif t == INTEREST:
            buckets["interests"].append(ref)
        elif t in (ACCOUNT, PROPERTY, DOCUMENT):
            buckets["instruments"].append(ref)
        # Event and Evidence are their own sections, not rosters.

    for key, found in buckets.items():
        if found:
            doc[key] = [e(n, t) for n, t in
                        sorted({(r["name"], r["type"]) for r in found})]
    return doc


# ─── The documents ───────────────────────────────────────────────────────────


def _case1_convergence() -> list[tuple[dict, dict]]:
    """Three figures, three countries, one goal, and NO path between them.

    The finding is an absence, so the fixture has to create one: they share no
    observation, no relation and no event. If any document named two of them
    together the residual would collapse into a description of a connection,
    which is the easy claim and not the one under test.

    Halász is one of the three AND the payer in case 2 — so the convergence set
    is not a disjoint island, and a traversal from the payments reaches exactly
    one of its members. That is the realistic shape: one leg documented, the
    others only aligned.
    """
    out = []
    for who, where, when, quote in [
        (ZIELINSKI, "Vienna", "2016-02-11",
         "the review mechanism no longer serves us and we will not be bound by it"),
        (DUARTE, "Lisbon", "2016-03-02",
         "these procurement rules are an imposition on national competence"),
        (VAHER, "Tallinn", "2016-04-19",
         "we intend to legislate our way out of the oversight regime"),
    ]:
        out.append((
            {"title": f"{who} calls for withdrawal from procurement review",
             "corpus": "news wire", "kind": "WEB", "when": when},
            _doc(
                observations=[{
                    "kind": "statement",
                    "by": [e(who, PERSON)],
                    "at": e(where, LOC),
                    "when": when,
                    "modality": "asserted",
                    "serves": [e("procurement review avoidance", INTEREST)],
                    "justification": _justify(quote),
                }],
                **{"at": e(where, LOC), "dated": when},
            ),
        ))
    # Halász, separately and never alongside them, says the same thing.
    out.append((
        {"title": "Halász interview: 'review has become an obstacle'",
         "corpus": "news wire", "kind": "WEB", "when": "2016-03-28"},
        _doc(
            observations=[{
                "kind": "statement",
                "by": [e(HALASZ, PERSON)],
                "at": e("Vienna", LOC),
                "when": "2016-03-28",
                "modality": "asserted",
                "serves": [e("procurement review avoidance", INTEREST)],
                "justification": _justify(
                    "review has become an obstacle to timely capability"),
            }],
            at=e("Vienna", LOC), dated="2016-03-28",
        ),
    ))
    return out


def _case2_motif(n: int = 8) -> list[tuple[dict, dict]]:
    """The same shape, eight times: transfer [by:Person · via:Account · to:Shell].

    Generated rather than written out, because the thing under test IS the
    repetition — a motif is a grouping on shape, and eight hand-written rows
    would only prove that eight hand-written rows exist.

    Two accounts and three shells, so the motif class is one and the instances
    vary: that is what makes a hub a hub rather than a coincidence.
    """
    shells = [CORVUS, LARIMAR, SELENE]
    rows = []
    for i in range(n):
        acct = ACCT_A if i % 3 else ACCT_B
        shell = shells[i % 3]
        rows.append({
            "kind": "payment",
            "by": [e(HALASZ, PERSON)],
            "via": [e(acct, ACCOUNT)],
            "to": [e(shell, ORG)],
            "when": f"2016-{(i % 9) + 1:02d}-12",
            "magnitude": 250000 + i * 12500,
            "modality": "done",
            "serves": [e("nominee structuring", INTEREST)],
            "id": f"TX-{4400 + i}",
            "justification": _justify(
                f"transfer TX-{4400 + i} cleared via {acct}"),
        })
    return [(
        {"title": "Recovered payment instructions", "corpus": "message dump",
         "kind": "TEXT", "when": "2016-10-01"},
        _doc(observations=rows, dated="2016-10-01"),
    )]


def _case3_chain() -> list[tuple[dict, dict]]:
    """Ferreira → Corvus → Larimar → Selene → the warehouse.

    Four hops, three jurisdictions, and the signature is THIN nodes on a LONG
    path: each shell has degree 2 and no other purpose, which is why `degree>`
    is the wrong instrument for it.

    The registrations carry `from` AND `until`, so each shell is an EXTENT
    rather than an instant — Corvus is struck off before the award, which is
    exactly the kind of thing a ribbon makes visible and a dot does not.
    """
    seats = [
        (CORVUS, "Road Town", "2014-06-02", "2016-11-30"),
        (LARIMAR, "Panama City", "2014-07-19", None),
        (SELENE, "Valletta", "2015-01-08", None),
    ]
    return [(
        {"title": "Corporate registry extract", "corpus": "leaked registry",
         "kind": "CSV_ROW", "when": "2016-09-30"},
        _doc(
            relations=[
                {"from": e(FERREIRA, PERSON), "predicate": "nominee_for",
                 "to": e(CORVUS, ORG), "from_date": "2014-06-02",
                 "justification": _justify(
                     f"{FERREIRA} appears as nominee director for {CORVUS}")},
                {"from": e(CORVUS, ORG), "predicate": "owns",
                 "to": e(LARIMAR, ORG), "from_date": "2014-07-19"},
                {"from": e(LARIMAR, ORG), "predicate": "owns",
                 "to": e(SELENE, ORG), "from_date": "2015-01-08"},
                {"from": e(SELENE, ORG), "predicate": "owns",
                 "to": e(PROPERTY_TS, PROPERTY), "from_date": "2016-05-02"},
            ]
            + [{"from": e(a, LOC), "predicate": "part_of", "to": e(b, LOC)}
               for a, b in PLACE_TREE],
            attributes=[
                {"subject": e(shell, ORG), "kind": "registered_office",
                 "place": e(city, LOC), "from": start,
                 **({"until": end} if end else {}),
                 "justification": _justify(f"{shell} registered at {city}")}
                for shell, city, start, end in seats
            ],
            dated="2016-09-30",
        ),
    )]


def _case4_asymmetry() -> list[tuple[dict, dict]]:
    """The Board says neutral and acts favourable. Both halves, one corpus.

    `modality` carries the epistemics (asserted vs done) and `serves`/`opposes`
    carry the valence — the gap between the two arrays IS the case.

    This document also carries the SPINE of the whole corpus: a five-step
    `follows` chain nested inside a programme that is itself nested inside a
    review. Three levels of containment and five of sequence, so enclosure and
    direction both have something real to draw.
    """
    return [
        (
            {"title": "Review Board statement to the committee",
             "corpus": "court filing", "kind": "PDF", "when": "2016-04-05"},
            _doc(
                observations=[{
                    "kind": "testimony",
                    "by": [e(BOARD, ORG)],
                    "with": [e(AAS, PERSON)],
                    "to": [e(COMMITTEE, ORG)],
                    "at": e("Vienna", LOC),
                    "when": "2016-04-05",
                    "covers_from": "2015-01-01", "covers_until": "2016-03-31",
                    "modality": "asserted",
                    "serves": [e("regulatory neutrality", INTEREST)],
                    "during": [e("the 14 March clarification round", EVENT)],
                    "cites": [e("Exhibit R-1", EVIDENCE)],
                    "justification": _justify(
                        "we applied identical criteria to every bidder"),
                }],
                evidence=[{
                    "name": "Exhibit R-1", "kind": "transcript",
                    "stance": "supports", "locator": "p. 41",
                    "quote": "identical criteria to every bidder",
                }],
                at=e("Vienna", LOC), dated="2016-04-05",
            ),
        ),
        (
            {"title": "Award decision and scoring annex",
             "corpus": "court filing", "kind": "PDF", "when": "2016-05-02"},
            _doc(
                observations=[
                    {   # revealed: the decision itself
                        "kind": "ruling",
                        "by": [e(BOARD, ORG)],
                        "to": [e(ADRIATIC, ORG)],
                        "via": [e(DIRECTORATE, ORG)],
                        "at": e("Vienna", LOC),
                        "when": "2016-05-02",
                        "modality": "done",
                        "serves": [e("incumbent renewal", INTEREST)],
                        "opposes": [e("regulatory neutrality", INTEREST)],
                        "during": [e("the 2 May award", EVENT)],
                        "magnitude": 9,
                        "cites": [e("Exhibit R-2", EVIDENCE)],
                        "justification": _justify(
                            "the bid was scored before the clarification round closed"),
                    },
                    {   # the comparison set — same board, opposite direction
                        "kind": "ruling",
                        "by": [e(BOARD, ORG)],
                        "to": [e(NORDKAP, ORG)],
                        "at": e("Vienna", LOC),
                        "when": "2016-05-02", "modality": "done", "magnitude": 4,
                        "opposes": [e("vendor market position", INTEREST)],
                        "during": [e("the 2 May award", EVENT)],
                        "justification": _justify(
                            "Nordkap was excluded on a formality"),
                    },
                    {   # the control — a third bidder, treated ordinarily
                        "kind": "ruling",
                        "by": [e(BOARD, ORG)],
                        "to": [e(HELIOS, ORG)],
                        "at": e("Vienna", LOC),
                        "when": "2016-05-02", "modality": "done", "magnitude": 4,
                        "during": [e("the 2 May award", EVENT)],
                        "justification": _justify(
                            "Helios placed second on the published scoring"),
                    },
                ],
                evidence=[{
                    "name": "Exhibit R-2", "kind": "record",
                    "stance": "contradicts", "locator": "annex 3",
                    "quote": "scored 2016-04-28",
                }],
                # Three levels of containment, five steps of sequence.
                events=[
                    {"name": "Adriatic Capability Review", "kind": "programme",
                     "when": "2015-09-01", "until": "2017-06-30",
                     "at": e("Vienna", LOC)},
                    {"name": "Tender 2016/44", "kind": "programme",
                     "when": "2016-01-11", "until": "2016-09-05",
                     "within": e("Adriatic Capability Review", EVENT),
                     "at": e("Vienna", LOC)},
                    {"name": "the 11 January notice", "kind": "programme",
                     "when": "2016-01-11",
                     "within": e("Tender 2016/44", EVENT),
                     "at": e("Vienna", LOC)},
                    {"name": "the 14 March clarification round", "kind": "programme",
                     "when": "2016-03-14",
                     "within": e("Tender 2016/44", EVENT),
                     "follows": e("the 11 January notice", EVENT),
                     "at": e("Vienna", LOC)},
                    {"name": "the 2 May award", "kind": "programme",
                     "when": "2016-05-02",
                     "within": e("Tender 2016/44", EVENT),
                     "follows": e("the 14 March clarification round", EVENT),
                     "at": e("Vienna", LOC)},
                    {"name": "the 6 June contract signature", "kind": "programme",
                     "when": "2016-06-06",
                     "within": e("Tender 2016/44", EVENT),
                     "follows": e("the 2 May award", EVENT),
                     "at": e("Vienna", LOC)},
                    {"name": "the 5 September first delivery", "kind": "programme",
                     "when": "2016-09-05",
                     "within": e("Tender 2016/44", EVENT),
                     "follows": e("the 6 June contract signature", EVENT),
                     "at": e("Trieste", LOC)},
                ],
                at=e("Vienna", LOC), dated="2016-05-02", ref="Tender 2016/44",
            ),
        ),
    ]


def _offices() -> list[tuple[dict, dict]]:
    """Who held what, and for how long. **The extent case.**

    Every row here has a `from` and most have an `until`, so these subjects are
    intervals rather than instants — which is what makes "was he in office when
    the award happened" a thing you can see rather than compute. Köhler leaves
    the directorate a month after the first delivery; Halász is still in post
    when the payments run.
    """
    return [(
        {"title": "Ministry appointments register", "corpus": "court filing",
         "kind": "PDF", "when": "2017-01-20"},
        _doc(
            attributes=[
                {"subject": e(HALASZ, PERSON), "kind": "office",
                 "value": "State Secretary for Materiel",
                 "place": e("Vienna", LOC),
                 "from": "2013-03-01", "until": "2017-11-20",
                 "justification": _justify(
                     "Halász served as State Secretary from March 2013")},
                {"subject": e(KOEHLER, PERSON), "kind": "office",
                 "value": "Director of Procurement",
                 "place": e("Vienna", LOC),
                 "from": "2011-01-15", "until": "2016-09-30",
                 "justification": _justify(
                     "Köhler headed the directorate until September 2016")},
                {"subject": e(AAS, PERSON), "kind": "office",
                 "value": "Rapporteur",
                 "place": e("Vienna", LOC),
                 "from": "2014-06-01", "until": "2018-05-31",
                 "justification": _justify("Aas was appointed rapporteur in 2014")},
                {"subject": e(BELLINI, PERSON), "kind": "role",
                 "value": "managing director",
                 "place": e("Trieste", LOC),
                 "from": "2009-04-01",
                 "justification": _justify("Bellini has run the firm since 2009")},
                # Seats, so organisations are located as well as dated.
                {"subject": e(ADRIATIC, ORG), "kind": "head_office",
                 "place": e("Zurich", LOC), "from": "2008-02-01",
                 "justification": _justify("Adriatic Systems AG, head office Zurich")},
                {"subject": e(ADRIATIC, ORG), "kind": "tax_residence",
                 "place": e("Nicosia", LOC), "from": "2013-11-01",
                 "justification": _justify("tax residence moved to Cyprus in 2013")},
                {"subject": e(NORDKAP, ORG), "kind": "head_office",
                 "place": e("Tallinn", LOC), "from": "2010-05-01"},
                {"subject": e(HELIOS, ORG), "kind": "head_office",
                 "place": e("Luxembourg City", LOC), "from": "2007-09-01"},
                {"subject": e(DIRECTORATE, ORG), "kind": "registered_office",
                 "place": e("Vienna", LOC), "from": "1998-01-01"},
                {"subject": e(LOGISTICS, ORG), "kind": "registered_office",
                 "place": e("Trieste", LOC), "from": "2009-04-01"},
            ],
            relations=[
                {"from": e(KOEHLER, PERSON), "predicate": "works_for",
                 "to": e(DIRECTORATE, ORG), "from_date": "2011-01-15",
                 "until": "2016-09-30"},
                {"from": e(HALASZ, PERSON), "predicate": "works_for",
                 "to": e(DIRECTORATE, ORG), "from_date": "2013-03-01",
                 "until": "2017-11-20"},
                {"from": e(AAS, PERSON), "predicate": "member_of",
                 "to": e(BOARD, ORG), "from_date": "2014-06-01"},
                {"from": e(BELLINI, PERSON), "predicate": "controls",
                 "to": e(LOGISTICS, ORG), "from_date": "2009-04-01"},
            ],
            at=e("Vienna", LOC), dated="2017-01-20",
        ),
    )]


def _case5_domains() -> list[tuple[dict, dict]]:
    """One pair, opposite signs in two domains. The flip is the finding.

    The Directorate and its vendor: warm in the economic domain — a contract, a
    delivery, an extension — and hostile in the legal one, where the ministry's
    own inspectorate opens a file and the vendor litigates against it. An
    actor-scoped profile sums those to nothing; only a PAIR-scoped one keeps the
    two signs apart, which is precisely the primitive the case is waiting on.

    Deliberately the same parties as case 4, so the divergence attaches to the
    procurement cluster rather than floating in its own corner.
    """
    return [
        (
            {"title": "Directorate signs framework contract with Adriatic Systems",
             "corpus": "news wire", "kind": "WEB", "when": "2016-06-06"},
            _doc(
                observations=[{
                    "kind": "acquisition",
                    "by": [e(DIRECTORATE, ORG)],
                    "with": [e(ADRIATIC, ORG)],
                    "to": [e(ADRIATIC, ORG)],
                    "via": [e(SYSTEMS, PROPERTY)],
                    "at": e("Vienna", LOC),
                    "when": "2016-06-06", "modality": "done",
                    "magnitude": 41000000,
                    "serves": [e("coastal surveillance capability", INTEREST),
                               e("incumbent renewal", INTEREST)],
                    "during": [e("the 6 June contract signature", EVENT)],
                    "justification": _justify(
                        "a framework contract worth EUR 41 million was signed"),
                }],
                at=e("Vienna", LOC), dated="2016-06-06",
            ),
        ),
        (
            {"title": "Inspectorate opens file on the 2016/44 award",
             "corpus": "court filing", "kind": "PDF", "when": "2016-11-14"},
            _doc(
                observations=[{
                    "kind": "filing",
                    "by": [e(INSPECTORATE, ORG)],
                    "concerns": [e(ADRIATIC, ORG)],
                    "via": [e(DIRECTORATE, ORG)],
                    "at": e("Vienna", LOC),
                    "when": "2016-11-14",
                    "covers_from": "2016-01-11", "covers_until": "2016-05-02",
                    "modality": "asserted",
                    "opposes": [e("incumbent renewal", INTEREST)],
                    "serves": [e("regulatory neutrality", INTEREST)],
                    "during": [e("Adriatic Capability Review", EVENT)],
                    "justification": _justify(
                        "the scoring sequence cannot be reconciled with the record"),
                }],
                at=e("Vienna", LOC), dated="2016-11-14",
            ),
        ),
        (
            {"title": "Adriatic Systems challenges the inspectorate's competence",
             "corpus": "court filing", "kind": "PDF", "when": "2017-01-30"},
            _doc(
                observations=[{
                    "kind": "filing",
                    "by": [e(ADRIATIC, ORG)],
                    "concerns": [e(INSPECTORATE, ORG)],
                    "to": [e(COMMITTEE, ORG)],
                    "at": e("Vienna", LOC),
                    "when": "2017-01-30", "modality": "asserted",
                    "opposes": [e("regulatory neutrality", INTEREST)],
                    "serves": [e("vendor market position", INTEREST)],
                    "justification": _justify(
                        "the inspectorate has no competence over an awarded contract"),
                }],
                at=e("Vienna", LOC), dated="2017-01-30",
            ),
        ),
        (
            {"title": "Directorate contests delivery compliance",
             "corpus": "court filing", "kind": "PDF", "when": "2017-02-08"},
            _doc(   # THE FLIP. Same pair as the contract above, opposite sign,
                    # different domain — which is the whole case: an
                    # actor-scoped profile sums these to nothing and only a
                    # pair-scoped one keeps the two apart.
                observations=[{
                    "kind": "filing",
                    "by": [e(DIRECTORATE, ORG)],
                    "concerns": [e(ADRIATIC, ORG)],
                    "to": [e(COMMITTEE, ORG)],
                    "at": e("Vienna", LOC),
                    "when": "2017-02-08",
                    "covers_from": "2016-09-05", "covers_until": "2017-01-31",
                    "modality": "asserted",
                    "opposes": [e("vendor market position", INTEREST)],
                    "serves": [e("regulatory neutrality", INTEREST)],
                    "justification": _justify(
                        "delivered configuration departs from the tendered one"),
                }],
                at=e("Vienna", LOC), dated="2017-02-08",
            ),
        ),
        (
            {"title": "Directorate extends the framework by two years",
             "corpus": "news wire", "kind": "WEB", "when": "2017-03-22"},
            _doc(   # the control: warm again, economically, mid-dispute
                observations=[{
                    "kind": "acquisition",
                    "by": [e(DIRECTORATE, ORG)],
                    "with": [e(ADRIATIC, ORG)],
                    "at": e("Vienna", LOC),
                    "when": "2017-03-22", "modality": "done",
                    "magnitude": 12000000,
                    "serves": [e("incumbent renewal", INTEREST)],
                    "justification": _justify(
                        "the framework was extended without re-tender"),
                }],
                at=e("Vienna", LOC), dated="2017-03-22",
            ),
        ),
    ]


def _case6_tempo_regional() -> list[tuple[dict, dict]]:
    """Four days, four ports, one consignment. **The trail case.**

    Bellini's firm moves the delivered systems down the Adriatic. Places nest
    (Trieste ∈ Friuli Venezia Giulia ∈ Italy, declared in case 3) and the
    movement rows carry `origin`/`destination`, so the trajectory machinery has
    something to draw — and one body crossing four coordinates over four days is
    exactly what a trail is for.

    The consignment is the property the shell chain owns, so case 6 and case 3
    meet on one node.
    """
    legs = [
        ("2016-09-05", "Trieste", "Trieste", "Koper", "shipment",
         "the consignment is discharged at Molo IV"),
        ("2016-09-06", "Koper", "Koper", "Rijeka", "journey",
         "the convoy moves south overnight"),
        ("2016-09-07", "Rijeka", "Rijeka", "Bari", "journey",
         "loading resumes at first light"),
        ("2016-09-09", "Bari", None, None, "arms_transfer",
         "the systems are handed over at the mole"),
    ]
    out = []
    for i, (when, where, origin, dest, kind, quote) in enumerate(legs):
        out.append((
            {"title": f"Field report — {where}, day {i + 1}",
             "corpus": "NGO report", "kind": "TEXT", "when": when},
            _doc(
                observations=[{
                    "kind": kind,
                    "by": [e(LOGISTICS, ORG)],
                    "with": [e(BELLINI, PERSON)],
                    "via": [e(SYSTEMS, PROPERTY)],
                    "at": e(where, LOC),
                    **({"origin": e(origin, LOC), "destination": e(dest, LOC)}
                       if origin and dest and origin != dest else {}),
                    "when": when,
                    "modality": "done",
                    "serves": [e("maritime interdiction", INTEREST)],
                    "during": [e(f"the {where} leg", EVENT)],
                    "justification": _justify(quote),
                }],
                events=[
                    {"name": "Consignment 2016/44-1", "kind": "programme",
                     "when": "2016-09-05", "until": "2016-09-09",
                     "at": e("Trieste", LOC)},
                    {"name": f"the {where} leg", "kind": "programme",
                     "when": when,
                     "within": e("Consignment 2016/44-1", EVENT),
                     **({"follows": e(f"the {legs[i - 1][1]} leg", EVENT)}
                        if i else {}),
                     "at": e(where, LOC)},
                ],
                at=e(where, LOC), dated=when,
            ),
        ))
    # The NGO ties the consignment to the chain-owned warehouse.
    out.append((
        {"title": "Monitoring note: Molo IV ownership",
         "corpus": "NGO report", "kind": "TEXT", "when": "2016-09-20"},
        _doc(
            observations=[{
                "kind": "publication",
                "by": [e(MONITOR, ORG)],
                "concerns": [e(SELENE, ORG)],
                "via": [e(PROPERTY_TS, PROPERTY)],
                "at": e("Trieste", LOC),
                "when": "2016-09-20",
                "covers_from": "2016-05-02", "covers_until": "2016-09-09",
                "modality": "reported",
                "opposes": [e("beneficial ownership concealment", INTEREST)],
                "justification": _justify(
                    "the warehouse used for the September discharge is held "
                    "through a Maltese company"),
            }],
            at=e("Trieste", LOC), dated="2016-09-20",
        ),
    ))
    return out


def _spine() -> list[tuple[dict, dict]]:
    """The document that states the interest hierarchy and the domains.

    Both are claims about the why-axis rather than about any act, which is why
    they are relations and attributes: an interest is an entity, and an entity
    slot is a closed {name, type} shape that `schema_map` does not walk into.

    Three levels of `furthers` is what gives ELEVATION a range — a two-level
    tree makes every vector either top or bottom, which is a flag rather than a
    height.
    """
    return [(
        {"title": "Analyst framing note", "corpus": "court filing",
         "kind": "PDF", "when": "2016-10-15"},
        _doc(
            relations=[
                {"from": e(narrow, INTEREST), "predicate": "furthers",
                 "to": e(broad, INTEREST),
                 "justification": _justify(f"{narrow} advances {broad}")}
                for narrow, broad in INTEREST_TREE
            ],
            attributes=[
                {"subject": e(name, INTEREST), "kind": "domain", "value": domain,
                 "justification": _justify(f"{name} is a {domain} objective")}
                for name, domain in INTEREST_DOMAINS.items()
            ],
            dated="2016-10-15",
        ),
    )]


def documents() -> list[tuple[dict, dict]]:
    """Every document in the scenario, as ``(asset_meta, annotation_value)``."""
    return [
        *_spine(),
        *_offices(),
        *_case1_convergence(),
        *_case2_motif(),
        *_case3_chain(),
        *_case4_asymmetry(),
        *_case5_domains(),
        *_case6_tempo_regional(),
    ]


# ─── Seeding ─────────────────────────────────────────────────────────────────


def contract() -> dict[str, Any]:
    return build_contract("full", ARCHETYPES)


def _clear_run(session: Session, run_id: int) -> dict[str, int]:
    """Empty one run of its own annotations and assets, in place.

    **Scoped by ``run_id`` and by the run's own ``target_asset_ids``, and by
    nothing else.** A previous cleanup here filtered on "everything in the
    infospace that is not in my list" and destroyed four rows that were not the
    fixture's. The rule that prevents a repeat is not care, it is the predicate:
    delete only what this run created, never everything a run did not.

    Returns what it removed, so the caller can print it rather than assume it.
    """
    asset_ids = session.execute(text(
        "SELECT configuration->'target_asset_ids' FROM annotationrun WHERE id = :r"
    ), {"r": run_id}).scalar() or []
    asset_ids = [int(a) for a in asset_ids]

    ann = session.execute(
        text("DELETE FROM annotation WHERE run_id = :r"), {"r": run_id}
    ).rowcount
    assets = 0
    if asset_ids:
        assets = session.execute(
            text("DELETE FROM asset WHERE id = ANY(:ids) AND id NOT IN ("
                 "  SELECT asset_id FROM annotation WHERE asset_id = ANY(:ids))"),
            {"ids": asset_ids},
        ).rowcount
    session.commit()
    return {"annotations": ann, "assets": assets}


def seed(
    session: Session, *, owner_email: str | None = None,
    infospace_id: int | None = None, run_id: int | None = None,
) -> dict[str, int]:
    """Create an infospace, schema, assets, run and annotations. Returns ids.

    ``run_id`` re-fills an existing run in place instead of minting another one.
    The fixture is meant to be iterated on, and a seeder that could only append
    left seven near-identical runs in one infospace with no way to tell which
    was current.

    Through the ORM rather than raw inserts, unlike the test helpers: those want
    speed and isolation, this wants to produce a row a running application will
    accept. The models carry the defaults for a dozen NOT NULL columns a
    hand-written INSERT has to rediscover one error at a time.
    """
    from app.api.modules.annotation.models import (
        Annotation, AnnotationRun, AnnotationSchema,
    )
    from app.schemas import RunStatus
    from app.models import Asset, Infospace, User

    # **Owned by a real user, or it cannot be opened.**
    #
    # Defaulting to a fixture-owned account made an infospace that exists,
    # assembles, passes every test and is invisible in the UI — which is the
    # least useful possible state for something whose whole purpose is to be
    # looked at. Tests pass an explicit email; a bare `seed()` hands the corpus
    # to whoever actually uses this deployment.
    if owner_email is None:
        uid = session.execute(text(
            'SELECT id FROM "user" WHERE is_superuser ORDER BY id LIMIT 1'
        )).scalar() or session.execute(text(
            'SELECT id FROM "user" ORDER BY id LIMIT 1'
        )).scalar()
        if uid is None:
            raise RuntimeError("no user to own the scenario — create one first")
        owner_email = session.execute(text(
            'SELECT email FROM "user" WHERE id = :i'), {"i": uid}).scalar()
    uid = session.execute(
        text('SELECT id FROM "user" WHERE email = :e'), {"e": owner_email}
    ).scalar()
    if uid is None:
        u = User(email=owner_email, hashed_password="x", is_active=True,
                 full_name="Scenario fixture")
        session.add(u)
        session.commit()
        session.refresh(u)
        uid = u.id

    # Into an EXISTING infospace when one is named. A fixture is something you
    # keep beside your own work, not a place you have to go somewhere else to
    # look at — and a new infospace per seeding run accumulates fast.
    if infospace_id is not None:
        space = session.get(Infospace, infospace_id)
        if space is None:
            raise RuntimeError(f"infospace {infospace_id} does not exist")
        if space.owner_id != uid:
            raise RuntimeError(
                f"infospace {infospace_id} belongs to another user — seeding "
                f"into it would put the fixture somewhere its owner did not ask "
                f"for it")
    else:
        space = Infospace(
            name="Mega scenario", owner_id=uid,
            description="Hand-written fixture — all six investigation shapes.",
        )
        session.add(space)
        session.commit()
        session.refresh(space)

    # Re-runnable. An active schema is unique on (infospace, name, version), and
    # seeding twice into one infospace is the normal case — you want another run
    # over the same contract, not a second contract. Identical contract → reuse;
    # a changed one → a new version, so an older run keeps the schema it was
    # actually annotated against.
    built = contract()
    existing = list(session.exec(  # type: ignore[call-overload]
        select(AnnotationSchema)
        .where(AnnotationSchema.infospace_id == space.id)
        .where(AnnotationSchema.name == "Scenario v2")
    ).all())
    schema = next((e for e in existing if e.output_contract == built), None)
    if schema is None:
        versions = {str(e.version) for e in existing}
        version, n = "1.0", 1
        while version in versions:
            n += 1
            version = f"{n}.0"
        schema = AnnotationSchema(
            name="Scenario v2", description="the full v2 contract",
            output_contract=built, infospace_id=space.id, user_id=uid,
            version=version,
        )
        session.add(schema)
        session.commit()
        session.refresh(schema)

    run = session.get(AnnotationRun, run_id) if run_id else None
    if run is not None:
        removed = _clear_run(session, run.id)
        print(f"  re-filling run {run.id}: removed {removed['annotations']} "
              f"annotations, {removed['assets']} assets")
        run.status = RunStatus.COMPLETED
        run.started_at = run.started_at or datetime.now()
        run.completed_at = datetime.now()
        run.progress_total = run.progress_current = len(documents())
    else:
        run = AnnotationRun(
            name="Mega scenario", description="six shapes, one corpus",
            infospace_id=space.id, user_id=uid, status=RunStatus.COMPLETED,
            # A COMPLETED run that never started reads as broken wherever
            # progress is shown. The fixture did not run, but it has to look
            # like something that did, or the UI describes a state that cannot
            # occur.
            started_at=datetime.now(), completed_at=datetime.now(),
            progress_total=len(documents()), progress_current=len(documents()),
            configuration={"justifications_enabled": True},
        )
    session.add(run)
    session.commit()
    session.refresh(run)

    run.views_config = _graph_panel(schema.id)
    session.add(run)
    session.commit()

    # **The run must DECLARE its schema, or the UI cannot open it.**
    #
    # Annotations carry a `schema_id` each, so the graph assembles perfectly
    # from the CLI — which is how this went unnoticed. But the panel resolves
    # its schemas from `runschemalink`, and with no row there a run has no
    # contract to read, no field pickers, and nothing to render. Assembling
    # correctly and being openable are two different things.
    session.execute(
        text("INSERT INTO runschemalink (run_id, schema_id) VALUES (:r, :s) "
             "ON CONFLICT DO NOTHING"),
        {"r": run.id, "s": schema.id},
    )
    session.commit()

    _seed_place_coords(session, space.id, uid)

    asset_ids: list[int] = []
    for meta, value in documents():
        asset = Asset(
            title=meta["title"], kind=meta["kind"], infospace_id=space.id,
            user_id=uid, bundle_ids=[],
            # The asset rung of the time ladder. Every node in this corpus is
            # dated even where a row is not, which is the whole point of it.
            event_timestamp=datetime.fromisoformat(meta["when"]),
            source_metadata={"corpus": meta["corpus"]},
        )
        session.add(asset)
        session.commit()
        session.refresh(asset)
        asset_ids.append(asset.id)
        session.add(Annotation(
            asset_id=asset.id, schema_id=schema.id, run_id=run.id,
            infospace_id=space.id, user_id=uid, value={"document": value},
        ))
    session.commit()

    # The assets this run covers. Read wherever a run is asked what it is over.
    run.configuration = {**(run.configuration or {}),
                         "target_asset_ids": asset_ids}
    session.add(run)
    session.commit()

    return {"user": uid, "infospace": space.id, "schema": schema.id,
            "run": run.id, "documents": len(documents())}


def _graph_panel(schema_id: int) -> list[dict[str, Any]]:
    """A dashboard with one graph panel, so the run OPENS on something.

    Deliberately almost empty. `projections` is unset and `source` is absent —
    a schema written in the observation model graphs itself, and the point of
    the fixture is to exercise that path rather than to hand-configure around
    it. The panel arrives showing all nine layers because nothing told it not
    to.

    `node_group_by` is the one thing set, because the interest profile is what
    the free interest frame and the convergence residual both read, and it is
    computed from the assembled graph rather than off a row.
    """
    fid = "scenario-graph"
    return [{
        "name": "Mega scenario",
        "description": "Six investigation shapes over one mixed corpus.",
        "layout": {"type": "grid", "columns": 24, "rowHeight": 75},
        "panels": [{
            "id": fid,
            "name": "The graph",
            "type": "graph",
            "description": "Nine layers, derived. Geo on the plane, time up.",
            "fields": [],
            "formula": {
                "id": f"{fid}-f", "name": "The graph", "version": 1,
                "group": [], "measures": [], "derives": [], "merge_maps": [],
                "output_keys": [], "filter": {"logic": "and", "conditions": []},
                "weight": None, "snippet": None, "order_by": None,
                "explosion": None, "schema_id": schema_id,
            },
            "panel_config": {
                "kind": "graph",
                "edge_weight_mode": "count",
                "forward_properties": [],
                "null_policy": "skip",
                "layout": {"kind": "force_directed", "params": {}},
                "dim_unmatched": True,
                # The why-axis, computed from the edge set. Signed, so an
                # actor who opposes an interest reads as an adversary rather
                # than as an ally.
                "node_group_by": "neighbours:Interest",
                # Panel-wide, so it needs the FULL path. A bare key resolves at
                # the annotation root and every edge comes back ungrouped —
                # silently, and a denial then paints like an assertion.
                "edge_group_by": "document.observations[*].modality",
                "axes": {"plane": "geo", "up": "time", "pin": True},
            },
            "grid_position": {"x": 0, "y": 0, "w": 24, "h": 14},
            "settings": {},
            "collapsed": False,
            "scopes_in": [],
            "merge_maps": [],
            "local_filters": {},
            "time_source": "event_timestamp",
        }],
    }]


def _seed_place_coords(session: Session, infospace_id: int, uid: int) -> None:
    """Curated coordinates, the way a curated corpus would carry them.

    ``stream._attach_coords`` reads ``CanonEntry.properties.coords`` and lets it
    overwrite the enricher's guess — the geocoder is a cache, a curated entry is
    a decision. Models are never asked for coordinates (see BASE_GUIDANCE), so
    this is the only honest way a fixture gets them.
    """
    from app.api.modules.graph.models import Canon, CanonEntry
    from app.api.modules.graph.resolution import norm_type

    # Reused, like the schema. Seeding twice into one infospace is the normal
    # case, and a fresh canon each time accumulates duplicate entries for every
    # place — harmless to the graph (identity is name+type) and noise everywhere
    # a canon is listed.
    canon = session.exec(
        select(Canon).where(Canon.infospace_id == infospace_id,
                            Canon.name == "Scenario places")
    ).first()
    if canon is None:
        canon = Canon(infospace_id=infospace_id, name="Scenario places",
                      description="curated coordinates for the fixture")
        session.add(canon)
        session.commit()
        session.refresh(canon)

    have = {
        e.canonical for e in session.exec(
            select(CanonEntry).where(CanonEntry.canon_id == canon.id)
        ).all()
    }

    for name, (lat, lon) in PLACE_COORDS.items():
        if name in have:
            continue
        session.add(CanonEntry(
            infospace_id=infospace_id, canon_id=canon.id,
            canonical=name,
            # `norm_type`, not "Location". `CanonEntry.type` is the resolution
            # key and its casing decides identity, which is the whole reason
            # that helper exists — and the geocode action writes `location`.
            type=norm_type("Location"),
            # GeoJSON order — `_coord_pair` reads [lon, lat] from a list, which
            # is what the geocode action persists.
            properties={"coords": [lon, lat]},
        ))
    session.commit()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--verify", action="store_true",
                    help="assemble the graph and print what each case returns")
    ap.add_argument("--infospace", type=int, default=None,
                    help="seed into this existing infospace "
                         "(default: create a new one)")
    ap.add_argument("--owner", default=None,
                    help="email of the user who should own it "
                         "(default: this deployment's superuser)")
    ap.add_argument("--run", type=int, default=None,
                    help="re-fill this existing run in place instead of "
                         "creating another one")
    args = ap.parse_args()

    with Session(engine) as s:
        ids = seed(s, owner_email=args.owner, infospace_id=args.infospace,
                   run_id=args.run)
        owner = s.execute(text('SELECT email FROM "user" WHERE id = :i'),
                          {"i": ids["user"]}).scalar()
    print(json.dumps({**ids, "owner": owner}, indent=2))
    print(f"\n  inspect:  python -m app.api.modules.annotation.inspect_run {ids['run']}")

    if args.verify:
        from app.api.modules.annotation.scenario_verify import report
        report(ids["run"], ids["infospace"])


if __name__ == "__main__":
    main()
