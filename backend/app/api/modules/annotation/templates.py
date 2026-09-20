"""Schema templates — the observation model, as something you can start from.

Everything the graph does works only on schemas written in the pattern. Until
this module existed, writing one meant knowing which ``x-*`` extensions to
emit, in which nesting, with which cross-references — so in practice only the
people who built it could produce one. That is the opposite of the point.

**One source, both authors.** ``adapters.ts`` (the editor) and
``mcp_server._fields_to_output_contract`` (the companion) have each grown their
own idea of what a contract looks like, and they have drifted before: A2 fixed
a bug where companion-authored entity fields silently lacked ``x-entityField``
and could not produce a graph at all. Templates are defined here, once, and
served — so a companion-authored schema and a hand-authored one are the same
artifact.

**Prompt guidance rides ``description``.** Not a separate prompt, not a system
message: ``annotate.py:_format_prop_line`` already renders field descriptions
into the extraction prompt, descriptions sit inside the cached prefix so they
cost nothing per turn, and they travel with the schema when it is exported or
shared. No new machinery, and the guidance cannot become separated from the
fields it is about.

─────────────────────────────────────────────────────────────────────────────

**The v2 vocabulary** — see ``docs/plans/observation-model/HANDOVER.md`` §5–6.
Four rosters, four kinds of claim array, one epistemic layer, three document
slots:

.. code-block:: text

    ROSTERS         actors · instruments · places · interests
    EVENTS[*]       the referent — a named happening many readings are of
    OBSERVATIONS[*] what ONE document reports · generic named roles
    ATTRIBUTES[*]   what holds of one thing, over an interval
    RELATIONS[*]    what holds between two
    EVIDENCE[*]     grounds that recur, and therefore earn a name
    at · dated · ref

Roles are **generic and named** — ``by``/``with``/``to``/``via``/``concerns``.
Generic, so ``role:via degree>20`` finds intermediaries in payments, meetings
and filings with one query instead of only in money. Named, so role-scoped
degree exists at all. ``payer``/``payee``/``bank`` are not lost: they are
``by``/``to``/``via`` under ``kind: payment``.

The vocabularies below are **starting points, never closed sets**. A user's own
taxonomy always wins — the system knows ``roster``, ``claim`` and ``about``; it
does not know "payment".
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.api.modules.annotation.sections import DECL_EXTENSION, decl_for_name

__all__ = [
    "ARCHETYPES",
    "BASE_GUIDANCE",
    "TIERS",
    "Archetype",
    "SchemaTemplate",
    "Tier",
    "build_contract",
    "build_doc_anchors",
    "build_news_contract",
    "build_projections",
    "list_templates",
    "news_doc_anchors",
    "news_projections",
    "score_field",
]

Tier = Literal["minimal", "standard", "full"]


# ─── Prompt guidance ─────────────────────────────────────────────────────────

#: Rides the contract's top-level ``description``. Every line prevents a
#: failure this model has actually been bitten by — see the observation-model
#: handover §19.
BASE_GUIDANCE = """\
NAMING. Use one spelling for one real-world thing, everywhere in your output. \
If the document says "A. Rossi", "Rossi" and "Alessandro Rossi", pick the \
fullest form and use exactly that in every field.

ROSTERS ARE THE VOCABULARY. Every person, organisation, place or thing you name \
anywhere must also appear in its own list. Other fields refer to those names.

ONE ROW PER HAPPENING. If something happened twice, emit two rows — even when \
the participants and the wording are identical. Never merge two into one row \
with a wider date range.

WHO DID IT, TO WHOM, THROUGH WHOM. `by` is the one acting. `to` is who or what \
it was done to. `via` is who or what it ran through — an intermediary, an \
account, a vehicle. Fill `via` whenever the document names one; it is often the \
most important field in the row.

DATES AND PLACES BELONG TO THE ROW THEY DESCRIBE. Do not copy the document's \
own date onto every row. A row with no date of its own leaves the field empty.

PLACE NAMES, NEVER COORDINATES. Give place names exactly as the document \
writes them. Never produce latitudes, longitudes or coordinates.

DATES ARE ABSOLUTE. Every date field takes a calendar date — 2016-04-22, or \
2016-04 if that is all the text gives. The document's own date is stated at the \
top of the text: resolve "Wednesday", "yesterday" and "last month" against it \
and write the calendar date you arrive at. Where the reference is genuinely \
vague — "recently", "in the spring", "back then" — leave the field empty. An \
empty date costs nothing and inherits the document's; a guessed one is a \
fabrication that looks like a fact.

NAMES COME FROM THE DOCUMENT. Use only identifiers, exhibit labels and event \
names the document itself provides. Never invent one. An invented event name \
invents a story.

QUOTE, DO NOT PARAPHRASE. A justification must contain the document's own \
words for the part that supports the claim. If you cannot quote it, do not \
claim it.

LEAVE IT OUT. An empty field is the correct answer when the document does not \
say. Do not infer, do not fill in something plausible, and do not write \
"unknown" or "N/A"."""


# ─── Starter vocabularies ────────────────────────────────────────────────────

RELATION_PREDICATES = [
    "works_for", "owns", "controls", "represents", "advises", "family_of",
    "member_of", "subsidiary_of", "nominee_for", "acts_for", "same_as",
    "cites", "supersedes", "subsumes", "furthers", "opposes", "part_of",
]
#: The three predicates that make a frame ZOOMABLE or ORDERABLE. `part_of` and
#: `subsumes` are containment — a place inside a place, a hearing inside a case,
#: a narrow interest inside a broad one. `furthers` is advancement: an interest
#: that ADVANCES another without being a component of it, which is the only
#: ordering that gives a direction rather than a nesting, and therefore the one
#: that makes an interest a vector. Read by ``gql._SUBSUMES`` for `serves:X+`.
HIERARCHY_PREDICATES = ["part_of", "subsumes", "furthers"]
EVIDENCE_STANCES = ["supports", "contradicts", "corrects", "retracts", "qualifies"]
EVIDENCE_KINDS = [
    "deposition", "email", "filing", "log", "record", "photograph",
    "transcript", "report", "contract",
]
#: The epistemic status of an ACT, not only of a speech act. Universal, and what
#: drives edge painting everywhere: a denial must never render like an assertion.
MODALITIES = [
    "done", "attempted", "planned", "asserted", "denied", "alleged",
    "reported", "unrecalled", "declined",
]
ATTRIBUTE_KINDS = [
    "seat", "office", "role", "status", "measure", "domain",
    "registered_office", "head_office", "tax_residence", "branch",
]
#: Spheres an interest belongs to. An attribute rather than a field on the
#: interest, because an entity slot is a closed ``{name, type}`` shape and
#: ``schema_map`` does not walk into one — a property of an entity is an
#: ``attributes`` row, which is the whole reason that section exists.
INTEREST_DOMAINS = [
    "economic", "political", "security", "legal", "reputational",
    "humanitarian", "environmental",
]
STATUSES = [
    "active", "dormant", "struck", "liquidated", "dissolved", "merged",
    "listed", "delisted", "sanctioned", "under_investigation",
]
INTERESTS = [
    "financial_gain", "opacity", "tax_minimisation", "regulatory_capture",
    "territorial_control", "market_position", "reputational_defence",
    "information_control", "legal_shielding", "political_access",
]
EVENT_KINDS = [
    "case", "election", "merger", "investigation", "release", "summit",
    "conflict", "reform", "scandal", "programme",
]

#: Types a role may carry when it spans rosters. Kept beside the unions they
#: serve so the two cannot drift.
ACTOR_TYPES = ["Person", "Organization", "State"]
INSTRUMENT_TYPES = ["Account", "Vessel", "Aircraft", "Document", "Property"]


# ─── JSON Schema fragment builders ───────────────────────────────────────────
#
# These emit exactly the shape ``schema_map`` reads and ``adapters.ts`` writes.
# Keeping them here rather than in either emitter is what stops the two from
# disagreeing about what an entity field looks like.


def entity(
    entity_type: str,
    *,
    alternates: list[str] | None = None,
    ref: str | list[str] | None = None,
    constrained: bool = True,
    description: str | None = None,
) -> dict[str, Any]:
    """One entity reference — the atom, ``{name, type}``.

    ``ref`` names the field(s) whose vocabulary this one reuses. Section-
    relative, no ``[*]`` markers, matching what
    ``schema_map._resolve_vocabularies`` resolves against.

    **A list when the role spans rosters.** A ``via`` is an intermediary *or* a
    routing account; a ``concerns`` can be an actor, a place or an instrument.
    One target forced such a field to misdescribe where its vocabulary comes
    from. Merging never depended on it — node identity is ``name + type`` — so
    what a list adds is the declaration.
    """
    node: dict[str, Any] = {
        "type": "object",
        "x-entityField": True,
        "x-entityType": entity_type,
        "x-entityTypeConstrained": constrained,
        "properties": {
            "name": {"type": "string"},
            "type": {"type": "string", "x-entityTypeDeclared": entity_type},
            "additional_types": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name"],
    }
    if alternates:
        node["x-entityAlternateTypes"] = list(alternates)
    if description:
        node["description"] = description
    out: dict[str, Any] = dict(node)
    if ref:
        # One target stays a bare string, so contracts authored before unions
        # existed stay byte-identical.
        refs = [ref] if isinstance(ref, str) else list(ref)
        out["x-ref"] = refs[0] if len(refs) == 1 else refs
    return out


def entity_list(
    entity_type: str,
    *,
    description: str,
    alternates: list[str] | None = None,
    ref: str | list[str] | None = None,
) -> dict[str, Any]:
    """A multi-valued role — several entities in one slot."""
    return {
        "type": "array",
        "description": description,
        "items": entity(entity_type, alternates=alternates, ref=ref),
    }


def roster(
    entity_type: str,
    *,
    alternates: list[str] | None = None,
    description: str,
    graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A named set — declared once, referred to by name everywhere else."""
    out: dict[str, Any] = {
        "type": "array",
        "description": description,
        "items": entity(entity_type, alternates=alternates),
    }
    if graph:
        out[DECL_EXTENSION] = graph
    return out


def enum_field(values: list[str], description: str) -> dict[str, Any]:
    return {"type": "string", "enum": list(values), "description": description}


def date_field(description: str) -> dict[str, Any]:
    return {"type": "string", "format": "date", "description": description}


def score_field(description: str) -> dict[str, Any]:
    """A 1–10 integer. The one scale, so scores are comparable across sections.

    Bounded and integral on purpose. A free number invites units nobody
    declared and a 0–1 float invites a probability reading the model cannot
    honour; 1–10 is a rank, it says so, and ``WEIGHT:`` can size by it without
    pooling across incommensurable things. The description on each use says what
    1 and what 10 mean — a scale without anchors is noise that sorts.
    """
    return {"type": "integer", "minimum": 1, "maximum": 10, "description": description}


def rows(
    *, description: str, properties: dict[str, Any], justify: bool = False,
    graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A claim section — an array of rows over the named sets.

    ``graph`` is the section's :data:`sections.DECL_EXTENSION` declaration —
    what it IS, carried by the contract rather than inferred from what it is
    called. Written here, beside the fields it binds, so the two cannot drift:
    a binding that names ``covers_from`` is emitted in the same breath as the
    ``covers_from`` field, under the same condition.
    """
    items: dict[str, Any] = {"type": "object", "properties": dict(properties)}
    if justify:
        items["include_justification"] = True
    out: dict[str, Any] = {"type": "array", "description": description, "items": items}
    if graph:
        out[DECL_EXTENSION] = graph
    return out


def _decl(name: str, **overrides: Any) -> dict[str, Any]:
    """The conventional declaration for *name*, with tier/archetype tweaks.

    A ``None`` override REMOVES a key rather than setting it to null — which is
    what "this tier has no places, so this section binds none" means. The
    conditions live at the emission site because that is where the fields they
    depend on are decided; keeping them here and the fields elsewhere is what
    let ``_SECTION_BINDINGS`` and this function drift apart in the first place.
    """
    out = decl_for_name(name) or {}
    for key, value in overrides.items():
        if value is None:
            out.pop(key, None)
        else:
            out[key] = value
    return out


# ─── Archetypes ──────────────────────────────────────────────────────────────


class Archetype(BaseModel):
    """A pre-filled instance of the claim kinds — never an extension of them.

    In v1 an archetype supplied a whole field set, so nine of them meant nine
    near-identical arrays and nothing comparable across them. With generic
    roles an archetype supplies **a vocabulary and some guidance**: the ``kind``
    values it contributes to its section's enum, and the sentences that tell a
    model how to fill the shared slots for that sort of row.

    That every archetype fits without adding a section remains the test that
    the model is finished. If a proposed one needs a fifth section, the model is
    wrong, not the archetype.
    """

    id: str
    label: str
    section: Literal["observations", "attributes", "relations", "evidence"]
    kinds: list[str] = Field(default_factory=list)
    """Values this archetype contributes to its section's ``kind`` enum."""
    extras: list[str] = Field(default_factory=list)
    """Optional slots this archetype needs — ``trajectory`` (origin and
    destination) and ``covers`` (the second clock). Conditional, so a domain
    that never moves anything is not asked about origins on every row."""
    hint: str
    guidance: str


ARCHETYPES: list[Archetype] = [
    Archetype(
        id="encounters", label="Encounters", section="observations",
        kinds=["meeting", "call", "visit", "summit", "encounter"],
        hint="Meetings, calls, visits — who was together, when and where.",
        guidance=("For an encounter put everyone present in `with`, not only the "
                  "two most prominent. Use `by` only when one party convened it."),
    ),
    Archetype(
        id="movements", label="Movements", section="observations",
        kinds=["journey", "flight", "shipment", "relocation"],
        extras=["trajectory"],
        hint="Journeys with an origin and a destination.",
        guidance=("For a movement, `origin` and `destination` are separate fields "
                  "and the vehicle goes in `via`. Everyone travelling goes in "
                  "`with`."),
    ),
    Archetype(
        id="transfers", label="Transfers", section="observations",
        kinds=["payment", "donation", "loan", "grant", "arms_transfer", "transfer"],
        hint="Payments, donations, arms, aid — value moving between parties.",
        guidance=("For a transfer, `by` is the sender, `to` is the recipient, and "
                  "any bank, broker or intermediary goes in `via`. The amount goes "
                  "in `magnitude`, as stated — never converted."),
    ),
    Archetype(
        id="holdings", label="Holdings", section="observations",
        kinds=["acquisition", "disposal", "stake_change", "appointment"],
        hint="Changes of ownership or control.",
        guidance=("A CHANGE is a row here; the resulting STATE is an attribute. "
                  "'Acquired 40% in March' is an observation; 'holds 40% from "
                  "March' is an attribute with a date range."),
    ),
    Archetype(
        id="statements", label="Statements", section="observations",
        kinds=["statement", "testimony", "filing", "publication", "ruling"],
        extras=["covers"],
        hint="Testimony, filings and public claims. Two clocks.",
        guidance=("For a statement, `by` is the speaker and `concerns` is who or "
                  "what it is about. Two dates matter and they are usually "
                  "different: `when` it was said, and `covers_from`/`covers_until` "
                  "for the period it is about. Record `modality` exactly — denying, "
                  "not recalling and declining to answer are not asserting."),
    ),
    Archetype(
        id="seats", label="Seats and offices", section="attributes",
        kinds=["seat", "office", "registered_office", "head_office",
               "tax_residence", "branch", "role", "status"],
        hint="Registered offices, posts held, statuses — over intervals.",
        guidance=("One row per property per period. A company can hold a "
                  "registered office, a head office and a tax residence at the "
                  "same time, in different countries."),
    ),
    Archetype(
        id="measurements", label="Measurements", section="attributes",
        kinds=["measure"],
        hint="Budgets, counts, indicators — a number about a subject over a period.",
        guidance=("For a measure, the figure goes in `magnitude` and what it "
                  "measures in `value`. Do not convert or normalise. The subject "
                  "can be a place or an institution, not only an actor."),
    ),
    Archetype(
        id="memberships", label="Standing links", section="relations",
        hint="Party, board, coalition, counsel — a link that holds over time.",
        guidance=("Only for links that hold over time. If it happened on a date, "
                  "it is an observation, not a relation."),
    ),
    Archetype(
        id="citations", label="Citations", section="evidence",
        hint="Exhibits, transcript pages, filings the document names.",
        guidance=("Use this only for grounds the document itself names or numbers. "
                  "Otherwise put the quote in the row's own justification field."),
    ),
]


def _extras_of(picked: list["Archetype"]) -> set[str]:
    """Optional slots the chosen archetypes need — ``trajectory``, ``covers``."""
    return {e for a in picked for e in a.extras}


def _picked(archetypes: list[str] | None) -> list[Archetype]:
    chosen = [a for a in ARCHETYPES if not archetypes or a.id in archetypes]
    return chosen or [a for a in ARCHETYPES if a.id == "encounters"]


def _kinds_for(
    picked: list[Archetype], section: str, fallback: list[str],
    *, always: list[str] | None = None,
) -> list[str]:
    """The ``kind`` enum a section offers — the union of what was picked.

    ``always`` is for kinds that belong to the *model* rather than to any
    archetype, and so must survive the narrowing. ``domain`` is the case: an
    interest's sphere is not a property of the "seats" or "measurements" lens,
    it is how the why-axis is grouped at all, and an archetype set that happened
    to exclude it would silently make Case 5 unaskable.
    """
    out: list[str] = []
    for a in picked:
        if a.section != section:
            continue
        for k in a.kinds:
            if k not in out:
                out.append(k)
    out = out or list(fallback)
    for k in always or ():
        if k not in out:
            out.append(k)
    return out


def _prose_for(picked: list[Archetype], section: str, lead: str) -> str:
    """A section's description: what it is, then how to fill it per archetype."""
    parts = [lead]
    parts += [f"{a.hint} {a.guidance}" for a in picked if a.section == section]
    return "\n\n".join(parts)


def _has(picked: list[Archetype], section: str) -> bool:
    return any(a.section == section for a in picked)


# ─── Section assembly ────────────────────────────────────────────────────────


def _observation_props(
    picked: list[Archetype], *, tier: Tier, has_places: bool,
) -> dict[str, Any]:
    """The slots every observation shares, plus the two conditional ones.

    One field set for every kind of act. That is what makes ``role:via`` a
    cross-domain query and what collapses the archetype combinatorics into a
    label — the alternative, a section per archetype, made nothing comparable
    across them.
    """
    full = tier == "full"
    #: The why-axis arrives at STANDARD, not at full.
    #:
    #: It used to be a `full` addition alongside instruments, events, attributes
    #: and evidence — all of which are docket-shaped. Interests are not: two of
    #: the six investigation shapes (convergence without contact, and divergence
    #: across domains) are *news*-shaped and turn entirely on the why-axis, and
    #: news is exactly the corpus you reach for `standard` to annotate. It is
    #: also by far the cheapest of that group — one roster and two arrays —
    #: where the others are whole sections.
    has_interests = tier in ("standard", "full")
    extras = {e for a in picked for e in a.extras}
    #: `to` and `via` span rosters — a recipient can be an account, an
    #: intermediary can be a vehicle. Only meaningful once instruments exist.
    spans: list[str] = ["actors"] + (["instruments"] if full else [])
    also_instruments = INSTRUMENT_TYPES if full else []

    props: dict[str, Any] = {
        "kind": enum_field(
            _kinds_for(picked, "observations", ["encounter"]),
            "What sort of act this row records. Pick the closest.",
        ),
        "by": entity_list(
            "Person", alternates=ACTOR_TYPES[1:], ref="actors",
            description="Who did it — the actor or actors acting.",
        ),
        "with": entity_list(
            "Person", alternates=ACTOR_TYPES[1:], ref="actors",
            description="Who else took part, as a participant rather than an agent.",
        ),
        "to": entity_list(
            "Person", alternates=ACTOR_TYPES[1:] + also_instruments, ref=spans,
            description="Who or what it was done to — the recipient or target.",
        ),
        "via": entity_list(
            "Organization", alternates=["Person"] + also_instruments, ref=spans,
            description=("Who or what it ran through — an intermediary, a bank, an "
                         "account, a vehicle. Fill this whenever the document names "
                         "one."),
        ),
    }

    if has_places:
        props["at"] = entity("Location", ref="places",
                             description="Where it happened.")
        if "trajectory" in extras:
            props["origin"] = entity("Location", ref="places",
                                     description="Where it started from.")
            props["destination"] = entity("Location", ref="places",
                                          description="Where it ended up.")

    props["when"] = date_field(
        "When it happened, as a calendar date. A weekday or a relative time "
        "resolves against the document date given at the top of the text; if "
        "it cannot be resolved, leave this empty and the document's own date "
        "is used, which is better than a guess.")
    props["until"] = date_field("When it ended, if it spanned time.")
    if "covers" in extras:
        props["covers_from"] = date_field(
            "Start of the period this row is ABOUT — often years before it was "
            "recorded. Only when the text says so; a vague \"back then\" is not "
            "a date.")
        props["covers_until"] = date_field(
            "End of that period. Leave empty for a single moment.")

    props["modality"] = enum_field(
        MODALITIES,
        "How the act stands — done, only attempted, merely alleged, denied. "
        "Record it exactly as the document has it.")
    props["magnitude"] = {
        "type": "number",
        "description": ("What it was worth — an amount, a percentage, a count. "
                        "As stated; do not convert."),
    }
    props["id"] = {
        "type": "string",
        "description": ("A reference number the DOCUMENT gives THIS row. Usually "
                        "there is none; leave it empty then. Never invent one."),
    }

    if has_interests:
        props["serves"] = entity_list(
            "Interest", ref="interests",
            description=("Interests this act furthers. Only when the document "
                         "supports it — an unsupported motive is worse than none, "
                         "and every entry here must be backed by the justification."),
        )
        # The signed twin. Without it the model can say WHAT an act was for and
        # never that it was AGAINST something: `modality` is epistemic (done vs
        # denied vs alleged) and `magnitude` is unsigned, so nothing in the row
        # carried a direction.
        #
        # It is also what makes divergence computable rather than asserted. An
        # interest profile built from `serves` alone can only find agreement;
        # signed with `opposes`, two actors who care about the same interest
        # oppositely come out NEGATIVE under the same cosine — and "warm in
        # trade, hostile in politics" stops being two findings that a reader has
        # to notice are about one pair.
        props["opposes"] = entity_list(
            "Interest", ref="interests",
            description=("Interests this act works AGAINST — blocks, delays, "
                         "undermines or is directed at frustrating. Same bar as "
                         "`serves`: only when the document supports it, and the "
                         "justification must carry the words. An act can do both "
                         "at once, and when it does, say both."),
        )
    if full:
        props["concerns"] = entity_list(
            "Person",
            alternates=ACTOR_TYPES[1:] + INSTRUMENT_TYPES + ["Location"],
            ref=spans + (["places"] if has_places else []),
            description=("What the row is about, when that differs from who it was "
                         "done to."),
        )
        props["cites"] = entity_list(
            "Evidence",
            description=("Exhibits or documents this row relies on, exactly as the "
                         "text labels them — \"Exhibit C\", \"Document 1320-37\"."),
        )
        # **`during` belongs to what HAPPENED, and only there.**
        #
        # Not a limitation — the modelling answer. An occasion is something that
        # occurred, so what belongs to it is something that occurred. A standing
        # state does not happen; the CHANGE that produced it does, and that is an
        # observation. "The office moved during the restructuring" is a row here;
        # "the office is Zurich from 2014" is an attribute, and needs no occasion.
        #
        # It is also the only branch that could carry it. `about: <role>` draws
        # an edge only when a predicate is set, and then draws the SAME predicate
        # to every non-subject role; `about: between` pairs all roles, so a third
        # would fabricate `from → during`. Only `about: self` gives each role its
        # own labelled edge.
        props["during"] = entity_list(
            "Event",
            description=("The named happening this belongs to, exactly as the "
                         "document names it. Leave empty if it names none."),
        )
    return props


def build_contract(
    tier: Tier = "standard",
    archetypes: list[str] | None = None,
    *,
    actor_type: str = "Person",
    actor_alternates: list[str] | None = None,
) -> dict[str, Any]:
    """Assemble a runnable ``output_contract`` for a tier and archetype set.

    Tiers are strict supersets, so a schema grows without restructuring:

    * ``minimal``  — actors + observations. Already a working graph.
    * ``standard`` — adds places, standing relations, and a quote per row.
    * ``full``     — adds instruments, interests, the referent layer (events),
      entity properties and named evidence.
    """
    picked = _picked(archetypes)
    has_places = tier in ("standard", "full")
    has_interests = tier in ("standard", "full")
    full = tier == "full"
    justify = tier in ("standard", "full")

    props: dict[str, Any] = {
        "actors": roster(
            actor_type, alternates=actor_alternates or ACTOR_TYPES[1:],
            description=("Everyone and every organisation named anywhere in this "
                         "document. Other fields refer to these by name."),
            graph=_decl("actors"),
        ),
    }
    if has_places:
        props["places"] = roster(
            "Location", description="Every place named anywhere in this document.",
            graph=_decl("places"))
    if has_interests:
        # Moves with `serves`/`opposes` — a role that references a roster the
        # tier did not emit is a dangling `x-ref`, and the two must gate on the
        # same condition or one of them is always wrong.
        props["interests"] = roster(
            "Interest",
            description=("Goals and motives an act can further or work against. "
                         "Only list one when the document supports attributing "
                         "it — an unsupported motive is worse than none.\n\n"
                         "Name the goal, not the actor pursuing it: \"regulatory "
                         "approval\", not \"the ministry's interest\". Two "
                         "documents describing one goal should produce the same "
                         "words, which is what lets them be compared at all."),
            graph=_decl("interests"))
    if full:
        props["instruments"] = roster(
            "Account", alternates=INSTRUMENT_TYPES[1:], graph=_decl("instruments"),
            description=("Nameable things that are USED rather than acting — "
                         "accounts, vessels, aircraft, properties, documents. What "
                         "recurs here is often the mechanism."))
        # The referent layer. An observation is what THIS document reports; an
        # event is the happening many reports are of.
        props["events"] = rows(
            description=(
                "Named happenings this document refers to — a case, an election, a "
                "merger, a release. Many rows can belong to one event, and that is "
                "how scattered facts are shown to be one story.\n\n"
                "ONLY happenings the document gives a NAME. The test: could you "
                "search for it and find the same thing? \"Case 15-cv-07433\", "
                "\"the Panama Papers\", \"the 2016 election\" are names. A generic "
                "description of what occurred — \"a confirmation hearing\", \"the "
                "meeting\", \"an investigation\" — is NOT a name, however "
                "reasonable it reads. If the document names none, leave this "
                "empty; that is the correct answer and it is common. An invented "
                "event name invents a story."),
            properties={
                "name": {"type": "string",
                         "description": "The name the document uses, exactly."},
                "kind": enum_field(EVENT_KINDS, "What sort of happening it is."),
                "when": date_field("When it began, as a calendar date."),
                "until": date_field("When it ended, as a calendar date. Empty "
                                    "if ongoing."),
                # The two orderings. An event section without them is a bag of
                # happenings; with them it is a spine — which is what lets
                # observations sit at a POSITION rather than merely existing.
                "within": entity(
                    "Event", ref="events",
                    description=("The larger named happening this one is part "
                                 "of — a hearing inside a case, a raid inside "
                                 "an operation. Only when the document says so. "
                                 "Name it exactly as it appears in this list.")),
                "follows": entity(
                    "Event", ref="events",
                    description=("The happening this one came after, when the "
                                 "document presents them in sequence. Not the "
                                 "same as an earlier date: a filing follows a "
                                 "complaint even when both are dated the same "
                                 "day. Sequence only — never say one caused "
                                 "another.")),
                **({"at": entity("Location", ref="places",
                                 description="Where it took place.")}
                   if has_places else {}),
            },
            justify=justify,
            graph=_decl("events",
                        place={"at": "at.name"} if has_places else None),
        )

    props["observations"] = rows(
        description=_prose_for(
            picked, "observations",
            "What happened, as THIS document reports it. One row per act.",
        ),
        properties=_observation_props(picked, tier=tier, has_places=has_places),
        justify=justify,
        graph=_decl(
            "observations",
            # A movement spans its endpoints; it is at neither. The binding and
            # the `origin`/`destination` fields gate on the SAME `extras`, which
            # is the property that keeps a binding from naming a field the tier
            # never emitted.
            place=(None if not has_places else
                   {"start": "origin.name", "end": "destination.name"}
                   if "trajectory" in _extras_of(picked) else {"at": "at.name"}),
            # The second clock: the cursor scrubs when it was recorded, the
            # bars span the period it is about.
            activity=({"start": "covers_from", "end": "covers_until"}
                      if "covers" in _extras_of(picked) else None),
        ),
    )

    if full and _has(picked, "attributes"):
        props["attributes"] = rows(
            description=_prose_for(
                picked, "attributes",
                "A property OF one thing, over a period — where it is based, what "
                "role it holds, what state it is in, what it measures. One row per "
                "property per period; if it changed, that is two rows with two date "
                "ranges, never one row averaged.",
            ),
            properties={
                "subject": entity(
                    actor_type,
                    alternates=(ACTOR_TYPES[1:] + INSTRUMENT_TYPES
                                + ["Location", "Interest"]),
                    ref=(["actors", "instruments"]
                         + (["places"] if has_places else [])
                         + (["interests"] if full else [])),
                    description=("What the property is about. An actor, but also a "
                                 "place, an instrument or an interest."),
                ),
                "kind": enum_field(
                    _kinds_for(picked, "attributes", ATTRIBUTE_KINDS,
                               always=["domain"] if full else None),
                    "What kind of property this row states. `domain` on an "
                    "interest says which sphere it belongs to — economic, "
                    "political, security, legal, reputational — which is what "
                    "makes one actor's warmth in trade and hostility in "
                    "politics readable as one finding rather than two."),
                "place": (entity("Location", ref="places") if has_places
                          else {"type": "string"}),
                "value": {"type": "string", "description": "For non-place values."},
                "magnitude": {"type": "number", "description": "For measurements."},
                "from": date_field("When it began."),
                "until": date_field("When it ended. Empty means current."),
            },
            justify=justify,
            graph=_decl("attributes"),
        )

    if has_places and _has(picked, "relations"):
        # Both ends span every roster, and that is not a convenience.
        #
        # `from`/`to` referenced `actors` alone, which silently made two whole
        # classes of finding undeclarable. An ownership chain runs through
        # shells, and a shell lives in `instruments` — so the Panama shape
        # (person → shell → shell → asset) could not be stated in the
        # vocabulary the document had already declared. And the HIERARCHIES the
        # frames need — a city inside a country, a hearing inside a case, an
        # interest that advances another — are all links between two members of
        # ONE roster, which an actor-only `from` forbids outright.
        #
        # This is why an entity slot stays the closed `{name, type}` shape it
        # is: a roster item cannot grow a `within` field (``schema_map`` does
        # not walk into entity items, so the value would be extracted and then
        # reach nothing). Containment is a *link*, and links live here — where
        # they also get an interval and a justification, which a scalar field
        # could never carry. "Malta, until 1964" is a real thing to be able to
        # say.
        roster_union = (["actors", "instruments"]
                        + (["places"] if has_places else [])
                        + (["interests"] if full else []))
        endpoint_types = ACTOR_TYPES[1:] + INSTRUMENT_TYPES + ["Location", "Interest"]
        props["relations"] = rows(
            description=_prose_for(
                picked, "relations",
                "Standing links between two parties — facts that hold over time "
                "rather than things that happened.\n\n"
                "This is also where HIERARCHY goes, and it is worth filling: a "
                "place inside a larger place (`part_of`), a happening inside a "
                "larger one (`part_of`), an interest that is a component of a "
                "broader one (`subsumes`, pointing from the broader to the "
                "narrower) or that advances one without being part of it "
                "(`furthers`). Only when the document says so — an invented "
                "hierarchy reads as authoritative and is not.",
            ),
            properties={
                "from": entity(actor_type, alternates=endpoint_types,
                               ref=roster_union),
                "predicate": enum_field(RELATION_PREDICATES, "How they are linked."),
                "to": entity(actor_type, alternates=endpoint_types,
                             ref=roster_union),
                "from_date": date_field("When the link began."),
                "until": date_field("When it ended."),
            },
            justify=justify,
            graph=_decl("relations"),
        )

    if full and _has(picked, "evidence"):
        props["evidence"] = rows(
            description=_prose_for(
                picked, "evidence",
                "Grounds the document NAMES, so that many rows can point at the "
                "same one. Grounds it does not name belong in a row's own "
                "justification.",
            ),
            properties={
                "name": {"type": "string",
                         "description": ("The label the document gives it, exactly — "
                                         "\"Exhibit C\", \"Document 1320-37\". Rows "
                                         "that rely on it name the same label in "
                                         "their `cites` field; that is the link.")},
                "kind": enum_field(EVIDENCE_KINDS, "What sort of thing it is."),
                "stance": enum_field(
                    EVIDENCE_STANCES,
                    "How it bears on the matter it is offered for."),
                "locator": {"type": "string", "description": "Page, line, exhibit."},
                "quote": {"type": "string", "description": "The document's own words."},
            },
            graph=_decl("evidence"),
        )

    # The document rung — the weakest step of both ladders, plus the document's
    # own name. A document is a row about itself: where, when, what it is called.
    if has_places:
        props["at"] = entity("Location", ref="places",
                             description="The place this document is mainly about.")
    props["dated"] = date_field(
        "The date this document gives itself — filed, published, recorded. Not "
        "the date of the events it describes.")
    props["ref"] = {
        "type": "string",
        "description": ("The identifier this document gives itself — a case or "
                        "docket number, a report or filing reference. Copy it "
                        "exactly as written. Empty if it has none."),
    }

    return {
        "type": "object",
        "description": BASE_GUIDANCE,
        "properties": {"document": {"type": "object", "properties": props}},
    }




# ─── The news lens ───────────────────────────────────────────────────────────
#
# A purpose-built contract rather than a tier × archetype combination, because
# what a newsroom or a comparative-politics reading needs is not a subset of the
# general model — it is the general model plus three things the general model
# has no slot for:
#
#   FRAMING     who published it, in what kind of document, under which frame.
#               A corpus assembled from several registers is only comparable if
#               the register is a field; otherwise "the press says X" is a claim
#               about whichever outlets happened to be in the bundle.
#   ISSUE AREA  a `topics` roster, so an act can be filed under the policy
#               domain it belongs to independently of the goal it serves.
#               `serves:` answers WHY; `topic:` answers ABOUT WHAT, and coding
#               them as one field is the mistake every news ontology makes once.
#   INTENSITY   a 1–10 rank on every claim that has one — how hard the act was,
#               how sure the document is, how far the consequence reached. The
#               graph can then SIZE and SORT by something the model actually
#               stated instead of by degree, which only measures how much got
#               written down.
#
# Everything else is the observation model unchanged: four rosters, named
# events, claim rows that refer to them BY NAME, properties over intervals,
# standing links, named grounds. Every cross-section reference is an `x-ref`,
# which is what makes `role:`, `serves:`, `during:` and `cites:` resolve to one
# population instead of to a string that happens to match.

#: Issue areas. A starting vocabulary, not a closed set — the type is open and a
#: user's own coding frame always wins.
NEWS_TOPICS = [
    "security", "defence", "trade", "energy", "climate", "migration",
    "public_health", "rule_of_law", "human_rights", "elections",
    "fiscal_policy", "monetary_policy", "technology", "media_freedom",
    "corruption", "labour", "agriculture", "development",
]

#: What a document IS. The register it belongs to — the field that makes a
#: multi-source corpus comparable rather than merely large.
SOURCE_KINDS = [
    "wire_report", "news_report", "investigation", "analysis", "op_ed",
    "press_release", "communique", "speech", "transcript", "interview",
    "statistical_release", "court_filing", "legislative_record", "report",
]

#: Classic framing analysis, as a closed enum because the whole value of a frame
#: code is that two documents get the same word for the same treatment.
FRAMES_OF_COVERAGE = [
    "conflict", "economic", "security", "legal", "morality",
    "human_interest", "responsibility", "process", "capacity",
]

#: What one act IS. Wide on purpose — this is the `kind` that becomes the
#: occurrence node's TYPE, so `type:sanction` is only askable if the word exists.
NEWS_ACT_KINDS = [
    "statement", "speech", "interview", "publication", "leak",
    "meeting", "summit", "call", "visit", "negotiation",
    "agreement", "treaty_signing", "ratification", "withdrawal", "recognition",
    "vote", "ruling", "decree", "legislation", "veto",
    "appointment", "resignation", "dismissal", "election",
    "indictment", "arrest", "trial", "verdict", "pardon",
    "sanction", "tariff", "embargo", "expulsion", "travel_ban",
    "payment", "aid", "loan", "investment", "arms_transfer",
    "protest", "strike", "riot", "crackdown",
    "attack", "strike_military", "ceasefire", "deployment", "withdrawal_military",
    "investigation", "inspection", "audit", "warning", "denial",
]

#: How a thing MOVES. A separate section from `observations` because a journey
#: is at neither end of itself: it needs a trajectory place binding, and a
#: projection carries exactly one.
NEWS_MOVEMENT_KINDS = [
    "journey", "state_visit", "deployment", "evacuation", "shipment",
    "arms_shipment", "aid_delivery", "displacement", "relocation", "flight",
]

#: What a stance IS. Signed, because an ally and an adversary are not two
#: strengths of the same thing.
STANCE_POSITIONS = [
    "supports", "opposes", "conditionally_supports", "neutral",
    "ambivalent", "shifted_toward", "shifted_away", "declined_to_say",
]

NEWS_EVENT_CATEGORIES = [
    "war", "crisis", "election", "summit", "case", "negotiation",
    "investigation", "reform", "disaster", "programme", "scandal",
]

NEWS_EVENT_STATUS = ["ongoing", "concluded", "suspended", "announced", "expected"]

NEWS_ATTRIBUTE_KINDS = [
    "office", "seat", "mandate", "role", "status", "alignment",
    "indicator", "budget", "population", "capability", "membership_status",
    "registered_office", "head_office",
]

NEWS_EXHIBIT_KINDS = [
    "report", "dataset", "poll", "leak", "filing", "transcript",
    "photograph", "recording", "statement", "database", "map",
]

#: Guidance specific to reading news, appended to BASE_GUIDANCE. Each line is a
#: failure that news copy in particular produces.
NEWS_GUIDANCE = """\
THE DOCUMENT IS NOT A NEUTRAL WINDOW. Fill `outlet`, `source_kind` and `frame` \
for every document. A press release and a wire report about the same meeting are \
two documents with two frames, and the difference between them is often the \
finding. Never leave `outlet` empty: it is the publisher, and it is named at the \
top of the text or in the dateline.

ATTRIBUTE THE CLAIM, NOT THE WORLD. `modality` says on what footing the document \
puts each act: `done` for what it reports as fact, `reported` for what it \
attributes to someone else, `alleged` for an untested accusation, `denied` for \
what a named party rejects, `planned` for what has been announced but not \
happened. An act you cannot place on that scale does not belong in \
`observations`.

SCORES ARE RANKS, AND THEY NEED A REASON. Every 1–10 field says in its own \
description what 1 and what 10 mean. Use the whole range; a corpus where \
everything is a 7 sorts no better than one with no scores at all. If the \
document does not support a judgement, leave the score empty — that is a \
different statement from "average".

TOPIC IS NOT MOTIVE. `topic` is the policy area an act belongs to — trade, \
migration, defence. `serves` and `opposes` are the goals it advances or works \
against. A tariff's topic is `trade`; what it serves might be `domestic \
industrial protection`. Filing both under one word destroys both questions.

ONE ACT PER ROW, AND GIVE IT A LABEL. `label` is a short human phrase naming \
this specific act — "Merz-von der Leyen defence talks", "400m euro Sahel \
allocation". It is what a reader sees on the node. Never restate `kind` there."""


# ─── Projections ─────────────────────────────────────────────────────────────


def build_doc_anchors(tier: Tier = "standard") -> dict[str, str | None]:
    """The document rung, for a contract this module built.

    Separate from :func:`build_projections` because it is not a projection: a
    document's own place and date are annotation-scoped, and belong on the
    graph config beside them. Returned alongside so a template still delivers
    everything the panel needs in one payload — the point of a template being
    that the bindings arrive wired, not left as an exercise.
    """
    return {
        "doc_place": "document.at.name" if tier in ("standard", "full") else None,
        "doc_time": "document.dated",
    }


def build_projections(
    tier: Tier = "standard", archetypes: list[str] | None = None,
    *, contract: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """The projections that make a generated contract into a graph.

    **A contract alone is half a template.** The schema says what to extract;
    the projections say which array is time-bound, which field is the place,
    what the magnitude is, and what each row is *about*. Leaving those to be
    hand-wired would leave the hard part undone — the bindings are where the
    difficulty actually lives, and a template that skips them delivers a good
    schema and a blank graph.

    **This now READS the contract rather than restating it.** It used to build
    the same binding dicts a second time, from a second set of tier flags, and
    ``panel_config._SECTION_BINDINGS`` built them a third — and those copies had
    already drifted: the events projection bound its justification to the
    evidence rail here and not there, so a derived panel dropped every event's
    grounds. A section declares what it is (``x-graph``), the contract carries
    the declaration, and both this function and ``derive_projections`` read it.
    ``test_v2_end_to_end`` asserts the two agree.

    Order is restored from the contract, not inherited from the map:
    ``schema_map_for`` caches on a ``sort_keys`` dump and rebuilds from it, so
    every map is in ALPHABETICAL section order. Projection order turns out to
    matter — reordering them changed which projection first claimed a shared
    name and made two hierarchy edges vanish — so it is pinned here rather than
    left to a caching detail. (That fragility is worth removing on its own
    terms; it is not this function's to fix.)

    Emitted as plain dicts so the wire, the editor and the companion all read
    the same thing without importing the engine's models.
    """
    from app.api.modules.annotation.schema_map import schema_map_for

    contract = contract if contract is not None else build_contract(tier, archetypes)
    smap = schema_map_for(contract)
    authored = list(
        ((contract.get("properties") or {}).get("document") or {}).get("properties") or {}
    )
    rank = {f"document.{name}[*]": i for i, name in enumerate(authored)}
    return [
        {"path": path, **decl}
        for path, decl in sorted(
            smap.section_decls.items(), key=lambda kv: rank.get(kv[0], len(rank))
        )
    ]




def build_news_contract() -> dict[str, Any]:
    """The news lens — twelve linked sections, every one of them a graph layer.

    .. code-block:: text

        ROSTERS    actors · places · interests · instruments · topics
                   the vocabulary; every name used anywhere appears here first

        REFERENT   events[*]        named happenings, `within` / `follows`

        CLAIMS     observations[*]  what happened, AT a place
                   movements[*]     what moved, FROM a place TO a place
                   stances[*]       who is for or against what, how hard
                   attributes[*]    what holds of one thing, over an interval
                   relations[*]     what holds between two

        GROUNDS    exhibits[*]      the reports, datasets and leaks it cites

        DOC RUNG   at · dated · ref · outlet · covers · source_kind · frame
                   · salience · uncertainty · headline_claim

    **Two claim sections, because a projection carries one place binding.** An
    act is *at* a place; a journey is at neither end of itself and needs a
    trajectory (``start``/``end``), which pins both and draws an arc. Folding
    them would force one of the two to lie about where it is.

    **The doc rung draws on the rosters.** ``at`` refs ``places``, ``outlet``
    refs ``actors`` and ``covers`` refs ``topics`` — so "who published it" and
    "what it is about" are the same populations everything else resolves into,
    and a publisher is a node in the graph rather than a string beside it. That
    is what makes "compare how two outlets covered one event" a query instead of
    a research project.
    """
    actor_alts = ["Organization", "State", "Party", "Institution", "Movement",
                  "Company", "Court", "Media"]
    instrument_alts = ["Document", "Treaty", "Policy", "Sanction", "Fund",
                       "Vessel", "Aircraft", "Weapon", "Facility"]
    #: Every roster a subject or endpoint may be drawn from.
    all_rosters = ["actors", "instruments", "places", "interests", "topics"]
    endpoint_types = actor_alts + instrument_alts + ["Location", "Interest", "Topic"]

    props: dict[str, Any] = {}

    # ── Rosters ──────────────────────────────────────────────────────────────
    props["actors"] = roster(
        "Person", alternates=actor_alts, graph=_decl("actors"),
        description=("Everyone and every organisation named anywhere in this "
                     "document — including the outlet that published it and any "
                     "source it quotes. Other fields refer to these by name."))
    props["places"] = roster(
        "Location", graph=_decl("places"),
        description="Every place named anywhere in this document.")
    props["interests"] = roster(
        "Interest", graph=_decl("interests"),
        description=("Goals and motives an act can further or work against. Name "
                     "the goal, not the actor pursuing it: \"regulatory "
                     "approval\", not \"the ministry's interest\". Two documents "
                     "describing one goal should produce the same words, which is "
                     "what lets them be compared at all.\n\nOnly list one when the "
                     "document supports attributing it — an unsupported motive is "
                     "worse than none."))
    props["instruments"] = roster(
        "Document", alternates=instrument_alts, graph=_decl("instruments"),
        description=("Nameable things that are USED rather than acting — treaties, "
                     "sanctions packages, funds, bills, vessels, weapons systems, "
                     "facilities. What recurs here is often the mechanism."))
    props["topics"] = roster(
        "Topic", graph={"role": "body", "label": "Issue areas"},
        description=("The policy areas this document is about. Use the listed "
                     "vocabulary where one fits; add your own word only when none "
                     "does. A topic is the AREA, never the goal — `trade` is a "
                     "topic, `protecting domestic steel` is an interest."))
    # The starting vocabulary rides the roster's own type enum.
    props["topics"]["items"]["x-entityEnum"] = list(NEWS_TOPICS)

    # ── Referent ─────────────────────────────────────────────────────────────
    props["events"] = rows(
        description=(
            "Named happenings this document refers to — a war, an election, a "
            "case, a summit, a programme. Many rows can belong to one event, and "
            "that is how scattered facts are shown to be one story.\n\n"
            "ONLY happenings the document gives a NAME. The test: could you search "
            "for it and find the same thing? \"the 2026 German election\", \"COP31\", "
            "\"the Sahel security package\" are names. A generic description — \"a "
            "meeting\", \"the investigation\" — is NOT a name, however reasonable "
            "it reads. If the document names none, leave this empty; that is the "
            "correct answer and it is common."),
        properties={
            "name": {"type": "string", "description": "The name the document uses, exactly."},
            "category": enum_field(NEWS_EVENT_CATEGORIES, "What sort of happening it is."),
            "status": enum_field(NEWS_EVENT_STATUS, "Where it stands as of this document."),
            "when": date_field("When it began, as a calendar date."),
            "until": date_field("When it ended. Empty if ongoing."),
            "at": entity("Location", ref="places", description="Where it takes place."),
            "within": entity("Event", ref="events", description=(
                "The larger named happening this one is part of — a summit inside a "
                "crisis, a hearing inside a case. Only when the document says so.")),
            "follows": entity("Event", ref="events", description=(
                "The happening this one came after, when the document presents them "
                "in sequence. Sequence only — never say one caused another.")),
            "scale": score_field(
                "How big this happening is, 1–10. 1 = a local, single-day item. "
                "10 = a systemic event a whole region is organised around."),
        },
        justify=True,
        graph={
            "about": "self", "role": "step", "frame": "event",
            "label": "Named events",
            "node_type": "Event", "node_name": "name", "node_label": "name",
            "time": {"start": "when", "end": "until"},
            "place": {"at": "at.name"},
            "weight": "scale",
            "properties": [{"field": "category"}, {"field": "status"},
                           {"field": "scale"}],
            "evidence": {"path": "justification"},
        },
    )

    # ── Claims: acts ─────────────────────────────────────────────────────────
    props["observations"] = rows(
        description=(
            "What happened, as THIS document reports it. One row per act — if "
            "something happened twice, emit two rows, even when the participants "
            "and the wording are identical.\n\n"
            "`by` is the one acting. `to` is who or what it was done to. `via` is "
            "who or what it ran through — a mediator, a body, an instrument. Fill "
            "`via` whenever the document names one; it is often the most important "
            "field in the row.\n\n"
            "Anything that MOVED between two places belongs in `movements`, not "
            "here."),
        properties={
            "kind": enum_field(NEWS_ACT_KINDS, "What sort of act this is. Becomes "
                               "the node's type, so pick the narrowest word that fits."),
            "label": {"type": "string", "description": (
                "A short human phrase naming THIS act — \"Merz–von der Leyen "
                "defence talks\", \"400m euro Sahel allocation\". What a reader "
                "sees on the node. Never restate `kind`.")},
            "by": entity_list("Person", alternates=actor_alts, ref="actors",
                              description="Who acted. Several only when they acted jointly."),
            "with": entity_list("Person", alternates=actor_alts, ref="actors",
                                description=("Everyone else present or party to it, when "
                                             "no one party convened it. Two names on one "
                                             "occasion is often the finding.")),
            "to": entity_list("Person", alternates=actor_alts,
                              ref=["actors", "instruments", "places"],
                              description="Who or what it was done to."),
            "via": entity_list("Person", alternates=actor_alts,
                               ref=["actors", "instruments"],
                               description=("Who or what it ran through — a mediator, a "
                                            "forum, a treaty, a fund, a court.")),
            "concerns": entity_list("Person", alternates=endpoint_types,
                                    ref=all_rosters,
                                    description=("Who or what it is ABOUT, when that is "
                                                 "not who it was done to. For a statement, "
                                                 "`by` is the speaker and `concerns` is "
                                                 "the subject; they are rarely the same.")),
            "at": entity("Location", ref="places", description="Where it took place."),
            "when": date_field("The date of THIS act. Leave empty rather than "
                               "copying the document's own date."),
            "until": date_field("When it ended, for an act that spans days."),
            "modality": enum_field(MODALITIES, (
                "On what footing the document puts this act. `done` = reported as "
                "fact. `reported` = attributed to someone else. `alleged` = an "
                "untested accusation. `denied` = a named party rejects it. "
                "`planned` = announced, not yet happened. Required — an act you "
                "cannot place on this scale does not belong here.")),
            "topic": entity_list("Topic", ref="topics",
                                 description="The policy area(s) this act belongs to."),
            "serves": entity_list("Interest", ref="interests",
                                  description="The goal(s) this act advances."),
            "opposes": entity_list("Interest", ref="interests",
                                   description=("The goal(s) it works against. Filling this "
                                                "is what lets a profile tell an adversary "
                                                "from a stranger.")),
            "during": entity("Event", ref="events",
                             description="The named happening this act belongs to."),
            "cites": entity_list("Evidence", ref="exhibits",
                                 description=("The named grounds this act rests on — by the "
                                              "exact label used in `exhibits`.")),
            "magnitude": {"type": "number", "description": (
                "The figure the document states, unconverted. Always with `unit`.")},
            "unit": {"type": "string", "description": (
                "What `magnitude` counts — EUR, USD, troops, tonnes, seats, "
                "percent. Never leave this empty when `magnitude` is filled: a "
                "number without its unit cannot be summed with anything.")},
            "intensity": score_field(
                "How forceful the act is for its kind, 1–10. 1 = a routine, "
                "pro-forma instance. 10 = the strongest form that kind takes "
                "(a total embargo, a full mobilisation, an outright veto)."),
            "consequence": score_field(
                "How far its effects reach, 1–10. 1 = one organisation, "
                "reversible. 10 = state-level and durable."),
            "certainty": score_field(
                "How firmly the DOCUMENT states it, 1–10. 1 = a single unnamed "
                "source hedged with 'reportedly'. 10 = an on-record primary "
                "document. Score the sourcing, not your own belief."),
        },
        justify=True,
        graph={
            "about": "self", "role": "companion",
            "label": "Acts",
            "node_type": "Act", "node_type_path": "kind", "node_name": "label",
            "node_label": "{label}",
            "time": {"start": "when", "end": "until"},
            "place": {"at": "at.name"},
            "weight": "consequence",
            "properties": [{"field": "kind"}, {"field": "modality"},
                           {"field": "intensity"}, {"field": "consequence"},
                           {"field": "certainty"}, {"field": "unit"}],
            "evidence": {"path": "justification"},
        },
    )

    # ── Claims: movement ─────────────────────────────────────────────────────
    props["movements"] = rows(
        description=(
            "What moved, and between which two places. A journey, a deployment, a "
            "shipment, a displacement. Its own section because a movement is at "
            "NEITHER end of itself: it draws as an arc between them.\n\n"
            "Everything that happened in one place belongs in `observations`."),
        properties={
            "kind": enum_field(NEWS_MOVEMENT_KINDS, "What sort of movement."),
            "label": {"type": "string", "description": "A short human phrase naming this movement."},
            "by": entity_list("Person", alternates=actor_alts, ref="actors",
                              description="Who moved, or who sent it."),
            "with": entity_list("Person", alternates=actor_alts, ref="actors",
                                description="Everyone else travelling or accompanying."),
            "what": entity_list("Document", alternates=instrument_alts, ref="instruments",
                                description="What was carried or deployed, if a thing."),
            "origin": entity("Location", ref="places", description="Where it started."),
            "destination": entity("Location", ref="places", description="Where it arrived."),
            "via": entity_list("Person", alternates=actor_alts,
                               ref=["actors", "instruments", "places"],
                               description="What it passed through — a corridor, a port, a carrier."),
            "when": date_field("When it departed or occurred."),
            "until": date_field("When it arrived."),
            "modality": enum_field(MODALITIES, "On what footing the document puts it."),
            "topic": entity_list("Topic", ref="topics", description="The policy area."),
            "during": entity("Event", ref="events", description="The named happening it belongs to."),
            "magnitude": {"type": "number", "description": "How much or how many moved."},
            "unit": {"type": "string", "description": "What `magnitude` counts. Never empty when it is filled."},
            "intensity": score_field(
                "How large this movement is for its kind, 1–10. 1 = a single "
                "person or a token consignment. 10 = a mass movement."),
        },
        justify=True,
        graph={
            "about": "self", "role": "companion",
            "label": "Movements",
            "node_type": "Movement", "node_type_path": "kind", "node_name": "label",
            "node_label": "{label}",
            "time": {"start": "when", "end": "until"},
            # A trajectory: pinned at BOTH ends, drawn as an arc. The reason this
            # is a separate section at all.
            "place": {"start": "origin.name", "end": "destination.name"},
            "weight": "intensity",
            "properties": [{"field": "kind"}, {"field": "modality"},
                           {"field": "intensity"}, {"field": "unit"}],
            "evidence": {"path": "justification"},
        },
    )

    # ── Claims: position ─────────────────────────────────────────────────────
    props["stances"] = rows(
        description=(
            "Who is FOR or AGAINST what, and how hard. One row per holder per "
            "position per period.\n\n"
            "A stance is what a party says or is reported to hold — not what it "
            "did. The act goes in `observations`; the position goes here. Reading "
            "the two against each other — a stated position beside acts that "
            "serve the opposite goal — is the point of keeping them apart."),
        properties={
            "holder": entity("Person", alternates=actor_alts, ref="actors",
                             description="Who holds the position."),
            "position": enum_field(STANCE_POSITIONS, (
                "Which way. `declined_to_say` is a real answer and is not "
                "`neutral`: refusing to state a position is a position.")),
            "toward": entity("Interest", alternates=["Topic", "Interest"],
                             ref=["interests", "topics", "instruments", "actors"],
                             description=("What the position is about — a goal, a policy "
                                          "area, a treaty, or another party.")),
            "intensity": score_field(
                "How strongly, 1–10. 1 = a passing, qualified remark. 10 = a "
                "declared red line the holder has staked itself on."),
            "publicity": score_field(
                "How openly, 1–10. 1 = reported privately or through an unnamed "
                "official. 10 = stated on the record, in public, by name."),
            "from_date": date_field("When the position was taken or first reported."),
            "until": date_field("When it changed or was abandoned."),
            "during": entity("Event", ref="events", description="The named happening it belongs to."),
        },
        justify=True,
        graph={
            "about": "between", "role": "edge",
            "label": "Stances",
            "predicate": "position",
            "time": {"start": "from_date", "end": "until"},
            "weight": "intensity",
            "properties": [{"field": "position"}, {"field": "intensity"},
                           {"field": "publicity"}],
            "evidence": {"path": "justification"},
        },
    )

    # ── Claims: what holds ───────────────────────────────────────────────────
    props["attributes"] = rows(
        description=(
            "A property OF one thing, over a period — an office held, a mandate, "
            "an alignment, a status, an indicator. One row per property per "
            "period; if it changed, that is two rows with two date ranges, never "
            "one row averaged.\n\n"
            "A CHANGE is an observation; the resulting STATE is an attribute. "
            "\"Took office in March\" is an act; \"holds the office from March\" "
            "is an attribute."),
        properties={
            "subject": entity("Person", alternates=endpoint_types, ref=all_rosters,
                              description=("What the property is about. An actor, but also "
                                           "a place, an instrument, an interest or a topic.")),
            "kind": enum_field(NEWS_ATTRIBUTE_KINDS, "What kind of property this row states."),
            "value": {"type": "string", "description": (
                "The property's value in words — the office's title, the status, "
                "the alignment. For a number use `magnitude` and `unit`.")},
            "magnitude": {"type": "number", "description": "The figure, unconverted."},
            "unit": {"type": "string", "description": "What `magnitude` counts. Never empty when it is filled."},
            "place": entity("Location", ref="places",
                            description="Where it holds, when the property is locational."),
            "from": date_field("When it began."),
            "until": date_field("When it ended. Empty means current."),
            "confidence": score_field(
                "How firmly the document establishes it, 1–10. 1 = an aside. "
                "10 = stated as a matter of record."),
        },
        justify=True,
        graph={
            "about": "subject", "role": "companion",
            "label": "Properties",
            "place": {"at": "place.name", "kind": "kind"},
            "time": {"start": "from", "end": "until"},
            "weight": "magnitude",
            "properties": [{"field": "kind"}, {"field": "value"},
                           {"field": "unit"}, {"field": "confidence"}],
            "evidence": {"path": "justification"},
        },
    )

    props["relations"] = rows(
        description=(
            "Standing links between two parties — facts that hold over time "
            "rather than things that happened. Membership, alliance, ownership, "
            "representation, command.\n\n"
            "This is also where HIERARCHY goes, and it is worth filling: a place "
            "inside a larger place (`part_of`), a happening inside a larger one "
            "(`part_of`), an interest that is a component of a broader one "
            "(`subsumes`, pointing from the broader to the narrower) or that "
            "advances one without being part of it (`furthers`). Only when the "
            "document says so — an invented hierarchy reads as authoritative and "
            "is not."),
        properties={
            "from": entity("Person", alternates=endpoint_types, ref=all_rosters),
            "predicate": enum_field(RELATION_PREDICATES, "How they are linked."),
            "to": entity("Person", alternates=endpoint_types, ref=all_rosters),
            "from_date": date_field("When the link began."),
            "until": date_field("When it ended."),
            "strength": score_field(
                "How binding, 1–10. 1 = a loose association. 10 = a formal, "
                "enforceable tie such as membership or ownership."),
        },
        justify=True,
        graph={
            "about": "between", "role": "edge",
            "label": "Standing links",
            "predicate": "predicate",
            "time": {"start": "from_date", "end": "until"},
            "weight": "strength",
            "properties": [{"field": "predicate"}, {"field": "strength"}],
            "evidence": {"path": "justification"},
        },
    )

    # ── Grounds ──────────────────────────────────────────────────────────────
    props["exhibits"] = rows(
        description=(
            "Grounds the document NAMES — a report, a dataset, a poll, a leaked "
            "cable, a filing, a recording — so that many rows can point at the "
            "same one. Grounds it does not name belong in a row's own "
            "justification.\n\n"
            "Rows that rely on one name the same label in their `cites` field; "
            "that is the link, and it is what makes \"what does this claim rest "
            "on\" a query."),
        properties={
            "name": {"type": "string", "description": (
                "The label the document gives it, exactly — \"the Commission's "
                "2026 enlargement report\", \"the leaked cable\".")},
            "kind": enum_field(NEWS_EXHIBIT_KINDS, "What sort of thing it is."),
            "stance": enum_field(EVIDENCE_STANCES, "How it bears on the matter it is offered for."),
            "by": entity_list("Person", alternates=actor_alts, ref="actors",
                              description="Who produced it."),
            "dated": date_field("When it was produced or published."),
            "locator": {"type": "string", "description": "Page, section, paragraph, table."},
            "quote": {"type": "string", "description": "The document's own words about it."},
            "credibility": score_field(
                "How much weight the DOCUMENT gives it, 1–10. 1 = mentioned and "
                "immediately disputed. 10 = treated as settled record. Score the "
                "document's treatment, not your own assessment."),
        },
        graph={
            "about": "self", "role": "attachment",
            "label": "Grounds",
            "node_kind": "entity", "node_type": "Evidence",
            "node_name": "name", "node_label": "name",
            "time": {"at": "dated"},
            "weight": "credibility",
            "properties": [{"field": "kind"}, {"field": "stance"},
                           {"field": "locator"}, {"field": "credibility"}],
        },
    )

    # ── The document rung ────────────────────────────────────────────────────
    #
    # A document is a row about itself: who published it, where, when, what it
    # is, how it framed it. `at`, `outlet` and `topics` all resolve INTO the
    # rosters, so the publisher is a node and "compare two outlets on one event"
    # is a query rather than a research project.
    props["at"] = entity("Location", ref="places",
                         description="The place this document is mainly about.")
    props["dated"] = date_field(
        "The date this document gives itself — published, filed, released. Not "
        "the date of the events it describes.")
    props["ref"] = {"type": "string", "description": (
        "The identifier this document gives itself — a press-release number, a "
        "docket, a report reference. Copy it exactly. Empty if it has none.")}
    props["outlet"] = entity("Organization", alternates=actor_alts, ref="actors",
                             description=(
                                 "Who published it — the outlet, agency, ministry or "
                                 "institution. Named in the dateline or the masthead. "
                                 "Never leave this empty: without it the corpus cannot "
                                 "tell you who said what."))
    props["source_kind"] = enum_field(SOURCE_KINDS, (
        "What this document IS. A press release and a wire report about one "
        "meeting are two registers, and the difference between them is often the "
        "finding."))
    props["frame"] = enum_field(FRAMES_OF_COVERAGE, (
        "The dominant frame this document uses. `conflict` = presented as a "
        "contest between parties. `economic` = in terms of cost and benefit. "
        "`responsibility` = about who is to blame or must act. `process` = about "
        "procedure and who decides. Pick the one the text actually leads with."))
    # `covers`, not `topics` — the roster already owns that name at this level,
    # and a doc-rung field that shadowed it made the roster `x-ref` point at
    # itself (a cycle `schema_map` refuses, correctly). The document rung refers
    # to the rosters; it never IS one.
    props["covers"] = entity_list("Topic", ref="topics",
                                  description="The policy areas this document is about.")
    props["salience"] = score_field(
        "How prominently this document treats its main subject, 1–10. 1 = a "
        "passing mention in a round-up. 10 = the whole document is about it.")
    props["uncertainty"] = score_field(
        "How hedged the document is overall, 1–10. 1 = flatly stated throughout. "
        "10 = almost everything attributed, conditional or unconfirmed.")
    props["headline_claim"] = {"type": "string", "description": (
        "In one sentence, the single thing this document asserts. The claim, not "
        "the topic — \"the Commission will fund Sahel aid through the WFP\", not "
        "\"EU aid policy\".")}

    return {
        "type": "object",
        "description": BASE_GUIDANCE + "\n\n" + NEWS_GUIDANCE,
        "properties": {"document": {"type": "object", "properties": props}},
    }


def news_doc_anchors() -> dict[str, str | None]:
    """The document rung for :func:`build_news_contract`."""
    return {"doc_place": "document.at.name", "doc_time": "document.dated"}


def news_projections() -> list[dict[str, Any]]:
    """Projections for the news lens, read off its own contract.

    Same rule as :func:`build_projections`: the contract carries the
    declaration and this reads it back, so the two cannot drift.
    """
    return build_projections(contract=build_news_contract())


# ─── Catalogue ───────────────────────────────────────────────────────────────


class SchemaTemplate(BaseModel):
    """One pickable starting point — and the thing that BUILDS it.

    ``tier`` + ``archetypes`` describe most templates, and every consumer used
    to re-derive the contract from those two fields by calling
    ``build_contract(t.tier, t.archetypes)`` itself. That made the catalogue a
    config format a caller interprets, and it silently fixed what a template
    could be: anything not expressible as tier × archetypes could not be
    offered at all.

    So a template answers for itself. ``bespoke`` names a module-level builder
    for one that is not a tier combination; the three methods below are what
    callers use, and they never need to know which kind they have.
    """

    id: str
    label: str
    tier: Tier
    hint: str
    archetypes: list[str] = Field(default_factory=list)
    bespoke: str | None = None
    """Name of a ``build_*_contract`` function in this module. When set, tier and
    archetypes are descriptive only — they say roughly where the template sits,
    not how it is assembled."""

    def contract(self) -> dict[str, Any]:
        if self.bespoke:
            return globals()[self.bespoke]()
        return build_contract(self.tier, self.archetypes)

    def projections(self) -> list[dict[str, Any]]:
        return build_projections(contract=self.contract())

    def doc_anchors(self) -> dict[str, str | None]:
        if self.bespoke:
            # A bespoke contract carries its own rung; read it rather than
            # assume the tier's.
            props = ((self.contract().get("properties") or {})
                     .get("document", {}).get("properties") or {})
            return {
                "doc_place": "document.at.name" if "at" in props else None,
                "doc_time": "document.dated" if "dated" in props else None,
            }
        return build_doc_anchors(self.tier)


TIERS: dict[Tier, str] = {
    "minimal": "Actors and one kind of act. Already a working graph.",
    "standard": "Adds places, interests, standing relations, and a quote per row.",
    "full": "Adds instruments, named events, entity properties and evidence.",
}


def list_templates() -> list[SchemaTemplate]:
    """The catalogue the editor and the companion both offer.

    Deliberately short. A long list of near-identical starting points is worse
    than a few that clearly differ — the archetypes compose, so a user who
    needs meetings *and* payments picks both rather than hunting for a
    "meetings and payments" template.
    """
    return [
        SchemaTemplate(id="minimal", label="Minimal graph", tier="minimal",
                       hint=TIERS["minimal"], archetypes=["encounters"]),
        SchemaTemplate(id="encounters", label="Meetings and contacts", tier="standard",
                       hint="Who met whom, when and where.",
                       archetypes=["encounters", "memberships"]),
        SchemaTemplate(id="travel", label="Travel and co-presence", tier="standard",
                       hint="Manifests and journeys — who was together in transit.",
                       archetypes=["movements", "encounters"]),
        # The news-shaped starting point, and the only one whose subject is the
        # WHY. Two of the six investigation shapes — actors converging on a goal
        # without contact, and one pair warm in trade while hostile in politics
        # — live entirely on `serves`/`opposes`, and both are read off news at
        # volume. Every other standard template asks what happened; this one
        # asks what it was for.
        SchemaTemplate(id="positions", label="Positions and interests", tier="standard",
                       hint="Who is pursuing what, who is working against it, "
                            "and how their stated position compares with their acts.",
                       archetypes=["statements", "memberships"]),
        SchemaTemplate(id="ownership", label="Ownership and control", tier="full",
                       hint="Stakes, seats and control chains over time.",
                       archetypes=["holdings", "seats", "memberships", "citations"]),
        SchemaTemplate(id="money", label="Transfers", tier="full",
                       hint="Payments and the intermediaries that route them.",
                       archetypes=["transfers", "seats", "citations"]),
        # Court records. Statements and exhibits are the shape, but a docket is
        # also a cast with standing roles — who is plaintiff, who represents
        # whom, over which stretch of the case.
        SchemaTemplate(id="testimony", label="Testimony and evidence", tier="full",
                       hint="Statements with two clocks, the exhibits behind them, "
                            "and who was acting for whom.",
                       archetypes=["statements", "citations", "seats", "memberships"]),
        SchemaTemplate(id="indicators", label="Indicators over time", tier="full",
                       hint="Budgets, counts and measures per subject per period.",
                       archetypes=["measurements", "citations"]),
        # Not a tier combination: news needs framing, issue area and intensity,
        # and the general model has no slot for any of the three.
        SchemaTemplate(id="news", label="News and public affairs", tier="full",
                       hint="Twelve linked sections for reading coverage: who "
                            "published it and under what frame, what happened and "
                            "how hard, what moved and between where, who is for or "
                            "against what, and the grounds it rests on.",
                       bespoke="build_news_contract"),
    ]
