from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

# Import celery app early to initialize Redis connection for task queueing
from app.core.celery_app import celery  # noqa: F401
from app.core.config import settings

from app.api.api_router_global import api_router
from app.api.modules.conversational_intelligence.mcp_server.server import mcp as intelligence_mcp_server


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


# Create an ASGI-compatible application from the FastMCP server.
# Use stateless_http=True for production HTTP deployment to avoid session issues.
# FastAPI's `mount` will handle the path, so we don't specify it here.
mcp_asgi_app = intelligence_mcp_server.http_app(stateless_http=True)


# As per FastMCP documentation for combining lifespans
@asynccontextmanager
async def combined_lifespan(app: FastAPI):
    
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


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    redirect_slashes=False,
    lifespan=combined_lifespan,
)

# Set all CORS enabled origins (from AppSettings)
if settings.BACKEND_CORS_ORIGINS:
    cors_origins = [str(o).strip("/") for o in settings.BACKEND_CORS_ORIGINS]
    cors_methods = settings.CORS_ALLOWED_METHODS
    cors_headers = settings.CORS_ALLOWED_HEADERS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=cors_methods,
        allow_headers=cors_headers,
    )

# Security headers middleware (HSTS, CSP, X-Frame-Options)
class SecurityHeadersMiddleware:
    """Add security headers to all responses."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if settings.ENVIRONMENT == "production":
                    headers.append([b"strict-transport-security", b"max-age=31536000; includeSubDomains"])
                headers.append([b"x-content-type-options", b"nosniff"])
                headers.append([b"x-frame-options", b"DENY"])
                headers.append([b"x-xss-protection", b"1; mode=block"])
                csp = b"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https: wss:; frame-ancestors 'none'"
                headers.append([b"content-security-policy", csp])
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


app.add_middleware(SecurityHeadersMiddleware)

# Mount the MCP server at its designated path.
app.mount("/tools", mcp_asgi_app)

app.include_router(api_router, prefix=settings.API_V1_STR)

