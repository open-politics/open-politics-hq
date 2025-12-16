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

export interface TreeNode {
  id: string;
  type: 'bundle' | 'asset';
  name: string;
  kind?: string;
  has_children?: boolean;
  children_count?: number;
  is_container?: boolean;
  parent_id?: string;
  updated_at?: string;
  created_at?: string;
  source_metadata?: {
    original_row_data?: Record<string, any>;
    [key: string]: any;
  };
  preview?: {
    columns?: string[];
    row_count?: number;
    sample_rows?: any[];
    page_count?: number;
    excerpt?: string;
    kinds?: Record<string, number>;
    date_range?: { earliest: string; latest: string };
    sample_titles?: string[];
    [key: string]: any;
  };
}

export interface NavigateResult {
  resource: 'assets' | 'bundles' | 'schemas' | 'runs' | 'files';
  mode: 'list' | 'search' | 'load' | 'tree' | 'view' | 'expand' | 'open';  // 'view' is the new term, 'expand' kept for backward compat, 'open' for auto-open
  depth?: 'ids' | 'titles' | 'previews' | 'full' | 'tree';
  items?: any[];
  bundle_data?: Record<string, BundleData>;
  // New tree structure fields
  nodes?: TreeNode[];
  children?: TreeNode[];
  parent_id?: string;
  parent_name?: string;
  parent_type?: 'bundle' | 'asset';
  parent_kind?: string;
  parent_preview?: {
    columns?: string[];
    row_count?: number;
    sample_rows?: any[];
    sample_count?: number;
    asset_count?: number;
    [key: string]: any;
  };
  total_nodes?: number;
  // Legacy/common fields
  total?: number;
  query?: string;
  message: string;
  summary?: string;  // Backend summary text (may contain ASCII tables)
  // Auto-open fields (for mode: 'open')
  auto_open?: boolean;
  asset_id?: number;
  bundle_id?: number;
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

