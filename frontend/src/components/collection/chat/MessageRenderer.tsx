'use client'

/**
 * Enhanced Message Renderer with Timeline Flow
 * 
 * Displays assistant messages with proper temporal ordering:
 * 1. Reasoning trace (if present at start)
 * 2. Tool executions (with inline results)
 * 3. Final response content
 * 4. Summary of tools used
 * 
 * This provides a clearer narrative flow: thought → action → result
 */

import React, { useMemo } from 'react'
import { ToolExecution } from '@/hooks/useIntelligenceChat'
import { ToolExecutionIndicator } from './ToolExecutionIndicator'
import { MemoizedMarkdown } from '@/components/ui/memoized-markdown'
import { Badge } from '@/components/ui/badge'
import { Wrench, Brain, MessageSquare, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AssistantMessageRendererProps {
  content: string
  messageId: string
  toolExecutions?: ToolExecution[]
  thinkingTrace?: string
  onAssetClick?: (assetId: number) => void
  onBundleClick?: () => void
}

interface MessageSection {
  type: 'thinking' | 'tool' | 'content'
  content: string
  toolExecution?: ToolExecution
  order: number
  thinkingPosition?: 'initial' | 'before-tool' | 'after-tool'  // Where this thinking occurred
  relatedToolId?: string  // For thinking sections related to specific tools
}

/**
 * Parse message content to extract sections and their order
 * Supports both:
 * - Legacy: Single thinking trace at start
 * - Segmented: Thinking traces interleaved with tool executions
 */
function parseMessageSections(
  content: string,
  toolExecutions: ToolExecution[] = [],
  thinkingTrace?: string
): MessageSection[] {
  const sections: MessageSection[] = []
  let order = 0

  // Check if we have segmented thinking (tool executions with thinking_before/after)
  const hasSegmentedThinking = toolExecutions.some(
    exec => exec.thinking_before || exec.thinking_after
  )

  // Parse content for tool result markers to understand execution order
  const markerRegex = /<tool_results\s+(?:id=["']([^"']+)["']\s+)?tool=["']([^"']+)["']\s*\/>/g
  const markerCountByTool: Record<string, number> = {}
  const toolOrder: Array<{ toolName: string; index: number; position: number }> = []
  
  let match
  while ((match = markerRegex.exec(content)) !== null) {
    const toolName = match[2]
    if (!(toolName in markerCountByTool)) {
      markerCountByTool[toolName] = 0
    }
    toolOrder.push({
      toolName,
      index: markerCountByTool[toolName]++,
      position: match.index
    })
  }

  // Build ordered list of tool executions
  const orderedExecutions: ToolExecution[] = []
  toolOrder.forEach(({ toolName, index }) => {
    const matchingExecutions = toolExecutions.filter(exec => exec.tool_name === toolName)
    const execution = matchingExecutions[index]
    if (execution) {
      orderedExecutions.push(execution)
    }
  })

  if (hasSegmentedThinking) {
    // SEGMENTED MODE: Interleave thinking with tool executions
    // CRITICAL: Use toolExecutions array directly (not orderedExecutions from markers)
    // This ensures all tools show during streaming, even before markers appear in content
    const executionsToShow = toolExecutions.length > 0 ? toolExecutions : orderedExecutions
    
    executionsToShow.forEach((execution, idx) => {
      // Add thinking before this tool (if present)
      if (execution.thinking_before) {
        sections.push({
          type: 'thinking',
          content: execution.thinking_before,
          order: order++,
          thinkingPosition: idx === 0 ? 'initial' : 'before-tool',
          relatedToolId: execution.id
        })
      }

      // Add the tool execution
      sections.push({
        type: 'tool',
        content: '',
        toolExecution: execution,
        order: order++
      })

      // Add thinking after this tool (if present)
      if (execution.thinking_after) {
        sections.push({
          type: 'thinking',
          content: execution.thinking_after,
          order: order++,
          thinkingPosition: 'after-tool',
          relatedToolId: execution.id
        })
      }
    })
  } else {
    // LEGACY MODE: Single thinking at start, then all tools
    
    // 1. Add initial thinking if present
    if (thinkingTrace) {
      sections.push({
        type: 'thinking',
        content: thinkingTrace,
        order: order++,
        thinkingPosition: 'initial'
      })
    }

    // 2. Add tool executions in order
    orderedExecutions.forEach(execution => {
      sections.push({
        type: 'tool',
        content: '',
        toolExecution: execution,
        order: order++
      })
    })
  }

  // 3. Add final content (with markers stripped for clean display)
  const cleanContent = content.replace(markerRegex, '').trim()
  if (cleanContent) {
    sections.push({
      type: 'content',
      content: cleanContent,
      order: order++
    })
  }

  return sections
}

export function AssistantMessageRenderer({
  content,
  messageId,
  toolExecutions = [],
  thinkingTrace,
  onAssetClick,
  onBundleClick
}: AssistantMessageRendererProps) {
  const sections = useMemo(
    () => parseMessageSections(content, toolExecutions, thinkingTrace),
    [content, toolExecutions, thinkingTrace]
  )

  // Get unique tool names for summary
  const uniqueToolNames = useMemo(() => {
    const names: string[] = []
    toolExecutions.forEach(exec => {
      if (!names.includes(exec.tool_name)) {
        names.push(exec.tool_name)
      }
    })
    return names
  }, [toolExecutions])

  const hasTools = toolExecutions.length > 0
  const hasThinking = !!thinkingTrace

  // Check if any tool is currently running
  const hasRunningTool = toolExecutions.some(exec => exec.status === 'running')

  return (
    <div className="space-y-3">
      {/* Minimal Summary - Just show tools used */}
      {hasTools && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Wrench className="h-3 w-3" />
          <span>{toolExecutions.length} tool{toolExecutions.length !== 1 ? 's' : ''}:</span>
          <div className="flex flex-wrap gap-1">
            {uniqueToolNames.map((toolName) => (
              <span key={toolName} className="text-foreground/70">
                {toolName}
              </span>
            )).reduce((acc, curr, idx) => {
              if (idx === 0) return [curr]
              return [...acc, <span key={`sep-${idx}`} className="text-muted-foreground">, </span>, curr]
            }, [] as React.ReactNode[])}
          </div>
        </div>
      )}

      {/* Timeline Flow - Minimal and Clean */}
      <div className="space-y-2">
        {sections.map((section, index) => {
          switch (section.type) {
            case 'thinking': {
              // Generate label based on thinking position
              let thinkingLabel = 'Reasoning'
              let thinkingSubtext = ''
              let isRelatedToolRunning = false
              
              if (section.thinkingPosition === 'before-tool' && section.relatedToolId) {
                const relatedTool = toolExecutions.find(exec => exec.id === section.relatedToolId)
                if (relatedTool) {
                  thinkingLabel = 'Planning'
                  thinkingSubtext = relatedTool.tool_name
                  isRelatedToolRunning = relatedTool.status === 'running'
                }
              } else if (section.thinkingPosition === 'after-tool' && section.relatedToolId) {
                const relatedTool = toolExecutions.find(exec => exec.id === section.relatedToolId)
                if (relatedTool) {
                  thinkingLabel = 'Analyzing'
                  thinkingSubtext = `results from ${relatedTool.tool_name}`
                  isRelatedToolRunning = relatedTool.status === 'running'
                }
              }
              
              // Auto-open if related tool is running, auto-close when done
              const shouldBeOpen = isRelatedToolRunning || (section.thinkingPosition === 'initial' && hasRunningTool)
              
              return (
                <details key={`thinking-${index}`} className="group" open={shouldBeOpen}>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 py-1">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90 shrink-0" />
                    <Brain className="h-3 w-3 shrink-0" />
                    <span className="font-medium">{thinkingLabel}</span>
                    {thinkingSubtext && (
                      <span className="text-[10px]">· {thinkingSubtext}</span>
                    )}
                    <span className="text-[10px]">({section.content.length} chars)</span>
                  </summary>
                  <div className="ml-7 mt-1 p-2 bg-muted/30 rounded text-[11px] leading-relaxed max-h-[300px] overflow-y-auto">
                    <pre className="whitespace-pre-wrap font-mono">
                      {section.content}
                    </pre>
                  </div>
                </details>
              )
            }

            case 'tool':
              if (!section.toolExecution) return null
              
              const isOperatorTool = ['navigate', 'organize', 'semantic_search', 'search_web'].includes(
                section.toolExecution.tool_name
              )
              
              return (
                <div key={`tool-${section.toolExecution.id}`} className="my-2">
                  <ToolExecutionIndicator
                    execution={section.toolExecution}
                    compact={!isOperatorTool}
                    onAssetClick={onAssetClick}
                    onBundleClick={onBundleClick}
                  />
                </div>
              )

            case 'content':
              return (
                <div key={`content-${index}`} className="prose prose-sm dark:prose-invert max-w-none">
                  <MemoizedMarkdown 
                    content={section.content}
                    id={`${messageId}-content`}
                  />
                </div>
              )

            default:
              return null
          }
        })}
      </div>

      {/* Show unreferenced tool executions if any */}
      {toolExecutions.length > 0 && sections.filter(s => s.type === 'tool').length === 0 && (
        <details className="mt-4 pt-4 border-t border-border/50">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
            Tool Executions ({toolExecutions.length})
          </summary>
          <div className="mt-3 space-y-2">
            {toolExecutions.map(execution => (
              <ToolExecutionIndicator
                key={execution.id}
                execution={execution}
                compact={true}
                onAssetClick={onAssetClick}
                onBundleClick={onBundleClick}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
