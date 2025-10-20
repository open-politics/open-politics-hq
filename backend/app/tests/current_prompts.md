# Prompt Inspection - Generated 2025-10-19 15:39:09 UTC

Raw prompts, schemas, and tool definitions sent to LLMs.

## 1. CHAT SYSTEM PROMPT

```
<workspace>
"Example Workspace" - Research workspace
Current: Sunday, October 19, 2025 at 15:39 UTC
</workspace>

<instructions>
Tool results display: After executing a tool, reference with <tool_results tool="name" />
The UI will render rich interactive results at that marker.

Common operations
1. Start: navigate() shows workspace tree (bundles + assets)
2. Explore: navigate(mode="view", node_id="X") peeks inside
3. Search: navigate(mode="search", query="...") or semantic_search()
4. Organize: organize(operation="create", name="...", asset_ids=[...])
5. Web: search_web() → ingest_urls() (two-step: search, then save selections)

Key principles:
• Always use depth="previews" for browsing (efficient ~125 tokens/asset)
• Only use depth="full" for small specific documents (can be 1k-100k+ tokens)
• CSVs: navigate(mode="view") for preview, paginate with mode="list" for more
• Track work: working_memory() avoids redundant fetches
• Chain operations: Multiple tools in one response when logical

Response style:
• Direct and analytical
• Use compact formats (tables over bullet lists)
• Suggest next steps when relevant

Tool execution: Execute tools directly without narrating your process or showing JSON arguments.
Users see structured tool results automatically. Focus your response tokens on answering their question.
</instructions>
```

## 2. ANNOTATION - BASIC

### Instructions
```
Analyze the document and extract key political positions
```

### JSON Schema
```json
{
  "properties": {
    "PositionSummary": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Brief summary of the political position stated",
      "title": "Positionsummary"
    },
    "MigrationAttitude": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Stance on migration policy",
      "title": "Migrationattitude"
    },
    "Location": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Geographic location or constituency",
      "title": "Location"
    }
  },
  "required": [
    "PositionSummary",
    "MigrationAttitude",
    "Location"
  ],
  "title": "ExampleAnnotationOutput",
  "type": "object"
}
```

## 3. ANNOTATION - WITH JUSTIFICATIONS

### Instructions
```
Analyze the document and extract key political positions

--- Justification Instructions ---
For any field requiring justification (e.g., 'fieldName_justification'), structure it with:
1. A 'reasoning' field (string) containing your explanation.
2. Optional evidence fields:
'text_spans': IMPORTANT TEXT EVIDENCE GUIDELINES - Provide 2-5 high-quality text spans that directly support your reasoning. Each span should be a complete sentence or meaningful phrase. Ensure character offsets align with sentence boundaries when possible. Format: list of objects with 'start_char_offset' (int), 'end_char_offset' (int), 'text_snippet' (str), and optionally 'asset_uuid' (str). Prefer fewer, more meaningful spans over many short fragments. Avoid overlapping spans.
'image_regions': a list, each item an object with 'asset_uuid' (str) and a 'bounding_box' object (with 'x', 'y', 'width', 'height' as floats 0-1, and optional 'label' as str).
'audio_segments': a list, each item an object with 'asset_uuid' (str), 'start_time_seconds' (float), 'end_time_seconds' (float).
'additional_evidence': a dictionary for any other structured evidence types.

For the field 'Position Summary' (titled 'Position Summary'), populate its 'Position_Summary_justification.reasoning' with: Explain how you identified and summarized the key political position from the document.
```

### JSON Schema (with justification fields)
```json
{
  "$defs": {
    "AudioSegmentEvidence": {
      "properties": {
        "asset_uuid": {
          "title": "Asset Uuid",
          "type": "string"
        },
        "start_time_seconds": {
          "title": "Start Time Seconds",
          "type": "number"
        },
        "end_time_seconds": {
          "title": "End Time Seconds",
          "type": "number"
        }
      },
      "required": [
        "asset_uuid",
        "start_time_seconds",
        "end_time_seconds"
      ],
      "title": "AudioSegmentEvidence",
      "type": "object"
    },
    "BoundingBox": {
      "properties": {
        "x": {
          "title": "X",
          "type": "number"
        },
        "y": {
          "title": "Y",
          "type": "number"
        },
        "width": {
          "title": "Width",
          "type": "number"
        },
        "height": {
          "title": "Height",
          "type": "number"
        },
        "label": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Label"
        }
      },
      "required": [
        "x",
        "y",
        "width",
        "height"
      ],
      "title": "BoundingBox",
      "type": "object"
    },
    "ImageRegionEvidence": {
      "properties": {
        "asset_uuid": {
          "title": "Asset Uuid",
          "type": "string"
        },
        "bounding_box": {
          "$ref": "#/$defs/BoundingBox"
        }
      },
      "required": [
        "asset_uuid",
        "bounding_box"
      ],
      "title": "ImageRegionEvidence",
      "type": "object"
    },
    "JustificationSubModel": {
      "properties": {
        "reasoning": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Reasoning"
        },
        "text_spans": {
          "anyOf": [
            {
              "items": {
                "$ref": "#/$defs/TextSpanEvidence"
              },
              "type": "array"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Text Spans"
        },
        "image_regions": {
          "anyOf": [
            {
              "items": {
                "$ref": "#/$defs/ImageRegionEvidence"
              },
              "type": "array"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Image Regions"
        },
        "audio_segments": {
          "anyOf": [
            {
              "items": {
                "$ref": "#/$defs/AudioSegmentEvidence"
              },
              "type": "array"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Audio Segments"
        },
        "additional_evidence": {
          "anyOf": [
            {
              "additionalProperties": true,
              "type": "object"
            },
            {
              "type": "null"
            }
          ],
          "title": "Additional Evidence"
        }
      },
      "title": "JustificationSubModel",
      "type": "object"
    },
    "TextSpanEvidence": {
      "properties": {
        "asset_uuid": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Asset Uuid"
        },
        "start_char_offset": {
          "title": "Start Char Offset",
          "type": "integer"
        },
        "end_char_offset": {
          "title": "End Char Offset",
          "type": "integer"
        },
        "text_snippet": {
          "title": "Text Snippet",
          "type": "string"
        }
      },
      "required": [
        "start_char_offset",
        "end_char_offset",
        "text_snippet"
      ],
      "title": "TextSpanEvidence",
      "type": "object"
    }
  },
  "properties": {
    "PositionSummary": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Brief summary of the political position stated",
      "title": "Positionsummary"
    },
    "PositionSummary_justification": {
      "anyOf": [
        {
          "$ref": "#/$defs/JustificationSubModel"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "Automated justification for the field 'PositionSummary'."
    },
    "MigrationAttitude": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Stance on migration policy",
      "title": "Migrationattitude"
    },
    "MigrationAttitude_justification": {
      "anyOf": [
        {
          "$ref": "#/$defs/JustificationSubModel"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "Automated justification for the field 'MigrationAttitude'."
    },
    "Location": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Geographic location or constituency",
      "title": "Location"
    },
    "Location_justification": {
      "anyOf": [
        {
          "$ref": "#/$defs/JustificationSubModel"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "Automated justification for the field 'Location'."
    }
  },
  "required": [
    "PositionSummary",
    "MigrationAttitude",
    "Location"
  ],
  "title": "ExampleAnnotationOutput",
  "type": "object"
}
```

## 4. ANNOTATION - MULTIMODAL

### Instructions
```
Analyze document and images for political messaging

--- System Data Mapping Instructions ---
For each item you generate that corresponds to a specific media input (e.g., an item in a 'per_image' list, 'per_audio' list, etc.), you MUST include a field named '_system_asset_source_uuid'. The value of this '_system_asset_source_uuid' field MUST be the exact UUID string that was provided to you in the input prompt for that specific media item. This is critical for correctly associating your analysis with the source media.
```

### JSON Schema (with per_image array)
```json
{
  "error": "Fields must not use names with leading underscores; e.g., use 'system_asset_source_uuid' instead of '_system_asset_source_uuid'."
}
```

## 5. MCP TOOLS

Total tools: 0

### All Tools

---

Sources:
- Chat: `conversation_service._build_infospace_context()`
- Annotation: `annotate._process_annotation_run_async()` + `utils.create_pydantic_model_from_json_schema()`
- Tools: FastMCP `@mcp.tool` decorators in `server.py`
