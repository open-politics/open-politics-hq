/**
 * Operation Renderer
 * ==================
 * 
 * Minimal display for CRUD operations (organize, delete, create, update).
 * 
 * DESIGN PRINCIPLE:
 * Operations should be *barely visible* - just a tiny confirmation.
 * The user cares about the result, not the action.
 * 
 * Bad:  Big card with "✅ Operation completed: Deleted asset #123"
 * Good: Small badge "🗑️ Deleted: document.pdf"
 */

import React from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps } from '../shared/types';
import { Badge } from '@/components/ui/badge';
import { 
  CheckCircle2, 
  Trash2, 
  Plus, 
  Edit3, 
  FolderPlus,
  FolderMinus,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Organize Renderer - For bundle operations
 */
export const OrganizeRenderer: ToolResultRenderer = {
  toolName: 'organize',
  
  canHandle: (result: any) => {
    return result?.operation && ['create', 'add', 'remove', 'rename', 'delete'].includes(result.operation);
  },
  
  getSummary: (result: any) => {
    const op = result.operation;
    const name = result.bundle_name || result.name || '';
    
    switch (op) {
      case 'create': return `Created: ${name}`;
      case 'add': return `Added ${result.assets_added || 0} items`;
      case 'remove': return `Removed ${result.assets_removed || 0} items`;
      case 'rename': return `Renamed: ${name}`;
      case 'delete': return `Deleted bundle`;
      default: return 'Bundle updated';
    }
  },
  
  render: ({ result, compact }: ToolResultRenderProps) => {
    const op = result.operation;
    const status = result.status || 'success';
    const name = result.bundle_name || result.name || `Bundle #${result.bundle_id}`;
    
    // Icon based on operation
    let Icon = CheckCircle2;
    let action = 'Updated';
    
    switch (op) {
      case 'create':
        Icon = FolderPlus;
        action = 'Created';
        break;
      case 'add':
        Icon = Plus;
        action = `Added ${result.assets_added || 0} to`;
        break;
      case 'remove':
        Icon = FolderMinus;
        action = `Removed ${result.assets_removed || 0} from`;
        break;
      case 'rename':
        Icon = Edit3;
        action = 'Renamed';
        break;
      case 'delete':
        Icon = Trash2;
        action = 'Deleted';
        break;
    }
    
    const isSuccess = status === 'success' || !result.error;
    
    if (compact) {
      return (
        <Badge 
          variant={isSuccess ? "default" : "destructive"}
          className="text-xs h-6 gap-1.5"
        >
          <Icon className="h-3 w-3" />
          {action} {name}
        </Badge>
      );
    }
    
    return (
      <div className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md border text-sm",
        isSuccess 
          ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 text-green-900 dark:text-green-100"
          : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100"
      )}>
        <Icon className={cn(
          "h-4 w-4 shrink-0",
          isSuccess ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
        )} />
        <span className="flex-1">
          {action} <strong>{name}</strong>
        </span>
        {!isSuccess && result.error && (
          <span className="text-xs">({result.error})</span>
        )}
      </div>
    );
  },
};

/**
 * Asset CRUD Renderer - For asset operations
 */
export const AssetCrudRenderer: ToolResultRenderer = {
  toolName: 'asset',
  
  canHandle: (result: any) => {
    return result?.status && ['created', 'updated', 'deleted'].includes(result.status);
  },
  
  getSummary: (result: any) => {
    const status = result.status;
    const title = result.asset_title || 'Asset';
    
    switch (status) {
      case 'created': return `Created: ${title}`;
      case 'updated': return `Updated: ${title}`;
      case 'deleted': return `Deleted: ${title}`;
      default: return 'Asset modified';
    }
  },
  
  render: ({ result, compact, onAssetClick }: ToolResultRenderProps) => {
    const status = result.status;
    const title = result.asset_title || `Asset #${result.asset_id}`;
    const kind = result.asset_kind;
    const assetId = result.asset_id;
    const isCsvRow = kind === 'csv_row';
    const isCsvContainer = kind === 'csv';
    
    // Icon based on status
    let Icon = CheckCircle2;
    let action = 'Modified';
    
    switch (status) {
      case 'created':
        Icon = Plus;
        action = 'Created';
        break;
      case 'updated':
        Icon = Edit3;
        action = 'Updated';
        break;
      case 'deleted':
        Icon = Trash2;
        action = 'Deleted';
        break;
    }
    
    if (compact) {
      return (
        <Badge variant="default" className="text-xs h-6 gap-1.5">
          <Icon className="h-3 w-3" />
          {action} {isCsvRow ? 'row' : title}
        </Badge>
      );
    }
    
    // CSV Container - show dataset info
    if (isCsvContainer && result.columns) {
      const columns = result.columns;
      const columnCount = result.column_count || columns.length;
      const rowCount = result.row_count || 0;
      
      return (
        <div 
          className={cn(
            "px-3 py-2 rounded-md border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800",
            assetId && onAssetClick && "cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-950/30 transition-colors"
          )}
          onClick={assetId && onAssetClick ? () => onAssetClick(assetId) : undefined}
          role={assetId && onAssetClick ? "button" : undefined}
          title={assetId && onAssetClick ? "Click to view dataset details" : undefined}
        >
          <div className="flex items-center gap-2 mb-2 text-sm text-emerald-900 dark:text-emerald-100">
            <Icon className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">{action} CSV Dataset</span>
            {assetId && (
              <span className="text-xs text-emerald-700 dark:text-emerald-300">#{assetId}</span>
            )}
          </div>
          
          <div className="text-sm mb-2">
            <strong className="text-emerald-900 dark:text-emerald-100">{title}</strong>
          </div>
          
          <div className="flex flex-wrap gap-2 text-xs text-emerald-700 dark:text-emerald-300">
            <Badge variant="outline" className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200">
              {columnCount} columns
            </Badge>
            <Badge variant="outline" className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200">
              {rowCount} rows
            </Badge>
          </div>
          
          <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
            <span className="font-medium">Columns:</span> {columns.join(', ')}
          </div>
        </div>
      );
    }
    
    // CSV Row - show as table
    if (isCsvRow && result.row_data) {
      const columns = Object.keys(result.row_data);
      const values = Object.values(result.row_data);
      const parentId = result.parent_asset_id;
      
      return (
        <div 
          className={cn(
            "px-3 py-2 rounded-md border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
            assetId && onAssetClick && "cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-950/30 transition-colors"
          )}
          onClick={assetId && onAssetClick ? () => onAssetClick(assetId) : undefined}
          role={assetId && onAssetClick ? "button" : undefined}
          title={assetId && onAssetClick ? "Click to view row details" : undefined}
        >
          <div className="flex items-center gap-2 mb-2 text-sm text-blue-900 dark:text-blue-100">
            <Icon className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="font-medium">{action} CSV row</span>
            {assetId && (
              <span className="text-xs text-blue-700 dark:text-blue-300">#{assetId}</span>
            )}
            {parentId && onAssetClick && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAssetClick(parentId);
                }}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline ml-2"
                title="View parent dataset"
              >
                (parent #{parentId})
              </button>
            )}
          </div>
          
          <div className="overflow-x-auto">
            <table className="text-[10px] border-collapse w-full">
              <thead>
                <tr className="border-b border-blue-200 dark:border-blue-800">
                  {columns.map((col: string, idx: number) => (
                    <th key={idx} className="text-left py-1 px-2 font-medium text-muted-foreground">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {values.map((val: any, idx: number) => (
                    <td key={idx} className="py-1 px-2 max-w-[200px] truncate" title={String(val)}>
                      {val || '-'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    
    // Regular asset display - clickable
    const handleClick = assetId && onAssetClick && status !== 'deleted' 
      ? () => onAssetClick(assetId) 
      : undefined;
    
    return (
      <div 
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-md border text-sm bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100",
          handleClick && "cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-950/30 transition-colors"
        )}
        onClick={handleClick}
        role={handleClick ? "button" : undefined}
        title={handleClick ? "Click to view asset details" : undefined}
      >
        <Icon className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <span className="flex-1">
          {action} <strong>{title}</strong>
        </span>
        {assetId && (
          <span className="text-xs text-blue-700 dark:text-blue-300">#{assetId}</span>
        )}
        {kind && (
          <Badge variant="outline" className="text-xs">
            {kind}
          </Badge>
        )}
      </div>
    );
  },
};

/**
 * Ingest URLs Renderer - For content ingestion
 */
export const IngestRenderer: ToolResultRenderer = {
  toolName: 'ingest_urls',
  
  canHandle: (result: any) => {
    return result?.assets_created !== undefined || result?.urls_processed !== undefined;
  },
  
  getSummary: (result: any) => {
    const created = result.assets_created || 0;
    const failed = result.urls_failed || 0;
    
    if (failed > 0) {
      return `Ingested ${created}, ${failed} failed`;
    }
    return `Ingested ${created} URLs`;
  },
  
  render: ({ result, compact }: ToolResultRenderProps) => {
    const created = result.assets_created || 0;
    const processed = result.urls_processed || 0;
    const failed = result.urls_failed || 0;
    const hasFailures = failed > 0;
    
    if (compact) {
      return (
        <Badge 
          variant={hasFailures ? "outline" : "default"}
          className="text-xs h-6 gap-1.5"
        >
          <Plus className="h-3 w-3" />
          Ingested {created}
          {hasFailures && <span className="text-red-500">({failed} failed)</span>}
        </Badge>
      );
    }
    
    return (
      <div className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md border text-sm",
        hasFailures
          ? "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800"
          : "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
      )}>
        <Plus className={cn(
          "h-4 w-4 shrink-0",
          hasFailures ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400"
        )} />
        <span className="flex-1">
          Ingested <strong>{created} of {processed}</strong> URLs
        </span>
        {hasFailures && (
          <div className="flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-300">
            <AlertCircle className="h-3 w-3" />
            {failed} failed
          </div>
        )}
      </div>
    );
  },
};


