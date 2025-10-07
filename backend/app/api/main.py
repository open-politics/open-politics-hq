from fastapi import APIRouter
from app.api.routes import (
    admin,
    analysis,
    annotation_runs,
    annotation_schemas,
    annotations,
    assets,
    backups,
    bundles,
    chat,  # NEW: Intelligence chat routes
    chat_history,  # NEW: Chat conversation history routes
    chunking,
    datasets,
    embeddings,
    filestorage,
    filters,
    healthcheck,
    infospaces,
    login,
    monitors,
    pipelines,
    search,
    shareables,
    sources,
    sso,
    tasks,
    tree,  # NEW: Efficient tree navigation routes
    user_backups,
    users,
    utils,
)
from app.api.v1 import (
    entities,
    locations,
    satellite
)


api_router = APIRouter()

# V1/ Main APIs - Using app.api.routes directly now for user-centric features
api_router.include_router(admin.router, tags=["admin"])
api_router.include_router(analysis.router, tags=["Analysis Service"])
api_router.include_router(annotation_runs.router, prefix="/annotation_jobs", tags=["annotation_jobs"])
api_router.include_router(annotation_schemas.router, tags=["AnnotationSchemas"])
api_router.include_router(annotations.router, prefix="/annotations", tags=["annotations"])
api_router.include_router(assets.router, tags=["assets"])
api_router.include_router(backups.router, tags=["Backups"])
api_router.include_router(backups.general_router, tags=["Backups"])
api_router.include_router(bundles.router, prefix="/bundles", tags=["Bundles"])
api_router.include_router(chat.router, prefix="/chat", tags=["Intelligence Chat"])  # NEW
api_router.include_router(chat_history.router, prefix="/chat/conversations", tags=["Chat History"])  # NEW
api_router.include_router(chunking.router, prefix="/chunking", tags=["chunking"])
api_router.include_router(datasets.router, tags=["datasets"])
api_router.include_router(embeddings.router, prefix="/embeddings", tags=["embeddings"])
api_router.include_router(filestorage.router, prefix="/files", tags=["filestorage"])
api_router.include_router(filters.router, prefix="/filters", tags=["filters"])
api_router.include_router(healthcheck.router, prefix="/healthz", tags=["app"])
api_router.include_router(infospaces.router, prefix="/infospaces", tags=["Infospaces"])
api_router.include_router(login.router, tags=["login"])
api_router.include_router(monitors.router, tags=["Monitors"])
api_router.include_router(pipelines.router, prefix="/pipelines", tags=["Pipelines"])
api_router.include_router(search.router, prefix="/search", tags=["Search"])

api_router.include_router(shareables.router, prefix="/sharing", tags=["sharing"])
api_router.include_router(sources.router, tags=["Sources"])
api_router.include_router(sso.router, tags=["sso"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
api_router.include_router(tree.router, tags=["Tree Navigation"])
api_router.include_router(user_backups.router, tags=["User Backups"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(utils.router, tags=["utils"])

# Original V1 routes 
api_router.include_router(entities.router, prefix="/entities", tags=["entities"])
api_router.include_router(locations.router, prefix="/locations", tags=["locations"])
api_router.include_router(satellite.router, prefix="/satellite", tags=["satellite"])

# Backwards-compatible aliases expected by app.main
# api_router_v1 = api_router
# api_router_v2 = api_router
