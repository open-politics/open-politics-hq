"""
Universal asset query endpoints (AQL).

POST /infospaces/{id}/query — Search assets via AQL query string.
GET  /infospaces/{id}/query/fields — Available annotation fields + entity types for query helpers.

The query endpoint returns tiered results:
  1. name_matches — bundles and assets matching by name (direct hits)
  2. results — content/FTS matches (top-level assets only)
  3. child_results — page-level hits grouped by parent asset
"""

import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from app.api.dependency_injection import SessionDep
from app.api.modules.content.query_parser import parse
from app.api.modules.content.models import Asset, AssetKind, Bundle
from app.api.modules.content.query import AssetQuery
from app.api.modules.identity_infospace_user.access import Access, Requires
from app.schemas import AssetRead, BundleRead

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Schemas ───

class QueryRequest(BaseModel):
    q: str = Field(description="AQL query string")
    parent_asset_id: Optional[int] = Field(default=None, description="Scope search to children of this asset")
    cursor: Optional[int] = Field(default=None, description="Last asset ID for cursor pagination")
    offset: int = Field(default=0, description="Offset for relevance-sorted pagination")
    limit: int = Field(default=50, ge=1, le=200, description="Page size")
    sort: str = Field(default="relevance", description="relevance | created_at_desc | created_at_asc | title | part_index")


class QueryResult(BaseModel):
    asset: AssetRead
    score: Optional[float] = None
    highlight: Optional[str] = None


class NameMatches(BaseModel):
    bundles: List[BundleRead] = []
    assets: List[QueryResult] = []


class ChildResultGroup(BaseModel):
    parent_asset_id: int
    parent_title: str
    matches: List[QueryResult]


class QueryResponse(BaseModel):
    query: str
    parsed: Dict[str, Any]
    name_matches: NameMatches = Field(default_factory=NameMatches)
    results: List[QueryResult]
    child_results: List[ChildResultGroup] = []
    total: int
    has_more: bool
    cursor_next: Optional[int] = None


# ─── Helpers ───

def _find_matching_bundles(
    session, infospace_id: int, text_query: str, scope
) -> List[BundleRead]:
    """Find bundles whose name matches the search text."""
    if not text_query:
        return []
    pat = f"%{text_query}%"
    stmt = (
        select(Bundle)
        .where(Bundle.infospace_id == infospace_id, Bundle.name.ilike(pat))
        .order_by(
            # Exact match first, then starts-with, then contains
            func.lower(Bundle.name) != func.lower(text_query),
            ~Bundle.name.ilike(f"{text_query}%"),
            Bundle.name.asc(),
        )
        .limit(10)
    )
    if scope is not None:
        ids = scope.bundle_ids
        if not ids:
            return []
        stmt = stmt.where(Bundle.id.in_(ids))
    bundles = list(session.exec(stmt).all())
    return [BundleRead.model_validate(b) for b in bundles]


def _boost_title_matches(results: List[QueryResult], text_query: str) -> None:
    """Boost scores in-place for assets whose title matches the query text."""
    if not text_query:
        return
    q_lower = text_query.lower()
    for i, r in enumerate(results):
        title = (r.asset.title or "").lower()
        if q_lower in title:
            if title == q_lower:
                boosted = 1.0
            elif title.startswith(q_lower):
                boosted = 0.95
            else:
                pos = title.find(q_lower)
                boosted = 0.85 + (0.1 * (1 - pos / max(len(title), 1)))
            results[i] = r.model_copy(update={"score": round(max(r.score or 0, boosted), 4)})
    results.sort(key=lambda r: r.score or 0, reverse=True)


def _find_child_matches(
    session, infospace_id: int, parsed, scope,
    parent_ids_in_results: set[int],
    per_parent: int = 3,
) -> List[ChildResultGroup]:
    """Run a secondary query for child/page-level matches, grouped by parent."""
    if not parsed.text:
        return []
    unlimited = per_parent < 0
    if unlimited:
        per_parent = 500
    max_parents = 50 if unlimited else max(10, per_parent * 3)
    total_limit = 500 if unlimited else max(100, per_parent * max_parents)

    cq = AssetQuery(session, infospace_id)
    cq.text(parsed.text, mode="fts")
    cq.exclude_superseded()
    cq.children_only()
    cq.scope(scope)
    cq.sort("relevance")
    cq.paginate(limit=total_limit)

    rows = cq.execute_scored()
    if not rows:
        return []

    groups: dict[int, list[QueryResult]] = defaultdict(list)
    parent_titles: dict[int, str] = {}
    for asset, score, highlight in rows:
        pid = asset.parent_asset_id
        if pid is None:
            continue
        if len(groups[pid]) >= per_parent:
            continue
        groups[pid].append(QueryResult(
            asset=AssetRead.model_validate(asset),
            score=round(score, 4) if score is not None else None,
            highlight=highlight,
        ))
        if pid not in parent_titles:
            parent = session.get(Asset, pid)
            parent_titles[pid] = parent.title if parent else f"Asset #{pid}"

    sorted_pids = sorted(
        groups.keys(),
        key=lambda pid: (pid not in parent_ids_in_results, -len(groups[pid])),
    )

    return [
        ChildResultGroup(
            parent_asset_id=pid,
            parent_title=parent_titles.get(pid, f"Asset #{pid}"),
            matches=groups[pid],
        )
        for pid in sorted_pids[:max_parents]
    ]


# ─── Endpoint ───

@router.post("/infospaces/{infospace_id}/query", response_model=QueryResponse, tags=["Query"])
async def query_assets(
    body: QueryRequest,
    session: SessionDep,
    access: Access = Requires(),
):
    infospace_id = access.infospace_id
    parsed = parse(body.q)

    # Allow empty text when scoped to specific items (browse children / scope filter)
    # Also allow empty queries in browse mode (non-relevance sort) for feed/channel usage
    has_parent_scope = body.parent_asset_id is not None
    has_scope = has_parent_scope or bool(parsed.asset_refs) or bool(parsed.bundle_refs)
    is_browse_mode = body.sort != "relevance"
    if parsed.is_empty and not has_scope and not is_browse_mode:
        return QueryResponse(query=body.q, parsed={}, results=[], total=0, has_more=False)

    # ── Main query (top-level assets, as before) ──
    aq = AssetQuery.from_aql(session, infospace_id, parsed, parent_asset_id=body.parent_asset_id)
    aq.scope(access.scope)

    sort = body.sort
    if has_parent_scope and sort == "relevance" and not parsed.has_text:
        sort = "part_index"
    aq.sort(sort)

    max_limit = 500 if has_parent_scope else 200

    if sort == "relevance" and body.offset:
        aq.offset(body.offset)
        aq.paginate(cursor=None, limit=body.limit, max_limit=max_limit)
    else:
        aq.paginate(cursor=body.cursor, limit=body.limit, max_limit=max_limit)

    total = aq.count()

    if parsed.has_semantic:
        rows = await aq.execute_scored_async()
    else:
        rows = aq.execute_scored()

    all_results = [
        QueryResult(
            asset=AssetRead.model_validate(asset),
            score=round(score, 4) if score is not None else None,
            highlight=highlight,
        )
        for asset, score, highlight in rows
    ]

    # ── Title boost — keep results in list, just raise score ──
    raw_text = parsed.text or ""
    name_matches = NameMatches()

    if raw_text and not has_scope:
        name_matches.bundles = _find_matching_bundles(session, infospace_id, raw_text, access.scope)
        _boost_title_matches(all_results, raw_text)

    # ── Child/page results ──
    child_results: List[ChildResultGroup] = []
    children_limit = parsed.children_limit  # None=default(3), 0=hide, N=custom
    if raw_text and not has_scope and children_limit != 0:
        per_parent = children_limit if children_limit is not None else 3
        parent_ids_in_results = {r.asset.id for r in all_results}
        child_results = _find_child_matches(
            session, infospace_id, parsed, access.scope,
            parent_ids_in_results, per_parent=per_parent,
        )

    # ── Pagination (on content results tier) ──
    last_id = all_results[-1].asset.id if all_results else None
    has_more = len(all_results) == body.limit and len(all_results) < total

    return QueryResponse(
        query=body.q,
        parsed=parsed.to_dict(),
        name_matches=name_matches,
        results=all_results,
        child_results=child_results,
        total=total,
        has_more=has_more,
        cursor_next=last_id if has_more else None,
    )


# ─── Query helper: available fields ───

class SchemaField(BaseModel):
    key: str
    type: str = "string"

class SchemaInfo(BaseModel):
    id: int
    name: str
    fields: List[SchemaField]

class RunInfo(BaseModel):
    id: int
    name: str
    status: str
    schema_names: List[str]

class QueryFieldsResponse(BaseModel):
    schemas: List[SchemaInfo]
    entity_types: List[str]
    runs: List[RunInfo]


def _extract_schema_fields(contract: Optional[Dict[str, Any]], prefix: str = "") -> List[SchemaField]:
    """Extract queryable field names from a JSON Schema output_contract."""
    if not contract or not isinstance(contract, dict):
        return []

    fields: List[SchemaField] = []
    props = contract.get("properties", {})
    if not isinstance(props, dict):
        return []

    for key, spec in props.items():
        full_key = f"{prefix}{key}" if not prefix else f"{prefix}.{key}"
        if not isinstance(spec, dict):
            fields.append(SchemaField(key=full_key, type="string"))
            continue

        raw_type = spec.get("type", "string")
        if raw_type in ("number", "integer"):
            fields.append(SchemaField(key=full_key, type="number"))
        elif raw_type == "boolean":
            fields.append(SchemaField(key=full_key, type="boolean"))
        elif raw_type == "array":
            fields.append(SchemaField(key=full_key, type="array"))
        elif raw_type == "object":
            # Recurse into nested objects
            nested = _extract_schema_fields(spec, full_key)
            if nested:
                fields.extend(nested)
            else:
                fields.append(SchemaField(key=full_key, type="object"))
        else:
            fields.append(SchemaField(key=full_key, type="string"))

    return fields


@router.get(
    "/infospaces/{infospace_id}/query/fields",
    response_model=QueryFieldsResponse,
    tags=["Query"],
)
async def get_query_fields(session: SessionDep, access: Access = Requires()):
    """Return available annotation fields, entity types, and recent runs for the query helper panel."""
    from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema, RunSchemaLink
    from app.api.modules.graph.models import EntityCanonical
    from sqlalchemy import column as sa_col

    infospace_id = access.infospace_id

    # Active annotation schemas with their output contracts
    schemas_query = select(AnnotationSchema).where(
            AnnotationSchema.infospace_id == infospace_id,
            AnnotationSchema.is_active == True,
        )
    schemas_query = access.scope_filter(schemas_query, AnnotationSchema.id, "schema_ids")
    schemas = session.exec(schemas_query).all()

    schema_infos = []
    schema_name_map: Dict[int, str] = {}
    for s in schemas:
        schema_name_map[s.id] = s.name
        fields = _extract_schema_fields(s.output_contract)
        if fields:
            schema_infos.append(SchemaInfo(id=s.id, name=s.name, fields=fields))

    # Distinct entity types in this infospace
    entity_type_query = (
        select(EntityCanonical.entity_type)
        .where(EntityCanonical.infospace_id == infospace_id)
        .distinct()
    )
    entity_type_query = access.scope_filter(entity_type_query, EntityCanonical.id, "entity_canonical_ids")
    entity_rows = session.exec(entity_type_query).all()

    # Recent annotation runs (latest 30, completed/running)
    runs_query = (
        select(AnnotationRun)
        .where(AnnotationRun.infospace_id == infospace_id)
        .order_by(AnnotationRun.created_at.desc())
        .limit(30)
    )
    runs_query = access.scope_filter(runs_query, AnnotationRun.id, "run_ids")
    runs = session.exec(runs_query).all()

    run_infos = []
    for r in runs:
        # Get schema names via the relationship link table
        schema_ids = session.exec(
            select(RunSchemaLink.schema_id).where(RunSchemaLink.run_id == r.id)
        ).all()
        names = [schema_name_map.get(sid, f"#{sid}") for sid in schema_ids]
        run_infos.append(RunInfo(
            id=r.id,
            name=r.name or f"Run #{r.id}",
            status=r.status.value if hasattr(r.status, 'value') else str(r.status),
            schema_names=names,
        ))

    return QueryFieldsResponse(
        schemas=schema_infos,
        entity_types=list(entity_rows),
        runs=run_infos,
    )
