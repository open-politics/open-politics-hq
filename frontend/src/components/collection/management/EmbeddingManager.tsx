'use client';

import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Database, RefreshCw, Play, Info, Trash2, Settings, Key, Eye, EyeOff, ExternalLink } from "lucide-react";
import { InfospaceRead, InfospacesService, EmbeddingsService } from '@/client';
import { toast } from 'sonner';
import { useProvidersStore, ProviderMetadata } from '@/zustand_stores/storeProviders';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Separator } from '@/components/ui/separator';

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
  const [keyVisibility, setKeyVisibility] = useState<Record<string, boolean>>({});

  const isEnabled = !!embeddingSel?.model_name;

  const modelsByProvider = availableModels.reduce((acc, model) => {
    if (!acc[model.provider]) acc[model.provider] = [];
    acc[model.provider].push(model);
    return acc;
  }, {} as Record<string, EmbeddingModel[]>);

  useEffect(() => {
    loadAvailableModels();
    if (isEnabled) loadStats();
  }, [infospace.id, isEnabled]);

  const loadAvailableModels = async (forceRefresh = false) => {
    if (!infospace?.id) return;
    setIsLoadingModels(true);
    try {
      // Bulk discover — no provider_key, no runtime_key. The backend returns the
      // static model catalog across all embedding providers.
      const response = await EmbeddingsService.discoverEmbeddingModels({
        infospaceId: infospace.id,
        requestBody: {},
      });
      const models: EmbeddingModel[] = (response.models || []).map(m => ({
        name: m.name, provider: m.provider, dimension: m.dimension,
        description: m.description || undefined, max_sequence_length: m.max_sequence_length ?? undefined
      }));
      setAvailableModels(models);
      if (forceRefresh) {
        const providerCounts = models.reduce((acc, m) => { acc[m.provider] = (acc[m.provider] || 0) + 1; return acc; }, {} as Record<string, number>);
        const summary = Object.entries(providerCounts).map(([p, c]) => `${p}: ${c}`).join(', ');
        toast.success(`Discovered ${models.length} models (${summary})`);
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
      setStats({
        total_assets: response.total_assets,
        documents: (response as any).documents ?? response.total_assets,
        sub_assets: (response as any).sub_assets ?? 0,
        total_chunks: response.total_chunks,
        embedded_chunks: response.embedded_chunks,
        coverage_percentage: response.coverage_percentage,
        models_used: response.models_used as Record<string, number>
      });
    } catch (error: any) {
      console.error('Failed to load embedding stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

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

  const getProviderInfo = (provider: string) => {
    const storeEntry = storeProviders.embedding.find(p => p.id === provider);
    if (storeEntry) {
      return { name: storeEntry.name, requiresKey: storeEntry.requires_api_key, docUrl: storeEntry.api_key_url, badge: storeEntry.is_local ? 'Local' : 'Cloud' };
    }
    return { name: provider, requiresKey: false };
  };

  const buildValidApiKeys = (): Record<string, string> => {
    const keys: Record<string, string> = {};
    for (const p of cloudEmbeddingProviders) { const k = apiKeys[p.id]; if (k) keys[p.id] = k; }
    return keys;
  };

  const handleEnableEmbeddings = async () => {
    if (!selectedModel) { toast.error('Please select an embedding model first'); return; }
    setIsEnabling(true);
    try {
      const model = availableModels.find(m => m.name === selectedModel);
      const currentConfig = (infospace.enrichment_config || {}) as Record<string, any>;
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: { enrichment_config: { ...currentConfig, embedding: model ? { provider_key: model.provider, model_name: selectedModel } : undefined } },
      });
      toast.success('Embeddings enabled! New assets will be automatically embedded.');
      const validApiKeys = buildValidApiKeys();
      toast.info('Generating embeddings for existing assets...');
      await EmbeddingsService.generateInfospaceEmbeddings({
        infospaceId: infospace.id,
        requestBody: { overwrite: false, api_keys: Object.keys(validApiKeys).length > 0 ? validApiKeys : undefined },
      });
      if (onInfospaceUpdate) {
        const updated = await InfospacesService.getInfospace({ infospaceId: infospace.id });
        onInfospaceUpdate(updated);
      }
      setShowConfigDialog(false);
      setTimeout(() => loadStats(), 2000);
    } catch (error: any) {
      console.error('Failed to enable embeddings:', error);
      toast.error(`Failed to enable embeddings: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    } finally {
      setIsEnabling(false);
    }
  };

  const handleDisableEmbeddings = async () => {
    if (!window.confirm('Disable embeddings? Existing vectors are preserved but new assets won\'t be embedded.')) return;
    setIsEnabling(true);
    try {
      const currentConfig = (infospace.enrichment_config || {}) as Record<string, any>;
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: { enrichment_config: { ...currentConfig, embedding: null } },
      });
      toast.success('Embeddings disabled');
      if (onInfospaceUpdate) {
        const updated = await InfospacesService.getInfospace({ infospaceId: infospace.id });
        onInfospaceUpdate(updated);
      }
    } catch (error: any) {
      toast.error(`Failed: ${error?.body?.detail || error?.message || 'Unknown error'}`);
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
        requestBody: { overwrite: true, api_keys: Object.keys(validApiKeys).length > 0 ? validApiKeys : undefined },
      });
      toast.success('Regenerating embeddings in background.');
      setTimeout(() => loadStats(), 3000);
    } catch (error: any) {
      toast.error(`Failed: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearEmbeddings = async () => {
    if (!window.confirm('Clear all embeddings? Vector data is removed but assets are preserved. You can regenerate after.')) return;
    setIsGenerating(true);
    try {
      await EmbeddingsService.clearInfospaceEmbeddings({ infospaceId: infospace.id });
      toast.success('Embeddings cleared');
      setStats(s => s ? { ...s, total_chunks: 0, embedded_chunks: 0, coverage_percentage: 0, models_used: {} } : null);
      setTimeout(() => loadStats(), 500);
    } catch (error: any) {
      toast.error(`Failed: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleChangeModel = async () => {
    if (!newModel) { toast.error('Please select a new embedding model'); return; }
    setIsEnabling(true);
    try {
      const model = availableModels.find(m => m.name === newModel);
      if (!model) { toast.error('Selected model not found'); return; }
      const currentConfig = (infospace.enrichment_config || {}) as Record<string, any>;
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: { enrichment_config: { ...currentConfig, embedding: { provider_key: model.provider, model_name: newModel } } },
      });
      toast.success(`Model changed to ${newModel}. Clear and regenerate to apply.`);
      setShowChangeModelDialog(false);
      if (onInfospaceUpdate) {
        const updated = await InfospacesService.getInfospace({ infospaceId: infospace.id });
        onInfospaceUpdate(updated);
      }
    } catch (error: any) {
      toast.error(`Failed: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    } finally {
      setIsEnabling(false);
    }
  };

  const handleToggleRelatedAssets = async (value: boolean) => {
    setIsUpdatingRelatedAssets(true);
    try {
      await InfospacesService.updateInfospace({ infospaceId: infospace.id, requestBody: { enable_related_assets: value } });
      toast.success(value ? 'Related articles enabled' : 'Related articles disabled');
      if (onInfospaceUpdate) {
        const updated = await InfospacesService.getInfospace({ infospaceId: infospace.id });
        onInfospaceUpdate(updated);
      }
    } catch (error: any) {
      toast.error(`Failed: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    } finally {
      setIsUpdatingRelatedAssets(false);
    }
  };

  // --- Dimension selector logic ---
  const activeModel = availableModels.find(m => m.name === embeddingSel?.model_name);
  const nativeDim = activeModel?.dimension;
  const currentDim = embeddingSel?.dimension || nativeDim;
  const SUPPORTED_DIMS = [384, 512, 768, 1024, 1536, 2048];
  const eligibleDims = nativeDim ? SUPPORTED_DIMS.filter(d => d <= nativeDim) : currentDim ? [currentDim] : [];

  const handleDimensionChange = async (val: string) => {
    const dim = parseInt(val);
    const currentConfig = (infospace.enrichment_config || {}) as Record<string, any>;
    try {
      await InfospacesService.updateInfospace({
        infospaceId: infospace.id,
        requestBody: { enrichment_config: { ...currentConfig, embedding: { ...currentConfig.embedding, dimension: dim === nativeDim ? null : dim } } },
      });
      toast.success(`Dimension set to ${dim}. Clear and regenerate to apply.`);
      if (onInfospaceUpdate) {
        const updated = await InfospacesService.getInfospace({ infospaceId: infospace.id });
        onInfospaceUpdate(updated);
      }
    } catch {
      toast.error('Failed to update dimension');
    }
  };

  // --- Model selector shared between dialogs ---
  const renderModelSelector = (value: string, onChange: (v: string) => void, id?: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Select a model" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {isLoadingModels ? (
          <div className="flex items-center justify-center p-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : availableModels.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">No models available. Pull a model or add API keys.</div>
        ) : (
          Object.entries(modelsByProvider).map(([provider, models]) => {
            const pi = getProviderInfo(provider);
            return (
              <div key={provider}>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-2">
                  {pi.name}
                  {pi.badge && <Badge variant="outline" className="text-[10px] h-4">{pi.badge}</Badge>}
                  {pi.requiresKey && !apiKeys[provider] && <Badge variant="destructive" className="text-[10px] h-4">Needs Key</Badge>}
                </div>
                {models.map(m => (
                  <SelectItem key={m.name} value={m.name}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      <Badge variant="secondary" className="ml-auto">{m.dimension}d</Badge>
                    </div>
                  </SelectItem>
                ))}
              </div>
            );
          })
        )}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-end">
        {!isEnabled ? (
          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setShowConfigDialog(true)} disabled={isEnabling}>
            Enable
          </Button>
        ) : (
          <></>
        )}
      </div>
      

      {isEnabled ? (
        <div className="space-y-1.5">
          {/* Model + actions row */}
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            Coverage of embeddings for infospace generated with model:<span className="text-muted-foreground truncate">{embeddingSel?.model_name}</span>
            {eligibleDims.length <= 1 ? (
              <span className="text-muted-foreground">({currentDim || '?'}d)</span>
            ) : (
              <Select value={String(currentDim)} onValueChange={handleDimensionChange}>
                <SelectTrigger className="h-5 w-[100px] text-[10px] px-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {eligibleDims.map(d => (
                    <SelectItem key={d} value={String(d)}>{d}d{d === nativeDim ? ' (native)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-0.5 ml-auto">
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setShowChangeModelDialog(true)} title="Change model">
                <Settings className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={loadStats} disabled={isLoadingStats} title="Refresh stats">
                {isLoadingStats ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={handleRegenerateEmbeddings} disabled={isGenerating} title="Regenerate all">
                {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={handleClearEmbeddings} disabled={isGenerating} title="Clear all">
                <Trash2 className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive" onClick={handleDisableEmbeddings} disabled={isEnabling}>
                Disable
              </Button>
            </div>
          </div>

          {/* Coverage */}
          {stats && (
            <div className="space-y-1">
              <Progress value={stats.coverage_percentage} className="h-1" />
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                <span className="font-medium text-foreground">{stats.coverage_percentage.toFixed(0)}%</span>
                <span>{stats.documents.toLocaleString()} docs</span>
                <span>{stats.total_chunks.toLocaleString()} chunks</span>
                <span>{stats.embedded_chunks.toLocaleString()} embedded</span>
              </div>
            </div>
          )}

          {/* Related articles */}
          <div className="flex items-center justify-between pt-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[11px] text-muted-foreground cursor-default">Related articles</span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-56">
                  <p className="text-xs">Show semantically related articles in the Asset Manager using embedding similarity</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Switch
              checked={!!infospace.enable_related_assets}
              disabled={isUpdatingRelatedAssets}
              onCheckedChange={handleToggleRelatedAssets}
              className="scale-75 origin-right"
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground flex items-center justify-end">
          Enable and configure embedding generation for semantic search and related articles feature.
        </p>
      )}

      {/* Enable Embeddings Dialog */}
      <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Enable Semantic Search</DialogTitle>
                <DialogDescription>Choose an embedding model. New assets will be automatically embedded.</DialogDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowApiKeysDialog(!showApiKeysDialog)}>
                <Key className="h-4 w-4 mr-2" />{showApiKeysDialog ? 'Hide' : 'API Keys'}
              </Button>
            </div>
          </DialogHeader>

          {showApiKeysDialog && (
            <Alert>
              <Key className="h-4 w-4" />
              <AlertTitle>Runtime API Keys</AlertTitle>
              <AlertDescription className="space-y-3 mt-2">
                <p className="text-xs">Enter API keys for cloud providers. For background tasks, save keys in <a href="/accounts/settings" className="underline text-blue-600 dark:text-blue-400">Settings</a>.</p>
                {cloudEmbeddingProviders.map((p) => (
                  <div key={p.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`${p.id}-key`} className="text-xs font-medium">{p.api_key_name || `${p.name} API Key`}</Label>
                      {p.api_key_url && (
                        <a href={p.api_key_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                          Get Key <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Input id={`${p.id}-key`} type={keyVisibility[p.id] ? "text" : "password"} placeholder="Enter API key" value={apiKeys[p.id] || ''} onChange={(e) => setApiKey(p.id, e.target.value)} className="text-xs" />
                      <Button variant="ghost" size="sm" onClick={() => setKeyVisibility(prev => ({ ...prev, [p.id]: !prev[p.id] }))}>
                        {keyVisibility[p.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => loadAvailableModels(true)} disabled={isLoadingModels}>
                    {isLoadingModels ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Discovering...</> : <><RefreshCw className="h-4 w-4 mr-2" /> Discover Models</>}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="embedding-model">Embedding Model</Label>
                {availableModels.length > 0 && (
                  <span className="text-xs text-muted-foreground">{availableModels.length} models from {Object.keys(modelsByProvider).length} providers</span>
                )}
              </div>
              {renderModelSelector(selectedModel, setSelectedModel, "embedding-model")}
              {selectedModel && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{availableModels.find(m => m.name === selectedModel)?.description || 'Embedding model'}</p>
                  {(() => {
                    const model = availableModels.find(m => m.name === selectedModel);
                    const pi = model ? getProviderInfo(model.provider) : null;
                    return pi?.requiresKey && !apiKeys[model!.provider] && (
                      <p className="text-xs text-amber-600">This provider requires an API key. Add it above.</p>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfigDialog(false)}>Cancel</Button>
            <Button onClick={handleEnableEmbeddings} disabled={!selectedModel || isEnabling}>
              {isEnabling ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enabling...</> : <><Sparkles className="mr-2 h-4 w-4" />Enable & Generate</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Model Dialog */}
      <Dialog open={showChangeModelDialog} onOpenChange={setShowChangeModelDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Change Embedding Model</DialogTitle>
                <DialogDescription>You'll need to clear and regenerate after changing.</DialogDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => loadAvailableModels(true)} disabled={isLoadingModels}>
                {isLoadingModels ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Discovering...</> : <><RefreshCw className="h-4 w-4 mr-2" />Discover</>}
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Current Model</Label>
              <div className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm">
                <span className="font-medium">{embeddingSel?.model_name}</span>
                {embeddingSel?.provider_key && <Badge variant="secondary">{embeddingSel.provider_key}</Badge>}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="new-embedding-model">New Model</Label>
                {availableModels.length > 0 && (
                  <span className="text-xs text-muted-foreground">{availableModels.length} models</span>
                )}
              </div>
              {renderModelSelector(newModel, setNewModel, "new-embedding-model")}
              {newModel && <p className="text-xs text-muted-foreground">{availableModels.find(m => m.name === newModel)?.description || ''}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChangeModelDialog(false)}>Cancel</Button>
            <Button onClick={handleChangeModel} disabled={!newModel || isEnabling}>
              {isEnabling ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Changing...</> : 'Change Model'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
