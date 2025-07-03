# Content Service Guide

> **Status:** ✅ **Complete & Ready for Use**  
> **Purpose:** Practical guide for content ingestion and processing

---

## 🎯 **Overview**

The Content Service provides a unified, comprehensive solution for all content ingestion needs. It replaces multiple scattered services with a single, well-designed interface that handles files, URLs, and text through the same clean pipeline.

**Key Benefits:**
- **Unified API:** All content types follow the same patterns
- **Multi-Modal Support:** Handles text, images, audio, video, documents
- **Hierarchical Processing:** Parent-child relationships (PDFs→pages, CSVs→rows)
- **Background Processing:** Async task integration
- **Smart Processing:** Auto-detection and intelligent parsing

---

## 🚀 **Quick Start**

### **1. File Upload**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/assets/upload" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@document.pdf" \
  -F "title=Policy Document" \
  -F "process_immediately=true"
```

### **2. URL Ingestion**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/assets/ingest-url" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "title": "News Article",
    "scrape_immediately": true
  }'
```

### **3. Text Ingestion**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/assets/ingest-text" \
  -H "Content-Type: application/json" \
  -d '{
    "text_content": "This is important text content...",
    "title": "Manual Entry",
    "event_timestamp": "2024-12-01T10:00:00Z"
  }'
```

---

## 📁 **Supported Content Types**

### **🔹 Documents**
| Format | Parent Asset | Child Assets | Processing |
|--------|--------------|--------------|------------|
| **PDF** | Document file | Pages | Text extraction per page |
| **DOCX** | Document file | Sections | Paragraph/section extraction |
| **TXT/MD** | Text file | None | Direct text content |

### **🔹 Structured Data**
| Format | Parent Asset | Child Assets | Processing |
|--------|--------------|--------------|------------|
| **CSV** | Data file | Rows | Auto-detect delimiter, headers |
| **JSON** | Data file | Objects | Parse structure |
| **XML** | Data file | Elements | Extract text content |

### **🔹 Web Content**
| Format | Parent Asset | Child Assets | Processing |
|--------|--------------|--------------|------------|
| **Web Page** | Article | Images | Article text + featured/content images |
| **RSS Feed** | Feed | Articles | Extract individual articles |

### **🔹 Media Files**
| Format | Parent Asset | Child Assets | Processing |
|--------|--------------|--------------|------------|
| **Images** | Image file | None | Metadata extraction |
| **Audio** | Audio file | Segments | Transcript extraction (future) |
| **Video** | Video file | Frames | Frame sampling (future) |

### **🔹 Archives**
| Format | Parent Asset | Child Assets | Processing |
|--------|--------------|--------------|------------|
| **ZIP** | Archive | Individual files | Extract and process each file |
| **TAR** | Archive | Individual files | Extract and process each file |

---

## ⚙️ **Processing Options**

### **CSV Processing**
```json
{
  "delimiter": ";",           // Auto-detected if not provided
  "encoding": "utf-8",        // Default utf-8, fallback to latin1
  "skip_rows": 2,             // Skip N rows before header
  "max_rows": 10000          // Limit for large files
}
```

### **PDF Processing**
```json
{
  "max_pages": 500,          // Limit for large PDFs
  "extract_images": true,    // Extract embedded images
  "ocr_enabled": false       // OCR for scanned PDFs (future)
}
```

### **Web Scraping**
```json
{
  "timeout": 30,             // Request timeout seconds
  "max_images": 8,           // Limit content images extracted
  "extract_links": false,    // Extract internal links (future)
  "full_page": false         // Full page vs article extraction
}
```

---

## 📊 **Asset Hierarchies**

### **PDF Example**
```
📄 "Policy Document.pdf" (parent)
├── 📝 "Page 1" (child, part_index=0)
├── 📝 "Page 2" (child, part_index=1)
└── 📝 "Page N" (child, part_index=N-1)
```

### **CSV Example**
```
📊 "data.csv" (parent)
├── 📝 "Row 1" (child, part_index=0) 
├── 📝 "Row 2" (child, part_index=1)
└── 📝 "Row N" (child, part_index=N-1)
```

### **Web Article Example**
```
🌐 "News Article" (parent)
├── 🖼️ "Featured Image" (child, role="featured")
├── 🖼️ "Content Image 1" (child, role="content")
└── 🖼️ "Content Image N" (child, role="content")
```

---

## 🔄 **Processing Workflow**

### **1. File Upload Flow**
```
User uploads file.pdf
     ↓
ContentService.ingest_file()
     ↓
- Detect content type (.pdf → AssetKind.PDF)
- Upload to storage
- Create parent Asset record
- Optionally process immediately
     ↓
ContentService._process_pdf()
     ↓
- Extract text from each page
- Create child Asset per page
- Update parent with metadata
```

### **2. URL Scraping Flow**
```
User submits URL
     ↓
ContentService.ingest_url()
     ↓
- Create Asset(kind=WEB)
- Optionally scrape immediately
     ↓
ContentService._process_web_content()
     ↓
- Scrape article content
- Extract featured image
- Extract content images
- Create child IMAGE assets
- Update parent with article text
```

### **3. Background Processing**
```
File uploaded with process_immediately=false
     ↓
Asset created in PENDING status
     ↓
Background task: process_content(asset_id)
     ↓
Processing logic runs asynchronously
     ↓
Asset status updated to READY or FAILED
```

---

## 📡 **Background Tasks**

### **Available Tasks**
```python
# Process any content type
process_content(asset_id: int, options: Dict[str, Any] = None)

# Reprocess with new options
reprocess_content(asset_id: int, options: Dict[str, Any] = None)

# Handle large URL batches
ingest_bulk_urls(urls: List[str], infospace_id: int, ...)

# Retry failed processing
retry_failed_content_processing(infospace_id: int, max_retries: int = 3)

# Cleanup maintenance  
clean_orphaned_child_assets(infospace_id: int)
```

### **Task Monitoring**
```bash
# Check task status
curl -X GET "http://localhost:8000/api/v1/tasks/status/{task_id}"

# Retry failed processing
curl -X POST "http://localhost:8000/api/v1/tasks/retry-failed" \
  -H "Content-Type: application/json" \
  -d '{"infospace_id": 1, "max_retries": 3}'
```

---

## 🔧 **Advanced Usage**

### **Bulk URL Ingestion**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/assets/bulk-ingest-urls" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://site1.com/article1",
      "https://site2.com/article2"
    ],
    "base_title": "News Collection",
    "scrape_immediately": false
  }'
```

### **Reprocessing with New Options**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/assets/123/reprocess" \
  -H "Content-Type: application/json" \
  -d '{
    "delimiter": ";",
    "encoding": "utf-8",
    "skip_rows": 1
  }'
```

### **Custom Processing Options**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/assets/upload" \
  -F "file=@data.csv" \
  -F "title=Custom Data" \
  -F "options={\"delimiter\": \";\", \"max_rows\": 5000}"
```

---

## 🚨 **Error Handling**

### **Processing Status Values**
- **`PENDING`:** Waiting for processing
- **`PROCESSING`:** Currently being processed
- **`READY`:** Successfully processed
- **`FAILED`:** Processing failed with errors

### **Common Error Scenarios**

**"File format not supported"**
- **Solution:** Check supported formats list
- **Workaround:** Convert to supported format

**"CSV parsing failed"**
- **Solution:** Specify correct delimiter and encoding
- **Example:** `{"delimiter": ";", "encoding": "latin1"}`

**"URL scraping timeout"**
- **Solution:** Increase timeout or retry later
- **Example:** `{"timeout": 60}`

**"Large file processing failed"**
- **Solution:** Use background processing
- **Set:** `process_immediately=false`

---

## 📊 **Performance Guidelines**

### **File Size Recommendations**
| Content Type | Recommended Limit | Background Processing |
|--------------|-------------------|----------------------|
| **PDF** | < 50MB | Use for >10MB |
| **CSV** | < 100k rows | Use for >10k rows |
| **Images** | < 20MB each | Always immediate |
| **Archives** | < 200MB total | Always background |

### **Optimization Tips**
1. **Use Background Processing:** For large files or bulk operations
2. **Set Appropriate Limits:** Use `max_rows`, `max_pages` options
3. **Choose Correct Encoding:** Specify encoding for international content
4. **Monitor Task Queue:** Check for failed tasks regularly

---

## 🔗 **Integration with Other Systems**

### **With Embedding System**
```python
# After content ingestion, create chunks and embeddings
asset = content_service.ingest_file(file, infospace_id, user_id)
chunks = chunking_service.create_chunks(asset.id)
embeddings = embedding_service.generate_embeddings(chunks, model_id)
```

### **With Annotation System**
```python
# Process content then run annotation
asset = content_service.ingest_url(url, infospace_id, user_id)
bundle = Bundle(assets=[asset])
run = AnnotationRun(target_bundle=bundle, schemas=[schema])
```

### **With Analysis System**
```python
# Ingest, annotate, then analyze
assets = content_service.ingest_bulk_urls(urls, infospace_id, user_id)
# ... annotation processing ...
results = analysis_adapter.execute({"target_run_id": run_id})
```

---

## 🎓 **Best Practices**

### **For Development**
1. **Start with Small Files:** Test with small samples first
2. **Use Immediate Processing:** For development and testing
3. **Check Asset Status:** Monitor processing completion

### **For Production**
1. **Use Background Processing:** For large files and bulk operations
2. **Set Resource Limits:** Prevent expensive operations
3. **Monitor Failed Tasks:** Set up alerting for failures
4. **Optimize Settings:** Tune processing options for your content

### **For Content Preparation**
1. **Clean File Names:** Use descriptive, filesystem-safe names
2. **Validate Formats:** Ensure files are in supported formats
3. **Prepare URLs:** Test URL accessibility before bulk ingestion
4. **Document Structure:** Understand how content will be hierarchical

---

**Related Documentation:**
- [Implementation Status](./IMPLEMENTATION_STATUS.md) - Overall system status
- [System Architecture](./SYSTEM_ARCHITECTURE.md) - High-level design
- [Embedding Guide](./EMBEDDING_GUIDE.md) - Post-ingestion processing 