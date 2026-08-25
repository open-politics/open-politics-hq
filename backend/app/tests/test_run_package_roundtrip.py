"""Run package round-trip — does a run reconstitute EXACTLY on another instance?

The requirement these tests encode is narrow and absolute: export a run from one
infospace, import it into another, and the second one should be indistinguishable
from the first. Not "mostly there" — the failure modes that motivated this work
are all partial successes that look like successes:

- a container whose annotated child came across but whose siblings did not,
- a file that arrived with no text and no processing queued to derive it,
- text that arrived while the file did not,
- an asset renamed to an id or an intermediary name somewhere in the pipe,
- chunks written into the package and never read back,
- bundles flattened to the infospace root.

Each test below pins one of those. They build fixtures straight against Postgres
(the models use JSONB / int[] / pgvector, which SQLite cannot host) and drive the
real ``PackageBuilder`` / ``PackageImporter``.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session, select

from app.models import (
    Annotation, AnnotationRun, AnnotationSchema, Asset, AssetKind, Bundle,
    ProcessingStatus, ResourceType, RunStatus,
)
from app.api.modules.content.models import AssetChunk
from app.api.modules.sharing.services.package_service import (
    DataPackage, PackageBuilder, PackageImporter,
)


# ─── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def pg_engine():
    from app.core.config import settings
    return create_engine(str(settings.SQLALCHEMY_DATABASE_URI), echo=False)


@pytest.fixture
def committed_db(pg_engine):
    """A session that really commits, for tests that also drive HTTP.

    The rolled-back ``db`` fixture is invisible to the TestClient (different
    connection), so anything the API has to read must be committed. Cleanup
    rides on ``infospace_factory``, which deletes the infospace — and its
    contents — on module teardown.
    """
    with Session(pg_engine) as session:
        yield session


@pytest.fixture
def db(pg_engine):
    """A transaction rolled back after each test — no fixture residue."""
    connection = pg_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


class _NullStorage:
    """Storage stand-in.

    Blob fidelity has its own dedicated test below; everywhere else these
    fixtures use text-only assets, and a builder with no storage would take a
    different branch than production does. This keeps the production branch
    while holding the bytes in memory.
    """

    def __init__(self):
        self.blobs: dict[str, bytes] = {}

    async def get_file(self, path: str):
        import io
        if path not in self.blobs:
            raise FileNotFoundError(path)
        return io.BytesIO(self.blobs[path])

    async def upload_from_bytes(self, data: bytes, path: str, filename: str | None = None):
        self.blobs[path] = data
        return path


@pytest.fixture
def wire_storage(client):
    """Point the API's own storage provider at the in-memory double.

    The wire tests have to exercise the ZIP branch: a package is only written as
    a zip when at least one asset carries blob bytes, and every real run does.
    Without this the seeded run is text-only, the exporter takes the bare-JSON
    branch, and the test proves nothing about the format the dashboard button
    actually downloads. The route resolves storage through DI, so that is where
    the double belongs — both the export and the import share it, which also
    lets the import assert the bytes landed on the far side.
    """
    from app.main import app
    from app.api.dependency_injection import get_storage_provider_dependency

    storage = _NullStorage()
    app.dependency_overrides[get_storage_provider_dependency] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage_provider_dependency, None)


def _user(db) -> int:
    return int(db.execute(
        text(
            'INSERT INTO "user" (email, hashed_password, is_active, is_superuser, '
            "email_verified, full_name, created_at, updated_at) "
            "VALUES (:email, 'x', true, false, true, 'Test', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"email": "pkg_roundtrip@t.local"},
    ).scalar())


def _infospace(db, uid: int, name: str) -> int:
    return int(db.execute(
        text(
            "INSERT INTO infospace (name, owner_id, uuid, created_at) "
            "VALUES (:n, :u, gen_random_uuid()::text, now()) RETURNING id"
        ),
        {"n": name, "u": uid},
    ).scalar())


@pytest.fixture
def world(db):
    """A source infospace holding one realistic run.

    Shape chosen to exercise every gap at once::

        bundle "Case Files"  (parent)
          └── bundle "Filings"
                └── report.pdf          (container, 3 pages, ONLY page 2 annotated)
                      ├── page 1
                      ├── page 2  ← annotated
                      └── page 3
        standalone note.txt             ← annotated, chunked, tagged
    """
    uid = _user(db)
    src_iid = _infospace(db, uid, "pkg_roundtrip_source")
    dst_iid = _infospace(db, uid, "pkg_roundtrip_target")

    parent_bundle = Bundle(
        name="Case Files", description="outer", infospace_id=src_iid, user_id=uid,
        parent_bundle_id=0, tags=["case"],
    )
    db.add(parent_bundle)
    db.flush()
    child_bundle = Bundle(
        name="Filings", description="inner", infospace_id=src_iid, user_id=uid,
        parent_bundle_id=parent_bundle.id,
    )
    db.add(child_bundle)
    db.flush()

    report = Asset(
        title="Q3 Financial Report.pdf", kind=AssetKind.PDF, infospace_id=src_iid,
        user_id=uid, text_content="full report text", bundle_ids=[child_bundle.id],
        processing_status=ProcessingStatus.READY, modalities=["text"],
        tags=["financial"], file_info={"original_filename": "Q3 Financial Report.pdf"},
        fragments={"pages": 3},
    )
    db.add(report)
    db.flush()

    pages = []
    for i in range(1, 4):
        page = Asset(
            title=f"Q3 Financial Report.pdf - page {i}", kind=AssetKind.TEXT,
            infospace_id=src_iid, user_id=uid, parent_asset_id=report.id, part_index=i,
            text_content=f"page {i} body", bundle_ids=[child_bundle.id],
            processing_status=ProcessingStatus.READY,
        )
        db.add(page)
        pages.append(page)
    db.flush()

    note = Asset(
        title="Anonymous Tip — 2024-03-11", kind=AssetKind.TEXT, infospace_id=src_iid,
        user_id=uid, text_content="the tip body", bundle_ids=[parent_bundle.id],
        processing_status=ProcessingStatus.READY, tags=["tip", "unverified"],
        modalities=["text"], facets={"language": "en"},
    )
    db.add(note)
    db.flush()

    db.add(AssetChunk(asset_id=note.id, chunk_index=0, text_content="the tip", chunk_metadata={"n": 1}))
    db.add(AssetChunk(asset_id=note.id, chunk_index=1, text_content="body", chunk_metadata={"n": 2}))
    db.flush()

    schema = AnnotationSchema(
        name="Tip Triage", description="d", output_contract={"type": "object"},
        instructions="i", infospace_id=src_iid, user_id=uid, version="1.0",
    )
    db.add(schema)
    db.flush()

    run = AnnotationRun(
        name="March Triage", description="the run description", infospace_id=src_iid,
        user_id=uid, status=RunStatus.COMPLETED, configuration={"model": "x"},
        views_config=[{"panels": [{"id": "p1", "type": "table"}], "name": "Board"}],
        graph_config={"projections": [{"path": "document.observations[*]"}]},
        tags=["triage", "q3"], is_favorite=True,
    )
    run.target_schemas = [schema]
    db.add(run)
    db.flush()

    # Only page 2 and the note are annotated — pages 1 and 3 must still travel.
    for asset in (pages[1], note):
        db.add(Annotation(
            asset_id=asset.id, schema_id=schema.id, run_id=run.id,
            infospace_id=src_iid, user_id=uid, value={"verdict": "follow up"},
        ))
    db.flush()

    return {
        "uid": uid, "src_iid": src_iid, "dst_iid": dst_iid, "run": run,
        "report": report, "pages": pages, "note": note, "schema": schema,
        "parent_bundle": parent_bundle, "child_bundle": child_bundle,
    }


async def _roundtrip(db, world, storage=None, via_zip: bool = False, **build_kwargs) -> AnnotationRun:
    """Export the fixture run and import it into the target infospace.

    ``via_zip`` routes through a real ZIP on disk — ``to_zip`` → ``from_zip`` —
    which is what actually crosses between two instances. Serialization only
    fails on that path (the manifest is JSON, so datetimes, enums and UUIDs all
    have to survive a stringify/parse), so the fidelity assertions are worth
    running both ways.
    """
    storage = storage or _NullStorage()
    builder = PackageBuilder(session=db, storage_provider=storage, source_instance_id="src")
    package = await builder.build_annotation_run_package(world["run"], **build_kwargs)

    if via_zip:
        import tempfile, os
        fd, zip_path = tempfile.mkstemp(suffix=".zip")
        os.close(fd)
        try:
            package.to_zip(zip_path)
            assert os.path.getsize(zip_path) > 0, "export produced an empty zip"
            package = DataPackage.from_zip(zip_path)
        finally:
            if os.path.exists(zip_path):
                os.unlink(zip_path)

    importer = PackageImporter(
        session=db, storage_provider=storage,
        target_infospace_id=world["dst_iid"], target_user_id=world["uid"], settings=None,
    )
    return await importer.import_annotation_run_package(package)


def _imported_assets(db, dst_iid: int) -> dict[str, Asset]:
    assets = db.exec(select(Asset).where(Asset.infospace_id == dst_iid)).all()
    return {a.title: a for a in assets}


# ─── Tests ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_complete_asset_tree_travels_not_just_annotated_assets(db, world):
    """Annotating page 2 exports the whole PDF, all three pages included.

    The old exporter collected annotated assets plus their DIRECT parents, so
    pages 1 and 3 were dropped and the importing instance received a container
    whose children were a lie.
    """
    await _roundtrip(db, world)
    titles = set(_imported_assets(db, world["dst_iid"]))

    assert "Q3 Financial Report.pdf" in titles
    for i in range(1, 4):
        assert f"Q3 Financial Report.pdf - page {i}" in titles, f"page {i} missing from the tree"


@pytest.mark.asyncio
async def test_titles_are_preserved_exactly(db, world):
    """No ids, no intermediary names, no secure_filename mangling.

    Titles carry spaces, an em dash and a dot-extension precisely because those
    are what a sanitizer would eat.
    """
    await _roundtrip(db, world)
    titles = set(_imported_assets(db, world["dst_iid"]))

    assert "Q3 Financial Report.pdf" in titles
    assert "Anonymous Tip — 2024-03-11" in titles
    assert not any(t.startswith("Imported Asset") for t in titles)


@pytest.mark.asyncio
async def test_asset_fields_survive_the_trip(db, world):
    """modalities / fragments / tags / facets / processing_status all carry.

    The importer used to write 12 fields and drop the rest, so an imported
    asset silently lost its modalities and arrived claiming READY regardless.
    """
    await _roundtrip(db, world)
    by_title = _imported_assets(db, world["dst_iid"])

    note = by_title["Anonymous Tip — 2024-03-11"]
    assert sorted(note.tags) == ["tip", "unverified"]
    assert note.modalities == ["text"]
    assert note.facets == {"language": "en"}
    assert note.processing_status == ProcessingStatus.READY

    report = by_title["Q3 Financial Report.pdf"]
    assert report.fragments == {"pages": 3}
    assert report.tags == ["financial"]


@pytest.mark.asyncio
async def test_parent_child_structure_is_rebuilt(db, world):
    """Pages hang off the imported report, ordered, not orphaned at the root."""
    await _roundtrip(db, world)
    by_title = _imported_assets(db, world["dst_iid"])
    report = by_title["Q3 Financial Report.pdf"]

    children = db.exec(
        select(Asset).where(Asset.parent_asset_id == report.id).order_by(Asset.part_index)
    ).all()
    assert [c.part_index for c in children] == [1, 2, 3]
    assert [c.text_content for c in children] == ["page 1 body", "page 2 body", "page 3 body"]


@pytest.mark.asyncio
async def test_bundles_are_recreated_with_their_tree(db, world):
    """Assets land in their bundles, and the bundle nesting survives."""
    await _roundtrip(db, world)
    dst_iid = world["dst_iid"]

    bundles = {b.name: b for b in db.exec(select(Bundle).where(Bundle.infospace_id == dst_iid)).all()}
    assert "Case Files" in bundles
    assert "Filings" in bundles
    assert bundles["Filings"].parent_bundle_id == bundles["Case Files"].id
    assert bundles["Case Files"].parent_bundle_id == 0

    by_title = _imported_assets(db, dst_iid)
    assert bundles["Filings"].id in by_title["Q3 Financial Report.pdf"].bundle_ids
    assert bundles["Case Files"].id in by_title["Anonymous Tip — 2024-03-11"].bundle_ids


@pytest.mark.asyncio
async def test_chunks_round_trip(db, world):
    """Chunks were exported and never read back — every import lost search."""
    await _roundtrip(db, world)
    by_title = _imported_assets(db, world["dst_iid"])
    note = by_title["Anonymous Tip — 2024-03-11"]

    chunks = db.exec(
        select(AssetChunk).where(AssetChunk.asset_id == note.id).order_by(AssetChunk.chunk_index)
    ).all()
    assert [c.text_content for c in chunks] == ["the tip", "body"]
    assert [c.chunk_metadata for c in chunks] == [{"n": 1}, {"n": 2}]


@pytest.mark.asyncio
async def test_run_fields_survive_the_trip(db, world):
    """description / graph_config / tags / is_favorite / views_config all carry."""
    imported = await _roundtrip(db, world)

    assert imported.description == "the run description"
    assert imported.graph_config == {"projections": [{"path": "document.observations[*]"}]}
    assert sorted(imported.tags) == ["q3", "triage"]
    assert imported.is_favorite is True
    assert imported.views_config, "the dashboard must travel"
    assert imported.views_config[0]["panels"][0]["type"] == "table"
    # A run that was watching a source has nothing to watch here.
    assert imported.live is False


@pytest.mark.asyncio
async def test_annotations_relink_to_the_right_assets(db, world):
    """Annotations point at the imported assets, not the originals."""
    imported = await _roundtrip(db, world)
    by_title = _imported_assets(db, world["dst_iid"])

    annotations = db.exec(select(Annotation).where(Annotation.run_id == imported.id)).all()
    assert len(annotations) == 2

    annotated_ids = {a.asset_id for a in annotations}
    assert annotated_ids == {
        by_title["Q3 Financial Report.pdf - page 2"].id,
        by_title["Anonymous Tip — 2024-03-11"].id,
    }
    for ann in annotations:
        assert ann.infospace_id == world["dst_iid"]
        assert ann.value == {"verdict": "follow up"}


@pytest.mark.asyncio
async def test_complete_assets_are_not_reprocessed(db, world):
    """The default is: import verbatim, re-derive nothing.

    Re-processing would mint new children with new UUIDs while the imported
    annotations still reference the originals — orphans plus duplicates.
    """
    await _roundtrip(db, world)
    imported = _imported_assets(db, world["dst_iid"]).values()

    assert all(a.processing_status != ProcessingStatus.PENDING for a in imported), \
        "nothing that arrived complete should be queued for processing"


@pytest.mark.asyncio
async def test_blob_without_text_is_queued_for_repair(db, world):
    """The one case that DOES re-process: file arrived, text did not.

    Such an asset is incomplete either way, and it has no children for a
    re-derive to duplicate, so processing it is a repair rather than divergence.
    """
    storage = _NullStorage()
    storage.blobs["src/scan.pdf"] = b"%PDF-1.4 fake"

    orphan = Asset(
        title="Unprocessed Scan.pdf", kind=AssetKind.PDF, infospace_id=world["src_iid"],
        user_id=world["uid"], blob_path="src/scan.pdf", text_content=None,
        bundle_ids=[0], processing_status=ProcessingStatus.READY,
        file_info={"original_filename": "Unprocessed Scan.pdf"},
    )
    db.add(orphan)
    db.flush()
    db.add(Annotation(
        asset_id=orphan.id, schema_id=world["schema"].id, run_id=world["run"].id,
        infospace_id=world["src_iid"], user_id=world["uid"], value={"verdict": "x"},
    ))
    db.flush()

    await _roundtrip(db, world, storage=storage)
    by_title = _imported_assets(db, world["dst_iid"])
    scan = by_title["Unprocessed Scan.pdf"]

    assert scan.blob_path, "the file itself must have come across"
    assert scan.processing_status == ProcessingStatus.PENDING, \
        "a blob with no derived content must be queued to derive it"
    # And the complete assets around it are still untouched.
    assert by_title["Anonymous Tip — 2024-03-11"].processing_status == ProcessingStatus.READY


# ─── Through a real ZIP — the path that actually crosses instances ──────────


@pytest.mark.asyncio
async def test_full_fidelity_survives_a_real_zip(db, world):
    """The whole fidelity contract, re-asserted through ``to_zip``/``from_zip``.

    Everything above drives the builder and importer in-process, where Python
    objects pass straight across. A real transfer serializes the manifest to
    JSON and back, so datetimes become strings, enums become their values and
    UUIDs become text. This is the test that would catch a package that builds
    fine and imports as garbage.
    """
    imported = await _roundtrip(db, world, via_zip=True)
    by_title = _imported_assets(db, world["dst_iid"])

    # Tree completeness
    for i in range(1, 4):
        assert f"Q3 Financial Report.pdf - page {i}" in by_title
    # Titles verbatim, em dash and all
    assert "Anonymous Tip — 2024-03-11" in by_title
    # Asset fields
    note = by_title["Anonymous Tip — 2024-03-11"]
    assert sorted(note.tags) == ["tip", "unverified"]
    assert note.modalities == ["text"]
    assert note.processing_status == ProcessingStatus.READY
    assert note.kind == AssetKind.TEXT, "enum must survive JSON as its value, not 'AssetKind.TEXT'"
    # Structure
    report = by_title["Q3 Financial Report.pdf"]
    assert report.fragments == {"pages": 3}
    children = db.exec(select(Asset).where(Asset.parent_asset_id == report.id)).all()
    assert len(children) == 3
    # Bundles
    bundles = {b.name: b for b in db.exec(select(Bundle).where(Bundle.infospace_id == world["dst_iid"])).all()}
    assert bundles["Filings"].parent_bundle_id == bundles["Case Files"].id
    # Chunks
    chunks = db.exec(
        select(AssetChunk).where(AssetChunk.asset_id == note.id).order_by(AssetChunk.chunk_index)
    ).all()
    assert [c.text_content for c in chunks] == ["the tip", "body"]
    # Run fields + timestamps (datetimes went through isoformat and back)
    assert imported.description == "the run description"
    assert imported.graph_config == {"projections": [{"path": "document.observations[*]"}]}
    assert sorted(imported.tags) == ["q3", "triage"]
    assert imported.status == RunStatus.COMPLETED
    assert imported.created_at is not None
    # Annotations relinked
    annotations = db.exec(select(Annotation).where(Annotation.run_id == imported.id)).all()
    assert len(annotations) == 2
    assert {a.asset_id for a in annotations} == {
        by_title["Q3 Financial Report.pdf - page 2"].id,
        note.id,
    }


@pytest.mark.asyncio
async def test_blob_bytes_survive_the_zip_and_keep_their_filename(db, world):
    """The file itself makes the trip, byte-identical, under its real name.

    Blobs travel in the zip's ``files/`` directory rather than the manifest, so
    this is a separate mechanism from everything above — and the one that would
    silently degrade to "asset exists, file does not".
    """
    storage = _NullStorage()
    payload = b"%PDF-1.4 the actual bytes \x00\x01\x02 binary safe"
    storage.blobs["src/evidence.pdf"] = payload

    exhibit = Asset(
        title="Exhibit A — Signed Contract.pdf", kind=AssetKind.PDF,
        infospace_id=world["src_iid"], user_id=world["uid"],
        blob_path="src/evidence.pdf", text_content="contract text",
        bundle_ids=[0], processing_status=ProcessingStatus.READY,
        file_info={"original_filename": "Exhibit A — Signed Contract.pdf", "mime_type": "application/pdf"},
    )
    db.add(exhibit)
    db.flush()
    db.add(Annotation(
        asset_id=exhibit.id, schema_id=world["schema"].id, run_id=world["run"].id,
        infospace_id=world["src_iid"], user_id=world["uid"], value={"signed": True},
    ))
    db.flush()

    await _roundtrip(db, world, storage=storage, via_zip=True)
    imported = _imported_assets(db, world["dst_iid"])["Exhibit A — Signed Contract.pdf"]

    assert imported.blob_path, "the asset must point at a stored blob"
    assert imported.blob_path != "src/evidence.pdf", "it should be re-stored locally, not aliased"
    assert storage.blobs[imported.blob_path] == payload, "bytes must be identical"
    # The human-facing name is the title and file_info, never the storage key.
    assert imported.title == "Exhibit A — Signed Contract.pdf"
    assert imported.file_info.get("original_filename") == "Exhibit A — Signed Contract.pdf"
    # And it has text, so nothing queues it for a needless re-process.
    assert imported.text_content == "contract text"
    assert imported.processing_status == ProcessingStatus.READY


@pytest.mark.asyncio
async def test_reimporting_the_same_package_yields_a_second_complete_copy(db, world):
    """Importing the same package twice gives two complete runs, not one and a husk.

    ``imported_from_uuid`` is the SOURCE instance's id, so it is only unique
    over there. The dedup that keys off it used to be unscoped, which meant the
    second import found the first import's annotations, skipped all of them, and
    produced an EMPTY run beside a full set of duplicated assets — and the same
    suppression fired across infospaces, so importing one package into two
    workspaces left the second with no annotations at all.

    Assets carry no durable provenance column, so cross-import reuse is not
    available; two copies is the coherent contract, and each copy is whole.
    """
    first = await _roundtrip(db, world, via_zip=True)
    first_annotations = db.exec(select(Annotation).where(Annotation.run_id == first.id)).all()
    assert len(first_annotations) == 2

    second = await _roundtrip(db, world, via_zip=True)
    second_annotations = db.exec(select(Annotation).where(Annotation.run_id == second.id)).all()

    assert second.id != first.id, "a second import is a second run"
    assert len(second_annotations) == 2, (
        "the second copy must carry its own annotations, not be suppressed by "
        f"the first import's; got {len(second_annotations)}"
    )
    # And the second run's annotations point at the second run's own assets.
    second_asset_ids = {a.asset_id for a in second_annotations}
    first_asset_ids = {a.asset_id for a in first_annotations}
    assert not (second_asset_ids & first_asset_ids), "copies must not cross-link"


@pytest.mark.asyncio
async def test_importing_the_same_package_into_two_infospaces_keeps_both_whole(db, world):
    """The cross-infospace case, stated on its own because it is the dangerous one.

    A shared package will routinely be imported into several workspaces. Each
    must arrive complete.
    """
    uid = world["uid"]
    third_iid = _infospace(db, uid, "pkg_roundtrip_third")

    first = await _roundtrip(db, world, via_zip=True)
    assert len(db.exec(select(Annotation).where(Annotation.run_id == first.id)).all()) == 2

    storage = _NullStorage()
    builder = PackageBuilder(session=db, storage_provider=storage, source_instance_id="src")
    package = await builder.build_annotation_run_package(world["run"])
    importer = PackageImporter(
        session=db, storage_provider=storage,
        target_infospace_id=third_iid, target_user_id=uid, settings=None,
    )
    third = await importer.import_annotation_run_package(package)

    third_annotations = db.exec(select(Annotation).where(Annotation.run_id == third.id)).all()
    assert len(third_annotations) == 2, (
        "a package already imported elsewhere must still import completely here; "
        f"got {len(third_annotations)}"
    )
    assert all(a.infospace_id == third_iid for a in third_annotations)


@pytest.mark.asyncio
async def test_no_asset_arrives_with_a_file_but_no_text_and_no_plan(db, world):
    """The invariant, stated directly.

    Every imported asset either carries its derived content, or has children
    that do, or is queued to derive it. There is no fourth state — that fourth
    state is the bug this whole exercise exists to remove.
    """
    storage = _NullStorage()
    storage.blobs["src/scan.pdf"] = b"%PDF-1.4 fake"
    orphan = Asset(
        title="Unprocessed Scan.pdf", kind=AssetKind.PDF, infospace_id=world["src_iid"],
        user_id=world["uid"], blob_path="src/scan.pdf", bundle_ids=[0],
        file_info={"original_filename": "Unprocessed Scan.pdf"},
    )
    db.add(orphan)
    db.flush()
    db.add(Annotation(
        asset_id=orphan.id, schema_id=world["schema"].id, run_id=world["run"].id,
        infospace_id=world["src_iid"], user_id=world["uid"], value={"v": 1},
    ))
    db.flush()

    await _roundtrip(db, world, storage=storage)

    for asset in _imported_assets(db, world["dst_iid"]).values():
        has_text = bool(asset.text_content)
        has_children = db.exec(
            select(Asset.id).where(Asset.parent_asset_id == asset.id).limit(1)
        ).first() is not None
        queued = asset.processing_status == ProcessingStatus.PENDING
        assert has_text or has_children or queued, (
            f"'{asset.title}' arrived with no text, no children and no processing queued"
        )


@pytest.mark.asyncio
async def test_an_unreadable_blob_is_counted_and_lands_flagged(db, world):
    """Storage failing to serve a file must not produce a clean-looking package.

    This is the failure that motivated the census: a run whose blobs had moved
    exported with HTTP 200, every fetch silently returning ``None``, and imported
    "successfully" with the documents simply absent. The per-asset flag was being
    written and read by nobody.

    An asset in that state is still worth importing — its text, chunks and
    annotations are intact, so the graph reassembles — but it arrives FAILED with
    a reason, never READY.
    """
    storage = _NullStorage()  # deliberately empty: every fetch misses
    scan = Asset(
        title="Rotted Scan.pdf", kind=AssetKind.PDF, infospace_id=world["src_iid"],
        user_id=world["uid"], blob_path="src/gone.pdf", text_content="scanned text",
        bundle_ids=[0], file_info={"original_filename": "Rotted Scan.pdf"},
        processing_status=ProcessingStatus.READY,
    )
    db.add(scan)
    db.flush()
    db.add(Annotation(
        asset_id=scan.id, schema_id=world["schema"].id, run_id=world["run"].id,
        infospace_id=world["src_iid"], user_id=world["uid"], value={"v": 1},
    ))
    db.flush()

    builder = PackageBuilder(session=db, storage_provider=storage, source_instance_id="src")
    package = await builder.build_annotation_run_package(world["run"])

    expected, missing = package.blob_census()
    assert (expected, missing) == (1, 1), (
        f"census must see the unreadable blob, got expected={expected} missing={missing}"
    )
    # And it survives the download — the fold reads the manifest, not the build.
    import tempfile, os, json
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        with open(path, "w") as f:
            json.dump({"metadata": package.metadata.to_dict(), "content": package.content},
                      f, default=str)
        with open(path) as f:
            reloaded = json.load(f)
        assert DataPackage(package.metadata, reloaded["content"]).blob_census() == (1, 1)
    finally:
        os.unlink(path)

    importer = PackageImporter(
        session=db, storage_provider=storage,
        target_infospace_id=world["dst_iid"], target_user_id=world["uid"], settings=None,
    )
    await importer.import_annotation_run_package(package)

    landed = _imported_assets(db, world["dst_iid"])["Rotted Scan.pdf"]
    assert landed.processing_status == ProcessingStatus.FAILED, (
        "an asset whose file never arrived must not present as READY"
    )
    assert landed.processing_error, "the reason must travel with the flag"
    assert landed.text_content == "scanned text", "derived content still had to arrive"


# ─── Through the real HTTP endpoints ────────────────────────────────────────


class TestOverTheWire:
    """Export and import via the actual routes, as the dashboard buttons do.

    Everything above drives the service layer. This closes the last gap: the
    HTTP surface (multipart form in, FileResponse out, UploadFile back in) and
    the ``import_package`` dispatcher that wraps the importer with its commit
    and post-import processing hook. If the buttons in the runner header work,
    it is because this passes.
    """

    def test_export_endpoint_returns_a_real_package_zip(self, client, headers, infospace_factory, user_id, committed_db, wire_storage):
        from app.core.config import settings
        import io, zipfile, json

        iid = infospace_factory("wire_pkg_export", user_id)
        run_id = _seed_minimal_run(committed_db, iid, user_id, storage=wire_storage)

        r = client.post(
            f"{settings.API_V1_STR}/shareables/{iid}/export",
            headers=headers,
            data={"resource_type": "run", "resource_id": str(run_id)},
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"

        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert "manifest.json" in names, f"no manifest in package: {names}"

        manifest = json.loads(zf.read("manifest.json"))
        content = manifest["content"]["annotation_run"]
        assert manifest["metadata"]["package_type"] == "run"
        assert content["name"] == "Wire Run"
        assert len(content["assets"]) == 2, "parent + child must both travel"
        assert len(content["annotations"]) == 1
        assert len(content["annotation_schemas"]) == 1
        titles = {a["title"] for a in content["assets"]}
        assert titles == {"Wire Parent.pdf", "Wire Child"}

        # The blob rode along, byte-identical, through the FileResponse.
        parent = next(a for a in content["assets"] if a["title"] == "Wire Parent.pdf")
        assert "blob_file_reference" in parent, "parent exported without its blob"
        assert zf.read(parent["blob_file_reference"]) == WIRE_BLOB

    def test_exported_package_imports_through_the_endpoint(self, client, headers, infospace_factory, user_id, committed_db, wire_storage):
        from app.core.config import settings

        src_iid = infospace_factory("wire_pkg_src", user_id)
        dst_iid = infospace_factory("wire_pkg_dst", user_id)
        run_id = _seed_minimal_run(committed_db, src_iid, user_id, storage=wire_storage)

        exported = client.post(
            f"{settings.API_V1_STR}/shareables/{src_iid}/export",
            headers=headers,
            data={"resource_type": "run", "resource_id": str(run_id)},
        )
        assert exported.status_code == 200, exported.text[:300]

        imported = client.post(
            f"{settings.API_V1_STR}/shareables/import/{dst_iid}",
            headers=headers,
            files={"file": ("run.zip", exported.content, "application/zip")},
        )
        assert imported.status_code == 200, f"{imported.status_code} {imported.text[:400]}"

        # The run landed, with its assets, schema and annotation.
        runs = client.get(f"{settings.API_V1_STR}/infospaces/{dst_iid}/runs", headers=headers)
        assert runs.status_code == 200
        names = [r["name"] for r in runs.json()["data"]]
        assert "Wire Run" in names, f"imported run missing; got {names}"

        assets = client.get(f"{settings.API_V1_STR}/infospaces/{dst_iid}/assets", headers=headers)
        assert assets.status_code == 200
        titles = {a["title"] for a in assets.json()["data"]}
        assert {"Wire Parent.pdf", "Wire Child"} <= titles, f"assets missing; got {titles}"

        # The blob was written back into the target's storage, not just recorded.
        landed = [
            a for a in assets.json()["data"]
            if a["title"] == "Wire Parent.pdf" and a["infospace_id"] == dst_iid
        ]
        assert landed, "imported parent not found in the target infospace"
        blob_path = landed[0].get("blob_path")
        assert blob_path, "imported parent arrived without a blob_path"
        assert wire_storage.blobs.get(blob_path) == WIRE_BLOB


WIRE_BLOB = b"%PDF-1.4 wire parent bytes"


def _seed_minimal_run(db, infospace_id: int, user_id: int, storage=None) -> int:
    """A parent/child pair, one schema, one run, one annotation on the CHILD.

    Annotating only the child is the point: the parent has to be pulled in by
    the tree closure rather than by being referenced. The parent also carries a
    blob so the package is written as a zip rather than a bare JSON manifest.
    """
    blob_path = f"wire/{infospace_id}/parent.pdf"
    if storage is not None:
        storage.blobs[blob_path] = WIRE_BLOB
    parent = Asset(
        title="Wire Parent.pdf", kind=AssetKind.PDF, infospace_id=infospace_id,
        user_id=user_id, text_content="parent text", bundle_ids=[0],
        blob_path=blob_path, file_info={"original_filename": "Wire Parent.pdf"},
        processing_status=ProcessingStatus.READY,
    )
    db.add(parent)
    db.flush()
    child = Asset(
        title="Wire Child", kind=AssetKind.TEXT, infospace_id=infospace_id,
        user_id=user_id, parent_asset_id=parent.id, part_index=1,
        text_content="child text", bundle_ids=[0], processing_status=ProcessingStatus.READY,
    )
    db.add(child)
    db.flush()
    schema = AnnotationSchema(
        name="Wire Schema", description="d", output_contract={"type": "object"},
        instructions="i", infospace_id=infospace_id, user_id=user_id, version="1.0",
    )
    db.add(schema)
    db.flush()
    run = AnnotationRun(
        name="Wire Run", infospace_id=infospace_id, user_id=user_id,
        status=RunStatus.COMPLETED,
    )
    run.target_schemas = [schema]
    db.add(run)
    db.flush()
    db.add(Annotation(
        asset_id=child.id, schema_id=schema.id, run_id=run.id,
        infospace_id=infospace_id, user_id=user_id, value={"ok": True},
    ))
    db.commit()
    return run.id
