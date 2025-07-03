# System Architecture Guide

> **Purpose:** High-level overview of the OSINT Kernel system architecture, core principles, and data models.

---

## 🎯 **Vision & Core Principles**

**Create one extensible platform** where investigators can:
- Ingest any open-source data (text, image, video, audio, tabular, web, etc.)
- Enrich it with AI/ML pipelines via flexible `AnnotationSchema`s
- Perform cross-modal analysis where text, images, audio are analyzed together
- Curate flexible, shareable collections (`Bundle`s)
- Perform complex analysis through backend `AnalysisAdapter`s
- Share actionable intelligence with clear provenance

### **Design Principles**

1. **Everything is Addressable:** UUID + Infospace for every core entity
2. **Immutability First:** Assets & Annotations are write-once
3. **Schema-Driven Everything:** JSONSchema + instructions define all processing
4. **Multi-Modal by Design:** Single LLM call processes all modalities together
5. **Pluggable Analysis:** AnalysisAdapter registry for extensible capabilities
6. **API-First:** Backend APIs are the primary interface

---

## 🏗️ **Core Data Models**

### **Primary Entities**

| Entity | Purpose | Key Fields |
|--------|---------|------------|
| **Infospace** | Tenant space, owns all other entities | `id`, `name`, `embedding_model`, `owner_id` |
| **Asset** | Immutable raw/processed item with parent-child hierarchy | `id`, `uuid`, `title`, `kind`, `text_content`, `parent_asset_id` |
| **Bundle** | Curated, mutable collection of Assets | `id`, `uuid`, `name`, `assets` |
| **AnnotationSchema** | Defines output structure + instructions for AI tasks | `id`, `name`, `output_contract` (JSON), `instructions` |
| **AnnotationRun** | Execution of schemas over targets | `id`, `configuration` (JSON), `status`, `target_schemas` |
| **Annotation** | Result of applying schema to asset | `id`, `uuid`, `asset_id`, `schema_id`, `value` (JSON) |

### **Supporting Systems**

| Entity | Purpose |
|--------|---------|
| **AssetChunk** | Text segments for embedding/search |
| **EmbeddingModel** | Registry of available embedding models |
| **Source** | Configuration for ingestion pathways |
| **Task** | Automated, scheduled jobs |
| **AnalysisAdapter** | Registered backend analysis modules |

---

## 🔄 **System Capabilities**

### **1. Ingestion Engine**
- **Modular Sources:** Each `Source.kind` has dedicated worker
- **Multi-Modal Containers:** PDFs→pages, CSVs→rows, Web→images
- **Automatic Chunking:** Text segmentation for embedding
- **Deduplication:** SHA-256 + optional semantic deduplication

### **2. Multi-Modal Annotation Engine**
- **Schema-Driven:** JSONSchema defines structure, instructions guide AI
- **Hierarchical Processing:** `document` vs `per_image`/`per_audio` sections
- **Implicit Linking:** System automatically links child media analysis to correct assets
- **Rich Justifications:** Evidence payloads with text spans, image regions, audio segments

### **3. Embedding & Vector Search**
- **Variable Dimensions:** Each model gets optimized pgvector table
- **Multiple Providers:** Ollama (local), Jina AI (cloud), OpenAI (planned)
- **Hybrid Search:** Vector similarity + SQL filters
- **RAG Ready:** Question-answering over embedded content

### **4. Analysis Engine**
- **Adapter Registry:** Database-registered analysis modules
- **Dynamic Loading:** Runtime loading from module paths
- **Flexible Configuration:** JSONSchema-validated parameters
- **Built-in Adapters:** Label distribution, time series, alerting, graph aggregation

### **5. Automation & Sharing**
- **Scheduled Tasks:** Cron-based ingestion and annotation
- **Package System:** Export/import with full provenance
- **Shareable Links:** Time-bounded access to resources
- **Cross-Modal Intelligence:** Automated search→annotation→analysis pipelines

---

## 🏗️ **Architecture Patterns**

### **Multi-Modal Processing Flow**
```
Asset (PDF) → Child Assets (pages) → AssetChunks (text segments)
     ↓
AnnotationRun with Schema
     ↓
LLM Context: Parent text + Child images with UUIDs
     ↓
Structured Output: document + per_image analysis
     ↓
System maps results to correct Assets via UUIDs
```

### **Analysis Adapter Pattern**
```
Frontend selects adapter + configuration
     ↓
POST /api/analysis/{adapter_name}/execute
     ↓
Dynamic loading from database registry
     ↓
Adapter processes data scope (runs, bundles, assets)
     ↓
Returns JSON matching output schema
```

### **Search-to-Insight Pipeline**
```
Search Source → INGEST Task → Assets in Bundle
     ↓
ANNOTATE Task → Structured annotations
     ↓
Analysis Adapter → Alerts/insights
```

---

## 📊 **Data Flow Examples**

### **Example 1: PDF Analysis**
1. **Ingest:** PDF uploaded → parent Asset + page child Assets + text chunks
2. **Annotate:** Schema extracts entities from each page
3. **Analyze:** Count entity distribution across pages

### **Example 2: Multi-Modal Article**
1. **Ingest:** Web article → parent Asset + image child Assets
2. **Annotate:** LLM analyzes text + images together, identifies correlations
3. **Search:** Vector search finds similar cross-modal patterns

### **Example 3: Automated Monitoring**
1. **Schedule:** Search task runs every 2 hours
2. **Ingest:** New articles added to monitoring bundle
3. **Annotate:** Threat assessment schema processes new content
4. **Alert:** Analysis adapter flags high-risk items

---

## 🔧 **Extension Points**

### **Adding New Content Types**
- Create new `Source.kind` with dedicated worker
- Define `Asset.kind` for the content type
- Add processing logic for child Asset creation

### **Adding New Analysis**
- Create class implementing `AnalysisAdapterProtocol`
- Register in database with input/output schemas
- System handles dynamic loading and execution

### **Adding New Providers**
- Implement provider protocols (`StorageProvider`, `ClassificationProvider`)
- Add configuration to provider factory
- System handles provider selection

---

## 🎯 **Performance Targets**

| Metric | Target |
|--------|--------|
| Cold ingest throughput | 100 MB/min per worker |
| Vector query P95 latency | < 200 ms for 1M vectors |
| Multi-modal annotation | 20 req/min per GPU instance |
| Analysis adapter execution | < 5s for 10k annotations |

---

**Related Documentation:**
- [Implementation Status](./IMPLEMENTATION_STATUS.md) - What's built vs planned
- [Content Processing](./CONTENT_PROCESSING.md) - Detailed ingestion flows
- [Multi-Modal Guide](./MULTIMODAL_GUIDE.md) - Cross-modal implementation details
- [Analysis Adapters](./ANALYSIS_ADAPTERS_GUIDE.md) - Creating custom analysis modules 