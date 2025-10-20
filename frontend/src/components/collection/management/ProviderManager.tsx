'use client';

import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Search, Key, Trash2 } from "lucide-react";
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { UtilsService } from '@/client';
import { ProviderInfo, ProviderModel } from '@/client';
import { toast } from 'sonner';

interface LLMProvider {
  name: string;
  models: string[];
  type: 'llm';
}

interface SearchProvider {
  name: string;
  description: string;
  type: 'search';
  requiresApiKey: boolean;
}

interface ProviderManagerProps {
  className?: string;
}

export default function ProviderManager({ className = '' }: ProviderManagerProps) {
  const { 
    apiKeys,
    selections,
    setApiKey,
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
  
  const [llmProviders, setLlmProviders] = useState<LLMProvider[]>([]);
  const [searchProviders, setSearchProviders] = useState<SearchProvider[]>([]);
  
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [tempApiKey, setTempApiKey] = useState('');
  const [selectedProviderType, setSelectedProviderType] = useState<'llm' | 'search'>('llm');

  const fetchProviders = async () => {
    try {
      const response = await UtilsService.getUnifiedProviders() as any;
      
      // Fetch LLM providers
      const llmProvidersData = response.providers?.llm || [];
      const legacyResponse = await UtilsService.getProviders();
      const providerModels = new Map(
        legacyResponse.providers.map((p: ProviderInfo) => [
          p.provider_name, 
          p.models.map((m: ProviderModel) => m.name)
        ])
      );
      
      const llmList: LLMProvider[] = llmProvidersData.map((provider: any) => ({
        name: provider.id,
        models: providerModels.get(provider.id) || [],
        type: 'llm' as const,
      }));
      setLlmProviders(llmList);
      
      // Fetch Search providers from unified registry
      const searchProvidersData = response.providers?.search || [];
      const searchList: SearchProvider[] = searchProvidersData.map((provider: any) => ({
        name: provider.id,
        description: provider.description,
        type: 'search' as const,
        requiresApiKey: provider.requires_api_key
      }));
      setSearchProviders(searchList);
      
      // Set default LLM provider if none selected
      if (!selectedProvider || selectedProviderType === 'llm') {
        const defaultProvider = llmList.find(p => p.name === 'gemini') || llmList[0];
        if (defaultProvider) {
          setSelectedProvider(defaultProvider.name);
        }
      }
    } catch (error: any) {
      console.error('Error fetching providers:', error);
      toast.error('Failed to fetch providers.');
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  // Update available models when provider changes
  useEffect(() => {
    if (selectedProviderType === 'llm' && selectedProvider) {
      const provider = llmProviders.find(p => p.name === selectedProvider);
      if (provider) {
        setAvailableModels(provider.models);
        
        // Set default model if none selected or if current model not available
        if (!selectedModel || !provider.models.includes(selectedModel)) {
          const defaultModel = provider.models[0];
          if (defaultModel) {
            setSelectedModel(defaultModel);
          }
        }
      }
    }
  }, [selectedProvider, selectedProviderType, llmProviders, selectedModel, setSelectedModel]);

  const handleProviderChange = (providerName: string, type: 'llm' | 'search') => {
    setSelectedProvider(providerName);
    setSelectedProviderType(type);
    if (type === 'search') {
      setSelectedModel(''); // Clear model selection for search providers
    }
  };

  const handleSaveApiKey = () => {
    if (selectedProvider && tempApiKey) {
      setApiKey(selectedProvider, tempApiKey);
      setTempApiKey('');
      toast.success(`API key saved for ${selectedProvider}`);
    } else {
      toast.error('Please select a provider and enter an API key');
    }
  };

  const handleRemoveApiKey = (providerName: string) => {
    setApiKey(providerName, '');
    toast.success(`API key removed for ${providerName}`);
  };

  const maskApiKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 8) return key;
    return `${key.slice(0, 4)}***${key.slice(-4)}`;
  };

  const getCurrentProvider = () => {
    if (selectedProviderType === 'llm') {
      return llmProviders.find(p => p.name === selectedProvider);
    } else {
      return searchProviders.find(p => p.name === selectedProvider);
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Provider Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="llm" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="llm" className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              LLM Providers
            </TabsTrigger>
            <TabsTrigger value="search" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search Providers
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="llm" className="space-y-4">
            <div className="space-y-2">
              <Label>LLM Provider</Label>
              <Select 
                value={selectedProviderType === 'llm' ? selectedProvider || '' : ''} 
                onValueChange={(value) => handleProviderChange(value, 'llm')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select LLM provider" />
                </SelectTrigger>
                <SelectContent>
                  {llmProviders.map((provider) => (
                    <SelectItem key={provider.name} value={provider.name}>
                      <div className="flex items-center gap-2">
                        <span>{provider.name}</span>
                        <Badge variant="secondary" className="text-xs">
                          {provider.models.length} models
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProviderType === 'llm' && availableModels.length > 0 && (
              <div className="space-y-2">
                <Label>Model</Label>
                <Select value={selectedModel || ''} onValueChange={setSelectedModel}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="search" className="space-y-4">
            <div className="space-y-2">
              <Label>Search Provider</Label>
              <Select 
                value={selectedProviderType === 'search' ? selectedProvider || '' : ''} 
                onValueChange={(value) => handleProviderChange(value, 'search')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select search provider" />
                </SelectTrigger>
                <SelectContent>
                  {searchProviders.map((provider) => (
                    <SelectItem key={provider.name} value={provider.name}>
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-2">
                          <span className="capitalize">{provider.name}</span>
                          {provider.requiresApiKey && (
                            <Badge variant="outline" className="text-xs">
                              API Key Required
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {provider.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
        </Tabs>

        {/* API Key Management */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>API Key for {selectedProvider || 'Selected Provider'}</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={`Enter API key for ${selectedProvider || 'selected provider'}`}
                value={tempApiKey}
                onChange={(e) => setTempApiKey(e.target.value)}
                className="text-sm"
              />
              <Button 
                onClick={handleSaveApiKey}
                disabled={!selectedProvider || !tempApiKey}
                size="sm"
                className="bg-gray-600 hover:bg-gray-700 text-white"
              >
                Save
              </Button>
            </div>
            
            {/* Show current provider info */}
            {selectedProvider && (
              <div className="text-xs text-muted-foreground">
                {selectedProviderType === 'search' && 
                  searchProviders.find(p => p.name === selectedProvider)?.requiresApiKey === false && (
                    <span>ℹ️ This provider doesn't require an API key but you can provide one for enhanced features</span>
                  )
                }
              </div>
            )}
          </div>

          {/* Show all saved API keys */}
          {Object.keys(apiKeys).length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm">Saved API Keys</Label>
              <div className="space-y-2">
                {Object.entries(apiKeys).map(([provider, key]) => (
                  <div key={provider} className="flex items-center justify-between p-2 bg-muted rounded-md">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        {searchProviders.find(p => p.name === provider) ? (
                          <Search className="h-3 w-3 text-blue-500" />
                        ) : (
                          <Bot className="h-3 w-3 text-green-500" />
                        )}
                        <span className="text-sm font-medium">{provider}</span>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">
                        {maskApiKey(key)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveApiKey(provider)}
                      className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
