'use client'

import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Loader2, Send, Bot, User, Search, FileText, BarChart3, Database,
  History, Pin, Archive, Trash2, MessageSquare, ChevronLeft, ChevronRight, RefreshCw, Copy, X, Settings, PanelLeftClose, PanelLeft, Plus,
  Paperclip, Globe, Square
} from 'lucide-react'
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
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
import { Kbd } from '@/components/ui/kbd'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from '@/components/ui/button-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import AssetSelector, { AssetTreeItem } from '@/components/collection/assets/AssetSelector'
import { AssetRead } from '@/client'
import { useTreeStore } from '@/zustand_stores/storeTree'
import { PersistentTaskTracker } from './PersistentTaskTracker'

interface IntelligenceChatProps {
  className?: string
}

type ContextDepth = 'titles' | 'previews' | 'full'

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Conversation management state
  const [showConversations, setShowConversations] = useState(false)
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null)
  const [currentConversationTitle, setCurrentConversationTitle] = useState<string>('')

  // Asset detail overlay state
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null)
  
  // Message editing state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editedContent, setEditedContent] = useState<string>('')
  
  // Context selection state
  const [showContextSelector, setShowContextSelector] = useState(false)
  const [contextAssets, setContextAssets] = useState<Set<number>>(new Set())
  const [contextDepth, setContextDepth] = useState<ContextDepth>('previews')
  const [contextAssetDetails, setContextAssetDetails] = useState<Map<number, AssetRead>>(new Map())
  const [webSearchHint, setWebSearchHint] = useState(false)
  const [lastInputLength, setLastInputLength] = useState(0)
  
  // Inline compact picker state
  const [showInlinePicker, setShowInlinePicker] = useState(false)
  const [inlinePickerQuery, setInlinePickerQuery] = useState('')
  const [inlinePickerPosition, setInlinePickerPosition] = useState<{ top: number; left: number } | null>(null)
  
  // Bundle detail handler - just show info for now
  const handleBundleClick = (bundleId: number) => {
    toast.info(`Bundle ${bundleId}`, {
      description: 'Bundle detail view available in Asset Manager'
    })
  }

  const { activeInfospace, fetchInfospaces } = useInfospaceStore()

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
    setMessages,
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

  // Load infospace on mount if not already loaded
  useEffect(() => {
    if (!activeInfospace) {
      fetchInfospaces()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC to close inline picker
      if (e.key === 'Escape' && showInlinePicker) {
        e.preventDefault()
        setShowInlinePicker(false)
        setInlinePickerQuery('')
        setInlinePickerPosition(null)
        return
      }
      
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
      
      // "Ctrl+H" or "Cmd+H" to toggle conversations sidebar
      if (e.key === 'h' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setShowConversations(!showConversations)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showConversations, showInlinePicker]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // Clear context too
    setContextAssets(new Set())
    setContextAssetDetails(new Map())
    setWebSearchHint(false)
    setEditingMessageId(null)
    setEditedContent('')
    toast.info('New chat started (conversation will be created on first message)')
  }

  // Message editing and branching
  const handleStartEditMessage = (messageId: string, currentContent: string) => {
    setEditingMessageId(messageId)
    setEditedContent(currentContent)
  }

  const handleCancelEdit = () => {
    setEditingMessageId(null)
    setEditedContent('')
  }

  const handleSaveEdit = async () => {
    if (!editedContent.trim() || !editingMessageId) return

    // Find the index of the message being edited
    const messageIndex = messages.findIndex(m => m.id === editingMessageId)
    if (messageIndex === -1) {
      toast.error('Message not found')
      return
    }

    const editedMessage = messages[messageIndex]
    
    // Only allow editing user messages
    if (editedMessage.role !== 'user') {
      toast.error('Can only edit user messages')
      return
    }

    // Create a branch: keep messages up to (but not including) this one
    const messagesBeforeEdit = messages.slice(0, messageIndex)
    
    // Update the conversation with the branch point
    setMessages(messagesBeforeEdit)
    setEditingMessageId(null)
    setEditedContent('')
    
    toast.info('Creating new branch from edited message...')

    // Resend the edited message (this will create a new conversation path)
    await handleSubmit({ text: editedContent })
  }

  // Handle adding assets to context from selector
  const handleContextSelectionChange = (selectedIds: Set<string>) => {
    const assetIds = new Set<number>()
    selectedIds.forEach(id => {
      if (id.startsWith('asset-')) {
        const numId = parseInt(id.replace('asset-', ''))
        if (!isNaN(numId)) assetIds.add(numId)
      }
    })
    setContextAssets(assetIds)
  }

  // Fetch full asset details when context is confirmed
  const handleConfirmContext = async () => {
    if (contextAssets.size === 0) {
      setShowContextSelector(false)
      return
    }

    try {
      // Use the tree store to get full asset data
      const { getFullAsset } = useTreeStore.getState()
      const assetDetailsMap = new Map<number, AssetRead>()
      
      for (const assetId of contextAssets) {
        const fullAsset = await getFullAsset(assetId)
        if (fullAsset) {
          assetDetailsMap.set(assetId, fullAsset)
        }
      }
      
      setContextAssetDetails(assetDetailsMap)
      setShowContextSelector(false)
      toast.success(`Added ${assetDetailsMap.size} asset(s) to context (${contextDepth} depth)`)
    } catch (error) {
      console.error('Failed to fetch asset details:', error)
      toast.error('Failed to load asset details')
    }
  }

  // Calculate cursor position in textarea for positioning popover
  const getCaretCoordinates = (element: HTMLTextAreaElement, position: number) => {
    // Create a mirror div to calculate caret position
    const div = document.createElement('div')
    const style = getComputedStyle(element)
    const properties = [
      'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
      'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign',
      'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing'
    ]
    
    properties.forEach(prop => {
      div.style[prop as any] = style[prop as any]
    })
    
    div.style.position = 'absolute'
    div.style.visibility = 'hidden'
    div.style.whiteSpace = 'pre-wrap'
    div.style.wordWrap = 'break-word'
    
    document.body.appendChild(div)
    
    const textBeforeCaret = element.value.substring(0, position)
    div.textContent = textBeforeCaret
    
    const span = document.createElement('span')
    span.textContent = element.value.substring(position) || '.'
    div.appendChild(span)
    
    const coordinates = {
      top: span.offsetTop,
      left: span.offsetLeft
    }
    
    document.body.removeChild(div)
    return coordinates
  }

  // Handle input change and detect "@" for inline tagging
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const oldValue = input
    setInput(newValue)
    
    // Detect if user is deleting (backspacing)
    const isDeleting = newValue.length < oldValue.length
    
    // If deleting and picker is open, just close it and let deletion happen naturally
    if (isDeleting && showInlinePicker) {
      setShowInlinePicker(false)
      setInlinePickerQuery('')
      setInlinePickerPosition(null)
      setLastInputLength(newValue.length)
      
      // Check if any mentions were removed and clean up context
      const allKnownAssets = Array.from(fullAssetsCache.values())
        .concat(Array.from(contextAssetDetails.values()))
      const oldMentions = extractMentions(oldValue, allKnownAssets)
      const newMentions = extractMentions(newValue, allKnownAssets)
      const removedMentions = oldMentions.filter(m => !newMentions.includes(m))
      
      if (removedMentions.length > 0) {
        // Remove assets from context that are no longer mentioned
        removedMentions.forEach(mentionTitle => {
          const asset = Array.from(contextAssetDetails.values()).find(
            a => a.title?.toLowerCase() === mentionTitle.toLowerCase()
          )
          if (asset) {
            handleRemoveContextAsset(asset.id)
          }
        })
      }
      return
    }
    
    // Don't open picker if we're deleting
    if (isDeleting) {
      setLastInputLength(newValue.length)
      return
    }
    
    // Detect if we're in the middle of typing an @mention (only when adding text)
    const cursorPos = e.target.selectionStart
    const textBeforeCursor = newValue.slice(0, cursorPos)
    
    // Find the last @ before cursor that's not part of a completed mention
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
      
      // Check if there's a space after the @ (which would mean it's a completed mention)
      if (!textAfterAt.includes(' ') && textAfterAt.length >= 0) {
        // Calculate position for popover
        const textarea = e.target
        const rect = textarea.getBoundingClientRect()
        const caretCoords = getCaretCoordinates(textarea, cursorPos)
        
        setInlinePickerPosition({
          top: rect.top + caretCoords.top + window.scrollY,
          left: rect.left + caretCoords.left + window.scrollX
        })
        setShowInlinePicker(true)
        setInlinePickerQuery(textAfterAt)
      } else {
        setShowInlinePicker(false)
        setInlinePickerQuery('')
        setInlinePickerPosition(null)
      }
    } else {
      setShowInlinePicker(false)
      setInlinePickerQuery('')
      setInlinePickerPosition(null)
    }
    
    setLastInputLength(newValue.length)
  }
  
  // Get assets from tree store for mention detection
  const { fullAssetsCache } = useTreeStore()
  
  // Helper to extract @mentions from text - handles multi-word asset titles
  const extractMentions = React.useCallback((text: string, knownAssets: AssetRead[]): string[] => {
    if (!text.includes('@')) return []
    
    const mentions: string[] = []
    const allAssetTitles = knownAssets
      .map(asset => asset.title || '')
      .filter(title => title.length > 0)
      // Sort by length descending to match longest first (prevents "Berlin" matching before "Berlin Queer Centers")
      .sort((a, b) => b.length - a.length)
    
    // Find all @ positions
    let searchIndex = 0
    while (searchIndex < text.length) {
      const atIndex = text.indexOf('@', searchIndex)
      if (atIndex === -1) break
      
      // Try to match against known asset titles
      let matched = false
      for (const title of allAssetTitles) {
        const potentialMention = text.slice(atIndex + 1, atIndex + 1 + title.length)
        if (potentialMention.toLowerCase() === title.toLowerCase()) {
          mentions.push(title)
          searchIndex = atIndex + 1 + title.length
          matched = true
          break
        }
      }
      
      // If no match, skip this @ and continue
      if (!matched) {
        searchIndex = atIndex + 1
      }
    }
    
    return mentions
  }, [])
  
  // Parse @mentions from input text
  const parsedMentions = React.useMemo(() => {
    const allKnownAssets = Array.from(fullAssetsCache.values())
      .concat(Array.from(contextAssetDetails.values()))
    return extractMentions(input, allKnownAssets)
  }, [input, fullAssetsCache, contextAssetDetails, extractMentions])
  
  // Get assets that are mentioned inline - we'll resolve these at submission time
  const mentionedAssets = React.useMemo(() => {
    // For now, just return cached assets that match mentions
    if (parsedMentions.length === 0) return []
    
    return parsedMentions
      .map(mention => {
        // Try to find in cache
        const cached = Array.from(fullAssetsCache.values()).find(asset =>
          asset.title?.toLowerCase() === mention.toLowerCase()
        )
        return cached
      })
      .filter((asset): asset is AssetRead => asset !== undefined)
  }, [parsedMentions, fullAssetsCache])
  
  // Handle selecting an asset from inline picker
  const handleInlinePickerSelect = async (assetId: number) => {
    try {
      const { getFullAsset } = useTreeStore.getState()
      const fullAsset = await getFullAsset(assetId)
      
      if (fullAsset) {
        // Add to context assets immediately
        const newDetails = new Map(contextAssetDetails)
        newDetails.set(assetId, fullAsset)
        setContextAssetDetails(newDetails)
        
        const newAssets = new Set(contextAssets)
        newAssets.add(assetId)
        setContextAssets(newAssets)
        
        // Replace the current @query with the full @AssetTitle
        const cursorPos = textareaRef.current?.selectionStart || 0
        const textBeforeCursor = input.slice(0, cursorPos)
        const lastAtIndex = textBeforeCursor.lastIndexOf('@')
        
        if (lastAtIndex !== -1) {
          const beforeAt = input.slice(0, lastAtIndex)
          const afterCursor = input.slice(cursorPos)
          const mentionText = `@${fullAsset.title} `
          
          const newInput = beforeAt + mentionText + afterCursor
          setInput(newInput)
          
          // Set cursor position after the mention
          setTimeout(() => {
            if (textareaRef.current) {
              const newCursorPos = lastAtIndex + mentionText.length
              textareaRef.current.selectionStart = newCursorPos
              textareaRef.current.selectionEnd = newCursorPos
              textareaRef.current.focus()
            }
          }, 0)
        }
      }
    } catch (error) {
      console.error('Failed to add asset:', error)
      toast.error('Failed to add asset to context')
    }
    
    // Close picker
    setShowInlinePicker(false)
    setInlinePickerQuery('')
    setInlinePickerPosition(null)
  }

  // Clear context
  const handleClearContext = () => {
    setContextAssets(new Set())
    setContextAssetDetails(new Map())
    toast.success('Context cleared')
  }

  // Remove single asset from context
  const handleRemoveContextAsset = (assetId: number) => {
    const newAssets = new Set(contextAssets)
    newAssets.delete(assetId)
    setContextAssets(newAssets)
    
    const newDetails = new Map(contextAssetDetails)
    newDetails.delete(assetId)
    setContextAssetDetails(newDetails)
  }

  // Format context using Anthropic's best practices
  // Documents at top, query at bottom = 30% better performance
  const formatContextForMessage = (userMessage: string, assetsToInclude?: Map<number, AssetRead>): string => {
    const contextToUse = assetsToInclude || contextAssetDetails
    
    if (contextToUse.size === 0 && !webSearchHint) {
      return userMessage
    }

    let formattedMessage = ''

    // PART 1: Documents at the very top (Anthropic best practice)
    if (contextToUse.size > 0) {
      formattedMessage += '<documents>\n'
      
      Array.from(contextToUse.values()).forEach((asset, index) => {
        formattedMessage += `<document index="${index + 1}">\n`
        formattedMessage += `<source>${asset.title || `Asset ${asset.id}`}</source>\n`
        
        // Add metadata for context
        if (asset.kind) {
          formattedMessage += `<document_type>${asset.kind}</document_type>\n`
        }
        if (asset.created_at) {
          formattedMessage += `<created_at>${new Date(asset.created_at).toLocaleDateString()}</created_at>\n`
        }
        
        formattedMessage += `<document_content>\n`
        
        // Include content based on depth setting
        if (contextDepth === 'titles') {
          // Minimal - just title and type
          formattedMessage += `Title: ${asset.title}\n`
          if (asset.kind) formattedMessage += `Type: ${asset.kind}\n`
          if (asset.source_metadata && typeof asset.source_metadata === 'object') {
            // Add key metadata for CSVs (columns, row count)
            if (asset.kind === 'csv' && 
                'columns' in asset.source_metadata && 
                Array.isArray(asset.source_metadata.columns)) {
              formattedMessage += `Columns: ${asset.source_metadata.columns.join(', ')}\n`
              if ('row_count' in asset.source_metadata && typeof asset.source_metadata.row_count === 'number') {
                formattedMessage += `Rows: ${asset.source_metadata.row_count}\n`
              }
            }
          }
        } else if (contextDepth === 'previews') {
          // Smart preview - 500 chars or structured preview
          if (asset.kind === 'csv' && asset.source_metadata && 
              typeof asset.source_metadata === 'object' && 
              'columns' in asset.source_metadata && 
              Array.isArray(asset.source_metadata.columns)) {
            // For CSVs, show structure
            formattedMessage += `CSV with ${asset.source_metadata.columns.length} columns: ${asset.source_metadata.columns.join(', ')}\n`
            if ('row_count' in asset.source_metadata && typeof asset.source_metadata.row_count === 'number') {
              formattedMessage += `Total rows: ${asset.source_metadata.row_count}\n`
            }
            // Add first few rows if available in text_content
            if (asset.text_content) {
              const preview = asset.text_content.slice(0, 500)
              formattedMessage += `\nPreview:\n${preview}${asset.text_content.length > 500 ? '...' : ''}\n`
            }
          } else {
            // For text documents, show excerpt
            const preview = asset.text_content?.slice(0, 500) || ''
            formattedMessage += asset.text_content 
              ? preview + (asset.text_content.length > 500 ? '...' : '') 
              : 'No content available'
            formattedMessage += '\n'
          }
        } else {
          // Full content (can be expensive!)
          formattedMessage += asset.text_content || 'No content available'
          formattedMessage += '\n'
        }
        
        formattedMessage += `</document_content>\n`
        formattedMessage += `</document>\n`
      })
      
      formattedMessage += '</documents>\n\n'
    }

    // PART 2: Instructions (if web search enabled)
    if (webSearchHint) {
      formattedMessage += '<instruction>\n'
      formattedMessage += 'Start by searching the web for current information on this topic.\n'
      formattedMessage += 'Then provide your answer based on the search results combined with any provided context documents.\n'
      formattedMessage += '</instruction>\n\n'
    }

    // PART 3: User query at the end (Anthropic: 30% better performance)
    formattedMessage += userMessage

    return formattedMessage
  }

  const handleSubmit = async (message: PromptInputMessage) => {
    const userInput = message.text?.trim()
    if (!userInput || isLoading || isLoadingModels) return
    if (!selectedModel) {
      toast.error('Please select a model')
      return
    }

    // Clear input field immediately after validation
    setInput('')

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

    // Merge mentioned assets with explicitly attached context
    const allContextAssets = new Map(contextAssetDetails)
    for (const mentionedAsset of mentionedAssets) {
      if (!allContextAssets.has(mentionedAsset.id)) {
        allContextAssets.set(mentionedAsset.id, mentionedAsset)
      }
    }

    // Format message with context for API, but display original in UI
    const messageWithContext = formatContextForMessage(userInput, allContextAssets)
    
    // Capture context metadata for this message (including mentions)
    const contextMetadata = allContextAssets.size > 0 
      ? Array.from(allContextAssets.values()).map(asset => ({
          id: asset.id,
          title: asset.title,
          kind: asset.kind
        }))
      : undefined
    
    // Clear web search hint after use (but keep context for manual management)
    if (webSearchHint) {
      setWebSearchHint(false)
    }

    const tempNum = temperature === '' ? undefined : Number(temperature)
    const response = await sendMessage(messageWithContext, {
      model_name: selectedModel,
      temperature: Number.isFinite(tempNum as number) ? (tempNum as number) : undefined,
      thinking_enabled: thinkingEnabled,
      stream: streamEnabled,
      conversation_id: conversationIdToUse || undefined,
      auto_save: true,
      displayContent: userInput,  // Display original user input, not formatted
      contextAssets: contextMetadata,  // Track which files were attached
      contextDepth: contextDepth  // Track depth level used
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
    const isEditing = editingMessageId === message.id

    return (
      <div key={message.id} className={cn(
        "flex gap-2 sm:gap-3 p-2 sm:p-4",
        isUser ? "justify-end" : "justify-start"
      )}>
        <div className={cn(
          "flex flex-col sm:flex-row gap-1.5 sm:gap-3 max-w-[98%] sm:max-w-[75%] lg:max-w-[65%]",
          isUser ? "items-end sm:flex-row-reverse" : "items-start sm:flex-row"
        )}>
          <div className={cn(
            "flex h-6 w-6 sm:h-8 sm:w-8 shrink-0 select-none items-center justify-center rounded-full",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          )}>
            {isUser ? <User className="h-3 w-3 sm:h-4 sm:w-4" /> : <Bot className="h-3 w-3 sm:h-4 sm:w-4" />}
          </div>

          <div className={cn(
            "rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm relative group w-full",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          )}>
            {isEditing ? (
              // Edit mode for user messages
              <div className="space-y-2">
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="w-full min-h-[80px] p-2 text-sm bg-background text-foreground border border-border rounded resize-y"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      handleSaveEdit()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      handleCancelEdit()
                    }
                  }}
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelEdit}
                    className="h-7 text-xs"
                  >
                    Cancel (Esc)
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleSaveEdit}
                    className="h-7 text-xs"
                  >
                    Save & Branch (Ctrl+Enter)
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {isUser ? (
                  <div className="space-y-2">
                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                    {/* Show attached context documents */}
                    {message.context_assets && message.context_assets.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-2 border-t border-primary-foreground/20">
                        <Paperclip className="h-3 w-3 opacity-60 shrink-0 mt-0.5" />
                        <div className="flex flex-wrap gap-1 text-[10px] opacity-70">
                          {message.context_assets.map((asset, idx) => (
                            <span key={asset.id}>
                              {asset.title}
                              {asset.kind && ` (${asset.kind})`}
                              {idx < message.context_assets!.length - 1 && ', '}
                            </span>
                          ))}
                          {message.context_depth && (
                            <span className="opacity-50 ml-1">• {message.context_depth}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <AssistantMessageRenderer
                    content={message.content}
                    messageId={message.id}
                    toolExecutions={message.tool_executions}
                    thinkingTrace={message.thinking_trace}
                    onAssetClick={(assetId) => setSelectedAssetId(assetId)}
                    onBundleClick={handleBundleClick}
                  />
                )}

                <div className="flex items-center justify-between mt-1 gap-1">
                  <div className="text-[10px] sm:text-xs opacity-50">
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-60 hover:opacity-100 h-6 w-6 sm:h-7 sm:w-7"
                      title="Copy message"
                      onClick={() => copyToClipboard(message.content, 'Message copied!')}
                      tabIndex={-1}
                      type="button"
                    >
                      <Copy className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    </Button>
                    {isUser && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-60 hover:opacity-100 h-6 w-6 sm:h-7 sm:w-7"
                        title="Edit message and create branch"
                        onClick={() => handleStartEditMessage(message.id, message.content)}
                        tabIndex={-1}
                        type="button"
                      >
                        <RefreshCw className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!activeInfospace) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center min-h-0">
          <div className="text-center">
            <Bot className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Please select an infospace to start chatting</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className={cn("flex gap-4 flex-1 min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] overflow-hidden", className)}>
      {/* Conversation History Sidebar - Overlay on mobile, side-by-side on desktop */}
      <AnimatePresence mode="wait">
        {showConversations && (
          <>
            {/* Mobile backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-40 md:hidden"
              onClick={() => setShowConversations(false)}
            />
            
            <motion.div
              initial={{ x: '-100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-100%', opacity: 0 }}
              transition={{ 
                type: 'spring', 
                stiffness: 300, 
                damping: 30,
                mass: 0.8 
              }}
              className="w-[85vw] max-w-sm md:w-80 flex flex-col fixed md:relative inset-y-0 left-0 z-50 md:z-auto md:inset-auto"
            >
              <Card className="w-full h-full flex flex-col">
            <CardHeader className="flex-none pb-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-teal-500/20 dark:bg-teal-500/20 text-teal-700 dark:text-teal-400">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">Conversations</CardTitle>
                </div>
                <ButtonGroup>
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
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setShowConversations(false)}
                    title="Close conversations"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </ButtonGroup>
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
                      <div
                        key={conv.id}
                        className={cn(
                          "group p-3 rounded-lg cursor-pointer transition-all duration-200 border",
                          currentConversationId === conv.id
                            ? "bg-teal-100/50 dark:bg-teal-900/30 border-teal-300 dark:border-teal-600"
                            : "hover:bg-teal-50/50 dark:hover:bg-teal-950/20 border-teal-100 dark:border-teal-800/50",
                          conv.is_pinned && "border-xs border-blue-400 dark:border-blue-500/80"
                        )}
                        onClick={() => handleLoadConversation(conv.id)}
                      >
                        {/* Title row with actions */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-start gap-1.5 flex-1 min-w-0">
                            {conv.is_pinned && <Pin className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />}
                            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug break-words">
                              {conv.title}
                            </h4>
                          </div>
                          <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
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
                              className="h-6 w-6"
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
                        
                        {/* Description if present */}
                        {conv.description && (
                          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1.5 line-clamp-2 leading-relaxed">
                            {conv.description}
                          </p>
                        )}
                        
                        {/* Metadata row */}
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-500">
                          <span className="shrink-0">{conv.message_count || 0} msgs</span>
                          {conv.updated_at && (
                            <>
                              <span className="shrink-0">•</span>
                              <span className="truncate">{formatDistanceToNow(new Date(conv.updated_at), { addSuffix: false })}</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Chat Card */}
      <Card variant="no-border" className="flex flex-col flex-1 w-full shadow-none">
        <CardHeader className="flex-none border-b py-2 sm:py-2.5 px-2 sm:px-3 md:px-4">
          {/* three rows on mobile, two on medium, one row on desktop */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-2 sm:gap-2.5 md:gap-2 lg:gap-3">
            {/* Row 1: Navigation + Title */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
              {!showConversations && (
                <ButtonGroup>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowConversations(true)}
                          className="h-8 px-3 gap-1.5"
                          title="Show conversations"
                        >
                          <History className="h-4 w-4" />
                          <span className="hidden sm:inline text-xs">History</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex items-center gap-1.5">
                          <span>Conversations</span>
                          <Kbd>Ctrl+H</Kbd>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleStartNewChat}
                          className="h-8 px-3 gap-1.5"
                        >
                          <Plus className="h-4 w-4" />
                          <span className="hidden sm:inline text-xs">New</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex items-center gap-1.5">
                          <span>New Chat</span>
                          <Kbd>Ctrl+N</Kbd>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </ButtonGroup>
              )}

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
          <Conversation className="flex-1">
            <ConversationContent className="px-2 sm:px-4">
              {/* Task Tracker - Sticky at top of conversation */}
              <PersistentTaskTracker messages={messages} />
              
              {messages.length === 0 ? (
                <ConversationEmptyState
                  icon={<Bot className="h-10 w-10 sm:h-12 sm:w-12" />}
                  title="Start a conversation with your intelligence data"
                  description="Try asking about your documents, searching for assets, or analyzing content"
                >
                  <div className="mt-4 space-y-3 text-xs sm:text-sm text-muted-foreground">
                    <div>
                      <p className="mb-1 font-medium">Try asking:</p>
                      <ul className="text-left space-y-1">
                        <li>• "What are the main themes in recent documents?"</li>
                        <li>• "Search for assets about climate policy"</li>
                        <li className="hidden sm:list-item">• "Analyze sentiment in the latest articles"</li>
                        <li className="hidden sm:list-item">• "Create a summary report of key findings"</li>
                      </ul>
                    </div>
                    <div className="pt-2 border-t border-border/50">
                      <p className="mb-2 font-medium">Keyboard shortcuts:</p>
                      <div className="flex flex-col gap-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <Kbd>@</Kbd>
                          <span>Add context assets</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Kbd>/</Kbd>
                          <span>Focus input</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Kbd>Ctrl+N</Kbd>
                          <span>New chat</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Kbd>Ctrl+H</Kbd>
                          <span>Toggle history</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </ConversationEmptyState>
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
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="flex-none p-2 sm:p-4 border-t">
            {/* Context chips - assets attached to message */}
            {contextAssetDetails.size > 0 && (
              <div className="mb-2 p-2.5 rounded-lg bg-accent/80 border border-border backdrop-blur-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {Array.from(contextAssetDetails.values()).map(asset => (
                    <Badge
                      key={asset.id}
                      variant="secondary"
                      className="gap-1.5 pr-1 bg-foreground/10 hover:bg-accent/50 border border-border/60 transition-colors"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      <span className="max-w-[150px] truncate text-xs text-foreground">{asset.title}</span>
                      {asset.kind && (
                        <span className="text-[10px] text-muted-foreground">({asset.kind})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveContextAsset(asset.id)}
                        className="hover:bg-destructive/20 hover:text-destructive rounded-full p-0.5 transition-all ml-0.5"
                        title="Remove from context"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearContext}
                    className="h-6 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    Clear all
                  </Button>
                </div>
              </div>
            )}

            {/* Compact Inline Asset Picker (triggered by @) - Positioned at cursor */}
            {showInlinePicker && inlinePickerPosition && (
              <>
                {/* Backdrop to close picker */}
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => {
                    setShowInlinePicker(false)
                    setInlinePickerQuery('')
                    setInlinePickerPosition(null)
                  }}
                />
                {/* Picker positioned at cursor */}
                <div
                  className="fixed z-50 w-[90vw] sm:w-[80vw] md:w-[70vw] lg:w-[55vw] h-[30vh] sm:h-[20vh] bg-popover border border-border rounded-md shadow overflow-hidden text-left"
                  style={{
                    top: `${inlinePickerPosition.top - 210}px`, // Position above the cursor
                    left: `${Math.min(inlinePickerPosition.left, window.innerWidth - 450)}px`, // Keep within viewport
                  }}
                >
                  <AssetSelector
                    selectedItems={new Set()}
                    onSelectionChange={(selectedIds) => {
                      // Clicking checkbox selects the item
                      const assetIds = Array.from(selectedIds)
                        .filter(id => id.startsWith('asset-'))
                        .map(id => parseInt(id.replace('asset-', '')))
                      
                      if (assetIds.length > 0) {
                        handleInlinePickerSelect(assetIds[assetIds.length - 1])
                      }
                    }}
                    onItemDoubleClick={(item) => {
                      // Double-click or Enter key selects the item
                      if (item.type === 'asset' && item.asset) {
                        handleInlinePickerSelect(item.asset.id)
                      }
                    }}
                    renderItemActions={() => null}
                    initialSearchTerm={inlinePickerQuery}
                    autoFocusSearch={true}
                    compact={true}
                  />
                </div>
              </>
            )}

            {/* New PromptInput Component with Context Selector */}
            <Popover open={showContextSelector} onOpenChange={setShowContextSelector}>
              <PromptInput onSubmit={handleSubmit}>
                <PromptInputBody className="text-left">
                  <div className="relative w-full">
                    {/* Keyboard shortcuts hint - desktop only */}
                    <div className="hidden sm:flex absolute top-2 right-2 items-center gap-2 mr-1 text-xs text-muted-foreground pointer-events-none z-10">
                      <div className="flex items-center gap-1">
                        <Kbd>@</Kbd>
                        <span className="text-[10px]">context</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Kbd>/</Kbd>
                        <span className="text-[10px]">focus</span>
                      </div>
                    </div>
                    
                    {/* Simple highlight layer for @mentions - positioned behind textarea */}
                    <div 
                      className="absolute inset-0 pointer-events-none whitespace-pre-wrap break-words overflow-hidden text-transparent"
                      style={{
                        paddingLeft: '0.7rem',  // px-3
                        paddingRight: '0.7rem', // px-3
                        paddingTop: '0.75rem',   // py-3 
                        paddingBottom: '0.75rem', // py-3
                        lineHeight: '1.5rem',
                        fontSize: '0.875rem',  // text-sm
                        fontFamily: 'inherit',
                        wordBreak: 'break-word',
                        zIndex: 0,
                      }}
                      aria-hidden="true"
                    >
                      {(() => {
                        // Smart highlighting that handles multi-word mentions
                        const parts: React.ReactNode[] = []
                        const allAssetTitles = Array.from(contextAssetDetails.values())
                          .map(asset => asset.title || '')
                          .filter(title => title.length > 0)
                          // Sort by length descending to match longest first
                          .sort((a, b) => b.length - a.length)
                        
                        let currentIndex = 0
                        let partKey = 0
                        
                        while (currentIndex < input.length) {
                          const atIndex = input.indexOf('@', currentIndex)
                          
                          if (atIndex === -1) {
                            // No more @, add remaining text
                            parts.push(<span key={partKey++}>{input.slice(currentIndex)}</span>)
                            break
                          }
                          
                          // Add text before @
                          if (atIndex > currentIndex) {
                            parts.push(<span key={partKey++}>{input.slice(currentIndex, atIndex)}</span>)
                          }
                          
                          // Try to match against known asset titles
                          let matched = false
                          for (const title of allAssetTitles) {
                            const potentialMention = input.slice(atIndex + 1, atIndex + 1 + title.length)
                            if (potentialMention.toLowerCase() === title.toLowerCase()) {
                              // Found a match - highlight it
                              parts.push(
                                <span 
                                  key={partKey++}
                                  className="bg-blue-100 dark:bg-blue-900/40 rounded-md px-1 py-0.5"
                                >
                                  @{potentialMention}
                                </span>
                              )
                              currentIndex = atIndex + 1 + title.length
                              matched = true
                              break
                            }
                          }
                          
                          // If no match, just add the @ and continue
                          if (!matched) {
                            parts.push(<span key={partKey++}>@</span>)
                            currentIndex = atIndex + 1
                          }
                        }
                        
                        return parts
                      })()}
                    </div>
                    
                    <PromptInputTextarea
                      ref={textareaRef}
                      value={input}
                      onChange={handleInputChange}
                      placeholder="Ask about your data..."
                      disabled={isLoadingModels || !selectedModel}
                      className="relative bg-transparent text-left w-full"
                      style={{ zIndex: 1 }}
                    />
                  </div>
                    {/* Keyboard shortcuts hint */}
                    <div className="hidden sm:flex absolute top-2 right-2 sm:flex items-center gap-2 mr-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Kbd>@</Kbd>
                        <span className="text-[10px]">context</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Kbd>/</Kbd>
                        <span className="text-[10px]">focus</span>
                      </div>
                    </div>
                </PromptInputBody>
                <PromptInputToolbar>
                  <PromptInputTools>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <PopoverTrigger asChild>
                            <PromptInputButton>
                              <Paperclip className="size-4" />
                            </PromptInputButton>
                          </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="flex items-center gap-1.5">
                            <span>Add assets as context or type</span>
                            <Kbd>@</Kbd>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <PromptInputButton
                            variant={webSearchHint ? "default" : "ghost"}
                            onClick={() => setWebSearchHint(!webSearchHint)}
                          >
                            <Globe className="size-4" />
                          </PromptInputButton>
                        </TooltipTrigger>
                        <TooltipContent>
                          {webSearchHint ? 'Will request web search' : 'Request web search'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </PromptInputTools>
                  
                  {isLoading ? (
                    <PromptInputButton
                      variant="destructive"
                      onClick={stop}
                    >
                      <Square className="size-5" />
                    </PromptInputButton>
                  ) : (
                    <PromptInputSubmit
                      disabled={!input.trim() || isLoadingModels || !selectedModel}
                      status={isLoading ? 'streaming' : 'ready'}
                    />
                  )}
                </PromptInputToolbar>
              </PromptInput>

              {/* Context Selector Popover Content */}
              <PopoverContent 
                className="w-[90vw] md:w-[60vw] lg:w-[45vw] h-[60vh] md:h-[50vh] p-0 flex flex-col" 
                align="start"
                side="top"
              >
                <div 
                  className="px-4 py-3 border-b cursor-pointer hover:bg-muted/70 transition-colors"
                  onClick={() => setShowContextSelector(false)}
                  title="Click to close"
                >
                  <h4 className="font-semibold text-sm mb-1">Add Assets as Context</h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Select assets to include as context. Documents structured for optimal analysis.
                  </p>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Label htmlFor="depth-select" className="text-xs">Detail:</Label>
                    <Select value={contextDepth} onValueChange={(v) => setContextDepth(v as ContextDepth)}>
                      <SelectTrigger id="depth-select" className="h-8 text-xs w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="titles">Titles (Light)</SelectItem>
                        <SelectItem value="previews">Previews</SelectItem>
                        <SelectItem value="full">Full Content</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden">
                  <AssetSelector
                    selectedItems={new Set(Array.from(contextAssets).map(id => `asset-${id}`))}
                    onSelectionChange={handleContextSelectionChange}
                    renderItemActions={() => null}
                  />
                </div>
                <div className="px-4 py-3 border-t flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowContextSelector(false)
                      // Reset to current context (don't clear existing context)
                      setContextAssets(new Set(contextAssetDetails.keys()))
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleConfirmContext}>
                    Add {contextAssets.size} asset{contextAssets.size !== 1 ? 's' : ''}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

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
