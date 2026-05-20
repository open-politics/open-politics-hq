"""Opaque base64 cursor helper.

Pagination cursors are opaque strings. Callers pass them through; they never
parse. Encoding can evolve without client changes.

Format: urlsafe-base64(JSON({f, d, v, i})), padding stripped.
  f = sort field name
  d = direction ("asc" | "desc")
  v = last row's sort value (scalar)
  i = last row's primary key (int)

Decode accepts the cursor *with or without* padding for robustness.
"""

from __future__ import annotations

import base64
import json
from datetime import date, datetime
from typing import Any


def _json_default(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"unsupported cursor value type: {type(obj).__name__}")


def encode_cursor(
    *,
    sort_field: str,
    direction: str,
    last_value: Any,
    last_id: int,
) -> str:
    payload = {"f": sort_field, "d": direction, "v": last_value, "i": int(last_id)}
    raw = json.dumps(payload, default=_json_default, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[str, str, Any, int]:
    padded = cursor + "=" * (-len(cursor) % 4)
    data = json.loads(base64.urlsafe_b64decode(padded))
    return data["f"], data["d"], data["v"], int(data["i"])
