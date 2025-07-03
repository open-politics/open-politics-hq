# Search & Analysis Pipeline Guide

> **Status:** ✅ **Complete & Ready for Use**  
> **Purpose:** Guide for setting up automated search-to-insight pipelines

---

## 🎯 **Overview**

The search and analysis pipeline creates a seamless, automated workflow from data discovery to actionable insights. It treats search as just another data source and leverages the existing system architecture for processing and analysis.

**Pipeline Stages:**
1. **Search → Ingest:** Automated discovery of new content
2. **Ingest → Annotate:** AI-powered content enrichment  
3. **Annotate → Analyze:** Pattern detection and alerting

**Key Benefits:**
- **No New Routes:** Uses existing APIs and entities
- **Loosely Coupled:** Independent, reusable components
- **Highly Configurable:** Flexible scheduling and processing
- **Automated Intelligence:** From search to actionable insights

---

## 🚀 **Quick Start**

### **1. Create Search Source**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/sources" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Threat Monitoring",
    "kind": "search",
    "details": {
      "search_config": {
        "query": "cybersecurity threats infrastructure",
        "provider": "tavily",
        "max_results": 10
      }
    }
  }'
```

### **2. Create Collection Bundle**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/bundles" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Threat Intelligence",
    "description": "Automated threat monitoring collection"
  }'
```

### **3. Setup Automated Ingestion**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hourly Threat Search",
    "type": "INGEST", 
    "schedule": "0 * * * *",
    "configuration": {
      "target_source_id": 123,
      "target_bundle_id": 456
    }
  }'
```

### **4. Setup Automated Analysis**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Threat Assessment",
    "type": "ANNOTATE",
    "schedule": "15 * * * *",
    "configuration": {
      "target_bundle_id": 456,
      "schema_ids": [789],
      "model": "gemini-2.5-flash-preview-05-20"
    }
  }'
```

---

## 🔄 **Pipeline Architecture**

### **Complete Workflow**
```
🔍 Search Source → ⏰ INGEST Task → 📦 Bundle Collection
     ↓
📄 New Assets → ⏰ ANNOTATE Task → 🏷️ Structured Data
     ↓  
📊 Analysis Adapter → 🚨 Alerts & Insights
```

### **System Integration**
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Search API    │    │  Asset Storage  │    │  AI Processing  │
│   (External)    │───▶│   (Internal)    │───▶│   (LLM/ML)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │ Bundle Manager  │    │ Analysis Engine │
                       │  (Collection)   │    │   (Insights)    │
                       └─────────────────┘    └─────────────────┘
```

---

## 🔍 **Search Configuration**

### **Supported Search Providers**

| Provider | Description | Configuration |
|----------|-------------|---------------|
| **Tavily** | Web search API | `{"provider": "tavily", "query": "...", "max_results": 10}` |
| **SearXNG** | Self-hosted search | `{"provider": "opol_searxng", "query": "...", "engines": ["google"]}` |
| **Custom** | API endpoint | `{"provider": "custom", "endpoint": "...", "params": {...}}` |

### **Search Configuration Examples**

**🔹 News Monitoring**
```json
{
  "search_config": {
    "query": "data breach security incident",
    "provider": "tavily",
    "max_results": 20,
    "params": {
      "freshness": "day",
      "language": "en"
    }
  }
}
```

**🔹 Company Intelligence**
```json
{
  "search_config": {
    "query": "TechCorp quarterly earnings financial",
    "provider": "tavily", 
    "max_results": 15,
    "params": {
      "domains": ["sec.gov", "finance.yahoo.com"]
    }
  }
}
```

**🔹 Technical Research**
```json
{
  "search_config": {
    "query": "artificial intelligence regulation policy",
    "provider": "opol_searxng",
    "max_results": 25,
    "params": {
      "engines": ["google", "bing", "arxiv"]
    }
  }
}
```

---

## ⏰ **Task Scheduling**

### **INGEST Task Configuration**
```json
{
  "name": "Daily News Collection",
  "type": "INGEST",
  "schedule": "0 8 * * *",              // 8 AM daily
  "configuration": {
    "target_source_id": 123,            // Search source
    "target_bundle_id": 456,            // Collection bundle
    "max_assets_per_run": 50,           // Limit per execution
    "deduplicate": true                 // Skip duplicates
  },
  "retry_config": {
    "max_retries": 3,
    "retry_delay": 300                  // 5 minutes
  }
}
```

### **ANNOTATE Task Configuration**
```json
{
  "name": "Content Analysis", 
  "type": "ANNOTATE",
  "schedule": "30 8 * * *",             // 30 minutes after ingestion
  "configuration": {
    "target_bundle_id": 456,            // Same collection bundle
    "schema_ids": [789, 790],           // Analysis schemas
    "filter_new_only": true,            // Only process new assets
    "model": "gemini-2.5-flash-preview-05-20",
    "batch_size": 10                    // Process in batches
  }
}
```

### **Schedule Patterns**
```bash
# Every hour
"0 * * * *"

# Every 2 hours  
"0 */2 * * *"

# Daily at 8 AM
"0 8 * * *"

# Weekdays at 9 AM
"0 9 * * 1-5"

# Every 15 minutes during business hours
"*/15 9-17 * * 1-5"
```

---

## 🏷️ **Analysis Schemas for Automation**

### **Threat Assessment Schema**
```json
{
  "name": "Threat Assessment",
  "output_contract": {
    "document": {
      "threat_level": "string",
      "threat_type": "string", 
      "affected_systems": ["string"],
      "severity_score": "number",
      "requires_action": "boolean",
      "summary": "string"
    }
  },
  "instructions": "Analyze the content for cybersecurity threats. Rate severity 1-10 and identify affected systems. Set requires_action=true for severe threats."
}
```

### **Entity Extraction Schema**
```json
{
  "name": "Entity Extractor",
  "output_contract": {
    "document": {
      "companies": ["string"],
      "people": ["string"],
      "locations": ["string"],
      "dates": ["string"],
      "financial_figures": ["string"]
    }
  },
  "instructions": "Extract all named entities including companies, people, locations, dates, and financial figures mentioned in the content."
}
```

### **Sentiment & Topic Schema**
```json
{
  "name": "Content Classifier",
  "output_contract": {
    "document": {
      "primary_topic": "string",
      "topics": ["string"],
      "sentiment": "string",
      "credibility_score": "number",
      "source_type": "string"
    }
  },
  "instructions": "Classify the content by topic and sentiment. Rate credibility 1-10 and identify source type (news, blog, academic, etc.)."
}
```

---

## 📊 **Analysis & Alerting**

### **Automated Analysis Execution**
```bash
# Manual analysis trigger
curl -X POST "http://localhost:8000/api/v1/analysis/alerting_adapter/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "target_run_id": 123,
    "alert_conditions": [
      {
        "name": "High Severity Threats",
        "field": "severity_score", 
        "condition": {"operator": ">=", "value": 8}
      },
      {
        "name": "Action Required",
        "field": "requires_action",
        "condition": {"operator": "==", "value": true}
      }
    ]
  }'
```

### **Alert Conditions Examples**

**🔹 Threat Monitoring**
```json
{
  "alert_conditions": [
    {
      "name": "Critical Threats",
      "field": "threat_level",
      "condition": {"operator": "in", "value": ["HIGH", "CRITICAL"]}
    },
    {
      "name": "Infrastructure Threats", 
      "field": "affected_systems",
      "condition": {"operator": "contains", "value": "infrastructure"}
    }
  ]
}
```

**🔹 Financial Monitoring**
```json
{
  "alert_conditions": [
    {
      "name": "Large Financial Impact",
      "field": "financial_impact",
      "condition": {"operator": ">=", "value": 1000000}
    },
    {
      "name": "Negative Sentiment",
      "field": "sentiment",
      "condition": {"operator": "==", "value": "NEGATIVE"}
    }
  ]
}
```

---

## 🔧 **Advanced Pipeline Patterns**

### **Multi-Source Intelligence**
```json
{
  "sources": [
    {
      "name": "News Search",
      "query": "cybersecurity incident",
      "provider": "tavily"
    },
    {
      "name": "Academic Search", 
      "query": "cybersecurity vulnerability research",
      "provider": "opol_searxng"
    }
  ],
  "processing": {
    "merge_strategy": "separate_bundles",
    "cross_reference": true
  }
}
```

### **Hierarchical Analysis**
```json
{
  "stage_1": {
    "schema": "Content Classifier",
    "purpose": "Initial triage and categorization"
  },
  "stage_2": {
    "schema": "Threat Assessment", 
    "condition": "topic == 'cybersecurity'",
    "purpose": "Detailed threat analysis"
  },
  "stage_3": {
    "schema": "Response Planning",
    "condition": "threat_level == 'HIGH'", 
    "purpose": "Action planning for severe threats"
  }
}
```

### **Cross-Bundle Analysis**
```json
{
  "analysis_scope": {
    "bundles": [456, 457, 458],
    "time_window": "7d",
    "correlation_fields": ["companies", "threat_type"]
  },
  "pattern_detection": {
    "trending_threats": true,
    "entity_networks": true,
    "temporal_analysis": true
  }
}
```

---

## 📈 **Monitoring & Optimization**

### **Task Health Monitoring**
```bash
# Check task status
curl -X GET "http://localhost:8000/api/v1/tasks/123/status"

# View task execution history
curl -X GET "http://localhost:8000/api/v1/tasks/123/history?limit=10"

# Check failed executions
curl -X GET "http://localhost:8000/api/v1/tasks/failed?infospace_id=1"
```

### **Performance Metrics**
- **Ingestion Rate:** Assets per hour from search sources
- **Processing Latency:** Time from ingestion to analysis completion
- **Alert Accuracy:** False positive/negative rates
- **Resource Usage:** CPU, memory, API costs per pipeline

### **Optimization Strategies**
1. **Batch Processing:** Group assets for efficient processing
2. **Smart Filtering:** Skip duplicate or low-quality content
3. **Adaptive Scheduling:** Adjust frequency based on content velocity
4. **Resource Limits:** Set timeouts and rate limits

---

## 🚨 **Common Issues & Solutions**

### **"No new content found"**
- **Check:** Search query relevance and freshness
- **Solution:** Adjust search parameters or frequency

### **"Processing backlog building up"**
- **Check:** ANNOTATE task frequency vs INGEST rate
- **Solution:** Increase processing frequency or batch size

### **"Too many false alerts"**
- **Check:** Alert condition thresholds
- **Solution:** Refine conditions and add filters

### **"Missing cross-references"**
- **Check:** Bundle configuration and schema design
- **Solution:** Implement entity linking and correlation analysis

---

## 🎓 **Best Practices**

### **For Pipeline Design**
1. **Start Simple:** Begin with single source and schema
2. **Test Incrementally:** Verify each stage before automation
3. **Monitor Closely:** Watch for failures and performance issues
4. **Document Workflows:** Clear naming and descriptions

### **For Search Configuration**
1. **Specific Queries:** More specific queries yield better results
2. **Multiple Sources:** Combine different search providers
3. **Regular Review:** Update queries based on results quality
4. **Rate Limiting:** Respect API limits and costs

### **For Analysis Design**
1. **Clear Schemas:** Well-defined output contracts
2. **Meaningful Alerts:** Focus on actionable insights
3. **Context Preservation:** Maintain source attribution
4. **Continuous Improvement:** Refine based on feedback

---

**Related Documentation:**
- [Implementation Status](./IMPLEMENTATION_STATUS.md) - Pipeline component status
- [Content Service Guide](./CONTENT_SERVICE_GUIDE.md) - Asset ingestion details
- [Analysis Adapters Guide](./ANALYSIS_ADAPTERS_GUIDE.md) - Custom analysis modules 