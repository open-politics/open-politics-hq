/**
 * Shared TypeScript types for the Intelligence Tool System
 */

export interface ToolResultRenderProps {
  /** Tool execution result data */
  result: any;
  /** Tool name (e.g., "navigate", "organize") */
  toolName: string;
  /** Execution ID for tracking */
  executionId?: string;
  /** Compact mode for inline rendering */
  compact?: boolean;
  /** Callback when asset is clicked */
  onAssetClick?: (assetId: number) => void;
  /** Callback when bundle is clicked */
  onBundleClick?: (bundleId: number) => void;
}

export interface NavigateResult {
  resource: 'assets' | 'bundles' | 'schemas' | 'runs';
  mode: 'list' | 'search' | 'load';
  depth: 'ids' | 'titles' | 'previews' | 'full';
  items?: any[];
  bundle_data?: Record<string, BundleData>;
  total: number;
  query?: string;
  message: string;
}

export interface BundleData {
  bundle_id: number;
  bundle_name: string;
  bundle_description?: string;
  asset_count: number;
  assets: AssetItem[];
  created_at?: string;
}

export interface AssetItem {
  id: number;
  title: string;
  kind?: string;
  text_content?: string;
  source_metadata?: any;
  created_at?: string;
  updated_at?: string;
}

export interface OrganizeResult {
  operation: 'create' | 'add' | 'remove' | 'rename' | 'delete';
  bundle_id?: number;
  bundle_name?: string;
  bundle_description?: string;
  assets_added?: number;
  assets_removed?: number;
  assets_failed?: number;
  status: 'success' | 'partial_success' | 'failed';
  error?: string;
}

export interface TreeItem {
  id: string;
  type: 'folder' | 'asset' | 'schema' | 'run';
  name: string;
  count?: number;
  asset?: AssetItem;
  bundle?: {
    id: number;
    name: string;
    description?: string;
    asset_count: number;
  };
  children?: TreeItem[];
  level: number;
  metadata?: Record<string, any>;
}

export interface SemanticSearchChunk {
  rank: number;
  similarity: number;
  distance: number;
  asset_id: number;
  asset_uuid: string;
  asset_title: string;
  asset_kind: string;
  chunk_id: number;
  chunk_index: number;
  chunk_text: string;
  chunk_metadata?: Record<string, any>;
}

export interface SemanticSearchResult {
  queries: string[];
  multi_query: boolean;
  combined: boolean;
  total_results: number;
  results: SemanticSearchChunk[];
  asset_ids: number[];
  query_results_map?: Record<string, number>;
}

