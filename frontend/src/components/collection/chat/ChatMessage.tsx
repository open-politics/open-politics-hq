'use client'

import React from 'react'
import { ToolExecution } from '@/hooks/useIntelligenceChat'
import { ToolExecutionIndicator } from './ToolExecutionIndicator'
import { Response } from '@/components/ai-elements/response'
import { Badge } from '@/components/ui/badge'
import { Wrench } from 'lucide-react'

interface MessageContentWithToolResultsProps {
  content: string
  messageId: string
  toolExecutions?: ToolExecution[]
  onAssetClick?: (assetId: number) => void
  onBundleClick?: (bundleId: number) => void
}

/**
 * Component that parses message content for XML tool result markers and expands them
 * with rich, interactive tool execution displays.
 * 
 * XML Marker Format:
 * <tool_results id="execution_id" tool="tool_name" />
 * 
 * Example:
 * "I found 10 articles <tool_results id="exec_123" tool="search_web" />. I've organized them <tool_results id="exec_456" tool="create_bundle" />."
 */
export function MessageContentWithToolResults({
  content,
  messageId,
  toolExecutions = [],
  onAssetClick,
  onBundleClick
}: MessageContentWithToolResultsProps) {
  // Helper to decode HTML entities
  const decodeHtmlEntities = (text: string): string => {
    const textArea = document.createElement('textarea');
    textArea.innerHTML = text;
    return textArea.value;
  }

  // Parse content for XML markers
  const parseContentWithMarkers = () => {
    // Decode any HTML entities first (in case XML is escaped)
    let decodedContent = decodeHtmlEntities(content);
    
    // First, remove all closing tags (they're just noise for parsing)
    decodedContent = decodedContent.replace(/<\/tool_results>/g, '');
    
    // Regex to match three formats:
    // - Self-closing: <tool_results tool="navigate" />
    // - Opening: <tool_results tool="navigate">
    // - Legacy: <tool_results id="something" tool="something" />
    const markerRegex = /<tool_results\s+(?:id=["']([^"']+)["']\s+)?tool=["']([^"']+)["']\s*\/?>/g
    
    const parts: Array<{ type: 'text' | 'marker', content: string, executionId?: string, toolName?: string, markerIndex?: number }> = []
    let lastIndex = 0
    let match
    // Track marker count per tool name
    const markerCountByTool: Record<string, number> = {}

    while ((match = markerRegex.exec(decodedContent)) !== null) {
      // Add text before the marker
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: decodedContent.slice(lastIndex, match.index)
        })
      }

      const toolName = match[2]
      // Initialize counter for this tool if not seen before
      if (!(toolName in markerCountByTool)) {
        markerCountByTool[toolName] = 0
      }

      // Add the marker with per-tool index
      parts.push({
        type: 'marker',
        content: match[0],
        executionId: match[1], // May be undefined for new format
        toolName: toolName,
        markerIndex: markerCountByTool[toolName]++
      })

      lastIndex = match.index + match[0].length
    }

    // Add remaining text after last marker
    if (lastIndex < decodedContent.length) {
      parts.push({
        type: 'text',
        content: decodedContent.slice(lastIndex)
      })
    }

    // If no markers found, return single text part
    if (parts.length === 0) {
      parts.push({
        type: 'text',
        content: decodedContent
      })
    }
    
    return parts
  }

  // Find tool execution by ID or by sequential matching
  const findExecution = (executionId?: string, toolName?: string, markerIndex?: number): ToolExecution | undefined => {
    // If we have an explicit ID, use it (legacy format)
    if (executionId) {
      return toolExecutions.find(exec => exec.id === executionId);
    }
    
    // Otherwise, match by tool name and order (new format)
    if (toolName !== undefined && markerIndex !== undefined) {
      // Find all executions with this tool name
      const matchingExecutions = toolExecutions.filter(exec => exec.tool_name === toolName);
      
      // Return the one at this marker index (0-based)
      return matchingExecutions[markerIndex];
    }
    
    return undefined;
  }

  const parts = parseContentWithMarkers()

  // Get unique tool names in order of first appearance
  const uniqueToolNames: string[] = []
  toolExecutions.forEach(exec => {
    if (!uniqueToolNames.includes(exec.tool_name)) {
      uniqueToolNames.push(exec.tool_name)
    }
  })

  // Find the last completed tool execution for default expansion
  let lastCompletedToolId: string | null = null
  toolExecutions.forEach(exec => {
    if (exec.status === 'completed' && (exec.structured_content || exec.result)) {
      lastCompletedToolId = exec.id
    }
  })

  return (
    <div className="space-y-3">
      {toolExecutions.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">Tools used:</span>
          <div className="flex flex-wrap gap-1">
            {uniqueToolNames.map((toolName) => (
              <Badge
                key={toolName}
                variant="secondary"
                className="px-2 py-0.5 text-xs rounded-md bg-muted/60 border border-muted-foreground/10 text-muted-foreground"
              >
                {toolName}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-3">
        {parts.map((part, index) => {
          if (part.type === 'text' && part.content.trim()) {
            // Render markdown text
            return (
              <div key={`text-${index}`} className="prose prose-sm dark:prose-invert max-w-none">
                <Response parseIncompleteMarkdown={true}>
                  {part.content}
                </Response>
              </div>
            )
          } else if (part.type === 'marker') {
            // Find and render the corresponding tool execution
            const execution = findExecution(part.executionId, part.toolName, part.markerIndex)
            
            if (execution) {
              // Always use ToolExecutionIndicator - it intelligently routes to registry or legacy
              // Operator tools show as full cards (not compact), others show compact
              const isOperatorTool = ['navigate', 'organize', 'semantic_search', 'search_web'].includes(execution.tool_name);
              
              return (
                <div key={`marker-${index}`} className={isOperatorTool ? "my-4" : "my-3"}>
                  <ToolExecutionIndicator
                    execution={execution}
                    compact={!isOperatorTool}
                    onAssetClick={onAssetClick}
                    onBundleClick={onBundleClick}
                    defaultExpanded={execution.id === lastCompletedToolId}
                  />
                </div>
              )
            } else {
              // Execution not found - show placeholder
              return (
                <div key={`marker-${index}`} className="my-2 px-3 py-2 bg-muted/50 rounded-md text-xs text-muted-foreground border border-dashed">
                  🔄 Tool result: {part.toolName || part.executionId}
                </div>
              )
            }
          }
          return null
        })}
      </div>
    </div>
  )
}
