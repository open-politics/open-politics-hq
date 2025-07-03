# Multi-Modal Processing Guide

> **Status:** ✅ **Complete & Ready for Use**  
> **Purpose:** Guide for processing and analyzing content across multiple modalities (text, images, audio)

---

## 🎯 **Overview**

The multi-modal system allows processing documents that contain multiple types of media (text + images, text + audio, etc.) in a single, unified analysis. The system automatically handles linking analysis results back to the correct media components.

**Key Features:**
- **Cross-Modal Analysis:** Single LLM call processes all modalities together
- **Automatic Asset Linking:** System maps analysis to correct child assets
- **Rich Justifications:** Evidence from text, images, and audio in structured format
- **User-Friendly Schemas:** Focus on analysis goals, not technical complexity

---

## 🚀 **Quick Start**

### **1. Multi-Modal Asset (Web Article with Images)**
```bash
# Ingest web article (automatically extracts images)
curl -X POST "http://localhost:8000/api/v1/infospaces/1/assets/ingest-url" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/news-article-with-images",
    "title": "News Article Analysis",
    "scrape_immediately": true
  }'
```

### **2. Create Multi-Modal Schema**
```json
{
  "name": "Article Analysis",
  "output_contract": {
    "document": {
      "summary": "string",
      "main_topic": "string", 
      "sentiment": "string"
    },
    "per_image": {
      "description": "string",
      "relevance_to_article": "string",
      "detected_objects": ["string"]
    }
  },
  "instructions": "Analyze the article text and describe how each image relates to the content. Identify the main topic and sentiment of the article."
}
```

### **3. Run Multi-Modal Analysis**
```bash
curl -X POST "http://localhost:8000/api/v1/annotation-runs" \
  -H "Content-Type: application/json" \
  -d '{
    "target_asset_ids": [123],
    "target_schemas": ["Article Analysis"],
    "configuration": {
      "include_images": true,
      "max_images_per_asset": 5,
      "model": "gemini-2.5-flash-preview-05-20",
      "enable_thinking": true
    }
  }'
```

---

## 🏗️ **Schema Structure**

### **Hierarchical Levels**

| Level | Purpose | Example Fields |
|-------|---------|----------------|
| **`document`** | Parent asset analysis | `summary`, `topic`, `sentiment` |
| **`per_image`** | Analysis per image child | `description`, `objects`, `relevance` |
| **`per_audio`** | Analysis per audio child | `transcript`, `speaker`, `tone` |
| **`per_video`** | Analysis per video child | `scenes`, `actions`, `context` |

### **Example Multi-Modal Schema**
```json
{
  "output_contract": {
    "document": {
      "primary_entity": "string",
      "key_findings": ["string"],
      "document_type": "string"
    },
    "per_image": {
      "detected_people": [{
        "name": "string",
        "role": "string", 
        "confidence": "number"
      }],
      "scene_description": "string",
      "text_in_image": "string"
    },
    "per_audio": {
      "speaker_identification": "string",
      "key_quotes": ["string"],
      "emotional_tone": "string"
    }
  }
}
```

---

## 🔗 **Automatic Asset Linking**

### **How It Works**
1. **Context Assembly:** System includes parent text + child media with UUIDs
2. **LLM Processing:** Single call analyzes all content together
3. **Automatic Mapping:** System maps `per_image` results to correct image assets
4. **Result Storage:** Clean data stored without technical UUID fields

### **Example LLM Context**
```
Parent Document (UUID: doc-uuid-123)
---
Article text content here...

Media Item 1: (Type: image, Title: "Photo 1.jpg", UUID: img-uuid-456)
Media Item 2: (Type: image, Title: "Chart.png", UUID: img-uuid-789)
```

### **Example Result Storage**
```json
{
  "document_annotation": {
    "asset_id": "doc-uuid-123",
    "value": {
      "primary_entity": "Tech Conference",
      "key_findings": ["AI adoption increasing", "Privacy concerns raised"]
    }
  },
  "image_annotations": [
    {
      "asset_id": "img-uuid-456", 
      "value": {
        "detected_people": [{"name": "Dr. Smith", "role": "Speaker"}],
        "scene_description": "Conference presentation"
      }
    },
    {
      "asset_id": "img-uuid-789",
      "value": {
        "detected_people": [],
        "scene_description": "Growth chart showing AI adoption trends"
      }
    }
  ]
}
```

---

## 🎯 **Configuration Options**

### **Media Inclusion**
```json
{
  "include_images": true,        // Process image children
  "include_audio": false,        // Process audio children  
  "include_video": false,        // Process video children
  "max_images_per_asset": 5,     // Limit images per document
  "max_audio_segments": 3,       // Limit audio segments
  "image_quality": "medium"      // Image resolution for processing
}
```

### **Model Configuration**
```json
{
  "model": "gemini-2.5-flash-preview-05-20",
  "temperature": 0.1,
  "enable_thinking": true,
  "max_tokens": 2000
}
```

### **Justification Settings**
```json
{
  "justification_mode": "SCHEMA_DEFAULT",
  "default_justification_prompt": "Explain your reasoning with evidence from both text and images.",
  "field_specific_justification_configs": {
    "detected_people": {
      "enabled": true,
      "custom_prompt": "Describe what visual evidence supports this identification."
    }
  }
}
```

---

## 💬 **Rich Justifications**

### **Evidence Types Supported**

**🔹 Text Evidence**
```json
{
  "reasoning": "Identified based on article context",
  "text_spans": [{
    "asset_uuid": "doc-uuid-123",
    "start_char_offset": 245,
    "end_char_offset": 289,
    "text_snippet": "Dr. Smith presented the keynote"
  }]
}
```

**🔹 Image Evidence**
```json
{
  "reasoning": "Person visible at podium position",
  "image_regions": [{
    "asset_uuid": "img-uuid-456",
    "bounding_box": {
      "x": 120, "y": 80, 
      "width": 150, "height": 200,
      "label": "Speaker at podium"
    }
  }]
}
```

**🔹 Cross-Modal Evidence**
```json
{
  "reasoning": "Text mentions growth while chart shows upward trend",
  "text_spans": [{"text_snippet": "significant growth in AI adoption"}],
  "image_regions": [{"asset_uuid": "img-uuid-789", "label": "upward trend line"}],
  "additional_evidence": {
    "correlation": "Text claim supported by visual data"
  }
}
```

---

## 📊 **Asset Hierarchies for Multi-Modal**

### **Web Article Example**
```
🌐 "Tech News Article" (parent)
├── 🖼️ "Featured Image" (child, role="featured")
├── 🖼️ "Chart 1" (child, role="content") 
├── 🖼️ "Photo 1" (child, role="content")
└── 🎵 "Interview Audio" (child, role="content")
```

### **PDF with Embedded Media**
```
📄 "Research Report.pdf" (parent)
├── 📝 "Page 1" (child, text content)
├── 🖼️ "Figure 1" (child, extracted image)
├── 📝 "Page 2" (child, text content)
└── 🖼️ "Chart A" (child, extracted image)
```

### **Video with Metadata**
```
🎬 "Interview.mp4" (parent)
├── 🖼️ "Frame 1" (child, sampled frame)
├── 🖼️ "Frame 2" (child, sampled frame)
└── 🎵 "Audio Track" (child, extracted audio)
```

---

## 🔧 **Advanced Use Cases**

### **Cross-Modal Entity Correlation**
```json
{
  "output_contract": {
    "document": {
      "mentioned_entities": [{"name": "string", "type": "string"}]
    },
    "per_image": {
      "visible_entities": [{"name": "string", "matches_text": "boolean"}],
      "entity_verification": "string"
    }
  },
  "instructions": "Identify entities mentioned in text and verify which ones are visible in images. Note any discrepancies."
}
```

### **Multi-Modal Sentiment Analysis**
```json
{
  "output_contract": {
    "document": {
      "text_sentiment": "string",
      "overall_sentiment": "string"
    },
    "per_image": {
      "visual_mood": "string",
      "sentiment_contribution": "string"
    }
  },
  "instructions": "Analyze sentiment from text and determine how images reinforce or contradict the textual sentiment."
}
```

### **Evidence-Rich Analysis**
```json
{
  "field_specific_justification_configs": {
    "entity_verification": {
      "enabled": true,
      "custom_prompt": "Provide specific visual evidence for entity identification, including bounding boxes and text references."
    }
  }
}
```

---

## 🚨 **Common Issues & Solutions**

### **"Images not processed"**
- **Solution:** Set `include_images: true` in run configuration
- **Check:** Verify child image assets exist for the parent

### **"Poor cross-modal analysis"**
- **Solution:** Write better schema instructions emphasizing connections
- **Example:** "Analyze how images support or contradict the text content"

### **"Missing asset linking"**
- **Cause:** System automatically handles this - no user action needed
- **Verify:** Check that child assets have proper parent relationships

### **"Justification missing evidence"**
- **Solution:** Enable field-specific justifications with custom prompts
- **Example:** Request "visual evidence" and "text support"

---

## 🎓 **Best Practices**

### **For Schema Design**
1. **Clear Instructions:** Emphasize cross-modal analysis in instructions
2. **Logical Hierarchy:** Use `document` for overall, `per_image` for image-specific
3. **Meaningful Fields:** Name fields that reflect analytical goals

### **For Multi-Modal Analysis**
1. **Start Simple:** Begin with text+images before adding audio/video
2. **Test Incrementally:** Verify single-modal before multi-modal
3. **Review Results:** Check that analysis makes cross-modal connections

### **For Evidence Collection**
1. **Enable Justifications:** Use for important analytical fields
2. **Custom Prompts:** Write specific evidence requests
3. **Review Evidence:** Verify bounding boxes and text spans are accurate

### **For Performance**
1. **Limit Media:** Use `max_images_per_asset` for large documents
2. **Choose Quality:** Balance image quality vs processing speed
3. **Model Selection:** Use models optimized for multi-modal processing

---

**Related Documentation:**
- [Implementation Status](./IMPLEMENTATION_STATUS.md) - Overall system status
- [System Architecture](./SYSTEM_ARCHITECTURE.md) - High-level design
- [Content Service Guide](./CONTENT_SERVICE_GUIDE.md) - Multi-modal content ingestion 