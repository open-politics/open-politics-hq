/**
 * MessageToolPanel
 * 
 * Displays tool executions in a collapsible sidebar panel.
 * Used alongside assistant messages to show tool results without cluttering the main message.
 */

import React, { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { ToolExecution } from '@/hooks/useIntelligenceChat'
import { cn } from '@/lib/utils'
import { ToolExecutionIndicator } from './ToolExecutionIndicator'
import { formatToolName, getStatusIcon } from './toolcalls/shared/utils'

interface MessageToolPanelProps {
  toolExecutions: ToolExecution[]
  onAssetClick?: (assetId: number) => void
  onBundleClick?: (bundleId: number) => void
  defaultOpen?: boolean
  
}

export function MessageToolPanel({
  toolExecutions,
  onAssetClick,
  onBundleClick,
  defaultOpen = true
}: MessageToolPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultOpen)

  // Group tools by status
  const { completedTools, runningTools, failedTools } = useMemo(() => {
    const completed: ToolExecution[] = []
    const running: ToolExecution[] = []
    const failed: ToolExecution[] = []

    toolExecutions.forEach(exec => {
      if (exec.status === 'completed') completed.push(exec)
      else if (exec.status === 'running') running.push(exec)
      else if (exec.status === 'failed') failed.push(exec)
    })

    return { completedTools: completed, runningTools: running, failedTools: failed }
  }, [toolExecutions])

  if (toolExecutions.length === 0) return null

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="text-muted-foreground">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <Wrench className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium flex-1 text-left">
          Tools ({toolExecutions.length})
        </span>
        
        {/* Status indicators */}
        <div className="flex items-center gap-1.5">
          {runningTools.length > 0 && (
            <span className="text-xs text-blue-600 dark:text-blue-400">
              {runningTools.length} running
            </span>
          )}
          {failedTools.length > 0 && (
            <span className="text-xs text-red-600 dark:text-red-400">
              {failedTools.length} failed
            </span>
          )}
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
          {toolExecutions.map(execution => (
            <ToolExecutionIndicator
              key={execution.id}
              execution={execution}
              compact={false}
              onAssetClick={onAssetClick}
              onBundleClick={onBundleClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default MessageToolPanel

