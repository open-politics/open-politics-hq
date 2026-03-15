'use client';

import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Database, RefreshCw, Play, Info, Trash2, Settings, Key, Eye, EyeOff, ExternalLink } from "lucide-react";
import { InfospaceRead, InfospacesService, EmbeddingsService } from '@/client';
import { toast } from 'sonner';
import { useProvidersStore, ProviderMetadata } from '@/zustand_stores/storeProviders';
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

interface EmbeddingModel {
  name: string;
  provider: string;
  dimension: number;
  description?: string;
  max_sequence_length?: number;
}

interface EmbeddingStats {
  total_assets: number;
  documents: number;
  sub_assets: number;
  total_chunks: number;
  embedded_chunks: number;
  coverage_percentage: number;
  models_used: Record<string, number>;
}

interface EmbeddingManagerProps {
  infospace: InfospaceRead;
  onInfospaceUpdate?: (updated: InfospaceRead) => void;
}

export default function EmbeddingManager({ infospace, onInfospaceUpdate }: EmbeddingManagerProps) {
  const { apiKeys, setApiKey, providers: storeProviders } = useProvidersStore();
  const [availableModels, setAvailableModels] = useState<EmbeddingModel[]>([]);
  const embeddingSel = (infospace.enrichment_config as any)?.embedding;
  const [selectedModel, setSelectedModel] = useState<string>(embeddingSel?.model_name || '');
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stats, setStats] = useState<EmbeddingStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showChangeModelDialog, setShowChangeModelDialog] = useState(false);
  const [showApiKeysDialog, setShowApiKeysDialog] = useState(false);
  const [newModel, setNewModel] = useState<string>('');
  const [isUpdatingRelatedAssets, setIsUpdatingRelatedAssets] = useState(false);
  
  // API key visibility toggles (generic per-provider)
  const [keyVisibility, setKeyVisibility] = useState<Record<string, boolean>>({});
  
  const isEnabled = !!embeddingSel?.model_name;
  
  // Group models by provider
  const modelsByProvider = availableModels.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  }, {} as Record<string, EmbeddingModel[]>);

  useEffect(() => {
    loadAvailableModels();
    if (isEnabled) {
      loadStats();
    }
  }, [infospace.id, isEnabled]);

  const loadAvailableModels = async (forceRefresh = false) => {
    setIsLoadingModels(true);
    try {
      const validApiKeys = buildValidApiKeys();

      const response = await EmbeddingsService.discoverEmbeddingModels({
        requestBody: {
          api_keys: Object.keys(validApiKeys).length > 0 ? validApiKeys : undefined
        }
      });
      
      // Map to ensure description and max_sequence_length are never null
      const models: EmbeddingModel[] = (response.models || []).map(m => ({
        name: m.name,
        provider: m.provider,
        dimension: m.dimension,
        description: m.description || undefined,
        max_sequence_length: m.max_sequence_length ?? undefined
      }));
      
      setAvailableModels(models);
      
      // Show success message with counts by provider
      const providerCounts = models.reduce((acc, m) => {
        acc[m.provider] = (acc[m.provider] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const providerSummary = Object.entries(providerCounts)
        .map(([provider, count]) => `${provider}: ${count}`)
        .join(', ');
      
      if (forceRefresh) {
        toast.success(`Discovered ${models.length} models (${providerSummary})`);
      }
    } catch (error: any) {
      console.error('Failed to load embedding models:', error);
      toast.error('Failed to load available embedding models');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const loadStats = async () => {
    setIsLoadingStats(true);
    try {
      const response = await EmbeddingsService.getEmbeddingStats({ infospaceId: infospace.id });
      // Map response to ensure proper types
      const statsData: EmbeddingStats = {
        total_assets: response.total_assets,
        documents: (response as any).documents ?? response.total_assets,
        sub_assets: (response as any).sub_assets ?? 0,
        total_chunks: response.total_chunks,
        embedded_chunks: response.embedded_chunks,
        coverage_percentage: response.coverage_percentage,
        models_used: response.models_used as Record<string, number>
      };
      setStats(statsData);
    } catch (error: any) {
      console.error('Failed to load embedding stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };
  
  // Derive cloud embedding providers that need API keys from the store
  const FALLBACK_PROVIDERS: { id: string; name: string; api_key_url?: string }[] = [
    { id: 'openai', name: 'OpenAI', api_key_url: 'https://platform.openai.com/api-keys' },
    { id: 'voyage', name: 'Voyage AI', api_key_url: 'https://dash.voyageai.com/' },
    { id: 'jina', name: 'Jina AI', api_key_url: 'https://jina.ai/embeddings/#apiform' },
  ];

  const cloudEmbeddingProviders: ProviderMetadata[] = storeProviders.embedding.length > 0
    ? storeProviders.embedding.filter(p => p.requires_api_key)
    : FALLBACK_PROVIDERS.map(f => ({
        id: f.id, name: f.name, description: '', requires_api_key: true,
        api_key_name: `${f.name} API Key`, api_key_url: f.api_key_url,
        is_local: false, is_oss: false, is_free: false, has_env_fallback: false, features: [],
      }));

  // Helper to get provider info — pulls from store first, falls back to basic info
  const getProviderInfo = (provider: string) => {
    const storeEntry = storeProviders.embedding.find(p => p.id === provider);
    if (storeEntry) {
      return {
        name: storeEntry.name,
        requiresKey: storeEntry.requires_api_key,
        docUrl: storeEntry.api_key_url,
        badge: storeEntry.is_local ? 'Local' : 'Cloud',
      };
    }
    return { name: provider, requiresKey: false };
  };

  // Build valid API keys from all cloud embedding providers in the store
  const buildValidApiKeys = (): Record<string, string> => {
    const keys: Record<string, string> = {};
    for (const p of cloudEmbeddingProviders) {
      const k = apiKeys[p.id];
      if (k) keys[p.id] = k;
    }
    return keys;
  };

  const handleEnableEmbeddings = async () => {
    if (!selectedModel) {
      toast.error('Please select an embedding model first');
      return;
    }

    setIsEnabling(true);
    try {
      // Find the selected model to get its provider
      const model = availableModels.find(m => m.name === selectedModel);
      // Update infospace enrichment_config with embedding provider selection
      const currentConfig = (infospace.enrichment_config || {}) as Record<string, any>;
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: {
          enrichment_config: {
            ...currentConfig,
            embedding: model ? { provider_key: model.provider, model_name: selectedModel } : undefined,
          },
        },
      });

      toast.success('Embeddings enabled! New assets will be automatically embedded.');

      const validApiKeys = buildValidApiKeys();

      // Trigger initial embedding generation for existing assets
      toast.info('Generating embeddings for existing assets...');
      await EmbeddingsService.generateInfospaceEmbeddings({
        infospaceId: infospace.id,
        requestBody: {
          overwrite: false,
          api_keys: Object.keys(validApiKeys).length > 0 ? validApiKeys : undefined,
        },
      });

      // Refresh infospace data
      if (onInfospaceUpdate) {
        const updated = await InfospacesService.getInfospace({ infospaceId: infospace.id });
        onInfospaceUpdate(updated);
      }

      setShowConfigDialog(false);
      
      // Load stats after a delay
      setTimeout(() => loadStats(), 2000);
    } catch (error: any) {
      console.error('Failed to enable embeddings:', error);
      toast.error(`Failed to enable embeddings: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    } finally {
      setIsEnabling(false);
    }
  };

  const handleDisableEmbeddings = async () => {
    const confirm = window.confirm(
      'Are you sure you want to disable embeddings? Existing embeddings will be preserved but new assets will not be embedded automatically.'
    );
    
    if (!confirm) return;

    setIsEnabling(true);
    try {
      const currentConfig = (infospace.enrichment_config || {}) as Record<string, any>;
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: {
          enrichment_config: { ...currentConfig, embedding: null },
        },
      });

      toast.success('Embeddings disabled');
      
      if (onInfospaceUpdate) {
        const updated = await InfospacesService.getInfospace({ infospaceId: infospace.id });
        onInfospaceUpdate(updated);
      }
    } catch (error: any) {
      console.error('Failed to disable embeddings:', error);
      toast.error(`Failed to disable embeddings: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    } finally {
      setIsEnabling(false);
    }
  };

  const handleRegenerateEmbeddings = async () => {
    setIsGenerating(true);
    try {
      const validApiKeys = buildValidApiKeys();

      await EmbeddingsService.generateInfospaceEmbeddings({
        infospaceId: infospace.id,
        requestBody: {
          overwrite: true,
          api_keys: Object.keys(validApiKeys).length > 0 ? validApiKeys : undefined,
        },
      });

      toast.success('Regenerating embeddings in background. This may take several minutes.');
      
      // Refresh stats after a delay
      setTimeout(() => loadStats(), 3000);
    } catch (error: any) {
      console.error('Failed to regenerate embeddings:', error);
      toast.error(`Failed to regenerate embeddings: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearEmbeddings = async () => {
    const confirm = window.confirm(
      'Are you sure you want to clear all embeddings? This will remove all vector data but preserve your assets. You can regenerate embeddings afterwards.'
    );
    
    if (!confirm) return;

    setIsGenerating(true);
    try {
      await EmbeddingsService.clearInfospaceEmbeddings({
        infospaceId: infospace.id,
      });

      toast.success('All embeddings cleared successfully');
      
      // Reset stats to show cleared state
      setStats({
        total_assets: stats?.total_assets || 0,
        total_chunks: 0,
        embedded_chunks: 0,
        coverage_percentage: 0,
        models_used: {}
      });
      
      // Refresh stats from server
      setTimeout(() => loadStats(), 500);
    } catch (error: any) {
      console.error('Failed to clear embeddings:', error);
      toast.error(`Failed to clear embeddings: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleChangeModel = async () => {
    if (!newModel) {
      toast.error('Please select a new embedding model');
      return;
    }

    setIsEnabling(true);
    try {
      // Get dimension for the selected model
      const model = availableModels.find(m => m.name === newModel);
      if (!model) {
        toast.error('Selected model not found');
        return;
      }

      // Update infospace enrichment_config with new embedding provider selection
      const currentConfig = (infospace.enrichment_config || {}) as Record<string, any>;
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: {
          enrichment_config: {
            ...currentConfig,
            embedding: { provider_key: model.provider, model_name: newModel },
          },
        },
      });

      toast.success(`Embedding model changed to ${newModel}. Clear and regenerate embeddings to use the new model.`);
      
      setShowChangeModelDialog(false);
      
      // Refresh infospace data
      if (onInfospaceUpdate) {
        const updated = await InfospacesService.getInfospace({ infospaceId: infospace.id });
        onInfospaceUpdate(updated);
      }
    } catch (error: any) {
      console.error('Failed to change embedding model:', error);
      toast.error(`Failed to change model: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    } finally {
      setIsEnabling(false);
    }
  };

  const handleToggleRelatedAssets = async (value: boolean) => {
    setIsUpdatingRelatedAssets(true);
    try {
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: {
          enable_related_assets: value,
        },
      });

      toast.success(
        value
          ? 'Related articles in Asset Manager enabled'
          : 'Related articles in Asset Manager disabled'
      );

      if (onInfospaceUpdate) {
        const updated = await InfospacesService.getInfospace({ infospaceId: infospace.id });
        onInfospaceUpdate(updated);
      }
    } catch (error: any) {
      console.error('Failed to update related assets setting:', error);
      toast.error(
        `Failed to update related articles setting: ${
          error?.body?.detail || error?.message || 'Unknown error'
        }`
      );
    } finally {
      setIsUpdatingRelatedAssets(false);
    }
  };

  return (
    <div className="border rounded-lg bg-card">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row p-4 border-b">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-0">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            <div>
              <h3 className="text-lg font-semibold">Semantic Search (Embeddings)</h3>
              <p className="text-sm text-muted-foreground">
                Enable AI-powered semantic search for your content
              </p>
            </div>
          </div>
          {!isEnabled ? (
            <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Database className="mr-2 h-4 w-4" />
                  Enable
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <DialogTitle>Enable Semantic Search</DialogTitle>
                      <DialogDescription>
                        Choose an embedding model to enable semantic search. New assets will be automatically embedded.
                      </DialogDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowApiKeysDialog(!showApiKeysDialog)}
                    >
                      <Key className="h-4 w-4 mr-2" />
                      {showApiKeysDialog ? 'Hide' : 'API Keys'}
                    </Button>
                  </div>
                </DialogHeader>
                
                {showApiKeysDialog && (
                  <Alert>
                    <Key className="h-4 w-4" />
                    <AlertTitle>Runtime API Keys for Cloud Providers</AlertTitle>
                    <AlertDescription className="space-y-3 mt-2">
                      <p className="text-xs">
                        Enter API keys to use cloud embedding providers for this immediate operation. For background tasks, save keys in <a href="/accounts/settings" className="underline text-blue-600 dark:text-blue-400">Settings</a> or the Provider Hub.
                      </p>
                      
                      {cloudEmbeddingProviders.map((p) => (
                        <div key={p.id} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <Label htmlFor={`${p.id}-key`} className="text-xs font-medium">
                              {p.api_key_name || `${p.name} API Key`}
                            </Label>
                            {p.api_key_url && (
                              <a
                                href={p.api_key_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                              >
                                Get Key <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Input
                              id={`${p.id}-key`}
                              type={keyVisibility[p.id] ? "text" : "password"}
                              placeholder="Enter API key"
                              value={apiKeys[p.id] || ''}
                              onChange={(e) => setApiKey(p.id, e.target.value)}
                              className="text-xs"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setKeyVisibility(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                            >
                              {keyVisibility[p.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      ))}
                      
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => loadAvailableModels(true)}
                          disabled={isLoadingModels}
                        >
                          {isLoadingModels ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Discovering...</>
                          ) : (
                            <><RefreshCw className="h-4 w-4 mr-2" /> Discover Models</>
                          )}
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>What are embeddings?</AlertTitle>
                  <AlertDescription>
                    Embeddings convert your text into mathematical vectors, enabling AI to understand meaning and find semantically similar content, not just keyword matches.
                  </AlertDescription>
                </Alert>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="embedding-model">Embedding Model</Label>
                      {availableModels.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {availableModels.length} models from {Object.keys(modelsByProvider).length} providers
                        </span>
                      )}
                    </div>
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                      <SelectTrigger id="embedding-model">
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {isLoadingModels ? (
                          <div className="flex items-center justify-center p-4">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </div>
                        ) : availableModels.length === 0 ? (
                          <div className="p-4 text-sm text-muted-foreground text-center">
                            No embedding models available. Pull a model from the Model Manager or add API keys above.
                          </div>
                        ) : (
                          Object.entries(modelsByProvider).map(([provider, models]) => {
                            const providerInfo = getProviderInfo(provider);
                            return (
                              <div key={provider}>
                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-2">
                                  {providerInfo.name}
                                  {providerInfo.badge && (
                                    <Badge variant="outline" className="text-[10px] h-4">
                                      {providerInfo.badge}
                                    </Badge>
                                  )}
                                  {providerInfo.requiresKey && !apiKeys[provider] && (
                                    <Badge variant="destructive" className="text-[10px] h-4">
                                      Needs API Key
                                    </Badge>
                                  )}
                                </div>
                                {models.map((model) => (
                                  <SelectItem key={model.name} value={model.name}>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{model.name}</span>
                                      <Badge variant="secondary" className="ml-auto">
                                        {model.dimension}d
                                      </Badge>
                                    </div>
                                  </SelectItem>
                                ))}
                              </div>
                            );
                          })
                        )}
                      </SelectContent>
                    </Select>
                    {selectedModel && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          {availableModels.find(m => m.name === selectedModel)?.description || 'Embedding model'}
                        </p>
                        {(() => {
                          const model = availableModels.find(m => m.name === selectedModel);
                          const providerInfo = model ? getProviderInfo(model.provider) : null;
                          return providerInfo?.requiresKey && !apiKeys[model!.provider] && (
                            <p className="text-xs text-amber-600">
                              ⚠️ This provider requires an API key. Add it above to use this model.
                            </p>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowConfigDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleEnableEmbeddings} disabled={!selectedModel || isEnabling}>
                    {isEnabling ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Enabling...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Enable & Generate
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : (
            <ButtonGroup>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowChangeModelDialog(true)}
                      disabled={isEnabling}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Change embedding model</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadStats}
                      disabled={isLoadingStats}
                    >
                      {isLoadingStats ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Refresh statistics</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRegenerateEmbeddings}
                      disabled={isGenerating}
                    >
                      {isGenerating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Regenerate all embeddings</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearEmbeddings}
                      disabled={isGenerating}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Clear all embeddings</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisableEmbeddings}
                disabled={isEnabling}
              >
                Disable
              </Button>
            </ButtonGroup>
          )}
        </div>
      </div>
      
      {/* Content Section */}
      {isEnabled && (
        <div className="p-4 space-y-4 ">
          {/* Current Configuration */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Current Model</div>
              <div className="text-xs text-muted-foreground truncate">{embeddingSel?.model_name}</div>
            </div>
            {(() => {
              const activeModel = availableModels.find(m => m.name === embeddingSel?.model_name);
              const nativeDim = activeModel?.dimension;
              const currentDim = embeddingSel?.dimension || nativeDim;
              const SUPPORTED_DIMS = [384, 512, 768, 1024, 1536, 2048];
              const eligibleDims = nativeDim
                ? SUPPORTED_DIMS.filter(d => d <= nativeDim)
                : currentDim ? [currentDim] : [];
              if (eligibleDims.length <= 1) return <Badge variant="default">{currentDim || '?'}d</Badge>;
              return (
                <Select
                  value={String(currentDim)}
                  onValueChange={async (val) => {
                    const dim = parseInt(val);
                    const currentConfig = (infospace.enrichment_config || {}) as Record<string, any>;
                    try {
                      await InfospacesService.updateInfospace({
                        infospaceId: infospace.id,
                        requestBody: {
                          enrichment_config: {
                            ...currentConfig,
                            embedding: { ...currentConfig.embedding, dimension: dim === nativeDim ? null : dim },
                          },
                        },
                      });
                      toast.success(`Dimension set to ${dim}. Clear and regenerate to apply.`);
                      if (onInfospaceUpdate) {
                        const updated = await InfospacesService.getInfospace({ infospaceId: infospace.id });
                        onInfospaceUpdate(updated);
                      }
                    } catch {
                      toast.error('Failed to update dimension');
                    }
                  }}
                >
                  <SelectTrigger className="w-[90px] h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleDims.map(d => (
                      <SelectItem key={d} value={String(d)}>
                        {d}d{d === nativeDim ? ' (native)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            })()}
          </div>

          {/* Statistics */}
          {stats && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Embedding Coverage</span>
                <span className="text-sm text-muted-foreground">
                  {stats.embedded_chunks.toLocaleString()} / {stats.total_chunks.toLocaleString()} chunks
                </span>
              </div>
              <Progress value={stats.coverage_percentage} className="h-2" />
              <div className="text-xs text-center text-muted-foreground">
                {stats.coverage_percentage.toFixed(1)}% embedded
              </div>

              <div className="grid grid-cols-4 gap-3 pt-2">
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.documents.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Documents</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.sub_assets.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Parts</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.total_chunks.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Chunks</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.embedded_chunks.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Embedded</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Documents are embedded whole for similarity matching. Parts (pages, rows) are embedded separately for precise search retrieval.
              </p>
            </div>
          )}

          {isLoadingStats && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {/* Related assets toggle for Asset Manager */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="pr-4">
              <div className="text-sm font-medium">
                Related articles in Asset Manager
              </div>
              <div className="text-xs text-muted-foreground">
                When enabled, article and web assets in the Asset Manager will show a
                semantic \"Related Articles\" panel. This uses the same embeddings
                configuration as semantic search.
              </div>
            </div>
            <Switch
              checked={!!infospace.enable_related_assets}
              disabled={isUpdatingRelatedAssets}
              onCheckedChange={handleToggleRelatedAssets}
              aria-label="Toggle related articles in Asset Manager"
            />
          </div>

          {/* Info Alert */}
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>Auto-embedding Active</AlertTitle>
            <AlertDescription>
              All new assets will be automatically embedded for semantic search. You can regenerate embeddings anytime.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Change Model Dialog */}
      <Dialog open={showChangeModelDialog} onOpenChange={setShowChangeModelDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Change Embedding Model</DialogTitle>
                <DialogDescription>
                  Select a new embedding model. You'll need to clear and regenerate embeddings after changing the model.
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadAvailableModels(true)}
                disabled={isLoadingModels}
              >
                {isLoadingModels ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Discovering...</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-2" /> Discover Models</>
                )}
              </Button>
            </div>
          </DialogHeader>
          
          {(() => {
            const activeKeyNames = cloudEmbeddingProviders
              .filter(p => apiKeys[p.id])
              .map(p => p.name);
            return activeKeyNames.length > 0 ? (
              <Alert>
                <Key className="h-4 w-4" />
                <AlertTitle>Runtime API Keys Detected</AlertTitle>
                <AlertDescription>
                  Using runtime keys for: {activeKeyNames.join(', ')}. These are for this session only. For background tasks, save keys in <a href="/accounts/settings" className="underline text-blue-600 dark:text-blue-400">Settings</a>.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Add API Keys for Cloud Providers</AlertTitle>
                <AlertDescription>
                  To access cloud embedding models, add runtime keys in the Provider Hub, or save them permanently in <a href="/accounts/settings" className="underline text-blue-600 dark:text-blue-400">Settings</a> for background tasks.
                </AlertDescription>
              </Alert>
            );
          })()}
          
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Important</AlertTitle>
            <AlertDescription>
              Changing the model doesn't automatically re-embed your content. After changing, click "Clear" to remove old embeddings, then "Regenerate" to create new ones with the new model.
            </AlertDescription>
          </Alert>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Current Model</Label>
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                <span className="font-medium">{embeddingSel?.model_name}</span>
                {embeddingSel?.provider_key && (
                  <Badge variant="secondary">{embeddingSel.provider_key}</Badge>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="new-embedding-model">New Embedding Model</Label>
                {availableModels.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {availableModels.length} models from {Object.keys(modelsByProvider).length} providers
                  </span>
                )}
              </div>
              <Select value={newModel} onValueChange={setNewModel}>
                <SelectTrigger id="new-embedding-model">
                  <SelectValue placeholder="Select a new model" />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingModels ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : availableModels.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No embedding models available. Pull a model from the Model Manager or add API keys.
                    </div>
                  ) : (
                    Object.entries(modelsByProvider).map(([provider, models]) => {
                      const providerInfo = getProviderInfo(provider);
                      return (
                        <div key={provider}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-2">
                            {providerInfo.name}
                            {providerInfo.badge && (
                              <Badge variant="outline" className="text-[10px] h-4">
                                {providerInfo.badge}
                              </Badge>
                            )}
                          </div>
                          {models.map((model) => (
                            <SelectItem key={model.name} value={model.name}>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{model.name}</span>
                                <Badge variant="secondary" className="ml-auto">
                                  {model.dimension}d
                                </Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </div>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
              {newModel && (
                <p className="text-xs text-muted-foreground">
                  {availableModels.find(m => m.name === newModel)?.description || 'Embedding model'}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChangeModelDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangeModel} disabled={!newModel || isEnabling}>
              {isEnabling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Changing...
                </>
              ) : (
                'Change Model'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

