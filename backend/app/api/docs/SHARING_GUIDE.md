# Sharing & Export Guide

> **Status:** ✅ **Complete & Ready for Use**  
> **Purpose:** Guide for sharing data, creating packages, and export/import workflows

---

## 🎯 **Overview**

The sharing and export system provides comprehensive data portability with full provenance tracking. It supports sharing individual resources, bulk exports, and complete project transfers while maintaining data integrity and relationships.

**Key Features:**
- **Package System:** Structured export/import with manifests
- **Shareable Links:** Time-bounded access with permissions
- **Full Provenance:** Complete audit trail preservation
- **Multi-Format:** ZIP packages and JSON manifests
- **Project Migration:** Complete infospace export/import

---

## 🚀 **Quick Start**

### **1. Share a Dataset**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/export" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "DATASET",
    "resource_id": 123,
    "permission_level": "READ_ONLY",
    "expiration_days": 30
  }'
```

### **2. Export Complete Analysis**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/export" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "RUN", 
    "resource_id": 456,
    "include_source_files": true,
    "permission_level": "READ_ONLY"
  }'
```

### **3. Import Shared Resource**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/import" \
  -F "file=@shared_dataset.zip" \
  -F "target_infospace_id=1"
```

---

## 📦 **Package System**

### **Package Types**

| Resource Type | Content | Format | Use Case |
|---------------|---------|--------|----------|
| **Dataset** | Assets + annotations + metadata | ZIP | Research data sharing |
| **Schema** | Annotation schema definition | JSON | Template sharing |
| **Run** | Complete analysis run + results | ZIP | Analysis reproduction |
| **Source** | Data source + collected assets | ZIP | Data pipeline sharing |
| **Infospace** | Complete project | ZIP | Project migration |

### **Package Structure**
```
shared_dataset.zip
├── manifest.json           # Package metadata
├── content/
│   ├── assets/             # Original files
│   │   ├── document1.pdf
│   │   └── image1.jpg
│   ├── annotations.json    # Structured results
│   ├── schemas.json        # Analysis schemas
│   └── metadata.json       # Additional metadata
```

### **Manifest Example**
```json
{
  "package_type": "DATASET",
  "created_at": "2024-12-01T10:00:00Z",
  "creator": "user@example.com", 
  "version": "1.0",
  "description": "Research dataset with sentiment analysis",
  "content_summary": {
    "total_assets": 150,
    "file_types": ["PDF", "TEXT", "IMAGE"],
    "annotations": 450,
    "schemas_used": ["Sentiment Analysis", "Entity Extraction"]
  },
  "provenance": {
    "source_infospace": "Research Project Alpha",
    "collection_period": "2024-11-01 to 2024-11-30",
    "processing_models": ["gemini-2.5-flash-preview-05-20"]
  }
}
```

---

## 🔗 **Shareable Links**

### **Create Shareable Link**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/create-link" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "DATASET",
    "resource_id": 123,
    "permission_level": "READ_ONLY",
    "expiration_date": "2024-12-31T23:59:59Z",
    "max_uses": 10,
    "description": "Q4 analysis results"
  }'
```

**Response:**
```json
{
  "token": "share_abc123xyz789",
  "url": "https://platform.example.com/share/share_abc123xyz789",
  "expires_at": "2024-12-31T23:59:59Z",
  "permission_level": "READ_ONLY",
  "max_uses": 10,
  "uses_remaining": 10
}
```

### **Access Shared Content**
```bash
# View shared content summary
curl -X GET "http://localhost:8000/api/v1/shareables/view/share_abc123xyz789"

# Download shared package
curl -X GET "http://localhost:8000/api/v1/shareables/download/share_abc123xyz789" \
  -o shared_content.zip
```

### **Permission Levels**

| Level | Description | Capabilities |
|-------|-------------|--------------|
| **READ_ONLY** | View and download only | Download package, view metadata |
| **COMMENT** | View and add comments | READ_ONLY + comment on content |
| **EDIT** | Modify shared content | COMMENT + modify annotations |
| **ADMIN** | Full control | EDIT + manage sharing settings |

---

## 📊 **Export Workflows**

### **Dataset Export (Research Ready)**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/export" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "DATASET",
    "resource_id": 123,
    "include_source_files": true,
    "include_metadata": true,
    "format": "research_package",
    "export_options": {
      "anonymize_users": true,
      "include_justifications": true,
      "file_format_preference": "original"
    }
  }'
```

### **Analysis Run Export (Reproducible)**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/export" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "RUN",
    "resource_id": 456,
    "include_schemas": true,
    "include_configurations": true,
    "export_options": {
      "include_model_versions": true,
      "include_performance_metrics": true,
      "package_format": "full_reproduction"
    }
  }'
```

### **Schema Template Export**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/export" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "SCHEMA",
    "resource_id": 789,
    "format": "template",
    "export_options": {
      "include_examples": true,
      "include_documentation": true,
      "sanitize_for_reuse": true
    }
  }'
```

---

## 🔄 **Import Workflows**

### **Simple Import**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/import" \
  -F "file=@shared_dataset.zip" \
  -F "target_infospace_id=1" \
  -F "import_mode=merge"
```

### **Advanced Import with Options**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/import" \
  -F "file=@analysis_run.zip" \
  -F "target_infospace_id=1" \
  -F "import_options={
    \"merge_strategy\": \"create_new\",
    \"preserve_ids\": false,
    \"update_timestamps\": true,
    \"conflict_resolution\": \"skip_duplicates\"
  }"
```

### **Import from Shared Link**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/import-from-link" \
  -H "Content-Type: application/json" \
  -d '{
    "share_token": "share_abc123xyz789",
    "target_infospace_id": 1,
    "import_options": {
      "rename_conflicts": true,
      "preserve_structure": true
    }
  }'
```

---

## 🏢 **Project Migration**

### **Complete Infospace Export**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/1/export" \
  -H "Content-Type: application/json" \
  -d '{
    "include_all_data": true,
    "export_options": {
      "include_user_data": false,
      "include_system_configs": true,
      "compress_assets": true
    }
  }'
```

### **Infospace Import**
```bash
curl -X POST "http://localhost:8000/api/v1/infospaces/import" \
  -F "file=@complete_project.zip" \
  -F "new_name=Imported Project" \
  -F "import_options={
    \"preserve_user_assignments\": false,
    \"update_model_references\": true
  }"
```

### **Cross-Organization Migration**
```bash
# Step 1: Export from source
curl -X POST "http://localhost:8000/api/v1/infospaces/1/export-for-migration" \
  -d '{"anonymize_sensitive_data": true}'

# Step 2: Import to target
curl -X POST "http://localhost:8000/api/v1/infospaces/import-migration" \
  -F "file=@migration_package.zip" \
  -F "organization_mapping={\"old_org\": \"new_org\"}'
```

---

## 📋 **Batch Operations**

### **Multi-Resource Export**
```bash
curl -X POST "http://localhost:8000/api/v1/shareables/export-batch" \
  -H "Content-Type: application/json" \
  -d '{
    "resources": [
      {"type": "DATASET", "id": 123},
      {"type": "SCHEMA", "id": 456},
      {"type": "RUN", "id": 789}
    ],
    "batch_name": "Q4 Analysis Package",
    "export_options": {
      "create_index": true,
      "include_cross_references": true
    }
  }'
```

### **Selective Bundle Export**
```bash
curl -X POST "http://localhost:8000/api/v1/bundles/123/export" \
  -H "Content-Type: application/json" \
  -d '{
    "asset_filters": {
      "asset_types": ["PDF", "TEXT"],
      "date_range": {
        "start": "2024-11-01",
        "end": "2024-11-30"
      }
    },
    "include_annotations": true,
    "annotation_filters": {
      "schema_names": ["Entity Extraction"]
    }
  }'
```

---

## 🔐 **Security & Access Control**

### **Access Monitoring**
```bash
# Check link usage
curl -X GET "http://localhost:8000/api/v1/shareables/share_abc123xyz789/usage"

# View access log
curl -X GET "http://localhost:8000/api/v1/shareables/share_abc123xyz789/access-log"

# Revoke access
curl -X DELETE "http://localhost:8000/api/v1/shareables/share_abc123xyz789"
```

### **Data Sanitization Options**
```json
{
  "sanitization": {
    "anonymize_users": true,          // Remove user identifiers
    "remove_personal_info": true,     // Strip PII from content
    "generalize_timestamps": "day",   // Round timestamps to day
    "remove_system_paths": true,      // Clean file paths
    "sanitize_metadata": true         // Remove internal metadata
  }
}
```

### **Encryption & Compliance**
```json
{
  "security_options": {
    "encrypt_package": true,          // Password-protect package
    "require_auth": true,             // Require login to access
    "audit_trail": true,              // Log all access
    "compliance_mode": "GDPR",        // Apply compliance rules
    "data_retention": "90d"           // Auto-expire after period
  }
}
```

---

## 📈 **Monitoring & Analytics**

### **Share Usage Analytics**
```bash
# Overall sharing statistics
curl -X GET "http://localhost:8000/api/v1/shareables/stats?infospace_id=1"

# Resource popularity
curl -X GET "http://localhost:8000/api/v1/shareables/popular?period=30d"

# Export/import volume
curl -X GET "http://localhost:8000/api/v1/shareables/volume?granularity=day"
```

### **Performance Metrics**
- **Package Creation Time:** Time to generate export packages
- **Download Performance:** Package download speeds and success rates
- **Import Success Rate:** Percentage of successful imports
- **Storage Usage:** Disk space used by shared packages

---

## 🚨 **Common Issues & Solutions**

### **"Package too large for export"**
- **Solution:** Use selective export with filters
- **Example:** Filter by date range or asset types

### **"Import failed with conflicts"**
- **Solution:** Adjust conflict resolution strategy
- **Options:** `skip_duplicates`, `overwrite`, `create_new`

### **"Shared link expired"**
- **Check:** Link expiration date and usage limits
- **Solution:** Create new link or extend existing one

### **"Missing file permissions"**
- **Check:** File access permissions in package
- **Solution:** Re-export with appropriate permissions

---

## 🎓 **Best Practices**

### **For Data Sharing**
1. **Clear Documentation:** Include comprehensive package descriptions
2. **Appropriate Permissions:** Use minimal necessary permission levels
3. **Regular Cleanup:** Remove expired or unused shares
4. **Version Control:** Track package versions and changes

### **For Export/Import**
1. **Test Workflows:** Verify import success in test environment
2. **Backup Before Import:** Create backups before major imports
3. **Monitor Resources:** Watch disk space and processing time
4. **Validate Data:** Check data integrity after import

### **For Security**
1. **Limit Access:** Use expiration dates and usage limits
2. **Monitor Usage:** Regular audit of share access
3. **Sanitize Data:** Remove sensitive information before sharing
4. **Secure Transport:** Use HTTPS for all sharing operations

### **For Collaboration**
1. **Structured Naming:** Use clear, descriptive names for shares
2. **Include Context:** Provide adequate metadata and descriptions
3. **Version Management:** Track changes and updates
4. **Communication:** Notify collaborators of important updates

---

**Related Documentation:**
- [Implementation Status](./IMPLEMENTATION_STATUS.md) - Sharing system status
- [System Architecture](./SYSTEM_ARCHITECTURE.md) - Data model relationships
- [Content Service Guide](./CONTENT_SERVICE_GUIDE.md) - Asset management for exports 