"""Meaning, step 3 (docs/plans/meaning/PLAN.md): ``about`` on the network's
weigh — a meaning as a weight per annotation (*context*: the documents'
chunks) and per name (*said*: the reader's node names, by their own vectors).

Real Postgres, rolled back per test. Nothing reaches a provider: the phrases'
vectors are remembered (``TextVector``) before they are asked for, as a
phrase searched before is. A vector sits at an angle to the phrase in the
first two dimensions, so every similarity is the cosine of that angle and
every rank is exact.
"""
from __future__ import annotations

import math
import types
import uuid

import pytest
from sqlalchemy import text

import app.models  # noqa: F401 — every mapper
from app.api.modules.annotation import overview as ov
from app.api.modules.embedding.embed import _digest
from app.api.modules.graph import network as net
from app.api.routes.network import Weights
from app.tests.test_graph_stream import (  # noqa: F401 — fixtures
    _annotation,
    _asset,
    _infospace,
    _run,
    _schema_with,
    _user,
    db,
    pg_engine,
)
from app.tests.test_network import CONTRACT, doc

PHRASE, OTHER = "energy prices", "peace talks"


def at(angle: float, dim: int) -> list[float]:
    v = [0.0] * dim
    v[0], v[1] = math.cos(angle), math.sin(angle)
    return v


def model(db, dim: int) -> int:
    from app.models import EmbeddingModel
    em = EmbeddingModel(name=f"fake-{uuid.uuid4().hex[:8]}", provider="fake", dimension=dim)
    db.add(em)
    db.flush()
    return em.id


def remember(db, iid: int, em: int, dim: int, texts: dict[str, float]) -> None:
    from app.models import TextVector
    db.add_all([TextVector(infospace_id=iid, embedding_model_id=em, digest=_digest(t),
                           **{f"embedding_{dim}": at(angle, dim)}) for t, angle in texts.items()])
    db.flush()


def chunk(db, asset: int, em: int, angle: float) -> None:
    from app.models import AssetChunk
    db.add(AssetChunk(asset_id=asset, chunk_index=0, text_content="body",
                      embedding_model_id=em, embedding_384=at(angle, 384)))
    db.flush()


@pytest.fixture(autouse=True)
def no_provider(monkeypatch):
    def refuse(*_, **__):
        raise AssertionError("a remembered phrase reached the provider")
    monkeypatch.setattr("app.api.modules.foundation_service_providers.resolve", refuse)


@pytest.fixture
def world(db):
    """Four documents the run read — near, a document whose only chunk is on
    its page, far, and one never embedded — and a nearer one it did not read."""
    uid = _user(db, "about")
    iid = _infospace(db, uid, "about")
    sid = _schema_with(db, iid, uid, CONTRACT)
    run, other = _run(db, iid, uid, "r"), _run(db, iid, uid, "other")
    em = model(db, 384)
    remember(db, iid, em, 384, {PHRASE: 0.0, OTHER: 1.2, "Ann": 0.05, "Rome": 1.0})

    docs = {name: _asset(db, iid, uid, name) for name in ("near", "paged", "far", "bare", "unread")}
    page = _asset(db, iid, uid, "page 1 of paged")
    db.execute(text("UPDATE asset SET parent_asset_id = :p WHERE id = :a"), {"p": docs["paged"], "a": page})
    chunk(db, docs["near"], em, 0.1)
    chunk(db, page, em, 0.2)
    chunk(db, docs["far"], em, 1.2)
    chunk(db, docs["unread"], em, 0.0)

    anns = {name: _annotation(db, iid, uid, run, sid, docs[name], doc(["Ann"], ["Rome"]))
            for name in ("near", "paged", "far", "bare")}
    anns["near again"] = _annotation(db, iid, uid, run, sid, docs["near"], doc(["Bob"], []))
    failed = _annotation(db, iid, uid, run, sid, docs["near"], doc(["Zed"], []))
    db.execute(text("UPDATE annotation SET status = 'FAILED' WHERE id = :i"), {"i": failed})
    _annotation(db, iid, uid, other, sid, docs["unread"], doc(["Ann"], []))
    db.flush()
    scope = ov.open_scope(db, types.SimpleNamespace(infospace_id=iid, scope=None), run)
    return types.SimpleNamespace(db=db, iid=iid, em=em, scope=scope, anns=anns, failed=failed)


def by_ann(w, out) -> dict[str, float]:
    names = {v: k for k, v in w.anns.items()}
    col = out["annotation"]
    return {names[i]: round(x, 4) for i, x in zip(col["ids"], col["weights"])}


async def test_context_ranks_the_runs_documents_and_every_annotation_takes_its_documents_share(world):
    out = await net.about(world.scope, PHRASE)

    # near (cos .1) > paged (its page, cos .2) > far (cos 1.2); bare has no
    # chunk and is absent; unread is not the run's; failed is not read.
    assert by_ann(world, out) == {"near": 1.0, "near again": 1.0, "paged": 0.5, "far": 0.0}
    scale = out["scale"]
    assert scale["by"] == "rank"
    assert scale["min"] == pytest.approx(math.cos(1.2), abs=1e-4)
    assert scale["max"] == pytest.approx(math.cos(0.1), abs=1e-4)
    assert len(scale["quantiles"]) == net.QUANTILES + 1
    assert scale["quantiles"][net.QUANTILES // 2] == pytest.approx(math.cos(0.2), abs=1e-4)
    assert "label" not in out
    Weights.model_validate(out)                       # the wire shape


async def test_alternatives_take_the_closest(world):
    out = await net.about(world.scope, [PHRASE, OTHER, PHRASE])
    # far is OTHER itself (cos 1); near .995 > paged .980.
    assert by_ann(world, out) == {"far": 1.0, "near": 0.5, "near again": 0.5, "paged": 0.0}


async def test_names_are_weighed_by_their_own_vectors_and_a_name_without_one_is_absent(world):
    out = await net.about(world.scope, PHRASE, labels=["Ann", "Rome", "Bob", " Ann ", ""])
    label = out["label"]
    assert dict(zip(label["names"], label["weights"])) == {"Rome": 0.0, "Ann": 1.0}
    assert label["scale"]["max"] == pytest.approx(math.cos(0.05), abs=1e-4)
    assert (await net.about(world.scope, PHRASE, labels=[]))["label"]["names"] == []
    Weights.model_validate(out)


async def test_each_model_reads_its_own_name_vectors(world):
    from app.api.modules.embedding.similarity import weigh_texts
    b = model(world.db, 512)
    remember(world.db, world.iid, b, 512, {PHRASE: 0.0, "Oslo": 0.3})

    near = await weigh_texts(world.db, world.iid, PHRASE, ["Ann", "Oslo", "Bob"])
    assert set(near) == {"Ann", "Oslo"}
    assert near["Oslo"] == pytest.approx(math.cos(0.3), abs=1e-4)


async def test_about_needs_a_phrase(world):
    for value in (None, "", ["  "], 3):
        with pytest.raises(ValueError):
            await net.about(world.scope, value)
    with pytest.raises(ValueError):
        await net.about(world.scope, [f"p{k}" for k in range(net.ABOUT_TEXTS + 1)])


def test_a_rank_scale_gives_the_values_back_at_every_twentieth():
    weights, scale = net._by_rank([3.0, 1.0, 2.0, 2.0, 5.0])
    assert weights == [0.75, 0.0, 0.375, 0.375, 1.0]
    assert scale["quantiles"][0] == 1.0 and scale["quantiles"][-1] == 5.0
    assert scale["quantiles"] == sorted(scale["quantiles"])
