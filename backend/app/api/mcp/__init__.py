"""
MCP (Model Context Protocol) Integration for Intelligence Analysis

This module provides FastMCP integration for the intelligence analysis platform,
allowing LLMs to interact with intelligence data through standardized MCP tools.
"""

from .client import IntelligenceMCPClient, get_mcp_client
from .server import mcp as intelligence_mcp_server

__all__ = ["IntelligenceMCPClient", "get_mcp_client", "intelligence_mcp_server"]

