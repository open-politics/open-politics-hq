'use client';

import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ButtonGroup } from "@/components/ui/button-group"
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { UtilsService } from '@/client';
import { ProviderInfo, ProviderModel } from '@/client';
import { toast } from 'sonner';

interface Provider {
  name: string;
  models: string[];
}

interface ProviderSelectorProps {
  showModels?: boolean;
  className?: string;
}

export default function ProviderSelector({ showModels = true, className = '' }: ProviderSelectorProps) {
  const { 
    selections,
    setSelection,
  } = useProvidersStore();
  
  const selectedProvider = selections.llm?.providerId || null;
  const selectedModel = selections.llm?.modelId || null;
  
  const setSelectedProvider = (provider: string) => {
    setSelection('llm', { providerId: provider });
  };
  
  const setSelectedModel = (model: string) => {
    if (selectedProvider) {
      setSelection('llm', { providerId: selectedProvider, modelId: model });
    }
  };
  
  const [providers, setProviders] = useState<Provider[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await UtilsService.getUnifiedProviders() as any;
        const llmProviders = response.providers?.llm || [];
        
        // Fetch models for LLM providers
        const legacyResponse = await UtilsService.getProviders();
        const providerModels = new Map(
          legacyResponse.providers.map((p: ProviderInfo) => [
            p.provider_name, 
            p.models.map((m: ProviderModel) => m.name)
          ])
        );
        
        const providerList: Provider[] = llmProviders.map((provider: any) => ({
          name: provider.id,
          models: providerModels.get(provider.id) || []
        }));
        
        setProviders(providerList);
        
        // If no provider is selected, or if the selected provider is no longer valid, set a default.
        if (!selectedProvider || !providerList.some(p => p.name === selectedProvider)) {
          // Prefer Anthropic (Claude) providers first, then others
          const defaultProvider = 
            providerList.find(p => p.name.toLowerCase().includes('anthropic')) ||
            providerList.find(p => p.name === 'gemini') || 
            providerList[0];
          if (defaultProvider) {
            setSelectedProvider(defaultProvider.name);
            // The model will be set by the other useEffect hook.
          }
        }
      } catch (error: any) {
        console.error('Error fetching providers:', error);
        toast.error('Failed to fetch AI providers. Please check the connection.');
      }
    };

    fetchProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally run only once on mount

  useEffect(() => {
    // Update available models when the selectedProvider or the list of providers changes.
    const provider = providers.find(p => p.name === selectedProvider);
    const models = provider?.models || [];
    setAvailableModels(models);

    // If there are models, but no model is selected or the current one is invalid, set a default.
    if (models.length > 0 && (!selectedModel || !models.includes(selectedModel))) {
      // Prefer Sonnet 4.5, then any 4.5, then any sonnet, then first model
      let defaultModel = models.find(m => 
        m.toLowerCase().includes('sonnet') && m.toLowerCase().includes('4') && m.toLowerCase().includes('5')
      );
      if (!defaultModel) {
        defaultModel = models.find(m => m.toLowerCase().includes('4') && m.toLowerCase().includes('5'));
      }
      if (!defaultModel) {
        defaultModel = models.find(m => m.toLowerCase().includes('sonnet'));
      }
      if (!defaultModel) {
        defaultModel = models[0];
      }
      
      if (defaultModel && defaultModel !== selectedModel) {
        // Only update if it's actually different to avoid infinite loops
        if (selectedProvider) {
          setSelection('llm', { providerId: selectedProvider, modelId: defaultModel });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider, providers]);

  const handleProviderChange = (providerName: string) => {
    // When provider changes, clear the model selection and set new provider
    // This ensures the useEffect picks up the change and loads the correct models
    setSelection('llm', { providerId: providerName, modelId: undefined });
  };

  return (
    <div className={`flex flex-row gap-2 ${className}`}>
      <ButtonGroup>
        <Select value={selectedProvider || undefined} onValueChange={handleProviderChange}>
          <SelectTrigger className="w-auto min-w-[110px] h-8">
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            {providers.map((provider) => (
              <SelectItem key={provider.name} value={provider.name}>
                {provider.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ButtonGroup>
      
      {showModels && (
        <ButtonGroup>
          <Select value={selectedModel || ''} onValueChange={setSelectedModel} disabled={availableModels.length === 0}>
            <SelectTrigger className="w-auto min-w-[170px] h-8">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
              {availableModels.length === 0 && selectedProvider && (
                <div className="text-center text-xs text-muted-foreground p-2">No models found for {selectedProvider}.</div>
              )}
            </SelectContent>
          </Select>
        </ButtonGroup>
      )}
    </div>
  );
}