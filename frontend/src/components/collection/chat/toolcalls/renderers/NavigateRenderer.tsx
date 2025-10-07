/**
 * Navigate Renderer
 * 
 * Renders results from the navigate() operator tool.
 * Handles all resources (assets, bundles, schemas, runs) with flexible depth.
 */

import React from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps, NavigateResult, TreeItem } from '../shared/types';
import { AssetTreeViewer } from '../viewers/AssetTreeViewer';

/**
 * Transform navigate result to tree format
 */
function transformToTree(result: NavigateResult): TreeItem[] {
  const tree: TreeItem[] = [];
  
  // Handle bundles with mode="load" (bundle_data format)
  if (result.bundle_data) {
    Object.entries(result.bundle_data).forEach(([bundleId, data]) => {
      const children: TreeItem[] = (data.assets || []).map((asset, idx) => ({
        id: `asset-${asset.id}`,
        type: 'asset' as const,
        name: asset.title,
        asset: asset,
        level: 1,
      }));
      
      tree.push({
        id: `bundle-${bundleId}`,
        type: 'folder',
        name: data.bundle_name,
        count: data.asset_count,
        bundle: {
          id: data.bundle_id,
          name: data.bundle_name,
          description: data.bundle_description,
          asset_count: data.asset_count,
        },
        children,
        level: 0,
      });
    });
    return tree;
  }
  
  // Handle items array (list/search mode)
  if (result.items && Array.isArray(result.items)) {
    if (result.resource === 'bundles') {
      // Bundle list
      result.items.forEach(bundle => {
        tree.push({
          id: `bundle-${bundle.id}`,
          type: 'folder',
          name: bundle.name,
          count: bundle.asset_count,
          bundle: {
            id: bundle.id,
            name: bundle.name,
            description: bundle.description,
            asset_count: bundle.asset_count || 0,
          },
          level: 0,
          metadata: {
            created_at: bundle.created_at,
            description: bundle.description,
          },
        });
      });
    } else if (result.resource === 'assets') {
      // Asset list
      result.items.forEach(asset => {
        tree.push({
          id: `asset-${asset.id}`,
          type: 'asset',
          name: asset.title,
          asset: asset,
          level: 0,
        });
      });
    } else if (result.resource === 'schemas') {
      // Schema list
      result.items.forEach(schema => {
        tree.push({
          id: `schema-${schema.id}`,
          type: 'schema',
          name: schema.name,
          level: 0,
          metadata: {
            description: schema.description,
            version: schema.version,
          },
        });
      });
    } else if (result.resource === 'runs') {
      // Run list
      result.items.forEach(run => {
        tree.push({
          id: `run-${run.id}`,
          type: 'run',
          name: run.name,
          level: 0,
          metadata: {
            description: run.description,
            status: run.status,
          },
        });
      });
    }
  }
  
  return tree;
}

/**
 * Navigate renderer implementation
 */
export const NavigateRenderer: ToolResultRenderer = {
  toolName: 'navigate',
  
  canHandle: (result: any) => {
    // Check if it's a navigate result
    if (result?.resource && ['assets', 'bundles', 'schemas', 'runs'].includes(result.resource)) {
      return true;
    }
    return false;
  },
  
  getSummary: (result: NavigateResult) => {
    const resource = result.resource || 'items';
    const mode = result.mode || 'list';
    const total = result.total || 0;
    
    if (mode === 'search' && result.query) {
      return `Found ${total} ${resource} matching "${result.query}"`;
    }
    
    if (mode === 'load') {
      return `Loaded ${total} ${resource}`;
    }
    
    return `${total} ${resource}`;
  },
  
  render: ({ result, compact }: ToolResultRenderProps) => {
    const navigateResult = result as NavigateResult;
    const tree = transformToTree(navigateResult);
    
    return (
      <AssetTreeViewer
        tree={tree}
        compact={compact}
        totalCount={navigateResult.total}
        message={navigateResult.message}
        // AssetTreeViewer uses full AssetDetailView/BundleDetailView internally
        // No need to pass onAssetClick/onBundleClick - handled by detail views
      />
    );
  },
};

