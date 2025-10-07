'use client'

/**
 * Tool Execution Indicator
 * 
 * Smart wrapper component that displays tool execution results.
 * 
 * **Architecture:**
 * 1. First checks if a specialized renderer exists in the registry
 * 2. If yes → uses ToolResultDisplay (new system)
 * 3. If no → falls back to legacy StructuredToolResponse or JSON display
 * 
 * **Migration Path:**
 * As tools get migrated to the registry system (toolcalls/renderers/),
 * this component automatically uses the new renderers without code changes.
 * 
 * See toolcalls/README.md for the new architecture.
 */

import React, { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { 
  Loader2, 
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle
} from 'lucide-react'
import { ToolExecution } from '@/hooks/useIntelligenceChat'
import { cn } from '@/lib/utils'
import { toolResultRegistry, ToolResultDisplay } from './toolcalls'
import { getStatusIcon, getStatusColorClass, formatToolName } from './toolcalls/shared/utils'
import { StructuredToolResponse } from './StructuredToolResponse'

interface ToolExecutionIndicatorProps {
  execution: ToolExecution
  compact?: boolean
  onAssetClick?: (assetId: number) => void
  onBundleClick?: () => void
}

/**
 * Check if a renderer exists in the registry for this tool
 */
function hasRegisteredRenderer(toolName: string, result: any): boolean {
  return toolResultRegistry.getRenderer(toolName, result) !== null;
}

export function ToolExecutionIndicator({ execution, compact = false, onAssetClick, onBundleClick }: ToolExecutionIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(true) // Default to expanded
  
  // Get the result to display
  const resultToDisplay = execution.structured_content || execution.result;
  const hasResult = execution.status === 'completed' && resultToDisplay != null;
  
  // Check if we can use the new registry system
  const useRegistryRenderer = hasResult && hasRegisteredRenderer(execution.tool_name, resultToDisplay);

  if (compact) {
    return (
      <div className="rounded-md border bg-background/50 overflow-hidden">
        <div
          className={cn(
            "flex items-center gap-2 p-2",
            hasResult && "cursor-pointer hover:bg-accent/40 transition"
          )}
          onClick={hasResult ? () => setIsExpanded(!isExpanded) : undefined}
          role={hasResult ? "button" : undefined}
          tabIndex={hasResult ? 0 : undefined}
          aria-expanded={isExpanded}
        >
          <div className="flex items-center gap-2 flex-1">
            {getStatusIcon(execution.status, 'h-4 w-4')}
            <span className="text-sm font-medium">{formatToolName(execution.tool_name)}</span>
          </div>
          
          {execution.status === 'running' && (
            <div className="text-xs text-muted-foreground">Running...</div>
          )}
          
          {hasResult && (
            <span>
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </span>
          )}
        </div>
        
        {isExpanded && hasResult && (
          <div className="px-2 pb-2">
            {useRegistryRenderer ? (
              // Use new registry system
              <ToolResultDisplay
                toolName={execution.tool_name}
                result={resultToDisplay}
                compact={false}
                executionId={execution.id}
                onAssetClick={onAssetClick}
                onBundleClick={onBundleClick}
              />
            ) : (
              // Fallback to legacy or JSON
              <StructuredToolResponse 
                toolName={execution.tool_name} 
                result={resultToDisplay} 
                compact={false}
                onAssetClick={onAssetClick}
                onBundleClick={onBundleClick}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  // Helper to format arguments inline
  const formatArgumentsInline = (args: any): string => {
    const entries = Object.entries(args)
    if (entries.length === 0) return ''
    
    return entries
      .map(([key, value]) => {
        if (typeof value === 'string') {
          // Truncate long strings
          const truncated = value.length > 50 ? value.slice(0, 50) + '...' : value
          return `${key}: "${truncated}"`
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
          return `${key}: ${value}`
        }
        if (Array.isArray(value)) {
          return `${key}: [${value.length} items]`
        }
        return `${key}: {...}`
      })
      .join(', ')
  }

  return (
    <div className={cn("rounded border-l-2 bg-card transition-all duration-200", getStatusColorClass(execution.status))}>
      <div>
        <div
          className={cn(
            "p-1.5 w-full flex items-center gap-1.5 mb-0.5 text-left",
            hasResult && "cursor-pointer hover:opacity-80 transition"
          )}
          onClick={hasResult ? () => setIsExpanded(!isExpanded) : undefined}
          role={hasResult ? "button" : undefined}
          tabIndex={hasResult ? 0 : undefined}
          aria-expanded={isExpanded}
        >
          {getStatusIcon(execution.status, 'h-3 w-3 shrink-0')}
          <span className="text-xs font-medium truncate">{formatToolName(execution.tool_name)}</span>
          {execution.timestamp && (
            <span className="text-[9px] text-muted-foreground ml-auto shrink-0">
              {execution.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {hasResult && (
            <ChevronDown className={cn(
              "h-3 w-3 shrink-0 transition-transform",
              isExpanded && "rotate-180"
            )} />
          )}
        </div>
        
        {/* Arguments - inline, minimal */}
        {Object.keys(execution.arguments).length > 0 && (
          <div className="text-[9px] text-muted-foreground mb-1 truncate px-1.5">
            {formatArgumentsInline(execution.arguments)}
          </div>
        )}
        
        {/* Results - with max height constraint */}
        {hasResult && isExpanded && (
          <div className="mt-1 max-h-[350px] overflow-y-auto px-1.5">
            {useRegistryRenderer ? (
              // Use new registry system
              <ToolResultDisplay
                toolName={execution.tool_name}
                result={resultToDisplay}
                compact={compact}
                executionId={execution.id}
                onAssetClick={onAssetClick}
                onBundleClick={onBundleClick}
              />
            ) : (
              // Fallback to legacy or JSON
              <StructuredToolResponse 
                toolName={execution.tool_name} 
                result={resultToDisplay} 
                compact={compact}
                onAssetClick={onAssetClick}
                onBundleClick={onBundleClick}
              />
            )}
          </div>
        )}
        
        {/* Error */}
        {execution.status === 'failed' && execution.error && (
          <div className="mt-1 p-1.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded text-[10px] text-red-700 dark:text-red-400">
            <strong>Error:</strong> {execution.error}
          </div>
        )}
        
        {/* Running indicator */}
        {execution.status === 'running' && (
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-blue-600 dark:text-blue-400 px-1.5">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            <span>Executing...</span>
          </div>
        )}
        
        {/* Pending indicator */}
        {execution.status === 'pending' && (
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground px-1.5">
            <Clock className="h-2.5 w-2.5" />
            <span>Queued</span>
          </div>
        )}
      </div>
    </div>
  )
}

interface ToolExecutionListProps {
  executions: ToolExecution[]
  compact?: boolean
  onAssetClick?: (assetId: number) => void
  onBundleClick?: () => void
}

export function ToolExecutionList({ executions, compact = false, onAssetClick, onBundleClick }: ToolExecutionListProps) {
  if (executions.length === 0) return null
  
  const runningCount = executions.filter(e => e.status === 'running').length
  const completedCount = executions.filter(e => e.status === 'completed').length
  const failedCount = executions.filter(e => e.status === 'failed').length
  
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Tool Executions</span>
        {runningCount > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-xs">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            {runningCount} running
          </Badge>
        )}
        {completedCount > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-xs text-green-600">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {completedCount} completed
          </Badge>
        )}
        {failedCount > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-xs text-red-600">
            <XCircle className="h-3 w-3 mr-1" />
            {failedCount} failed
          </Badge>
        )}
      </div>
      
      <div className="space-y-2">
        {executions.map(execution => (
          <ToolExecutionIndicator 
            key={execution.id} 
            execution={execution} 
            compact={compact}
            onAssetClick={onAssetClick}
            onBundleClick={onBundleClick}
          />
        ))}
      </div>
    </div>
  )
}
