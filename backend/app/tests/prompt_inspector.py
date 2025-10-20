"""
Comprehensive prompt inspector - shows ACTUAL text sent to LLMs

Usage:
    python -m app.utils.prompt_inspector
    python scripts/inspect_prompts.py
    
Output is saved to: backend/app/tests/current_prompts.md
"""
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


def inspect_chat_prompt(infospace_name: str = "Example Workspace", 
                       infospace_description: str = "Research workspace") -> str:
    """Get the actual chat system prompt by calling the real function"""
    from app.api.services.conversation_service import IntelligenceConversationService
    
    # Mock infospace
    mock_infospace = type('Infospace', (), {
        'name': infospace_name,
        'description': infospace_description
    })()
    
    # Create service (only needs infospace for prompt building)
    service = IntelligenceConversationService(
        session=None, model_registry=None, asset_service=None,
        annotation_service=None, content_ingestion_service=None
    )
    
    return service._build_infospace_context(mock_infospace)


def inspect_annotation_prompt(
    schema_instructions: str = "Analyze the document and extract key political positions",
    include_justifications: bool = False,
    has_per_modality: bool = False
) -> Dict[str, Any]:
    """
    Build a realistic annotation prompt showing actual construction logic.
    Returns dict with 'instructions', 'example_schema', and 'pydantic_json_schema' keys.
    """
    from app.api.tasks.utils import create_pydantic_model_from_json_schema
    
    # Example schema structure (realistic political analysis schema)
    # This matches the actual format of AnnotationSchema.output_contract
    example_schema = {
        "type": "object",
        "properties": {
            "Position Summary": {
                "type": "string",
                "title": "Position Summary",
                "description": "Brief summary of the political position stated"
            },
            "Migration Attitude": {
                "type": "string",
                "title": "Migration Attitude",
                "description": "Stance on migration policy"
            },
            "Location": {
                "type": "string",
                "title": "Location",
                "description": "Geographic location or constituency"
            }
        },
        "required": ["Position Summary"]
    }
    
    if has_per_modality:
        example_schema["properties"]["per_image"] = {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "_system_asset_source_uuid": {"type": "string"},
                    "visual_sentiment": {"type": "string"},
                    "key_symbols": {"type": "array", "items": {"type": "string"}}
                }
            }
        }
    
    # Build instructions following the actual annotate.py logic
    final_instructions = schema_instructions
    
    # Add justification instructions if enabled (from annotate.py ~lines 1116-1177)
    if include_justifications:
        final_instructions += "\n\n--- Justification Instructions ---\n"
        final_instructions += (
            "For any field requiring justification (e.g., 'fieldName_justification'), structure it with:\n"
            "1. A 'reasoning' field (string) containing your explanation.\n"
            "2. Optional evidence fields:\n"
            "'text_spans': IMPORTANT TEXT EVIDENCE GUIDELINES - Provide 2-5 high-quality text spans that directly support your reasoning. "
            "Each span should be a complete sentence or meaningful phrase. Ensure character offsets align with sentence boundaries when possible. "
            "Format: list of objects with 'start_char_offset' (int), 'end_char_offset' (int), 'text_snippet' (str), and optionally 'asset_uuid' (str). "
            "Prefer fewer, more meaningful spans over many short fragments. Avoid overlapping spans.\n"
            "'image_regions': a list, each item an object with 'asset_uuid' (str) and a 'bounding_box' object (with 'x', 'y', 'width', 'height' as floats 0-1, and optional 'label' as str).\n"
            "'audio_segments': a list, each item an object with 'asset_uuid' (str), 'start_time_seconds' (float), 'end_time_seconds' (float).\n"
            "'additional_evidence': a dictionary for any other structured evidence types.\n\n"
        )
        
        # Field-specific prompts (example for Position Summary)
        final_instructions += (
            "For the field 'Position Summary' (titled 'Position Summary'), populate its 'Position_Summary_justification.reasoning' with: "
            "Explain how you identified and summarized the key political position from the document."
        )
    
    # Add system mapping instructions for per-modality (from annotate.py ~lines 1180-1192)
    if has_per_modality:
        final_instructions += (
            "\n\n--- System Data Mapping Instructions ---\n"
            "For each item you generate that corresponds to a specific media input (e.g., an item in a 'per_image' list, 'per_audio' list, etc.), "
            "you MUST include a field named '_system_asset_source_uuid'. "
            "The value of this '_system_asset_source_uuid' field MUST be the exact UUID string that was provided to you in the input prompt for that specific media item. "
            "This is critical for correctly associating your analysis with the source media."
        )
    
    # Generate the ACTUAL Pydantic model and its JSON schema that would be sent to the model
    try:
        OutputModel = create_pydantic_model_from_json_schema(
            model_name="ExampleAnnotationOutput",
            json_schema=example_schema,
            justification_mode="ALL_WITH_SCHEMA_OR_DEFAULT_PROMPT" if include_justifications else "NONE",
            field_specific_justification_configs={}
        )
        # This is what actually gets sent to the model via model_registry.classify()
        pydantic_json_schema = OutputModel.model_json_schema()
    except Exception as e:
        logger.warning(f"Failed to generate Pydantic model: {e}")
        pydantic_json_schema = {"error": str(e)}
    
    return {
        "instructions": final_instructions,
        "example_schema": example_schema,
        "pydantic_json_schema": pydantic_json_schema  # EXACT schema sent to model
    }


def inspect_mcp_tools() -> List[Dict[str, Any]]:
    """Get actual MCP tool definitions with EXACT JSON schemas sent to models"""
    from app.api.mcp.server import mcp
    import asyncio
    
    tools_info = []
    
    # Use FastMCP's official _list_tools() method
    try:
        # _list_tools() is async, so we need to run it
        tools = asyncio.run(mcp._list_tools())
        
        for tool in tools:
            # Extract first line as summary
            summary = tool.description.split('\n')[0] if tool.description else "No description"
            
            # Get parameter count
            param_count = len(tool.parameters.get('properties', {})) if tool.parameters else 0
            
            # Extract parameter names and check if required
            params = []
            if tool.parameters and 'properties' in tool.parameters:
                required_params = tool.parameters.get('required', [])
                for param_name in tool.parameters['properties'].keys():
                    params.append({
                        'name': param_name,
                        'required': param_name in required_params
                    })
            
            tools_info.append({
                'name': tool.name,
                'tags': list(tool.tags) if tool.tags else [],
                'summary': summary,
                'full_doc': tool.description,
                'param_count': param_count,
                'params': params,
                # IMPORTANT: This is the exact JSON schema sent to the model
                'json_schema': tool.parameters
            })
    except Exception as e:
        logger.warning(f"Failed to extract MCP tools: {e}")
        # Return empty list if extraction fails
        return []
    
    return sorted(tools_info, key=lambda x: x['name'])


def format_xml_section(title: str, content: str, level: int = 1) -> str:
    """Format a section with XML-style tags"""
    indent = "  " * (level - 1)
    tag = title.lower().replace(" ", "_")
    return f"{indent}<{tag}>\n{content}\n{indent}</{tag}>"


def print_all(save_to_file: bool = True):
    """
    Print all prompts to console - raw format for readability.
    
    Args:
        save_to_file: If True, saves output to backend/app/tests/current_prompts.md
    """
    output_lines = []
    
    def log(text: str = ""):
        """Helper to collect output"""
        output_lines.append(text)
    
    log(f"# Prompt Inspection - Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    log("")
    log("Raw prompts, schemas, and tool definitions sent to LLMs.")
    log("")
    
    # ===== CHAT MODE =====
    log("## 1. CHAT SYSTEM PROMPT")
    log("")
    chat_prompt = inspect_chat_prompt()
    log("```")
    log(chat_prompt)
    log("```")
    log("")
    
    # ===== ANNOTATION MODE (Basic) =====
    log("## 2. ANNOTATION - BASIC")
    log("")
    
    basic_annotation = inspect_annotation_prompt(
        schema_instructions="Analyze the document and extract key political positions",
        include_justifications=False,
        has_per_modality=False
    )
    
    import json
    log("### Instructions")
    log("```")
    log(basic_annotation["instructions"])
    log("```")
    log("")
    log("### JSON Schema")
    log("```json")
    log(json.dumps(basic_annotation['pydantic_json_schema'], indent=2))
    log("```")
    log("")
    
    # ===== ANNOTATION MODE (With Justifications) =====
    log("## 3. ANNOTATION - WITH JUSTIFICATIONS")
    log("")
    
    justified_annotation = inspect_annotation_prompt(
        schema_instructions="Analyze the document and extract key political positions",
        include_justifications=True,
        has_per_modality=False
    )
    
    log("### Instructions")
    log("```")
    log(justified_annotation["instructions"])
    log("```")
    log("")
    log("### JSON Schema (with justification fields)")
    log("```json")
    log(json.dumps(justified_annotation['pydantic_json_schema'], indent=2))
    log("```")
    log("")
    
    # ===== ANNOTATION MODE (Multimodal) =====
    log("## 4. ANNOTATION - MULTIMODAL")
    log("")
    
    multimodal_annotation = inspect_annotation_prompt(
        schema_instructions="Analyze document and images for political messaging",
        include_justifications=False,
        has_per_modality=True
    )
    
    log("### Instructions")
    log("```")
    log(multimodal_annotation["instructions"])
    log("```")
    log("")
    log("### JSON Schema (with per_image array)")
    log("```json")
    log(json.dumps(multimodal_annotation['pydantic_json_schema'], indent=2))
    log("```")
    log("")
    
    # ===== MCP TOOLS =====
    log("## 5. MCP TOOLS")
    log("")
    
    tools = inspect_mcp_tools()
    log(f"Total tools: {len(tools)}")
    log("")
    
    # Show just one complete example tool
    if tools:
        example_tool = next((t for t in tools if t['name'] == 'navigate'), tools[0])
        log("### Example Tool (navigate)")
        log("```json")
        mcp_tool_format = {
            "type": "mcp",
            "name": example_tool['name'],
            "description": example_tool['full_doc'],
            "parameters": example_tool['json_schema']
        }
        log(json.dumps(mcp_tool_format, indent=2))
        log("```")
        log("")
    
    # List all tool names
    log("### All Tools")
    for tool in tools:
        tags = ", ".join(tool['tags']) if tool['tags'] else ""
        params = ', '.join(p['name'] for p in tool['params']) if tool['params'] else "no params"
        log(f"- `{tool['name']}` ({params}) [{tags}]")
    
    log("")
    log("---")
    log("")
    log("Sources:")
    log("- Chat: `conversation_service._build_infospace_context()`")
    log("- Annotation: `annotate._process_annotation_run_async()` + `utils.create_pydantic_model_from_json_schema()`")
    log("- Tools: FastMCP `@mcp.tool` decorators in `server.py`")
    log("")
    
    # Save to file if requested
    if save_to_file:
        output_path = Path(__file__).parent / "current_prompts.md"
        try:
            with open(output_path, 'w') as f:
                f.write('\n'.join(output_lines))
            log(f"✅ Saved to: {output_path}")
        except Exception as e:
            log(f"⚠️  Failed to save file: {e}")


if __name__ == "__main__":
    print_all()
