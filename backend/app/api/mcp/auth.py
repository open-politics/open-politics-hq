"""
Simplified MCP Authentication

FastMCP handles JWT authentication automatically with the JWTVerifier.
This module is kept minimal as most auth logic is now handled by FastMCP.
"""
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger(__name__)


class ForwardAuthMiddleware(BaseHTTPMiddleware):
    """
    Simple pass-through middleware.
    FastMCP's JWTVerifier handles all authentication automatically.
    """
    async def dispatch(self, request: Request, call_next):
        # FastMCP handles JWT authentication automatically
        return await call_next(request)
