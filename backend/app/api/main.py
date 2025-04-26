from fastapi import APIRouter
from app.api.routes import (
    items,
    login,
    users,
    utils,
    healthcheck,
    search_history,
    workspaces,
    classification_schemes,
    classification_results,
    filestorage,
    classification_jobs,
    datasources,
    datarecords,
    recurring_tasks,
    shareables,
    datasets
)
from app.api.v1 import (
    locations,
    search,
    entities,
    satellite
)
from app.api.v2 import (
    geo,
    articles,
    classification,
    entities,
    scores
)

api_router_v1 = APIRouter()
api_router_v2 = APIRouter()

# V1/ Main APIs - Using app.api.routes directly now for user-centric features
api_router_v1.include_router(healthcheck.router, prefix="/healthz", tags=["app"])
api_router_v1.include_router(login.router, tags=["login"])
api_router_v1.include_router(users.router, prefix="/users", tags=["users"])
api_router_v1.include_router(utils.router, prefix="/utils", tags=["utils"])
api_router_v1.include_router(items.router, prefix="/items", tags=["items"])
api_router_v1.include_router(shareables.router, prefix="/shareables", tags=["shareables"])
api_router_v1.include_router(search_history.router, prefix="/search_histories", tags=["search-history"])
api_router_v1.include_router(filestorage.router, prefix="/files", tags=["filestorage"])
api_router_v1.include_router(workspaces.router, tags=["workspaces"])
api_router_v1.include_router(classification_schemes.router, tags=["classification-schemes"])
api_router_v1.include_router(classification_results.router, tags=["classification-results"])
api_router_v1.include_router(classification_jobs.router, tags=["classification-jobs"])
api_router_v1.include_router(datasources.router, tags=["datasources"])
api_router_v1.include_router(datarecords.router, tags=["datarecords"])
api_router_v1.include_router(recurring_tasks.router, tags=["recurring-tasks"])
api_router_v1.include_router(datasets.router, tags=["datasets"])

# Original V1 routes (assuming these were meant to be separate)
api_router_v1.include_router(locations.router, prefix="/locations", tags=["locations"])
api_router_v1.include_router(search.router, prefix="/search", tags=["search"])
api_router_v1.include_router(entities.router, prefix="/entities", tags=["entities"])
api_router_v1.include_router(satellite.router, prefix="/satellite", tags=["satellite"])

# V2/ Experimental APIs
api_router_v2.include_router(geo.router, prefix="/geo", tags=["geo"])
api_router_v2.include_router(articles.router, prefix="/articles", tags=["articles"])
api_router_v2.include_router(classification.router, prefix="/classification", tags=["classification"])
api_router_v2.include_router(entities.router, prefix="/entities", tags=["entities"])
api_router_v2.include_router(scores.router, prefix="/scores", tags=["scores"])