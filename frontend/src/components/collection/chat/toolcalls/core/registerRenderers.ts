/**
 * Register Tool Renderers
 * 
 * Auto-register all tool renderers with the registry.
 * Call this once during app initialization.
 */

import { toolResultRegistry } from './ToolResultRegistry';
import { NavigateRenderer } from '../renderers/NavigateRenderer';
import { OrganizeRenderer } from '../renderers/OrganizeRenderer';
import { SemanticSearchRenderer } from '../renderers/SemanticSearchRenderer';
import { SearchWebRenderer } from '../renderers/SearchWebRenderer';

let isInitialized = false;

/**
 * Initialize tool renderers
 * Safe to call multiple times - only initializes once
 */
export function initializeToolRenderers(): void {
  if (isInitialized) {
    return;
  }
  
  // Register all renderers
  toolResultRegistry.register(NavigateRenderer);
  toolResultRegistry.register(OrganizeRenderer);
  toolResultRegistry.register(SemanticSearchRenderer);
  toolResultRegistry.register(SearchWebRenderer);
  
  isInitialized = true;
  
  console.log(
    `[Intelligence Tools] Registered ${toolResultRegistry.getAllTools().length} tool renderers:`,
    toolResultRegistry.getAllTools()
  );
}

// Auto-initialize on import
initializeToolRenderers();

