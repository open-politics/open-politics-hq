/**
 * MessageToolPanel
 * 
 * Displays tool executions in a collapsible sidebar panel.
 * Used alongside assistant messages to show tool results without cluttering the main message.
 */

import React, { useState, useMemo, useEffect } from 'react'
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
  /** Auto-expand the most recent completed tool. True while the message is still
   *  streaming (keep the latest result visible); false once it ends so every
   *  card collapses. */
  autoExpandLast?: boolean
}

export function MessageToolPanel({
  toolExecutions,
  onAssetClick,
  onBundleClick,
  defaultOpen = true,
  autoExpandLast = true
}: MessageToolPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultOpen)

  // Track defaultOpen so the panel opens while its turn streams and folds back to
  // a single line once it ends (a manual toggle mid-stream is preserved — the flag
  // only changes at the true→false streaming edge). Mirrors ToolExecutionIndicator.
  useEffect(() => { setIsExpanded(defaultOpen) }, [defaultOpen])

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

  // Find the last completed execution (most recent one with results)
  const lastCompletedIndex = useMemo(() => {
    return toolExecutions.reduce((lastIdx, exec, currentIdx) => {
      if (exec.status === 'completed' && (exec.structured_content || exec.result)) {
        return currentIdx
      }
      return lastIdx
    }, -1)
  }, [toolExecutions])

  if (toolExecutions.length === 0) return null

  return (
    <div className="rounded-md border border-border/50 overflow-hidden">
      {/* Header — kept deliberately slim so the tool cards, not the chrome, own
          the panel's vertical space. */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="text-muted-foreground">
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </div>
        <Wrench className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium flex-1 text-left">
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
        <div className="p-1.5 space-y-1 max-h-[60vh] overflow-y-auto">
          {toolExecutions.map((execution, index) => (
            <ToolExecutionIndicator
              key={execution.id}
              execution={execution}
              compact
              onAssetClick={onAssetClick}
              onBundleClick={onBundleClick}
              defaultExpanded={autoExpandLast && index === lastCompletedIndex}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default MessageToolPanel

