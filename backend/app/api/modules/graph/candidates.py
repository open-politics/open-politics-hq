"""Which pairs of entities are worth asking about — the resolver's blocking step.

A run's graph names tens of thousands of entities; asking a model about every
pair is quadratic and almost entirely wasted. These rules find the pairs where
two labels could plausibly be one thing, from the *structure* of the names —
no vocabulary, no language, no list of known aliases:

    type       the same name under two types            "Al Jazeera" Organization / Publication
    spelling   the same name once accents, punctuation  "Al-Jazeera" / "Al Jazeera",
               and an article fold away, or one edit     "Zelenskyy" / "Zelensky"
               apart on a long name
    acronym    a short all-capitals name whose letters   "US" / "United States"
               are another's initials
    contains   one name's words all inside another's,    "Trump" / "Donald Trump"
               same type, through a word few names share

``contains`` stays within a type and needs a rare shared word: "Trump" and
"Trump administration" are different things, and a word half the names carry
("United", "National") would pair everything with everything. The model is
the judge; this only decides what it is shown. Pairs come back most-mentioned
first — the ones that change the network most.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

__all__ = ["Entity", "Candidate", "fold", "pair_key", "candidate_pairs"]

#: A shared word carried by more names than this does not make two names a pair.
RARE_TOKEN = 25
#: Blocks larger than this are skipped for the edit-distance pass — a crowd of
#: names that share a prefix and a length is not a spelling question.
MAX_BLOCK = 400
#: Initial-skipping words are found from the data: a token this short and this
#: common is a connective ("of", "the", "and", "de", "la"), whatever language.
CONNECTIVE_LEN = 3
CONNECTIVE_SHARE = 0.002


@dataclass(frozen=True, slots=True)
class Entity:
    name: str
    type: str
    frequency: int = 1


@dataclass(frozen=True, slots=True)
class Candidate:
    a: Entity
    b: Entity
    reason: str
    priority: float

    @property
    def key(self) -> str:
        return pair_key(self.a, self.b)


def fold(name: str) -> str:
    """A name as a comparison key: accents, case, punctuation, a leading
    article and repeated spaces gone. Display never uses it."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _ident(e: Entity) -> str:
    """A node's identity as the graph engine mints it (`stream._node_id`):
    name and type, trimmed and lowercased — *not* folded. "Al-Jazeera" and
    "Al Jazeera" are two nodes; folding is how they are found to be a pair."""
    return f"{e.name.strip().lower()}|{e.type.strip().lower()}"


def pair_key(a: Entity, b: Entity) -> str:
    """Order-independent: (a, b) and (b, a) are one question."""
    x, y = sorted((_ident(a), _ident(b)))
    return f"{x}||{y}"


def _one_edit(x: str, y: str) -> bool:
    """Levenshtein distance exactly one — substitution, insertion or deletion."""
    if x == y or abs(len(x) - len(y)) > 1:
        return False
    if len(x) > len(y):
        x, y = y, x
    i = j = 0
    edited = False
    while i < len(x) and j < len(y):
        if x[i] == y[j]:
            i += 1
            j += 1
            continue
        if edited:
            return False
        edited = True
        if len(x) == len(y):
            i += 1
        j += 1
    return True


def _acronym_letters(name: str) -> str | None:
    """"US", "U.S.", "IDF" → letters; anything else → None."""
    letters = re.sub(r"[.\s]", "", name)
    if 2 <= len(letters) <= 6 and letters.isalpha() and letters.isupper():
        return letters.lower()
    return None


def candidate_pairs(entities: Iterable[Entity], *, limit: int = 5000) -> list[Candidate]:
    ents = [e for e in entities if e.name.strip() and e.type.strip()]
    folded = [fold(e.name) for e in ents]
    tokens = [f.split() for f in folded]
    out: dict[str, Candidate] = {}

    def add(i: int, j: int, reason: str) -> None:
        a, b = ents[i], ents[j]
        if _ident(a) == _ident(b):
            return
        c = Candidate(a, b, reason, float(min(a.frequency, b.frequency)))
        key = c.key
        if key not in out:
            out[key] = c

    # ── same name: a type question, or a spelling one ──────────────────────
    by_fold: dict[str, list[int]] = defaultdict(list)
    for i, f in enumerate(folded):
        if f:
            by_fold[f].append(i)
    for members in by_fold.values():
        for x in range(len(members)):
            for y in range(x + 1, len(members)):
                i, j = members[x], members[y]
                same_type = ents[i].type.strip().lower() == ents[j].type.strip().lower()
                add(i, j, "spelling" if same_type else "type")

    # ── one edit apart, on names long enough for that to mean a typo ───────
    blocks: dict[tuple[str, int], list[int]] = defaultdict(list)
    for i, f in enumerate(folded):
        if len(f) >= 7:
            blocks[(f[:3], len(f))].append(i)
    for (prefix, length), members in list(blocks.items()):
        # Same length (a substitution), and one longer (an insertion).
        longer = blocks.get((prefix, length + 1), [])
        if len(members) + len(longer) > MAX_BLOCK:
            continue
        for x, i in enumerate(members):
            for j in [*members[x + 1:], *longer]:
                if _one_edit(folded[i], folded[j]):
                    add(i, j, "spelling")

    # ── acronyms ───────────────────────────────────────────────────────────
    token_count: dict[str, int] = defaultdict(int)
    for ts in tokens:
        for t in set(ts):
            token_count[t] += 1
    connective = {
        t for t, n in token_count.items()
        if len(t) <= CONNECTIVE_LEN and n >= max(5, CONNECTIVE_SHARE * len(ents))
    }
    by_initials: dict[str, list[int]] = defaultdict(list)
    for i, ts in enumerate(tokens):
        words = [t for t in ts if t not in connective]
        if len(words) >= 2:
            by_initials["".join(t[0] for t in words)].append(i)
    for i, e in enumerate(ents):
        letters = _acronym_letters(e.name)
        if letters:
            for j in by_initials.get(letters, []):
                add(i, j, "acronym")

    # ── containment, within a type, through a rare word ────────────────────
    by_token: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, ts in enumerate(tokens):
        for t in set(ts):
            if t not in connective and token_count[t] <= RARE_TOKEN:
                by_token[(ents[i].type.strip().lower(), t)].append(i)
    for members in by_token.values():
        for i in members:
            for j in members:
                if len(tokens[i]) < len(tokens[j]) and set(tokens[i]) <= set(tokens[j]):
                    add(i, j, "contains")

    return sorted(out.values(), key=lambda c: (-c.priority, c.key))[:limit]
