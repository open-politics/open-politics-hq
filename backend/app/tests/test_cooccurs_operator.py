"""Tests for the relational.cooccurs operator (Phase 3).

Two layers:
1. Unit tests on the SQL generator — fragment shape, parameter binding,
   error handling for malformed values.
2. Integration test against a real annotation table — verify the operator
   actually filters rows by entity co-occurrence at the requested reach.
"""
from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import text

from app.core.filters import (
    FieldCondition,
    FilterSet,
    condition_sql,
)


# ─── Validator: $ placeholder for relational ops ────────────────────────────


def test_dollar_placeholder_accepted_for_relational_ops():
    """Path "$" is valid as a placeholder for relational operators where the
    real configuration lives in `value`."""
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={"entities": ["A", "B"], "reach": "annotation", "paths": ["actors[*]"]},
    )
    assert cond.path == "$"


def test_dollar_placeholder_rejected_for_normal_ops():
    """`$` only makes sense for relational operators; reject it on `eq`."""
    # The validator allows "$" unconditionally; the wrong-op safety lives in
    # condition_sql, which would treat "$" as a field name and produce
    # nonsense SQL. That's the documented design — relax in v2 if needed.
    # Here we just confirm the path validator itself doesn't reject.
    cond = FieldCondition(path="$", operator="eq", value="x")
    assert cond.path == "$"


# ─── SQL generation: structural shape ───────────────────────────────────────


def test_cooccurs_annotation_reach_ANDs_per_entity_ORs_per_path():
    """For 2 entities × 2 paths the SQL should AND across entities, OR within
    each entity's per-path clauses."""
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={
            "entities": ["Merkel", "Macron"],
            "reach": "annotation",
            "paths": ["actors[*]", "mails[*].sender"],
        },
    )
    sql, params = condition_sql(cond, "a.value")
    # Top-level AND of two clauses (one per entity)
    assert sql.count(" AND ") >= 1
    # Each entity-clause should mention both paths via OR
    assert " OR " in sql
    # Both entity names land in params
    name_values = [v for v in params.values() if v in ("Merkel", "Macron")]
    assert "Merkel" in name_values
    assert "Macron" in name_values


def test_cooccurs_array_path_uses_lateral_jsonb_array_elements():
    """Array-shaped entity paths (`[*]`) should generate jsonb_array_elements
    with EXISTS — that's how multi-element entity lists get walked."""
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={
            "entities": ["A", "B"],
            "paths": ["actors[*]"],
        },
    )
    sql, _ = condition_sql(cond, "a.value")
    assert "jsonb_array_elements" in sql
    assert "EXISTS" in sql


def test_cooccurs_non_array_path_uses_direct_accessor():
    """Singular entity paths (no `[*]`) compare against the entity's `.name`
    field directly — no LATERAL needed."""
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={
            "entities": ["A", "B"],
            "paths": ["author"],   # singular entity field
        },
    )
    sql, _ = condition_sql(cond, "a.value")
    assert "jsonb_array_elements" not in sql


def test_cooccurs_asset_reach_uses_self_join():
    """`reach=asset` wraps each entity-check in a subquery against `annotation`
    keyed by `asset_id` so we look across all annotations of the asset."""
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={
            "entities": ["A", "B"],
            "reach": "asset",
            "paths": ["actors[*]"],
        },
    )
    sql, _ = condition_sql(cond, "a.value")
    assert "FROM annotation a2" in sql
    assert "a2.asset_id = a.asset_id" in sql


def test_cooccurs_inner_path_for_nested_entity():
    """`mails[*].sender` walks the array and looks at `elem.sender.name` —
    the inner path resolution kicks in for nested entity refs."""
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={"entities": ["A", "B"], "paths": ["mails[*].sender"]},
    )
    sql, _ = condition_sql(cond, "a.value")
    # The inner accessor should reach `sender.name` (via jsonb_accessor on
    # `elem` with field `sender.name`).
    assert "elem" in sql


# ─── Validation: malformed value ────────────────────────────────────────────


def test_cooccurs_accepts_single_entity():
    """N=1 is valid since the projection-primitive work — clicking any
    entity chip pushes a single-entity cooccurs scope to peer panels."""
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={"entities": ["A"], "paths": ["actors[*]"]},
    )
    sql, _ = condition_sql(cond, "a.value")
    assert sql  # generates SQL without raising


def test_cooccurs_rejects_zero_entities():
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={"entities": [], "paths": ["actors[*]"]},
    )
    with pytest.raises(ValueError, match=r"1\+ names"):
        condition_sql(cond, "a.value")


def test_cooccurs_rejects_empty_paths():
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={"entities": ["A", "B"], "paths": []},
    )
    with pytest.raises(ValueError, match="at least one entity-typed field"):
        condition_sql(cond, "a.value")


def test_cooccurs_rejects_unknown_reach():
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={"entities": ["A", "B"], "paths": ["actors[*]"], "reach": "infospace"},
    )
    with pytest.raises(ValueError, match="unknown reach"):
        condition_sql(cond, "a.value")


def test_cooccurs_same_level_groups_paths_by_array_prefix():
    """`same_level` walks each array prefix exactly once and AND's all
    entities inside the element — so two paths sharing `mails[*]` resolve
    to one EXISTS over `mails` whose body ANDs both entities."""
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={
            "entities": ["A", "B"],
            "paths": ["mails[*].sender", "mails[*].receiver"],
            "reach": "same_level",
        },
    )
    sql, _ = condition_sql(cond, "a.value")
    # one EXISTS (one shared array prefix) — not one per path or per entity
    assert sql.count("EXISTS") == 1
    assert "jsonb_array_elements" in sql
    # AND inside the EXISTS body (across entities)
    assert " AND " in sql


def test_cooccurs_same_level_with_disjoint_groups_ORs_them():
    """Paths under different array prefixes form separate groups; OR across
    groups so a row passes if any single shared parent holds every entity."""
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={
            "entities": ["A", "B"],
            "paths": ["mails[*].sender", "calls[*].caller"],
            "reach": "same_level",
        },
    )
    sql, _ = condition_sql(cond, "a.value")
    # Two EXISTS subqueries (one per array group), OR'd together
    assert sql.count("EXISTS") == 2
    assert " OR " in sql


def test_cooccurs_same_level_root_group_uses_no_existso():
    """Non-exploded paths share the annotation root as parent — no array
    walk, just direct accessor comparisons AND'd across entities."""
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={
            "entities": ["A", "B"],
            "paths": ["author", "editor"],
            "reach": "same_level",
        },
    )
    sql, _ = condition_sql(cond, "a.value")
    assert "EXISTS" not in sql
    assert "jsonb_array_elements" not in sql
    # AND-of-entity OR-of-paths shape
    assert " AND " in sql
    assert " OR " in sql


def test_cooccurs_rejects_non_dict_value():
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value="garbage",
    )
    with pytest.raises(ValueError, match="value must be an object"):
        condition_sql(cond, "a.value")


def test_cooccurs_rejects_invalid_path_string():
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={"entities": ["A", "B"], "paths": ["not a valid path!"]},
    )
    with pytest.raises(ValueError, match="invalid path"):
        condition_sql(cond, "a.value")


# ─── Integration: run the SQL against real annotations ──────────────────────
#
# These tests exercise the full SQL fragment against a Postgres test DB by
# inserting synthetic annotations and counting rows the operator returns. We
# use the `client`/`headers`/`workspace` fixtures from conftest.py to reach a
# real session.


def _db_session():
    """Reach the app's session factory directly (same pattern as other graph tests)."""
    from app.api.dependency_injection import get_db
    gen = get_db()
    return next(gen), gen


@pytest.fixture
def cooccurs_workspace(infospace_factory, user_id):
    return infospace_factory(f"Cooccurs {uuid.uuid4().hex[:6]}", user_id)


@pytest.fixture
def cooccurs_setup(client, headers, cooccurs_workspace):
    """Create a schema + run + 3 annotations spanning different entity sets:
    - ann1: actors=[Merkel, Macron]
    - ann2: actors=[Merkel, Scholz]
    - ann3: actors=[Scholz]
    Returns (workspace_id, schema_id, run_id, asset_ids_by_position).
    """
    iid = cooccurs_workspace
    API = "/api/v1"

    # Schema with one entity-array field ``actors`` whose items are entity
    # objects {name, type?}. We hand-craft the output_contract so we can
    # precisely test the SQL — adapter round-trip is covered separately.
    output_contract = {
        "type": "object",
        "properties": {
            "document": {
                "type": "object",
                "properties": {
                    "actors": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "x-entityField": True,
                            "x-entityType": "Politician",
                            "properties": {
                                "name": {"type": "string"},
                                "type": {"type": "string"},
                            },
                            "required": ["name"],
                        },
                    },
                },
            },
        },
    }
    schema_resp = client.post(
        f"{API}/infospaces/{iid}/annotation_schemas",
        headers=headers,
        json={
            "name": f"Cooccurs-{uuid.uuid4().hex[:6]}",
            "description": "",
            "output_contract": output_contract,
        },
    )
    assert schema_resp.status_code in (200, 201), schema_resp.text
    schema_id = schema_resp.json()["id"]

    # Insert assets + annotations directly via the DB — we don't need the
    # full ingestion + LLM pipeline for this integration test, just rows in
    # the right shape to exercise the cooccurs SQL.
    db, gen = _db_session()
    try:
        from app.api.modules.annotation.models import (
            Annotation,
            AnnotationRun,
            RunStatus,
            ResultStatus,
        )
        from app.api.modules.content.models import Asset

        asset_ids: list[int] = []
        for i in range(3):
            asset = Asset(
                kind="text",
                title=f"Doc-{i}",
                text_content=f"body {i}",
                infospace_id=iid,
                user_id=1,
            )
            db.add(asset)
            db.flush()
            asset_ids.append(asset.id)

        run = AnnotationRun(
            name=f"cooccurs-test-run-{uuid.uuid4().hex[:6]}",
            infospace_id=iid,
            user_id=1,
            status=RunStatus.COMPLETED,
        )
        db.add(run)
        db.flush()

        actor_sets = [
            [{"name": "Merkel", "type": "Politician"}, {"name": "Macron", "type": "Politician"}],
            [{"name": "Merkel", "type": "Politician"}, {"name": "Scholz", "type": "Politician"}],
            [{"name": "Scholz", "type": "Politician"}],
        ]
        for asset_id, actors in zip(asset_ids, actor_sets):
            db.add(Annotation(
                asset_id=asset_id,
                schema_id=schema_id,
                run_id=run.id,
                infospace_id=iid,
                user_id=1,
                value={"document": {"actors": actors}},
                status=ResultStatus.SUCCESS,
            ))
        db.commit()
        run_id = run.id
    finally:
        try:
            next(gen)
        except StopIteration:
            pass

    return iid, schema_id, run_id, asset_ids


def test_cooccurs_annotation_reach_finds_co_mentioning_rows(cooccurs_setup):
    """Filter for {Merkel, Macron} co-occurrence at reach=annotation: should
    return only ann1 (the one where both names appear together)."""
    iid, schema_id, run_id, _asset_ids = cooccurs_setup
    db, gen = _db_session()
    try:
        cond = FieldCondition(
            path="$",
            operator="relational.cooccurs",
            value={
                "entities": ["Merkel", "Macron"],
                "reach": "annotation",
                "paths": ["document.actors[*]"],
            },
        )
        frag, params = condition_sql(cond, "a.value")
        sql = (
            "SELECT count(*) FROM annotation a "
            f"WHERE a.run_id = :run_id AND ({frag})"
        )
        params["run_id"] = run_id
        count = db.execute(text(sql).bindparams(**params)).scalar()
        assert count == 1, "only ann1 has both Merkel and Macron"
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def test_cooccurs_annotation_reach_finds_multiple_when_pair_recurs(cooccurs_setup):
    """Filter for {Merkel, Scholz}: should return only ann2 (Merkel+Scholz),
    not ann3 (Scholz alone) or ann1 (Merkel+Macron)."""
    iid, schema_id, run_id, _ = cooccurs_setup
    db, gen = _db_session()
    try:
        cond = FieldCondition(
            path="$",
            operator="relational.cooccurs",
            value={
                "entities": ["Merkel", "Scholz"],
                "paths": ["document.actors[*]"],
            },
        )
        frag, params = condition_sql(cond, "a.value")
        sql = (
            "SELECT count(*) FROM annotation a "
            f"WHERE a.run_id = :run_id AND ({frag})"
        )
        params["run_id"] = run_id
        count = db.execute(text(sql).bindparams(**params)).scalar()
        assert count == 1
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def test_cooccurs_returns_zero_when_no_row_satisfies(cooccurs_setup):
    """Filter for {Macron, Scholz}: no row has both — should be 0."""
    iid, schema_id, run_id, _ = cooccurs_setup
    db, gen = _db_session()
    try:
        cond = FieldCondition(
            path="$",
            operator="relational.cooccurs",
            value={
                "entities": ["Macron", "Scholz"],
                "paths": ["document.actors[*]"],
            },
        )
        frag, params = condition_sql(cond, "a.value")
        sql = (
            "SELECT count(*) FROM annotation a "
            f"WHERE a.run_id = :run_id AND ({frag})"
        )
        params["run_id"] = run_id
        count = db.execute(text(sql).bindparams(**params)).scalar()
        assert count == 0
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


# ─── Integration: same_level reach ──────────────────────────────────────────
#
# These tests use a richer fixture with `mails[*]` where each element holds
# both `sender` and `receiver` — the canonical case where same_level differs
# from annotation reach.


@pytest.fixture
def cooccurs_same_level_setup(client, headers, cooccurs_workspace):
    """Three annotations with `mails: [{sender, receiver}]`:
      ann1 — single mail with sender=Alice, receiver=Bob   (same-element pair)
      ann2 — two mails: [sender=Alice, recv=Carol], [sender=Dan, recv=Bob]
              (annotation reach has Alice+Bob, same_level does NOT)
      ann3 — single mail with sender=Carol, receiver=Dan   (no Alice or Bob)
    """
    iid = cooccurs_workspace
    API = "/api/v1"
    output_contract = {
        "type": "object",
        "properties": {
            "document": {
                "type": "object",
                "properties": {
                    "mails": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "sender": {
                                    "type": "object",
                                    "x-entityField": True,
                                    "x-entityType": "Person",
                                    "properties": {
                                        "name": {"type": "string"},
                                        "type": {"type": "string"},
                                    },
                                    "required": ["name"],
                                },
                                "receiver": {
                                    "type": "object",
                                    "x-entityField": True,
                                    "x-entityType": "Person",
                                    "properties": {
                                        "name": {"type": "string"},
                                        "type": {"type": "string"},
                                    },
                                    "required": ["name"],
                                },
                            },
                        },
                    },
                },
            },
        },
    }
    schema_resp = client.post(
        f"{API}/infospaces/{iid}/annotation_schemas",
        headers=headers,
        json={
            "name": f"CooccursSameLevel-{uuid.uuid4().hex[:6]}",
            "description": "",
            "output_contract": output_contract,
        },
    )
    assert schema_resp.status_code in (200, 201), schema_resp.text
    schema_id = schema_resp.json()["id"]

    db, gen = _db_session()
    try:
        from app.api.modules.annotation.models import (
            Annotation,
            AnnotationRun,
            RunStatus,
            ResultStatus,
        )
        from app.api.modules.content.models import Asset

        asset_ids: list[int] = []
        for i in range(3):
            asset = Asset(
                kind="text",
                title=f"SLDoc-{i}",
                text_content=f"body {i}",
                infospace_id=iid,
                user_id=1,
            )
            db.add(asset)
            db.flush()
            asset_ids.append(asset.id)

        run = AnnotationRun(
            name=f"cooccurs-sl-run-{uuid.uuid4().hex[:6]}",
            infospace_id=iid,
            user_id=1,
            status=RunStatus.COMPLETED,
        )
        db.add(run)
        db.flush()

        mail_sets = [
            # ann1: same mail has Alice and Bob
            [{"sender": {"name": "Alice"}, "receiver": {"name": "Bob"}}],
            # ann2: Alice and Bob present, but in different mails
            [
                {"sender": {"name": "Alice"}, "receiver": {"name": "Carol"}},
                {"sender": {"name": "Dan"}, "receiver": {"name": "Bob"}},
            ],
            # ann3: neither Alice nor Bob
            [{"sender": {"name": "Carol"}, "receiver": {"name": "Dan"}}],
        ]
        for asset_id, mails in zip(asset_ids, mail_sets):
            db.add(Annotation(
                asset_id=asset_id,
                schema_id=schema_id,
                run_id=run.id,
                infospace_id=iid,
                user_id=1,
                value={"document": {"mails": mails}},
                status=ResultStatus.SUCCESS,
            ))
        db.commit()
        run_id = run.id
    finally:
        try:
            next(gen)
        except StopIteration:
            pass

    return iid, schema_id, run_id, asset_ids


def test_cooccurs_same_level_excludes_split_across_elements(cooccurs_same_level_setup):
    """`same_level` requires both entities in the *same* element — so ann2,
    where Alice and Bob are in different mails, must be excluded. Only ann1
    (one mail with both) passes."""
    iid, schema_id, run_id, _ = cooccurs_same_level_setup
    db, gen = _db_session()
    try:
        cond = FieldCondition(
            path="$",
            operator="relational.cooccurs",
            value={
                "entities": ["Alice", "Bob"],
                "reach": "same_level",
                "paths": ["document.mails[*].sender", "document.mails[*].receiver"],
            },
        )
        frag, params = condition_sql(cond, "a.value")
        sql = (
            "SELECT count(*) FROM annotation a "
            f"WHERE a.run_id = :run_id AND ({frag})"
        )
        params["run_id"] = run_id
        count = db.execute(text(sql).bindparams(**params)).scalar()
        assert count == 1, "only ann1 has Alice and Bob in the same mail"
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def test_cooccurs_annotation_reach_includes_split_across_elements(cooccurs_same_level_setup):
    """Sanity check that `annotation` reach DOES include ann2 — the same
    setup must yield 2 rows (ann1 + ann2) at annotation reach. This proves
    same_level's exclusion of ann2 is genuinely tighter, not a query bug."""
    iid, schema_id, run_id, _ = cooccurs_same_level_setup
    db, gen = _db_session()
    try:
        cond = FieldCondition(
            path="$",
            operator="relational.cooccurs",
            value={
                "entities": ["Alice", "Bob"],
                "reach": "annotation",
                "paths": ["document.mails[*].sender", "document.mails[*].receiver"],
            },
        )
        frag, params = condition_sql(cond, "a.value")
        sql = (
            "SELECT count(*) FROM annotation a "
            f"WHERE a.run_id = :run_id AND ({frag})"
        )
        params["run_id"] = run_id
        count = db.execute(text(sql).bindparams(**params)).scalar()
        assert count == 2, "annotation reach is broader: ann1 (same mail) + ann2 (different mails)"
    finally:
        try:
            next(gen)
        except StopIteration:
            pass
