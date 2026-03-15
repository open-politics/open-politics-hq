"""
Universal asset query endpoints (AQL).

POST /infospaces/{id}/query — Search assets via AQL query string.
GET  /infospaces/{id}/query/fields — Available annotation fields + entity types for query helpers.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlmodel import select

from app.api.dependency_injection import SessionDep
from app.api.modules.content.query_parser import parse
from app.api.modules.content.models import AssetKind
from app.api.modules.content.query import AssetQuery
from app.schemas import AssetRead

router = APIRouter()


# ─── Schemas ───

class QueryRequest(BaseModel):
    q: str = Field(description="AQL query string")
    cursor: Optional[int] = Field(default=None, description="Last asset ID for cursor pagination")
    offset: int = Field(default=0, description="Offset for relevance-sorted pagination")
    limit: int = Field(default=50, ge=1, le=200, description="Page size")
    sort: str = Field(default="relevance", description="relevance | created_at_desc | created_at_asc | title")


class QueryResult(BaseModel):
    asset: AssetRead
    score: Optional[float] = None
    highlight: Optional[str] = None


class QueryResponse(BaseModel):
    query: str
    parsed: Dict[str, Any]
    results: List[QueryResult]
    total: int
    has_more: bool
    cursor_next: Optional[int] = None


# ─── Endpoint ───

@router.post("/infospaces/{infospace_id}/query", response_model=QueryResponse, tags=["Query"])
async def query_assets(
    infospace_id: int,
    body: QueryRequest,
    session: SessionDep,
):
    parsed = parse(body.q)

    if parsed.is_empty:
        return QueryResponse(query=body.q, parsed={}, results=[], total=0, has_more=False)

    aq = AssetQuery.from_aql(session, infospace_id, parsed)
    aq.sort(body.sort)

    # Use offset for relevance sort (can't cursor-paginate by rank), cursor for date sorts
    if body.sort == "relevance" and body.offset:
        aq.offset(body.offset)
        aq.paginate(cursor=None, limit=body.limit)
    else:
        aq.paginate(cursor=body.cursor, limit=body.limit)

    total = aq.count()

    # Semantic search needs async path
    if parsed.has_semantic:
        rows = await aq.execute_scored_async()
    else:
        rows = aq.execute_scored()

    results = [
        QueryResult(
            asset=AssetRead.model_validate(asset),
            score=round(score, 4) if score is not None else None,
            highlight=highlight,
        )
        for asset, score, highlight in rows
    ]

    last_id = results[-1].asset.id if results else None
    has_more = len(results) == body.limit and len(results) < total

    return QueryResponse(
        query=body.q,
        parsed=parsed.to_dict(),
        results=results,
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
async def get_query_fields(infospace_id: int, session: SessionDep):
    """Return available annotation fields, entity types, and recent runs for the query helper panel."""
    from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema, RunSchemaLink
    from app.api.modules.graph.models import EntityCanonical
    from sqlalchemy import column as sa_col

    # Active annotation schemas with their output contracts
    schemas = session.exec(
        select(AnnotationSchema).where(
            AnnotationSchema.infospace_id == infospace_id,
            AnnotationSchema.is_active == True,
        )
    ).all()

    schema_infos = []
    schema_name_map: Dict[int, str] = {}
    for s in schemas:
        schema_name_map[s.id] = s.name
        fields = _extract_schema_fields(s.output_contract)
        if fields:
            schema_infos.append(SchemaInfo(id=s.id, name=s.name, fields=fields))

    # Distinct entity types in this infospace
    entity_rows = session.exec(
        select(EntityCanonical.entity_type)
        .where(EntityCanonical.infospace_id == infospace_id)
        .distinct()
    ).all()

    # Recent annotation runs (latest 30, completed/running)
    runs = session.exec(
        select(AnnotationRun)
        .where(AnnotationRun.infospace_id == infospace_id)
        .order_by(AnnotationRun.created_at.desc())
        .limit(30)
    ).all()

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
