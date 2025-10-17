/**
 * Persistent Task Tracker - Sticky header version
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  Circle,
  Loader2,
  ListTodo,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatMessage } from '@/hooks/useIntelligenceChat';

interface Task {
  id: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  cancelled_at?: string;
}

interface PersistentTaskTrackerProps {
  messages: ChatMessage[];
}

/**
 * Extract tasks from messages by looking at tool execution results
 */
function extractTasksFromMessages(messages: ChatMessage[]): Task[] {
  const taskMap = new Map<number, Task>();

  // Process messages in order to build up task state
  messages.forEach(message => {
    if (message.role === 'assistant' && message.tool_executions) {
      message.tool_executions.forEach(exec => {
        const toolName = exec.tool_name;
        const result = exec.structured_content || exec.result;

        // Handle different task tool responses
        if (toolName === 'tasks' && result && typeof result === 'object' && 'tasks' in result) {
          // Full task list
          const tasks = (result as { tasks: Task[] }).tasks;
          tasks.forEach((task: Task) => {
            taskMap.set(task.id, task);
          });
        } else if (
          (toolName === 'add_task' || 
           toolName === 'start_task' || 
           toolName === 'finish_task' || 
           toolName === 'cancel_task') &&
          result && typeof result === 'object' && 'task' in result
        ) {
          // Single task operation
          const task = (result as { task: Task }).task;
          taskMap.set(task.id, task);
        }
      });
    }
  });

  // Return sorted by ID (creation order)
  return Array.from(taskMap.values()).sort((a, b) => a.id - b.id);
}

/**
 * Sticky Task Tracker for Chat Header
 */
export function PersistentTaskTracker({ messages }: PersistentTaskTrackerProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const tasks = extractTasksFromMessages(messages);

  // Group tasks by status
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const pending = tasks.filter(t => t.status === 'pending');
  const completed = tasks.filter(t => t.status === 'completed');

  const totalActive = inProgress.length + pending.length;
  const progressPercentage = tasks.length > 0 ? (completed.length / tasks.length) * 100 : 0;

  // Don't show if no tasks
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="sticky top-0 z-10 bg-background border-b">
      {/* Header - Always Visible */}
      <div className="px-4 py-2 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 h-7 px-2"
        >
          <ListTodo className="h-4 w-4" />
          <span className="text-sm font-medium">Tasks</span>
          {totalActive > 0 ? (
            <Badge variant="default" className="h-5 px-1.5 text-xs">
              {totalActive}
            </Badge>
          ) : (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {tasks.length}
            </Badge>
          )}
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </Button>

        {/* Progress bar */}
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all duration-300",
                progressPercentage === 100 ? "bg-green-500" : "bg-blue-500"
              )}
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
            {completed.length}/{tasks.length}
          </span>
        </div>
      </div>

      {/* Expandable Task List */}
      {isExpanded && (
        <div className="px-4 pb-3 pt-1 space-y-2 max-h-64 overflow-y-auto">
          {/* In Progress */}
          {inProgress.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                In Progress
              </div>
              {inProgress.map(task => (
                <div key={task.id} className="flex items-start gap-2 text-xs pl-5">
                  <Loader2 className="h-3 w-3 mt-0.5 animate-spin shrink-0 text-blue-500" />
                  <span className="flex-1">{task.description}</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">
                    #{task.id}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {/* Pending */}
          {pending.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Circle className="h-3 w-3" />
                Pending
              </div>
              {pending.map(task => (
                <div key={task.id} className="flex items-start gap-2 text-xs pl-5">
                  <Circle className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1">{task.description}</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">
                    #{task.id}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {/* Completed (last 3) */}
          {completed.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3" />
                Completed ({completed.length})
              </div>
              {completed.slice(-3).reverse().map(task => (
                <div key={task.id} className="flex items-start gap-2 text-xs pl-5 opacity-60">
                  <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0 text-green-600" />
                  <span className="flex-1 line-through">{task.description}</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">
                    #{task.id}
                  </Badge>
                </div>
              ))}
              {completed.length > 3 && (
                <div className="text-[10px] text-muted-foreground pl-5">
                  ... and {completed.length - 3} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
