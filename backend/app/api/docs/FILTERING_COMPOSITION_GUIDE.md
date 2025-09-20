# Advanced Filtering & Composition Framework Guide

> **Status:** ✅ **Complete & Production Ready**  
> **Purpose:** Comprehensive guide for the unified filtering and composition system

---

## 🎯 **Overview**

The new filtering framework provides **type-safe, composable filters** that work across pipelines, search, analysis, and all other system components. It replaces primitive filtering with a powerful, reusable system.

**Key Features:**
- **15+ Filter Operators**: Complete comparison, string, collection, and existence operators
- **Logical Composition**: AND, OR, NOT combinations with unlimited nesting
- **Nested Field Access**: Deep object navigation (e.g., `asset.metadata.score`)
- **Reusable Definitions**: Save and share filter configurations
- **Type Safety**: Validation and error handling for all operations
- **Factory Patterns**: Common filter builders for typical use cases

---

## 🚀 **Quick Start Examples**

### **1. Basic Threshold Filter**
```bash
# Create a simple score threshold filter
curl -X POST "http://localhost:8000/api/v1/filters/factory/threshold" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "threat_score",
    "threshold": 7.5,
    "operator": ">="
  }'
```

### **2. Complex Pipeline Filter**
```bash
# Create a pipeline with advanced filtering
curl -X POST "http://localhost:8000/api/v1/infospaces/1/pipelines" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Threat Analysis with Complex Filtering",
    "source_bundle_ids": [1],
    "steps": [
      {
        "step_order": 1,
        "step_type": "ANNOTATE",
        "name": "Threat Assessment",
        "configuration": {"schema_ids": [1]},
        "input_source": {"source": "PIPELINE_START"}
      },
      {
        "step_order": 2,
        "step_type": "FILTER", 
        "name": "Multi-Criteria Filter",
        "configuration": {
          "filter_expression": {
            "operator": "and",
            "rules": [
              {"field": "threat_score", "operator": ">=", "value": 7.0},
              {"field": "confidence", "operator": ">", "value": 0.8}
            ],
            "sub_expressions": [
              {
                "operator": "or",
                "rules": [
                  {"field": "source_type", "operator": "in", "value": ["osint", "intelligence"]},
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
        },
        "input_source": {"source": "FROM_STEP", "step_order": 1}
      }
    ]
  }'
```

---

## 🔧 **Filter Operators Reference**

### **Comparison Operators**
| Operator | Symbol | Description | Example |
|----------|--------|-------------|---------|
| Equal | `==` | Exact match | `{"field": "status", "operator": "==", "value": "active"}` |
| Not Equal | `!=` | Not equal to | `{"field": "type", "operator": "!=", "value": "test"}` |
| Greater Than | `>` | Numeric/date comparison | `{"field": "score", "operator": ">", "value": 5.0}` |
| Greater/Equal | `>=` | Numeric/date comparison | `{"field": "priority", "operator": ">=", "value": 7}` |
| Less Than | `<` | Numeric/date comparison | `{"field": "age", "operator": "<", "value": 30}` |
| Less/Equal | `<=` | Numeric/date comparison | `{"field": "confidence", "operator": "<=", "value": 0.9}` |

### **String Operators**
| Operator | Description | Example |
|----------|-------------|---------|
| `contains` | Case-insensitive substring | `{"field": "title", "operator": "contains", "value": "urgent"}` |
| `not_contains` | Does not contain substring | `{"field": "content", "operator": "not_contains", "value": "spam"}` |
| `starts_with` | Begins with prefix | `{"field": "category", "operator": "starts_with", "value": "threat"}` |
| `ends_with` | Ends with suffix | `{"field": "filename", "operator": "ends_with", "value": ".pdf"}` |
| `regex` | Regular expression match | `{"field": "email", "operator": "regex", "value": ".*@company\\.com"}` |

### **Collection Operators**
| Operator | Description | Example |
|----------|-------------|---------|
| `in` | Value in list | `{"field": "language", "operator": "in", "value": ["en", "es", "fr"]}` |
| `not_in` | Value not in list | `{"field": "blocked_domains", "operator": "not_in", "value": ["spam.com"]}` |

### **Existence Operators**
| Operator | Description | Example |
|----------|-------------|---------|
| `exists` | Field exists and not null | `{"field": "metadata.score", "operator": "exists"}` |
| `not_exists` | Field missing or null | `{"field": "deprecated_field", "operator": "not_exists"}` |

---

## 🧩 **Composition Patterns**

### **1. AND Logic (All Must Match)**
```json
{
  "operator": "and",
  "rules": [
    {"field": "score", "operator": ">=", "value": 8.0},
    {"field": "verified", "operator": "==", "value": true},
    {"field": "language", "operator": "==", "value": "en"}
  ]
}
```

### **2. OR Logic (Any Must Match)**
```json
{
  "operator": "or", 
  "rules": [
    {"field": "priority", "operator": "==", "value": "critical"},
    {"field": "urgent", "operator": "==", "value": true},
    {"field": "escalated", "operator": "==", "value": true}
  ]
}
```

### **3. NOT Logic (Exclusion)**
```json
{
  "operator": "not",
  "rules": [
    {"field": "status", "operator": "==", "value": "archived"},
    {"field": "deleted", "operator": "==", "value": true}
  ]
}
```

### **4. Nested Composition (Complex Logic)**
```json
{
  "operator": "and",
  "rules": [
    {"field": "active", "operator": "==", "value": true}
  ],
  "sub_expressions": [
    {
      "operator": "or",
      "rules": [
        {"field": "tier", "operator": "==", "value": "premium"},
        {"field": "score", "operator": ">=", "value": 9.0}
      ]
    },
    {
      "operator": "not",
      "rules": [
        {"field": "flags", "operator": "contains", "value": "blocked"}
      ]
    }
  ]
}
```

---

## 🏭 **Factory Patterns**

### **Built-in Factory Methods**

**Threshold Filter:**
```python
FilterFactory.create_threshold_filter("confidence", 0.8, FilterOperator.GE)
```

**Range Filter:**
```python
FilterFactory.create_range_filter("score", 5.0, 9.0)  # 5.0 <= score <= 9.0
```

**Keyword Filter:**
```python
FilterFactory.create_keyword_filter("content", ["urgent", "critical"], match_any=True)
```

**Whitelist Filter:**
```python
FilterFactory.create_whitelist_filter("category", ["threat", "intelligence", "security"])
```

**Blacklist Filter:**
```python
FilterFactory.create_blacklist_filter("source", ["spam", "test", "deprecated"])
```

### **Custom Factory Examples**

```python
def create_threat_detection_filter() -> FilterExpression:
    """Factory for comprehensive threat detection filtering."""
    return FilterExpression(operator=LogicalOperator.AND).add_rule(
        "threat_score", FilterOperator.GE, 7.0
    ).add_rule(
        "confidence", FilterOperator.GT, 0.8
    ).add_expression(
        FilterExpression(operator=LogicalOperator.OR).add_rule(
            "source", FilterOperator.IN, ["osint", "intelligence", "security"]
        ).add_rule(
            "verified", FilterOperator.EQ, True
        )
    ).add_expression(
        FilterExpression(operator=LogicalOperator.NOT).add_rule(
            "false_positive", FilterOperator.EQ, True
        )
    )

def create_content_quality_filter() -> FilterExpression:
    """Factory for high-quality content filtering."""
    return FilterExpression(operator=LogicalOperator.AND).add_rule(
        "word_count", FilterOperator.GE, 100
    ).add_rule(
        "readability_score", FilterOperator.GT, 6.0
    ).add_rule(
        "asset.kind", FilterOperator.IN, ["TEXT", "PDF", "WEB"]
    ).add_expression(
        FilterExpression(operator=LogicalOperator.OR).add_rule(
            "language", FilterOperator.EQ, "en"
        ).add_rule(
            "translated", FilterOperator.EQ, True
        )
    )
```

---

## 💾 **Reusable Filter Management**

### **Save Filters for Reuse**
```bash
# Save a complex filter
curl -X POST "http://localhost:8000/api/v1/filters" \
  -H "Content-Type: application/json" \
  -d '{
    "filter_name": "high_quality_threats",
    "filter_config": {
      "expression": {
        "operator": "and",
        "rules": [
          {"field": "threat_score", "operator": ">=", "value": 7.5},
          {"field": "quality_score", "operator": ">=", "value": 8.0}
        ],
        "sub_expressions": [
          {
            "operator": "or",
            "rules": [
              {"field": "source_reliability", "operator": "==", "value": "high"},
              {"field": "verified", "operator": "==", "value": true}
            ]
          }
        ]
      }
    }
  }'
```

### **Use Saved Filters in Pipelines**
```json
{
  "step_type": "FILTER",
  "configuration": {
    "filter_name": "high_quality_threats"
  }
}
```

### **List Available Filters**
```bash
curl -X GET "http://localhost:8000/api/v1/filters"
```

---

## 🔬 **Advanced Use Cases**

### **1. Temporal Filtering with Asset Context**
```json
{
  "operator": "and",
  "rules": [
    {"field": "asset.created_at", "operator": ">=", "value": "2024-01-01T00:00:00Z"},
    {"field": "relevance_score", "operator": ">=", "value": 7.0}
  ],
  "sub_expressions": [
    {
      "operator": "or",
      "rules": [
        {"field": "asset.kind", "operator": "==", "value": "WEB"},
        {"field": "asset.title", "operator": "contains", "value": "breaking"}
      ]
    }
  ]
}
```

### **2. Multi-Modal Content Filtering**
```json
{
  "operator": "and",
  "rules": [
    {"field": "confidence", "operator": ">", "value": 0.85}
  ],
  "sub_expressions": [
    {
      "operator": "or",
      "rules": [
        {
          "operator": "and",
          "rules": [
            {"field": "asset.kind", "operator": "==", "value": "TEXT"},
            {"field": "word_count", "operator": ">=", "value": 200}
          ]
        },
        {
          "operator": "and", 
          "rules": [
            {"field": "asset.kind", "operator": "==", "value": "PDF"},
            {"field": "page_count", "operator": ">=", "value": 2}
          ]
        },
        {
          "operator": "and",
          "rules": [
            {"field": "asset.kind", "operator": "==", "value": "WEB"},
            {"field": "extracted_text_length", "operator": ">=", "value": 500}
          ]
        }
      ]
    }
  ]
}
```

### **3. Cross-Schema Filtering**
```json
{
  "operator": "and",
  "rules": [
    {"field": "schema.name", "operator": "==", "value": "Threat Assessment"},
    {"field": "threat_level", "operator": "in", "value": ["high", "critical"]}
  ],
  "sub_expressions": [
    {
      "operator": "or",
      "rules": [
        {"field": "indicators.malware", "operator": "exists"},
        {"field": "indicators.network_anomaly", "operator": "exists"},
        {"field": "indicators.behavioral_pattern", "operator": "exists"}
      ]
    }
  ]
}
```

---

## 🎯 **Pipeline Integration**

### **Using Filters in Pipeline Steps**

**Option 1: Inline Filter Definition**
```json
{
  "step_type": "FILTER",
  "configuration": {
    "filter_expression": {
      "operator": "and",
      "rules": [
        {"field": "priority", "operator": ">=", "value": 8}
      ]
    }
  }
}
```

**Option 2: Reference Saved Filter**
```json
{
  "step_type": "FILTER", 
  "configuration": {
    "filter_name": "high_priority_threats"
  }
}
```

**Option 3: Legacy Format (Auto-Converted)**
```json
{
  "step_type": "FILTER",
  "configuration": {
    "operator": "and",
    "rules": [
      {"field": "score", "operator": ">=", "value": 7.5}
    ]
  }
}
```

### **Filter Results & Statistics**

Pipeline filter steps now return detailed statistics:
```json
{
  "passed_asset_ids": [101, 103, 107],
  "filter_stats": {
    "total_annotations": 25,
    "passed_annotations": 3,
    "failed_annotations": 22,
    "error_annotations": 0
  },
  "filter_expression_used": {
    "operator": "and",
    "rules": [
      {"field": "threat_score", "operator": ">=", "value": 7.5}
    ]
  }
}
```

---

## 🧪 **Testing & Validation**

### **Test Filters Before Use**
```bash
curl -X POST "http://localhost:8000/api/v1/filters/test" \
  -H "Content-Type: application/json" \
  -d '{
    "filter_config": {
      "rules": [
        {"field": "score", "operator": ">=", "value": 7.0}
      ]
    },
    "test_data": [
      {"score": 8.5, "name": "item1"},
      {"score": 6.0, "name": "item2"},
      {"score": 9.2, "name": "item3"}
    ]
  }'
```

**Response:**
```json
{
  "total_items": 3,
  "filtered_items": 2,
  "pass_rate": 0.67,
  "results": [
    {"score": 8.5, "name": "item1"},
    {"score": 9.2, "name": "item3"}
  ]
}
```

---

## 🚨 **Error Handling & Validation**

### **Automatic Validation**
- **Type Safety**: Operators validated against field types
- **Value Validation**: Required values for non-existence operators
- **Field Path Validation**: Nested field access validation
- **Logical Consistency**: Sub-expression validation

### **Error Examples**
```python
# ❌ Invalid: Existence operator with value
{"field": "score", "operator": "exists", "value": 5}  # Error!

# ✅ Valid: Existence operator without value  
{"field": "score", "operator": "exists"}

# ❌ Invalid: Comparison operator without value
{"field": "score", "operator": ">="}  # Error!

# ✅ Valid: Comparison operator with value
{"field": "score", "operator": ">=", "value": 7.0}
```

---

## 🎓 **Best Practices**

### **For Filter Design**
1. **Start Simple**: Begin with basic rules, add complexity gradually
2. **Use Factories**: Leverage built-in factories for common patterns  
3. **Test Thoroughly**: Use the test endpoint to validate filters
4. **Save Reusable**: Save commonly used filters for consistency

### **For Performance**
1. **Selective Fields**: Use specific field paths rather than broad matches
2. **Early Filtering**: Apply most selective filters first  
3. **Logical Optimization**: Use AND for restrictive, OR for inclusive
4. **Index Awareness**: Consider database indexes for frequently filtered fields

### **For Maintainability**  
1. **Descriptive Names**: Use clear, descriptive saved filter names
2. **Document Complex**: Comment complex filter logic
3. **Version Control**: Track filter changes in configurations
4. **Monitor Usage**: Track filter performance and effectiveness

---

## 🏆 **Migration from Legacy Filtering**

### **Before (Limited)**
```json
{
  "rules": [
    {"field": "threat_score", "operator": ">=", "value": 7}
  ]
}
```

### **After (Comprehensive)**
```json
{
  "filter_expression": {
    "operator": "and", 
    "rules": [
      {"field": "threat_score", "operator": ">=", "value": 7.0},
      {"field": "confidence", "operator": ">", "value": 0.8}
    ],
    "sub_expressions": [
      {
        "operator": "or",
        "rules": [
          {"field": "source_type", "operator": "in", "value": ["osint", "intel"]},
          {"field": "verified", "operator": "==", "value": true}
        ]
      }
    ]
  }
}
```

### **Automatic Compatibility**
The system automatically converts legacy filter formats, ensuring backward compatibility while enabling new capabilities.

---

**The new filtering and composition framework transforms simple rule-based filtering into a powerful, type-safe, composable system that scales across all platform components!** 🎯

---

**Related Documentation:**
- [Pipelines & Monitors Guide](./PIPELINES_AND_MONITORS.md) - Using filters in automation workflows
- [System Architecture](./SYSTEM_ARCHITECTURE.md) - Overall system design
- [Implementation Status](./IMPLEMENTATION_STATUS.md) - Feature completion status 