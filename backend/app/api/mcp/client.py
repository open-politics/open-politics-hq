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


def create_mcp_context_token(user_id: int, infospace_id: int, conversation_id: Optional[int] = None) -> str:
    """Creates a short-lived JWT to securely pass context to the MCP server."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {
        "exp": expire,
        "sub": str(user_id),
        "infospace_id": infospace_id
    }
    
    # Include conversation_id if provided (for task persistence)
    if conversation_id is not None:
        to_encode["conversation_id"] = conversation_id
    
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=security.ALGORITHM)
    return encoded_jwt


def create_mcp_context_token_with_api_keys(user_id: int, infospace_id: int, api_keys: Dict[str, str], conversation_id: Optional[int] = None) -> str:
    """
    Creates a short-lived JWT for MCP server authentication.
    
    Note: API keys are NO LONGER stored in JWT. Server looks up stored credentials.
    This function signature kept for backwards compatibility but ignores api_keys parameter.
    """
    # Call the simple token creation (no API keys in JWT)
    return create_mcp_context_token(user_id, infospace_id, conversation_id)


class IntelligenceMCPClient:
    """
    Simplified client for executing intelligence analysis MCP tools.
    
    Uses FastMCP's built-in capabilities for clean tool execution.
    """
    
    def __init__(self, user_id: int, infospace_id: int, context_token: Optional[str] = None):
        self.user_id = user_id
        self.infospace_id = infospace_id
        # Use provided token or create a new one
        self.context_token = context_token or create_mcp_context_token(user_id, infospace_id)
        
        # Determine MCP server URL based on deployment architecture
        # Priority: 1. Explicit MCP_SERVER_URL (for separate MCP container/service)
        #           2. Localhost (default - client and server in same process)
        if settings.MCP_SERVER_URL:
            # Explicit override for deployments where MCP server is separate
            # Example: microservices with dedicated MCP container
            mcp_url = f"{settings.MCP_SERVER_URL}/tools/mcp"
        else:
            # Default: Use localhost for same-process communication
            # In production, the client and server run in the same container,
            # so they communicate via localhost, not through the ingress
            server_port = os.getenv("BACKEND_PORT", 8022)
            mcp_url = f"http://localhost:{server_port}/tools/mcp"
        
        logger.info(f"Initializing MCP client with URL: {mcp_url} (environment: {settings.ENVIRONMENT})")

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

    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute an MCP tool and return both LLM content and frontend data.
        
        FastMCP ToolResult provides two streams:
        - content: Concise text for LLM conversation (~200-500 chars)
        - data: Full structured data for frontend rendering
        
        Returns:
            Dict with:
            - content: Concise text for LLM (from result.content)
            - structured_content: Full data for frontend (from result.data)
            - error: Error message if tool failed
        """
        if not self._is_connected:
            raise RuntimeError("MCP client is not connected.")

        logger.info(f"Executing MCP tool: {tool_name} with args: {arguments}")
        
        try:
            result = await self._connected_client.call_tool(tool_name, arguments or {})
            
            # Extract concise text content for LLM (what model should see)
            content_text = None
            if hasattr(result, 'content') and result.content:
                text_parts = []
                for content_item in result.content:
                    if hasattr(content_item, 'text'):
                        text_parts.append(content_item.text)
                    elif hasattr(content_item, 'model_dump'):
                        dumped = content_item.model_dump()
                        if 'text' in dumped:
                            text_parts.append(dumped['text'])
                content_text = "\n".join(text_parts) if text_parts else None
            
            # Extract structured data for frontend (what user should see in UI)
            structured_data = None
            if hasattr(result, 'data') and result.data is not None:
                if hasattr(result.data, 'model_dump'):
                    structured_data = result.data.model_dump()
                else:
                    structured_data = result.data
            
            # Return both streams - never discard either!
            return {
                "content": content_text,
                "structured_content": structured_data,
            }
            
        except Exception as e:
            logger.error(f"MCP tool execution failed: {tool_name} - {e}", exc_info=True)
            return {"error": f"Tool execution failed: {str(e)}"}
    
    async def get_available_tools(self) -> List[Dict[str, Any]]:
        """
        Get available tools from the MCP server.
        
        Returns tools in a provider-agnostic format that can be adapted
        by individual language model providers.
        """
        if not self._is_connected:
            raise RuntimeError("MCP client is not connected.")
        
        try:
            tools = await self._connected_client.list_tools()
            tool_definitions = []
            
            for tool in tools:
                # Skip tools without required fields
                if not hasattr(tool, 'name') or not tool.name:
                    logger.warning(f"Skipping tool without name: {tool}")
                    continue
                
                tool_def = {
                    "type": "mcp",
                    "name": tool.name,
                    "description": tool.description or f"Execute {tool.name}",
                }
                
                # Add input schema (parameters)
                if hasattr(tool, 'inputSchema') and tool.inputSchema:
                    tool_def["parameters"] = tool.inputSchema
                else:
                    # Default empty schema if none provided
                    tool_def["parameters"] = {"type": "object", "properties": {}}
                
                # Add output schema if available (for structured responses)
                if hasattr(tool, 'outputSchema') and tool.outputSchema:
                    tool_def["output_schema"] = tool.outputSchema
                
                tool_definitions.append(tool_def)
            
            logger.info(f"Retrieved {len(tool_definitions)} tools from MCP server")
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
    infospace_id: int,
    api_keys: Optional[Dict[str, str]] = None
):
    """
    Context manager for getting an initialized MCP client.
    
    Note: api_keys parameter is ignored - server looks up stored credentials.
    """
    # Create simple token (no API keys)
    token = create_mcp_context_token(user_id, infospace_id)
    client = IntelligenceMCPClient(user_id=user_id, infospace_id=infospace_id, context_token=token)
    
    async with client as connected_client:
        yield connected_client
