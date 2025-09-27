"""
MCP Client for Intelligence Analysis Tools

This module provides a client interface for interacting with the intelligence
analysis MCP server, allowing language model providers to use MCP tools.

The client uses existing Pydantic schemas for consistent serialization and validation.
"""
import logging
from typing import Dict, Any, List, Optional
import asyncio
from contextlib import asynccontextmanager
from sqlmodel import Session
from datetime import datetime, timezone, timedelta
from fastmcp import Client, FastMCP
from fastmcp.client.auth import BearerAuth

from app.api.services.asset_service import AssetService
from app.api.services.annotation_service import AnnotationService
from app.api.services.content_ingestion_service import ContentIngestionService
from app.api.services.bundle_service import BundleService
from app.core.config import settings
from app.api.providers.factory import create_storage_provider, create_model_registry
from app.core import security
from jose import jwt
import os

logger = logging.getLogger(__name__)


def create_mcp_context_token(user_id: int, infospace_id: int) -> str:
    """Creates a short-lived JWT to securely pass context to the MCP server."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {
        "exp": expire,
        "sub": str(user_id),
        "infospace_id": infospace_id
    }
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=security.ALGORITHM)
    return encoded_jwt


class IntelligenceMCPClient:
    """
    Simplified client for executing intelligence analysis MCP tools.
    
    Uses FastMCP's built-in capabilities for clean tool execution.
    """
    
    def __init__(self, user_id: int, infospace_id: int):
        self.user_id = user_id
        self.infospace_id = infospace_id
        # Create context token for authentication
        self.context_token = create_mcp_context_token(user_id, infospace_id)
        
        # The FastAPI and MCP server are running on the same port.
        server_port = os.getenv("BACKEND_PORT", 8022)
        
        mcp_url = f"http://localhost:{server_port}/tools/mcp"

        self.mcp_client = Client(
            mcp_url,
            auth=BearerAuth(self.context_token)
        )
        self._is_connected = False

    async def __aenter__(self):
        # Enter the FastMCP client context and store it.
        # Implements a retry mechanism to handle race conditions where the
        # client tries to connect before the server is fully ready.
        attempts = 5
        delay = 0.2
        last_exc = None

        for i in range(attempts):
            try:
                self._connected_client = await self.mcp_client.__aenter__()
                self._is_connected = True
                logger.info(f"MCP client connected for user {self.user_id}, infospace {self.infospace_id}")
                return self
            except RuntimeError as e:
                last_exc = e
                if "Client failed to connect" in str(e):
                    if i < attempts - 1:
                        logger.warning(f"MCP connection attempt {i + 1}/{attempts} failed. Retrying in {delay}s...")
                        await asyncio.sleep(delay)
                    else:
                        logger.error(f"MCP client failed to connect after {attempts} attempts.")
                        raise e
                else:
                    # Re-raise if it's not the connection error we're expecting
                    raise e
        
        if last_exc:
            raise last_exc


    async def __aexit__(self, exc_type, exc_val, exc_tb):
        # Exit the FastMCP client context
        if hasattr(self, '_connected_client'):
            await self.mcp_client.__aexit__(exc_type, exc_val, exc_tb)
        self._is_connected = False
        self._connected_client = None
        logger.info("MCP client disconnected")

    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """
        Execute an MCP tool with the given arguments.
        
        Args:
            tool_name: Name of the tool to execute
            arguments: Arguments for the tool call
            
        Returns:
            Tool execution result - FastMCP automatically deserializes to Python objects
        """
        if not self._is_connected:
            raise RuntimeError("MCP client is not connected.")

        logger.info(f"Executing MCP tool: {tool_name} with args: {arguments}")
        
        try:
            # The context token is passed via the auth provider during client initialization.
            result = await self._connected_client.call_tool(
                tool_name, 
                arguments or {}
            )
            
            # FastMCP automatically deserializes structured output to Python objects
            # The .data property contains the fully hydrated objects
            if hasattr(result, 'data') and result.data is not None:
                logger.info(f"MCP tool {tool_name} executed successfully with structured output")
                return result.data
            elif hasattr(result, 'content') and result.content:
                # Fallback to content blocks if no structured data
                logger.info(f"MCP tool {tool_name} executed successfully with content blocks")
                return result.content
            else:
                logger.warning(f"MCP tool {tool_name} returned empty result")
                return None
            
        except Exception as e:
            logger.error(f"MCP tool execution failed: {tool_name} - {e}", exc_info=True)
            return {"error": f"Tool execution failed: {str(e)}"}
    
    async def get_available_tools(self) -> List[Dict[str, Any]]:
        """
        Get available tools from the MCP server dynamically.
        
        FastMCP automatically generates tool schemas from function signatures.
        """
        if not self._is_connected:
            raise RuntimeError("MCP client is not connected.")
        
        try:
            # Get tools from the server using FastMCP client
            tools = await self._connected_client.list_tools()
            
            # Convert to the format expected by language model providers
            tool_definitions = []
            for tool in tools:
                tool_def = {
                    "type": "mcp",
                    "name": tool.name,
                    "description": tool.description or f"Execute {tool.name}",
                }
                
                # Add input schema if available (FastMCP uses inputSchema)
                if hasattr(tool, 'inputSchema') and tool.inputSchema:
                    tool_def["parameters"] = tool.inputSchema
                
                tool_definitions.append(tool_def)
            
            return tool_definitions
            
        except Exception as e:
            logger.error(f"Failed to get available tools: {e}")
            return []

    async def get_available_resources(self) -> List[Dict[str, Any]]:
        """
        Get available resources from the MCP server.
        """
        if not self._is_connected:
            raise RuntimeError("MCP client is not connected.")
        
        try:
            # Get resources using FastMCP client
            resources = await self._connected_client.list_resources()
            return [
                {
                    "uri": resource.uri,
                    "name": resource.name,
                    "description": resource.description,
                    "mimeType": getattr(resource, 'mimeType', None)
                }
                for resource in resources
            ]
        except Exception as e:
            logger.error(f"Failed to get available resources: {e}")
            return []

    async def read_resource(self, uri: str) -> Any:
        """
        Read a resource from the MCP server.
        
        Args:
            uri: Resource URI to read
            
        Returns:
            Resource content
        """
        if not self._is_connected:
            raise RuntimeError("MCP client is not connected.")
        
        try:
            # Use FastMCP client to read resource. Auth is handled by the client.
            content = await self._connected_client.read_resource(uri)
            return content
        except Exception as e:
            logger.error(f"Failed to read resource {uri}: {e}")
            return {"error": f"Failed to read resource: {str(e)}"}


@asynccontextmanager
async def get_mcp_client(
    # These services are no longer needed for the client, but we keep them
    # to avoid changing the call sites in conversation_service.py for now.
    session: Session,
    asset_service: AssetService,
    annotation_service: AnnotationService,
    content_ingestion_service: ContentIngestionService,
    user_id: int,
    infospace_id: int
):
    """
    Context manager for getting an initialized MCP client.
    """
    async with IntelligenceMCPClient(user_id=user_id, infospace_id=infospace_id) as client:
        yield client
