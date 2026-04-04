"""
CSV generation for structured package exports.

All functions are pure — they take pre-serialized dicts and produce CSV bytes.
No I/O, no DB access.

The flatten_dict function is the canonical implementation, relocated from
annotation_runs.py for reuse across the codebase.
"""
from __future__ import annotations

import csv
import io
from typing import Any, Dict, List, Set

from werkzeug.utils import secure_filename


# ─── Core utility ───


def flatten_dict(d: Dict[str, Any], parent_key: str = "", sep: str = ".") -> Dict[str, Any]:
    """Flatten nested dict into dot-notation keys for CSV export.

    Examples:
        {"name": "John", "address": {"city": "NYC"}}
        -> {"name": "John", "address.city": "NYC"}

        {"tags": ["a", "b"]} -> {"tags": "a|b"}
        {"items": [{"id": 1}, {"id": 2}]} -> {"items[0].id": 1, "items[1].id": 2}
    """
    items = []
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}" if parent_key else k
        if isinstance(v, dict):
            items.extend(flatten_dict(v, new_key, sep=sep).items())
        elif isinstance(v, list):
            if v and isinstance(v[0], dict):
                for i, item in enumerate(v):
                    items.extend(flatten_dict(item, f"{new_key}[{i}]", sep=sep).items())
            else:
                items.append((new_key, "|".join(map(str, v)) if v else ""))
        else:
            items.append((new_key, v))
    return dict(items)


# ─── CSV builders ───


def build_assets_csv(assets: List[Dict[str, Any]]) -> bytes:
    """Build assets.csv: one row per asset, hierarchically ordered.

    Parents appear first, children immediately after their parent with a
    qualified name like ``EFTA00039806.0`` or ``inbox.3``.
    The kind column already tells you what type of child it is.
    """
    COLUMNS = [
        "name", "uuid", "kind", "parent_title", "parent_uuid",
        "file", "source_url", "created_at",
    ]

    # Build lookups
    by_uuid: Dict[str, Dict[str, Any]] = {a["uuid"]: a for a in assets if "uuid" in a}
    by_id: Dict[Any, Dict[str, Any]] = {}
    for a in assets:
        if a.get("id"):
            by_id[a["id"]] = a

    # Separate parents and children
    parents = [a for a in assets if not a.get("parent_asset_id")]
    children_by_parent: Dict[Any, List[Dict[str, Any]]] = {}
    for a in assets:
        pid = a.get("parent_asset_id")
        if pid:
            children_by_parent.setdefault(pid, []).append(a)
    for pid in children_by_parent:
        children_by_parent[pid].sort(key=lambda x: x.get("part_index") or 0)

    def _kind_str(a: Dict[str, Any]) -> str:
        k = a.get("kind", "")
        return k.get("value", str(k)) if isinstance(k, dict) else str(k)

    def _qualified_name(a: Dict[str, Any], parent_title: str = "") -> str:
        if not a.get("parent_asset_id"):
            return a.get("title", a.get("uuid", "?"))
        idx = a.get("part_index")
        suffix = str(idx) if idx is not None else "0"
        if parent_title:
            return f"{parent_title}.{suffix}"
        return suffix

    def _resolve_parent(a: Dict[str, Any]):
        """Return (parent_title, parent_uuid) or ("", "")."""
        pid = a.get("parent_asset_id")
        if pid and pid in by_id:
            p = by_id[pid]
            return p.get("title", ""), p.get("uuid", "")
        puuid = a.get("parent_asset_uuid")
        if puuid and puuid in by_uuid:
            p = by_uuid[puuid]
            return p.get("title", ""), puuid
        return "", ""

    # Build ordered rows: parent, then its children, then next parent
    ordered: List[Dict[str, Any]] = []
    for p in sorted(parents, key=lambda x: x.get("title", "")):
        ordered.append(p)
        pid = p.get("id")
        if pid and pid in children_by_parent:
            ordered.extend(children_by_parent[pid])

    # Add orphan children (parent not in export)
    seen_ids = {a.get("id") for a in ordered}
    for a in assets:
        if a.get("id") not in seen_ids:
            ordered.append(a)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for asset in ordered:
        pt, pu = _resolve_parent(asset)
        writer.writerow({
            "name": _qualified_name(asset, pt),
            "uuid": asset.get("uuid", ""),
            "kind": _kind_str(asset),
            "parent_title": pt,
            "parent_uuid": pu,
            "file": asset.get("blob_file_reference", ""),
            "source_url": asset.get("source_identifier", ""),
            "created_at": asset.get("created_at", ""),
        })
    return output.getvalue().encode("utf-8")


def build_annotations_csv(
    annotations: List[Dict[str, Any]],
    *,
    flatten_json: bool = True,
    include_justifications: bool = True,
) -> bytes:
    """Build a per-(run, schema) CSV: documents as rows, schema fields as columns.

    Same logic as the annotation_runs.py CSV export but operating on
    pre-serialized dicts instead of ORM models.
    """
    if not annotations:
        return b""

    rows: List[Dict[str, Any]] = []
    for ann in annotations:
        row: Dict[str, Any] = {
            "annotation_uuid": ann.get("uuid"),
            "asset_id": ann.get("asset_id"),
            "schema_id": ann.get("schema_id"),
            "run_id": ann.get("run_id"),
            "status": ann.get("status"),
            "timestamp": ann.get("timestamp"),
        }

        # Asset reference
        asset_ref = ann.get("asset_reference", {})
        if asset_ref:
            row["asset_title"] = asset_ref.get("title")
            row["asset_uuid"] = asset_ref.get("uuid")

        # Schema reference
        schema_ref = ann.get("schema_reference", {})
        if schema_ref:
            row["schema_name"] = schema_ref.get("name")
            row["schema_version"] = schema_ref.get("version")

        # Justifications
        if include_justifications and ann.get("justifications"):
            texts = []
            for j in ann["justifications"]:
                field_label = f"{j.get('field_name', '')}:" if j.get("field_name") else ""
                texts.append(f"{field_label}{j.get('reasoning', '')}")
            row["justifications"] = " | ".join(texts)

        # Value: flatten or stringify
        value = ann.get("value")
        if flatten_json and value and isinstance(value, dict):
            row.update(flatten_dict(value, parent_key="value"))
        elif value is not None:
            row["value_json"] = str(value)

        rows.append(row)

    # Stable column ordering: metadata first, then value.* sorted
    all_fields: Set[str] = set()
    for r in rows:
        all_fields.update(r.keys())
    meta_fields = sorted(f for f in all_fields if not f.startswith("value.") and f != "value_json")
    value_fields = sorted(f for f in all_fields if f.startswith("value."))
    if "value_json" in all_fields:
        value_fields.append("value_json")
    fieldnames = meta_fields + value_fields

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def build_schemas_csv(schemas: List[Dict[str, Any]]) -> bytes:
    """Build schemas.csv: index of schemas with pointers to their JSON definitions.

    The CSV is a lightweight lookup table. Full schema definitions (output_contract)
    are exported as separate JSON files under data/schemas/ — same format as the
    schema manager export, directly re-importable.
    """
    COLUMNS = [
        "uuid", "name", "version", "description", "target_level",
        "field_count", "fields", "schema_file",
    ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for schema in schemas:
        contract = schema.get("output_contract") or {}
        properties = contract.get("properties") or {}
        name = schema.get("name", "unnamed")
        version = schema.get("version", "0")
        writer.writerow({
            "uuid": schema.get("uuid"),
            "name": name,
            "version": version,
            "description": schema.get("description", ""),
            "target_level": schema.get("target_level", "asset"),
            "field_count": len(properties),
            "fields": ", ".join(sorted(properties.keys())),
            "schema_file": f"schemas/{safe_csv_filename(f'{name}_v{version}', '.json')}",
        })
    return output.getvalue().encode("utf-8")


def build_lineage_csv(entries: List[Dict[str, Any]]) -> bytes:
    """Build lineage.csv: full audit trail.

    Each entry: entity_type, entity_uuid, entity_name, action, timestamp,
                source_run, source_schema, model_name.
    """
    COLUMNS = [
        "entity_type", "entity_uuid", "entity_name", "action",
        "timestamp", "source_run", "source_schema", "model_name",
    ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for entry in entries:
        writer.writerow({col: entry.get(col, "") for col in COLUMNS})
    return output.getvalue().encode("utf-8")


def safe_csv_filename(name: str, suffix: str = ".csv") -> str:
    """Make a name safe for use as a filename within the ZIP."""
    secured = secure_filename(name)
    if not secured:
        secured = "unnamed"
    return secured + suffix
