"""
Core access control module.

Implements capability-based access with frozen Access contexts, role→capability
mapping, and the Requires() FastAPI dependency factory.

See FOUNDATION.md § Access Control and OVERVIEW.md § Access Control.
"""

from __future__ import annotations

import enum
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import FrozenSet, Optional, Tuple

from fastapi import Depends, HTTPException, Header, Query, status
from sqlalchemy import literal
from sqlmodel import Session, select

from app.api.modules.identity_infospace_user.models import (
    CollaboratorRole,
    Infospace,
    InfospaceCollaborator,
    User,
)

logger = logging.getLogger(__name__)


# ─── Capabilities ───

class Capability(str, enum.Enum):
    ORGANIZE = "organize"   # bundles, schemas, entities, graphs, packages, manual annotations
    INGEST = "ingest"       # sources, ingestion jobs, asset uploads
    COMPUTE = "compute"     # annotation schemas, flows, enrichments
    DELETE = "delete"       # delete assets, remove from bundles, cascade-delete bundles
    SETUP = "setup"         # infospace settings, enrichment config, collaborators, visibility


ROLE_CAPABILITIES: dict[CollaboratorRole, FrozenSet[Capability]] = {
    CollaboratorRole.OWNER: frozenset(Capability),
    CollaboratorRole.ANALYST: frozenset({
        Capability.ORGANIZE, Capability.INGEST, Capability.COMPUTE, Capability.DELETE,
    }),
    CollaboratorRole.EDITOR: frozenset({  # legacy alias → same as ANALYST
        Capability.ORGANIZE, Capability.INGEST, Capability.COMPUTE, Capability.DELETE,
    }),
    CollaboratorRole.CURATOR: frozenset({Capability.ORGANIZE}),
    CollaboratorRole.VIEWER: frozenset(),
}


# ─── Visibility ───

class InfospaceVisibility(str, enum.Enum):
    PRIVATE = "private"
    INTERNAL = "internal"
    PUBLIC = "public"


# ─── Scope ───

@dataclass(frozen=True)
class PackageScope:
    """Restricts access to specific resources within an infospace (package token path).

    Precomputed at token resolution — always compact.  Bundle recursive expansion,
    graph→run derivation, run→schema derivation, and ancestor asset chain are all
    resolved once and frozen here.
    """
    bundle_ids: Tuple[int, ...] = ()               # explicit bundles (recursive expansion done)
    asset_ids: Tuple[int, ...] = ()                 # explicit assets + ancestor chain from run-derived children
    graph_ids: Tuple[int, ...] = ()                 # explicit graphs
    canon_ids: Tuple[int, ...] = ()                 # explicit canons + derived from graphs (graph.canon_id)
    run_ids: Tuple[int, ...] = ()                   # explicit + derived from graphs (bounded)
    schema_ids: Tuple[int, ...] = ()                # explicit + derived from runs (bounded)
    entity_ids: Tuple[int, ...] = ()                # explicit entities + derived from canons (bounded)
    downloadable_asset_ids: Tuple[int, ...] = ()    # subset of visible assets where download is allowed
    copyable_asset_ids: Tuple[int, ...] = ()        # subset of visible assets where copy is allowed


# ─── Access context ───

@dataclass(frozen=True)
class Access:
    """
    Immutable access context resolved once per request.

    Every data-returning route receives this via the Requires() dependency.
    Routes declare what capability they need; resolution happens here.
    """
    infospace_id: int
    infospace: Infospace
    user_id: Optional[int]      # None for anonymous public access
    is_owner: bool
    capabilities: FrozenSet[Capability]
    scope: Optional[PackageScope]  # None = full infospace access
    role: Optional[CollaboratorRole]

    def has(self, cap: Capability) -> bool:
        return cap in self.capabilities

    def has_all(self, *caps: Capability) -> bool:
        return all(c in self.capabilities for c in caps)

    def scope_filter(self, stmt, column, scope_field: str):
        """Apply scope restriction to a SELECT statement.

        No-op when self.scope is None (full access).
        Returns stmt.where(literal(False)) when scope is set but the ID set is empty.
        Otherwise applies column.in_(scope_ids).

        Usage::
            stmt = access.scope_filter(stmt, AnnotationRun.id, "run_ids")
        """
        if self.scope is None:
            return stmt
        ids = getattr(self.scope, scope_field)
        if not ids:
            return stmt.where(literal(False))
        return stmt.where(column.in_(ids))

    def can_download(self, asset_id: int) -> bool:
        """Check if an asset can be downloaded through the current access context."""
        if self.scope is None:
            return True  # owner/collaborator = full access
        return asset_id in self.scope.downloadable_asset_ids

    def can_copy(self, asset_id: int) -> bool:
        """Check if an asset can be copied/imported through the current access context."""
        if self.scope is None:
            return True
        return asset_id in self.scope.copyable_asset_ids

    def require_in_scope(self, scope_field: str, entity_id: int) -> None:
        """Point check — raises 404 if entity_id is outside the active scope.

        No-op when self.scope is None (full access).
        Entities outside scope "don't exist" (404, not 403).

        Usage::
            access.require_in_scope("run_ids", run.id)
        """
        if self.scope is None:
            return
        ids = getattr(self.scope, scope_field)
        if entity_id not in ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


# ─── Resolution ───

def _resolve_access(
    session: Session,
    infospace_id: int,
    user: Optional[User],
    package_token: Optional[str] = None,
) -> Access:
    """
    Resolve access context. Fixed priority order — first match wins:
    1. Owner
    2. Collaborator
    3. Package token
    4. Internal visibility + authenticated
    5. Public visibility
    6. No access → 404 (don't reveal existence)
    """
    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    user_id = user.id if user else None
    visibility = getattr(infospace, "visibility", None) or "private"

    # Step 1: Owner
    if user_id and infospace.owner_id == user_id:
        return Access(
            infospace_id=infospace_id,
            infospace=infospace,
            user_id=user_id,
            is_owner=True,
            capabilities=frozenset(Capability),
            scope=None,
            role=CollaboratorRole.OWNER,
        )

    # Step 2: Collaborator
    if user_id:
        collab = session.exec(
            select(InfospaceCollaborator).where(
                InfospaceCollaborator.infospace_id == infospace_id,
                InfospaceCollaborator.user_id == user_id,
            )
        ).first()
        if collab:
            return Access(
                infospace_id=infospace_id,
                infospace=infospace,
                user_id=user_id,
                is_owner=False,
                capabilities=ROLE_CAPABILITIES.get(collab.role, frozenset()),
                scope=None,
                role=collab.role,
            )

    # Step 3: Package token
    if package_token:
        scope = _resolve_package_token(session, infospace_id, package_token)
        if scope is not None:
            return Access(
                infospace_id=infospace_id,
                infospace=infospace,
                user_id=user_id,
                is_owner=False,
                capabilities=frozenset(),  # viewer-level (no capabilities)
                scope=scope,
                role=None,
            )

    # Step 4: Internal visibility + authenticated user
    if visibility == "internal" and user_id:
        return Access(
            infospace_id=infospace_id,
            infospace=infospace,
            user_id=user_id,
            is_owner=False,
            capabilities=frozenset(),
            scope=None,
            role=CollaboratorRole.VIEWER,
        )

    # Step 5: Public visibility
    if visibility == "public":
        return Access(
            infospace_id=infospace_id,
            infospace=infospace,
            user_id=user_id,
            is_owner=False,
            capabilities=frozenset(),
            scope=None,
            role=CollaboratorRole.VIEWER,
        )

    # Step 6: No access — respond as if infospace doesn't exist
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _resolve_package_token(
    session: Session,
    infospace_id: int,
    token: str,
) -> Optional[PackageScope]:
    """Resolve a package token into a fully-derived PackageScope.

    Precomputes all bounded derivations so that query-time predicates are
    simple ``ANY()`` / ``&&`` checks against compact tuples.
    """
    from sqlalchemy import text as sa_text
    from app.api.modules.sharing.models import Package, PackageItem

    pkg = session.exec(
        select(Package).where(
            Package.token == token,
            Package.infospace_id == infospace_id,
            Package.is_active == True,
        )
    ).first()
    if not pkg:
        return None
    if pkg.expires_at and datetime.now(timezone.utc) > pkg.expires_at:
        return None

    # ── Collect explicit grants from typed FK columns ──
    items = session.exec(
        select(PackageItem).where(PackageItem.package_id == pkg.id)
    ).all()

    bundle_ids: set[int] = set()
    asset_ids: set[int] = set()
    graph_ids: set[int] = set()
    canon_ids: set[int] = set()
    run_ids: set[int] = set()
    schema_ids: set[int] = set()
    entity_ids: set[int] = set()
    for item in items:
        if item.bundle_id is not None:
            bundle_ids.add(item.bundle_id)
        elif item.run_id is not None:
            run_ids.add(item.run_id)
        elif item.graph_id is not None:
            graph_ids.add(item.graph_id)
        elif item.schema_id is not None:
            schema_ids.add(item.schema_id)
        elif item.asset_id is not None:
            asset_ids.add(item.asset_id)
        elif item.canon_id is not None:
            canon_ids.add(item.canon_id)
        elif item.entity_id is not None:
            entity_ids.add(item.entity_id)

    # ── 1. Bundles → recursive expansion (child bundles) ──
    if bundle_ids:
        from app.core.tree import subtree_ids
        bundle_ids = subtree_ids(session, bundle_ids)

    # ── 2. Graphs → derive run_ids and canon_ids ──
    if graph_ids:
        from app.api.modules.graph.models import GraphEdge, KnowledgeGraph
        from app.api.modules.annotation.models import Annotation
        graph_run_rows = session.exec(
            select(Annotation.run_id).where(
                Annotation.id.in_(
                    select(GraphEdge.annotation_id).where(
                        GraphEdge.graph_id.in_(graph_ids)
                    )
                )
            ).distinct()
        ).all()
        run_ids |= {r for r in graph_run_rows if r is not None}
        # Each graph's backing canon is implicitly in scope
        graph_canon_rows = session.exec(
            select(KnowledgeGraph.canon_id).where(KnowledgeGraph.id.in_(graph_ids))
        ).all()
        canon_ids |= {c for c in graph_canon_rows if c is not None}

    # ── 2b. Canons → derive entity_ids (bounded; bulk caps at first 50K) ──
    if canon_ids:
        from app.api.modules.graph.models import Entity
        MAX_CANON_ENTITIES_PER_PACKAGE = 50_000
        canon_entity_rows = session.exec(
            select(Entity.id)
            .where(Entity.canon_id.in_(canon_ids))
            .limit(MAX_CANON_ENTITIES_PER_PACKAGE)
        ).all()
        entity_ids |= set(canon_entity_rows)

    # ── 3. Runs → derive schema_ids (bounded: run has few schemas) ──
    if run_ids:
        from app.api.modules.annotation.models import RunSchemaLink
        run_schema_rows = session.exec(
            select(RunSchemaLink.schema_id).where(
                RunSchemaLink.run_id.in_(run_ids)
            )
        ).all()
        schema_ids |= set(run_schema_rows)

    # ── 4. Runs → ancestor asset chain ──
    #    Annotations target child assets (pages, rows). The shareable unit
    #    is the top-level ancestor — pull parents into asset_ids.
    if run_ids:
        ancestor_rows = session.execute(sa_text("""
            WITH RECURSIVE ancestors AS (
                SELECT DISTINCT parent_asset_id AS id FROM asset
                WHERE id IN (
                    SELECT DISTINCT asset_id FROM annotation WHERE run_id = ANY(:rids)
                ) AND parent_asset_id IS NOT NULL
                UNION ALL
                SELECT a.parent_asset_id FROM asset a JOIN ancestors p ON a.id = p.id
                WHERE a.parent_asset_id IS NOT NULL
            )
            SELECT DISTINCT id FROM ancestors
        """), {"rids": list(run_ids)}).fetchall()
        asset_ids |= {r[0] for r in ancestor_rows}

    # ── 5. Compute download/copy permission sets ──
    #    Each asset inherits the permission of the PackageItem that grants it visibility.
    #    When an asset is reachable through multiple items, allow wins (union semantics).
    downloadable_asset_ids: set[int] = set()
    copyable_asset_ids: set[int] = set()

    for item in items:
        dl = item.effective_allow_download()
        cp = item.effective_allow_copy()
        if not dl and not cp:
            continue

        if item.bundle_id is not None:
            # All assets in this bundle's subtree inherit the item's permissions
            from app.core.tree import subtree_ids as _subtree_ids
            item_subtree = _subtree_ids(session, {item.bundle_id})
            if item_subtree:
                item_asset_rows = session.execute(sa_text(
                    "SELECT id FROM asset WHERE bundle_ids && CAST(:bids AS int[])"
                ), {"bids": list(item_subtree)}).fetchall()
                item_asset_set = {r[0] for r in item_asset_rows}
                if dl:
                    downloadable_asset_ids |= item_asset_set
                if cp:
                    copyable_asset_ids |= item_asset_set

        elif item.asset_id is not None:
            if dl:
                downloadable_asset_ids.add(item.asset_id)
            if cp:
                copyable_asset_ids.add(item.asset_id)

        elif item.run_id is not None:
            # Ancestor chain assets derived from this run inherit the item's permissions
            run_asset_rows = session.execute(sa_text(
                "SELECT DISTINCT asset_id FROM annotation WHERE run_id = :rid"
            ), {"rid": item.run_id}).fetchall()
            run_asset_set = {r[0] for r in run_asset_rows}
            # Also include ancestor assets already computed
            run_asset_set |= asset_ids  # ancestor chain was already built above
            if dl:
                downloadable_asset_ids |= run_asset_set
            if cp:
                copyable_asset_ids |= run_asset_set

        elif item.graph_id is not None:
            # Graph → annotations → assets
            graph_asset_rows = session.execute(sa_text(
                "SELECT DISTINCT a.asset_id FROM annotation a "
                "JOIN graphedge ge ON ge.annotation_id = a.id "
                "WHERE ge.graph_id = :gid"
            ), {"gid": item.graph_id}).fetchall()
            graph_asset_set = {r[0] for r in graph_asset_rows}
            if dl:
                downloadable_asset_ids |= graph_asset_set
            if cp:
                copyable_asset_ids |= graph_asset_set

        # schema/entity items have no file blobs — skip

    return PackageScope(
        bundle_ids=tuple(bundle_ids),
        asset_ids=tuple(asset_ids),
        graph_ids=tuple(graph_ids),
        canon_ids=tuple(canon_ids),
        run_ids=tuple(run_ids),
        schema_ids=tuple(schema_ids),
        entity_ids=tuple(entity_ids),
        downloadable_asset_ids=tuple(downloadable_asset_ids),
        copyable_asset_ids=tuple(copyable_asset_ids),
    )


# ─── Direct resolution (for routes without infospace_id in path) ───

def resolve_access(
    session: Session,
    infospace_id: int,
    user: Optional[User],
    *required_capabilities: Capability,
    package_token: Optional[str] = None,
) -> Access:
    """
    Resolve access and check capabilities — call directly from route handlers.

    Use this when the route doesn't have infospace_id as a path parameter
    (e.g. /bundles/{bundle_id} where infospace_id comes from the bundle).

    Usage::

        bundle = db.get(Bundle, bundle_id)
        access = resolve_access(db, bundle.infospace_id, current_user, Capability.DELETE)
        # access is now a verified, frozen Access context
    """
    access = _resolve_access(session, infospace_id, user, package_token=package_token)
    for cap in required_capabilities:
        if cap not in access.capabilities:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires the '{cap.value}' capability.",
            )
    return access


# ─── FastAPI dependency factory ───

_SCOPE_UNSET = object()

def Requires(*required_capabilities: Capability, scope: str | None = _SCOPE_UNSET):
    """
    FastAPI dependency factory that resolves access and checks capabilities.

    The ``scope`` parameter declares what scope field this route operates on:
    - ``scope="run_ids"`` — list/get routes filtered by run_ids
    - ``scope="bundle_ids"`` — routes filtered by bundle_ids
    - ``scope="asset"`` — routes using AssetQuery.scope() directly
    - ``scope=None`` — explicitly unscoped (blanket denial, auth-only, etc.)
    - ``_SCOPE_UNSET`` (default) — startup validation will flag this as an error

    The scope declaration drives:
    1. **Mount-time** — route pruned via _required_capabilities metadata
    2. **Startup-time** — scope validation catches missing declarations
    3. **Runtime** — 403 if capability missing (defense in depth)

    See FOUNDATION.md § Access Control and OVERVIEW.md § Access Control.
    """
    # Import deferred inside the closure to avoid circular import.
    # This function runs when the route module is imported (after models.py is done),
    # NOT when access.py itself is first imported.
    from app.api import dependency_injection

    def _dependency(
        infospace_id: int,
        db: Session = Depends(dependency_injection.get_db),
        current_user: Optional[User] = Depends(dependency_injection.get_current_user_optional),
        x_package_token: Optional[str] = Header(None, alias="X-Package-Token"),
        package_token: Optional[str] = Query(None, alias="package_token"),
    ) -> Access:
        from app.core.config import settings

        token = x_package_token or package_token
        access = _resolve_access(db, infospace_id, current_user, package_token=token)

        # Intersect user capabilities with deployment ceiling
        ceiling_names = settings.deployment_capability_names
        if ceiling_names != frozenset({"organize", "ingest", "compute", "delete", "setup"}):
            ceiling = frozenset(c for c in Capability if c.value in ceiling_names)
            capped_capabilities = access.capabilities & ceiling
            access = Access(
                infospace_id=access.infospace_id,
                infospace=access.infospace,
                user_id=access.user_id,
                is_owner=access.is_owner,
                capabilities=capped_capabilities,
                scope=access.scope,
                role=access.role,
            )

        for cap in required_capabilities:
            if cap not in access.capabilities:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"This action requires the '{cap.value}' capability.",
                )

        return access

    # Metadata read by router manifest (mount-time pruning) and startup validator (scope check)
    _dependency._required_capabilities = required_capabilities
    _dependency._scope_declaration = scope

    return Depends(_dependency)


# ─── Convenience aliases ───
# NOT created at module level to avoid circular import.
# Routes should call Requires() directly or use these lazy properties.

class _AccessAliases:
    """Lazy access aliases — Requires() is only called when first accessed."""

    @staticmethod
    def _view():
        return Requires(scope=None)

    @staticmethod
    def _organize():
        return Requires(Capability.ORGANIZE, scope=None)

    @staticmethod
    def _ingest():
        return Requires(Capability.INGEST, scope=None)

    @staticmethod
    def _compute():
        return Requires(Capability.COMPUTE, scope=None)

    @staticmethod
    def _delete():
        return Requires(Capability.DELETE, scope=None)

    @staticmethod
    def _setup():
        return Requires(Capability.SETUP, scope=None)

    @staticmethod
    def _organize_delete():
        return Requires(Capability.ORGANIZE, Capability.DELETE, scope=None)


# These are callables, not Depends instances.
# Usage: `access: Access = ViewAccess` where ViewAccess is actually `Requires()`
# They're defined as module-level names that call Requires() on first use.
# We use a simple pattern: each is a property on a singleton.

_aliases = _AccessAliases()

# For routes to use: `access: Access = ViewAccess`
# Since FastAPI evaluates default values at route registration time (not at import time
# of access.py), and route modules are imported AFTER models.py is done, this works.
def __getattr__(name: str):
    """Module-level __getattr__ for lazy alias resolution."""
    _map = {
        "ViewAccess": _aliases._view,
        "OrganizeAccess": _aliases._organize,
        "IngestAccess": _aliases._ingest,
        "ComputeAccess": _aliases._compute,
        "DeleteAccess": _aliases._delete,
        "SetupAccess": _aliases._setup,
        "OrganizeDeleteAccess": _aliases._organize_delete,
    }
    if name in _map:
        return _map[name]()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
