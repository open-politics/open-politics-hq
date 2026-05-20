/**
 * Register Tool Renderers
 * 
 * Auto-register all tool renderers with the registry.
 * 
 * NEW ARCHITECTURE:
 * - Navigate: Uses ConversationalAssetExplorer (interactive, rich previews)
 * - Operations: Minimal badges (organize, asset CRUD, ingest)
 * - Exploration: Full renderers (semantic_search, search_web, dashboards)
 */

import { toolResultRegistry } from './ToolResultRegistry';
import { NavigateRenderer } from '../renderers/NavigateRenderer';
import { 
  OrganizeRenderer, 
  AssetCrudRenderer, 
  IngestRenderer 
} from '../renderers/OperationRenderer';
import { SemanticSearchRenderer } from '../renderers/SemanticSearchRenderer';
import { SearchWebRenderer } from '../renderers/SearchWebRenderer';
import { GetRunDashboardRenderer } from '../renderers/GetRunDashboardRenderer';
import { ListRunsRenderer } from '../renderers/ListRunsRenderer';
import { WorkingMemoryRenderer } from '../renderers/WorkingMemoryRenderer';
import { TasksRenderer } from '../renderers/TasksRenderer';
import { AnalysisHubRenderer } from '../renderers/AnalysisHubRenderer';

let isInitialized = false;

/**
 * Initialize tool renderers
 * Safe to call multiple times - only initializes once
 */
export function initializeToolRenderers(): void {
  if (isInitialized) {
    return;
  }
  
  // Core exploration tools (rich, interactive)
  toolResultRegistry.register(NavigateRenderer);
  // Hub tools use the same renderer as navigate
  toolResultRegistry.register({ ...NavigateRenderer, toolName: 'workspace_hub' });
  toolResultRegistry.register({ ...NavigateRenderer, toolName: 'library_hub' });
  toolResultRegistry.register(SemanticSearchRenderer);
  toolResultRegistry.register(SearchWebRenderer);
  // Current MCP tool name. Same renderer — it accepts both legacy ``search_web``
  // (flat shape) and ``web_research`` (search nested under .search, optional
  // .ingestion summary).
  toolResultRegistry.register({ ...SearchWebRenderer, toolName: 'web_research' });
  toolResultRegistry.register(GetRunDashboardRenderer);
  toolResultRegistry.register(ListRunsRenderer);
  toolResultRegistry.register(AnalysisHubRenderer);
  
  // Operation tools (minimal, confirmatory)
  toolResultRegistry.register(OrganizeRenderer);
  toolResultRegistry.register(AssetCrudRenderer);
  // Also register AssetCrudRenderer for library_hub operations
  toolResultRegistry.register({ ...AssetCrudRenderer, toolName: 'library_hub' });
  toolResultRegistry.register(IngestRenderer);
  
  // Memory and context tools
  toolResultRegistry.register(WorkingMemoryRenderer);
  toolResultRegistry.register(TasksRenderer);
  
  isInitialized = true;
  
  console.log(
    `[Intelligence Tools] Registered ${toolResultRegistry.getAllTools().length} tool renderers:`,
    toolResultRegistry.getAllTools()
  );
}

// Auto-initialize on import
initializeToolRenderers();

