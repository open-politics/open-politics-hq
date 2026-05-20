"""
CSV composition helpers
=======================

Pure functions that compose CSV row/container metadata. Used by CSV processors
and by MCP/route callers that create CSV assets directly. Kept out of
AssetBuilder so the builder stays source-type-agnostic (HQ v2 §1).

Design rule: these helpers return the derived (title, text, metadata) for a
CSV row or container. They do not instantiate AssetBuilder themselves — the
caller composes the builder with these values.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def csv_row_title(
    row_data: Dict[str, Any],
    part_index: Optional[int] = None,
) -> str:
    """Generate a CSV row title: '{index+1} | {col1: val1} | {col2: val2} | {col3: val3}'.

    Uses up to 3 non-empty columns, each value trimmed to 25 chars. If no
    meaningful values exist, falls back to 'Row N columns'.
    """
    parts: List[str] = [str((part_index or 0) + 1)]
    for key, value in list(row_data.items())[:3]:
        if value and str(value).strip():
            parts.append(f"{key}: {str(value)[:25]}")
    if len(parts) > 1:
        return " | ".join(parts)
    return f"Row {len(row_data)} columns"


def csv_row_text(
    row_data: Dict[str, Any],
    column_headers: Optional[List[str]] = None,
) -> str:
    """Pipe-join row values in a stable order.

    Uses column_headers when provided (ensures consistent ordering across rows);
    otherwise sorts row keys alphabetically.
    """
    if column_headers:
        return " | ".join(str(row_data.get(h, "")) for h in column_headers)
    return " | ".join(str(row_data.get(k, "")) for k in sorted(row_data.keys()))


def csv_row_metadata(
    row_data: Dict[str, Any],
    column_headers: Optional[List[str]] = None,
    *,
    ingestion_method: str = "csv_row_construction",
) -> Dict[str, Any]:
    """Build the file_info payload for a CSV row asset."""
    return {
        "original_row_data": row_data,
        "column_headers": column_headers or list(row_data.keys()),
        "ingestion_method": ingestion_method,
        "row_length": len(row_data),
    }


def csv_container_metadata(
    columns: List[str],
    description: Optional[str] = None,
    *,
    created_via: str = "mcp_chat",
) -> Dict[str, Any]:
    """Build the file_info payload for a CSV container (parent) asset."""
    info: Dict[str, Any] = {
        "columns": columns,
        "column_count": len(columns),
        "row_count": 0,
        "created_via": created_via,
    }
    if description:
        info["description"] = description
    return info


def merged_csv_row(
    existing_row_data: Dict[str, Any],
    updates: Dict[str, Any],
    merge_strategy: str = "overwrite",
) -> Dict[str, Any]:
    """Apply an update to an existing row's data.

    Both 'merge' and 'overwrite' produce {**existing, **updates} today —
    the distinction is kept for future divergence (e.g. list-append semantics).
    Raises ValueError on unknown strategy.
    """
    if merge_strategy not in ("merge", "overwrite"):
        raise ValueError(f"Unknown merge strategy: {merge_strategy!r}")
    return {**existing_row_data, **updates}


def csv_row_update_metadata(
    merged_row: Dict[str, Any],
    column_headers: List[str],
    updated_fields: List[str],
    merge_strategy: str,
) -> Dict[str, Any]:
    """Build the file_info payload to overwrite after a CSV row update."""
    return {
        "original_row_data": merged_row,
        "column_headers": column_headers,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "merge_strategy": merge_strategy,
        "updated_fields": updated_fields,
    }
