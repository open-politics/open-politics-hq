# Graph Analysis Implementation Guide

> **Status:** 🔄 **75% Complete - Need 2 Adapters**  
> **Purpose:** Guide for completing and using the graph analysis system

---

## 🎯 **Overview**

The graph analysis system extracts knowledge graphs from documents and provides visualization and querying capabilities. It uses a "Lightweight Graph-as-Annotation" approach that leverages the existing annotation infrastructure.

**Architecture:**
1. **Extract:** Use annotation schemas to extract graph fragments from documents
2. **Aggregate:** Combine fragments into visualizable graphs
3. **Query:** Perform RAG queries over graph data

---

## ✅ **What's Already Complete**

### **🔍 Knowledge Graph Extractor Schema**
- ✅ **Database Schema:** `KnowledgeGraphExtractor` annotation schema is registered
- ✅ **Instructions:** LLM extracts entities and relationships from documents
- ✅ **Storage:** Graph fragments stored in `Annotation.value` JSONB field

**How to Use:**
1. Create `AnnotationRun` with "Knowledge Graph Extractor" schema
2. System extracts graph fragments from each asset
3. Results stored as structured annotations

**Example Fragment Output:**
```json
{
  "entities": [
    {"name": "TechCorp", "type": "COMPANY"},
    {"name": "Dr. Sarah Chen", "type": "PERSON"}
  ],
  "triplets": [
    {"source": "Dr. Sarah Chen", "relationship": "works for", "target": "TechCorp"}
  ]
}
```

---

## 🔧 **What Needs Implementation**

### **🗂️ Graph Aggregator Adapter** 
**Status:** ❌ **Missing** (Est. 2-3 hours)

**Purpose:** Consolidate graph fragments into a single visualizable graph

**File to Create:** `backend/app/api/analysis/adapters/graph_aggregator_adapter.py`

**Input Configuration:**
```json
{
  "target_run_id": 123,
  "target_schema_id": 456,
  "deduplication_strategy": "fuzzy",
  "include_frequency": true
}
```

**Output Format (React Flow Compatible):**
```json
{
  "nodes": [
    {
      "id": "1", 
      "data": {
        "label": "TechCorp",
        "type": "COMPANY",
        "frequency": 3,
        "source_assets": ["asset-uuid-1", "asset-uuid-2"]
      }
    }
  ],
  "edges": [
    {
      "id": "e1-2",
      "source": "1",
      "target": "2", 
      "label": "works for",
      "frequency": 2
    }
  ],
  "metadata": {
    "total_nodes": 15,
    "total_edges": 23,
    "connected_components": 3
  }
}
```

### **🧠 Graph RAG Adapter**
**Status:** ❌ **Missing** (Est. 2-3 hours)

**Purpose:** Answer questions using graph fragments and embedding search

**File to Create:** `backend/app/api/analysis/adapters/graph_rag_adapter.py`

**Input Configuration:**
```json
{
  "target_run_id": 123,
  "target_schema_id": 456,
  "question": "Which people work for TechCorp?",
  "embedding_model_id": 1,
  "top_k": 5,
  "combine_strategy": "graph_enhanced"
}
```

**Output Format:**
```json
{
  "answer": "Dr. Sarah Chen and Mark Thompson work for TechCorp.",
  "reasoning": "Found connections in graph fragments...",
  "graph_context": "Entities: [TechCorp (COMPANY), Dr. Sarah Chen (PERSON)]...",
  "embedding_context": "Retrieved chunks mentioning TechCorp...",
  "sources": [...],
  "retrieval_stats": {...}
}
```

---

## 🔨 **Implementation Steps**

### **Step 1: Create Graph Aggregator Adapter**

```python
# backend/app/api/analysis/adapters/graph_aggregator_adapter.py

from typing import Dict, Any, List
from sqlmodel import Session, select
from app.models import Annotation
from app.api.analysis.protocols import AnalysisAdapterProtocol

class GraphAggregatorAdapter(AnalysisAdapterProtocol):
    def __init__(self, session: Session, config: Dict[str, Any], **kwargs):
        self.session = session
        self.config = config
        
    def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        target_run_id = config["target_run_id"]
        target_schema_id = config["target_schema_id"]
        
        # 1. Fetch all annotations for the run/schema
        annotations = self.session.exec(
            select(Annotation).where(
                Annotation.run_id == target_run_id,
                Annotation.schema_id == target_schema_id
            )
        ).all()
        
        # 2. Extract and deduplicate entities
        all_nodes = {}
        all_edges = []
        
        for annotation in annotations:
            value = annotation.value
            
            # Process entities
            for entity in value.get('entities', []):
                key = f"{entity['name']}_{entity['type']}"
                if key not in all_nodes:
                    all_nodes[key] = {
                        "id": str(len(all_nodes) + 1),
                        "data": {
                            "label": entity['name'],
                            "type": entity['type'],
                            "frequency": 1,
                            "source_assets": [annotation.asset.uuid]
                        }
                    }
                else:
                    all_nodes[key]["data"]["frequency"] += 1
                    all_nodes[key]["data"]["source_assets"].append(annotation.asset.uuid)
            
            # Process relationships
            for triplet in value.get('triplets', []):
                # Find node IDs for source and target
                source_key = f"{triplet['source']}_{self._get_entity_type(triplet['source'], value)}"
                target_key = f"{triplet['target']}_{self._get_entity_type(triplet['target'], value)}"
                
                if source_key in all_nodes and target_key in all_nodes:
                    edge = {
                        "id": f"e{all_nodes[source_key]['id']}-{all_nodes[target_key]['id']}",
                        "source": all_nodes[source_key]["id"],
                        "target": all_nodes[target_key]["id"],
                        "label": triplet["relationship"]
                    }
                    all_edges.append(edge)
        
        return {
            "nodes": list(all_nodes.values()),
            "edges": all_edges,
            "metadata": {
                "total_nodes": len(all_nodes),
                "total_edges": len(all_edges),
                "source_annotations": len(annotations)
            }
        }
```

### **Step 2: Create Graph RAG Adapter**

```python
# backend/app/api/analysis/adapters/graph_rag_adapter.py

from app.api.services.embedding_service import EmbeddingService
from app.api.providers.factory import create_classification_provider

class GraphRagAdapter(AnalysisAdapterProtocol):
    def __init__(self, session: Session, config: Dict[str, Any], **kwargs):
        self.session = session
        self.config = config
        self.embedding_service = EmbeddingService(session)
        
    def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        question = config["question"]
        embedding_model_id = config["embedding_model_id"]
        top_k = config.get("top_k", 5)
        
        # 1. Vector search for relevant chunks
        search_results = self.embedding_service.similarity_search(
            query_text=question,
            model_id=embedding_model_id,
            top_k=top_k
        )
        
        # 2. Get graph fragments for those assets
        asset_ids = [chunk.asset_id for chunk in search_results]
        graph_annotations = self.session.exec(
            select(Annotation).where(
                Annotation.asset_id.in_(asset_ids),
                Annotation.schema_id == config["target_schema_id"]
            )
        ).all()
        
        # 3. Assemble graph context
        graph_context = self._assemble_graph_context(graph_annotations)
        
        # 4. Combine with embedding context
        embedding_context = "\n".join([chunk.text_content for chunk in search_results])
        
        # 5. Generate answer
        combined_context = f"Graph Knowledge:\n{graph_context}\n\nDocument Context:\n{embedding_context}"
        
        classification_provider = create_classification_provider()
        prompt = f"Context: {combined_context}\n\nQuestion: {question}\n\nAnswer:"
        
        response = classification_provider.classify_text(
            text=prompt,
            model_name=config.get("model", "gemini-2.5-flash-preview-05-20")
        )
        
        return {
            "answer": response.get("result", ""),
            "graph_context": graph_context,
            "embedding_context": embedding_context,
            "sources": [self._format_source(chunk) for chunk in search_results],
            "retrieval_stats": {
                "chunks_retrieved": len(search_results),
                "graph_fragments": len(graph_annotations)
            }
        }
```

### **Step 3: Register Adapters in Database**

Add to `backend/app/core/db.py` in the `init_db` function:

```python
# After existing adapter registrations
graph_aggregator_adapter = AnalysisAdapter(
    name="graph_aggregator_adapter",
    description="Aggregates graph fragments into visualizable graph",
    module_path="app.api.analysis.adapters.graph_aggregator_adapter.GraphAggregatorAdapter",
    input_schema_definition={
        "type": "object",
        "properties": {
            "target_run_id": {"type": "integer"},
            "target_schema_id": {"type": "integer"},
            "deduplication_strategy": {"type": "string", "default": "exact"}
        },
        "required": ["target_run_id", "target_schema_id"]
    }
)

graph_rag_adapter = AnalysisAdapter(
    name="graph_rag_adapter", 
    description="RAG queries enhanced with graph fragment knowledge",
    module_path="app.api.analysis.adapters.graph_rag_adapter.GraphRagAdapter",
    input_schema_definition={
        "type": "object",
        "properties": {
            "target_run_id": {"type": "integer"},
            "target_schema_id": {"type": "integer"},
            "question": {"type": "string"},
            "embedding_model_id": {"type": "integer"},
            "top_k": {"type": "integer", "default": 5}
        },
        "required": ["target_run_id", "target_schema_id", "question", "embedding_model_id"]
    }
)

session.add(graph_aggregator_adapter)
session.add(graph_rag_adapter)
```

---

## 🚀 **How to Use (After Implementation)**

### **1. Extract Graph Fragments**
```bash
# Create annotation run with Knowledge Graph Extractor
curl -X POST "http://localhost:8000/api/v1/annotation-runs" \
  -H "Content-Type: application/json" \
  -d '{
    "target_bundle_id": 1,
    "target_schemas": ["Knowledge Graph Extractor"],
    "configuration": {"model": "gemini-2.5-flash-preview-05-20"}
  }'
```

### **2. Visualize Complete Graph**
```bash
# Aggregate fragments into visualizable graph
curl -X POST "http://localhost:8000/api/v1/analysis/graph_aggregator_adapter/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "target_run_id": 123,
    "target_schema_id": 456
  }'
```

### **3. Query Graph with RAG**
```bash
# Ask questions using graph + embedding context
curl -X POST "http://localhost:8000/api/v1/analysis/graph_rag_adapter/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "target_run_id": 123,
    "target_schema_id": 456,
    "question": "What companies does Dr. Chen work for?",
    "embedding_model_id": 1
  }'
```

---

## 🎯 **Integration with Frontend**

### **Graph Visualization Component**
```typescript
interface GraphNode {
  id: string;
  data: {
    label: string;
    type: string;
    frequency: number;
  };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    total_nodes: number;
    total_edges: number;
  };
}

// Use with react-flow or similar visualization library
```

### **Enhanced RAG Interface**
```typescript
interface GraphRagRequest {
  target_run_id: number;
  target_schema_id: number;
  question: string;
  embedding_model_id: number;
  top_k?: number;
  combine_strategy?: 'graph_only' | 'embedding_only' | 'graph_enhanced';
}
```

---

## 🎓 **Best Practices**

### **For Graph Extraction**
1. **Quality Instructions:** Write clear schema instructions for entity/relationship extraction
2. **Consistent Typing:** Use standardized entity types (PERSON, COMPANY, LOCATION)
3. **Validation:** Review extracted fragments for accuracy

### **For Graph Analysis**
1. **Deduplication:** Handle entity name variations (fuzzy matching)
2. **Filtering:** Allow filtering by entity types or relationship types
3. **Visualization:** Use hierarchical layouts for large graphs

### **For Graph RAG**
1. **Context Balance:** Combine graph and text context appropriately
2. **Question Types:** Works best for relationship and entity queries
3. **Fallbacks:** Use embedding-only RAG if no graph fragments found

---

**Related Documentation:**
- [Implementation Status](./IMPLEMENTATION_STATUS.md) - Current system status
- [Embedding Guide](./EMBEDDING_GUIDE.md) - Vector search and RAG
- [System Architecture](./SYSTEM_ARCHITECTURE.md) - Overall system design 