'use client'

import { useEffect, useMemo, useState } from 'react'
import { IntelligenceChatService } from '@/client'
import { ModelInfo } from '@/client'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { Loader2 } from 'lucide-react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../ui/select'

interface ProviderModelSelectorProps {
  value?: string
  onChange: (modelName: string) => void
  className?: string
  setThinkingEnabled?: (enabled: boolean) => void
  setStreamEnabled?: (enabled: boolean) => void
}

export default function ProviderModelSelector({
  value,
  onChange,
  className,
  setThinkingEnabled,
  setStreamEnabled,
}: ProviderModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [selectedModel, setSelectedModel] = useState<string>(value || '')
  const { activeInfospace } = useInfospaceStore()

  // Helper: Find the best default model (anthropic/claude-sonnet-4-5)
  function getAnthropicClaudeSonnet45(models: ModelInfo[]) {
    return models.find(
      m =>
        m.provider?.toLowerCase() === 'anthropic' &&
        m.name?.toLowerCase().includes('claude-sonnet-4-5')
    )
  }

  useEffect(() => {
    async function fetchModels() {
      if (!activeInfospace?.id) return
      setIsLoading(true)
      setError(null)
      try {
        const response = await IntelligenceChatService.listAvailableModels({ capability: undefined })
        const fetched = response.models || []
        setModels(fetched)
        // Initialize provider/model from current value if present
        if (value) {
          const match = fetched.find(m => m.name === value)
          if (match) setSelectedProvider(match.provider)
        } else if (fetched.length > 0) {
          // Prefer anthropic/claude-sonnet-4-5 if present
          const anthropicModel = getAnthropicClaudeSonnet45(fetched)
          if (anthropicModel) {
            setSelectedProvider(anthropicModel.provider)
            setSelectedModel(anthropicModel.name)
            onChange(anthropicModel.name)
            // Turn on thinking and streaming if possible
            setThinkingEnabled?.(true)
            setStreamEnabled?.(true)
          } else {
            // Fallback: OpenAI gpt-5, then tool-support, then first
            const openaiModel = fetched.find(m => m.provider === 'openai' && m.name.startsWith('gpt-5'))
            if (openaiModel) {
              setSelectedProvider('openai')
              setSelectedModel(openaiModel.name)
              onChange(openaiModel.name)
              setThinkingEnabled?.(true)
              setStreamEnabled?.(true)
            } else {
              const toolModel = fetched.find(m => m.supports_tools)
              if (toolModel) {
                setSelectedProvider(toolModel.provider)
                setSelectedModel(toolModel.name)
                onChange(toolModel.name)
                setThinkingEnabled?.(true)
                setStreamEnabled?.(true)
              } else {
                setSelectedProvider(fetched[0].provider)
                setSelectedModel(fetched[0].name)
                onChange(fetched[0].name)
                setThinkingEnabled?.(true)
                setStreamEnabled?.(true)
              }
            }
          }
        }
      } catch (err: any) {
        console.error('Failed to load models:', err)
        setError('Failed to load models')
      } finally {
        setIsLoading(false)
      }
    }
    fetchModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInfospace?.id])

  useEffect(() => {
    setSelectedModel(value || '')
  }, [value])

  const providers = useMemo(() => {
    const set = new Set(models.map(m => m.provider))
    return Array.from(set)
  }, [models])

  const providerModels = useMemo(() => {
    return models.filter(m => m.provider === selectedProvider)
  }, [models, selectedProvider])

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider)
    // Reset model on provider change
    const first =
      models.find(m => m.provider === provider && m.supports_tools) ||
      models.find(m => m.provider === provider)
    const nextModel = first?.name || ''
    setSelectedModel(nextModel)
    if (nextModel) {
      onChange(nextModel)
      setThinkingEnabled?.(true)
      setStreamEnabled?.(true)
    }
  }

  const handleModelChange = (modelName: string) => {
    setSelectedModel(modelName)
    onChange(modelName)
    setThinkingEnabled?.(true)
    setStreamEnabled?.(true)
  }

  if (isLoading) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading models...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={className}>
        <div className="text-xs text-red-500">{error}</div>
      </div>
    )
  }

  return (
    <div className={`flex items-center p-0.5 gap-2 ${className || ''}`}>
      <Select value={selectedProvider} onValueChange={handleProviderChange}>
        <SelectTrigger className="h-8 text-xs w-24">
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px] overflow-y-auto min-w-[9rem]">
          {providers.map(p => (
            <SelectItem key={p} value={p} className="py-1 text-xs break-words max-w-[12rem]">
              <span className="truncate block">{p}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedModel} onValueChange={handleModelChange}>
        <SelectTrigger className="h-8 text-xs w-40">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px] overflow-y-auto min-w-[12rem]">
          <SelectGroup>
            <SelectLabel className="text-xs sticky top-0 bg-background z-10 truncate max-w-[15rem]">
              {selectedProvider || 'Models'}
            </SelectLabel>
            {providerModels.map(m => (
              <SelectItem key={m.name} value={m.name} className="py-1 max-w-full break-words">
                <div className="flex items-center space-x-2 min-w-0">
                  <div className={`w-2 h-2 rounded-full ${m.supports_tools ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <span className="text-xs font-medium truncate max-w-[10rem]">{m.name}</span>
                  {m.supports_tools ? (
                    <span className="text-[10px] text-green-600">Tools</span>
                  ) : (
                    <span className="text-[10px] text-yellow-600">Chat</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
