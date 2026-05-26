"""DB-backed correctness for ``AnnotationQuery.relation`` — the new bits.

Covers behaviours that the pure ``test_formula_compile`` cannot prove:

- Default ORDER BY: first non-derive measure DESC (no time dim) / time ASC
  (with time dim).
- Explicit ``Formula.order_by`` override on a measure or a derive (post-eval
  Python sort).
- ``distribution + sum/mean/etc`` decomposes into two queries and merges by
  group key (one OutputRelation back to the caller).
- Composition keyed on a derive name (output_keys can reference measures /
  derives, not just dim names).
- Composition rejects an evidence-mode source (raw rows have no measures).

Runs in a transaction-scoped session — no DB pollution.
"""

from __future__ import annotations

import json
import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.formula import (
    Dimension,
    Formula,
    Measure,
    OrderBy,
    SnippetBinding,
)
from app.api.modules.annotation.formulas import attach_formula_lookup
from app.api.modules.annotation.query import AnnotationQuery


# ─── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def pg_engine():
    from app.core.config import settings
    return create_engine(str(settings.SQLALCHEMY_DATABASE_URI), echo=False)


@pytest.fixture
def db(pg_engine):
    connection = pg_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


def _user(db, suffix: str) -> int:
    return int(db.execute(
        text(
            "INSERT INTO \"user\" (email, hashed_password, is_active, is_superuser, "
            "email_verified, full_name, created_at, updated_at) "
            "VALUES (:email, 'x', true, false, true, 'Test', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"email": f"rel_{suffix}@t.local"},
    ).scalar())


def _infospace(db, uid: int, name: str) -> int:
    return int(db.execute(
        text(
            "INSERT INTO infospace (name, owner_id, uuid, created_at) "
            "VALUES (:n, :u, gen_random_uuid()::text, now()) RETURNING id"
        ),
        {"n": name, "u": uid},
    ).scalar())


def _schema(db, iid: int, uid: int, name: str) -> int:
    return int(db.execute(
        text(
            "INSERT INTO annotationschema (name, description, output_contract, instructions, "
            "infospace_id, user_id, version, is_active, uuid, created_at, updated_at) "
            "VALUES (:n, 'd', '{}'::jsonb, 'i', :iid, :uid, '1.0', true, "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"n": name, "iid": iid, "uid": uid},
    ).scalar())


def _run(db, iid: int, uid: int, name: str) -> int:
    return int(db.execute(
        text(
            "INSERT INTO annotationrun (name, description, configuration, "
            "infospace_id, user_id, status, uuid, created_at, updated_at, "
            "include_parent_context, context_window, trigger_type, run_type, "
            "follow_on_version_change) "
            "VALUES (:n, 'd', '{}'::jsonb, :iid, :uid, 'PENDING', "
            "gen_random_uuid()::text, now(), now(), false, 0, 'MANUAL', 'ONE_OFF', false) "
            "RETURNING id"
        ),
        {"n": name, "iid": iid, "uid": uid},
    ).scalar())


def _asset(db, iid: int, uid: int, title: str) -> int:
    return int(db.execute(
        text(
            "INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, "
            "uuid, processing_status, stub, created_at, updated_at) "
            "VALUES (:t, 'ARTICLE', :iid, :uid, CAST(ARRAY[]::int[] AS int[]), "
            "gen_random_uuid()::text, 'READY', false, now(), now()) RETURNING id"
        ),
        {"t": title, "iid": iid, "uid": uid},
    ).scalar())


def _annotation(db, iid: int, uid: int, run_id: int, schema_id: int, asset_id: int, value: dict) -> int:
    return int(db.execute(
        text(
            "INSERT INTO annotation (run_id, schema_id, asset_id, value, status, "
            "infospace_id, user_id, timestamp, uuid, created_at, updated_at) "
            "VALUES (:r, :s, :a, CAST(:v AS jsonb), 'SUCCESS', :iid, :uid, now(), "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {
            "r": run_id, "s": schema_id, "a": asset_id,
            "v": json.dumps(value), "iid": iid, "uid": uid,
        },
    ).scalar())


@pytest.fixture
def fx(db):
    """Tiny fixture: one run, six annotations, three categories with mixed scores."""
    uid = _user(db, "fx")
    iid = _infospace(db, uid, "relation_test")
    sid = _schema(db, iid, uid, "s")
    rid = _run(db, iid, uid, "r")

    rows = [
        ("cats", "A", 4.0),
        ("cats", "A", 6.0),
        ("cats", "B", 8.0),
        ("dogs", "A", 2.0),
        ("dogs", "A", 5.0),
        ("dogs", "B", 9.0),
    ]
    for title, cat, score in rows:
        aid = _asset(db, iid, uid, title)
        _annotation(
            db, iid, uid, rid, sid, aid,
            {"category": cat, "score": score, "kind": title},
        )

    return {"iid": iid, "uid": uid, "sid": sid, "rid": rid}


# ─── Tests ─────────────────────────────────────────────────────────────────


def test_default_order_by_is_first_measure_desc_when_no_time(db, fx):
    """Pies/bars want biggest-first. Default ORDER BY = first measure DESC."""
    f = Formula(
        id="f1",
        name="by_cat",
        group=[Dimension(name="cat", kind="field", path="category")],
        measures=[Measure(name="n", agg="count")],
    )
    aq = AnnotationQuery(db, fx["iid"]).runs([fx["rid"]])
    rel = aq.relation(f)
    assert [r.keys["cat"] for r in rel.rows] == ["A", "B"]  # A=4, B=2 → A first
    assert rel.rows[0].measures["n"] == 4
    assert rel.rows[1].measures["n"] == 2


def test_order_by_explicit_measure_asc(db, fx):
    """Authoring an explicit order_by overrides the default."""
    f = Formula(
        id="f2",
        name="by_cat_asc",
        group=[Dimension(name="cat", kind="field", path="category")],
        measures=[Measure(name="n", agg="count")],
        order_by=OrderBy(column="n", direction="asc"),
    )
    rel = AnnotationQuery(db, fx["iid"]).runs([fx["rid"]]).relation(f)
    assert [r.measures["n"] for r in rel.rows] == [2, 4]


def test_order_by_derive_post_eval_sort(db, fx):
    """order_by on a derive defers to a post-eval Python sort."""
    f = Formula(
        id="f3",
        name="rate_by_cat",
        group=[Dimension(name="cat", kind="field", path="category")],
        measures=[Measure(name="n", agg="count"), Measure(name="sumsc", path="score", agg="sum")],
        derives=[
            # average = sum / count — descending by avg
            {"name": "avg", "expr": "sumsc / n"},
        ],
        order_by=OrderBy(column="avg", direction="desc"),
    )
    rel = AnnotationQuery(db, fx["iid"]).runs([fx["rid"]]).relation(f)
    avgs = [r.measures["avg"] for r in rel.rows]
    assert avgs == sorted(avgs, reverse=True)


def test_distribution_decomposition_merges_with_sum(db, fx):
    """A formula that mixes distribution + sum produces one OutputRelation
    with both columns on each row, keyed by the shared dim."""
    f = Formula(
        id="f4",
        name="mix",
        group=[Dimension(name="cat", kind="field", path="category")],
        measures=[
            Measure(name="mix_kind", path="kind", agg="distribution"),
            Measure(name="total", path="score", agg="sum"),
        ],
    )
    rel = AnnotationQuery(db, fx["iid"]).runs([fx["rid"]]).relation(f)
    by_cat = {r.keys["cat"]: r.measures for r in rel.rows}

    # Both categories present.
    assert set(by_cat.keys()) == {"A", "B"}

    # Distribution side: counts per kind.
    assert by_cat["A"]["mix_kind"] == {"cats": 2, "dogs": 2}
    assert by_cat["B"]["mix_kind"] == {"cats": 1, "dogs": 1}

    # Aggregate side: sum of scores.
    assert by_cat["A"]["total"] == pytest.approx(4.0 + 6.0 + 2.0 + 5.0)
    assert by_cat["B"]["total"] == pytest.approx(8.0 + 9.0)


def test_composition_lookup_keys_on_derive(db, fx):
    """When ``output_keys`` names a derive, composition still resolves
    against the post-eval relation."""
    base = Formula(
        id="b",
        name="by_cat_base",
        group=[Dimension(name="cat", kind="field", path="category")],
        measures=[Measure(name="n", agg="count"), Measure(name="sumsc", path="score", agg="sum")],
        derives=[{"name": "bucket", "expr": "1 if (sumsc / n) > 5 else 0"}],
        output_keys=["bucket"],
    )

    aq = AnnotationQuery(db, fx["iid"]).runs([fx["rid"]])
    # Persist the base formula on a synthetic dashboard so attach_formula_lookup
    # can find it. (resolve_formula reads from dashboard_config.formulas[].)
    dashboard = {"formulas": [base.model_dump(mode="json")]}
    attach_formula_lookup(aq, dashboard)

    # Probe the lookup directly — simulating what a composing formula would do.
    lookup = aq._formula_lookup
    # bucket=1 row corresponds to category B (2 annotations, avg=8.5 > 5);
    # bucket=0 row corresponds to category A (4 annotations, avg=4.25 ≤ 5).
    # The lookup keys off the derive value (bucket), reading any column
    # (here n) from the post-derive row.
    val_high = lookup.lookup("by_cat_base", (1,), "n")
    val_low = lookup.lookup("by_cat_base", (0,), "n")
    assert val_high == 2  # B has 2 annotations
    assert val_low == 4   # A has 4 annotations


def test_composition_rejects_evidence_mode_source(db, fx):
    """Composing onto an evidence-mode source (snippet or top measure) is a
    foot-gun — evidence rows carry no aggregated measures."""
    evidence_formula = Formula(
        id="e",
        name="evidence_src",
        group=[Dimension(name="cat", kind="field", path="category")],
        measures=[Measure(name="ev", agg="top", top_n=3, top_by="score")],
    )
    aq = AnnotationQuery(db, fx["iid"]).runs([fx["rid"]])
    dashboard = {"formulas": [evidence_formula.model_dump(mode="json")]}
    attach_formula_lookup(aq, dashboard)

    with pytest.raises(ValueError, match="evidence mode"):
        aq._formula_lookup.lookup("evidence_src", ("A",), "ev")


def test_relation_can_be_called_twice_on_same_aq(db, fx):
    """State save/restore: a second relation() call on the same AQ doesn't
    compound the formula's conditions or merge_maps."""
    f = Formula(
        id="f7",
        name="byc",
        group=[Dimension(name="cat", kind="field", path="category")],
        measures=[Measure(name="n", agg="count")],
    )
    aq = AnnotationQuery(db, fx["iid"]).runs([fx["rid"]])
    rel1 = aq.relation(f)
    rel2 = aq.relation(f)
    assert [r.measures["n"] for r in rel1.rows] == [r.measures["n"] for r in rel2.rows]


def test_zero_dim_count_collapses_to_single_scalar(db, fx):
    """No group dims → one row with the aggregate over the whole filtered
    relation. Postgres rejects ``GROUP BY 1`` on an aggregate, so the engine
    must omit the GROUP BY clause entirely."""
    f = Formula(
        id="fzd",
        name="total",
        measures=[Measure(name="n", agg="count")],
    )
    aq = AnnotationQuery(db, fx["iid"]).runs([fx["rid"]])
    rel = aq.relation(f)
    assert len(rel.rows) == 1
    assert rel.rows[0].keys == {}
    # Fixture inserts six annotations.
    assert rel.rows[0].measures["n"] == 6.0


def test_zero_dim_sum_and_mean(db, fx):
    """Zero-dim with sum + mean produces one row with both measures and no
    spurious group expression."""
    f = Formula(
        id="fzdm",
        name="totals",
        measures=[
            Measure(name="total_score", path="score", agg="sum"),
            Measure(name="avg_score", path="score", agg="mean"),
        ],
    )
    rel = AnnotationQuery(db, fx["iid"]).runs([fx["rid"]]).relation(f)
    assert len(rel.rows) == 1
    assert rel.rows[0].keys == {}
    assert rel.rows[0].measures["total_score"] == pytest.approx(4 + 6 + 8 + 2 + 5 + 9)
    assert rel.rows[0].measures["avg_score"] == pytest.approx((4 + 6 + 8 + 2 + 5 + 9) / 6)


# ─── Multi-level explosion ──────────────────────────────────────────────────


@pytest.fixture
def mail_fx(db):
    """A run with nested mail data — each annotation carries ``mails[*]``
    where each mail has a sender and a list of recipients[*]. Tests the
    LATERAL ladder."""
    uid = _user(db, "mfx")
    iid = _infospace(db, uid, "mail_relation_test")
    sid = _schema(db, iid, uid, "mail_schema")
    rid = _run(db, iid, uid, "mail_run")

    docs = [
        {
            "mails": [
                {"sender": "alice", "recipients": ["bob", "carol"]},
                {"sender": "bob",   "recipients": ["alice"]},
            ],
        },
        {
            "mails": [
                {"sender": "alice", "recipients": ["dave"]},
                {"sender": "carol", "recipients": ["alice", "bob"]},
            ],
        },
    ]
    for i, doc in enumerate(docs):
        aid = _asset(db, iid, uid, f"mail_doc_{i}")
        _annotation(db, iid, uid, rid, sid, aid, doc)

    return {"iid": iid, "uid": uid, "sid": sid, "rid": rid}


def test_multilevel_explosion_inner_array(db, mail_fx):
    """Group by an inner-array field — recipients[*] is exploded inside
    each mails[*]. Total recipient-mentions = 6 across the two docs."""
    f = Formula(
        id="m1",
        name="by_recipient",
        group=[Dimension(name="recipient", kind="entity", path="mails[*].recipients[*]")],
        measures=[Measure(name="n", agg="count")],
    )
    rel = AnnotationQuery(db, mail_fx["iid"]).runs([mail_fx["rid"]]).relation(f)
    by_r = {r.keys["recipient"]: r.measures["n"] for r in rel.rows}
    # Doc1: bob, carol, alice. Doc2: dave, alice, bob.
    assert by_r["alice"] == 2
    assert by_r["bob"] == 2
    assert by_r["carol"] == 1
    assert by_r["dave"] == 1


def test_multilevel_sender_recipient_pair(db, mail_fx):
    """Cross-product within a mail — sender × recipients[*] per email.
    The shared outer LATERAL ``mails[*]`` binds both dims, so this is
    NOT a Cartesian across annotations — each pair is one recipient on
    one mail, the sender just rides along."""
    f = Formula(
        id="m2",
        name="pairs",
        group=[
            Dimension(name="sender", kind="entity", path="mails[*].sender"),
            Dimension(name="recipient", kind="entity", path="mails[*].recipients[*]"),
        ],
        measures=[Measure(name="n", agg="count")],
    )
    rel = AnnotationQuery(db, mail_fx["iid"]).runs([mail_fx["rid"]]).relation(f)
    pairs = {(r.keys["sender"], r.keys["recipient"]): r.measures["n"] for r in rel.rows}
    # Doc1: alice→bob, alice→carol, bob→alice
    # Doc2: alice→dave, carol→alice, carol→bob
    assert pairs[("alice", "bob")] == 1
    assert pairs[("alice", "carol")] == 1
    assert pairs[("alice", "dave")] == 1
    assert pairs[("bob", "alice")] == 1
    assert pairs[("carol", "alice")] == 1
    assert pairs[("carol", "bob")] == 1


def test_multilevel_outer_only_dim_still_one_lateral(db, mail_fx):
    """A dim that only explodes the outer array doesn't trigger the inner
    LATERAL — the engine only builds LATERALs that paths actually reach."""
    f = Formula(
        id="m3",
        name="by_sender",
        group=[Dimension(name="sender", kind="entity", path="mails[*].sender")],
        measures=[Measure(name="n", agg="count")],
    )
    rel = AnnotationQuery(db, mail_fx["iid"]).runs([mail_fx["rid"]]).relation(f)
    by_s = {r.keys["sender"]: r.measures["n"] for r in rel.rows}
    # Senders: alice×2 (doc1+doc2), bob×1 (doc1), carol×1 (doc2).
    assert by_s == {"alice": 2, "bob": 1, "carol": 1}


def test_disjoint_outer_arrays_raise_cartesian_error(db, mail_fx):
    """Two dims on different OUTER arrays would Cartesian — engine rejects
    explicitly at tree-build time (no silent multiplication)."""
    f = Formula(
        id="m4",
        name="cartesian",
        group=[
            Dimension(name="sender", kind="entity", path="mails[*].sender"),
            Dimension(name="speaker", kind="entity", path="calls[*].speaker"),
        ],
        measures=[Measure(name="n", agg="count")],
    )
    with pytest.raises(ValueError, match="conflict at depth 0"):
        AnnotationQuery(db, mail_fx["iid"]).runs([mail_fx["rid"]]).relation(f)
