"""Meaning, step 1 (docs/plans/meaning/PLAN.md): ``embed_texts`` remembers,
``weigh`` scores every document in scope, and AQL's ``~`` reads it completely.

Real Postgres; only the embedding provider is faked. A document's chunk sits at
an angle to the phrase in the first two dimensions, so its similarity to the
phrase is the cosine of that angle — every expected set is exact.
"""
from __future__ import annotations

import math
import uuid

import pytest
from sqlalchemy import text
from sqlmodel import Session

PHRASE = "energy prices"


def at(angle: float, dim: int) -> list[float]:
    v = [0.0] * dim
    v[0], v[1] = math.cos(angle), math.sin(angle)
    return v


class FakeProvider:
    """Answers each (model, text) with a fixed vector, and counts what it was asked."""

    def __init__(self, vectors: dict[tuple[str, str], list[float]]):
        self.vectors = vectors
        self.asked: list[tuple[str, str]] = []

    async def embed_texts(self, texts, model_name):
        self.asked += [(model_name, t) for t in texts]
        return [self.vectors[(model_name, t)] for t in texts]


@pytest.fixture
def db():
    from app.core.db import engine
    with Session(engine) as session:
        yield session


@pytest.fixture
def models(db):
    """Two models nothing else uses — 384d and 512d — removed with their chunks."""
    from app.models import EmbeddingModel
    made = [
        EmbeddingModel(name=f"fake-{uuid.uuid4().hex[:8]}", provider="fake", dimension=dim)
        for dim in (384, 512)
    ]
    db.add_all(made)
    db.commit()
    yield made
    ids = [m.id for m in made]
    db.execute(text("DELETE FROM assetchunk WHERE embedding_model_id = ANY(:ids)"), {"ids": ids})
    db.execute(text("DELETE FROM embeddingmodel WHERE id = ANY(:ids)"), {"ids": ids})
    db.commit()


@pytest.fixture
def provider(monkeypatch, models):
    a, b = models
    fake = FakeProvider({(a.name, PHRASE): at(0, 384), (b.name, PHRASE): at(0, 512)})
    monkeypatch.setattr(
        "app.api.modules.foundation_service_providers.resolve", lambda *args, **kw: fake,
    )
    return fake


def documents(db, infospace_id, user_id, model, angles) -> list[int]:
    """One document per angle, each with one chunk embedded under *model*."""
    from app.models import Asset, AssetChunk
    col = f"embedding_{model.dimension}"
    ids = []
    for k, angle in enumerate(angles):
        asset = Asset(kind="text", title=f"doc {k}", text_content=f"body {k}",
                      infospace_id=infospace_id, user_id=user_id)
        db.add(asset)
        db.flush()
        db.add(AssetChunk(asset_id=asset.id, chunk_index=0, text_content=f"body {k}",
                          embedding_model_id=model.id, **{col: at(angle, model.dimension)}))
        ids.append(asset.id)
    db.commit()
    return ids


@pytest.fixture
def space(infospace_factory, user_id):
    return infospace_factory(f"Meaning {uuid.uuid4().hex[:6]}", user_id)


async def query(db, infospace_id, aql):
    from app.api.modules.content.query import AssetQuery, parse
    q = AssetQuery.from_aql(db, infospace_id, parse(aql))
    await q.resolve()
    return q


async def test_a_threshold_keeps_every_document_past_it(db, space, user_id, models, provider):
    # 60 close documents — more than the 50 the clause used to stop at — and 10 far.
    near = documents(db, space, user_id, models[0], [k * 0.005 for k in range(60)])
    documents(db, space, user_id, models[0], [1.4] * 10)        # cos 1.4 ≈ 0.17

    q = await query(db, space, f'~"{PHRASE}">0.5')
    assert q.count() == 60
    assert set(q._semantic_scores) == set(near)


async def test_below_a_threshold_is_the_complement(db, space, user_id, models, provider):
    documents(db, space, user_id, models[0], [0.1] * 30)
    far = documents(db, space, user_id, models[0], [1.4] * 10)

    q = await query(db, space, f'~"{PHRASE}"<0.5')
    assert {a.id for a in q.paginate(limit=100).assets()} == set(far)


async def test_without_a_threshold_the_closest_k(db, space, user_id, models, provider):
    from app.api.modules.content.query import AssetQuery
    ids = documents(db, space, user_id, models[0], [k * 0.02 for k in range(20)])

    q = AssetQuery(db, space).semantic(PHRASE, top_k=5)
    await q.resolve()
    assert set(q._semantic_scores) == set(ids[:5])


async def test_each_model_reads_its_own_chunks(db, space, user_id, models, provider):
    # Mid-switch: half the documents under each model, and no embedding
    # configured on the infospace at all — the chunks name their own models.
    from app.api.modules.embedding.similarity import weigh
    a, b = models
    under_a = documents(db, space, user_id, a, [0.1, 0.2])
    under_b = documents(db, space, user_id, b, [0.3, 0.4])

    similarity = await weigh(db, space, PHRASE)
    assert set(similarity) == set(under_a + under_b)
    assert similarity[under_b[0]] == pytest.approx(math.cos(0.3), abs=1e-4)
    assert set(provider.asked) == {(a.name, PHRASE), (b.name, PHRASE)}


async def test_embed_texts_remembers_per_infospace(db, infospace_factory, user_id, models, provider):
    from app.api.modules.embedding.embed import embed_texts
    a = models[0]
    first, second = (infospace_factory(f"Meaning {uuid.uuid4().hex[:6]}", user_id) for _ in range(2))

    once, _ = await embed_texts(db, first, [PHRASE, PHRASE], embedding_model_id=a.id)
    again, _ = await embed_texts(db, first, [PHRASE], embedding_model_id=a.id)
    assert provider.asked == [(a.name, PHRASE)]
    assert again[0] == pytest.approx(once[0]) and once[0] == pytest.approx(once[1])

    await embed_texts(db, second, [PHRASE], embedding_model_id=a.id)
    assert provider.asked == [(a.name, PHRASE)] * 2
