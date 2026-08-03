"""The Python half of the convergence parity contract.

``fixtures/profile_parity.json`` is the shared claim; the TypeScript half is
``frontend/src/components/collection/graph/hud/convergence.parity.test.ts``.
Both read the same file, so a change to either implementation that is not also
a change to the fixture fails on one side or the other.

Written because the two implementations had already drifted under a docstring
asserting they could not — see the fixture's own header.
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.api.modules.graph.gql import _cosine, _distance_penalty, _profile_of

FIXTURE = Path(__file__).parent / "fixtures" / "profile_parity.json"
CASES = json.loads(FIXTURE.read_text())


@pytest.mark.parametrize("case", CASES["profiles"], ids=lambda c: c["name"])
def test_the_profile_is_read_the_same_way(case):
    node = SimpleNamespace(profile=case["raw"], group_value=None)
    assert _profile_of(node) == case["profile"]


@pytest.mark.parametrize("case", CASES["cosines"], ids=lambda c: c["name"])
def test_the_cosine_is_the_same_number(case):
    assert _cosine(case["a"], case["b"]) == pytest.approx(case["cosine"], abs=1e-12)


@pytest.mark.parametrize(
    "case", CASES["distance_penalties"], ids=lambda c: c["name"]
)
def test_the_distance_penalty_is_the_same_curve(case):
    assert _distance_penalty(case["hops"]) == pytest.approx(
        case["penalty"], abs=1e-12
    )


def test_a_non_dict_profile_is_not_a_profile():
    for value in (None, "Person", ["a", "b"], 3):
        assert _profile_of(SimpleNamespace(profile=value, group_value=None)) is None


def test_group_value_is_not_read():
    """A role histogram is not an affinity vector.

    ``node_group_by: "roles"`` puts ``{via: 340, employer: 12}`` in
    ``group_value``, and cosining two of those scores a perfect 1.0 for both
    being intermediaries a lot. Reading the typed field makes that unreachable.
    """
    node = SimpleNamespace(profile=None, group_value={"via": 340, "employer": 12})
    assert _profile_of(node) is None
