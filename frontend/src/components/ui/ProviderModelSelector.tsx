'use client'

import { useEffect, useMemo, useState } from 'react'
import { IntelligenceChatService } from '@/client'
import { ModelInfo } from '@/client'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { Loader2 } from 'lucide-react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select'

interface ProviderModelSelectorProps {
  value?: string
  onChange: (modelName: string) => void
  className?: string
}

export default function ProviderModelSelector({ value, onChange, className }: ProviderModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [selectedModel, setSelectedModel] = useState<string>(value || '')
  const { activeInfospace } = useInfospaceStore()

  useEffect(() => {
    async function fetchModels() {
      if (!activeInfospace?.id) return
      setIsLoading(true)
      setError(null)
      try {
        const response = await IntelligenceChatService.listAvailableModels({ capability: undefined })
        const fetched = response.models || []
        setModels(fetched)
        // Initialize provider from current value if present
        if (value) {
          const match = fetched.find(m => m.name === value)
          if (match) setSelectedProvider(match.provider)
        } else if (fetched.length > 0) {
          // Prefer OpenAI provider if present
          const openaiModel = fetched.find(m => m.provider === 'openai' && m.name.startsWith('gpt-5'))
          if (openaiModel) {
            setSelectedProvider('openai')
            setSelectedModel(openaiModel.name)
            onChange(openaiModel.name)
          } else {
            // Choose a provider with tool support by default
            const toolModel = fetched.find(m => m.supports_tools)
            if (toolModel) {
              setSelectedProvider(toolModel.provider)
            } else {
              setSelectedProvider(fetched[0].provider)
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
    const first = models.find(m => m.provider === provider && m.supports_tools) || models.find(m => m.provider === provider)
    const nextModel = first?.name || ''
    setSelectedModel(nextModel)
    if (nextModel) onChange(nextModel)
  }

  const handleModelChange = (modelName: string) => {
    setSelectedModel(modelName)
    onChange(modelName)
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
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <Select value={selectedProvider} onValueChange={handleProviderChange}>
        <SelectTrigger className="h-8 text-xs w-36">
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px] overflow-y-auto">
          {providers.map(p => (
            <SelectItem key={p} value={p} className="py-1 text-xs">
              {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedModel} onValueChange={handleModelChange}>
        <SelectTrigger className="h-8 text-xs w-64">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px] overflow-y-auto">
          <SelectGroup>
            <SelectLabel className="text-xs sticky top-0 bg-background z-10">
              {selectedProvider || 'Models'}
            </SelectLabel>
            {providerModels.map(m => (
              <SelectItem key={m.name} value={m.name} className="py-1">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${m.supports_tools ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <span className="text-xs font-medium">{m.name}</span>
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


