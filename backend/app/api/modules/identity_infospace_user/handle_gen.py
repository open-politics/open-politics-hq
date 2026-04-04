"""
Funky handle generator for user handles.

Generates memorable adjective-noun combos like "swift-falcon" or "cosmic-cipher".
~6400 combinations from embedded word lists, no external dependencies.
"""

import random
import re
import uuid
from typing import Optional

from sqlmodel import Session, select

# ─── Word lists ───
# Investigative / analytical / nature vibe — memorable and fun.

ADJECTIVES = [
    "swift", "bright", "bold", "keen", "sharp", "quiet", "lucid", "deep",
    "hidden", "iron", "silver", "amber", "scarlet", "polar", "steady",
    "deft", "vivid", "wiry", "feral", "sonic", "lunar", "solar", "astral",
    "cosmic", "arctic", "rustic", "mossy", "dusty", "hazy", "misty",
    "stormy", "golden", "copper", "cobalt", "onyx", "jade", "coral",
    "ivory", "ashen", "smoky", "frozen", "molten", "woven", "silent",
    "hollow", "veiled", "sunken", "daring", "roving", "nimble", "subtle",
    "cryptic", "serene", "frosty", "rugged", "gentle", "fierce", "lofty",
    "rapid", "placid", "candid", "brazen", "stray", "brisk", "stark",
    "blunt", "dense", "vast", "lean", "rare", "raw", "sage", "true",
    "able", "calm", "cool", "dark", "fair", "fast", "free", "grim",
    "warm", "wild",
]

NOUNS = [
    "falcon", "cipher", "atlas", "beacon", "raven", "prism", "flint",
    "oracle", "vector", "summit", "nexus", "pulse", "delta", "forge",
    "ember", "quill", "sentry", "helix", "warden", "scope", "lantern",
    "anvil", "comet", "dagger", "fennel", "glacier", "harbor", "iris",
    "jackal", "kestrel", "linden", "mortar", "nomad", "osprey", "plover",
    "quartz", "riddle", "sparrow", "thistle", "urchin", "vortex", "walrus",
    "zenith", "badger", "condor", "drifter", "ermine", "finch", "granite",
    "heron", "ibex", "junco", "kelp", "lynx", "marten", "newt",
    "otter", "pebble", "rook", "slate", "thorn", "vale", "wren",
    "cedar", "basalt", "crow", "dune", "elm", "fox", "gull",
    "hawk", "isle", "jay", "knot", "lark", "moth", "oak",
    "pike", "reef", "sage", "tide", "vine", "wolf",
]

# ─── Validation ───

HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$")
HANDLE_MIN = 3
HANDLE_MAX = 40


def validate_handle(handle: str) -> str:
    """Normalize and validate a handle. Returns lowercased handle or raises ValueError."""
    handle = handle.strip().lower()
    if len(handle) < HANDLE_MIN:
        raise ValueError(f"Handle must be at least {HANDLE_MIN} characters")
    if len(handle) > HANDLE_MAX:
        raise ValueError(f"Handle must be at most {HANDLE_MAX} characters")
    if not HANDLE_RE.match(handle):
        raise ValueError(
            "Handle must start and end with a letter or number, "
            "and contain only lowercase letters, numbers, hyphens, and underscores"
        )
    return handle


def _slugify(name: str) -> str:
    """Turn a display name into a handle candidate."""
    slug = name.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug[:HANDLE_MAX]


# ─── Generation ───

def generate_handle(session: Session, full_name: Optional[str] = None) -> str:
    """Generate a unique handle. Tries name-based first, falls back to word combo."""
    from app.models import User  # deferred to avoid circular import

    def _is_available(h: str) -> bool:
        return not session.exec(select(User.id).where(User.handle == h)).first()

    # Try name-based first
    if full_name:
        slug = _slugify(full_name)
        if len(slug) >= HANDLE_MIN:
            try:
                slug = validate_handle(slug)
                if _is_available(slug):
                    return slug
            except ValueError:
                pass
            # Try with random suffix
            for _ in range(5):
                candidate = f"{slug[:HANDLE_MAX - 3]}-{random.randint(10, 99)}"
                try:
                    candidate = validate_handle(candidate)
                    if _is_available(candidate):
                        return candidate
                except ValueError:
                    continue

    # Funky word combo
    for _ in range(20):
        handle = f"{random.choice(ADJECTIVES)}-{random.choice(NOUNS)}"
        if _is_available(handle):
            return handle
        handle = f"{handle}-{random.randint(10, 99)}"
        if _is_available(handle):
            return handle

    # Ultimate fallback
    return f"user-{uuid.uuid4().hex[:8]}"
