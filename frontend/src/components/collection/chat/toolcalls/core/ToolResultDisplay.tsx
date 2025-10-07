/**
 * Tool Result Display
 * 
 * Main orchestrator that routes tool results to appropriate renderers
 * via the registry system.
 */

import React from 'react';
import { toolResultRegistry } from './ToolResultRegistry';
import { ToolResultCard } from '../shared/ToolResultCard';
import { GenericRenderer } from '../renderers/GenericRenderer';
import { ToolResultRenderProps } from '../shared/types';
import { formatToolName, getToolIcon, formatCount } from '../shared/utils';

interface ToolResultDisplayProps {
  toolName: string;
  result: any;
  compact?: boolean;
  executionId?: string;
  onAssetClick?: (assetId: number) => void;
  onBundleClick?: (bundleId: number) => void;
}

/**
 * Main display component - routes to appropriate renderer
 */
export function ToolResultDisplay({
  toolName,
  result,
  compact = false,
  executionId,
  onAssetClick,
  onBundleClick
}: ToolResultDisplayProps) {
  // Build render props
  const renderProps: ToolResultRenderProps = {
    result,
    toolName,
    executionId,
    compact,
    onAssetClick,
    onBundleClick
  };
  
  // Try to find a registered renderer
  const renderer = toolResultRegistry.getRenderer(toolName, result);
  
  // Fallback to generic renderer if no specific renderer found
  if (!renderer) {
    return <GenericRenderer {...renderProps} />;
  }
  
  // Get summary for card header
  const summary = renderer.getSummary?.(result);
  const badge = result?.total ? `${result.total} items` : undefined;
  
  // Render in card wrapper if not compact
  if (!compact) {
    return (
      <ToolResultCard
        title={formatToolName(toolName)}
        summary={summary}
        icon={getToolIcon(toolName)}
        badge={badge}
        compact={false}
      >
        {renderer.render(renderProps)}
      </ToolResultCard>
    );
  }
  
  // Compact mode - render directly
  return <>{renderer.render(renderProps)}</>;
}

