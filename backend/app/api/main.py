from fastapi import APIRouter
from app.api.routes import (
    items,
    login,
    users,
    utils,
    healthcheck,
    documents,
    search_history,
    workspaces,
    classification_schemes,
    classification_results,
    filestorage,
    classification_runs
)
from app.api.v1.locations.routes import router as location_router
from app.api.v1.search.routes import router as search_router
from app.api.v1.entities.routes import router as entities_router
from app.api.v1.satellite.routes import router as satellite_router
from app.api.v2 import (
    geo,
    articles,
    classification,
    entities,
    tasks,
    flows,
    scores
)

api_router_v1 = APIRouter()
api_router_v2 = APIRouter()

# V1/ Main APIs
api_router_v1.include_router(healthcheck.router, prefix="/healthz", tags=["app"])
api_router_v1.include_router(location_router, prefix="/locations", tags=["locations"])
api_router_v1.include_router(search_router, prefix="/search", tags=["search"])
api_router_v1.include_router(entities_router, prefix="/entities", tags=["entities"])
api_router_v1.include_router(satellite_router, prefix="/satellite", tags=["satellite"])

## User routes:
api_router_v1.include_router(login.router, tags=["login"])
api_router_v1.include_router(users.router, prefix="/users", tags=["users"])
api_router_v1.include_router(utils.router, prefix="/utils", tags=["utils"])
api_router_v1.include_router(items.router, prefix="/items", tags=["items"])
api_router_v1.include_router(search_history.router, prefix="/search_histories", tags=["search-history"])
api_router_v1.include_router(workspaces.router, tags=["workspaces"])
api_router_v1.include_router(documents.router, tags=["documents"])
api_router_v1.include_router(filestorage.router, tags=["filestorage"])
api_router_v1.include_router(classification_schemes.router, tags=["classification-schemes"])
api_router_v1.include_router(classification_results.router, tags=["classification-results"])
api_router_v1.include_router(classification_runs.router, tags=["classification-runs"])


# V2/ Experimental APIs
api_router_v2.include_router(geo.router, prefix="/geo", tags=["geo"])
api_router_v2.include_router(articles.router, prefix="/articles", tags=["articles"])
api_router_v2.include_router(classification.router, prefix="/classification", tags=["classification"])
api_router_v2.include_router(entities.router, prefix="/entities", tags=["entities"])
# api_router_v2.include_router(flows.router, prefix="/flows", tags=["flows"])
# api_router_v2.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
api_router_v2.include_router(scores.router, prefix="/scores", tags=["scores"])