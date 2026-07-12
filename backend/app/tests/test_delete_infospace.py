"""
Functional test: InfospaceService.delete_infospace cascades cleanly.

Guards the bug class that left ghost infospaces behind. The delete must remove
the children that previously broke it — not just the easy ones:

  * collaborators      — DB ON DELETE CASCADE (the old ORM NULLed a NOT NULL FK)
  * a source pointing  — source.output_bundle_id is NO ACTION; the old service
    at an output bundle   deleted the bundle before the source and hit the FK
  * an entity with an  — entityeditlog.entity_id is NO ACTION and blocked the
    edit log              entity cascade entirely

delete_infospace commits, so this uses a plain (committing) session and tears
down best-effort if an assertion trips before the delete runs.

Requires Postgres (via docker compose).
"""
import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.core.config import settings
from app.api.modules.identity_infospace_user.services.infospace_service import InfospaceService
from app.schemas import InfospaceCreate


@pytest.fixture(scope="module")
def engine():
    return create_engine(str(settings.SQLALCHEMY_DATABASE_URI), echo=False)


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s


def _count(session, sql, **params):
    return session.execute(text(sql), params).scalar()


def test_delete_infospace_full_cascade(session):
    uid = _count(session, 'SELECT id FROM "user" WHERE email = :e', e=settings.FIRST_SUPERUSER)
    assert uid, "superuser must exist"
    svc = InfospaceService(session=session, settings=settings, storage_provider=None)

    isp = svc.create_infospace(uid, InfospaceCreate(name="Delete Cascade Test", owner_id=uid))
    iid, canon_id = isp.id, isp.default_canon_id

    try:
        # collaborator — relies on DB cascade (old code NULLed the NOT NULL FK)
        session.execute(text(
            "INSERT INTO infospacecollaborator (infospace_id, user_id, role, invited_at) "
            "VALUES (:iid, :uid, 'EDITOR', now())"), {"iid": iid, "uid": uid})

        # bundle + source referencing it via output_bundle_id (ordering bug)
        bid = _count(session,
            "INSERT INTO bundle (name, infospace_id, user_id, parent_bundle_id, sealed, asset_count, "
            "child_bundle_count, version, uuid, tags, created_at, updated_at) "
            "VALUES ('b', :iid, :uid, 0, false, 0, 0, '1.0', gen_random_uuid()::text, '[]'::json, now(), now()) "
            "RETURNING id", iid=iid, uid=uid)
        session.execute(text(
            "INSERT INTO source (uuid, name, kind, status, is_active, poll_interval_seconds, items_last_poll, "
            "total_items_ingested, consecutive_failures, output_bundle_id, infospace_id, user_id, created_at, updated_at) "
            "VALUES (gen_random_uuid()::text, 's', 'rss', 'ACTIVE', true, 300, 0, 0, 0, :obid, :iid, :uid, now(), now())"),
            {"obid": bid, "iid": iid, "uid": uid})

        # a plain asset
        session.execute(text(
            "INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, uuid, processing_status, stub, "
            "created_at, updated_at) VALUES ('a', 'ARTICLE', :iid, :uid, ARRAY[0]::int[], gen_random_uuid()::text, "
            "'READY', false, now(), now())"), {"iid": iid, "uid": uid})

        # entry + edit log — entityeditlog blocked the canon_entry DB-cascade
        eid = _count(session,
            "INSERT INTO canon_entry (infospace_id, canon_id, canonical, type, uuid, created_at, updated_at) "
            "VALUES (:iid, :cid, 'Acme', 'ORG', gen_random_uuid()::text, now(), now()) RETURNING id",
            iid=iid, cid=canon_id)
        session.execute(text(
            "INSERT INTO entityeditlog (entry_id, action, performed_by) VALUES (:eid, 'merge', 'test')"),
            {"eid": eid})
        session.commit()

        # sanity — the hard children are really there
        assert _count(session, "SELECT count(*) FROM infospacecollaborator WHERE infospace_id=:i", i=iid) == 1
        assert _count(session, "SELECT count(*) FROM entityeditlog WHERE entry_id=:e", e=eid) == 1

        # act
        assert svc.delete_infospace(iid, uid) is True

        # assert — infospace and every dependent row are gone
        assert _count(session, "SELECT count(*) FROM infospace WHERE id=:i", i=iid) == 0
        for table in ("infospacecollaborator", "source", "bundle", "asset", "canon_entry", "canon"):
            assert _count(session, f"SELECT count(*) FROM {table} WHERE infospace_id=:i", i=iid) == 0, table
        assert _count(session, "SELECT count(*) FROM entityeditlog WHERE entry_id=:e", e=eid) == 0
    finally:
        # best-effort cleanup if the delete never ran
        session.rollback()
        if _count(session, "SELECT count(*) FROM infospace WHERE id=:i", i=iid):
            try:
                svc.delete_infospace(iid, uid)
            except Exception:
                session.rollback()
