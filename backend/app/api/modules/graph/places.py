"""Where a name is — through the canon first, the raw spelling last.

A place in an annotation is a *name*. Turning it into a point used to be one
string match: ``lower(canonical) = lower(name)`` across every canon in the
infospace, then the enricher's facet cache. That had three blind spots, and all
three are things the canon already knows:

- **Spellings.** "Valletta", "Valetta" and "La Valette" are one entry with two
  aliases. Matching ``canonical`` only made them three places, two of them
  unlocated.
- **Scope.** A run is attached to a canon. Its curated vocabulary is the
  authority for what its names mean; a same-named entry in an unrelated canon
  is at best a coordinate, never an identity.
- **Known but not located.** An entry in the infospace's geo canon *is* a place
  by declaration, coordinates or not. Without that, a fresh run whose places
  were never geocoded looked like it had no places at all.

So a name resolves down a ladder, strongest first::

    1. the run's canons, in order   canonical OR alias  → identity (+ coords)
    2. the geo canon                canonical OR alias  → identity (+ coords)
    3. any canon in the infospace   only entries WITH coords → coords, no identity
    4. the facet cache              the geocoding enricher's per-asset location
    5. raw                          the name itself, no identity, no point

Curated mentions need no separate join: ``resolve_entities_batch`` appends every
raw name it resolves to the entry's ``aliases``, so a curated mention matches
its entry by alias.

Everything here is batched — one query per rung for any number of names — and
side-effect free. Writing coordinates is the geocode action's job.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from sqlalchemy import text
from sqlmodel import Session

from app.core.db import tolerated

logger = logging.getLogger(__name__)

__all__ = ["Place", "coord_pair", "name_key", "resolve_places", "spellings_of"]


def name_key(name: Any) -> str:
    """The one normalisation every rung matches on."""
    return str(name or "").strip().lower()


def coord_pair(raw: Any) -> tuple[float, float] | None:
    """``(lat, lon)`` from either coords shape, or None.

    The geocode action persists the provider's GeoJSON-order ``[lon, lat]``
    list (``annotation/tasks/geocode.py``), which is also how
    ``content/enrichers.py`` reads it. A dict form is accepted too so a
    hand-curated entry can be explicit rather than positional.
    """
    if isinstance(raw, dict):
        lat, lon = raw.get("lat"), raw.get("lon")
    elif isinstance(raw, (list, tuple)) and len(raw) >= 2:
        lon, lat = raw[0], raw[1]          # GeoJSON order
    else:
        return None
    try:
        return float(lat), float(lon)
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True, slots=True)
class Place:
    """What one name resolved to."""

    key: str
    """``name_key`` of the name asked about."""
    identity: str
    """``entry:<id>`` when a canon claimed the name, else ``name:<key>``. The
    unit a place is counted as — two spellings of one entry share it."""
    display: str
    """The canonical name when there is an identity, else the name as asked."""
    entry_id: int | None = None
    lat: float | None = None
    lon: float | None = None
    coords_from: str | None = None
    """``canon`` (curated, on an entry) or ``facet`` (the enricher's cache)."""
    in_geo_canon: bool = False
    """Declared a place by living in the geo canon — located or not."""

    @property
    def located(self) -> bool:
        return self.lat is not None and self.lon is not None


#: Every spelling an entry answers to, matched against the keys asked about.
#: ``coords`` is the generated column (migration ``c1_place_lookup``), never
#: ``properties->'coords'``: ``properties`` also holds the boundary polygon, and
#: reading any part of it decompresses all of it.
_ENTRY_KEYS_SQL = """
    SELECT e.id, e.canon_id, e.canonical, e.coords, k.key, k.is_alias
    FROM canon_entry e
    CROSS JOIN LATERAL (
        SELECT LOWER(TRIM(e.canonical)) AS key, FALSE AS is_alias
        UNION ALL
        SELECT LOWER(TRIM(x)), TRUE
        FROM json_array_elements_text(
            CASE WHEN json_typeof(e.aliases) = 'array' THEN e.aliases ELSE '[]'::json END
        ) AS x
    ) AS k
    WHERE e.infospace_id = :iid AND k.key = ANY(:keys) {scope}
"""


def resolve_places(
    session: Session,
    infospace_id: int,
    names: Iterable[str],
    *,
    canon_ids: Sequence[int] = (),
    geo_canon_id: int | None = None,
) -> dict[str, Place]:
    """Resolve every name down the ladder. Keyed by :func:`name_key`.

    Every non-empty name gets an entry back, so callers never branch on
    "was it asked about" — only on ``identity`` and ``located``. A failing rung
    logs and degrades to the next; a map must still render when the canon
    tables are unreachable.
    """
    display: dict[str, str] = {}
    for n in names:
        k = name_key(n)
        if k and k not in display:
            display[k] = str(n).strip()
    if not display:
        return {}
    keys = list(display)

    chain = list(dict.fromkeys(c for c in (*canon_ids, geo_canon_id) if c))
    claimed: dict[str, tuple[tuple, dict[str, Any]]] = {}

    # Rungs 1–2: identity, from the run's canons then the geo canon. Ranked by
    # chain position, then canonical-before-alias, then located-before-not —
    # two entries claiming one spelling in the same canon is a curation gap,
    # and the one that can be drawn is the more useful answer.
    if chain:
        with tolerated(session, "places: canon identity lookup"):
            rows = session.execute(
                text(_ENTRY_KEYS_SQL.format(scope="AND e.canon_id = ANY(:chain)")),
                {"iid": infospace_id, "keys": keys, "chain": chain},
            ).fetchall()
            for entry_id, canon_id, canonical, coords, key, is_alias in rows:
                rank = (chain.index(canon_id), bool(is_alias),
                        coord_pair(coords) is None, entry_id)
                if key not in claimed or rank < claimed[key][0]:
                    claimed[key] = (rank, {
                        "entry_id": entry_id, "canonical": canonical,
                        "coords": coord_pair(coords),
                        "in_geo": canon_id == geo_canon_id,
                    })

    coords: dict[str, tuple[tuple[float, float], str]] = {
        k: (c["coords"], "canon") for k, (_, c) in claimed.items() if c["coords"]
    }

    # An identity carries more names than the one asked about. Rungs 3–4 look
    # under all of them, so an entry known as "Valletta" finds the enricher's
    # cache under "La Valette".
    lookups: dict[str, set[str]] = {k: {k} for k in keys if k not in coords}
    for k, (_, c) in claimed.items():
        if k in lookups:
            lookups[k].add(name_key(c["canonical"]))
    wanted = sorted({n for names_ in lookups.values() for n in names_})

    # Rung 3: a coordinate is infospace-wide truth even where an identity is
    # not, so any located entry may lend its point.
    found: dict[str, tuple[tuple[float, float], str]] = {}
    if wanted:
        with tolerated(session, "places: located-entry lookup"):
            rows = session.execute(
                text(_ENTRY_KEYS_SQL.format(scope="AND e.coords IS NOT NULL")),
                {"iid": infospace_id, "keys": wanted},
            ).fetchall()
            for _id, _canon, _canonical, raw, key, _alias in rows:
                pair = coord_pair(raw)
                if pair and key not in found:
                    found[key] = (pair, "canon")

        # Rung 4: the enricher's cache — canon-free, and the weakest claim.
        missing = [n for n in wanted if n not in found]
        if missing:
            with tolerated(session, "places: facet cache lookup"):
                rows = session.execute(text("""
                    SELECT DISTINCT ON (LOWER(TRIM(a.metadata->>'location')))
                           LOWER(TRIM(a.metadata->>'location')) AS key,
                           a.metadata->>'location_lat' AS lat,
                           a.metadata->>'location_lon' AS lon
                    FROM asset a
                    WHERE a.infospace_id = :iid
                      AND a.metadata->>'location_lat' IS NOT NULL
                      AND LOWER(TRIM(a.metadata->>'location')) = ANY(:keys)
                """), {"iid": infospace_id, "keys": missing}).fetchall()
                for key, lat, lon in rows:
                    pair = coord_pair({"lat": lat, "lon": lon})
                    if pair:
                        found[key] = (pair, "facet")

    for k, candidates in lookups.items():
        # The name as asked outranks its identity's other names.
        ordered = [k, *sorted(candidates - {k})]
        hit = next((found[n] for n in ordered if n in found), None)
        if hit:
            coords[k] = hit

    out: dict[str, Place] = {}
    for k in keys:
        c = claimed.get(k, (None, None))[1]
        pair, source = coords.get(k, (None, None))
        out[k] = Place(
            key=k,
            identity=f"entry:{c['entry_id']}" if c else f"name:{k}",
            display=c["canonical"] if c else display[k],
            entry_id=c["entry_id"] if c else None,
            lat=pair[0] if pair else None,
            lon=pair[1] if pair else None,
            coords_from=source,
            in_geo_canon=bool(c and c["in_geo"]),
        )
    return out


def spellings_of(
    session: Session,
    infospace_id: int,
    identity: str,
    *,
    canon_ids: Sequence[int] = (),
    geo_canon_id: int | None = None,
) -> list[str]:
    """Every name key that :func:`resolve_places` would turn into ``identity``
    under the same canon chain — the inverse, for reading rows back out.

    A count was made per identity; opening it must find exactly the rows that
    were counted, under every spelling that folded into it. ``name:<key>`` is
    its one key. ``entry:<id>`` answers to its canonical and aliases — but only
    those that still resolve to *it*: an alias an earlier canon in the chain
    also claims belongs to that canon's entry, and was counted there.
    """
    kind, _, rest = identity.partition(":")
    if kind == "name":
        return [rest] if rest else []
    if kind != "entry" or not rest.isdigit():
        return []
    row = session.execute(text("""
        SELECT e.canonical,
               CASE WHEN json_typeof(e.aliases) = 'array' THEN e.aliases ELSE '[]'::json END
        FROM canon_entry e WHERE e.id = :id AND e.infospace_id = :iid
    """), {"id": int(rest), "iid": infospace_id}).first()
    if row is None:
        return []
    canonical, aliases = row
    candidates = {name_key(canonical), *(name_key(a) for a in (aliases or []))} - {""}
    resolved = resolve_places(session, infospace_id, candidates,
                              canon_ids=canon_ids, geo_canon_id=geo_canon_id)
    return sorted(k for k, p in resolved.items() if p.identity == identity)
