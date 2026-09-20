"""
mcp.py — feature: let the endpoint call our own MCP server itself.
==================================================================

  PROVIDES = ("mcp_tool",)  ──►  p.mcp_tool(tool, headers)
                                  ──► passthrough entry, or None (caller
                                      falls back to running it via our
                                      own executor)

  requires p.extra["mcp_server_url"]; unset ──► always None, always safe

  our server: /tools (main.py) · stateless_http · JWT'd against SECRET_KEY
              · gated on the COMPUTE deployment capability

  {tool, headers} ──► {type: "mcp", server_label, server_url,
                        require_approval: "never", headers?, allowed_tools?}

  NOT IN THIS FILE
    ../dialects/items.py   the only caller: encode_tools() tries this
                            first, falls back to tool_parts() on None.
    conversation_service    mints the scoped token passed in as
                            `mcp_headers`.

Opt-in per deployment: reachable for a cloud API against a public instance,
impossible for an air-gapped one. The old OpenAI provider accepted
`mcp_headers` and never read it — minted and threaded through three call
sites for nothing.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

PROVIDES = ("mcp_tool",)


def mcp_tool(p, tool: Dict[str, Any],
             headers: Optional[Dict[str, str]] = None) -> Optional[Dict[str, Any]]:
    """Declared MCP tool → a native passthrough entry, or ``None``.

    Returning ``None`` means "not eligible" and the caller falls back to
    treating it as an ordinary function the executor will run — which is the
    safe default whenever the server URL is unset.
    """
    server_url = p.extra.get("mcp_server_url")
    if not server_url:
        return None            # not reachable from this endpoint; use our executor

    label = tool.get("server_label") or "hq"
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
