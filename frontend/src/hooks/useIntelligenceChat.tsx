'use client'

import { useState, useCallback, useRef } from 'react'
import { IntelligenceChatService } from '@/client/services'
import { ChatRequest, ChatResponse, ToolCallRequest } from '@/client/models'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { toast } from 'sonner'
import { OpenAPI } from '@/client/core/OpenAPI'

export interface ToolExecution {
  id: string
  tool_name: string
  arguments: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: unknown
  error?: string
  timestamp: Date
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: Date
  tool_calls?: Array<Record<string, unknown>>
  tool_executions?: ToolExecution[]
  thinking_trace?: string
}

export interface UseIntelligenceChatOptions {
  model_name?: string
  temperature?: number
  max_tokens?: number
  thinking_enabled?: boolean
  stream?: boolean
}

export function useIntelligenceChat(options: UseIntelligenceChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeToolExecutions, setActiveToolExecutions] = useState<ToolExecution[]>([])
  const { activeInfospace } = useInfospaceStore()
  const abortControllerRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (
    content: string,
    customOptions?: Partial<UseIntelligenceChatOptions>
  ): Promise<ChatMessage | null> => {
    if (!activeInfospace?.id) {
      toast.error('Please select an active infospace')
      return null
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setIsLoading(true)
    setError(null)

    try {
      const chatRequest: ChatRequest = {
        messages: [
          ...messages.map(msg => ({ role: msg.role, content: msg.content })),
          { role: 'user', content }
        ],
        model_name: customOptions?.model_name || options.model_name || undefined as unknown as string,
        infospace_id: activeInfospace.id,
        stream: customOptions?.stream ?? options.stream ?? false,
        temperature: customOptions?.temperature ?? options.temperature,
        max_tokens: customOptions?.max_tokens || options.max_tokens,
        thinking_enabled: customOptions?.thinking_enabled || options.thinking_enabled || false
      }
      if (chatRequest.stream) {
        // Manual streaming using fetch to handle SSE-like responses
        const controller = new AbortController()
        abortControllerRef.current = controller
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }
          try {
            // Prefer generated client's HEADERS resolver (used across the app)
            const maybeHeaders = (OpenAPI.HEADERS as any)
            const resolved = typeof maybeHeaders === 'function' ? await maybeHeaders({} as any) : maybeHeaders
            if (resolved && typeof resolved === 'object') {
              Object.assign(headers, resolved)
            }
            // Fallback to localStorage token if resolver not configured
            if (!headers['Authorization'] && typeof window !== 'undefined') {
              const token = localStorage.getItem('access_token')
              if (token) headers['Authorization'] = `Bearer ${token}`
            }
          } catch {}
          const resp = await fetch('/api/v1/chat/chat', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify(chatRequest),
            signal: controller.signal
          })
          if (!resp.ok || !resp.body) {
            throw new Error(`Streaming request failed: ${resp.status}`)
          }
          const reader = resp.body.getReader()
          const decoder = new TextDecoder('utf-8')
          let acc = ''
          let current: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: '',
            timestamp: new Date()
          }
          setMessages(prev => [...prev, current])
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            acc += decoder.decode(value, { stream: true })
            const lines = acc.split('\n')
            acc = lines.pop() || ''
            for (const raw of lines) {
              if (!raw) continue
              const line = raw.trim()
              if (!line.startsWith('data: ')) continue
              const payload = line.slice(6).trim()
              if (payload === '[DONE]') continue
              try {
                const obj = JSON.parse(payload)
                const contentDelta = obj.content as string | undefined
                if (contentDelta !== undefined) {
                  current = { ...current, content: contentDelta }
                }
                if (obj.tool_calls) {
                  current = { ...current, tool_calls: obj.tool_calls }
                  // Process tool calls for execution tracking
                  processToolCallsForExecution(obj.tool_calls, current.id)
                }
                if (obj.thinking_trace) {
                  current = { ...current, thinking_trace: obj.thinking_trace }
                }
                setMessages(prev => prev.map(m => m.id === current.id ? current : m))
              } catch (_) {
                // ignore malformed chunks
              }
            }
          }
          return current
        } catch (e: any) {
          throw e
        }
      } else {
        const response = await IntelligenceChatService.intelligenceChat({
          requestBody: chatRequest
        })

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.content,
          timestamp: new Date(),
          tool_calls: response.tool_calls || undefined,
          thinking_trace: response.thinking_trace || undefined
        }
        
        // Process tool executions after message is created
        if (response.tool_calls) {
          assistantMessage.tool_executions = processToolCallsForExecution(response.tool_calls, assistantMessage.id)
        }

        setMessages(prev => [...prev, assistantMessage])
        return assistantMessage
      }

    } catch (err: any) {
      // Swallow abort errors triggered by Stop button
      const isAbort = err?.name === 'AbortError' || typeof err?.message === 'string' && err.message.toLowerCase().includes('aborted')
      if (isAbort) {
        return null
      }
      const errorMessage = err?.body?.detail || err?.message || 'Failed to send message'
      setError(errorMessage)
      toast.error(errorMessage)
      return null
    } finally {
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

  return {
    messages,
    isLoading,
    error,
    activeToolExecutions,
    sendMessage,
    executeToolCall,
    clearMessages,
    getAvailableModels,
    stop
  }
}
