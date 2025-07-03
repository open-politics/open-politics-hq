# Analysis Adapters Guide

> **Status:** ✅ **Complete & Ready for Use**  
> **Purpose:** Guide for creating and using analysis adapters for custom data analysis

---

## 🎯 **Overview**

Analysis adapters provide a flexible framework for performing custom data analysis on annotations, assets, and other system data. They are dynamically loaded, database-registered modules that can be configured and executed through the API.

**Key Features:**
- **Dynamic Loading:** Runtime loading from database-registered module paths
- **Flexible Configuration:** JSONSchema-validated parameters
- **Unified API:** Single execution endpoint for all adapters
- **Extensible Framework:** Easy to add new analysis capabilities

---

## 🚀 **Quick Start**

### **1. List Available Adapters**
```bash
curl -X GET "http://localhost:8000/api/v1/analysis/adapters"
```

### **2. Execute an Adapter**
```bash
curl -X POST "http://localhost:8000/api/v1/analysis/label_distribution_adapter/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "target_run_id": 123,
    "label_field_key": "sentiment",
    "top_n": 10
  }'
```

---

## 🏗️ **Built-in Adapters**

### **🏷️ Label Distribution Adapter**
**Purpose:** Count unique values in annotation fields

**Configuration:**
```json
{
  "target_run_id": 123,
  "target_schema_id": 456,
  "label_field_key": "sentiment",
  "top_n": 10,
  "include_percentages": true
}
```

**Output:**
```json
{
  "distributions": [
    {"value": "positive", "count": 45, "percentage": 60.0},
    {"value": "negative", "count": 20, "percentage": 26.7},
    {"value": "neutral", "count": 10, "percentage": 13.3}
  ],
  "total_items": 75,
  "unique_values": 3
}
```

### **📈 Time Series Aggregation Adapter**
**Purpose:** Aggregate data over time buckets

**Configuration:**
```json
{
  "target_run_id": 123,
  "value_field_key": "severity_score",
  "timestamp_source_field": "asset.event_timestamp",
  "aggregation_functions": ["avg", "count", "max"],
  "time_bucket": "day",
  "split_by_source_id": true
}
```

**Output:**
```json
{
  "time_series": [
    {
      "timestamp": "2024-12-01T00:00:00Z",
      "avg": 6.5,
      "count": 12,
      "max": 9.2,
      "source_breakdown": {
        "source_1": {"avg": 7.0, "count": 8},
        "source_2": {"avg": 5.5, "count": 4}
      }
    }
  ],
  "metadata": {
    "total_data_points": 150,
    "time_range": "30 days"
  }
}
```

### **🚨 Alerting Adapter**
**Purpose:** Check conditions and generate alerts

**Configuration:**
```json
{
  "target_run_id": 123,
  "alert_conditions": [
    {
      "name": "High Severity",
      "field": "severity_score",
      "condition": {"operator": ">=", "value": 8.0}
    },
    {
      "name": "Critical Keywords",
      "field": "description",
      "condition": {"operator": "contains", "value": "critical"}
    }
  ]
}
```

**Output:**
```json
{
  "alerts": [
    {
      "condition_name": "High Severity",
      "matched_assets": [
        {
          "asset_id": 456,
          "asset_title": "Security Report",
          "field_value": 8.5,
          "annotation_id": 789
        }
      ],
      "match_count": 3
    }
  ],
  "summary": {
    "total_alerts": 1,
    "total_matches": 3
  }
}
```

### **🕸️ Graph Aggregator Adapter** *(Needs Implementation)*
**Purpose:** Aggregate graph fragments into visualizable format

**Configuration:**
```json
{
  "target_run_id": 123,
  "target_schema_id": 456,
  "deduplication_strategy": "fuzzy",
  "include_frequency": true
}
```

### **🧠 RAG Adapter**
**Purpose:** Question-answering over embedded content

**Configuration:**
```json
{
  "question": "What are the main threats?",
  "embedding_model_id": 1,
  "top_k": 5,
  "similarity_threshold": 0.7,
  "generation_config": {
    "model": "gemini-2.5-flash-preview-05-20",
    "temperature": 0.1
  }
}
```

---

## 🔧 **Creating Custom Adapters**

### **Adapter Protocol**
```python
from abc import ABC, abstractmethod
from typing import Dict, Any
from sqlmodel import Session

class AnalysisAdapterProtocol(ABC):
    def __init__(self, session: Session, config: Dict[str, Any], **kwargs):
        self.session = session
        self.config = config
        
    @abstractmethod
    def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the analysis and return results"""
        pass
```

### **Example Custom Adapter**
```python
# backend/app/api/analysis/adapters/custom_adapter.py

from typing import Dict, Any
from sqlmodel import Session, select
from app.models import Annotation
from app.api.analysis.protocols import AnalysisAdapterProtocol

class CustomAnalysisAdapter(AnalysisAdapterProtocol):
    """Custom analysis adapter example"""
    
    def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        target_run_id = config["target_run_id"]
        
        # Query data
        annotations = self.session.exec(
            select(Annotation).where(Annotation.run_id == target_run_id)
        ).all()
        
        # Perform analysis
        results = self._analyze_data(annotations)
        
        return {
            "results": results,
            "total_processed": len(annotations)
        }
    
    def _analyze_data(self, annotations):
        # Custom analysis logic here
        return {"analysis": "completed"}
```

### **Register Custom Adapter**
```python
# In backend/app/core/db.py init_db function

custom_adapter = AnalysisAdapter(
    name="custom_analysis_adapter",
    description="Custom analysis functionality",
    module_path="app.api.analysis.adapters.custom_adapter.CustomAnalysisAdapter",
    input_schema_definition={
        "type": "object",
        "properties": {
            "target_run_id": {"type": "integer"}
        },
        "required": ["target_run_id"]
    }
)

session.add(custom_adapter)
```

---

## 🎓 **Best Practices**

### **For Development**
1. **Clear Naming:** Use descriptive adapter names
2. **Error Handling:** Implement robust validation
3. **Performance:** Optimize for large datasets
4. **Testing:** Write comprehensive tests

### **For Usage**
1. **Start Simple:** Begin with basic configurations
2. **Test Incrementally:** Verify with small datasets
3. **Monitor Performance:** Watch execution times
4. **Combine Thoughtfully:** Plan adapter sequences

---

**Related Documentation:**
- [Implementation Status](./IMPLEMENTATION_STATUS.md) - Adapter system status
- [System Architecture](./SYSTEM_ARCHITECTURE.md) - Analysis framework design
- [Graph Guide](./GRAPH_GUIDE.md) - Graph adapter implementation 