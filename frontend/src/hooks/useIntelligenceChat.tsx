'use client'

import { useState, useCallback } from 'react'
import { IntelligenceChatService } from '@/client/services'
import { ChatRequest, ChatResponse, ToolCallRequest } from '@/client/models'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { toast } from 'sonner'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: Date
  tool_calls?: Array<Record<string, unknown>>
  thinking_trace?: string
}

export interface UseIntelligenceChatOptions {
  model_name?: string
  temperature?: number
  max_tokens?: number
  thinking_enabled?: boolean
}

export function useIntelligenceChat(options: UseIntelligenceChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { activeInfospace } = useInfospaceStore()

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
        stream: false,
        temperature: customOptions?.temperature ?? options.temperature,
        max_tokens: customOptions?.max_tokens || options.max_tokens,
        thinking_enabled: customOptions?.thinking_enabled || options.thinking_enabled || false
      }

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

      setMessages(prev => [...prev, assistantMessage])
      return assistantMessage

    } catch (err: any) {
      const errorMessage = err.body?.detail || err.message || 'Failed to send message'
      setError(errorMessage)
      toast.error(errorMessage)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [messages, activeInfospace, options])

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

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
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

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    executeToolCall,
    clearMessages,
    getAvailableModels
  }
}
