"""The run ledger, read through a package grant and with named rows."""
from __future__ import annotations

import types

from sqlalchemy import text

from app.api.modules.annotation import ledger
from app.api.modules.annotation.models import AnnotationRun
from app.tests.test_graph_stream import (  # noqa: F401 — fixtures
    _annotation, _asset, _infospace, _run, _schema_with, _user, db, pg_engine,
)

CONTRACT = {"type": "object", "properties": {"v": {"type": "string"}}}


def _world(db):
    uid = _user(db, "ledger")
    iid = _infospace(db, uid, "ledger")
    sid = _schema_with(db, iid, uid, CONTRACT)
    run_id = _run(db, iid, uid, "ledger")
    a, b, c = (_asset(db, iid, uid, n) for n in ("a", "b", "c"))
    _annotation(db, iid, uid, run_id, sid, a, {"v": "x"})
    db.execute(text("UPDATE annotationrun SET configuration = CAST(:c AS json) WHERE id = :r"),
               {"c": f'{{"target_asset_ids": [{a}, {b}, {c}]}}', "r": run_id})
    db.flush()
    run = db.get(AnnotationRun, run_id)
    db.refresh(run)
    return types.SimpleNamespace(db=db, run=run, a=a, b=b, c=c, iid=iid, uid=uid, sid=sid)


def test_a_package_reader_sees_no_queued_asset_it_was_not_shared(db):
    w = _world(db)
    full = ledger.summary(db, w.run)
    assert (full.in_scope, full.queued, full.annotated) == (3, 2, 1)
    shared = types.SimpleNamespace(asset_ids=(w.a,), bundle_ids=())
    seen = ledger.summary(db, w.run, package=shared)
    assert (seen.in_scope, seen.queued) == (1, 0)
    assert ledger.assets(db, w.run, "queued", package=shared).items == []
    assert [i.id for i in ledger.assets(db, w.run, "annotated", package=shared).items] == [w.a]


def test_a_run_that_named_rows_reads_their_documents(db):
    w = _world(db)
    row = _asset(db, w.iid, w.uid, "row")
    db.execute(text("UPDATE asset SET parent_asset_id = :p WHERE id = :r"), {"p": w.b, "r": row})
    db.execute(text("UPDATE annotationrun SET configuration = CAST(:c AS json) WHERE id = :r"),
               {"c": f'{{"target_asset_ids": [{row}]}}', "r": w.run.id})
    db.flush()
    db.refresh(w.run)
    s = ledger.summary(db, w.run)
    # The row's document is in scope — not zero, as it was when only roots named outright counted.
    assert s.in_scope == 1 and s.queued == 1
