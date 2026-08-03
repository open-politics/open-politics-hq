"""Tests for canon binding → effective contract (Phase B).

What must hold, because everything downstream reads the contract rather than
the binding:

1. ``types`` closes the type vocabulary on the entity's ``type`` property.
2. ``inject_properties`` produces a nested bag that ``SchemaMap`` can walk.

Entity *names* are never injected — see ``contract_resolution``'s module
docstring. Identity is a resolution problem, not a prompting one.

Integration tests against real Postgres — the canon reads are SQL.
"""
from __future__ import annotations

import pytest
from sqlmodel import Session

from app.api.modules.annotation.contract_resolution import (
    CanonBinding,
    effective_bindings,
    locate_node,
    resolve_contract,
    resolve_for_run,
)
from app.api.modules.annotation.schema_map import build_schema_map, schema_map_for
from app.api.modules.graph.models import Canon, CanonEntry
from app.core.db import engine
from app.models import Infospace


# ─── Contract builders ──────────────────────────────────────────────────────


def entity_obj(entity_type: str = "", *, canon: dict | None = None) -> dict:
    obj: dict = {
        "type": "object",
        "x-entityField": True,
        "x-entityTypeConstrained": False,
        "properties": {
            "name": {"type": "string"},
            "type": {"type": "string"},
            "additional_types": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name"],
    }
    if entity_type:
        obj["x-entityType"] = entity_type
    if canon:
        obj["x-canon"] = canon
    return obj


def doc(**fields) -> dict:
    return {"type": "object", "properties": {
        "document": {"type": "object", "properties": fields},
    }}


def roster(entity_type: str = "Politician", canon: dict | None = None) -> dict:
    """An ``array_entity`` roster. ``x-canon`` sits on the array node, matching
    what ``adapters.ts`` emits for this shape."""
    node: dict = {"type": "array", "items": entity_obj(entity_type)}
    if canon:
        node["x-canon"] = canon
    return node


# ─── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def iid(infospace_factory, user_id):
    return infospace_factory("B Contract Resolution", user_id)


@pytest.fixture(scope="module")
def canon(iid, user_id):
    """A canon with two types, declared property shapes, and known entries."""
    with Session(engine) as s:
        c = Canon(
            infospace_id=iid,
            name="B-test canon",
            type_schemas={
                "Politician": [
                    {"name": "birthdate", "type": "date", "description": "ISO date of birth"},
                    {"name": "current_job", "type": "text"},
                    {"name": "terms_served", "type": "integer", "required": True},
                ],
                "Party": [
                    {"name": "founded", "type": "date"},
                    {"name": "website", "type": "url"},
                    {"name": "aliases_seen", "type": "list"},
                ],
                "Ghost": [],
            },
        )
        s.add(c)
        s.commit()
        s.refresh(c)
        for name, t in [
            ("Angela Merkel", "Politician"),
            ("Olaf Scholz", "Politician"),
            ("friedrich merz", "politician"),   # lower-cased type on purpose
            ("SPD", "Party"),
            ("CDU", "Party"),
        ]:
            s.add(CanonEntry(
                infospace_id=iid, canon_id=c.id, canonical=name, type=t,
            ))
        s.commit()
        return c.id


def _resolve(contract: dict, bindings: dict[str, CanonBinding]):
    smap = build_schema_map(contract)
    with Session(engine) as s:
        return resolve_contract(contract, smap, bindings, session=s)


def _carrier(contract: dict, path: str = "document.entities[*]") -> dict:
    node = locate_node(contract, path)
    return node["items"] if node.get("type") == "array" else node


# ─── locate_node ────────────────────────────────────────────────────────────


def test_locate_node_finds_array_and_nested_leaf():
    contract = doc(
        entities=roster(),
        observations={"type": "array", "items": {"type": "object", "properties": {
            "statement_by": entity_obj("Politician"),
        }}},
    )
    assert locate_node(contract, "document.entities[*]")["type"] == "array"
    leaf = locate_node(contract, "document.observations[*].statement_by")
    assert leaf["x-entityField"] is True


def test_locate_node_missing_path():
    assert locate_node(doc(a={"type": "string"}), "document.nope") is None
    assert locate_node({}, "document.a") is None


# ─── Binding merge ──────────────────────────────────────────────────────────


def test_run_override_wins_per_key_not_wholesale():
    """A schema declaring types + a run overriding only inject_properties keeps
    the type injection."""
    contract = doc(entities=roster(canon={"type": "Politician", "inject": "types"}))
    smap = build_schema_map(contract)
    b = effective_bindings(
        smap,
        {"document.entities[*]": {"inject_properties": True}},
        run_canon_ids=[42],
    )["document.entities[*]"]
    assert b.inject == "types", "schema default must survive a partial override"
    assert b.inject_properties is True
    assert b.canon_id == 42, "the run's declared frame outranks the schema's preference"


def test_canon_precedence_falls_through_to_infospace_default():
    contract = doc(entities=roster(canon={"inject": "types"}))
    smap = build_schema_map(contract)
    b = effective_bindings(smap, None, default_canon_id=9)["document.entities[*]"]
    assert b.canon_id == 9


def test_schema_canon_id_used_when_run_declares_none():
    contract = doc(entities=roster(canon={"canon_id": 5, "inject": "types"}))
    smap = build_schema_map(contract)
    b = effective_bindings(smap, None, default_canon_id=9)["document.entities[*]"]
    assert b.canon_id == 5


def test_inactive_bindings_are_omitted():
    contract = doc(entities=roster(), plain={"type": "string"})
    smap = build_schema_map(contract)
    assert effective_bindings(smap, None, run_canon_ids=[1]) == {}


def test_binding_on_non_entity_field_is_ignored():
    contract = doc(topic={"type": "string", "x-canon": {"inject": "types"}})
    smap = build_schema_map(contract)
    assert effective_bindings(smap, None, run_canon_ids=[1]) == {}


def test_unknown_inject_mode_degrades_to_none():
    contract = doc(entities=roster(canon={"inject": "wat"}))
    smap = build_schema_map(contract)
    assert effective_bindings(smap, None, run_canon_ids=[1]) == {}


# ─── types ──────────────────────────────────────────────────────────────────


def test_types_injection_writes_enum_and_list(canon):
    contract = doc(entities=roster())
    out, report = _resolve(contract, {
        "document.entities[*]": CanonBinding(canon_id=canon, inject="types"),
    })
    tp = _carrier(out)["properties"]["type"]
    # Union of declared type_schemas keys and observed entry types, case-folded.
    assert set(tp["enum"]) == {"Politician", "Party", "Ghost"}
    assert tp["x-entityTypeList"] == tp["enum"]
    assert _carrier(out)["x-entityTypeConstrained"] is True
    assert report.injected_types == 3


def test_type_subset_narrows_the_list(canon):
    contract = doc(entities=roster())
    out, _ = _resolve(contract, {
        "document.entities[*]": CanonBinding(
            canon_id=canon, inject="types", types=("Politician",),
        ),
    })
    carrier = _carrier(out)
    assert carrier["properties"]["type"]["enum"] == ["Politician"]
    assert carrier["x-entityType"] == "Politician", "single type also sets the primary"


def test_declared_type_with_no_entries_is_still_offered(canon):
    """A canon may declare a type shape before any entry exists — constraining
    to it is the point on a fresh canon."""
    contract = doc(entities=roster())
    out, _ = _resolve(contract, {
        "document.entities[*]": CanonBinding(canon_id=canon, inject="types"),
    })
    assert "Ghost" in _carrier(out)["properties"]["type"]["enum"]


def test_input_contract_is_not_mutated(canon):
    contract = doc(entities=roster())
    before = copy_of = __import__("json").dumps(contract, sort_keys=True)
    _resolve(contract, {"document.entities[*]": CanonBinding(canon_id=canon, inject="types")})
    assert __import__("json").dumps(contract, sort_keys=True) == before


def test_no_active_bindings_returns_the_same_object(canon):
    contract = doc(entities=roster())
    out, report = _resolve(contract, {})
    assert out is contract, "an unbound run must pay nothing, not even a deepcopy"
    assert report.active is False


# ─── Type subsets ───────────────────────────────────────────────────────────


# ─── inject_properties ──────────────────────────────────────────────────────


def test_properties_injection_builds_a_nested_bag(canon):
    contract = doc(entities=roster())
    out, report = _resolve(contract, {
        "document.entities[*]": CanonBinding(
            canon_id=canon, type="Politician", types=("Politician",),
            inject="types", inject_properties=True,
        ),
    })
    bag = _carrier(out)["properties"]["properties"]
    assert bag["type"] == "object"
    assert set(bag["properties"]) == {"birthdate", "current_job", "terms_served"}
    assert bag["properties"]["birthdate"] == {
        "type": "string", "format": "date", "description": "ISO date of birth",
    }
    assert bag["properties"]["terms_served"]["type"] == "integer"
    assert report.fields[0].properties == ("birthdate", "current_job", "terms_served")


def test_injected_properties_are_addressable_by_schema_map(canon):
    """The bag has to be walkable, or GQL and the pickers can never see it."""
    contract = doc(entities=roster())
    out, _ = _resolve(contract, {
        "document.entities[*]": CanonBinding(
            canon_id=canon, types=("Politician",), inject="types", inject_properties=True,
        ),
    })
    paths = {n.path for n in build_schema_map(out).fields}
    assert "document.entities[*].properties.birthdate" in paths


def test_properties_union_across_a_multi_type_binding(canon):
    contract = doc(entities=roster())
    out, _ = _resolve(contract, {
        "document.entities[*]": CanonBinding(
            canon_id=canon, types=("Politician", "Party"),
            inject="types", inject_properties=True,
        ),
    })
    assert set(_carrier(out)["properties"]["properties"]["properties"]) == {
        "birthdate", "current_job", "terms_served", "founded", "website", "aliases_seen",
    }


def test_list_and_url_property_types_map(canon):
    contract = doc(entities=roster())
    out, _ = _resolve(contract, {
        "document.entities[*]": CanonBinding(
            canon_id=canon, types=("Party",), inject="types", inject_properties=True,
        ),
    })
    props = _carrier(out)["properties"]["properties"]["properties"]
    assert props["website"] == {"type": "string", "format": "uri"}
    assert props["aliases_seen"] == {"type": "array", "items": {"type": "string"}}


def test_properties_on_a_type_with_no_declared_shape_warns(canon):
    contract = doc(entities=roster())
    _, report = _resolve(contract, {
        "document.entities[*]": CanonBinding(
            canon_id=canon, types=("Ghost",), inject="types", inject_properties=True,
        ),
    })
    assert any("declares no" in w for w in report.warnings)


# ─── Scalar and nested entity fields ────────────────────────────────────────


def test_scalar_entity_field_resolves(canon):
    contract = doc(location=entity_obj("Party"))
    out, _ = _resolve(contract, {
        "document.location": CanonBinding(canon_id=canon, inject="types", types=("Party",)),
    })
    node = locate_node(out, "document.location")
    assert node["properties"]["type"]["enum"] == ["Party"]


def test_nested_row_entity_leaf_resolves(canon):
    contract = doc(observations={"type": "array", "items": {"type": "object", "properties": {
        "statement_by": entity_obj("Politician"),
        "claim": {"type": "string"},
    }}})
    out, _ = _resolve(contract, {
        "document.observations[*].statement_by": CanonBinding(
            canon_id=canon, inject="types", types=("Party",),
        ),
    })
    leaf = locate_node(out, "document.observations[*].statement_by")
    assert leaf["properties"]["type"]["enum"] == ["Party"]


# ─── Degradation ────────────────────────────────────────────────────────────


def test_binding_for_a_vanished_field_warns_and_continues(canon):
    contract = doc(entities=roster())
    out, report = _resolve(contract, {
        "document.entities[*]": CanonBinding(canon_id=canon, inject="types"),
        "document.gone[*]": CanonBinding(canon_id=canon, inject="types"),
    })
    assert any("no such field" in w for w in report.warnings)
    assert _carrier(out)["properties"]["type"]["enum"], "the valid binding still applied"


def test_binding_without_a_canon_is_skipped(canon):
    contract = doc(entities=roster())
    out, report = _resolve(contract, {
        "document.entities[*]": CanonBinding(canon_id=None, inject="types"),
    })
    assert out is contract
    assert report.active is False


# ─── resolve_for_run ────────────────────────────────────────────────────────


def test_resolve_for_run_end_to_end(canon, iid):
    """The entry point the annotate task and the preflight route share."""
    contract = doc(entities=roster(canon={"type": "Politician", "inject": "types"}))
    with Session(engine) as s:
        out, report = resolve_for_run(
            s, contract, schema_map_for(contract),
            run_bindings={"document.entities[*]": {"types": ["Party"]}},
            run_canon_ids=[canon],
            default_canon_id=None,
        )
    assert _carrier(out)["properties"]["type"]["enum"] == ["Party"]
    assert report.fields[0].canon_id == canon


def test_resolve_for_run_with_no_bindings_is_a_noop(iid):
    contract = doc(entities=roster())
    with Session(engine) as s:
        out, report = resolve_for_run(s, contract, schema_map_for(contract), run_canon_ids=[1])
    assert out is contract
    assert report.est_tokens_per_asset == 0


# ─── resolve_for_annotation_run (the annotate-task entry point) ──────────────


def _run(iid: int, user_id: int, *, canon_ids: list[int], bindings: dict | None = None):
    from app.api.modules.annotation.models import AnnotationRun
    with Session(engine) as s:
        r = AnnotationRun(
            name="B-run", infospace_id=iid, user_id=user_id, schema_ids=[],
            canon_ids=canon_ids,
            configuration={"canon_bindings": bindings} if bindings else {},
        )
        s.add(r)
        s.commit()
        s.refresh(r)
        return r.id


def test_resolve_for_annotation_run_reads_run_and_infospace(canon, iid, user_id):
    from app.api.modules.annotation.models import AnnotationRun
    from app.api.modules.annotation.contract_resolution import resolve_for_annotation_run

    run_id = _run(iid, user_id, canon_ids=[canon], bindings={
        "document.entities[*]": {"inject": "types", "types": ["Party"]},
    })
    contract = doc(entities=roster())
    with Session(engine) as s:
        out, report = resolve_for_annotation_run(s, s.get(AnnotationRun, run_id), contract)

    assert _carrier(out)["properties"]["type"]["enum"] == ["Party"]
    assert report.fields[0].inject == "types"


def test_resolve_for_annotation_run_without_bindings_is_a_noop(iid, user_id):
    from app.api.modules.annotation.models import AnnotationRun
    from app.api.modules.annotation.contract_resolution import resolve_for_annotation_run

    run_id = _run(iid, user_id, canon_ids=[])
    contract = doc(entities=roster())
    with Session(engine) as s:
        out, report = resolve_for_annotation_run(s, s.get(AnnotationRun, run_id), contract)
    assert out is contract
    assert report.active is False


def test_resolve_for_annotation_run_survives_a_stale_binding(canon, iid, user_id):
    """A binding pointing at a field the schema no longer has must warn, not
    break extraction."""
    from app.api.modules.annotation.models import AnnotationRun
    from app.api.modules.annotation.contract_resolution import resolve_for_annotation_run

    run_id = _run(iid, user_id, canon_ids=[canon], bindings={
        "document.renamed_away[*]": {"inject": "types"},
    })
    contract = doc(entities=roster())
    with Session(engine) as s:
        out, report = resolve_for_annotation_run(s, s.get(AnnotationRun, run_id), contract)
    assert any("no such field" in w for w in report.warnings)
    assert report.active is False


def test_resolve_for_annotation_run_survives_a_malformed_binding(canon, iid, user_id):
    """Garbage in the binding blob must not fail the run."""
    from app.api.modules.annotation.models import AnnotationRun
    from app.api.modules.annotation.contract_resolution import resolve_for_annotation_run

    run_id = _run(iid, user_id, canon_ids=[canon], bindings={
        "document.entities[*]": "not-a-dict",
    })
    contract = doc(entities=roster())
    with Session(engine) as s:
        out, report = resolve_for_annotation_run(s, s.get(AnnotationRun, run_id), contract)
    # Malformed override is ignored; the schema default (none here) applies.
    assert report.active is False


def test_run_override_on_a_non_entity_field_is_reported(canon, iid, user_id):
    """A hand- or LLM-written override aimed at the wrong field must surface.
    (A schema-side x-canon on a non-entity field stays silent — the editor
    doesn't offer it, so it isn't a mistake a user can make.)"""
    from app.api.modules.annotation.models import AnnotationRun
    from app.api.modules.annotation.contract_resolution import resolve_for_annotation_run

    run_id = _run(iid, user_id, canon_ids=[canon], bindings={
        "document.topic": {"inject": "types"},
    })
    contract = doc(entities=roster(), topic={"type": "string"})
    with Session(engine) as s:
        _out, report = resolve_for_annotation_run(s, s.get(AnnotationRun, run_id), contract)
    assert any("not an entity field" in w for w in report.warnings)


# ─── Preflight route ────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def bound_schema(iid, user_id):
    """A stored schema with a roster field, for the preflight route."""
    from app.api.modules.annotation.models import AnnotationSchema

    with Session(engine) as s:
        sch = AnnotationSchema(
            name="b-preflight-schema",
            output_contract=doc(entities=roster()),
            infospace_id=iid,
            user_id=user_id,
        )
        s.add(sch)
        s.commit()
        s.refresh(sch)
        return sch.id


def _preview(client, headers, iid, payload):
    from app.core.config import settings
    r = client.post(
        f"{settings.API_V1_STR}/infospaces/{iid}/runs/preview-bindings",
        headers=headers, json=payload,
    )
    assert r.status_code == 200, r.text[:400]
    return r.json()


def test_preflight_reports_zero_for_an_unbound_run(client, headers, iid, bound_schema):
    out = _preview(client, headers, iid, {"schema_ids": [bound_schema]})
    assert out["est_tokens_per_asset"] == 0
    assert out["blocking"] is False
    assert "unchanged" in out["summary"]


def test_preflight_counts_types_and_projects_total(client, headers, iid, bound_schema, canon):
    out = _preview(client, headers, iid, {
        "schema_ids": [bound_schema],
        "canon_ids": [canon],
        "canon_bindings": {"document.entities[*]": {"inject": "types", "types": ["Party"]}},
        "asset_count": 1000,
    })
    assert out["injected_types"] == 1          # Party
    assert out["est_tokens_per_asset"] > 0
    assert out["projected_total_tokens"] == out["est_tokens_per_asset"] * 1000
    assert "1,000 assets" in out["summary"]
    assert out["schemas"][0]["fields"][0]["path"] == "document.entities[*]"


def test_preflight_blocks_on_an_uncurated_type_list(client, headers, iid, bound_schema, user_id):
    """Many types means the canon is uncurated, not that the field admits that
    many kinds — the launch UI should ask before every prompt carries it."""
    from app.api.modules.annotation.contract_resolution import TYPES_COST_WARN
    with Session(engine) as s:
        big = Canon(infospace_id=iid, name="B preflight big", type_schemas={})
        s.add(big)
        s.commit()
        s.refresh(big)
        for i in range(TYPES_COST_WARN + 10):
            s.add(CanonEntry(infospace_id=iid, canon_id=big.id,
                             canonical=f"P{i:05d}", type=f"Type{i:03d}"))
        s.commit()
        big_id = big.id

    out = _preview(client, headers, iid, {
        "schema_ids": [bound_schema],
        "canon_ids": [big_id],
        "canon_bindings": {"document.entities[*]": {"inject": "types"}},
    })
    assert out["blocking"] is True
    assert out["injected_types"] > TYPES_COST_WARN


def test_preflight_surfaces_stale_binding_warnings(client, headers, iid, bound_schema, canon):
    out = _preview(client, headers, iid, {
        "schema_ids": [bound_schema],
        "canon_ids": [canon],
        "canon_bindings": {"document.gone[*]": {"inject": "types"}},
    })
    assert any("no such field" in w for w in out["warnings"])


def test_preflight_reports_a_missing_schema(client, headers, iid):
    out = _preview(client, headers, iid, {"schema_ids": [999999999]})
    assert any("not found" in w for w in out["warnings"])

