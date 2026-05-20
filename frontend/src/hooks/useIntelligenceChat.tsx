'use client'

import { useState, useCallback, useRef } from 'react'
import { IntelligenceChatService } from '@/client'
import { ChatRequest, ChatResponse, ToolCallRequest } from '@/client'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { useProvidersStore } from '@/zustand_stores/storeProviders'
import { toast } from 'sonner'
import { connectSSE } from '@/lib/sse'

export interface ToolExecution {
  id: string
  tool_name: string
  arguments: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: unknown
  structured_content?: unknown  // Rich structured data for frontend rendering
  error?: string
  timestamp: Date
  iteration?: number  // Tool loop iteration (for segmented thinking)
  thinking_before?: string  // Thinking that occurred before this tool execution
  thinking_after?: string  // Thinking that occurred after this tool execution
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: Date
  tool_calls?: Array<Record<string, unknown>>
  tool_executions?: ToolExecution[]
  thinking_trace?: string
  context_assets?: Array<{
    id: number
    title: string
    kind?: string
  }>  // Documents that were attached as context
  context_depth?: 'titles' | 'previews' | 'full'  // Depth level used
  image_asset_ids?: number[]  // Image assets attached for vision models
  image_assets?: Array<{  // Full image metadata for display
    id: number
    title: string
    blob_path: string
  }>
}

export interface UseIntelligenceChatOptions {
  model_name?: string
  provider_name?: string
  temperature?: number
  max_tokens?: number
  thinking_enabled?: boolean
  tools_enabled?: boolean  // Enable/disable tool calls (default: true)
  tools?: Array<Record<string, unknown>>  // Tools to use for the chat
  stream?: boolean
  conversation_id?: number  // Optional: Save messages to this conversation
  auto_save?: boolean  // Optional: Automatically save messages to conversation history
  /**
   * Agent persona — selects system prompt + MCP tool subset on the backend.
   *   - ``undefined`` / ``'intelligence'``: workspace research chat (full tools).
   *   - ``'dossier'``: run-level DossierAgent — formula + panel + snapshot + note.
   *   - ``'formula'``: in-workspace FormulaAgent — formula authoring only.
   *
   * For dossier/formula, pass ``run_id`` so the agent scopes to one annotation run.
   */
  agent?: 'intelligence' | 'dossier' | 'formula'
  /** For dossier / formula agents, the run id they operate against. */
  run_id?: number
  /** For the FormulaAgent, the currently-open formula id so the model has
   *  context about what the user is editing. Surfaces in the system prompt. */
  formula_id?: string | null
}

export function useIntelligenceChat(options: UseIntelligenceChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeToolExecutions, setActiveToolExecutions] = useState<ToolExecution[]>([])
  const { activeInfospace } = useInfospaceStore()
  const { apiKeys } = useProvidersStore()
  const abortControllerRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (
    content: string,
    customOptions?: Partial<UseIntelligenceChatOptions> & {
      displayContent?: string  // Original user input for UI display
      contextAssets?: Array<{ id: number; title: string; kind?: string }>  // Context metadata
      contextDepth?: 'titles' | 'previews' | 'full'  // Depth level
      imageAssetIds?: number[]  // Image assets for vision
      imageAssets?: Array<{ id: number; title: string; blob_path: string }>  // Full image metadata
    }
  ): Promise<ChatMessage | null> => {
    if (!activeInfospace?.id) {
      toast.error('Please select an active infospace')
      return null
    }

    // Use displayContent for UI if provided, otherwise use content
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: customOptions?.displayContent || content,  // Display original input
      timestamp: new Date(),
      context_assets: customOptions?.contextAssets,  // Store context metadata
      context_depth: customOptions?.contextDepth,  // Store depth level
      image_asset_ids: customOptions?.imageAssetIds,  // Store attached images
      image_assets: customOptions?.imageAssets  // Store image metadata for thumbnails
    }

    setMessages(prev => [...prev, userMessage])
    setIsLoading(true)
    setError(null)

    try {
      const chatRequest: ChatRequest = {
        messages: [
          // Carry tool_executions / tool_calls on prior assistant messages so the
          // backend can splice tool_use/tool_result blocks back into the provider's
          // native message shape. Without this the model only sees the assistant's
          // final text on subsequent turns and the tool data is gone.
          ...messages.map(msg => {
            const base: Record<string, unknown> = { role: msg.role, content: msg.content }
            if (msg.role === 'assistant') {
              if (msg.tool_executions && msg.tool_executions.length > 0) {
                base.tool_executions = msg.tool_executions
              }
              if (msg.tool_calls && msg.tool_calls.length > 0) {
                base.tool_calls = msg.tool_calls
              }
            }
            return base
          }),
          { role: 'user', content }
        ] as ChatRequest['messages'],
        model_name: customOptions?.model_name || options.model_name || undefined as unknown as string,
        provider_name: customOptions?.provider_name || options.provider_name || undefined,
        infospace_id: activeInfospace.id,
        stream: customOptions?.stream ?? options.stream ?? false,
        temperature: customOptions?.temperature ?? options.temperature,
        max_tokens: customOptions?.max_tokens || options.max_tokens,
        thinking_enabled: customOptions?.thinking_enabled || options.thinking_enabled || false,
        tools_enabled: customOptions?.tools_enabled ?? options.tools_enabled ?? true,
        api_keys: apiKeys && Object.keys(apiKeys).length > 0 ? apiKeys : undefined,
        conversation_id: customOptions?.conversation_id ?? options.conversation_id,
        auto_save: customOptions?.auto_save ?? options.auto_save ?? false,
        // UI-specific fields for preserving display state
        display_content: customOptions?.displayContent,
        context_assets: customOptions?.contextAssets,
        context_depth: customOptions?.contextDepth,
        // Vision features
        image_asset_ids: customOptions?.imageAssetIds,
        // Agent persona — DossierAgent (M7) or default intelligence chat.
        agent: (customOptions as any)?.agent ?? (options as any).agent,
        run_id: (customOptions as any)?.run_id ?? (options as any).run_id,
        formula_id: (customOptions as any)?.formula_id ?? (options as any).formula_id,
      } as ChatRequest
      
      if (chatRequest.stream) {
        const controller = new AbortController()
        abortControllerRef.current = controller
        try {
          let current: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: '',
            timestamp: new Date()
          }
          let messageAddedToUI = false

          await connectSSE({
            url: '/api/v1/chat/chat/stream',
            method: 'POST',
            body: chatRequest,
            signal: controller.signal,
            onEvent: (event) => {
              if (event.type === 'error') {
                try {
                  const err = JSON.parse(event.data)
                  console.error('[useIntelligenceChat] SSE error:', err.detail)
                } catch { /* ignore parse errors */ }
                return
              }
              if (event.type !== 'chunk') return

              try {
                const obj = JSON.parse(event.data)
                let updated = false

                if (obj.content !== undefined) {
                  current = { ...current, content: obj.content }
                  updated = true
                }
                if (obj.tool_executions && Array.isArray(obj.tool_executions) && obj.tool_executions.length > 0) {
                  const enrichedExecutions = (obj.tool_executions as ToolExecution[]).map(exec => ({
                    ...exec,
                    structured_content: exec.structured_content || exec.result,
                    timestamp: exec.timestamp ? new Date(exec.timestamp) : new Date()
                  }))
                  current = { ...current, tool_executions: enrichedExecutions }
                  updated = true
                }
                if (obj.tool_calls) {
                  current = { ...current, tool_calls: obj.tool_calls }
                  processToolCallsForExecution(obj.tool_calls, current.id)
                  updated = true
                }
                if (obj.thinking_trace) {
                  current = { ...current, thinking_trace: obj.thinking_trace }
                  updated = true
                }

                if (updated) {
                  const snapshot = current
                  const hasContent = snapshot.content.trim().length > 0 ||
                                    snapshot.thinking_trace ||
                                    (snapshot.tool_executions && snapshot.tool_executions.length > 0) ||
                                    (snapshot.tool_calls && snapshot.tool_calls.length > 0)

                  if (!messageAddedToUI && hasContent) {
                    setMessages(prev => [...prev, snapshot])
                    messageAddedToUI = true
                  } else if (messageAddedToUI) {
                    setMessages(prev => prev.map(m => m.id === snapshot.id ? snapshot : m))
                  }
                }
              } catch (e) {
                console.error('[useIntelligenceChat] Failed to parse streaming chunk:', e)
              }
            },
          })

          if (!messageAddedToUI) {
            setMessages(prev => [...prev, current])
          }
          setIsLoading(false)
          abortControllerRef.current = null
          return current
        } catch (e: any) {
          throw e
        }
      } else {
        console.log('[useIntelligenceChat] Sending non-streaming request...')
        const response = await IntelligenceChatService.intelligenceChat({
          requestBody: chatRequest
        })
        console.log('[useIntelligenceChat] Received non-streaming response:', response)

        // Validate response has content
        if (!response || (response.content === undefined && !response.tool_executions)) {
          console.error('[useIntelligenceChat] Invalid response received:', response)
          throw new Error('Invalid response from server')
        }

        // Extract structured_content from tool executions
        const enrichedExecutions = response.tool_executions 
          ? (response.tool_executions as any[]).map(exec => ({
              ...exec,
              structured_content: exec.structured_content || exec.result,
              timestamp: exec.timestamp ? new Date(exec.timestamp) : new Date()
            } as ToolExecution))
          : undefined

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.content || '',
          timestamp: new Date(),
          tool_calls: response.tool_calls || undefined,
          tool_executions: enrichedExecutions,  // Server-side executed tools with structured_content
          thinking_trace: response.thinking_trace || undefined
        }
        
        // If tools were called but not yet executed (shouldn't happen with our setup)
        if (response.tool_calls && !response.tool_executions) {
          assistantMessage.tool_executions = processToolCallsForExecution(response.tool_calls, assistantMessage.id)
        }

        console.log('[useIntelligenceChat] Adding assistant message to state:', assistantMessage)
        
        // Use functional update to ensure state is updated correctly
        setMessages(prev => {
          const updated = [...prev, assistantMessage]
          console.log('[useIntelligenceChat] State updated with new message, total messages:', updated.length)
          return updated
        })
        
        // Explicitly set loading to false before returning to ensure UI updates
        // This is defensive - the finally block should handle this, but we want to be certain
        setIsLoading(false)
        console.log('[useIntelligenceChat] Set isLoading to false after adding message')
        
        return assistantMessage
      }

    } catch (err: any) {
      console.error('[useIntelligenceChat] Request failed:', err)
      
      // Swallow abort errors triggered by Stop button
      const isAbort = err?.name === 'AbortError' || typeof err?.message === 'string' && err.message.toLowerCase().includes('aborted')
      if (isAbort) {
        console.log('[useIntelligenceChat] Request aborted by user')
        return null
      }
      
      const errorMessage = err?.body?.detail || err?.message || 'Failed to send message'
      console.error('[useIntelligenceChat] Error message:', errorMessage)
      setError(errorMessage)
      toast.error(errorMessage)
      return null
    } finally {
      console.log('[useIntelligenceChat] Request complete, cleaning up...')
      setIsLoading(false)
      // Clear any prior controller after request completes
      if (abortControllerRef.current) {
        abortControllerRef.current = null
      }
    }
  }, [messages, activeInfospace, options])

  const processToolCallsForExecution = useCallback((toolCalls: Array<Record<string, unknown>>, messageId: string): ToolExecution[] => {
    if (!toolCalls || toolCalls.length === 0) return []
    
    const executions: ToolExecution[] = toolCalls.map((toolCall: any) => {
      const tool_name = toolCall?.function?.name || toolCall?.name || 'unknown_tool'
      const argsStr = toolCall?.function?.arguments || toolCall?.arguments || '{}'
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(argsStr)
      } catch {
        args = { arguments_string: argsStr }
      }
      
      return {
        id: toolCall.id || `${tool_name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        tool_name,
        arguments: args,
        status: 'running' as const, // Start as running to show activity
        timestamp: new Date()
      }
    })
    
    // Add to active executions as running
    setActiveToolExecutions(prev => [...prev, ...executions])
    
    // Mark as completed after a brief delay to show activity
    setTimeout(() => {
      setActiveToolExecutions(prev => 
        prev.map(exec => {
          const execution = executions.find(e => e.id === exec.id)
          if (execution) {
            return {
              ...exec,
              status: 'completed' as const,
              result: { message: 'Tool executed automatically by the model' }
            }
          }
          return exec
        })
      )
    }, 1000)
    
    // Remove from active executions after showing completion
    setTimeout(() => {
      setActiveToolExecutions(prev => 
        prev.filter(exec => !executions.some(e => e.id === exec.id))
      )
    }, 4000)
    
    return executions
  }, [activeInfospace])


  const executeToolCall = useCallback(async (
    tool_name: string,
    arguments_obj: Record<string, unknown>
  ): Promise<unknown> => {
    if (!activeInfospace?.id) {
      toast.error('Please select an active infospace')
      return null
    }

    try {
      const toolRequest: ToolCallRequest = {
        tool_name,
        arguments: arguments_obj,
        infospace_id: activeInfospace.id
      }

      const result = await IntelligenceChatService.executeToolCall({
        requestBody: toolRequest
      })

      return result

    } catch (err: any) {
      const errorMessage = err.body?.detail || err.message || 'Tool execution failed'
      toast.error(errorMessage)
      throw err
    }
  }, [activeInfospace])


  const stop = useCallback(() => {
    try {
      abortControllerRef.current?.abort()
    } catch (_) {}
    setIsLoading(false)
  }, [])

  const getAvailableModels = useCallback(async (capability?: string) => {
    try {
      const response = await IntelligenceChatService.listAvailableModels({ 
        capability: capability || undefined 
      })
      return response.models || []
    } catch (err: any) {
      console.error('Failed to fetch models:', err)
      toast.error('Failed to load available models')
      return []
    }
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
    setActiveToolExecutions([])
  }, [])

  const loadMessages = useCallback((conversationMessages: Array<{
    id: number
    role: string
    content: string
    created_at: string
    tool_calls?: Array<Record<string, unknown>>
    tool_executions?: Array<Record<string, unknown>>
    thinking_trace?: string
    message_metadata?: Record<string, any>
  }>) => {
    const chatMessages: ChatMessage[] = conversationMessages.map(msg => {
      // Extract metadata for proper display
      const metadata = msg.message_metadata || {}
      
      return {
        id: `msg-${msg.id}`,
        role: msg.role as 'user' | 'assistant' | 'tool',
        // Use display_content from metadata if available (original user input), otherwise use raw content
        content: metadata.display_content || msg.content,
        timestamp: new Date(msg.created_at),
        tool_calls: msg.tool_calls,
        tool_executions: msg.tool_executions as any,
        thinking_trace: msg.thinking_trace,
        context_assets: metadata.context_assets,
        context_depth: metadata.context_depth
      }
    })
    setMessages(chatMessages)
    setError(null)
  }, [])

  return {
    messages,
    setMessages,
    isLoading,
    error,
    activeToolExecutions,
    sendMessage,
    executeToolCall,
    clearMessages,
    loadMessages,
    getAvailableModels,
    stop
  }
}
