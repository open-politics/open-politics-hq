from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware
import json
from contextlib import asynccontextmanager

# SSE keepalive: 3s pings to survive nginx proxy_read_timeout=5s (default is 15s)
import fastapi.sse
fastapi.sse._PING_INTERVAL = 3.0

# Import celery app early to initialize Redis connection for task queueing.
# load_task_modules() populates THIS process's @task registry + event-bus
# subscriptions (the worker gets the same set via Celery's `imports`).
from app.core.celery_app import celery, load_task_modules  # noqa: F401
load_task_modules()
from app.core.config import settings

from app.api.api_router_global import api_router

# /tools is mounted only when COMPUTE is in the deployment ceiling (see the
# mount below). Importing it costs ~6.5s of the process's ~9s startup, because
# it drags in the whole FastMCP client+server stack and beartype's 344 modules.
# So the import follows the same gate as the mount.
MCP_ENABLED = "compute" in settings.deployment_capability_names
if MCP_ENABLED:
    from app.api.modules.conversational_intelligence.mcp_server.server import (
        mcp as intelligence_mcp_server,
    )


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


# Use stateless_http=True for production HTTP deployment to avoid session issues.
# FastAPI's `mount` will handle the path, so we don't specify it here.
mcp_asgi_app = (
    intelligence_mcp_server.http_app(stateless_http=True) if MCP_ENABLED else None
)


# As per FastMCP documentation for combining lifespans
@asynccontextmanager
async def combined_lifespan(app: FastAPI):

    
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

class BodySizeLimitMiddleware:
    """Cap every request body at MAX_UPLOAD_SIZE_BYTES.

    Content-Length is rejected up front; the wrapped receive() then counts what
    actually arrives, which is what catches a chunked upload sending no header.
    Added before CORSMiddleware so a 413 still carries CORS headers.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = settings.MAX_UPLOAD_SIZE_BYTES
        too_large = HTTPException(
            status_code=413,
            detail=f"Request body exceeds maximum size of {limit} bytes",
        )

        for name, value in scope.get("headers", ()):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    break              # unparseable: the byte count below decides
                if declared > limit:
                    await self._reject(send, too_large)
                    return
                break

        received = 0
        started = False

        async def counting_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Caught by Starlette's ExceptionMiddleware, below us.
                    raise too_large
            return message

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except HTTPException as e:
            if e is not too_large or started:
                raise
            await self._reject(send, too_large)

    @staticmethod
    async def _reject(send, exc: HTTPException) -> None:
        body = json.dumps({"detail": exc.detail}).encode()
        await send({
            "type": "http.response.start",
            "status": exc.status_code,
            "headers": [(b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode())],
        })
        await send({"type": "http.response.body", "body": body})


app.add_middleware(BodySizeLimitMiddleware)


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

class ResponseHeadersMiddleware:
    """Security headers on every response; no-transform on event streams.

    Upstream proxies (nginx, the Next.js dev rewrite) gzip and batch small SSE
    frames unless told otherwise. `no-transform`, nginx's `X-Accel-Buffering: no`
    and an explicit identity encoding together cover the variants.
    """

    CSP = (
        b"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        b"style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; "
        b"font-src 'self' data:; connect-src 'self' https: wss:; frame-ancestors 'none'"
    )

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
                    headers.append(
                        (b"strict-transport-security", b"max-age=31536000; includeSubDomains")
                    )
                headers.append((b"x-content-type-options", b"nosniff"))
                headers.append((b"x-frame-options", b"DENY"))
                headers.append((b"x-xss-protection", b"1; mode=block"))
                headers.append((b"content-security-policy", self.CSP))

                is_sse = any(
                    name == b"content-type" and b"text/event-stream" in value.lower()
                    for name, value in headers
                )
                if is_sse:
                    headers = [
                        (n, v) for (n, v) in headers
                        if n not in (b"cache-control", b"content-encoding", b"x-accel-buffering")
                    ]
                    headers.append((b"cache-control", b"no-cache, no-store, no-transform"))
                    headers.append((b"x-accel-buffering", b"no"))
                    headers.append((b"content-encoding", b"identity"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


app.add_middleware(ResponseHeadersMiddleware)

# MCP exposes workspace search, annotation runs, and asset CRUD — all require compute.
if mcp_asgi_app is not None:
    app.mount("/tools", mcp_asgi_app)

app.include_router(api_router, prefix=settings.API_V1_STR)


# ─── Startup scope declaration validation ───
# Every route using Requires() must declare scope= to prevent silent data leaks.

import logging as _logging
_startup_logger = _logging.getLogger("app.startup")

def _iter_api_routes(app_instance):
    """Every APIRoute reachable from the app, including inside included routers.

    FastAPI stopped flattening `include_router` into `app.routes`: it now leaves
    a lazy `_IncludedRouter` placeholder that keeps the real router under
    `original_router`.
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
    ceiling's vocabulary is spelled out in both places.
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
    from app.api.modules.identity_infospace_user.access import _SCOPE_UNSET
    missing = []
    routes = list(_iter_api_routes(app_instance))

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

