/**
 * TemporalAnchor
 * 
 * A minimal inline indicator for tool executions when the full result
 * is shown in a sidebar panel. Shows just the tool name and status.
 */

import React from 'react'
import { ToolExecution } from '@/hooks/useIntelligenceChat'
import { cn } from '@/lib/utils'
import { formatToolName, getStatusIcon } from './toolcalls/shared/utils'
import { Loader2 } from 'lucide-react'

interface TemporalAnchorProps {
  execution: ToolExecution
}

export function TemporalAnchor({ execution }: TemporalAnchorProps) {
  const isRunning = execution.status === 'running'
  const isFailed = execution.status === 'failed'

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs",
        "bg-muted/50 border border-border/50",
        isRunning && "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20",
        isFailed && "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20"
      )}
    >
      {getStatusIcon(execution.status, 'h-3 w-3')}
      <span className="font-medium">{formatToolName(execution.tool_name)}</span>
      {isRunning && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
      {execution.timestamp && (
        <span className="text-muted-foreground/70 text-[10px]">
          {execution.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  )
}

export default TemporalAnchor

