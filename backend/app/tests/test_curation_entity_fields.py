"""Curation of schema-declared entity fields (Phase C1).

Curation used to walk only triplet-shaped arrays, so a canon-tied
``array_entity`` field — the roster the whole graph domain is meant to hang
off — never reached ``resolve_entities_batch``. An annotation carrying entity
fields but no triplets was skipped outright by a value-shape pre-gate.

These are integration tests against real Postgres: they create a schema, an
asset, and an annotation, run ``curate_annotation_batch``, and assert on the
``CanonEntry`` / ``FragmentCuration`` rows that come out.
"""
from __future__ import annotations

import pytest
from sqlmodel import Session, select

from app.api.modules.annotation.models import Annotation, AnnotationSchema
from app.api.modules.content.models import Asset
from app.api.modules.graph.models import CanonEntry, FragmentCuration, GraphEdge
from app.api.modules.graph.tasks.curation import curate_annotation_batch
from app.core.db import engine
from app.models import Infospace


# ─── Fixtures ───────────────────────────────────────────────────────────────


def entity_items(entity_type: str, *, constrained: bool = True,
                 alternates: list[str] | None = None) -> dict:
    """The entity object shape ``adapters.ts:buildEntityObjectSchema`` emits."""
    obj: dict = {
        "type": "object",
        "x-entityField": True,
        "x-entityType": entity_type,
        "x-entityTypeConstrained": constrained,
        "properties": {
            "name": {"type": "string"},
            "type": {"type": "string", "x-entityTypeDeclared": entity_type},
            "additional_types": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name"],
    }
    if alternates:
        obj["x-entityAlternateTypes"] = alternates
    return obj


TRIPLET_ITEMS = {
    "type": "object",
    "properties": {
        "subject_name": {"type": "string"},
        "subject_type": {"type": "string"},
        "predicate": {"type": "string"},
        "object_name": {"type": "string"},
        "object_type": {"type": "string"},
    },
}


@pytest.fixture(scope="module")
def iid(infospace_factory, user_id):
    return infospace_factory("C1 Entity Curation", user_id)


@pytest.fixture
def make_annotation(iid, user_id):
    """Create (schema, asset, annotation) and yield the annotation id.

    Rows are left in place for the module's infospace teardown to sweep — the
    infospace delete cascades, so per-test cleanup would be redundant.
    """
    created: list[int] = []

    def _make(contract: dict, value: dict, *, canon_ids: list[int] | None = None):
        from app.api.modules.annotation.models import AnnotationRun

        with Session(engine) as s:
            schema = AnnotationSchema(
                name=f"c1-schema-{len(created)}-{id(value)}",
                output_contract=contract,
                infospace_id=iid,
                user_id=user_id,
            )
            s.add(schema)
            asset = Asset(title="c1-asset", kind="text", infospace_id=iid, user_id=user_id)
            s.add(asset)
            s.commit()
            s.refresh(schema)
            s.refresh(asset)

            run = AnnotationRun(
                name=f"c1-run-{len(created)}", infospace_id=iid, user_id=user_id,
                schema_ids=[schema.id], canon_ids=canon_ids or [],
            )
            s.add(run)
            s.commit()
            s.refresh(run)

            ann = Annotation(
                asset_id=asset.id, schema_id=schema.id, run_id=run.id,
                infospace_id=iid, user_id=user_id, value=value,
            )
            s.add(ann)
            s.commit()
            s.refresh(ann)
            created.append(ann.id)
            return ann.id

    return _make


def _default_canon_id(iid: int) -> int:
    with Session(engine) as s:
        return s.get(Infospace, iid).default_canon_id


def _entries(canon_id: int, names: list[str]) -> list[CanonEntry]:
    with Session(engine) as s:
        return list(s.exec(
            select(CanonEntry).where(
                CanonEntry.canon_id == canon_id,
                CanonEntry.canonical.in_(names),
            )
        ).all())


def _fragments(ann_id: int) -> list[FragmentCuration]:
    with Session(engine) as s:
        return list(s.exec(
            select(FragmentCuration).where(FragmentCuration.annotation_id == ann_id)
        ).all())


async def _curate(ann_id: int) -> dict:
    with Session(engine) as s:
        out = await curate_annotation_batch(s, [ann_id])
        s.commit()
        return out


# ─── The core gap ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_entity_only_annotation_is_curated(make_annotation, iid):
    """No triplets anywhere — previously skipped by the value-shape pre-gate,
    so a roster field could never reach the canon."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "entities": {"type": "array", "items": entity_items("Person")},
    }}}}
    ann_id = make_annotation(contract, {"document": {"entities": [
        {"name": "Angela Merkel", "type": "Person"},
        {"name": "BMW", "type": "Person"},
    ]}})

    result = await _curate(ann_id)

    assert result["skipped"] == 0, "entity-only annotation must not be skipped"
    assert result["curated"] == 2
    canon_id = _default_canon_id(iid)
    assert {e.canonical for e in _entries(canon_id, ["Angela Merkel", "BMW"])} == {
        "Angela Merkel", "BMW",
    }


@pytest.mark.asyncio
async def test_entity_mentions_bind_through_entry_id_not_edges(make_annotation):
    """A mention is a membership statement, not a relationship — it gets a
    FragmentCuration with ``entry_id`` and no GraphEdge."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "entities": {"type": "array", "items": entity_items("Person")},
    }}}}
    ann_id = make_annotation(contract, {"document": {"entities": [{"name": "Solo", "type": "Person"}]}})

    await _curate(ann_id)

    frags = _fragments(ann_id)
    assert len(frags) == 1
    assert frags[0].entry_id is not None
    assert frags[0].source_entry_id is None and frags[0].target_entry_id is None
    with Session(engine) as s:
        edges = s.exec(select(GraphEdge).where(GraphEdge.annotation_id == ann_id)).all()
    assert edges == []


@pytest.mark.asyncio
async def test_fragment_path_carries_real_indices(make_annotation):
    """Per-mention idempotency needs a per-mention key."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "observations": {"type": "array", "items": {"type": "object", "properties": {
            "statement_by": entity_items("Person"),
            "claim": {"type": "string"},
        }}},
    }}}}
    ann_id = make_annotation(contract, {"document": {"observations": [
        {"statement_by": {"name": "A", "type": "Person"}, "claim": "x"},
        {"statement_by": {"name": "B", "type": "Person"}, "claim": "y"},
    ]}})

    await _curate(ann_id)

    assert {f.fragment_path for f in _fragments(ann_id)} == {
        "document.observations[0].statement_by",
        "document.observations[1].statement_by",
    }


@pytest.mark.asyncio
async def test_recuration_is_idempotent(make_annotation):
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "entities": {"type": "array", "items": entity_items("Person")},
    }}}}
    ann_id = make_annotation(contract, {"document": {"entities": [{"name": "Repeat", "type": "Person"}]}})

    first = await _curate(ann_id)
    second = await _curate(ann_id)

    assert first["curated"] == 1
    assert second["curated"] == 0, "already-curated mentions must not re-land"
    assert len(_fragments(ann_id)) == 1


# ─── Linking: one entity, many paths, one canon entry ───────────────────────


@pytest.mark.asyncio
async def test_same_name_across_roster_and_row_resolves_to_one_entry(make_annotation, iid):
    """The payoff. A name in the roster and the same name in a nested row are
    one canon entry — which is what makes them one graph node downstream."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "entities": {"type": "array", "items": entity_items("Person")},
        "observations": {"type": "array", "items": {"type": "object", "properties": {
            "statement_by": entity_items("Person"),
        }}},
    }}}}
    ann_id = make_annotation(contract, {"document": {
        "entities": [{"name": "Shared Person", "type": "Person"}],
        "observations": [{"statement_by": {"name": "Shared Person", "type": "Person"}}],
    }})

    await _curate(ann_id)

    canon_id = _default_canon_id(iid)
    entries = _entries(canon_id, ["Shared Person"])
    assert len(entries) == 1, "one name must not fan out into two canon entries"
    frags = _fragments(ann_id)
    assert len(frags) == 2, "both mentions keep their own provenance row"
    assert {f.entry_id for f in frags} == {entries[0].id}


@pytest.mark.asyncio
async def test_declared_type_wins_over_emitted_type(make_annotation, iid):
    """A mention emitted as ``Person`` on a field declaring ``Politician`` is
    coerced — otherwise one human splits across two canon populations, and
    because type gates every lookup that split would be permanent."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "politicians": {"type": "array", "items": entity_items("Politician")},
    }}}}
    ann_id = make_annotation(contract, {"document": {"politicians": [
        {"name": "Coerce Me", "type": "Person"},
    ]}})

    await _curate(ann_id)

    canon_id = _default_canon_id(iid)
    entries = _entries(canon_id, ["Coerce Me"])
    assert len(entries) == 1
    assert entries[0].type == "Politician"


@pytest.mark.asyncio
async def test_declared_alternate_type_is_preserved(make_annotation, iid):
    """A multi-type field legitimately accepts several kinds — an emitted type
    matching an alternate must not be flattened to the primary."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "actors": {"type": "array", "items": entity_items("Person", alternates=["Company"])},
    }}}}
    ann_id = make_annotation(contract, {"document": {"actors": [
        {"name": "Alt Typed", "type": "Company"},
    ]}})

    await _curate(ann_id)

    entries = _entries(_default_canon_id(iid), ["Alt Typed"])
    assert len(entries) == 1
    assert entries[0].type == "Company"


@pytest.mark.asyncio
async def test_case_variant_types_collapse_to_one_entry(make_annotation, iid):
    """``Person`` / ``person`` used to resolve to two populations. The field is
    unconstrained so both spellings survive coercion and reach resolution —
    which must now treat them as the same type."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "a": {"type": "array", "items": entity_items("", constrained=False)},
    }}}}
    ann_id = make_annotation(contract, {"document": {"a": [
        {"name": "Casing Test", "type": "Person"},
        {"name": "Casing Test", "type": "person"},
    ]}})

    await _curate(ann_id)

    entries = _entries(_default_canon_id(iid), ["Casing Test"])
    assert len(entries) == 1, f"expected one entry, got types {[e.type for e in entries]}"


# ─── Coexistence with triplets ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_triplets_and_entity_fields_curate_together(make_annotation, iid):
    """Both paths in one annotation: edges from the triplet field, membership
    rows from the roster, one resolution pass over the union."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "entities": {"type": "array", "items": entity_items("Person")},
        "actions": {"type": "array", "items": TRIPLET_ITEMS},
    }}}}
    ann_id = make_annotation(contract, {"document": {
        "entities": [{"name": "Both A", "type": "Person"}],
        "actions": [{
            "subject_name": "Both A", "subject_type": "Person",
            "predicate": "funds",
            "object_name": "Both B", "object_type": "Person",
        }],
    }})

    await _curate(ann_id)

    with Session(engine) as s:
        edges = s.exec(select(GraphEdge).where(GraphEdge.annotation_id == ann_id)).all()
    assert len(edges) == 1
    assert edges[0].source_field_path == "document.actions"

    frags = _fragments(ann_id)
    edge_frags = [f for f in frags if f.source_entry_id is not None]
    entity_frags = [f for f in frags if f.entry_id is not None]
    assert len(edge_frags) == 1
    assert len(entity_frags) == 1

    # The subject appears in both the roster and the triplet — still one entry.
    assert len(_entries(_default_canon_id(iid), ["Both A"])) == 1


@pytest.mark.asyncio
async def test_annotation_with_nothing_curatable_is_skipped(make_annotation):
    """The replacement for the removed ``_has_graph_structure`` gate: skip on
    "found neither triplets nor entity mentions", which is the real condition."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "tags": {"type": "array", "items": {"type": "string"}},
        "score": {"type": "number"},
    }}}}
    ann_id = make_annotation(contract, {"document": {"tags": ["a", "b"], "score": 3}})

    result = await _curate(ann_id)

    assert result["skipped"] == 1
    assert result["curated"] == 0
    assert _fragments(ann_id) == []


# ─── Storage-convention tolerance ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_document_unwrapped_value_resolves(make_annotation, iid):
    """``annotate.py`` stores ``result["document"]`` at the value root, so a
    ``document.entities`` map path must resolve against a bare ``entities``."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "entities": {"type": "array", "items": entity_items("Person")},
    }}}}
    ann_id = make_annotation(contract, {"entities": [{"name": "Unwrapped", "type": "Person"}]})

    await _curate(ann_id)

    assert len(_entries(_default_canon_id(iid), ["Unwrapped"])) == 1


@pytest.mark.asyncio
async def test_bare_string_entity_is_captured(make_annotation, iid):
    """The model emits ``["Name"]`` instead of ``[{"name": "Name"}]`` often
    enough that dropping those would lose real mentions."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "entities": {"type": "array", "items": entity_items("Person")},
    }}}}
    ann_id = make_annotation(contract, {"document": {"entities": ["Bare String Person"]}})

    await _curate(ann_id)

    entries = _entries(_default_canon_id(iid), ["Bare String Person"])
    assert len(entries) == 1
    assert entries[0].type == "Person", "type falls back to the field's declared type"


# ─── Untyped mentions must not split across the two paths ───────────────────


@pytest.mark.asyncio
async def test_untyped_entity_field_and_untyped_triplet_agree(make_annotation, iid):
    """The triplet path defaults a missing type to ``UNKNOWN``. An entity field
    that declares no type must land on the same sentinel, or the same name
    resolves to two canon entries depending on which field mentioned it."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        # No x-entityType declared, and the value carries no `type` either.
        "mentioned": {"type": "array", "items": entity_items("", constrained=False)},
        "actions": {"type": "array", "items": TRIPLET_ITEMS},
    }}}}
    ann_id = make_annotation(contract, {"document": {
        "mentioned": [{"name": "Untyped Both"}],
        "actions": [{
            "subject_name": "Untyped Both",   # no subject_type key at all
            "predicate": "mentions",
            "object_name": "Other Side",
        }],
    }})

    await _curate(ann_id)

    entries = _entries(_default_canon_id(iid), ["Untyped Both"])
    assert len(entries) == 1, f"split across types {[e.type for e in entries]}"
    assert entries[0].type == "UNKNOWN"


@pytest.mark.asyncio
async def test_emitted_empty_type_folds_into_untyped(make_annotation, iid):
    """``.get(k, default)`` misses this case — the key exists, carrying ``""``."""
    contract = {"type": "object", "properties": {"document": {"type": "object", "properties": {
        "actions": {"type": "array", "items": TRIPLET_ITEMS},
    }}}}
    ann_id = make_annotation(contract, {"document": {"actions": [{
        "subject_name": "Empty Typed", "subject_type": "",
        "predicate": "x",
        "object_name": "Empty Typed Two", "object_type": "",
    }]}})

    await _curate(ann_id)

    entries = _entries(_default_canon_id(iid), ["Empty Typed"])
    assert len(entries) == 1
    assert entries[0].type == "UNKNOWN"
