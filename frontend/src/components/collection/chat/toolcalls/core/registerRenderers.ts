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
  toolResultRegistry.register(SemanticSearchRenderer);
  toolResultRegistry.register(SearchWebRenderer);
  toolResultRegistry.register(GetRunDashboardRenderer);
  toolResultRegistry.register(ListRunsRenderer);
  
  // Operation tools (minimal, confirmatory)
  toolResultRegistry.register(OrganizeRenderer);
  toolResultRegistry.register(AssetCrudRenderer);
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

