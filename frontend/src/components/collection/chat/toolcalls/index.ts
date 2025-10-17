/**
 * Intelligence Tool System
 * 
 * Exports for the tool result rendering system
 */

// Core system
export { toolResultRegistry } from './core/ToolResultRegistry';
export type { ToolResultRenderer } from './core/ToolResultRegistry';
export { initializeToolRenderers } from './core/registerRenderers';
export { ToolResultDisplay } from './core/ToolResultDisplay';

// Types
export type { 
  ToolResultRenderProps,
  NavigateResult,
  OrganizeResult,
  TreeItem,
  BundleData,
  AssetItem,
  SemanticSearchResult,
  SemanticSearchChunk,
} from './shared/types';

// Renderers (for direct access if needed)
export { NavigateRenderer } from './renderers/NavigateRenderer';
export { OrganizeRenderer, AssetCrudRenderer, IngestRenderer } from './renderers/OperationRenderer';
export { SearchWebRenderer } from './renderers/SearchWebRenderer';
export { SemanticSearchRenderer } from './renderers/SemanticSearchRenderer';
export { GetRunDashboardRenderer } from './renderers/GetRunDashboardRenderer';
export { WorkingMemoryRenderer } from './renderers/WorkingMemoryRenderer';
export { TasksRenderer } from './renderers/TasksRenderer';
export { GenericRenderer } from './renderers/GenericRenderer';

// Advanced components (used by renderers, exported for custom use)
export { ConversationalAssetExplorer } from './renderers/ConversationalAssetExplorer';


// Shared components
export { ToolResultCard } from './shared/ToolResultCard';
export {
  ResultHeader,
  StatusIndicator,
  EmptyResult,
  CompactResult,
  ResultContainer,
  MetadataList,
  ResultFooter,
} from './shared/ResultComponents';

// Shared utilities (for custom renderers)
export {
  formatToolName,
  getToolIcon,
  getStatusIcon,
  getStatusColorClass,
  resolveMarkdownUrls,
  truncateText,
  isStructuredResult,
  formatPercentage,
  formatCount,
} from './shared/utils';

// Shared hooks (for custom renderers)
export {
  useSelection,
  useExpansion,
  useSearch,
  useFilteredItems,
} from './shared/hooks';
