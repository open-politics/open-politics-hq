"""Unit tests for the identity/policy decision — ``content.asset_builder.decide``.

``decide`` is the ONE place the skip|supersede|update × content_hash matrix lives
(``persist`` and ``reconcile_children`` both call it). It's pure — no DB, no
session, no worker — so this fully covers the matrix that used to interleave across
three branches and produce the supersede / re-update storms. The integration-level
guarantee (re-poll an unchanged corpus → zero writes) is a separate task-level test.
"""

from types import SimpleNamespace

from app.api.modules.content.asset_builder import decide


def _match(content_hash):
    """A stand-in for an existing Asset — decide only reads ``.content_hash``."""
    return SimpleNamespace(content_hash=content_hash)


def test_no_match_always_creates():
    for policy in ("skip", "supersede", "update"):
        assert decide(None, "hash", policy) == "create"
        assert decide(None, None, policy) == "create"


def test_skip_policy_returns_existing_without_consulting_content():
    m = _match("hash-a")
    assert decide(m, "hash-a", "skip") == "skip"      # identical
    assert decide(m, "hash-b", "skip") == "skip"      # differs
    assert decide(m, None, "skip") == "skip"          # unknown


def test_identical_content_is_unchanged_regardless_of_policy():
    m = _match("same")
    assert decide(m, "same", "supersede") == "unchanged"
    assert decide(m, "same", "update") == "unchanged"


def test_differing_content_applies_the_policy():
    m = _match("old")
    assert decide(m, "new", "supersede") == "supersede"
    assert decide(m, "new", "update") == "update"


def test_unknown_hash_cannot_prove_identity_so_applies_policy():
    # If either side's hash is missing we can't assert "unchanged" — treat as changed
    # and let the policy decide (conservative: never silently skip a possible change).
    assert decide(_match(None), "new", "update") == "update"
    assert decide(_match("old"), None, "supersede") == "supersede"
    assert decide(_match(None), None, "update") == "update"
