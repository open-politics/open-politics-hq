from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

# Import celery app early to initialize Redis connection for task queueing
from app.core.celery_app import celery  # noqa: F401
from app.core.config import settings

from app.api.main import api_router
# from app.api.main import api_router_v2
from app.api.mcp.server import mcp as intelligence_mcp_server


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


# Create an ASGI-compatible application from the FastMCP server.
# Use stateless_http=True for production HTTP deployment to avoid session issues.
# FastAPI's `mount` will handle the path, so we don't specify it here.
mcp_asgi_app = intelligence_mcp_server.http_app(stateless_http=True)


# As per FastMCP documentation for combining lifespans
@asynccontextmanager
async def combined_lifespan(app: FastAPI):
    print("Starting up the MCP app...")
    
    # Optional: Inspect prompts on startup (for development/testing)
    if settings.INSPECT_PROMPTS_ON_STARTUP:
        try:
            from app.tests.prompt_inspector import print_all
            print_all()
        except Exception as e:
            print(f"⚠️  Prompt inspection failed: {e}")
    
    # Run the lifespans together
    async with mcp_asgi_app.lifespan(app):
        yield
    print("Shutting down the main app...")


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    redirect_slashes=False,
    lifespan=combined_lifespan,
)

# Set all CORS enabled origins
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            str(origin).strip("/") for origin in settings.BACKEND_CORS_ORIGINS
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Mount the MCP server at its designated path.
app.mount("/tools", mcp_asgi_app)

app.include_router(api_router, prefix=settings.API_V1_STR)
# app.include_router(api_router_v2, prefix=settings.API_V2_STR)

