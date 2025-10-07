/**
 * Generic Renderer
 * 
 * Fallback renderer for tool results that don't have a specific renderer.
 * Displays JSON in a readable format.
 */

import React from 'react';
import { ToolResultRenderProps } from '../shared/types';
import { AlertCircle } from 'lucide-react';

export function GenericRenderer({ result, compact }: ToolResultRenderProps) {
  // Handle error results
  if (result?.error) {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-900 dark:text-red-100">Error</p>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">{result.error}</p>
          </div>
        </div>
      </div>
    );
  }
  
  // Handle message-only results
  if (result?.message && Object.keys(result).length <= 2) {
    return (
      <div className="p-3 bg-muted/50 rounded-md">
        <p className="text-sm">{result.message}</p>
      </div>
    );
  }
  
  // Fallback: show JSON
  return (
    <div className={compact ? "text-xs" : "text-sm"}>
      <div className="bg-muted/50 rounded-md p-3 overflow-auto max-h-96">
        <pre className="whitespace-pre-wrap break-words font-mono">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    </div>
  );
}

