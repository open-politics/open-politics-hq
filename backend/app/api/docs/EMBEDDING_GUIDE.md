# Embedding & RAG System Guide

> **Status:** ✅ **Complete & Ready for Use**  
> **Purpose:** Practical guide for using the embedding and RAG (Retrieval-Augmented Generation) system

---

## 🎯 **Overview**

The embedding system provides semantic search and question-answering capabilities over your content. It includes:

- **Variable Dimension Support:** Each embedding model creates optimized pgvector tables
- **Multiple Providers:** Local (Ollama) and cloud (Jina AI) options
- **Smart Chunking:** Intelligent text segmentation for optimal retrieval
- **RAG Queries:** Natural language question-answering over embedded content
- **LLM Integration:** Enterprise-grade model management system

---

## 🚀 **Quick Start**

### **1. List Available Models**
```bash
curl -X GET "http://localhost:8000/api/v1/embeddings/models"
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "nomic-embed-text",
    "provider": "OLLAMA", 
    "dimension": 768,
    "description": "High-performance text embeddings optimized for retrieval",
    "is_active": true
  }
]
```

### **2. Generate Embeddings**
```bash
curl -X POST "http://localhost:8000/api/v1/embeddings/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "chunk_ids": [1, 2, 3],
    "model_id": 1
  }'
```

### **3. Ask Questions (RAG)**
```bash
curl -X POST "http://localhost:8000/api/v1/analysis/rag_adapter/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What are the main policy recommendations?",
    "embedding_model_id": 1,
    "top_k": 5,
    "similarity_threshold": 0.7
  }'
```

---

## 🧠 **Available Models**

### **🔹 Ollama (Local Models)**

| Model | Dimensions | Use Case | Performance |
|-------|------------|----------|-------------|
| `nomic-embed-text` | 768 | General text retrieval | High performance, recommended |
| `mxbai-embed-large` | 1024 | Enhanced retrieval accuracy | Slower but more accurate |
| `all-minilm` | 384 | Fast, compact embeddings | Fastest option |

### **🔹 Jina AI (Cloud Models)**

| Model | Dimensions | Use Case | Performance |
|-------|------------|----------|-------------|
| `jina-embeddings-v2-base-en` | 768 | Balanced performance | Good for production |
| `jina-embeddings-v3` | 1024 | Latest multilingual | Best accuracy |

### **🔹 Model Selection Guidelines**

- **Development:** Use `nomic-embed-text` (local, fast, good quality)
- **Production:** Consider `jina-embeddings-v3` (cloud, best accuracy)
- **Resource-Constrained:** Use `all-minilm` (small, fast)

---

## 📝 **Text Chunking**

### **Create Chunks for an Asset**
```bash
curl -X POST "http://localhost:8000/api/v1/chunking/assets/1/chunk" \
  -H "Content-Type: application/json" \
  -d '{
    "strategy": "token",
    "chunk_size": 256,
    "chunk_overlap": 50
  }'
```

### **Chunking Strategies**

| Strategy | Description | Best For |
|----------|-------------|----------|
| `token` | Token-based with boundary detection | General text |
| `sentence` | Sentence boundary preservation | Formal documents |
| `paragraph` | Paragraph-based chunking | Structured content |

### **Chunking Parameters**
- **`chunk_size`:** Target size in tokens (recommended: 256-512)
- **`chunk_overlap`:** Overlap between chunks (recommended: 10-20% of chunk_size)
- **`strategy`:** Chunking approach (`token`, `sentence`, `paragraph`)

---

## 🔍 **Vector Search**

### **Direct Vector Search**
```bash
curl -X POST "http://localhost:8000/api/v1/embeddings/search" \
  -H "Content-Type: application/json" \
  -d '{
    "query_text": "policy recommendations",
    "model_id": 1,
    "top_k": 5,
    "similarity_threshold": 0.7,
    "infospace_id": 1
  }'
```

### **Search Parameters**
- **`top_k`:** Number of results (1-100, recommended: 5-10)
- **`similarity_threshold`:** Minimum similarity (0.0-1.0, recommended: 0.7)
- **`distance_function`:** `cosine` (default), `euclidean`, or `dot_product`

---

## 🤖 **RAG (Question-Answering)**

### **Basic RAG Query**
```json
{
  "question": "What companies were mentioned in the documents?",
  "embedding_model_id": 1,
  "top_k": 5,
  "similarity_threshold": 0.7
}
```

### **Advanced RAG Configuration**
```json
{
  "question": "Analyze the financial risks mentioned",
  "embedding_model_id": 1,
  "top_k": 10,
  "similarity_threshold": 0.6,
  "generation_config": {
    "model": "gemini-2.5-flash-preview-05-20",
    "temperature": 0.1,
    "enable_thinking": true,
    "max_tokens": 1000
  },
  "asset_filters": {
    "asset_types": ["PDF", "TEXT"],
    "date_range": {
      "start": "2024-01-01",
      "end": "2024-12-31"
    }
  }
}
```

### **RAG Response Format**
```json
{
  "answer": "Based on the retrieved documents, three companies were mentioned: TechCorp, DataSystems Inc., and GlobalSoft...",
  "reasoning": "I found relevant information in 5 document chunks. The companies were identified through entity extraction and context analysis...",
  "sources": [
    {
      "source_number": 1,
      "asset_title": "Q3 Financial Report",
      "text_content": "TechCorp reported strong growth...",
      "similarity": 0.89,
      "asset_metadata": {...}
    }
  ],
  "context_used": "Assembled context from 5 sources...",
  "retrieval_stats": {
    "chunks_retrieved": 5,
    "model_used": "nomic-embed-text",
    "provider": "ollama",
    "query": "companies mentioned"
  }
}
```

---

## ⚙️ **LLM Configuration System**

### **Available LLM Models**

**🔹 Gemini (Recommended)**
- `gemini-2.5-flash-preview-05-20` - Single versatile model for all tasks
- Supports thinking, structured output, multimodal processing

**🔹 OpenAI**
- `gpt-4o` - High-quality reasoning and analysis
- `gpt-4o-mini` - Fast, cost-effective option

**🔹 Ollama (Local)**
- `llama3.1:8b` - Local processing, privacy-focused
- `qwen2.5:14b` - Enhanced reasoning capabilities

### **Generation Configuration Options**
```json
{
  "model": "gemini-2.5-flash-preview-05-20",
  "temperature": 0.1,          // Lower = more focused
  "max_tokens": 1000,          // Response length limit
  "enable_thinking": true,     // Include reasoning trace
  "structured_output": false   // Force JSON schema adherence
}
```

---

## 🎯 **Asset Filtering**

### **Filter by Asset Type**
```json
{
  "asset_filters": {
    "asset_types": ["PDF", "TEXT", "WEB"],
    "exclude_types": ["IMAGE", "AUDIO"]
  }
}
```

### **Filter by Date Range**
```json
{
  "asset_filters": {
    "date_range": {
      "start": "2024-01-01T00:00:00Z",
      "end": "2024-12-31T23:59:59Z"
    }
  }
}
```

### **Filter by Source**
```json
{
  "asset_filters": {
    "source_ids": [1, 2, 3],
    "exclude_sources": [4, 5]
  }
}
```

---

## 📊 **Performance & Monitoring**

### **Embedding Generation Performance**
- **Target:** < 5s for 1000 tokens
- **Batch Processing:** Use chunk_ids arrays for efficiency
- **Model Switching:** Each model has separate optimized tables

### **Vector Search Performance**
- **Target:** < 500ms for similarity search
- **Optimization:** Use appropriate similarity thresholds
- **Scaling:** Native pgvector operations for maximum speed

### **RAG Query Performance**
- **Target:** < 10s end-to-end
- **Optimization:** Adjust top_k and similarity_threshold
- **Caching:** Consider caching frequent queries

### **Monitor Model Usage**
```bash
curl -X GET "http://localhost:8000/api/v1/embeddings/models/1/stats"
```

---

## 🚨 **Common Issues & Solutions**

### **"No relevant chunks found"**
- **Solution:** Lower `similarity_threshold` (try 0.5-0.6)
- **Cause:** Query too specific or content not embedded

### **"Poor RAG answers"**
- **Solution:** Increase `top_k` (try 10-15)
- **Solution:** Check embedding model quality
- **Solution:** Improve chunking strategy

### **"Slow performance"**
- **Solution:** Use local Ollama models for speed
- **Solution:** Reduce `top_k` and increase `similarity_threshold`
- **Solution:** Optimize chunk sizes (256-512 tokens)

---

## 🔧 **Integration Examples**

### **Frontend TypeScript Interface**
```typescript
interface RagQueryRequest {
  question: string;
  embedding_model_id: number;
  top_k?: number;
  similarity_threshold?: number;
  generation_config?: {
    model?: string;
    temperature?: number;
    enable_thinking?: boolean;
    max_tokens?: number;
  };
  asset_filters?: AssetFilters;
}
```

### **Python SDK Usage**
```python
import requests

# RAG Query
response = requests.post(
    "http://localhost:8000/api/v1/analysis/rag_adapter/execute",
    json={
        "question": "What are the key findings?",
        "embedding_model_id": 1,
        "top_k": 5
    }
)

result = response.json()
print(f"Answer: {result['answer']}")
for source in result['sources']:
    print(f"Source: {source['asset_title']} (similarity: {source['similarity']})")
```

---

## 🎓 **Best Practices**

### **For Development**
1. **Start Simple:** Use default models and parameters
2. **Test Incrementally:** Try search before RAG
3. **Monitor Performance:** Check response times and accuracy

### **For Production**
1. **Choose Models Carefully:** Balance cost, speed, and accuracy
2. **Optimize Chunking:** Tune for your content type
3. **Set Appropriate Limits:** Prevent expensive queries
4. **Cache Results:** Store frequent query results

### **For Content Preparation**
1. **Clean Text:** Remove formatting artifacts
2. **Logical Chunking:** Respect document structure
3. **Consistent Metadata:** Add titles and descriptions
4. **Test Coverage:** Verify all content is searchable

---

**Related Documentation:**
- [Implementation Status](./IMPLEMENTATION_STATUS.md) - Overall system status
- [System Architecture](./SYSTEM_ARCHITECTURE.md) - High-level design
- [Graph Guide](./GRAPH_GUIDE.md) - Graph-based analysis options 