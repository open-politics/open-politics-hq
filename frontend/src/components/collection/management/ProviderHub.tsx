'use client';

import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Brain,
  Search,
  MapPin,
  Database,
  ScanText,
  Key,
  CheckCircle,
  XCircle,
  ExternalLink,
  Loader2,
  Server,
  Cloud,
  AlertCircle,
  Heart,
  Code2,
  Lock,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  Filter,
  Info,
  Tags,
  NotebookText
} from "lucide-react";
import { useProvidersStore, ProviderCapability, ProviderMetadata } from '@/zustand_stores/storeProviders';
import { toast } from 'sonner';
import { UtilsService, UsersService, ProviderInfo, ProviderModel } from '@/client';

interface OllamaAvailableModel {
  name: string;
  size: string;
  description: string;
  capabilities?: string[];
  pulls?: string;
  parameters?: string;
  updated?: string;
}

interface ProviderHubProps {
  className?: string;
}

const CAPABILITY_ICONS: Record<ProviderCapability, React.ReactNode> = {
  llm: <Brain className="w-4 h-4" />,
  embedding: <Database className="w-4 h-4" />,
  web_search: <Search className="w-4 h-4" />,
  geocoding: <MapPin className="w-4 h-4" />,
  ocr: <ScanText className="w-4 h-4" />,
  annotation: <Tags className="w-4 h-4" />,
};

const CAPABILITY_NAMES: Record<ProviderCapability, string> = {
  llm: 'Language Models',
  embedding: 'Embeddings',
  web_search: 'Web Search',
  geocoding: 'Geocoding',
  ocr: 'OCR',
  annotation: 'Annotation',
};

const CAPABILITY_DESCRIPTIONS: Record<ProviderCapability, string> = {
  llm: 'AI models for chat, classification, and structured output',
  embedding: 'Convert text into vector embeddings for semantic search',
  web_search: 'Search the web for real-time information',
  geocoding: 'Convert location names to coordinates and vice versa',
  ocr: 'Extract text from images and scanned documents',
  annotation: 'AI-powered annotation and structured extraction',
};

export default function ProviderHub({ className = '' }: ProviderHubProps) {
  const {
    providers,
    apiKeys,
    selections,
    setProviders,
    setApiKey,
    removeApiKey,
    setSelection,
    getProvider,
    hasApiKey,
    needsApiKey,
  } = useProvidersStore();

  const [isLoading, setIsLoading] = useState(true);
  const [activeCapability, setActiveCapability] = useState<ProviderCapability>('llm');
  const [tempApiKeys, setTempApiKeys] = useState<Record<string, string>>({});
  const [storedProviders, setStoredProviders] = useState<string[]>([]); // Providers with backend-stored keys
  const [isSavingToBackend, setIsSavingToBackend] = useState<string | null>(null);
  const [isTransferringAll, setIsTransferringAll] = useState(false);

  // Ollama model management state
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaAvailable, setOllamaAvailable] = useState<OllamaAvailableModel[]>([]);
  const [isPullingModel, setIsPullingModel] = useState<string | null>(null);
  const [isRemovingModel, setIsRemovingModel] = useState<string | null>(null);
  const [isOllamaDialogOpen, setIsOllamaDialogOpen] = useState(false);
  const [ollamaCustomName, setOllamaCustomName] = useState('');
  const [ollamaSearch, setOllamaSearch] = useState('');
  const [ollamaSortBy, setOllamaSortBy] = useState('popular');
  const [ollamaCapFilter, setOllamaCapFilter] = useState('');
  const [ollamaSizeFilter, setOllamaSizeFilter] = useState('');

  // Fetch unified providers and stored credentials on mount
  useEffect(() => {
    fetchProviders();
    fetchStoredCredentials();
    fetchOllamaModels();
    fetchOllamaAvailable();
  }, []);

  const fetchProviders = async () => {
    setIsLoading(true);
    try {
      const response = await UtilsService.getUnifiedProviders();
      const data = response as {
        providers: Record<ProviderCapability, ProviderMetadata[]>;
        capabilities: string[];
      };
      
      // Validate response structure
      if (!data || !data.providers) {
        throw new Error('Invalid response structure: missing providers');
      }
      
      // Update store with provider metadata for each capability
      for (const capability of Object.keys(data.providers) as ProviderCapability[]) {
        const providersForCapability = data.providers[capability];
        if (Array.isArray(providersForCapability)) {
          setProviders(capability, providersForCapability);
        }
      }
      
      toast.success('Loaded provider configurations');
    } catch (error) {
      console.error('Failed to fetch providers:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load providers');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStoredCredentials = async () => {
    try {
      const providers = await UsersService.listCredentialProviders();
      setStoredProviders(providers);
    } catch (error) {
      console.error('Failed to fetch stored credentials:', error);
      // Don't show error toast - user might not have any stored credentials yet
    }
  };

  const fetchOllamaModels = async () => {
    try {
      const response = await UtilsService.getProviders();
      const ollama = response.providers.find((p: ProviderInfo) => p.provider_name === 'ollama');
      setOllamaModels(ollama ? ollama.models.map((m: ProviderModel) => m.name) : []);
    } catch { /* ignore */ }
  };

  const fetchOllamaAvailable = async () => {
    try {
      const data = await UtilsService.getOllamaAvailableModels({ sort: 'popular', limit: 50 }) as any;
      setOllamaAvailable((data.models || []) as OllamaAvailableModel[]);
    } catch {
      setOllamaAvailable([
        { name: "llama3.2:3b", size: "~2.0GB", description: "Meta's balanced performance model", capabilities: ["tools"], pulls: "35.6M" },
        { name: "mistral:7b", size: "~4.1GB", description: "Mistral 7B - excellent for reasoning", capabilities: ["tools"], pulls: "19.4M" },
      ]);
    }
  };

  const handlePullModel = async (modelName: string) => {
    setIsPullingModel(modelName);
    try {
      await UtilsService.pullOllamaModel({ modelName });
      toast.success(`Model ${modelName} pulled successfully`);
      await fetchOllamaModels();
    } catch { toast.error(`Failed to pull model ${modelName}`); }
    finally { setIsPullingModel(null); }
  };

  const handleRemoveModel = async (modelName: string) => {
    setIsRemovingModel(modelName);
    try {
      await UtilsService.removeOllamaModel({ modelName });
      toast.success(`Model ${modelName} removed`);
      await fetchOllamaModels();
    } catch { toast.error(`Failed to remove model ${modelName}`); }
    finally { setIsRemovingModel(null); }
  };

  const parseTimeAgo = (s: string): number => {
    const m = s.match(/(\d+)\s*(day|week|month|year)s?\s*ago/i);
    if (!m) return 0;
    const v = parseInt(m[1]);
    return m[2] === 'day' ? v : m[2] === 'week' ? v * 7 : m[2] === 'month' ? v * 30 : v * 365;
  };

  const filteredOllamaModels = ollamaAvailable
    .filter(m => {
      if (ollamaSearch && !m.name.toLowerCase().includes(ollamaSearch.toLowerCase()) && !m.description.toLowerCase().includes(ollamaSearch.toLowerCase())) return false;
      if (ollamaCapFilter && ollamaCapFilter !== 'all' && !m.capabilities?.includes(ollamaCapFilter)) return false;
      if (ollamaSizeFilter && ollamaSizeFilter !== 'all') {
        const sz = parseFloat(m.size.replace(/[^0-9.]/g, ''));
        if (ollamaSizeFilter === 'small' && sz >= 2) return false;
        if (ollamaSizeFilter === 'medium' && (sz < 2 || sz > 10)) return false;
        if (ollamaSizeFilter === 'large' && sz <= 10) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (ollamaSortBy === 'name') return a.name.localeCompare(b.name);
      if (ollamaSortBy === 'recent') return parseTimeAgo(a.updated || '') - parseTimeAgo(b.updated || '');
      if (ollamaSortBy === 'size') return parseFloat(a.size.replace(/[^0-9.]/g, '')) - parseFloat(b.size.replace(/[^0-9.]/g, ''));
      // popular
      const ap = parseFloat((a.pulls || '0').replace(/[^0-9.]/g, '')) * ((a.pulls || '').includes('M') ? 1e6 : (a.pulls || '').includes('K') ? 1e3 : 1);
      const bp = parseFloat((b.pulls || '0').replace(/[^0-9.]/g, '')) * ((b.pulls || '').includes('M') ? 1e6 : (b.pulls || '').includes('K') ? 1e3 : 1);
      return bp - ap;
    });

  const handleSaveApiKey = (providerId: string, saveToBackend: boolean = false) => {
    const key = tempApiKeys[providerId]?.trim();
    if (!key) {
      toast.error('Please enter an API key');
      return;
    }

    if (saveToBackend) {
      handleSaveToBackend(providerId, key);
    } else {
      // Save to frontend only (runtime key)
      setApiKey(providerId, key);
      setTempApiKeys((prev) => ({ ...prev, [providerId]: '' }));
      toast.success(`Runtime API key saved for ${getProvider(providerId)?.name}`);
    }
  };

  const handleSaveToBackend = async (providerId: string, key?: string) => {
    const apiKey = key || tempApiKeys[providerId]?.trim();
    if (!apiKey) {
      toast.error('Please enter an API key');
      return;
    }

    setIsSavingToBackend(providerId);
    try {
      await UsersService.saveCredentials({
        requestBody: {
          credentials: { [providerId]: apiKey }
        }
      });
      
      toast.success(`API key saved securely for ${getProvider(providerId)?.name} (available for scheduled tasks)`);
      setTempApiKeys((prev) => ({ ...prev, [providerId]: '' }));
      setStoredProviders((prev) => [...new Set([...prev, providerId])]);
    } catch (error) {
      console.error('Failed to save credential:', error);
      toast.error('Failed to save API key to backend');
    } finally {
      setIsSavingToBackend(null);
    }
  };

  const handleRemoveApiKey = (providerId: string) => {
    removeApiKey(providerId);
    toast.success(`Runtime API key removed for ${getProvider(providerId)?.name}`);
  };

  const handleRemoveStoredKey = async (providerId: string) => {
    if (!confirm(`Remove stored API key for ${getProvider(providerId)?.name}? Scheduled tasks using this provider will fail.`)) {
      return;
    }

    try {
      await UsersService.deleteCredential({ providerId });
      toast.success(`Stored API key removed for ${getProvider(providerId)?.name}`);
      setStoredProviders((prev) => prev.filter(id => id !== providerId));
    } catch (error) {
      console.error('Failed to delete credential:', error);
      toast.error('Failed to remove stored API key');
    }
  };

  const handleTransferAllToBackend = async () => {
    // Get all runtime keys that aren't already stored
    const keysToTransfer = Object.entries(apiKeys).filter(
      ([providerId, key]) => key && !storedProviders.includes(providerId)
    );

    if (keysToTransfer.length === 0) {
      toast.info('No runtime keys to transfer');
      return;
    }

    if (!confirm(`Transfer ${keysToTransfer.length} runtime key(s) to encrypted backend storage for scheduled tasks?`)) {
      return;
    }

    setIsTransferringAll(true);
    try {
      // Build credentials object
      const credentials = Object.fromEntries(keysToTransfer);
      
      await UsersService.saveCredentials({
        requestBody: { credentials }
      });

      const providerNames = keysToTransfer.map(([id]) => getProvider(id)?.name || id).join(', ');
      toast.success(`Transferred ${keysToTransfer.length} key(s) to backend: ${providerNames}`);
      
      // Update stored providers list
      setStoredProviders((prev) => [...new Set([...prev, ...keysToTransfer.map(([id]) => id)])]);
    } catch (error) {
      console.error('Failed to transfer keys:', error);
      toast.error('Failed to transfer runtime keys to backend');
    } finally {
      setIsTransferringAll(false);
    }
  };

  const handleSelectProvider = (capability: ProviderCapability, providerId: string) => {
    setSelection(capability, { providerId });
    // Sync to backend so preferences persist across sessions
    useProvidersStore.getState().syncToBackend();
    toast.success(`Selected ${getProvider(providerId)?.name} for ${CAPABILITY_NAMES[capability]}`);
  };

  const renderProviderCard = (provider: ProviderMetadata, capability: ProviderCapability) => {
    const isSelected = selections[capability]?.providerId === provider.id;
    const hasRuntimeKey = hasApiKey(provider.id);
    const hasStoredKey = storedProviders.includes(provider.id);
    const needsKey = needsApiKey(provider.id);
    const showApiKeyWarning = needsKey && !hasRuntimeKey && !hasStoredKey;

    return (
      <Card 
        key={provider.id}
        className={`transition-all duration-200 w-full overflow-hidden ${
          isSelected 
            ? 'border-blue-500 dark:border-blue-600 bg-blue-50/30 dark:bg-blue-950/20' 
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }`}
      >
        <CardHeader className="p-2.5 pb-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                <CardTitle className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {provider.name}
                </CardTitle>
                {provider.is_local && (
                  <Badge variant="outline" className="text-[11px] px-1.5 py-0 bg-slate-50 dark:bg-slate-900">
                    <Server className="w-2.5 h-2.5 mr-0.5" />
                    Local
                  </Badge>
                )}
                {provider.is_oss && (
                  <Badge variant="outline" className="text-[11px] px-1.5 py-0 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800">
                    <Code2 className="w-2.5 h-2.5 mr-0.5" />
                    Open Source
                  </Badge>
                )}
                {provider.is_free && (
                  <Badge variant="outline" className="text-[11px] px-1.5 py-0 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
                    <Heart className="w-2.5 h-2.5 mr-0.5" />
                    Free
                  </Badge>
                )}
                {provider.has_env_fallback && (
                  <Badge variant="outline" className="text-[11px] px-1.5 py-0 bg-green-50 dark:bg-green-950">
                    <CheckCircle className="w-2.5 h-2.5 mr-0.5 text-green-600" />
                    Configured
                  </Badge>
                )}
              </div>
              <CardDescription className="flex items-start justify-start gap-1 text-xs text-gray-600 dark:text-gray-400 leading-snug">
                <NotebookText className="w-2.5 h-2.5 shrink-0 mt-1" />
                <span>{provider.description}</span>
              </CardDescription>
            </div>
            
            <Button
              variant={isSelected ? "default" : "outline"}
              size="sm"
              onClick={() => handleSelectProvider(capability, provider.id)}
              disabled={showApiKeyWarning}
              className="shrink-0 h-6 px-2 text-xs"
            >
              {isSelected ? 'Active' : 'Select'}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="px-2.5 pb-2.5 pt-0 space-y-1.5">
          {/* Features */}
          {provider.features && provider.features.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {provider.features.map((feature) => (
                <Badge key={feature} variant="secondary" className="text-[11px] px-1.5 py-0">
                  {feature}
                </Badge>
              ))}
            </div>
          )}

          {/* Rate limit info */}
          {provider.rate_limited && provider.rate_limit_info && (
            <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {provider.rate_limit_info}
            </div>
          )}

          {/* API Key Management */}
          {provider.requires_api_key && (
            <div className="space-y-1.5 pt-1 border-t border-gray-200 dark:border-gray-700">
              {/* Header with Get Key link */}
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium flex items-center gap-1 text-gray-700 dark:text-gray-300">
                  <Key className="w-3 h-3 shrink-0" />
                  {provider.api_key_name || 'API Key'}
                </Label>
                {provider.api_key_url && (
                  <a
                    href={provider.api_key_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 shrink-0"
                  >
                    Get Key
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {/* Show warning first if no keys at all */}
              {showApiKeyWarning && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-700 dark:text-amber-400">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>API key required to use this provider</span>
                </div>
              )}

              {/* Current Keys Status */}
              {(hasStoredKey || hasRuntimeKey) && (
                <div className="space-y-1.5">
                  {/* Stored Key */}
                  {hasStoredKey && (
                    <div className="flex items-center justify-between gap-2 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded bg-gray-50/30 dark:bg-gray-900/30">
                      <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 min-w-0">
                        <Lock className="w-3 h-3 shrink-0 text-green-600 dark:text-green-500" />
                        <span className="truncate">Encrypted for scheduled tasks</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveStoredKey(provider.id)}
                        className="h-5 px-1.5 text-[11px] text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 shrink-0"
                      >
                        Remove
                      </Button>
                    </div>
                  )}

                  {/* Runtime Key */}
                  {hasRuntimeKey && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded bg-gray-50/30 dark:bg-gray-900/30">
                        <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 min-w-0">
                          <CheckCircle className="w-3 h-3 shrink-0 text-blue-600 dark:text-blue-500" />
                          <span className="truncate">Runtime key (this session)</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveApiKey(provider.id)}
                          className="h-5 px-1.5 text-[11px] shrink-0"
                        >
                          Remove
                        </Button>
                      </div>
                      {/* Transfer option if runtime key exists but not stored */}
                      {!hasStoredKey && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const runtimeKey = apiKeys[provider.id];
                            if (runtimeKey) {
                              handleSaveToBackend(provider.id, runtimeKey);
                            }
                          }}
                          disabled={isSavingToBackend === provider.id}
                          className="w-full h-6 text-xs"
                        >
                          {isSavingToBackend === provider.id ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                              Saving...
                            </>
                          ) : (
                            <>
                              <Upload className="w-3 h-3 mr-1.5" />
                              Save to Backend for Scheduled Tasks
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Add Key Input - only show if no keys exist */}
              {!hasRuntimeKey && !hasStoredKey && (
                <div className="space-y-1.5">
                  <Input
                    type="password"
                    placeholder="Enter API key"
                    value={tempApiKeys[provider.id] || ''}
                    onChange={(e) => setTempApiKeys((prev) => ({
                      ...prev,
                      [provider.id]: e.target.value,
                    }))}
                    className="h-6 text-xs"
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSaveApiKey(provider.id, false)}
                      disabled={!tempApiKeys[provider.id]?.trim()}
                      className="flex-1 h-6 text-xs"
                    >
                      Runtime Only
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleSaveApiKey(provider.id, true)}
                      disabled={!tempApiKeys[provider.id]?.trim() || isSavingToBackend === provider.id}
                      className="flex-1 h-6 text-xs"
                    >
                      {isSavingToBackend === provider.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Save for Tasks'
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Ollama model management — inline */}
          {provider.id === 'ollama' && (
            <div className="space-y-1.5 pt-1 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Installed ({ollamaModels.length})
                </span>
                <Button variant="ghost" size="sm" onClick={fetchOllamaModels} className="h-5 w-5 p-0">
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>

              {ollamaModels.length > 0 ? (
                <div className="space-y-0.5 max-h-28 overflow-y-auto">
                  {ollamaModels.map(model => (
                    <div key={model} className="flex items-center justify-between py-0.5 group">
                      <span className="font-mono text-[11px] text-gray-700 dark:text-gray-300 truncate">{model}</span>
                      <button
                        onClick={() => handleRemoveModel(model)}
                        disabled={isRemovingModel === model}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
                      >
                        {isRemovingModel === model ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">No models installed yet.</p>
              )}

              <Dialog open={isOllamaDialogOpen} onOpenChange={setIsOllamaDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full h-6 text-xs">
                    <Download className="h-3 w-3 mr-1.5" /> Browse & Pull Models
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Pull Ollama Model</DialogTitle>
                    <DialogDescription>Download from the Ollama registry, or enter a custom name.</DialogDescription>
                  </DialogHeader>

                  {/* Custom pull */}
                  <div className="flex gap-2 p-3 border rounded-lg">
                    <Input placeholder="e.g. llama3.2:3b" value={ollamaCustomName} onChange={e => setOllamaCustomName(e.target.value)} />
                    <Button variant="secondary" disabled={!ollamaCustomName.trim()} onClick={() => { handlePullModel(ollamaCustomName.trim()); setIsOllamaDialogOpen(false); }}>Pull</Button>
                  </div>

                  {/* Filters */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-lg border">
                    <div>
                      <label className="text-xs font-medium mb-1 block">Search</label>
                      <Input placeholder="Search models..." value={ollamaSearch} onChange={e => setOllamaSearch(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs font-medium mb-1 block">Capability</label>
                      <Select value={ollamaCapFilter} onValueChange={setOllamaCapFilter}>
                        <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="tools">Tools</SelectItem>
                          <SelectItem value="vision">Vision</SelectItem>
                          <SelectItem value="thinking">Thinking</SelectItem>
                          <SelectItem value="embedding">Embedding</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium mb-1 block">Size</label>
                      <Select value={ollamaSizeFilter} onValueChange={setOllamaSizeFilter}>
                        <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All sizes</SelectItem>
                          <SelectItem value="small">Small (&lt; 2GB)</SelectItem>
                          <SelectItem value="medium">Medium (2-10GB)</SelectItem>
                          <SelectItem value="large">Large (&gt; 10GB)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium mb-1 block">Sort</label>
                      <Select value={ollamaSortBy} onValueChange={setOllamaSortBy}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="popular">Most Popular</SelectItem>
                          <SelectItem value="recent">Recently Updated</SelectItem>
                          <SelectItem value="name">Name (A-Z)</SelectItem>
                          <SelectItem value="size">Size</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Quick presets */}
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-xs text-muted-foreground self-center mr-1">Presets:</span>
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { setOllamaCapFilter('tools'); setOllamaSizeFilter('small'); setOllamaSortBy('popular'); }}>Small Tools</Button>
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { setOllamaCapFilter('thinking'); setOllamaSortBy('recent'); setOllamaSizeFilter(''); }}>Reasoning</Button>
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { setOllamaCapFilter('vision'); setOllamaSizeFilter('medium'); setOllamaSortBy('popular'); }}>Vision</Button>
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { setOllamaCapFilter('embedding'); setOllamaSizeFilter('small'); setOllamaSortBy('popular'); }}>Embeddings</Button>
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { setOllamaSortBy('recent'); setOllamaCapFilter(''); setOllamaSizeFilter(''); }}>Recent</Button>
                  </div>

                  {/* Results + clear */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{filteredOllamaModels.length} of {ollamaAvailable.length} models</span>
                    {(ollamaSearch || ollamaCapFilter || ollamaSizeFilter || ollamaSortBy !== 'popular') && (
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setOllamaSearch(''); setOllamaCapFilter(''); setOllamaSizeFilter(''); setOllamaSortBy('popular'); }}>
                        <Filter className="h-3 w-3 mr-1" />Clear
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {filteredOllamaModels.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-sm">No models match your search</div>
                    ) : filteredOllamaModels.map(model => (
                      <div key={model.name} className="flex items-center justify-between p-3 border rounded-lg hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <span className="font-medium text-sm">{model.name}</span>
                            {model.capabilities?.map(c => <Badge key={c} variant={c === 'tools' ? 'default' : 'secondary'} className="text-[10px] px-1 py-0">{c}</Badge>)}
                          </div>
                          <div className="text-xs text-muted-foreground">{model.description}</div>
                          <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                            <span>{model.size}</span>
                            {model.pulls && <span>{model.pulls} pulls</span>}
                            {model.parameters && <span>{model.parameters}</span>}
                          </div>
                        </div>
                        <Button variant="outline" size="sm" className="ml-3 shrink-0" disabled={isPullingModel === model.name} onClick={() => { handlePullModel(model.name); setIsOllamaDialogOpen(false); }}>
                          {isPullingModel === model.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                        </Button>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // Only show tabs that have providers (hides annotation — it has its own selector in the runner)
  const visibleCapabilities = (Object.keys(providers) as ProviderCapability[]).filter(
    (cap) => providers[cap].length > 0
  );

  const hasRuntimeKeysToTransfer = Object.entries(apiKeys).some(
    ([providerId, key]) => key && !storedProviders.includes(providerId)
  );

  return (
    <div className={`space-y-2.5 w-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <h3 className="text-sm font-medium cursor-help">
                Foundation Service Providers
              </h3>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-xs">
              <p className="text-xs">
                Expands HQ&apos;s capabilities via external APIs or self-hosted services — language models, embeddings, web search, geocoding, OCR, and annotation.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex items-center gap-1.5">
          {hasRuntimeKeysToTransfer && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleTransferAllToBackend}
              disabled={isTransferringAll}
            >
              {isTransferringAll ? (
                <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Transferring...</>
              ) : (
                <><Upload className="mr-1.5 h-3 w-3" />Transfer Keys to Backend Storage</>
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => window.location.href = '/accounts/settings#api-keys'}
          >
            <Lock className="mr-1.5 h-3 w-3" />
            Manage Keys
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground transition-colors p-1">
                  <Info className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-xs">
                <div className="space-y-1.5 text-xs">
                  <p className="font-semibold">Two types of API keys:</p>
                  <div>
                    <span className="font-medium text-blue-400">Runtime:</span> Browser-only, for immediate use (chat, ad-hoc runs).
                  </div>
                  <div>
                    <span className="font-medium text-green-400">Stored:</span> Encrypted on backend, for scheduled tasks and background jobs.
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <Tabs value={activeCapability} onValueChange={(v) => setActiveCapability(v as ProviderCapability)} className="w-full">
        <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${visibleCapabilities.length}, minmax(0, 1fr))` }}>
          {visibleCapabilities.map((capability) => (
            <TabsTrigger key={capability} value={capability} className="text-xs px-2">
              <div className="flex items-center gap-1 min-w-0">
                {CAPABILITY_ICONS[capability]}
                <span className="hidden md:inline truncate">{CAPABILITY_NAMES[capability]}</span>
              </div>
            </TabsTrigger>
          ))}
        </TabsList>

        {visibleCapabilities.map((capability) => (
          <TabsContent key={capability} value={capability} className="space-y-3 w-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <div className="flex items-center gap-2 min-w-0">
                {CAPABILITY_ICONS[capability]}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {CAPABILITY_NAMES[capability]}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {CAPABILITY_DESCRIPTIONS[capability]}
                  </div>
                </div>
              </div>
              <Badge variant="secondary" className="shrink-0 self-start sm:self-auto">
                {providers[capability].length} providers
              </Badge>
            </div>

            <div className="grid gap-1.5 w-full grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {providers[capability].map((provider) => renderProviderCard(provider, capability))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

