'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Loader2, Send, Bot, User, Search, FileText, BarChart3, Database } from 'lucide-react'
import { useIntelligenceChat, ChatMessage, ToolExecution } from '@/hooks/useIntelligenceChat'
import { ToolExecutionList } from './ToolExecutionIndicator'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { IntelligenceChatService } from '@/client/services'
import { ModelInfo } from '@/client/models'
import ProviderModelSelector from '@/components/ui/ProviderModelSelector'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface IntelligenceChatProps {
  className?: string
}


export function IntelligenceChat({ className }: IntelligenceChatProps) {
  const [input, setInput] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [temperature, setTemperature] = useState<string>('')
  const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(true)
  const [streamEnabled, setStreamEnabled] = useState<boolean>(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  
  const { activeInfospace } = useInfospaceStore()
  const {
    messages,
    isLoading,
    error,
    activeToolExecutions,
    sendMessage,
    executeToolCall,
    clearMessages,
    stop
  } = useIntelligenceChat({
    model_name: selectedModel,
    thinking_enabled: thinkingEnabled
  })

  // Load available models
  useEffect(() => {
    async function loadModels() {
      if (!activeInfospace?.id) return
      
      try {
        // Get all available models
        const response = await IntelligenceChatService.listAvailableModels()
        setModels(response.models || [])
        
        // Set default model if none selected
        if (!selectedModel && response.models && response.models.length > 0) {
          // Prefer tool-supporting models, then Ollama models, then any available
          const toolModels = response.models.filter(m => m.supports_tools)
          const ollamaModels = response.models.filter(m => m.provider === 'ollama')
          
          const defaultModel = toolModels[0] || ollamaModels[0] || response.models[0]
          setSelectedModel(defaultModel.name)
        }
      } catch (err) {
        console.error('Failed to load models:', err)
        toast.error('Failed to load available models')
      } finally {
        setIsLoadingModels(false)
      }
    }

    loadModels()
  }, [activeInfospace?.id, selectedModel])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading || isLoadingModels) return
    if (!selectedModel) {
      toast.error('Please select a model')
      return
    }

    const userInput = input.trim()
    setInput('')
    
    const tempNum = temperature === '' ? undefined : Number(temperature)
    await sendMessage(userInput, { 
      model_name: selectedModel,
      temperature: Number.isFinite(tempNum as number) ? (tempNum as number) : undefined,
      thinking_enabled: thinkingEnabled,
      stream: streamEnabled
    })
  }

  const handleModelChange = (modelName: string) => {
    setSelectedModel(modelName)
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

  const renderMessage = (message: ChatMessage) => {
    const isUser = message.role === 'user'
    
    return (
      <div key={message.id} className={cn(
        "flex gap-3 p-4",
        isUser ? "justify-end" : "justify-start"
      )}>
        <div className={cn(
          "flex gap-3 max-w-[80%]",
          isUser ? "flex-row-reverse" : "flex-row"
        )}>
          <div className={cn(
            "flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          )}>
            {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </div>
          
          <div className={cn(
            "rounded-lg px-3 py-2 text-sm",
            isUser 
              ? "bg-primary text-primary-foreground" 
              : "bg-muted"
          )}>
            <div className="whitespace-pre-wrap">{message.content}</div>
            
            {message.thinking_trace && (
              <details className="mt-2 text-xs opacity-70">
                <summary className="cursor-pointer">Reasoning trace</summary>
                <div className="mt-1 whitespace-pre-wrap font-mono text-xs">
                  {message.thinking_trace}
                </div>
              </details>
            )}
            
            {message.tool_executions && message.tool_executions.length > 0 && (
              <div className="mt-2">
                <ToolExecutionList executions={message.tool_executions} compact={true} />
              </div>
            )}
            
            <div className="text-xs opacity-50 mt-1">
              {message.timestamp.toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!activeInfospace) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center h-64">
          <div className="text-center">
            <Bot className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Please select an infospace to start chatting</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn("flex flex-col h-[600px] bg-background/60 backdrop-blur-sm", className)}>
      <CardHeader className="flex-none">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Intelligence Chat
          </CardTitle>
          
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowSettings(v => !v)}>
              Settings
            </Button>
            <ProviderModelSelector
              value={selectedModel}
              onChange={handleModelChange}
              className=""
            />
            
            <Button
              variant="outline"
              size="sm"
              onClick={clearMessages}
              disabled={messages.length === 0}
            >
              Clear
            </Button>
          </div>
        </div>
        
        <div className="text-sm text-muted-foreground">
          Ask questions about your data. I can search, analyze, and create reports.
          {selectedModel && models.length > 0 && (() => {
            const m = models.find(mm => mm.name === selectedModel)
            const provider = m?.provider || ''
            const name = (m?.name || '').toLowerCase()
            const likelySupportsTools = !!(m?.supports_tools || provider === 'openai' || name.includes('llama3') || name.includes('qwen') || name.includes('mistral') || name.includes('mixtral') || name.includes('gemma') || name.includes('command-r'))
            return (
              <div className="mt-1">
                {likelySupportsTools ? (
                  <span className="text-green-600 text-xs">✓ Tool support enabled</span>
                ) : (
                  <span className="text-yellow-600 text-xs">⚠ Chat only (no tools)</span>
                )}
              </div>
            )
          })()}
        </div>
        {showSettings && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {/* Model selection is handled in the header to avoid duplication */}
            <div>
              <Label htmlFor="temperature">Temperature</Label>
              <Input id="temperature" placeholder="default" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
              <div className="text-[10px] opacity-60 mt-1">Leave empty to use provider default</div>
            </div>
            <div className="flex items-end gap-2">
              <Switch id="thinking" checked={thinkingEnabled} onCheckedChange={setThinkingEnabled} />
              <Label htmlFor="thinking">Enable Thinking</Label>
            </div>
            <div className="flex items-end gap-2">
              <Switch id="stream" checked={streamEnabled} onCheckedChange={setStreamEnabled} />
              <Label htmlFor="stream">Stream Responses</Label>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col min-h-0 p-0">
        <ScrollArea className="flex-1 px-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Bot className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">
                  Start a conversation with your intelligence data
                </p>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Try asking:</p>
                  <ul className="text-left space-y-1">
                    <li>• "What are the main themes in recent documents?"</li>
                    <li>• "Search for assets about climate policy"</li>
                    <li>• "Analyze sentiment in the latest articles"</li>
                    <li>• "Create a summary report of key findings"</li>
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {messages.map(renderMessage)}
              {/* Active tool executions */}
              {activeToolExecutions.length > 0 && (
                <div className="p-4 border-t border-b bg-muted/20">
                  <ToolExecutionList executions={activeToolExecutions} compact={false} />
                </div>
              )}
              
              {isLoading && (
                <div className="flex gap-3 p-4">
                  <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-muted">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {activeToolExecutions.filter(e => e.status === 'running').length > 0 
                      ? 'Running tools...' 
                      : 'Thinking...'
                    }
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>

        <div className="flex-none p-4 border-t">
          <form ref={formRef} onSubmit={handleSubmit} className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your data... (Shift+Enter for newline)"
              disabled={isLoadingModels || !selectedModel}
              className="flex-1 min-h-[60px] resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  formRef.current?.requestSubmit()
                }
              }}
            />
            <Button
              type="submit"
              disabled={!input.trim() || isLoading || isLoadingModels || !selectedModel}
              size="icon"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
            {isLoading && (
              <Button
                type="button"
                variant="destructive"
                disabled={!selectedModel}
                onClick={(e) => {
                  e.preventDefault()
                  stop()
                }}
                className="ml-1"
              >
                Stop
              </Button>
            )}
          </form>
          
          {error && (
            <div className="mt-2 text-sm text-red-500">
              {error}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
