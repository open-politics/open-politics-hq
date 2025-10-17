/**
 * Working Memory Renderer
 * =======================
 * 
 * Visual display for the AI's working memory during conversations.
 * Shows pinned items, assets, findings, paths, and notes in an organized layout.
 */

import React from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps } from '../shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Pin,
  FileText,
  Lightbulb,
  MapPin,
  StickyNote,
  Trash2,
  Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface MemoryItem {
  id: string | number;
  content?: string;
  added_at?: string;
  pinned?: boolean;
  title?: string;
  [key: string]: any;
}

interface WorkingMemoryResult {
  memory: {
    assets: Record<string, MemoryItem>;
    findings: Record<string, MemoryItem>;
    paths: Record<string, MemoryItem>;
    notes: Record<string, MemoryItem>;
  };
  total_items: number;
  category?: string;
  added?: MemoryItem;
  removed?: string | number;
  item?: MemoryItem;
}

/**
 * Render confirmation for add/remove/pin operations
 */
function renderOperationResult(result: WorkingMemoryResult) {
  // Added item
  if (result.added) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border text-sm bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 text-green-900 dark:text-green-100">
        <StickyNote className="h-4 w-4 text-green-600 dark:text-green-400" />
        <span className="flex-1">
          Added to memory: <strong>{result.added.title || result.added.id}</strong>
        </span>
        <Badge variant="outline" className="text-xs">
          {result.category?.replace('s', '')}
        </Badge>
      </div>
    );
  }
  
  // Removed item
  if (result.removed) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border text-sm bg-gray-50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100">
        <Trash2 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
        <span className="flex-1">
          Removed from memory: <strong>{result.removed}</strong>
        </span>
      </div>
    );
  }
  
  // Pinned/unpinned item
  if (result.item) {
    const isPinned = result.item.pinned;
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border text-sm bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100">
        <Pin className={cn(
          "h-4 w-4",
          isPinned ? "text-blue-600 dark:text-blue-400" : "text-gray-400"
        )} />
        <span className="flex-1">
          {isPinned ? 'Pinned' : 'Unpinned'}: <strong>{result.item.title || result.item.id}</strong>
        </span>
      </div>
    );
  }
  
  return null;
}

/**
 * Render a single memory item
 */
function renderMemoryItem(
  key: string,
  item: MemoryItem,
  categoryKey: string,
  onAssetClick?: (assetId: number) => void,
  isPinned: boolean = false
) {
  const displayTitle = item.title || item.content || key;
  const isAsset = categoryKey === 'assets';
  const assetId = isAsset ? (typeof item.id === 'number' ? item.id : parseInt(String(item.id))) : null;
  
  return (
    <div
      key={key}
      className={cn(
        "group flex items-start gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
        isPinned 
          ? "bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800"
          : "bg-muted/30 hover:bg-muted/50"
      )}
    >
      {/* Pin indicator */}
      {isPinned && (
        <Pin className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
      )}
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground truncate">
          {displayTitle}
        </div>
        
        {/* Metadata */}
        {item.added_at && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Added {new Date(item.added_at).toLocaleString('en-US', { 
              month: 'short', 
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        )}
        
        {/* Additional info for specific types */}
        {item.path && (
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
            Path: {item.path}
          </div>
        )}
        {item.description && (
          <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
            {item.description}
          </div>
        )}
      </div>
      
      {/* Actions */}
      {isAsset && assetId && onAssetClick && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={() => onAssetClick(assetId)}
          title="View asset"
        >
          <Eye className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/**
 * Render a memory category (assets, findings, paths, notes)
 */
function renderCategory(
  categoryKey: string,
  items: Record<string, MemoryItem>,
  icon: React.ReactNode,
  label: string,
  onAssetClick?: (assetId: number) => void
) {
  const itemsList = Object.entries(items);
  
  if (itemsList.length === 0) {
    return null;
  }
  
  // Separate pinned from unpinned
  const pinned = itemsList.filter(([_, item]) => item.pinned);
  const unpinned = itemsList.filter(([_, item]) => !item.pinned);
  
  return (
    <div className="space-y-2">
      {/* Category header */}
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
        <Badge variant="outline" className="text-[10px] h-4">
          {itemsList.length}
        </Badge>
      </div>
      
      {/* Pinned items */}
      {pinned.length > 0 && (
        <div className="space-y-1 pl-1">
          {pinned.map(([key, item]) => renderMemoryItem(key, item, categoryKey, onAssetClick, true))}
        </div>
      )}
      
      {/* Unpinned items */}
      {unpinned.length > 0 && (
        <div className="space-y-1 pl-1">
          {unpinned.map(([key, item]) => renderMemoryItem(key, item, categoryKey, onAssetClick, false))}
        </div>
      )}
    </div>
  );
}

export const WorkingMemoryRenderer: ToolResultRenderer = {
  toolName: 'working_memory',
  
  canHandle: (result: any) => {
    return result?.memory !== undefined || result?.category !== undefined;
  },
  
  getSummary: (result: any) => {
    if (result.added) {
      return `Added to memory: ${result.added.id}`;
    }
    if (result.removed) {
      return `Removed: ${result.removed}`;
    }
    return `${result.total_items || 0} items in memory`;
  },
  
  render: ({ result, compact, onAssetClick }: ToolResultRenderProps) => {
    const typedResult = result as WorkingMemoryResult;
    
    // Handle operation confirmations (add/remove/pin/unpin)
    if (typedResult.added || typedResult.removed || typedResult.item) {
      return renderOperationResult(typedResult);
    }
    
    // Handle empty memory
    if (typedResult.total_items === 0) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30 text-sm text-muted-foreground">
          <StickyNote className="h-4 w-4" />
          Working memory is empty
        </div>
      );
    }
    
    // Compact view - just show counts
    if (compact) {
      return (
        <Badge variant="outline" className="text-xs h-6 gap-1.5">
          <StickyNote className="h-3 w-3" />
          {typedResult.total_items} items in memory
        </Badge>
      );
    }
    
    // Full view - show all memory items organized by category
    return (
      <div className="space-y-3">
        {/* Header with total count */}
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <StickyNote className="h-4 w-4 text-purple-500" />
          Working Memory
          <Badge variant="secondary" className="text-xs">
            {typedResult.total_items} items
          </Badge>
        </div>
        
        {/* Memory categories */}
        <div className="space-y-3">
          {renderCategory(
            'assets',
            typedResult.memory.assets,
            <FileText className="h-3.5 w-3.5" />,
            'Assets',
            onAssetClick
          )}
          {renderCategory(
            'findings',
            typedResult.memory.findings,
            <Lightbulb className="h-3.5 w-3.5" />,
            'Findings'
          )}
          {renderCategory(
            'paths',
            typedResult.memory.paths,
            <MapPin className="h-3.5 w-3.5" />,
            'Paths'
          )}
          {renderCategory(
            'notes',
            typedResult.memory.notes,
            <StickyNote className="h-3.5 w-3.5" />,
            'Notes'
          )}
        </div>
      </div>
    );
  },
};
