/**
 * Navigate Renderer
 * 
 * UPDATED: Now uses ConversationalAssetExplorer for intelligent, interactive results.
 * Shows CSV headers immediately, bundle previews, and allows user exploration.
 */

import React from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps, NavigateResult } from '../shared/types';
import { ConversationalAssetExplorer } from './ConversationalAssetExplorer';
import { EmptyResult } from '../shared/ResultComponents';

/**
 * Navigate Renderer - Simplified with ConversationalAssetExplorer
 */
export const NavigateRenderer: ToolResultRenderer = {
  toolName: 'navigate',
  
  canHandle: (result: any) => {
    return result?.resource && ['assets', 'bundles', 'schemas', 'runs', 'files'].includes(result.resource);
  },
  
  getSummary: (result: NavigateResult) => {
    const resource = result.resource || 'items';
    const total = result.total || result.total_nodes || (result.nodes?.length) || 0;
    const mode = result.mode || 'list';
    
    if (mode === 'tree' || resource === 'files') {
      return `Workspace: ${total} items`;
    }
    
    if (mode === 'expand' && result.parent_id) {
      return `${result.parent_id}: ${total} items`;
    }
    
    if (mode === 'search' && result.query) {
      return `Found ${total} "${result.query}"`;
    }
    
    return `${total} ${resource}`;
  },
  
  render: ({ result, compact, onAssetClick, onBundleClick }: ToolResultRenderProps) => {
    const navigateResult = result as NavigateResult;
    
    return (
      <ConversationalAssetExplorer
        result={navigateResult}
        compact={compact}
        onAssetClick={onAssetClick}
        onBundleClick={onBundleClick}
      />
    );
  },
};
