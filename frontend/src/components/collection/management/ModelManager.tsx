'use client';

import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Download, Trash2, RefreshCw, Filter } from "lucide-react";
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { UtilsService } from '@/client';
import { ProviderInfo, ProviderModel } from '@/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";

interface Provider {
  name: string;
  models: string[];
}

interface AvailableModel {
  name: string;
  size: string;
  description: string;
  capabilities?: string[];
  pulls?: string;
  base_model?: string;
  parameters?: string;
  updated?: string;
  link?: string;
}

interface ModelManagerProps {
  showModels?: boolean;
  className?: string;
  showProviderSelector?: boolean;
}

export default function ModelManager({ showModels = true, className = '', showProviderSelector = true }: ModelManagerProps) {
  const { 
    selections,
    setSelection,
  } = useProvidersStore();
  
  // Get LLM provider selection
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
  const [availableOllamaModels, setAvailableOllamaModels] = useState<AvailableModel[]>([]);
  const [isPullingModel, setIsPullingModel] = useState<string | null>(null);
  const [isRemovingModel, setIsRemovingModel] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOllamaDialogOpen, setIsOllamaDialogOpen] = useState(false);
  const [customModelName, setCustomModelName] = useState('');
  
  // Filter states
  const [searchFilter, setSearchFilter] = useState('');
  const [capabilityFilter, setCapabilityFilter] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [updatedFilter, setUpdatedFilter] = useState('');
  const [sortBy, setSortBy] = useState('popular'); // 'popular' | 'recent' | 'name' | 'size'

  const fetchProviders = async () => {
    console.log('🔍 Fetching providers...');
    try {
      const response = await UtilsService.getUnifiedProviders() as any;
      console.log('📦 Received unified providers response:', response);
      
      const llmProviders = response.providers?.llm || [];
      const providerList: Provider[] = [];
      
      // For now, we need to fetch models separately for LLM providers
      // The unified endpoint gives us metadata, but models need discovery
      const legacyResponse = await UtilsService.getProviders();
      const providerModels = new Map(
        legacyResponse.providers.map((p: ProviderInfo) => [
          p.provider_name, 
          p.models.map((m: ProviderModel) => m.name)
        ])
      );
      
      for (const provider of llmProviders) {
        providerList.push({
          name: provider.id,
          models: providerModels.get(provider.id) || []
        });
      }
      
      console.log(`✅ Setting ${providerList.length} providers:`, providerList.map(p => `${p.name} (${p.models.length} models)`));
      setProviders(providerList);
      
      // If no provider is selected, or if the selected provider is no longer valid, set a default.
      if (!selectedProvider || !providerList.some(p => p.name === selectedProvider)) {
        const defaultProvider = providerList.find(p => p.name === 'gemini') || providerList[0];
        if (defaultProvider) {
          setSelectedProvider(defaultProvider.name);
        }
      }
    } catch (error: any) {
      console.error('Error fetching providers:', error);
      toast.error('Failed to fetch AI providers. Please check the connection.');
    }
  };

  const fetchAvailableOllamaModels = async () => {
    console.log('🔍 Fetching available Ollama models...');
    try {
      const data = await UtilsService.getOllamaAvailableModels({ 
        sort: 'popular', 
        limit: 50 
      }) as any;
      console.log('📦 Received data:', data);
      
      if (data.error) {
        console.warn('⚠️ API returned error:', data.error);
        toast.warning(`Using fallback models: ${data.error}`);
      }
      
      const models = (data.models || []) as AvailableModel[];
      console.log(`✅ Setting ${models.length} available models`);
      setAvailableOllamaModels(models);
      toast.success(`Loaded ${models.length} available models from Ollama library`);
    } catch (error) {
      console.error('❌ Error fetching available Ollama models:', error);
      toast.error('Failed to fetch available Ollama models');
      // Set basic fallback models
      const fallbackModels: AvailableModel[] = [
        {
          name: "llama3.2:3b",
          size: "~2.0GB",
          description: "Meta's balanced performance model",
          capabilities: ["tools"],
          pulls: "35.6M"
        },
        {
          name: "mistral:7b", 
          size: "~4.1GB",
          description: "Mistral 7B - excellent for reasoning",
          capabilities: ["tools"],
          pulls: "19.4M"
        }
      ];
      console.log('🔄 Using fallback models:', fallbackModels);
      setAvailableOllamaModels(fallbackModels);
    }
  };

  useEffect(() => {
    fetchProviders();
    fetchAvailableOllamaModels();
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
    setSelectedModel('');
  };

  const handleRefreshModels = async () => {
    setIsRefreshing(true);
    try {
      await fetchProviders();
      toast.success('Models refreshed');
    } catch (error) {
      console.error('Error refreshing models:', error);
      toast.error('Failed to refresh models');
    } finally {
      setIsRefreshing(false);
    }
  };

  const checkModelDownloadStatus = async () => {
    setIsRefreshing(true);
    try {
      await fetchProviders();
      const currentProvider = providers.find(p => p.name === selectedProvider);
      const currentModels = currentProvider?.models || [];
      
      if (selectedModel && !currentModels.includes(selectedModel)) {
        toast.warning(`Model ${selectedModel} is no longer available`);
        // Auto-select a default model if current one is not available
        if (currentModels.length > 0) {
          const defaultModel = currentModels.find(m => m.includes('flash')) || currentModels[0];
          setSelectedModel(defaultModel);
        }
      } else if (selectedModel && currentModels.includes(selectedModel)) {
        toast.success(`Model ${selectedModel} is available and ready`);
      }
    } catch (error) {
      console.error('Error checking model status:', error);
      toast.error('Failed to check model status');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handlePullModel = async (modelName: string) => {
    setIsPullingModel(modelName);
    try {
      await UtilsService.pullOllamaModel({ modelName });
      toast.success(`Model ${modelName} pulled successfully`);
      await fetchProviders(); // Refresh the model list
    } catch (error) {
      console.error('Error pulling model:', error);
      toast.error(`Failed to pull model ${modelName}`);
    } finally {
      setIsPullingModel(null);
    }
  };

  const handleRemoveModel = async (modelName: string) => {
    setIsRemovingModel(modelName);
    try {
      await UtilsService.removeOllamaModel({ modelName });
      toast.success(`Model ${modelName} removed successfully`);
      await fetchProviders(); // Refresh the model list
    } catch (error) {
      console.error('Error removing model:', error);
      toast.error(`Failed to remove model ${modelName}`);
    } finally {
      setIsRemovingModel(null);
    }
  };

  // Helper function to parse time strings like "2 months ago", "1 year ago"
  const parseTimeAgo = (timeStr: string): number => {
    if (!timeStr) return 0;
    const match = timeStr.match(/(\d+)\s*(month|year|week|day)s?\s*ago/i);
    if (!match) return 0;
    
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    switch (unit) {
      case 'day': return value;
      case 'week': return value * 7;
      case 'month': return value * 30;
      case 'year': return value * 365;
      default: return 0;
    }
  };

  // Filter and sort available models
  const filteredOllamaModels = availableOllamaModels
    .filter(model => {
      // Search filter (name and description)
      if (searchFilter && !model.name.toLowerCase().includes(searchFilter.toLowerCase()) && 
          !model.description.toLowerCase().includes(searchFilter.toLowerCase())) {
        return false;
      }
      
      // Capability filter
      if (capabilityFilter && capabilityFilter !== 'all') {
        if (!model.capabilities?.includes(capabilityFilter)) {
          return false;
        }
      }
      
      // Size filter
      if (sizeFilter && sizeFilter !== 'all') {
        const sizeValue = parseFloat(model.size.replace(/[^0-9.]/g, ''));
        switch (sizeFilter) {
          case 'small': // < 2GB
            if (sizeValue >= 2) return false;
            break;
          case 'medium': // 2-10GB
            if (sizeValue < 2 || sizeValue > 10) return false;
            break;
          case 'large': // > 10GB
            if (sizeValue <= 10) return false;
            break;
        }
      }
      
      // Updated filter
      if (updatedFilter && updatedFilter !== 'all') {
        const daysAgo = parseTimeAgo(model.updated || '');
        switch (updatedFilter) {
          case 'recent': // < 3 months
            if (daysAgo > 90) return false;
            break;
          case 'moderate': // 3-12 months
            if (daysAgo <= 90 || daysAgo > 365) return false;
            break;
          case 'older': // > 1 year
            if (daysAgo <= 365) return false;
            break;
        }
      }
      
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'recent':
          const aDays = parseTimeAgo(a.updated || '');
          const bDays = parseTimeAgo(b.updated || '');
          return aDays - bDays; // Smaller days = more recent
        
        case 'name':
          return a.name.localeCompare(b.name);
        
        case 'size':
          const aSize = parseFloat(a.size.replace(/[^0-9.]/g, ''));
          const bSize = parseFloat(b.size.replace(/[^0-9.]/g, ''));
          return aSize - bSize;
        
        case 'popular':
        default:
          // Sort by popularity (parse pull count)
          const aPulls = parseFloat((a.pulls || '0').replace(/[^0-9.]/g, ''));
          const bPulls = parseFloat((b.pulls || '0').replace(/[^0-9.]/g, ''));
          const aMultiplier = (a.pulls || '').includes('M') ? 1000000 : (a.pulls || '').includes('K') ? 1000 : 1;
          const bMultiplier = (b.pulls || '').includes('M') ? 1000000 : (b.pulls || '').includes('K') ? 1000 : 1;
          return (bPulls * bMultiplier) - (aPulls * aMultiplier); // Descending
      }
    });

  const currentProvider = providers.find(p => p.name === selectedProvider);
  const isOllamaProvider = selectedProvider === 'ollama';

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Provider Selection */}
      {showProviderSelector && (
      <div className="flex flex-col md:flex-row gap-3">
        <div className={showModels ? 'w-full md:w-1/2' : 'w-full'}>
          <label className="text-sm font-medium mb-1 block text-gray-700 dark:text-gray-300">AI Provider</label>
          <Select value={selectedProvider || undefined} onValueChange={handleProviderChange}>
            <SelectTrigger className="w-full text-sm">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider.name} value={provider.name}>
                  <div className="flex items-center justify-between w-full">
                    <span className="capitalize">{provider.name}</span>
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {provider.models.length} models
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {showModels && (
          <div className="w-full md:w-1/2">
            <label className="text-sm font-medium mb-1 block text-gray-700 dark:text-gray-300">Model</label>
            <div className="flex gap-2">
              <Select value={selectedModel || ''} onValueChange={setSelectedModel} disabled={availableModels.length === 0}>
                <SelectTrigger className="w-full text-sm">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                  {availableModels.length === 0 && selectedProvider && (
                    <div className="text-center text-xs text-muted-foreground p-2">
                      No models found for {selectedProvider}.
                    </div>
                  )}
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshModels}
                  disabled={isRefreshing}
                  className="shrink-0"
                  title="Refresh model list"
                >
                  {isRefreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkModelDownloadStatus}
                  disabled={isRefreshing}
                  className="shrink-0"
                  title="Check if selected model is downloaded"
                >
                  {isRefreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Filter className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Ollama Model Management */}
      {isOllamaProvider && (
        <Card className="border border-slate-200 dark:border-slate-700 bg-slate-50/20 dark:bg-slate-950/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center justify-between text-gray-900 dark:text-gray-100">
              Ollama Model Management
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkModelDownloadStatus}
                  disabled={isRefreshing}
                  className="text-sm"
                  title="Check model download status"
                >
                  {isRefreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
                <Dialog open={isOllamaDialogOpen} onOpenChange={setIsOllamaDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-sm">
                      <Download className="h-4 w-4 mr-1" />
                      Pull Model
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl bg-background/60">
                    <DialogHeader>
                      <DialogTitle>Pull Ollama Model</DialogTitle>
                      <DialogDescription>
                        Select a model to download from the Ollama registry, or enter a custom model name.
                      </DialogDescription>
                    </DialogHeader>
                    
                    {/* Custom Model Input */}
                    <div className="p-4 border rounded-lg mb-4">
                      <label className="text-sm font-medium mb-2 block">Custom Model Name</label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Enter model name (e.g. llama2:13b)"
                          value={customModelName}
                          onChange={(e) => setCustomModelName(e.target.value)}
                        />
                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (customModelName.trim()) {
                              handlePullModel(customModelName.trim());
                              setIsOllamaDialogOpen(false);
                            }
                          }}
                          disabled={!customModelName.trim()}
                        >
                          Pull Custom Model
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        You can enter any valid model name, even if it's not listed below
                      </p>
                    </div>
                    
                    {/* Filter Controls */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-lg border">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Search</label>
                        <Input
                          placeholder="Search models..."
                          value={searchFilter}
                          onChange={(e) => setSearchFilter(e.target.value)}
                          className="w-full"
                        />
                      </div>
                      
                      <div>
                        <label className="text-sm font-medium mb-1 block">Capability</label>
                        <Select value={capabilityFilter} onValueChange={setCapabilityFilter}>
                          <SelectTrigger>
                            <SelectValue placeholder="All capabilities" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All capabilities</SelectItem>
                            <SelectItem value="tools">🔧 Tools</SelectItem>
                            <SelectItem value="vision">👁️ Vision</SelectItem>
                            <SelectItem value="thinking">🧠 Thinking</SelectItem>
                            <SelectItem value="embedding">📊 Embedding</SelectItem>
                            <SelectItem value="cloud">☁️ Cloud</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <label className="text-sm font-medium mb-1 block">Size</label>
                        <Select value={sizeFilter} onValueChange={setSizeFilter}>
                          <SelectTrigger>
                            <SelectValue placeholder="All sizes" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All sizes</SelectItem>
                            <SelectItem value="small">📱 Small (&lt; 2GB)</SelectItem>
                            <SelectItem value="medium">💻 Medium (2-10GB)</SelectItem>
                            <SelectItem value="large">🖥️ Large (&gt; 10GB)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <label className="text-sm font-medium mb-1 block">Sort By</label>
                        <Select value={sortBy} onValueChange={setSortBy}>
                          <SelectTrigger>
                            <SelectValue placeholder="Sort by" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="popular">🔥 Most Popular</SelectItem>
                            <SelectItem value="recent">🆕 Recently Updated</SelectItem>
                            <SelectItem value="name">📝 Name (A-Z)</SelectItem>
                            <SelectItem value="size">📏 Size (Small to Large)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    {/* Updated Filter */}
                    <div className="px-4">
                      <label className="text-sm font-medium mb-1 block">Last Updated</label>
                      <Select value={updatedFilter} onValueChange={setUpdatedFilter}>
                        <SelectTrigger className="w-full md:w-64">
                          <SelectValue placeholder="Any time" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Any time</SelectItem>
                          <SelectItem value="recent">🆕 Recent (3 months)</SelectItem>
                          <SelectItem value="moderate">📅 Moderate (3-12 months)</SelectItem>
                          <SelectItem value="older">📜 Older (1+ years)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {/* Quick Filter Presets */}
                    <div className="flex flex-wrap gap-2 p-3 rounded">
                      <span className="text-xs font-medium text-slate-700 self-center">Quick presets:</span>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => { 
                          setCapabilityFilter('tools');
                          setSizeFilter('small');
                          setSortBy('popular');
                        }}
                        className="text-xs h-7"
                      >
                        🚀 Popular Small Tools
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => { 
                          setCapabilityFilter('thinking');
                          setSortBy('recent');
                        }}
                        className="text-xs h-7"
                      >
                        🧠 Latest Reasoning
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => { 
                          setCapabilityFilter('vision');
                          setSizeFilter('medium');
                        }}
                        className="text-xs h-7"
                      >
                        👁️ Vision Models
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => { 
                          setUpdatedFilter('recent');
                          setSortBy('recent');
                        }}
                        className="text-xs h-7"
                      >
                        🆕 Recently Updated
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => { 
                          setCapabilityFilter('embedding');
                          setSizeFilter('small');
                        }}
                        className="text-xs h-7"
                      >
                        📊 Embeddings
                      </Button>
                    </div>
                    
                    {/* Results Summary & Clear Filters */}
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        Showing {filteredOllamaModels.length} of {availableOllamaModels.length} models
                      </div>
                      {(searchFilter || capabilityFilter || sizeFilter || updatedFilter || sortBy !== 'popular') && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => {
                            setSearchFilter('');
                            setCapabilityFilter('');
                            setSizeFilter('');
                            setUpdatedFilter('');
                            setSortBy('popular');
                          }}
                        >
                          <Filter className="h-4 w-4 mr-1" />
                          Clear Filters
                        </Button>
                      )}
                    </div>
                    
                    <div className="space-y-4 max-h-96 overflow-y-auto">
                      {filteredOllamaModels.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Filter className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>No models match your filters</p>
                          <p className="text-xs">Try adjusting your search or filter criteria</p>
                        </div>
                      ) : (
                        filteredOllamaModels.map((model) => (
                        <div key={model.name} className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 bg-gray-50/10 dark:bg-gray-950/20 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-all duration-200">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="font-medium">{model.name}</div>
                              {model.capabilities && model.capabilities.length > 0 && (
                                <div className="flex gap-1">
                                  {model.capabilities.map((cap) => (
                                    <Badge 
                                      key={cap} 
                                      variant={cap === 'tools' ? 'default' : cap === 'vision' ? 'secondary' : 'outline'}
                                      className="text-xs"
                                    >
                                      {cap}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground mb-1">{model.description}</div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>Size: {model.size}</span>
                              {model.pulls && <span>Downloads: {model.pulls}</span>}
                              {model.parameters && <span>Params: {model.parameters}</span>}
                              {model.updated && <span>Updated: {model.updated}</span>}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePullModel(model.name)}
                            disabled={isPullingModel === model.name}
                            className="ml-4"
                          >
                            {isPullingModel === model.name ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        ))
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                Currently installed models ({availableModels.length}):
              </div>
              {availableModels.length > 0 ? (
                <div className="grid gap-2">
                  {availableModels.map((model) => (
                    <div key={model} className="flex items-center justify-between p-2 border border-slate-200 dark:border-slate-600 rounded bg-slate-100/20 dark:bg-slate-900/50">
                      <span className="font-mono text-sm text-gray-900 dark:text-gray-100">{model}</span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRemoveModel(model)}
                        disabled={isRemovingModel === model}
                        className="text-xs"
                      >
                        {isRemovingModel === model ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-500 dark:text-gray-400 py-3 text-sm">
                  No models installed. Pull a model to get started.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Provider-specific information */}
      {selectedProvider && (
        <Card className="border border-gray-200 dark:border-gray-700 bg-gray-50/20 dark:bg-gray-950/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium capitalize text-gray-900 dark:text-gray-100">{selectedProvider} Information</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
              {selectedProvider === 'gemini' && (
                <div>
                  <p>Google's Gemini models offer excellent reasoning and multimodal capabilities.</p>
                  <p className="text-gray-500 dark:text-gray-500">
                    API Key required. Get yours at: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Google AI Studio</a>
                  </p>
                </div>
              )}
              {selectedProvider === 'openai' && (
                <div>
                  <p>OpenAI's GPT models provide state-of-the-art language understanding and generation.</p>
                  <p className="text-gray-500 dark:text-gray-500">
                    API Key required. Get yours at: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">OpenAI Platform</a>
                  </p>
                </div>
              )}
              {selectedProvider === 'ollama' && (
                <div>
                  <p>Ollama runs models locally for privacy and offline use.</p>
                  <p className="text-gray-500 dark:text-gray-500">
                    Models are downloaded and run on your local infrastructure. No API key required.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
