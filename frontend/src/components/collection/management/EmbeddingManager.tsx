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
import { useProvidersStore } from '@/zustand_stores/storeProviders';
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
  const { apiKeys, setApiKey } = useProvidersStore();
  const [availableModels, setAvailableModels] = useState<EmbeddingModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(infospace.embedding_model || '');
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stats, setStats] = useState<EmbeddingStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showChangeModelDialog, setShowChangeModelDialog] = useState(false);
  const [showApiKeysDialog, setShowApiKeysDialog] = useState(false);
  const [newModel, setNewModel] = useState<string>('');
  
  // API key visibility toggles
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showVoyageKey, setShowVoyageKey] = useState(false);
  const [showJinaKey, setShowJinaKey] = useState(false);
  
  const isEnabled = !!infospace.embedding_model;
  
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
      // Use the new discovery endpoint with API keys
      // Filter out undefined/empty API keys
      const validApiKeys: Record<string, string> = {};
      if (apiKeys.openai) validApiKeys.openai = apiKeys.openai;
      if (apiKeys.voyage) validApiKeys.voyage = apiKeys.voyage;
      if (apiKeys.jina) validApiKeys.jina = apiKeys.jina;
      
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
  
  // Helper to get provider info
  const getProviderInfo = (provider: string) => {
    const info: Record<string, { name: string; requiresKey: boolean; docUrl?: string; badge?: string }> = {
      ollama: { name: 'Ollama', requiresKey: false, badge: 'Local' },
      openai: { name: 'OpenAI', requiresKey: true, docUrl: 'https://platform.openai.com/api-keys', badge: 'Cloud' },
      voyage: { name: 'Voyage AI', requiresKey: true, docUrl: 'https://dash.voyageai.com/', badge: 'Anthropic' },
      jina: { name: 'Jina AI', requiresKey: true, docUrl: 'https://jina.ai/', badge: 'Cloud' },
    };
    return info[provider] || { name: provider, requiresKey: false };
  };

  const handleEnableEmbeddings = async () => {
    if (!selectedModel) {
      toast.error('Please select an embedding model first');
      return;
    }

    setIsEnabling(true);
    try {
      // Update infospace with embedding model
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: {
          embedding_model: selectedModel,
        },
      });

      toast.success('Embeddings enabled! New assets will be automatically embedded.');
      
      // Filter out undefined/empty API keys
      const validApiKeys: Record<string, string> = {};
      if (apiKeys.openai) validApiKeys.openai = apiKeys.openai;
      if (apiKeys.voyage) validApiKeys.voyage = apiKeys.voyage;
      if (apiKeys.jina) validApiKeys.jina = apiKeys.jina;
      
      // Trigger initial embedding generation for existing assets
      toast.info('Generating embeddings for existing assets...');
      await EmbeddingsService.generateInfospaceEmbeddings({
        infospaceId: infospace.id,
        requestBody: {
          overwrite: false,
          async_processing: true,
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
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: {
          embedding_model: null as any,
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
      // Filter out undefined/empty API keys
      const validApiKeys: Record<string, string> = {};
      if (apiKeys.openai) validApiKeys.openai = apiKeys.openai;
      if (apiKeys.voyage) validApiKeys.voyage = apiKeys.voyage;
      if (apiKeys.jina) validApiKeys.jina = apiKeys.jina;
      
      await EmbeddingsService.generateInfospaceEmbeddings({
        infospaceId: infospace.id,
        requestBody: {
          overwrite: true,
          async_processing: true,
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

      // Update infospace with new model
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: {
          embedding_model: newModel,
          embedding_dim: model.dimension,
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <div>
              <CardTitle>Semantic Search (Embeddings)</CardTitle>
              <CardDescription>
                Enable AI-powered semantic search for your content
              </CardDescription>
            </div>
          </div>
          {!isEnabled ? (
            <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
              <DialogTrigger asChild>
                <Button variant="outline">
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
                      
                      {/* OpenAI */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="openai-key" className="text-xs font-medium">OpenAI API Key</Label>
                          <a 
                            href="https://platform.openai.com/api-keys" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                          >
                            Get Key <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            id="openai-key"
                            type={showOpenAIKey ? "text" : "password"}
                            placeholder="sk-..."
                            value={apiKeys.openai || ''}
                            onChange={(e) => setApiKey('openai', e.target.value)}
                            className="text-xs"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                          >
                            {showOpenAIKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                      
                      {/* Voyage AI */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="voyage-key" className="text-xs font-medium">Voyage AI API Key (Anthropic)</Label>
                          <a 
                            href="https://dash.voyageai.com/" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                          >
                            Get Key <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            id="voyage-key"
                            type={showVoyageKey ? "text" : "password"}
                            placeholder="pa-..."
                            value={apiKeys.voyage || ''}
                            onChange={(e) => setApiKey('voyage', e.target.value)}
                            className="text-xs"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowVoyageKey(!showVoyageKey)}
                          >
                            {showVoyageKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                      
                      {/* Jina AI */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="jina-key" className="text-xs font-medium">Jina AI API Key</Label>
                          <a 
                            href="https://jina.ai/" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                          >
                            Get Key <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            id="jina-key"
                            type={showJinaKey ? "text" : "password"}
                            placeholder="jina_..."
                            value={apiKeys.jina || ''}
                            onChange={(e) => setApiKey('jina', e.target.value)}
                            className="text-xs"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowJinaKey(!showJinaKey)}
                          >
                            {showJinaKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                      
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
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowChangeModelDialog(true)}
                disabled={isEnabling}
                title="Change embedding model"
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={loadStats}
                disabled={isLoadingStats}
                title="Refresh statistics"
              >
                {isLoadingStats ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerateEmbeddings}
                disabled={isGenerating}
                title="Regenerate all embeddings"
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearEmbeddings}
                disabled={isGenerating}
                title="Clear all embeddings"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisableEmbeddings}
                disabled={isEnabling}
              >
                Disable
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      
      {isEnabled && (
        <CardContent>
          <div className="space-y-4">
            {/* Current Configuration */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <div className="text-sm font-medium">Current Model</div>
                <div className="text-xs text-muted-foreground">{infospace.embedding_model}</div>
              </div>
              <Badge variant="default">Active</Badge>
            </div>

            {/* Statistics */}
            {stats && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Embedding Coverage</span>
                  <span className="text-sm text-muted-foreground">
                    {stats.embedded_chunks} / {stats.total_chunks} chunks
                  </span>
                </div>
                <Progress value={stats.coverage_percentage} className="h-2" />
                <div className="text-xs text-center text-muted-foreground">
                  {stats.coverage_percentage.toFixed(1)}% of assets embedded
                </div>

                <div className="grid grid-cols-3 gap-4 pt-2">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{stats.total_assets}</div>
                    <div className="text-xs text-muted-foreground">Assets</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{stats.total_chunks}</div>
                    <div className="text-xs text-muted-foreground">Chunks</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{stats.embedded_chunks}</div>
                    <div className="text-xs text-muted-foreground">Embedded</div>
                  </div>
                </div>
              </div>
            )}

            {isLoadingStats && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}

            {/* Info Alert */}
            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertTitle>Auto-embedding Active</AlertTitle>
              <AlertDescription>
                All new assets will be automatically embedded for semantic search. You can regenerate embeddings anytime.
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
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
          
          {apiKeys.openai || apiKeys.voyage || apiKeys.jina ? (
            <Alert>
              <Key className="h-4 w-4" />
              <AlertTitle>Runtime API Keys Detected</AlertTitle>
              <AlertDescription>
                Using runtime keys for: 
                {apiKeys.openai && ' OpenAI'}
                {apiKeys.voyage && ' Voyage AI'}
                {apiKeys.jina && ' Jina AI'}
                . These are for this session only. For background tasks, save keys in <a href="/accounts/settings" className="underline text-blue-600 dark:text-blue-400">Settings</a>.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Add API Keys for Cloud Providers</AlertTitle>
              <AlertDescription>
                To access OpenAI, Voyage AI, or Jina AI models, add runtime keys in the Provider Hub, or save them permanently in <a href="/accounts/settings" className="underline text-blue-600 dark:text-blue-400">Settings</a> for background tasks.
              </AlertDescription>
            </Alert>
          )}
          
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
                <span className="font-medium">{infospace.embedding_model}</span>
                {infospace.embedding_dim && (
                  <Badge variant="secondary">{infospace.embedding_dim}d</Badge>
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
    </Card>
  );
}

