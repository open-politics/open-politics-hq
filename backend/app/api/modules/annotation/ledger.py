"""The run ledger: what a run reads, and where each of those assets stands.

A run's **scope** is the assets it is meant to read — the subtrees of the
bundles it watches, plus any assets named outright. Its **annotations** say
which of them it has read, and how that went. The ledger lines the two up per
asset, so a run can be shown as a queue draining into a folder of results
without anyone fetching the results themselves.

Assets are counted at the root: CSV rows and PDF pages are annotated in their
own right, but they are parts of the asset someone put in the bundle, so their
annotations are rolled up to it (``coalesce(parent_asset_id, id)``). An asset
is *annotated* when any of its annotations succeeded, *failed* when it has
annotations and none did, and *queued* while it is in scope with none at all.
"""
from typing import Literal, Optional

from sqlalchemy import func, or_, text
from sqlmodel import Session, select

from app.api.modules.annotation.models import Annotation, AnnotationRun, ResultStatus
from app.api.modules.content.models import Asset
from app.schemas import RunLedgerAsset, RunLedgerAssets, RunLedgerSummary

LedgerState = Literal["queued", "annotated"]


def run_scope_clause(session: Session, run: AnnotationRun):
    """SQL predicate selecting the assets in a run's scope, or None if unscoped.

    A run can watch one or more bundles: ``source_bundle_id`` (single, legacy),
    ``configuration["source_bundle_ids"]`` (a list — the canonical multi-bundle
    form), and ``target_bundle_id`` (one-off). Each resolves to its **subtree**
    (folders are bundles; ``bundle_ids`` is direct membership). An explicit
    ``target_asset_ids`` list scopes by id. The scope is the **union** of all of
    these — so adding an explicit asset to a bundle-watching run actually widens
    the scope rather than being silently shadowed by the bundle.
    """
    cfg = run.configuration or {}
    clauses = []

    roots: set[int] = set()
    if run.source_bundle_id:
        roots.add(run.source_bundle_id)
    roots.update(cfg.get("source_bundle_ids") or [])
    if cfg.get("target_bundle_id"):
        roots.add(cfg["target_bundle_id"])
    if roots:
        from app.api.modules.content.tree import subtree_ids
        bids = list(subtree_ids(session, roots))
        clauses.append(text("asset.bundle_ids && CAST(:scope_bids AS int[])").bindparams(scope_bids=bids))

    asset_ids = cfg.get("target_asset_ids")
    if asset_ids:
        # One array parameter, not an IN list: psycopg binds each IN value as its
        # own parameter and the protocol caps a statement at 65,535 of them.
        clauses.append(text("asset.id = ANY(CAST(:scope_aids AS int[]))").bindparams(scope_aids=list(asset_ids)))

    if not clauses:
        return None
    return clauses[0] if len(clauses) == 1 else or_(*clauses)


def _rollup(run: AnnotationRun):
    """Per root asset: whether any annotation succeeded, any failed, and when
    the last one landed. Served by the ``(run_id, asset_id, status)`` index."""
    root = func.coalesce(Asset.parent_asset_id, Asset.id)
    return (
        select(
            root.label("root_id"),
            func.bool_or(Annotation.status == ResultStatus.SUCCESS).label("ok"),
            func.bool_or(Annotation.status == ResultStatus.FAILED).label("bad"),
            func.max(Annotation.updated_at).label("last"),
        )
        .join(Asset, Asset.id == Annotation.asset_id)
        .where(Annotation.run_id == run.id)
        .group_by(root)
        .subquery()
    )


def _root_filters(session: Session, run: AnnotationRun) -> Optional[list]:
    """What makes an asset one of the run's roots in scope, or None if the run
    has no scope of its own (a flow step or a retry hands it assets one by one)."""
    scope = run_scope_clause(session, run)
    if scope is None:
        return None
    return [scope, Asset.infospace_id == run.infospace_id, Asset.parent_asset_id.is_(None)]


def summary(session: Session, run: AnnotationRun) -> RunLedgerSummary:
    rolled = _rollup(run)
    annotated, failed, last = session.exec(
        select(
            func.count().filter(rolled.c.ok),
            func.count().filter(rolled.c.bad & ~rolled.c.ok),
            func.max(rolled.c.last),
        ).select_from(rolled)
    ).one()

    in_scope = queued = None
    filters = _root_filters(session, run)
    if filters is not None:
        roots = select(Asset.id).where(*filters).subquery()
        in_scope, queued = session.exec(
            select(func.count(), func.count().filter(rolled.c.root_id.is_(None)))
            .select_from(roots)
            .outerjoin(rolled, rolled.c.root_id == roots.c.id)
        ).one()

    per_schema = dict(session.exec(
        select(Annotation.schema_id, func.count())
        .where(Annotation.run_id == run.id)
        .group_by(Annotation.schema_id)
    ).all())

    return RunLedgerSummary(
        in_scope=in_scope,
        queued=queued or 0,
        annotated=annotated,
        failed=failed,
        annotations=sum(per_schema.values()),
        per_schema=per_schema,
        last_annotated_at=last,
    )


def assets(
    session: Session,
    run: AnnotationRun,
    state: LedgerState,
    *,
    skip: int = 0,
    limit: int = 100,
) -> RunLedgerAssets:
    """One page of the queue (in processing order) or of the annotated
    (latest first), with the total for that state."""
    rolled = _rollup(run)

    if state == "queued":
        filters = _root_filters(session, run)
        if filters is None:
            return RunLedgerAssets(items=[], total=0)
        base = (
            # A queued asset's moment is when it arrived.
            select(Asset.id, Asset.title, Asset.kind, Asset.created_at, rolled.c.ok)
            .outerjoin(rolled, rolled.c.root_id == Asset.id)
            .where(*filters, rolled.c.root_id.is_(None))
        )
        order = Asset.id
    else:
        # An annotated asset's moment is when it was read.
        base = select(Asset.id, Asset.title, Asset.kind, rolled.c.last, rolled.c.ok).join(
            rolled, rolled.c.root_id == Asset.id
        )
        order = rolled.c.last.desc()

    total = session.exec(select(func.count()).select_from(base.subquery())).one()
    rows = session.exec(base.order_by(order).offset(skip).limit(limit)).all()
    return RunLedgerAssets(
        total=total,
        items=[
            RunLedgerAsset(
                id=id_,
                title=title,
                kind=kind,
                at=at,
                status="queued" if ok is None else "success" if ok else "failed",
            )
            for id_, title, kind, at, ok in rows
        ],
    )
