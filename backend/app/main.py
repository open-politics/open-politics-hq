from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

# SSE keepalive: 3s pings to survive nginx proxy_read_timeout=5s (default is 15s)
import fastapi.sse
fastapi.sse._PING_INTERVAL = 3.0

# Import celery app early to initialize Redis connection for task queueing.
# load_task_modules() populates THIS process's @task registry + event-bus
# subscriptions (the worker gets the same set via Celery's `imports`), so that
# producer-side emit()/kick_tasks() from API routes and the chat MCP tools actually
# reach their tasks — e.g. intake()'s `ingestion_job.created` → `ingest`.
from app.core.celery_app import celery, load_task_modules  # noqa: F401
load_task_modules()
from app.core.config import settings

from app.api.api_router_global import api_router

# /tools is mounted only when COMPUTE is in the deployment ceiling (see the
# mount below) — MCP exposes workspace search, annotation runs and asset CRUD,
# all of which require compute. Importing it costs ~6.5s of the process's ~9s
# startup, because it drags in the whole FastMCP client+server stack and
# beartype's 344 modules. So the import follows the same gate as the mount,
# rather than being paid by deployments that will never serve /tools.
MCP_ENABLED = "compute" in settings.deployment_capability_names
if MCP_ENABLED:
    from app.api.modules.conversational_intelligence.mcp_server.server import (
        mcp as intelligence_mcp_server,
    )


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


# Create an ASGI-compatible application from the FastMCP server.
# Use stateless_http=True for production HTTP deployment to avoid session issues.
# FastAPI's `mount` will handle the path, so we don't specify it here.
mcp_asgi_app = (
    intelligence_mcp_server.http_app(stateless_http=True) if MCP_ENABLED else None
)


# As per FastMCP documentation for combining lifespans
@asynccontextmanager
async def combined_lifespan(app: FastAPI):

    
    # Run the lifespans together — unless MCP is gated off, in which case
    # there is no second lifespan to combine with.
    if mcp_asgi_app is None:
        yield
        return
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


class SseNoTransformMiddleware:
    """Force no-transform / no-buffering on every ``text/event-stream`` response.

    Why: gzip middleware in upstream proxies (Next.js dev rewrites, nginx)
    will batch small SSE frames before flushing, which defeats live progress
    streams entirely (banner sits at 0% then jumps to 100% at connection close).
    Standards-compliant ``Cache-Control: no-transform`` plus the nginx hint
    ``X-Accel-Buffering: no`` plus ``Content-Encoding: identity`` covers all
    proxy variants we've seen. Applied globally so any future SSE route
    inherits the fix without per-route plumbing.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_sse_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                # Detect SSE responses by content-type — only those need this.
                is_sse = any(
                    name == b"content-type" and b"text/event-stream" in value.lower()
                    for name, value in headers
                )
                if is_sse:
                    # Drop any existing Cache-Control / Content-Encoding the app
                    # may have set, then add the no-transform set. Idempotent.
                    headers = [
                        (n, v) for (n, v) in headers
                        if n not in (b"cache-control", b"content-encoding", b"x-accel-buffering")
                    ]
                    headers.append((b"cache-control", b"no-cache, no-store, no-transform"))
                    headers.append((b"x-accel-buffering", b"no"))
                    headers.append((b"content-encoding", b"identity"))
                    message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_sse_headers)


app.add_middleware(SseNoTransformMiddleware)

# Mount the MCP server only when COMPUTE capability is in the deployment ceiling.
# MCP exposes workspace search, annotation runs, and asset CRUD — all require compute.
if mcp_asgi_app is not None:
    app.mount("/tools", mcp_asgi_app)

app.include_router(api_router, prefix=settings.API_V1_STR)


# ─── Startup scope declaration validation ───
# Every route using Requires() must declare scope= to prevent silent data leaks.
# Currently warns; will become a hard crash once all routes are annotated.

import logging as _logging
_startup_logger = _logging.getLogger("app.startup")

def _iter_api_routes(app_instance):
    """Every APIRoute reachable from the app, including inside included routers.

    FastAPI stopped flattening `include_router` into `app.routes`: it now leaves
    a lazy `_IncludedRouter` placeholder that keeps the real router under
    `original_router`. The previous version of this walk iterated `app.routes`
    directly, so it saw 6 entries, 0 of them APIRoute, inspected no dependencies
    and could never fail — it had been silently passing since that upgrade.
    """
    from fastapi.routing import APIRoute

    seen: set[int] = set()
    stack = [app_instance]
    while stack:
        node = stack.pop()
        if id(node) in seen:
            continue
        seen.add(id(node))
        for route in getattr(node, "routes", None) or []:
            if isinstance(route, APIRoute):
                yield route
            # Only follow included routers. A Mount's .app is a foreign ASGI
            # app (the MCP server), which has no routes of ours to validate.
            nested = getattr(route, "original_router", None)
            if nested is not None:
                stack.append(nested)


def _iter_dependencies(dependant):
    """Walk a route's dependency tree, not just its top level.

    Requires() is normally a parameter default on the path operation, but a
    shared dependency can use it too, and those sit one level down.
    """
    stack = list(getattr(dependant, "dependencies", None) or [])
    seen: set[int] = set()
    while stack:
        dep = stack.pop()
        if id(dep) in seen:
            continue
        seen.add(id(dep))
        yield dep
        stack.extend(getattr(dep, "dependencies", None) or [])


def _validate_capability_vocabulary():
    """config.KNOWN_CAPABILITIES and access.Capability must not drift apart.

    config.py cannot import access.py — access's models import config — so the
    ceiling's vocabulary is spelled out in both places. This is the assertion
    that keeps the second copy honest: add a Capability and forget config.py,
    and `allowed_actions: "*"` would quietly stop granting it.
    """
    from app.api.modules.identity_infospace_user.access import Capability
    from app.core.config import KNOWN_CAPABILITIES

    canonical = frozenset(c.value for c in Capability)
    if canonical != KNOWN_CAPABILITIES:
        raise RuntimeError(
            "config.KNOWN_CAPABILITIES has drifted from access.Capability: "
            f"missing {sorted(canonical - KNOWN_CAPABILITIES)}, "
            f"extra {sorted(KNOWN_CAPABILITIES - canonical)}."
        )


def _validate_scope_declarations(app_instance):
    """Check that every route with Requires() has a scope declaration."""
    from app.api.modules.identity_infospace_user.access import _SCOPE_UNSET
    missing = []
    routes = list(_iter_api_routes(app_instance))

    # A guard that inspects nothing is worse than no guard: it reports success.
    # If the route walk ever comes back empty again — another FastAPI internals
    # change, a reordering that runs this before include_router — fail loudly
    # rather than pass silently.
    if not routes:
        raise RuntimeError(
            "Scope validation found no API routes to inspect. The route walk is "
            "broken (FastAPI internals changed, or this ran before the routers "
            "were included) — fix _iter_api_routes rather than removing this check."
        )

    for route in routes:
        dependant = getattr(route, "dependant", None)
        if dependant is None:
            continue
        for dep in _iter_dependencies(dependant):
            call = getattr(dep, "call", None)
            if call is None:
                continue
            scope_decl = getattr(call, "_scope_declaration", None)
            if scope_decl is _SCOPE_UNSET:
                methods = getattr(route, "methods", {"?"})
                path = getattr(route, "path", "?")
                missing.append(f"  {methods} {path}")

    _startup_logger.info(
        "Scope declarations validated across %d routes.", len(routes)
    )
    if missing:
        raise RuntimeError(
            f"Routes using Requires() without scope= declaration ({len(missing)}):\n"
            + "\n".join(missing)
            + "\n  Add scope='field_name' or scope=None to each Requires() call."
        )

_validate_capability_vocabulary()
_validate_scope_declarations(app)

