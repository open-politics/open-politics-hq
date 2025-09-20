# Intelligence Chat API Examples

## Overview
The intelligence chat system provides AI models with tools to search, analyze, and interact with intelligence data. Models can orchestrate complex analysis workflows through function calls.

## Example Conversations

### 1. Basic Intelligence Query
```
User: "What are the main themes in recent political documents?"

AI Model Workflow:
1. search_assets(query="political", search_method="hybrid", limit=20)
2. get_asset_details(asset_ids=[1,2,3,4,5])
3. list_schemas() to find theme extraction schema
4. analyze_assets(asset_ids=[1,2,3,4,5], schema_id=3)
5. Present aggregated theme analysis
```

### 2. Targeted Analysis
```
User: "Find documents about climate policy from last month and analyze their sentiment"

AI Model Workflow:
1. search_assets(query="climate policy", search_method="semantic", limit=15)
2. Filter results by date (in analysis)
3. list_schemas() to find sentiment analysis schema
4. analyze_assets(asset_ids=[filtered_ids], schema_id=7)
5. Present sentiment analysis results
```

### 3. Cross-Reference Analysis
```
User: "Compare how different sources report on the same event"

AI Model Workflow:
1. search_assets(query="specific event", search_method="hybrid")
2. get_asset_details(asset_ids=[found_ids])
3. Group by source metadata
4. analyze_assets() with comparison schema
5. Present comparative analysis
```

## Available Search Methods

### Text Search (`search_method: "text"`)
- Traditional keyword search
- Searches in asset titles and content
- Fast and precise for known terms
- Good for finding specific documents

### Semantic Search (`search_method: "semantic"`)
- Vector similarity search using embeddings
- Finds conceptually similar content
- Good for discovering related themes
- Works even with different terminology

### Hybrid Search (`search_method: "hybrid"`)
- Combines text and semantic search
- Deduplicates results
- Prioritizes documents found by both methods
- Best overall relevance

## Tool Orchestration Benefits

1. **Dynamic Discovery**: Models find relevant documents instead of being limited to pre-selected ones
2. **Multi-Step Analysis**: Models can search → analyze → aggregate in one conversation
3. **Context Awareness**: Models understand the infospace structure and available schemas
4. **Flexible Workflows**: Different queries trigger different tool usage patterns

## API Endpoints

- `POST /api/v1/chat/chat` - Main intelligence chat with tool orchestration
- `GET /api/v1/chat/models` - Discover available models
- `GET /api/v1/chat/tools/{infospace_id}` - List available tools
- `POST /api/v1/chat/tools/execute` - Execute individual tool calls
