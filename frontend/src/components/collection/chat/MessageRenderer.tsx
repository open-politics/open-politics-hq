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
import { SourceConfirmCard, isStagedSource } from './SourceConfirmCard'
import { SchemaConfirmCard, isStagedSchema } from './SchemaConfirmCard'
import { SearchModeCard, isStagedSearchMode } from './SearchModeCard'
import { Response } from '@/components/ai-elements/response'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'


interface AssistantMessageRendererProps {
  content: string
  messageId: string
  toolExecutions?: ToolExecution[]
  thinkingTrace?: string
  onAssetClick?: (assetId: number) => void
  onBundleClick?: (bundleId: number) => void
  hideTaskTools?: boolean  // When true, skip rendering task tools inline (used when side panel shows them)
  collapseToolsOnDesktop?: boolean  // Hide tool cards on desktop (shown in sidebar)
  autoExpandLast?: boolean  // Auto-expand the latest completed tool; false once the message ends so all cards collapse
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
  collapseToolsOnDesktop = false,
  autoExpandLast = true
}: AssistantMessageRendererProps) {
  // Normalize null to empty array (default param only handles undefined)
  const normalizedToolExecutions = toolExecutions || []
  
  const sections = useMemo(
    () => parseMessageSections(content, normalizedToolExecutions, thinkingTrace),
    [content, normalizedToolExecutions, thinkingTrace]
  )

  // Auto-open the initial reasoning while any tool is still running.
  const hasRunningTool = normalizedToolExecutions.some(exec => exec.status === 'running')

  return (
    <div className="space-y-3 min-w-0 w-full overflow-hidden">
      {/* Reasoning, inline confirmations, and final prose. Tool activity is
          consolidated into a single collapsible panel rendered by the chat. */}
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

            case 'tool': {
              if (!section.toolExecution) return null

              // A staged source is a call to action — render its confirm card inline,
              // always open. Every other tool (and task tools) is consolidated into
              // the single collapsible tool panel (sidebar on wide, inline on mobile —
              // see Chat.renderMessage), so nothing else renders in the reading column.
              if (isStagedSource(section.toolExecution)) {
                return (
                  <div key={`tool-${section.toolExecution.id}`} className="my-2 min-w-0">
                    <SourceConfirmCard execution={section.toolExecution} />
                  </div>
                )
              }
              if (isStagedSchema(section.toolExecution)) {
                return (
                  <div key={`tool-${section.toolExecution.id}`} className="my-2 min-w-0">
                    <SchemaConfirmCard execution={section.toolExecution} />
                  </div>
                )
              }
              if (isStagedSearchMode(section.toolExecution)) {
                return (
                  <div key={`tool-${section.toolExecution.id}`} className="my-2 min-w-0">
                    <SearchModeCard execution={section.toolExecution} />
                  </div>
                )
              }
              return null
            }

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
    </div>
  )
}
