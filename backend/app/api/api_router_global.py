"""
Declarative router manifest with two-level capability filtering.

Level 1 — Router-level: entire routers skipped when their required capabilities
          exceed the deployment ceiling.
Level 2 — Route-level: within mounted routers, individual endpoints pruned if
          their Requires() declares capabilities not in the ceiling.

Requires() is the single declaration that drives:
  1. Mount-time pruning (here)
  2. Startup-time scope validation (Phase 2.1)
  3. Runtime 403 (defense in depth)
"""
import logging
from dataclasses import dataclass, field
from typing import Optional, Set

from fastapi import APIRouter

from app.api.modules.identity_infospace_user.access import Capability
from app.core.config import settings

logger = logging.getLogger(__name__)

# All capabilities — used to detect full-deployment fast path
_ALL_CAPABILITY_NAMES = frozenset(c.value for c in Capability)


@dataclass(frozen=True)
class R:
    """Router manifest entry."""
    router: APIRouter
    tags: list = field(default_factory=list)
    prefix: str = ""
    requires: Optional[Set[str]] = None  # capability VALUE strings; None = always mounted


def _ceiling_caps() -> frozenset:
    """Resolve deployment ceiling to frozenset of Capability enum members."""
    names = settings.deployment_capability_names
    return frozenset(c for c in Capability if c.value in names)


def _extract_required_caps(route) -> frozenset:
    """Read capability requirements from a route's Requires() dependency metadata."""
    dependant = getattr(route, "dependant", None)
    if dependant is None:
        return frozenset()
    for dep in getattr(dependant, "dependencies", []):
        call = getattr(dep, "call", None)
        if call is None:
            continue
        caps = getattr(call, "_required_capabilities", None)
        if caps is not None:
            return frozenset(caps)
    return frozenset()


def _mount_filtered(target: APIRouter, router: APIRouter, ceiling: frozenset, **kwargs):
    """Mount router, pruning individual routes whose Requires() exceeds the ceiling."""
    if ceiling == frozenset(Capability):
        # Full deployment — mount everything, no introspection needed
        target.include_router(router, **kwargs)
        return

    filtered = APIRouter()
    for route in router.routes:
        caps = _extract_required_caps(route)
        if caps and not caps.issubset(ceiling):
            path = getattr(route, "path", "?")
            methods = getattr(route, "methods", set())
            logger.info(f"Pruned route {methods} {kwargs.get('prefix', '')}{path} (requires {[c.value for c in caps]})")
            continue
        filtered.routes.append(route)
    if filtered.routes:
        target.include_router(filtered, **kwargs)


def build_api_router() -> APIRouter:
    """Build the API router from the manifest, filtered by deployment capabilities."""
    from app.api.routes import (
        admin,
        analysis,
        storage,
        annotation_runs,
        annotation_schemas,
        annotations,
        assets,
        backups,
        bundles,
        chat,
        chat_history,
        chunking,
        search_history,
        ingestion_jobs,
        datasets,
        embeddings,
        canons,
        entities,
        knowledge_graphs,
        relationships,
        filestorage,
        filters,
        flows,
        healthcheck,
        infospaces,
        login,
        packages,
        providers,
        search,
        shareables,
        sources,
        sso,
        stream,
        tasks,
        tree,
        user_backups,
        users,
        utils,
    )

    ceiling = _ceiling_caps()
    ceiling_names = settings.deployment_capability_names
    is_full = ceiling_names == _ALL_CAPABILITY_NAMES

    # Manifest: (router, kwargs, required_capability_names_or_None)
    # required=None → always mounted (individual routes still pruned by Requires())
    MANIFEST = [
        # --- Always mounted (read-only data serving + auth) ---
        R(healthcheck.router, ["app"], "/healthz"),
        R(login.router, ["login"]),
        R(users.router, ["users"], "/users"),
        R(sso.router, ["sso"]),
        R(infospaces.router, ["Infospaces"], "/infospaces"),
        R(assets.router, ["assets"]),
        R(bundles.router, ["Bundles"]),
        R(tree.router, ["Tree Navigation"]),
        R(packages.router, ["Packages"]),
        R(annotations.router, ["annotations"], "/annotations"),
        R(annotation_runs.router, ["Runs"]),
        R(annotation_schemas.router, ["AnnotationSchemas"]),
        R(entities.router, ["Entities"]),
        R(canons.router, ["Canons"]),
        R(canons.run_suggestions_router, ["Canons"]),
        R(knowledge_graphs.router, ["Knowledge Graphs"]),
        R(relationships.router, ["Relationships"]),
        R(embeddings.router, ["embeddings"], "/embeddings"),
        R(datasets.router, ["datasets"]),
        R(stream.router, ["Live Streams"]),
        R(providers.router, ["Providers"]),
        # --- Capability-gated (entire router) ---
        R(sources.router, ["Sources"], requires={"ingest"}),
        R(ingestion_jobs.router, ["Ingestion Jobs"], requires={"ingest"}),
        R(storage.router, ["Storage"], requires={"ingest"}),
        R(utils.router, ["utils"], requires={"ingest"}),
        R(filestorage.router, ["filestorage"], "/files", requires={"ingest"}),
        R(flows.router, ["Flows"], requires={"compute"}),
        R(tasks.router, ["tasks"], "/tasks", requires={"compute"}),
        R(analysis.router, ["Fragments"]),
        R(search.router, ["Search"], "/search", requires={"compute"}),
        R(chat.router, ["Intelligence Chat"], "/chat", requires={"compute"}),
        R(chat_history.router, ["Chat History"], "/chat/conversations", requires={"compute"}),
        R(chunking.router, ["chunking"], "/chunking", requires={"compute"}),
        R(filters.router, ["filters"], "/filters", requires={"compute"}),
        R(search_history.router, ["Search History"], "/search_history", requires={"compute"}),
        R(backups.router, ["Backups"], requires={"organize"}),
        R(backups.general_router, ["Backups"], requires={"organize"}),
        R(user_backups.router, ["User Backups"], requires={"setup"}),
        R(shareables.router, ["sharing"], "/shareables", requires={"organize"}),
        R(admin.router, ["admin"], requires={"setup"}),
    ]

    api_router = APIRouter()
    mounted = 0
    skipped = 0

    for entry in MANIFEST:
        kwargs = {"tags": entry.tags}
        if entry.prefix:
            kwargs["prefix"] = entry.prefix

        # Level 1: router-level gating
        if entry.requires is not None and not entry.requires.issubset(ceiling_names):
            skipped += 1
            logger.info(f"Skipped router {entry.tags} (requires {entry.requires})")
            continue

        # Level 2: per-route pruning within mounted routers
        if is_full:
            api_router.include_router(entry.router, **kwargs)
        else:
            _mount_filtered(api_router, entry.router, ceiling, **kwargs)
        mounted += 1

    logger.info(f"Router manifest: {mounted} mounted, {skipped} skipped (ceiling: {ceiling_names or 'readonly'})")
    return api_router


# Build on import — same lifecycle as before
api_router = build_api_router()
