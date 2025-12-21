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
import { TemporalAnchor } from './TemporalAnchor'
import { Response } from '@/components/ai-elements/response'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Badge } from '@/components/ui/badge'
import { Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'


interface AssistantMessageRendererProps {
  content: string
  messageId: string
  toolExecutions?: ToolExecution[]
  thinkingTrace?: string
  onAssetClick?: (assetId: number) => void
  onBundleClick?: (bundleId: number) => void
  hideTaskTools?: boolean  // When true, skip rendering task tools inline (used when side panel shows them)
  collapseToolsOnDesktop?: boolean  // Hide tool cards on desktop (shown in sidebar)
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
  
  // Normalize null to empty array (default param only handles undefined)
  const normalizedExecutions = toolExecutions || []

  // Check if we have segmented thinking (tool executions with thinking_before/after)
  const hasSegmentedThinking = normalizedExecutions.some(
    exec => exec.thinking_before || exec.thinking_after
  )

  // Remove closing tags first (they're just noise for parsing)
  const contentWithoutClosingTags = content.replace(/<\/tool_results>/g, '')

  // Parse content for tool result markers to understand execution order
  // Matches three formats: self-closing (/>), opening (>), and legacy with id
  const markerRegex = /<tool_results\s+(?:id=["']([^"']+)["']\s+)?tool=["']([^"']+)["']\s*\/?>/g
  const markerCountByTool: Record<string, number> = {}
  const toolOrder: Array<{ toolName: string; index: number; position: number }> = []
  
  let match
  while ((match = markerRegex.exec(contentWithoutClosingTags)) !== null) {
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
    const matchingExecutions = normalizedExecutions.filter(exec => exec.tool_name === toolName)
    const execution = matchingExecutions[index]
    if (execution) {
      orderedExecutions.push(execution)
    }
  })

  if (hasSegmentedThinking) {
    // SEGMENTED MODE: Interleave thinking with tool executions
    // CRITICAL: Use normalizedExecutions array directly (not orderedExecutions from markers)
    // This ensures all tools show during streaming, even before markers appear in content
    const executionsToShow = normalizedExecutions.length > 0 ? normalizedExecutions : orderedExecutions
    
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
    // FIXED: If orderedExecutions is empty but we have tool executions,
    // use the normalized executions directly (backend may not include markers)
    const executionsToUse = orderedExecutions.length > 0 
      ? orderedExecutions 
      : normalizedExecutions
    
    executionsToUse.forEach(execution => {
      sections.push({
        type: 'tool',
        content: '',
        toolExecution: execution,
        order: order++
      })
    })
  }

  // 3. Add final content (with markers stripped for clean display)
  const cleanContent = contentWithoutClosingTags.replace(markerRegex, '').trim()
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
  onBundleClick,
  hideTaskTools = false,
  collapseToolsOnDesktop = false
}: AssistantMessageRendererProps) {
  // Normalize null to empty array (default param only handles undefined)
  const normalizedToolExecutions = toolExecutions || []
  
  const sections = useMemo(
    () => parseMessageSections(content, normalizedToolExecutions, thinkingTrace),
    [content, normalizedToolExecutions, thinkingTrace]
  )

  // Get unique tool names for summary (excluding hidden tools)
  const uniqueToolNames = useMemo(() => {
    const names: string[] = []
    normalizedToolExecutions.forEach(exec => {
      // Skip task tools if hidden
      if (hideTaskTools && exec.tool_name === 'tasks') return
      
      if (!names.includes(exec.tool_name)) {
        names.push(exec.tool_name)
      }
    })
    return names
  }, [normalizedToolExecutions, hideTaskTools])

  const hasTools = normalizedToolExecutions.length > 0
  const hasThinking = !!thinkingTrace

  // Check if any tool is currently running
  const hasRunningTool = normalizedToolExecutions.some(exec => exec.status === 'running')

  // Find the last completed tool execution for default expansion
  const lastCompletedToolId = useMemo(() => {
    let lastId: string | null = null
    normalizedToolExecutions.forEach(exec => {
      if (exec.status === 'completed' && (exec.structured_content || exec.result)) {
        lastId = exec.id
      }
    })
    return lastId
  }, [normalizedToolExecutions])

  return (
    <div className="space-y-3 min-w-0 w-full overflow-hidden">
      {/* Minimal Summary - Just show tools used */}
      {hasTools && (
        <div className={cn(
          "flex items-center gap-2 text-[11px] text-muted-foreground",
          collapseToolsOnDesktop && "@xl:hidden"
        )}>
          <Wrench className="h-3 w-3" />
          <span>{normalizedToolExecutions.length} tool{normalizedToolExecutions.length !== 1 ? 's' : ''}:</span>
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
      <div className="space-y-2 min-w-0 overflow-hidden">
        {sections.map((section, index) => {
          switch (section.type) {
            case 'thinking': {
              // Determine if this reasoning section is currently streaming
              let isRelatedToolRunning = false
              
              if (section.thinkingPosition === 'before-tool' && section.relatedToolId) {
                const relatedTool = normalizedToolExecutions.find(exec => exec.id === section.relatedToolId)
                if (relatedTool) {
                  isRelatedToolRunning = relatedTool.status === 'running'
                }
              } else if (section.thinkingPosition === 'after-tool' && section.relatedToolId) {
                const relatedTool = normalizedToolExecutions.find(exec => exec.id === section.relatedToolId)
                if (relatedTool) {
                  isRelatedToolRunning = relatedTool.status === 'running'
                }
              }
              
              // Auto-open if related tool is running, auto-close when done
              const isStreaming = isRelatedToolRunning || (section.thinkingPosition === 'initial' && hasRunningTool)
              
              return (
                <Reasoning 
                  key={`thinking-${index}`} 
                  className="w-full" 
                  isStreaming={isStreaming}
                >
                  <ReasoningTrigger />
                  <ReasoningContent>
                    {section.content}
                  </ReasoningContent>
                </Reasoning>
              )
            }

            case 'tool':
              if (!section.toolExecution) return null
              
              // Task tools are handled by PersistentTaskTracker and MessageTaskPanel
              const isTaskTool = ['tasks', 'add_task', 'start_task', 'finish_task', 'cancel_task'].includes(
                section.toolExecution.tool_name
              )
              
              const isOperatorTool = [
                'navigate',
                'organize',
                'semantic_search',
                'workspace_hub',
                'web_research',
                'library_hub',
                'analysis_hub',
                'search_web', // legacy
              ].includes(
                section.toolExecution.tool_name
              )
              
              // For task tools on desktop: show minimal indicator only, no expanded content
              if (isTaskTool && hideTaskTools) {
                return (
                  <div key={`tool-${section.toolExecution.id}`} className="my-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 px-1">
                      <span className="font-medium">{section.toolExecution.tool_name}</span>
                      {section.toolExecution.status === 'running' && (
                        <span className="text-blue-500/70">• Running</span>
                      )}
                    </div>
                  </div>
                )
              }
              
              // Hide tool on desktop if collapseToolsOnDesktop is true and it's not a Task
              const hideToolForDesktop = collapseToolsOnDesktop && !isTaskTool
              
              if (hideToolForDesktop) {
                return (
                  <React.Fragment key={`tool-${section.toolExecution.id}`}>
                    {/* Narrow container: Show full tool */}
                    <div className="@xl:hidden my-2 min-w-0">
                      <ToolExecutionIndicator
                        execution={section.toolExecution}
                        compact={!isOperatorTool || isTaskTool}
                        onAssetClick={onAssetClick}
                        onBundleClick={onBundleClick}
                        defaultExpanded={section.toolExecution.id === lastCompletedToolId}
                      />
                    </div>
                    {/* Wide container: Show Temporal Anchor */}
                    <div className="hidden @xl:block my-3 min-w-0">
                      <TemporalAnchor execution={section.toolExecution} />
                    </div>
                  </React.Fragment>
                )
              }
              
              return (
                <div key={`tool-${section.toolExecution.id}`} className="my-2 min-w-0">
                  <ToolExecutionIndicator
                    execution={section.toolExecution}
                    compact={!isOperatorTool || isTaskTool}
                    onAssetClick={onAssetClick}
                    onBundleClick={onBundleClick}
                    defaultExpanded={section.toolExecution.id === lastCompletedToolId}
                  />
                </div>
              )

            case 'content':
              return (
                <div key={`content-${index}`} className="prose prose-sm dark:prose-invert max-w-none">
                  <Response parseIncompleteMarkdown={true}>
                    {section.content}
                  </Response>
                </div>
              )

            default:
              return null
          }
        })}
      </div>

      {/* Show unreferenced tool executions if any */}
      {normalizedToolExecutions.length > 0 && sections.filter(s => s.type === 'tool').length === 0 && (
        <details className={cn(
          "mt-4 pt-4 border-t border-border/50",
          collapseToolsOnDesktop && "@xl:hidden"
        )}>
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
            Tool Executions ({normalizedToolExecutions.length})
          </summary>
          <div className="mt-3 space-y-2">
            {normalizedToolExecutions
              .filter(execution => {
                // Filter out task tools if hideTaskTools is true
                const isTaskTool = ['tasks'].includes(execution.tool_name)
                return !(isTaskTool && hideTaskTools)
              })
              .map(execution => (
                <ToolExecutionIndicator
                  key={execution.id}
                  execution={execution}
                  compact={true}
                  onAssetClick={onAssetClick}
                  onBundleClick={onBundleClick}
                  defaultExpanded={execution.id === lastCompletedToolId}
                />
              ))}
          </div>
        </details>
      )}
    </div>
  )
}
