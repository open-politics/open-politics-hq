from fastapi import APIRouter
from app.api.routes import (
    annotation_runs,
    assets,
    annotation_schemas,
    annotations,
    bundles,
    datasets,
    filestorage,
    healthcheck,
    infospaces,
    login,
    tasks,
    search_history,
    shareables,
    sources,
    users,
    utils,
)
from app.api.v1 import (
    entities,
    locations,
    satellite,
    search,
)
from app.api.v2 import (
    articles,
    entities,
    geo,
    scores,
)

api_router_v1 = APIRouter()
api_router_v2 = APIRouter()

# V1/ Main APIs - Using app.api.routes directly now for user-centric features
api_router_v1.include_router(assets.router, prefix="/assets", tags=["assets"])
api_router_v1.include_router(annotation_runs.router, prefix="/annotation_jobs", tags=["annotation_jobs"])
api_router_v1.include_router(annotation_schemas.router, prefix="/annotation_schemes", tags=["annotation_schemes"])
api_router_v1.include_router(annotations.router, prefix="/annotations", tags=["annotations"])
api_router_v1.include_router(bundles.router, prefix="/bundles", tags=["Bundles"])
api_router_v1.include_router(datasets.router, tags=["datasets"])
api_router_v1.include_router(filestorage.router, prefix="/files", tags=["filestorage"])
api_router_v1.include_router(healthcheck.router, prefix="/healthz", tags=["app"])
api_router_v1.include_router(infospaces.router, prefix="/infospaces", tags=["Infospaces"])
api_router_v1.include_router(login.router, tags=["login"])
api_router_v1.include_router(search_history.router, prefix="/search_histories", tags=["search-history"])
api_router_v1.include_router(shareables.router, prefix="/shareables", tags=["shareables"])
api_router_v1.include_router(users.router, prefix="/users", tags=["users"])
api_router_v1.include_router(utils.router, prefix="/utils", tags=["utils"])

# Original V1 routes 
api_router_v1.include_router(entities.router, prefix="/entities", tags=["entities"])
api_router_v1.include_router(locations.router, prefix="/locations", tags=["locations"])
api_router_v1.include_router(satellite.router, prefix="/satellite", tags=["satellite"])
api_router_v1.include_router(search.router, prefix="/search", tags=["search"])

# V2/ Experimental APIs
api_router_v2.include_router(articles.router, prefix="/articles", tags=["articles"])
api_router_v2.include_router(entities.router, prefix="/entities", tags=["entities"])
api_router_v2.include_router(geo.router, prefix="/geo", tags=["geo"])
api_router_v2.include_router(scores.router, prefix="/scores", tags=["scores"])

api_router = APIRouter()
api_router.include_router(assets.router, prefix="/assets", tags=["assets"])
api_router.include_router(annotation_runs.router, prefix="/annotation_jobs", tags=["annotation_jobs"])
api_router.include_router(annotation_schemas.router, prefix="/annotation_schemes", tags=["annotation_schemes"])
api_router.include_router(annotations.router, prefix="/annotations", tags=["annotations"])
api_router.include_router(bundles.router, prefix="/bundles", tags=["Bundles"])
api_router.include_router(datasets.router, prefix="/datasets", tags=["Datasets"])
api_router.include_router(healthcheck.router, prefix="/health", tags=["health"])
api_router.include_router(infospaces.router, prefix="/infospaces", tags=["Infospaces"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
api_router.include_router(shareables.router, prefix="/sharing", tags=["sharing"])
api_router.include_router(sources.router, prefix="/sources", tags=["Sources"])
