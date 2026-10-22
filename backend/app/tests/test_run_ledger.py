"""The run ledger's scope count, batched — what the runs list shows per run.

``in_scope_counts`` counts a whole page of runs in one statement; ``summary``
counts one run through ``run_scope_clause``. They must agree for every shape a
scope can take, or the list and the run page tell two stories.
"""
from __future__ import annotations

from sqlalchemy import text

from app.api.modules.annotation import ledger
from app.api.modules.annotation.models import AnnotationRun, RunStatus
from app.tests.test_live_runs import (  # noqa: F401 — fixtures
    _asset,
    _bundle,
    _infospace,
    _user,
    db,
    pg_engine,
)


def _run(db, iid: int, uid: int, name: str, *, source_bundle_id=None, configuration=None) -> AnnotationRun:
    run = AnnotationRun(
        name=name, infospace_id=iid, user_id=uid, status=RunStatus.COMPLETED,
        live=source_bundle_id is not None, source_bundle_id=source_bundle_id,
        configuration=configuration or {},
    )
    db.add(run)
    db.flush()
    return run


def test_counts_agree_with_summary_across_scope_shapes(db):
    uid = _user(db, "ledger_counts")
    iid = _infospace(db, uid, "ledger_counts")
    parent = _bundle(db, iid, uid, "parent")
    child = _bundle(db, iid, uid, "child", parent=parent)
    other = _bundle(db, iid, uid, "other")
    empty = _bundle(db, iid, uid, "empty")

    top = _asset(db, iid, uid, "top", [parent])
    _asset(db, iid, uid, "sub", [child])
    both = _asset(db, iid, uid, "both", [parent, other])
    _asset(db, iid, uid, "o", [other])
    loose = _asset(db, iid, uid, "loose", [9999])
    # A part (CSV row, PDF page) is counted through its root, never itself.
    db.execute(
        text("UPDATE asset SET parent_asset_id = :p WHERE id = :c"),
        {"p": top, "c": _asset(db, iid, uid, "row", [parent])},
    )

    runs = {
        "subtree": _run(db, iid, uid, "subtree", source_bundle_id=parent),
        "multi": _run(db, iid, uid, "multi", configuration={"source_bundle_ids": [parent, other]}),
        "nested_roots": _run(db, iid, uid, "nested", configuration={"source_bundle_ids": [parent, child]}),
        "one_off": _run(db, iid, uid, "one_off", configuration={"target_bundle_id": other}),
        "union": _run(db, iid, uid, "union", source_bundle_id=other, configuration={"target_asset_ids": [loose, both]}),
        "explicit": _run(db, iid, uid, "explicit", configuration={"target_asset_ids": [top, loose]}),
        "empty": _run(db, iid, uid, "empty", source_bundle_id=empty),
        "unscoped": _run(db, iid, uid, "unscoped"),
    }

    counts = ledger.in_scope_counts(db, list(runs.values()))

    assert {k: counts.get(r.id) for k, r in runs.items()} == {
        "subtree": 3,       # top, sub, both — not the row
        "multi": 4,         # + o; `both` once
        "nested_roots": 3,  # a root inside another root's subtree adds nothing
        "one_off": 2,       # both, o
        "union": 3,         # both, o, loose
        "explicit": 2,
        "empty": 0,         # scoped, just nothing there yet
        "unscoped": None,   # no scope of its own
    }
    for run in runs.values():
        assert counts.get(run.id) == ledger.summary(db, run).in_scope, run.name


def test_no_runs_no_query(db):
    assert ledger.in_scope_counts(db, []) == {}
