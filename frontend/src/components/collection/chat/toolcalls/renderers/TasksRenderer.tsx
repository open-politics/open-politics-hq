/**
 * Tasks Renderer
 * ==============
 * 
 * Visual display for task management in conversations.
 * Shows in-progress, pending, and completed tasks with status indicators.
 */

import React, { useState } from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps } from '../shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle2,
  Circle,
  XCircle,
  ChevronDown,
  ChevronRight,
  ListTodo,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Task {
  id: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  cancelled_at?: string;
}

interface TasksResult {
  tasks?: Task[];
  task?: Task;
  counts?: {
    in_progress: number;
    pending: number;
    completed: number;
  };
  progress?: {
    completed: number;
    remaining: number;
  };
  paused?: number[];
  summary?: string;
}

/**
 * Get icon and color for task status
 */
function getStatusDisplay(status: Task['status']) {
  switch (status) {
    case 'in_progress':
      return {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        color: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-50 dark:bg-blue-950/20',
        border: 'border-blue-200 dark:border-blue-800',
        label: 'In Progress'
      };
    case 'pending':
      return {
        icon: <Circle className="h-3.5 w-3.5" />,
        color: 'text-gray-500 dark:text-gray-400',
        bg: 'bg-gray-50 dark:bg-gray-950/20',
        border: 'border-gray-200 dark:border-gray-800',
        label: 'Pending'
      };
    case 'completed':
      return {
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        color: 'text-green-600 dark:text-green-400',
        bg: 'bg-green-50 dark:bg-green-950/20',
        border: 'border-green-200 dark:border-green-800',
        label: 'Completed'
      };
    case 'cancelled':
      return {
        icon: <XCircle className="h-3.5 w-3.5" />,
        color: 'text-red-500 dark:text-red-400',
        bg: 'bg-red-50 dark:bg-red-950/20',
        border: 'border-red-200 dark:border-red-800',
        label: 'Cancelled'
      };
  }
}

/**
 * Render a single task item
 */
function TaskItem({ task }: { task: Task }) {
  const statusDisplay = getStatusDisplay(task.status);
  
  return (
    <div
      className={cn(
        "flex items-start gap-2 px-2.5 py-2 rounded-md border transition-all",
        statusDisplay.bg,
        statusDisplay.border
      )}
    >
      <div className={cn("shrink-0 mt-0.5", statusDisplay.color)}>
        {statusDisplay.icon}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className={cn(
          "text-sm font-medium",
          task.status === 'completed' && "line-through opacity-70"
        )}>
          {task.description}
        </div>
        
        {/* Task metadata */}
        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
          <span>#{task.id}</span>
          {task.started_at && task.status === 'in_progress' && (
            <>
              <span>•</span>
              <span>Started {new Date(task.started_at).toLocaleTimeString()}</span>
            </>
          )}
          {task.completed_at && task.status === 'completed' && (
            <>
              <span>•</span>
              <span>Done {new Date(task.completed_at).toLocaleTimeString()}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Render compact progress bar
 */
function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div 
          className="h-full bg-green-500 dark:bg-green-400 transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {completed}/{total}
      </span>
    </div>
  );
}

/**
 * Tasks Display Component - extracted to support React hooks
 */
function TasksDisplay({ result, compact }: ToolResultRenderProps) {
  const typedResult = result as TasksResult;
  const [isExpanded, setIsExpanded] = useState(true);
    
    // Single task operation (add/start/finish/cancel)
    if (typedResult.task && !typedResult.tasks) {
      const statusDisplay = getStatusDisplay(typedResult.task.status);
      
      return (
        <div className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-md border text-sm",
          statusDisplay.bg,
          statusDisplay.border
        )}>
          <div className={statusDisplay.color}>
            {statusDisplay.icon}
          </div>
          <span className="flex-1">
            <strong>{statusDisplay.label}:</strong> {typedResult.task.description}
          </span>
          <Badge variant="outline" className="text-xs">
            #{typedResult.task.id}
          </Badge>
        </div>
      );
    }
    
    // No tasks
    if (!typedResult.tasks || typedResult.tasks.length === 0) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30 text-sm text-muted-foreground">
          <ListTodo className="h-4 w-4" />
          No active tasks
        </div>
      );
    }
    
    // Group tasks by status
    const inProgress = typedResult.tasks.filter(t => t.status === 'in_progress');
    const pending = typedResult.tasks.filter(t => t.status === 'pending');
    const completed = typedResult.tasks.filter(t => t.status === 'completed');
    const cancelled = typedResult.tasks.filter(t => t.status === 'cancelled');
    
    const total = typedResult.tasks.length;
    const completedCount = completed.length;
    
    // Compact view - just status bar
    if (compact) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30">
          <ListTodo className="h-4 w-4 text-purple-500" />
          <ProgressBar completed={completedCount} total={total} />
          <Badge variant="outline" className="text-xs">
            {inProgress.length} active
          </Badge>
        </div>
      );
    }
    
    // Full collapsible view
    return (
      <div className="space-y-2">
        {/* Header with collapse toggle */}
        <div 
          className="flex items-center gap-2 cursor-pointer group"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
          
          <ListTodo className="h-4 w-4 text-purple-500 shrink-0" />
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Task List</span>
              <Badge variant="secondary" className="text-xs">
                {typedResult.tasks.length} total
              </Badge>
            </div>
            
            {!isExpanded && (
              <div className="mt-1">
                <ProgressBar completed={completedCount} total={total} />
              </div>
            )}
          </div>
          
          {/* Quick status indicators when collapsed */}
          {!isExpanded && (
            <div className="flex items-center gap-1 shrink-0">
              {inProgress.length > 0 && (
                <Badge variant="outline" className="text-xs h-5 gap-1 bg-blue-50 dark:bg-blue-950/20">
                  <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-600" />
                  {inProgress.length}
                </Badge>
              )}
              {pending.length > 0 && (
                <Badge variant="outline" className="text-xs h-5">
                  {pending.length} pending
                </Badge>
              )}
            </div>
          )}
        </div>
        
        {/* Expanded task list */}
        {isExpanded && (
          <div className="space-y-3 pl-8">
            {/* Progress bar */}
            <div className="pr-2">
              <ProgressBar completed={completedCount} total={total} />
            </div>
            
            {/* In Progress section */}
            {inProgress.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  In Progress ({inProgress.length})
                </div>
                {inProgress.map(task => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </div>
            )}
            
            {/* Pending section */}
            {pending.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Circle className="h-3 w-3" />
                  Pending ({pending.length})
                </div>
                {pending.slice(0, 5).map(task => (
                  <TaskItem key={task.id} task={task} />
                ))}
                {pending.length > 5 && (
                  <div className="text-xs text-muted-foreground pl-2">
                    ... and {pending.length - 5} more
                  </div>
                )}
              </div>
            )}
            
            {/* Completed section (show last 3) */}
            {completed.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-medium text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Completed ({completed.length})
                </div>
                {completed.slice(-3).reverse().map(task => (
                  <TaskItem key={task.id} task={task} />
                ))}
                {completed.length > 3 && (
                  <div className="text-xs text-muted-foreground pl-2">
                    ... and {completed.length - 3} more earlier
                  </div>
                )}
              </div>
            )}
            
            {/* Celebration on completion */}
            {completedCount === total && total > 0 && (
              <div className="px-3 py-2 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-300 text-center font-medium">
                🎉 All tasks completed!
              </div>
            )}
          </div>
        )}
      </div>
    );
}

/**
 * Main Tasks Renderer Configuration
 */
export const TasksRenderer: ToolResultRenderer = {
  toolName: 'tasks',
  
  canHandle: (result: any) => {
    return result?.tasks !== undefined || result?.task !== undefined;
  },
  
  getSummary: (result: any) => {
    const typedResult = result as TasksResult;
    
    if (typedResult.task) {
      return `Task #${typedResult.task.id}: ${typedResult.task.status}`;
    }
    
    if (typedResult.counts) {
      const { in_progress, pending, completed } = typedResult.counts;
      return `${in_progress} active, ${pending} pending, ${completed} done`;
    }
    
    return 'Tasks';
  },
  
  render: (props: ToolResultRenderProps) => {
    return <TasksDisplay {...props} />;
  },
};

