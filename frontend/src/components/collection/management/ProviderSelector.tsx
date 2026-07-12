'use client';

import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  /** Which capability key to read/write in the store. Defaults to 'llm'.
   *  Use 'annotation' when embedded in the annotation runner so the selection
   *  is stored independently from the chat/general LLM selection. */
  capability?: 'llm' | 'annotation';
  /** Collapse provider + model into ONE select (models grouped by provider).
   *  For tight widths (mobile) where two side-by-side selects overflow. */
  merged?: boolean;
}

export default function ProviderSelector({ showModels = true, className = '', capability = 'llm', merged = false }: ProviderSelectorProps) {
  const {
    selections,
    setSelection,
  } = useProvidersStore();

  const selectedProvider = selections[capability]?.providerId || null;
  const selectedModel = selections[capability]?.modelId || null;

  const setSelectedProvider = (provider: string) => {
    setSelection(capability, { providerId: provider });
  };

  const setSelectedModel = (model: string) => {
    if (selectedProvider) {
      setSelection(capability, { providerId: selectedProvider, modelId: model });
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
  }, [capability]); // Re-run when capability changes

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
          setSelection(capability, { providerId: selectedProvider, modelId: defaultModel });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider, providers]);

  const handleProviderChange = (providerName: string) => {
    // When provider changes, clear the model selection and set new provider
    // This ensures the useEffect picks up the change and loads the correct models
    setSelection(capability, { providerId: providerName, modelId: undefined });
  };

  // Merged: one select, models grouped by provider. The value carries both
  // (`provider::model`) so picking a model sets the provider too.
  if (merged && showModels) {
    const value = selectedProvider && selectedModel ? `${selectedProvider}::${selectedModel}` : '';
    const handleMergedChange = (v: string) => {
      const sep = v.indexOf('::');
      if (sep < 0) return;
      setSelection(capability, { providerId: v.slice(0, sep), modelId: v.slice(sep + 2) });
    };
    const providersWithModels = providers.filter((p) => p.models.length > 0);
    return (
      <div className={`flex w-full min-w-0 ${className}`}>
        <Select value={value} onValueChange={handleMergedChange}>
          <SelectTrigger className="h-8 w-full min-w-0">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {providersWithModels.map((provider) => (
              <SelectGroup key={provider.name}>
                <SelectLabel className="text-[11px] capitalize text-muted-foreground">{provider.name}</SelectLabel>
                {provider.models.map((model) => (
                  <SelectItem key={`${provider.name}::${model}`} value={`${provider.name}::${model}`}>
                    {model}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
            {providersWithModels.length === 0 && (
              <div className="p-2 text-center text-xs text-muted-foreground">No models available.</div>
            )}
          </SelectContent>
        </Select>
      </div>
    );
  }

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