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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Loader2, Send, Bot, User, Search, FileText, BarChart3, Database,
  History, Pin, Archive, Trash2, MessageSquare, ChevronLeft, ChevronRight, RefreshCw, Copy, X, Settings, PanelLeftClose, PanelLeft, Plus
} from 'lucide-react'
import { useIntelligenceChat, ChatMessage, ToolExecution } from '@/hooks/useIntelligenceChat'
import { useChatConversations } from '@/hooks/useChatConversations'
import { ToolExecutionList } from './ToolExecutionIndicator'
import { MessageContentWithToolResults } from './ChatMessage'
import { AssistantMessageRenderer } from './MessageRenderer'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { IntelligenceChatService } from '@/client'
import { ModelInfo } from '@/client'
import ProviderModelSelector from '@/components/collection/_unsorted_legacy/ProviderModelSelector'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import AssetDetailOverlay from '@/components/collection/assets/Views/AssetDetailOverlay'
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext'
import { formatDistanceToNow } from 'date-fns'
import { MemoizedMarkdown } from '@/components/ui/memoized-markdown'

interface IntelligenceChatProps {
  className?: string
}

// Helper to copy text to clipboard and show toast
const copyToClipboard = async (text: string, toastMsg = 'Copied!') => {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(toastMsg)
  } catch (err) {
    toast.error('Failed to copy')
  }
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Conversation management state
  const [showConversations, setShowConversations] = useState(false)
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null)
  const [currentConversationTitle, setCurrentConversationTitle] = useState<string>('')

  // Asset detail overlay state
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null)

  const { activeInfospace } = useInfospaceStore()

  // Conversation management hook
  const {
    conversations,
    isLoading: isLoadingConversations,
    fetchConversations,
    createConversation,
    getConversation,
    updateConversationDetails,
    deleteConversation: deleteConversationApi,
    pinConversation,
    archiveConversation,
  } = useChatConversations()

  const {
    messages,
    isLoading,
    error,
    activeToolExecutions,
    sendMessage,
    executeToolCall,
    clearMessages,
    loadMessages,
    stop
  } = useIntelligenceChat({
    model_name: selectedModel,
    thinking_enabled: thinkingEnabled,
    conversation_id: currentConversationId || undefined,
    auto_save: currentConversationId !== null
  })

  // Load available models
  useEffect(() => {
    async function loadModels() {
      if (!activeInfospace?.id)

      try {
        // Get all available models
        const response = await IntelligenceChatService.listAvailableModels()
        setModels(response.models || [])

        // Set default model if none selected
        if (!selectedModel && response.models && response.models.length > 0) {
          // Try to find openai/gpt-5-nano, else fallback to tool-supporting, then ollama, then any
          let defaultModel: ModelInfo | undefined
          defaultModel = response.models.find(
            m =>
              (m.provider === 'openai' && m.name.toLowerCase().includes('gpt-5-nano')) ||
              m.name.toLowerCase() === 'gpt-5-nano'
          )
          if (!defaultModel) {
            defaultModel = response.models.find(m => m.provider === 'openai')
          }
          if (!defaultModel) {
            const toolModels = response.models.filter(m => m.supports_tools)
            defaultModel = toolModels[0]
          }
          if (!defaultModel) {
            const ollamaModels = response.models.filter(m => m.provider === 'ollama')
            defaultModel = ollamaModels[0]
          }
          if (!defaultModel) {
            defaultModel = response.models[0]
          }
          setSelectedModel(defaultModel?.name || '')
          // If openai/gpt-5-nano, set streaming off by default
          if (
            defaultModel &&
            (
              (defaultModel.provider === 'openai' && defaultModel.name.toLowerCase().includes('gpt-5-nano')) ||
              defaultModel.name.toLowerCase() === 'gpt-5-nano'
            )
          ) {
            setStreamEnabled(false)
          }
        }
      } catch (err) {
        console.error('Failed to load models:', err)
        toast.error('Failed to load available models')
      } finally {
        setIsLoadingModels(false)
      }
    }

    loadModels()
    // eslint-disable-next-line
  }, [activeInfospace?.id])

  // Load conversations when infospace changes
  useEffect(() => {
    if (activeInfospace?.id) {
      fetchConversations(activeInfospace.id, false)
    }
  }, [activeInfospace?.id, fetchConversations])

  // Refresh conversations when sidebar is opened
  useEffect(() => {
    if (showConversations && activeInfospace?.id) {
      fetchConversations(activeInfospace.id, false)
    }
  }, [showConversations, activeInfospace?.id, fetchConversations])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // "/" to focus input
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Only if not already focused on an input/textarea
        const activeElement = document.activeElement
        if (activeElement?.tagName !== 'INPUT' && activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault()
          textareaRef.current?.focus()
        }
      }
      
      // "Ctrl+N" or "Cmd+N" for new chat
      if (e.key === 'n' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        handleStartNewChat()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Conversation management handlers
  const handleLoadConversation = async (conversationId: number) => {
    const conversation = await getConversation(conversationId)
    if (conversation) {
      setCurrentConversationId(conversation.id)
      setCurrentConversationTitle(conversation.title)

      // Update model if stored in conversation
      if (conversation.model_name) {
        setSelectedModel(conversation.model_name)
      }
      if (conversation.temperature !== null && conversation.temperature !== undefined) {
        setTemperature(conversation.temperature.toString())
      }

      // Load messages from conversation into the chat
      if (conversation.messages && conversation.messages.length > 0) {
        loadMessages(conversation.messages)
        toast.success(`Loaded conversation: ${conversation.title} (${conversation.messages.length} messages)`)
      } else {
        clearMessages()
        toast.success(`Loaded conversation: ${conversation.title}`)
      }

      setShowConversations(false)
    }
  }

  const handleDeleteConversation = async (conversationId: number) => {
    if (confirm('Are you sure you want to delete this conversation?')) {
      const success = await deleteConversationApi(conversationId)
      if (success && currentConversationId === conversationId) {
        setCurrentConversationId(null)
        setCurrentConversationTitle('')
        clearMessages()
      }
    }
  }

  const handleStartNewChat = () => {
    stop() // Stop any ongoing connections/streams
    setCurrentConversationId(null)
    setCurrentConversationTitle('')
    clearMessages()
    toast.info('New chat started (conversation will be created on first message)')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading || isLoadingModels) return
    if (!selectedModel) {
      toast.error('Please select a model')
      return
    }

    const userInput = input.trim()
    let conversationIdToUse = currentConversationId

    // Auto-create conversation if none exists
    if (!conversationIdToUse) {
      // Use first 30 characters of user message as title
      const autoTitle = userInput.slice(0, 30) + (userInput.length > 30 ? '...' : '')

      const conversation = await createConversation(
        autoTitle,
        undefined,
        selectedModel,
        temperature ? parseFloat(temperature) : undefined
      )

      if (conversation) {
        conversationIdToUse = conversation.id
        setCurrentConversationId(conversation.id)
        setCurrentConversationTitle(conversation.title)
        // Refresh conversation list to show the new conversation
        if (activeInfospace?.id) {
          fetchConversations(activeInfospace.id, false)
        }
      } else {
        toast.error('Failed to create conversation')
        return
      }
    }

    setInput('')

    const tempNum = temperature === '' ? undefined : Number(temperature)
    const response = await sendMessage(userInput, {
      model_name: selectedModel,
      temperature: Number.isFinite(tempNum as number) ? (tempNum as number) : undefined,
      thinking_enabled: thinkingEnabled,
      stream: streamEnabled,
      conversation_id: conversationIdToUse || undefined,
      auto_save: true
    })

    // Refresh conversation list after successful message to update message count
    if (response && activeInfospace?.id && conversationIdToUse) {
      fetchConversations(activeInfospace.id, false)
    }
  }

  const handleModelChange = (modelName: string) => {
    setSelectedModel(modelName)
    // If user selects openai/gpt-5-nano, set streaming off by default
    const m = models.find(mm => mm.name === modelName)
    if (
      m &&
      (
        (m.provider === 'openai' && m.name.toLowerCase().includes('gpt-5-nano')) ||
        m.name.toLowerCase() === 'gpt-5-nano'
      )
    ) {
      setStreamEnabled(false)
    }
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

  // Helper to format a single message for copying (role, content, timestamp)
  const formatMessageForCopy = (message: ChatMessage) => {
    const role = message.role === 'user' ? 'User' : 'Bot'
    const time = message.timestamp?.toLocaleString?.() || ''
    return `[${role} @ ${time}]\n${message.content}\n`
  }

  // Helper to format all messages for copying
  const formatAllMessagesForCopy = (messages: ChatMessage[]) => {
    return messages.map(formatMessageForCopy).join('\n')
  }

  const renderMessage = (message: ChatMessage) => {
    const isUser = message.role === 'user'

    return (
      <div key={message.id} className={cn(
        "flex gap-2 sm:gap-3 p-2 sm:p-4",
        isUser ? "justify-end" : "justify-start"
      )}>
        <div className={cn(
          "flex flex-col sm:flex-row gap-1.5 sm:gap-3 max-w-[95%] sm:max-w-[85%] lg:max-w-[65%]",
          isUser ? "items-end sm:flex-row-reverse" : "items-start sm:flex-row"
        )}>
          <div className={cn(
            "flex h-6 w-6 sm:h-8 sm:w-8 shrink-0 select-none items-center justify-center rounded-full",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          )}>
            {isUser ? <User className="h-3 w-3 sm:h-4 sm:w-4" /> : <Bot className="h-3 w-3 sm:h-4 sm:w-4" />}
          </div>

          <div className={cn(
            "rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm relative group w-full sm:w-auto",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          )}>
            {isUser ? (
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            ) : (
              <AssistantMessageRenderer
                content={message.content}
                messageId={message.id}
                toolExecutions={message.tool_executions}
                thinkingTrace={message.thinking_trace}
                onAssetClick={(assetId) => setSelectedAssetId(assetId)}
                onBundleClick={() => { }}
              />
            )}

            <div className="flex items-center justify-between mt-1 gap-1">
              <div className="text-[10px] sm:text-xs opacity-50">
                {message.timestamp.toLocaleTimeString()}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="ml-1 sm:ml-2 opacity-60 hover:opacity-100 h-6 w-6 sm:h-7 sm:w-7"
                title="Copy message"
                onClick={() => copyToClipboard(message.content, 'Message copied!')}
                tabIndex={-1}
                type="button"
              >
                <Copy className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </Button>
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
    <div className={cn("flex gap-4 min-h-[calc(100vh-4em)] relative", className)}>
      {/* Conversation History Sidebar - Overlay on mobile, side-by-side on desktop */}
      {showConversations && (
        <>
          {/* Mobile backdrop */}
          <div 
            className="fixed inset-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-40 md:hidden"
            onClick={() => setShowConversations(false)}
          />
          
          <Card className="w-[85vw] max-w-sm md:w-80 flex flex-col fixed md:relative inset-y-0 left-0 z-50 md:z-auto md:inset-auto">
            <CardHeader className="flex-none pb-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-teal-500/20 dark:bg-teal-500/20 text-teal-700 dark:text-teal-400">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">Conversations</CardTitle>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      if (activeInfospace?.id) {
                        fetchConversations(activeInfospace.id, false)
                        toast.success('Conversations refreshed')
                      }
                    }}
                    disabled={isLoadingConversations}
                    title="Refresh conversations"
                  >
                    {isLoadingConversations ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setShowConversations(false)}
                    title="Close conversations"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0 w-full">
              <ScrollArea className="h-full px-4 pb-4 pt-4">
                <div className="space-y-2">
                  {conversations.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      No conversations yet
                    </div>
                  ) : (
                    conversations.map((conv) => (
                      <Card
                        key={conv.id}
                        className={cn(
                          "p-2.5 cursor-pointer transition-all duration-200 border ",
                          currentConversationId === conv.id
                            ? "bg-teal-100/50 dark:bg-teal-900/30 border-teal-300 dark:border-teal-600"
                            : "hover:bg-teal-50/50 dark:hover:bg-teal-950/20 border-teal-100 dark:border-teal-800/50",
                          conv.is_pinned && "border-blue-400 dark:border-blue-500/80"
                        )}
                        onClick={() => handleLoadConversation(conv.id)}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              {conv.is_pinned && <Pin className="h-3 w-3 text-teal-600 dark:text-teal-400 shrink-0" />}
                              <h4 className="text-sm font-medium truncate text-gray-900 dark:text-gray-100">{conv.title}</h4>
                            </div>
                            {conv.description && (
                              <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1 mb-1">{conv.description}</p>
                            )}
                            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-500">
                              <span>{conv.message_count || 0} msgs</span>
                              {conv.updated_at && (
                                <>
                                  <span>•</span>
                                  <span>{formatDistanceToNow(new Date(conv.updated_at), { addSuffix: false })}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={(e) => {
                                e.stopPropagation()
                                pinConversation(conv.id)
                              }}
                              title={conv.is_pinned ? "Unpin" : "Pin"}
                            >
                              <Pin className={cn("h-3 w-3", conv.is_pinned && "fill-current text-teal-600 dark:text-teal-400")} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteConversation(conv.id)
                              }}
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}

      {/* Main Chat Card */}
      <Card className="flex flex-col flex-1 w-full shadow-none">
        <CardHeader className="flex-none border-b py-2 sm:py-2.5 px-2 sm:px-3 md:px-4">
          {/* three rows on mobile, two on medium, one row on desktop */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-2 sm:gap-2.5 md:gap-2 lg:gap-3">
            {/* Row 1: Navigation + Title */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                {!showConversations && (
                  <div className="flex items-center gap-1 rounded-md border border-border">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowConversations(true)}
                    className="w-14 sm:w-16 h-8"
                    title="Show conversations"
                  >
                    <MessageSquare className="h-4 w-4" />
                    <History className="h-4 w-4" />
                  </Button>
                  </div>
                )}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleStartNewChat}
                        className="h-8 w-32 sm:w-42"
                      >
                        <Plus className="h-4 w-4" />
                        <div className="text-xs sm:text-sm text-muted-foreground">
                          New Conversation
                          </div>
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>New Chat (Ctrl+N)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Title - shown on mobile/medium, hidden on large when everything is in one row */}
              <div className="min-w-0 flex-1 lg:hidden">
                {currentConversationTitle ? (
                  <div className="text-xs sm:text-sm font-medium truncate">
                    {currentConversationTitle}
                  </div>
                ) : (
                  ""
                )}
              </div>
            </div>

            {/* Row 2 & 3: Model + Toggles + Actions (combined into 1 row on medium+) */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 sm:gap-2.5 md:gap-2 lg:gap-2.5 shrink-0">
              {/* Model Selector */}
              <ProviderModelSelector
                value={selectedModel}
                onChange={handleModelChange}
                className="text-xs sm:text-sm"
                setThinkingEnabled={setThinkingEnabled}
                setStreamEnabled={setStreamEnabled}
              />
              
              {/* Toggles + Actions container */}
              <div className="flex items-center gap-1.5 sm:gap-2 md:gap-1.5 lg:gap-2 shrink-0 overflow-x-auto">
              {/* Compact Toggles */}
              <div className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-md bg-muted/30">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setThinkingEnabled(!thinkingEnabled)}
                        className={cn(
                          "px-2 sm:px-2.5 py-0.5 rounded text-[10px] sm:text-xs font-medium transition-colors whitespace-nowrap",
                          thinkingEnabled 
                            ? "bg-primary text-primary-foreground" 
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        Thinking
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Enable reasoning trace</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setStreamEnabled(!streamEnabled)}
                        className={cn(
                          "px-2 sm:px-2.5 py-0.5 rounded text-[10px] sm:text-xs font-medium transition-colors whitespace-nowrap",
                          streamEnabled 
                            ? "bg-primary text-primary-foreground" 
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        Stream
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Stream responses in real-time</p>
                      Note:
                      Some providers (like OpenAI) chose to only allow streaming for most of their models now
                      if you or your organisation is verified. Once you decide to do that streaming should work for you again.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Action Buttons */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => copyToClipboard(formatAllMessagesForCopy(messages), 'Chat copied!')}
                disabled={messages.length === 0}
                className="h-8 w-8 shrink-0"
                title="Copy chat"
              >
                <Copy className="h-4 w-4" />
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSettings(v => !v)}
                className={cn("h-8 w-8 shrink-0", showSettings && "bg-muted")}
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
              </div>
            </div>
          </div>

          {/* Expandable Settings */}
          {showSettings && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center gap-3">
                <div className="flex-1 max-w-[200px]">
                  <Label htmlFor="temperature" className="text-xs text-muted-foreground mb-1.5 block">
                    Temperature
                  </Label>
                  <Input 
                    id="temperature" 
                    placeholder="default" 
                    value={temperature} 
                    onChange={(e) => setTemperature(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-5">
                  Leave empty to use provider default
                </p>
              </div>
            </div>
          )}
        </CardHeader>

        <CardContent className="flex-1 flex flex-col min-h-0 p-0">
          <ScrollArea className="flex-1 px-2 sm:px-4">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full mt-8 sm:mt-12">
                <div className="text-center px-4">
                  <Bot className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 text-muted-foreground" />
                  <p className="text-sm sm:text-base text-muted-foreground mb-3 sm:mb-4">
                    Start a conversation with your intelligence data
                  </p>
                  <div className="space-y-2 text-xs sm:text-sm text-muted-foreground">
                    <p>Try asking:</p>
                    <ul className="text-left space-y-1">
                      <li>• "What are the main themes in recent documents?"</li>
                      <li>• "Search for assets about climate policy"</li>
                      <li className="hidden sm:list-item">• "Analyze sentiment in the latest articles"</li>
                      <li className="hidden sm:list-item">• "Create a summary report of key findings"</li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {messages.map(renderMessage)}
                {/* Active tool executions */}
                {activeToolExecutions.length > 0 && (
                  <div className="p-2 sm:p-4 border-t border-b bg-muted/20">
                    <ToolExecutionList
                      executions={activeToolExecutions}
                      compact={false}
                      onAssetClick={(assetId) => setSelectedAssetId(assetId)}
                      onBundleClick={() => { }}
                    />
                  </div>
                )}

                {isLoading && (
                  <div className="flex gap-2 sm:gap-3 p-2 sm:p-4">
                    <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 select-none items-center justify-center rounded-full bg-muted">
                      <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </div>
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
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

          <div className="flex-none p-2 sm:p-4 border-t">
            <form ref={formRef} onSubmit={handleSubmit} className="flex gap-1.5 sm:gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your data... (Shift+Enter for newline)"
                disabled={isLoadingModels || !selectedModel}
                className="flex-1 min-h-[80px] sm:min-h-[100px] max-h-[200px] resize-y text-xs sm:text-sm"
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
                aria-label="Send"
                className="h-[50px] w-[50px] sm:h-10 sm:w-10"
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
                  className="ml-0.5 sm:ml-1 text-xs sm:text-sm px-2 sm:px-4"
                >
                  Stop
                </Button>
              )}
            </form>

            {error && (
              <div className="mt-2 text-xs sm:text-sm text-red-500">
                {error}
              </div>
            )}
          </div>
        </CardContent>

        {/* Asset Detail Overlay - View individual assets */}
        <TextSpanHighlightProvider>
          <AssetDetailOverlay
            open={selectedAssetId !== null}
            onClose={() => setSelectedAssetId(null)}
            assetId={selectedAssetId}
            highlightAssetIdOnOpen={null}
          />
        </TextSpanHighlightProvider>
      </Card>
    </div>
  )
}
