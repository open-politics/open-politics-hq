'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Loader2, Send, Bot, User, Search, FileText, BarChart3, Database } from 'lucide-react'
import { useIntelligenceChat, ChatMessage } from '@/hooks/useIntelligenceChat'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { IntelligenceChatService } from '@/client/services'
import { ModelInfo } from '@/client/models'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface IntelligenceChatProps {
  className?: string
}

interface ToolCallDisplay {
  id: string
  tool_name: string
  arguments: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'completed' | 'failed'
}

export function IntelligenceChat({ className }: IntelligenceChatProps) {
  const [input, setInput] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(true)
  const [toolCalls, setToolCalls] = useState<ToolCallDisplay[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [temperature, setTemperature] = useState<string>('')
  const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const { activeInfospace } = useInfospaceStore()
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    executeToolCall,
    clearMessages
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
      toast.error('Please select a model that supports tools')
      return
    }

    const userInput = input.trim()
    setInput('')
    
    const tempNum = temperature === '' ? undefined : Number(temperature)
    await sendMessage(userInput, { 
      model_name: selectedModel,
      temperature: Number.isFinite(tempNum as number) ? (tempNum as number) : undefined,
      thinking_enabled: thinkingEnabled
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
            
            {message.tool_calls && message.tool_calls.length > 0 && (
              <div className="mt-2 space-y-2">
                <div className="text-xs opacity-70">Tool calls:</div>
                {message.tool_calls.map((toolCall: any, index) => {
                  const name = toolCall?.function?.name || toolCall?.name || 'unknown_tool'
                  const argsStr = toolCall?.function?.arguments || toolCall?.arguments || '{}'
                  let args: Record<string, unknown> = {}
                  try { args = JSON.parse(argsStr) } catch { args = {} }
                  const existing = toolCalls.find(tc => tc.id === (toolCall.id || `${name}-${index}`))
                  return (
                    <div key={toolCall.id || `${name}-${index}`} className="border rounded-md p-2 bg-background">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-xs flex items-center gap-1">
                          {getToolIcon(name)}
                          <span>{name}</span>
                        </Badge>
                        <span className="text-[10px] opacity-60">{existing?.status || 'pending'}</span>
                      </div>
                      <pre className="text-xs whitespace-pre-wrap opacity-80 max-h-40 overflow-auto">{JSON.stringify(args, null, 2)}</pre>
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const id = toolCall.id || `${name}-${index}`
                            setToolCalls(prev => {
                              const next = prev.filter(t => t.id !== id)
                              next.push({ id, tool_name: name, arguments: args, status: 'pending' })
                              return next
                            })
                            try {
                              const result = await executeToolCall(name, args)
                              setToolCalls(prev => prev.map(t => t.id === id ? { ...t, result, status: 'completed' } : t))
                            } catch (err) {
                              setToolCalls(prev => prev.map(t => t.id === id ? { ...t, result: { error: (err as any)?.message || 'Tool failed' }, status: 'failed' } : t))
                            }
                          }}
                        >
                          Run tool
                        </Button>
                        {existing?.result != null && (
                          <details className="text-xs">
                            <summary className="cursor-pointer opacity-70">View result</summary>
                            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(existing.result, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    </div>
                  )
                })}
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
    <Card className={cn("flex flex-col h-[600px]", className)}>
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
            {isLoadingModels ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading models...
              </div>
            ) : (
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="text-xs border rounded px-2 py-1"
              >
                {models.map(model => (
                  <option key={model.name} value={model.name}>
                    {model.provider}: {model.name}
                  </option>
                ))}
              </select>
            )}
            
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
          {selectedModel && models.length > 0 && (
            <div className="mt-1">
              {models.find(m => m.name === selectedModel)?.supports_tools ? (
                <span className="text-green-600 text-xs">✓ Tool support enabled</span>
              ) : (
                <span className="text-yellow-600 text-xs">⚠ Chat only (no tools)</span>
              )}
            </div>
          )}
        </div>
        {showSettings && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <Label htmlFor="model">Language Model</Label>
              <select
                id="model"
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="mt-1 w-full border rounded px-2 py-1"
              >
                <option value="" disabled>Select a model</option>
                {models.map(model => (
                  <option key={model.name} value={model.name}>
                    {model.provider}: {model.name} {model.supports_tools ? '(tools)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="temperature">Temperature</Label>
              <Input id="temperature" placeholder="default" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
              <div className="text-[10px] opacity-60 mt-1">Leave empty to use provider default</div>
            </div>
            <div className="flex items-end gap-2">
              <Switch id="thinking" checked={thinkingEnabled} onCheckedChange={setThinkingEnabled} />
              <Label htmlFor="thinking">Enable Thinking</Label>
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
              {isLoading && (
                <div className="flex gap-3 p-4">
                  <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-muted">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>

        <div className="flex-none p-4 border-t">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your data..."
              disabled={isLoading || isLoadingModels || !selectedModel}
              className="flex-1"
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
