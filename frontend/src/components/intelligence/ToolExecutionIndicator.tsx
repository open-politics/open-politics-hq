'use client'

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Clock,
  Search, 
  FileText, 
  BarChart3, 
  Database,
  Bot,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { ToolExecution } from '@/hooks/useIntelligenceChat'
import { cn } from '@/lib/utils'
import { useState } from 'react'

interface ToolExecutionIndicatorProps {
  execution: ToolExecution
  compact?: boolean
}

const getToolIcon = (toolName: string) => {
  switch (toolName) {
    case 'search_assets': return <Search className="h-4 w-4" />
    case 'get_asset_details': return <FileText className="h-4 w-4" />
    case 'analyze_assets': return <BarChart3 className="h-4 w-4" />
    case 'list_schemas': 
    case 'list_bundles': return <Database className="h-4 w-4" />
    default: return <Bot className="h-4 w-4" />
  }
}

const getStatusIcon = (status: ToolExecution['status']) => {
  switch (status) {
    case 'pending': return <Clock className="h-4 w-4 text-muted-foreground" />
    case 'running': return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
    case 'completed': return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case 'failed': return <XCircle className="h-4 w-4 text-red-500" />
  }
}

const getStatusColor = (status: ToolExecution['status']) => {
  switch (status) {
    case 'pending': return 'bg-gray-100 text-gray-600 border-gray-200'
    case 'running': return 'bg-blue-50 text-blue-700 border-blue-200'
    case 'completed': return 'bg-green-50 text-green-700 border-green-200'
    case 'failed': return 'bg-red-50 text-red-700 border-red-200'
  }
}

const formatToolName = (toolName: string): string => {
  return toolName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function ToolExecutionIndicator({ execution, compact = false }: ToolExecutionIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  if (compact) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-md border bg-background/50">
        <div className="flex items-center gap-2 flex-1">
          {getToolIcon(execution.tool_name)}
          <span className="text-sm font-medium">{formatToolName(execution.tool_name)}</span>
          {getStatusIcon(execution.status)}
        </div>
        
        {execution.status === 'running' && (
          <div className="text-xs text-muted-foreground">Running...</div>
        )}
        
        {execution.status === 'completed' && execution.result != null && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-6 px-2"
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        )}
        
        {isExpanded && execution.result != null && (
          <div className="mt-2 text-xs bg-muted/50 rounded p-2 overflow-auto max-h-32">
            <pre className="whitespace-pre-wrap">
              {typeof execution.result === 'string' 
                ? execution.result 
                : JSON.stringify(execution.result, null, 2)
              }
            </pre>
          </div>
        )}
      </div>
    )
  }

  return (
    <Card className={cn("transition-all duration-200", getStatusColor(execution.status))}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <Badge variant="secondary" className="flex items-center gap-1 text-xs">
              {getToolIcon(execution.tool_name)}
              <span>{formatToolName(execution.tool_name)}</span>
            </Badge>
            
            <div className="flex items-center gap-2">
              {getStatusIcon(execution.status)}
              <span className="text-xs font-medium capitalize">{execution.status}</span>
            </div>
            
            <span className="text-xs text-muted-foreground ml-auto">
              {execution.timestamp.toLocaleTimeString()}
            </span>
          </div>
        </div>
        
        {/* Arguments */}
        {Object.keys(execution.arguments).length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Arguments
            </summary>
            <pre className="mt-1 text-xs bg-muted/50 rounded p-2 overflow-auto max-h-32">
              {JSON.stringify(execution.arguments, null, 2)}
            </pre>
          </details>
        )}
        
        {/* Results */}
        {execution.status === 'completed' && execution.result != null && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Result
            </summary>
            <div className="mt-1 text-xs bg-muted/50 rounded p-2 overflow-auto max-h-48">
              <pre className="whitespace-pre-wrap">
                {typeof execution.result === 'string' 
                  ? execution.result 
                  : JSON.stringify(execution.result, null, 2)
                }
              </pre>
            </div>
          </details>
        )}
        
        {/* Error */}
        {execution.status === 'failed' && execution.error && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            <strong>Error:</strong> {execution.error}
          </div>
        )}
        
        {/* Running indicator */}
        {execution.status === 'running' && (
          <div className="mt-2 flex items-center gap-2 text-xs text-blue-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Executing tool...</span>
          </div>
        )}
        
        {/* Pending indicator */}
        {execution.status === 'pending' && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Queued for execution</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface ToolExecutionListProps {
  executions: ToolExecution[]
  compact?: boolean
}

export function ToolExecutionList({ executions, compact = false }: ToolExecutionListProps) {
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
          />
        ))}
      </div>
    </div>
  )
}
