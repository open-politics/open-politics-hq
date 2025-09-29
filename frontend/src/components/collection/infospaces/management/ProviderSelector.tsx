'use client';

import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useApiKeysStore } from '@/zustand_stores/storeApiKeys';
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
    selectedProvider, 
    selectedModel, 
    setSelectedProvider, 
    setSelectedModel 
  } = useApiKeysStore();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await UtilsService.getProviders();
        const providerList: Provider[] = response.providers.map((p: ProviderInfo) => ({
          name: p.provider_name,
          models: p.models.map((m: ProviderModel) => m.name),
        }));
        setProviders(providerList);
        
        // If no provider is selected, or if the selected provider is no longer valid, set a default.
        if (!selectedProvider || !providerList.some(p => p.name === selectedProvider)) {
          const defaultProvider = providerList.find(p => p.name === 'gemini_native') || providerList[0];
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
    // Intentionally run only once on mount
  }, []);

  useEffect(() => {
    // Update available models when the selectedProvider or the list of providers changes.
    const provider = providers.find(p => p.name === selectedProvider);
    const models = provider?.models || [];
    setAvailableModels(models);

    // If there are models, but no model is selected or the current one is invalid, set a default.
    if (models.length > 0 && (!selectedModel || !models.includes(selectedModel))) {
      const defaultModel = models.find(m => m.includes('flash')) || models[0];
      if (defaultModel) {
        setSelectedModel(defaultModel);
      }
    }
  }, [selectedProvider, providers, selectedModel, setSelectedModel]);

  const handleProviderChange = (providerName: string) => {
    setSelectedProvider(providerName);
    // When provider changes, clear the model selection so the useEffect can set a new default.
    setSelectedModel('');
  };

  return (
    <div className={`flex flex-col md:flex-row gap-4 ${className}`}>
      <div className={showModels ? 'w-full md:w-1/2' : 'w-full'}>
        <Select value={selectedProvider || undefined} onValueChange={handleProviderChange}>
          <SelectTrigger className="w-full">
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
      </div>
      
      {showModels && (
        <div className="w-full md:w-1/2">
          <Select value={selectedModel || ''} onValueChange={setSelectedModel} disabled={availableModels.length === 0}>
            <SelectTrigger className="w-full">
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
        </div>
      )}
    </div>
  );
}