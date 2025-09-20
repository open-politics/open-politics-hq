'use client'

import { useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '../ui/select'
import { IntelligenceChatService } from '@/client/services'
import { ModelInfo } from '@/client/models'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { Loader2 } from 'lucide-react'

interface ModelSelectorProps {
  selectedModelId: string
  onModelChange: (id: string) => void
}

interface GroupedModels {
  [provider: string]: ModelInfo[]
}

export function ModelSelector({
  selectedModelId,
  onModelChange
}: ModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { activeInfospace } = useInfospaceStore()

  useEffect(() => {
    async function fetchModels() {
      if (!activeInfospace?.id) return
      
      setIsLoading(true)
      setError(null)
      
      try {
        // Get all available models (both tool-supporting and chat-only)
        const response = await IntelligenceChatService.listAvailableModels({ capability: undefined })
        setModels(response.models || [])
      } catch (err: any) {
        console.error('Failed to fetch models:', err)
        setError('Failed to load models')
      } finally {
        setIsLoading(false)
      }
    }

    fetchModels()
  }, [activeInfospace?.id])

  const groupedModels: GroupedModels = models.reduce((groups, model) => {
    const provider = model.provider || 'unknown'
    if (!groups[provider]) {
      groups[provider] = []
    }
    groups[provider].push(model)
    return groups
  }, {} as GroupedModels)

  const handleModelChange = (modelName: string) => {
    onModelChange(modelName)
  }

  if (isLoading) {
    return (
      <div className="absolute -top-8 left-2">
        <div className="flex items-center gap-2 mr-2 h-7 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Loading models...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="absolute -top-8 left-2">
        <div className="mr-2 h-7 text-xs text-red-500">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="absolute -top-8 left-2">
      <Select
        name="model"
        value={selectedModelId}
        onValueChange={handleModelChange}
      >
        <SelectTrigger className="mr-2 h-7 text-xs border-none shadow-none focus:ring-0">
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px] overflow-y-auto">
          {Object.entries(groupedModels).map(([provider, providerModels]) => (
            <SelectGroup key={provider}>
              <SelectLabel className="text-xs sticky top-0 bg-background z-10">
                {provider.charAt(0).toUpperCase() + provider.slice(1)}
              </SelectLabel>
              {providerModels.map(model => (
                <SelectItem
                  key={model.name}
                  value={model.name}
                  className="py-2"
                >
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${model.supports_tools ? 'bg-green-500' : 'bg-yellow-500'}`} />
                    <span className="text-xs font-medium">{model.name}</span>
                    {model.supports_tools ? (
                      <span className="text-xs text-green-600 font-medium">Tools</span>
                    ) : (
                      <span className="text-xs text-yellow-600">Chat Only</span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
