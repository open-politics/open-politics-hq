"""Meaning, step 5 (docs/plans/meaning/PLAN.md): rooms — documents as a
meaning (``Like``), held by ``about(like=)`` and read back in words by
``describe``.

The world is ``test_about``'s: vectors at an angle in the first two
dimensions, every phrase remembered, nothing reaching a provider.
"""
from __future__ import annotations

import math

import pytest

from app.api.modules.embedding.similarity import Like, centroid, vector_of
from app.api.modules.graph import network as net
from app.api.routes.network import Reading, Weights
from app.tests.test_about import (  # noqa: F401 — fixtures
    PHRASE,
    by_ann,
    chunk,
    db,
    no_provider,
    pg_engine,
    world,
)


def angle(v: list[float]) -> float:
    return math.atan2(v[1], v[0])


def documents(world) -> dict[str, int]:
    from sqlalchemy import text
    rows = world.db.execute(text("SELECT title, id FROM asset WHERE infospace_id = :i"), {"i": world.iid}).all()
    return dict(rows)


def em(world):
    from app.models import EmbeddingModel
    return world.db.get(EmbeddingModel, world.em)


def test_a_centroid_counts_each_document_once(world):
    docs = documents(world)
    # near has two chunks now, at .1 and .3: its mean points at .2, and it
    # weighs as much as far's one chunk at 1.2 — not twice as much, which
    # would put the centroid near .53.
    from app.models import AssetChunk
    world.db.add(AssetChunk(asset_id=docs["near"], chunk_index=1, text_content="more", embedding_model_id=world.em,
                            embedding_384=[math.cos(0.3), math.sin(0.3)] + [0.0] * 382))
    world.db.flush()
    c = centroid(world.db, world.iid, [docs["near"], docs["far"]], em(world))
    assert angle(c) == pytest.approx((0.2 + 1.2) / 2, abs=0.01)
    assert centroid(world.db, world.iid, [docs["bare"]], em(world)) is None
    assert centroid(world.db, world.iid, [], em(world)) is None


async def test_like_reads_apart_from_what_it_is_unlike_and_as_itself_when_it_is_all_of_it(world):
    docs = documents(world)
    room, run = (docs["near"], docs["paged"]), (docs["near"], docs["paged"], docs["far"])
    apart = await vector_of(world.db, world.iid, Like(room, unlike=run), em(world))
    # The room leans toward 0, the run toward 1.2: apart points below 0.
    assert angle(apart) < 0
    same = await vector_of(world.db, world.iid, Like(room, unlike=room), em(world))
    assert angle(same) == pytest.approx(0.15, abs=1e-3)


async def test_about_like_documents_weighs_the_run_by_their_centroid(world):
    docs = documents(world)
    out = await net.about(world.scope, None, like=[docs["far"]])
    assert by_ann(world, out) == {"far": 1.0, "paged": 0.5, "near": 0.0, "near again": 0.0}
    Weights.model_validate(out)
    # Phrases and documents are alternatives: each document takes its closest
    # — far is the snapshot itself, near all but the phrase.
    both = await net.about(world.scope, PHRASE, like=[docs["far"]])
    assert by_ann(world, both) == {"far": 1.0, "near": 0.5, "near again": 0.5, "paged": 0.0}
    # A snapshot outside the run is not read.
    assert (await net.about(world.scope, None, like=[docs["unread"]]))["annotation"]["ids"] == []
    with pytest.raises(ValueError):
        await net.about(world.scope, [], like=[])


async def test_describe_reads_a_room_apart_from_the_run(world):
    docs = documents(world)
    out = await net.describe(world.scope, [docs["near"], docs["paged"], docs["unread"]], ["Rome", "Ann", "Nobody"])
    # Apart from the run (which leans to far, at 1.2), near (.1) reads closer
    # than paged (.2); Ann (.05) closer than Rome (1.0); Nobody has no vector.
    assert [p["asset_id"] for p in out["passages"]] == [docs["near"], docs["paged"]]
    assert out["passages"][0]["title"] == "near" and out["passages"][1]["text"] == "body"
    assert [t["text"] for t in out["terms"]] == ["Ann", "Rome"]
    # unread is not the run's; both read documents are embedded.
    assert (out["documents"], out["embedded"]) == (2, 2)
    Reading.model_validate(out)


async def test_describe_a_room_with_nothing_embedded_reads_nothing(world):
    docs = documents(world)
    out = await net.describe(world.scope, [docs["bare"]], ["Ann"])
    assert out == {"passages": [], "terms": [], "documents": 1, "embedded": 0}
    assert (await net.describe(world.scope, [], ["Ann"]))["documents"] == 0
