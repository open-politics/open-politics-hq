from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api import deps
from app.api.deps import CurrentUser
from app.schemas import Message
from app.api.services.filter_service import FilterService, FilterExpression, FilterFactory

router = APIRouter()

# Use a global filter service instance
filter_service = FilterService()

@router.post("/filters", response_model=Message)
def save_filter(
    *,
    filter_name: str,
    filter_config: Dict[str, Any],
    current_user: CurrentUser
):
    """Save a reusable filter definition."""
    try:
        filter_expression = filter_service.create_from_config(filter_config)
        filter_service.save_filter(filter_name, filter_expression)
        return Message(message=f"Filter '{filter_name}' saved successfully")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to save filter: {str(e)}")

@router.get("/filters", response_model=List[str])
def list_filters(current_user: CurrentUser):
    """List all saved filter names."""
    return filter_service.list_filters()

@router.get("/filters/{filter_name}", response_model=Dict[str, Any])
def get_filter(
    *,
    filter_name: str,
    current_user: CurrentUser
):
    """Get a saved filter definition."""
    filter_expression = filter_service.get_filter(filter_name)
    if not filter_expression:
        raise HTTPException(status_code=404, detail=f"Filter '{filter_name}' not found")
    
    return filter_expression.to_dict()

@router.delete("/filters/{filter_name}", response_model=Message)
def delete_filter(
    *,
    filter_name: str,
    current_user: CurrentUser
):
    """Delete a saved filter."""
    if filter_name not in filter_service.list_filters():
        raise HTTPException(status_code=404, detail=f"Filter '{filter_name}' not found")
    
    # Remove from saved filters
    del filter_service._saved_filters[filter_name]
    return Message(message=f"Filter '{filter_name}' deleted successfully")

@router.post("/filters/test", response_model=Dict[str, Any])
def test_filter(
    *,
    filter_config: Dict[str, Any],
    test_data: List[Dict[str, Any]],
    current_user: CurrentUser
):
    """Test a filter against sample data."""
    try:
        filter_expression = filter_service.create_from_config(filter_config)
        filtered_results = filter_service.apply_filter(filter_expression, test_data)
        
        return {
            "total_items": len(test_data),
            "filtered_items": len(filtered_results),
            "pass_rate": len(filtered_results) / len(test_data) if test_data else 0,
            "results": filtered_results
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Filter test failed: {str(e)}")

@router.get("/filters/examples/basic", response_model=Dict[str, Any])
def get_basic_filter_examples(current_user: CurrentUser):
    """Get examples of basic filter configurations."""
    return {
        "threshold_filter": {
            "description": "Filter items above a threshold",
            "config": {
                "rules": [
                    {"field": "score", "operator": ">=", "value": 7.5}
                ]
            }
        },
        "keyword_filter": {
            "description": "Filter items containing specific keywords",
            "config": {
                "operator": "or",
                "rules": [
                    {"field": "title", "operator": "contains", "value": "urgent"},
                    {"field": "content", "operator": "contains", "value": "critical"}
                ]
            }
        },
        "range_filter": {
            "description": "Filter items within a numeric range",
            "config": {
                "operator": "and",
                "rules": [
                    {"field": "priority", "operator": ">=", "value": 5},
                    {"field": "priority", "operator": "<=", "value": 9}
                ]
            }
        }
    }

@router.get("/filters/examples/advanced", response_model=Dict[str, Any])
def get_advanced_filter_examples(current_user: CurrentUser):
    """Get examples of advanced filter configurations with composition."""
    return {
        "complex_threat_filter": {
            "description": "Multi-level threat detection with exclusions",
            "config": {
                "expression": {
                    "operator": "and",
                    "rules": [
                        {"field": "threat_score", "operator": ">=", "value": 7.0}
                    ],
                    "sub_expressions": [
                        {
                            "operator": "or",
                            "rules": [
                                {"field": "source", "operator": "in", "value": ["intelligence", "security", "osint"]},
                                {"field": "category", "operator": "==", "value": "high_priority"}
                            ]
                        },
                        {
                            "operator": "not",
                            "rules": [
                                {"field": "status", "operator": "==", "value": "false_positive"}
                            ]
                        }
                    ]
                }
            }
        },
        "content_quality_filter": {
            "description": "Filter high-quality content with multiple criteria",
            "config": {
                "expression": {
                    "operator": "and",
                    "rules": [
                        {"field": "confidence", "operator": ">", "value": 0.8},
                        {"field": "asset.kind", "operator": "in", "value": ["TEXT", "PDF", "WEB"]}
                    ],
                    "sub_expressions": [
                        {
                            "operator": "or",
                            "rules": [
                                {"field": "language", "operator": "==", "value": "en"},
                                {"field": "translated", "operator": "==", "value": True}
                            ]
                        }
                    ]
                }
            }
        },
        "temporal_filter": {
            "description": "Filter recent high-priority items",
            "config": {
                "expression": {
                    "operator": "and",
                    "rules": [
                        {"field": "created_at", "operator": ">=", "value": "2024-01-01T00:00:00Z"},
                        {"field": "priority", "operator": ">=", "value": 8}
                    ],
                    "sub_expressions": [
                        {
                            "operator": "or",
                            "rules": [
                                {"field": "tags", "operator": "contains", "value": "breaking"},
                                {"field": "urgency", "operator": "==", "value": "high"}
                            ]
                        }
                    ]
                }
            }
        }
    }

@router.post("/filters/factory/threshold", response_model=Dict[str, Any])
def create_threshold_filter(
    *,
    field: str,
    threshold: float,
    operator: str = ">=",
    current_user: CurrentUser
):
    """Create a threshold filter using the factory."""
    from app.api.services.filter_service import FilterOperator
    
    try:
        filter_expr = FilterFactory.create_threshold_filter(field, threshold, FilterOperator(operator))
        return filter_expr.to_dict()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create threshold filter: {str(e)}")

@router.post("/filters/factory/range", response_model=Dict[str, Any])
def create_range_filter(
    *,
    field: str,
    min_value: float,
    max_value: float,
    current_user: CurrentUser
):
    """Create a range filter using the factory."""
    try:
        filter_expr = FilterFactory.create_range_filter(field, min_value, max_value)
        return filter_expr.to_dict()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create range filter: {str(e)}")

@router.post("/filters/factory/keywords", response_model=Dict[str, Any])
def create_keyword_filter(
    *,
    field: str,
    keywords: List[str],
    match_any: bool = True,
    current_user: CurrentUser
):
    """Create a keyword filter using the factory."""
    try:
        filter_expr = FilterFactory.create_keyword_filter(field, keywords, match_any)
        return filter_expr.to_dict()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create keyword filter: {str(e)}") 