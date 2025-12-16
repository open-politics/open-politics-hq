/**
 * MessageTaskPanel
 * 
 * Displays task-related tool executions in a collapsible sidebar panel.
 * Filters for task-related tools and shows them with task-specific formatting.
 */

import React, { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, CheckSquare, ListTodo } from 'lucide-react'
import { ToolExecution } from '@/hooks/useIntelligenceChat'
import { cn } from '@/lib/utils'
import { ToolExecutionIndicator } from './ToolExecutionIndicator'

interface MessageTaskPanelProps {
  toolExecutions: ToolExecution[]
  defaultOpen?: boolean
}

const TASK_TOOL_NAMES = ['tasks', 'add_task', 'start_task', 'finish_task', 'cancel_task']

export function MessageTaskPanel({
  toolExecutions,
  defaultOpen = false
}: MessageTaskPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultOpen)

  // Filter for task-related tools only
  const taskExecutions = useMemo(() => {
    return toolExecutions.filter(exec => TASK_TOOL_NAMES.includes(exec.tool_name))
  }, [toolExecutions])

  // Extract task summary from results
  const taskSummary = useMemo(() => {
    let totalTasks = 0
    let completedTasks = 0

    taskExecutions.forEach(exec => {
      const result = exec.structured_content || exec.result
      if (result && typeof result === 'object') {
        if ('tasks' in result && Array.isArray(result.tasks)) {
          totalTasks += result.tasks.length
          completedTasks += result.tasks.filter((t: any) => t.status === 'completed').length
        } else if ('task' in result) {
          totalTasks += 1
          if ((result.task as any)?.status === 'completed') completedTasks += 1
        }
      }
    })

    return { totalTasks, completedTasks }
  }, [taskExecutions])

  if (taskExecutions.length === 0) return null

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden border-amber-200 dark:border-amber-800">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
      >
        <div className="text-amber-600 dark:text-amber-400">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <CheckSquare className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium flex-1 text-left text-amber-900 dark:text-amber-100">
          Tasks
        </span>
        
        {/* Task count */}
        {taskSummary.totalTasks > 0 && (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {taskSummary.completedTasks}/{taskSummary.totalTasks}
          </span>
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-2 space-y-2 max-h-[40vh] overflow-y-auto">
          {taskExecutions.map(execution => (
            <ToolExecutionIndicator
              key={execution.id}
              execution={execution}
              compact={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default MessageTaskPanel

