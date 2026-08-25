"""The Python half of the grammar parity contract.

``fixtures/gql_tokens.json`` is the shared claim; the TypeScript half is
``frontend/src/lib/query/graph_tokens.test.ts``. Both read the same file, so a
token added to one implementation and not the other fails on one side.

Written because the grammar existed in four hand-kept copies — this module's
docstring, ``GRAPH_QUERY.md``, the TS mirror and the MCP tool description — and
adding a token meant eight edits nobody made all of. The copies drifted into
teaching different things, which is worse than having one.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.api.modules.graph.gql import TOKENS, grammar_block, token_table

FIXTURE = Path(__file__).parent / "fixtures" / "gql_tokens.json"
CASES = json.loads(FIXTURE.read_text())


def test_the_table_matches_the_fixture():
    assert token_table() == CASES["tokens"], (
        "TOKENS changed without regenerating the shared fixture — run "
        "`python -m app.api.modules.graph.gen_tokens`, and update the "
        "TypeScript mirror in the same commit."
    )


def test_every_token_carries_its_gotcha_or_is_self_evident():
    """``semantics`` is what made the MCP copy the best of the four.

    A model handed only prefixes writes queries that parse and answer the wrong
    question, so a token with a non-obvious reading must say so. Tokens whose
    behaviour is entirely in the hint are allowed to omit it — but a *tier 3*
    token never is: traversal is where a wrong reading becomes a confident
    wrong number.
    """
    for t in TOKENS:
        if t.tier == 3:
            assert t.semantics, f"{t.token} traverses and explains nothing"


def test_every_token_has_an_example():
    for t in TOKENS:
        assert t.example, f"{t.token} has no example"


def test_the_generated_block_teaches_the_traps():
    """The prose the MCP description and the in-bar reference both read."""
    block = grammar_block()
    assert "occurrences are contracted" in block
    assert "INTERSECT" in block
    assert "capped it at 0.5" in block


# ─── SECTION — the readable spelling of `field:` ─────────────────────────────


def test_section_resolves_to_a_projection_path():
    """`SECTION:places` means `field:document.places[*]`, without anyone having
    to know the contract's internal path to ask about its content."""
    from types import SimpleNamespace

    from app.api.modules.graph.channels import parse_channels, resolve_sections

    projections = [
        SimpleNamespace(path="document.places[*]", role="anchor"),
        SimpleNamespace(path="document.observations[*]", role="companion"),
    ]
    q = parse_channels("SECTION:places")
    assert resolve_sections(q, projections) == ["document.places[*]"]

    q = parse_channels("SECTION:places,observations")
    assert resolve_sections(q, projections) == [
        "document.places[*]", "document.observations[*]",
    ]


def test_a_dotted_suffix_still_names_the_section():
    from types import SimpleNamespace

    from app.api.modules.graph.channels import parse_channels, resolve_sections

    projections = [SimpleNamespace(path="document.places[*]", role="anchor")]
    q = parse_channels("SECTION:places.kind")
    assert resolve_sections(q, projections) == ["document.places[*]"]


def test_an_unknown_section_filters_NOTHING_rather_than_everything():
    """A typo must not answer with an empty canvas.

    `field:` with a path nothing matches excludes every projection, so
    resolving a misspelled section into one would turn a typo into a confident
    "there is nothing here". It resolves to no filter and surfaces as an amber
    pill instead.
    """
    from types import SimpleNamespace

    from app.api.modules.graph.channels import (
        parse_channels, resolve_sections, unresolved_sections,
    )

    projections = [SimpleNamespace(path="document.places[*]", role="anchor")]
    q = parse_channels("SECTION:nonesuch")
    assert resolve_sections(q, projections) == []
    assert unresolved_sections(q, projections) == ["nonesuch"]
