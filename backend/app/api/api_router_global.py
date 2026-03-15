from fastapi import APIRouter
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
    chat,  # Intelligence chat routes
    chat_history,  # Chat conversation history routes
    chunking,
    search_history,
    ingestion_jobs,  # Content ingestion job tracking
    datasets,
    embeddings,
    entities as canonical_entities,  # Graph canonical entities
    knowledge_graphs,
    filestorage,
    filters,
    flows,  # Unified Flow architecture (replaces monitors + pipelines)
    healthcheck,
    infospaces,
    login,
    providers,  # Provider discovery (models, capabilities)
    query,  # Universal asset query (AQL)
    search,
    shareables,
    sources,
    sso,
    tasks,
    tree,  # Efficient tree navigation routes
    user_backups,
    users,
    utils,
)
api_router = APIRouter()

# Main APIs - Routes mounted under API_V1_STR (/api/v1)
api_router.include_router(admin.router, tags=["admin"])
api_router.include_router(analysis.router, tags=["Analysis Service"])
api_router.include_router(annotation_runs.router, prefix="/annotation_jobs", tags=["annotation_jobs"])
api_router.include_router(annotation_schemas.router, tags=["AnnotationSchemas"])
api_router.include_router(annotations.router, prefix="/annotations", tags=["annotations"])
api_router.include_router(assets.router, tags=["assets"])
api_router.include_router(backups.router, tags=["Backups"])
api_router.include_router(backups.general_router, tags=["Backups"])
api_router.include_router(bundles.router, tags=["Bundles"])
api_router.include_router(chat.router, prefix="/chat", tags=["Intelligence Chat"])  # NEW
api_router.include_router(chat_history.router, prefix="/chat/conversations", tags=["Chat History"])  # NEW
api_router.include_router(chunking.router, prefix="/chunking", tags=["chunking"])
api_router.include_router(ingestion_jobs.router, tags=["Ingestion Jobs"])
api_router.include_router(datasets.router, tags=["datasets"])
api_router.include_router(embeddings.router, prefix="/embeddings", tags=["embeddings"])
api_router.include_router(canonical_entities.router, tags=["Canonical Entities"])
api_router.include_router(filestorage.router, prefix="/files", tags=["filestorage"])
api_router.include_router(filters.router, prefix="/filters", tags=["filters"])
api_router.include_router(flows.router, tags=["Flows"])  # NEW: Unified Flow architecture
api_router.include_router(healthcheck.router, prefix="/healthz", tags=["app"])
api_router.include_router(infospaces.router, prefix="/infospaces", tags=["Infospaces"])
api_router.include_router(knowledge_graphs.router, tags=["Knowledge Graphs"])
api_router.include_router(login.router, tags=["login"])
api_router.include_router(providers.router, tags=["Providers"])
api_router.include_router(query.router, tags=["Query"])
api_router.include_router(search.router, prefix="/search", tags=["Search"])
api_router.include_router(storage.router, tags=["Storage"])
api_router.include_router(search_history.router, prefix="/search_history", tags=["Search History"])
api_router.include_router(shareables.router, prefix="/shareables", tags=["sharing"])
api_router.include_router(sources.router, tags=["Sources"])
api_router.include_router(sso.router, tags=["sso"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
api_router.include_router(tree.router, tags=["Tree Navigation"])
api_router.include_router(user_backups.router, tags=["User Backups"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(utils.router, tags=["utils"])
