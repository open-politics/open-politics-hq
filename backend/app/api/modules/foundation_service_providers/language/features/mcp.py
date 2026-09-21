"""
mcp.py — feature: let the endpoint call an MCP server itself.

  PROVIDES = ("mcp_tool",)  ──►  p.mcp_tool(tool, headers)
                                  ──► passthrough entry, or None (caller
                                      falls back to our own executor)

  p.extra["mcp_connectors"]   {server_label: url}, from HQ.yml
       tool's label not in it ──► None

  our own server is the `hq` label: /tools (main.py) · stateless_http
       · JWT'd against SECRET_KEY · gated on COMPUTE

  {tool, headers} ──► {type: "mcp", server_label, server_url,
                        require_approval: "never", headers?, allowed_tools?}

  NOT IN THIS FILE
    ../dialects/items.py   the only caller: encode_tools() tries this
                            first, falls back to tool_parts() on None.
    conversation_service    mints the scoped token passed in as
                            `mcp_headers`.

Opt-in per deployment: an air-gapped instance declares no connectors and
every tool runs through our executor.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

PROVIDES = ("mcp_tool",)


def mcp_tool(p, tool: Dict[str, Any],
             headers: Optional[Dict[str, str]] = None) -> Optional[Dict[str, Any]]:
    """Declared MCP tool → a native passthrough entry, or ``None``.

    ``None`` means "not eligible": the caller treats it as an ordinary function
    and runs it through our executor. That is the default for any label this
    deployment has no connector for.
    """
    label = tool.get("server_label") or "hq"
    server_url = (p.extra.get("mcp_connectors") or {}).get(label)
    if not server_url:
        return None

    entry: Dict[str, Any] = {
        "type": "mcp",
        "server_label": label,
        "server_url": server_url,
        # Never auto-approve on our behalf: approval is the operator's call.
        "require_approval": "never",
    }
    if headers:
        entry["headers"] = dict(headers)

    allowed = tool.get("allowed_tools")
    if allowed:
        entry["allowed_tools"] = list(allowed)

    logger.debug("MCP passthrough enabled for %s → %s", label, server_url)
    return entry
