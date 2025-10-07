/**
 * Organize Renderer
 * 
 * Renders results from the organize() operator tool.
 * Handles all bundle operations (create, add, remove, rename, delete).
 */

import React from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps, OrganizeResult } from '../shared/types';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, Package, Plus, Trash2, Edit, FolderMinus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Get icon for operation
 */
function getOperationIcon(operation: string) {
  switch (operation) {
    case 'create':
      return <Plus className="h-5 w-5 text-green-600" />;
    case 'add':
      return <Package className="h-5 w-5 text-blue-600" />;
    case 'remove':
      return <FolderMinus className="h-5 w-5 text-orange-600" />;
    case 'rename':
      return <Edit className="h-5 w-5 text-purple-600" />;
    case 'delete':
      return <Trash2 className="h-5 w-5 text-red-600" />;
    default:
      return <Package className="h-5 w-5" />;
  }
}

/**
 * Get operation label
 */
function getOperationLabel(operation: string): string {
  const labels: Record<string, string> = {
    create: 'Bundle Created',
    add: 'Assets Added',
    remove: 'Assets Removed',
    rename: 'Bundle Renamed',
    delete: 'Bundle Deleted',
  };
  return labels[operation] || 'Operation Complete';
}

/**
 * Organize renderer implementation
 */
export const OrganizeRenderer: ToolResultRenderer = {
  toolName: 'organize',
  
  canHandle: (result: any) => {
    // Check if it's an organize result
    if (result?.operation && ['create', 'add', 'remove', 'rename', 'delete'].includes(result.operation)) {
      return true;
    }
    return false;
  },
  
  getSummary: (result: OrganizeResult) => {
    const op = result.operation;
    if (op === 'create') return `Created bundle: ${result.bundle_name}`;
    if (op === 'add') return `Added ${result.assets_added} assets`;
    if (op === 'remove') return `Removed ${result.assets_removed} assets`;
    if (op === 'rename') return `Renamed bundle: ${result.bundle_name}`;
    if (op === 'delete') return `Deleted bundle: ${result.bundle_name}`;
    return 'Operation complete';
  },
  
  render: ({ result, compact }: ToolResultRenderProps) => {
    const organizeResult = result as OrganizeResult;
    const isSuccess = organizeResult.status === 'success';
    const isPartial = organizeResult.status === 'partial_success';
    const isFailed = organizeResult.status === 'failed';
    
    // Compact view
    if (compact) {
      return (
        <div className="flex items-center gap-2 p-2">
          {getOperationIcon(organizeResult.operation)}
          <span className="text-sm font-medium flex-1">
            {getOperationLabel(organizeResult.operation)}
          </span>
          {isSuccess && <CheckCircle2 className="h-4 w-4 text-green-600" />}
          {isFailed && <AlertCircle className="h-4 w-4 text-red-600" />}
        </div>
      );
    }
    
    // Full view
    return (
      <div className="space-y-4">
        {/* Status Header */}
        <div
          className={cn(
            "flex items-center gap-3 p-4 rounded-lg border",
            isSuccess && "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
            isPartial && "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800",
            isFailed && "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
          )}
        >
          {getOperationIcon(organizeResult.operation)}
          <div className="flex-1">
            <h3 className="font-semibold text-lg">{getOperationLabel(organizeResult.operation)}</h3>
            {organizeResult.bundle_name && (
              <p className="text-sm text-muted-foreground mt-0.5">
                Bundle: {organizeResult.bundle_name}
              </p>
            )}
          </div>
          {isSuccess && <CheckCircle2 className="h-6 w-6 text-green-600" />}
          {isPartial && <AlertCircle className="h-6 w-6 text-yellow-600" />}
          {isFailed && <AlertCircle className="h-6 w-6 text-red-600" />}
        </div>
        
        {/* Details */}
        <div className="grid grid-cols-2 gap-4">
          {/* Bundle ID */}
          {organizeResult.bundle_id && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Bundle ID</p>
              <Badge variant="outline">{organizeResult.bundle_id}</Badge>
            </div>
          )}
          
          {/* Assets added */}
          {organizeResult.assets_added !== undefined && organizeResult.assets_added > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Assets Added</p>
              <Badge variant="secondary" className="text-green-700 dark:text-green-300">
                {organizeResult.assets_added}
              </Badge>
            </div>
          )}
          
          {/* Assets removed */}
          {organizeResult.assets_removed !== undefined && organizeResult.assets_removed > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Assets Removed</p>
              <Badge variant="secondary" className="text-orange-700 dark:text-orange-300">
                {organizeResult.assets_removed}
              </Badge>
            </div>
          )}
          
          {/* Failed count */}
          {organizeResult.assets_failed !== undefined && organizeResult.assets_failed > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Failed</p>
              <Badge variant="destructive">
                {organizeResult.assets_failed}
              </Badge>
            </div>
          )}
        </div>
        
        {/* Description (for create/rename) */}
        {organizeResult.bundle_description && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Description</p>
            <p className="text-sm">{organizeResult.bundle_description}</p>
          </div>
        )}
        
        {/* Error message */}
        {organizeResult.error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <p className="text-sm text-red-700 dark:text-red-300">{organizeResult.error}</p>
          </div>
        )}
      </div>
    );
  },
};

