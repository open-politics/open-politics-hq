"""Regenerate the shared grammar fixture from :data:`gql.TOKENS`.

    docker compose exec backend python -m app.api.modules.graph.gen_tokens

The filter grammar has two implementations — the Python engine and the
TypeScript pill mirror — and used to have four hand-kept *descriptions* that
drifted into teaching different things. The fixture this writes is the claim
both sides assert against, so a token added on one side and not the other fails
a test rather than confusing a user months later.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.api.modules.graph.gql import token_table

# …/app/api/modules/graph/gen_tokens.py → parents[3] is `app`.
FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "tests" / "fixtures" / "gql_tokens.json"
)

_COMMENT = [
    "Generated from graph/gql.py::TOKENS. Do not hand-edit.",
    "",
    "The filter grammar exists in two implementations: the Python engine and",
    "the TypeScript pill mirror. It used to exist in FOUR hand-kept copies and",
    "they taught different things, so this file is the claim both sides assert",
    "against.",
    "",
    "Regenerate with:  python -m app.api.modules.graph.gen_tokens",
    "Read by app/tests/test_gql_tokens.py and",
    "frontend/src/lib/query/graph_tokens.test.ts",
]


def main() -> None:
    payload = {"_comment": _COMMENT, "tokens": token_table()}
    FIXTURE.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(payload['tokens'])} tokens → {FIXTURE}")


if __name__ == "__main__":
    main()
