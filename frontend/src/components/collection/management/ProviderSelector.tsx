'use client';

import { useEffect, useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ButtonGroup } from "@/components/ui/button-group"
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';
import ModelSelect from './ModelSelect';

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
    providers: catalog,
    loadCatalog,
  } = useProvidersStore();

  const { activeInfospace } = useInfospaceStore();

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
  
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const providers = useMemo(
    () => catalog.llm.map(p => ({ name: p.id, models: (p.models || []).map(m => m.name) })),
    [catalog.llm],
  );

  useEffect(() => {
    if (!activeInfospace?.id) return;
    loadCatalog(activeInfospace.id).catch((error) => {
      console.error('Error fetching providers:', error);
      toast.error('Failed to fetch AI providers. Please check the connection.');
    });
  }, [activeInfospace?.id, loadCatalog]);

  // If no provider is selected, or the selected one is gone, the first the
  // backend offers wins. The model is then set by the effect below.
  useEffect(() => {
    if (providers.length === 0) return;
    if (!selectedProvider || !providers.some(p => p.name === selectedProvider)) {
      setSelectedProvider(providers[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capability, providers]);

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

  // Merged: one select, models grouped by provider, so picking a model sets the provider too.
  if (merged && showModels) {
    return (
      <div className={`flex w-full min-w-0 ${className}`}>
        <ModelSelect
          providers={catalog.llm}
          value={selections[capability]}
          onChange={(sel) => setSelection(capability, sel)}
          className="h-8 w-full min-w-0"
          empty="No models available."
        />
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