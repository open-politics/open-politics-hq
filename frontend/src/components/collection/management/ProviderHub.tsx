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
import { 
  Brain, 
  Search, 
  MapPin, 
  Database, 
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
  Info
} from "lucide-react";
import { useProvidersStore, ProviderCapability, ProviderMetadata } from '@/zustand_stores/storeProviders';
import { toast } from 'sonner';
import { UtilsService, UsersService } from '@/client';

interface ProviderHubProps {
  className?: string;
}

const CAPABILITY_ICONS: Record<ProviderCapability, React.ReactNode> = {
  llm: <Brain className="w-4 h-4" />,
  embedding: <Database className="w-4 h-4" />,
  search: <Search className="w-4 h-4" />,
  geocoding: <MapPin className="w-4 h-4" />,
};

const CAPABILITY_NAMES: Record<ProviderCapability, string> = {
  llm: 'Language Models',
  embedding: 'Embeddings',
  search: 'Web Search',
  geocoding: 'Geocoding',
};

const CAPABILITY_DESCRIPTIONS: Record<ProviderCapability, string> = {
  llm: 'AI models for chat, classification, and structured output',
  embedding: 'Convert text into vector embeddings for semantic search',
  search: 'Search the web for real-time information',
  geocoding: 'Convert location names to coordinates and vice versa',
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

  // Fetch unified providers and stored credentials on mount
  useEffect(() => {
    fetchProviders();
    fetchStoredCredentials();
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
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                  {provider.name}
                </CardTitle>
                {provider.is_local && (
                  <Badge variant="outline" className="text-xs bg-slate-50 dark:bg-slate-900">
                    <Server className="w-3 h-3 mr-1" />
                    Local
                  </Badge>
                )}
                {provider.is_oss && (
                  <Badge variant="outline" className="text-xs bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800">
                    <Code2 className="w-3 h-3 mr-1" />
                    Open Source
                  </Badge>
                )}
                {provider.is_free && (
                  <Badge variant="outline" className="text-xs bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
                    <Heart className="w-3 h-3 mr-1" />
                    Free
                  </Badge>
                )}
                {provider.has_env_fallback && (
                  <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950">
                    <CheckCircle className="w-3 h-3 mr-1 text-green-600" />
                    Configured
                  </Badge>
                )}
              </div>
              <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                {provider.description}
              </CardDescription>
            </div>
            
            <Button
              variant={isSelected ? "default" : "outline"}
              size="sm"
              onClick={() => handleSelectProvider(capability, provider.id)}
              disabled={showApiKeyWarning}
              className="shrink-0"
            >
              {isSelected ? 'Active' : 'Select'}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          {/* Features */}
          {provider.features && provider.features.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {provider.features.map((feature) => (
                <Badge key={feature} variant="secondary" className="text-xs">
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
            <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
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
                    <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded">
                      <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 min-w-0">
                        <Lock className="w-3 h-3 shrink-0" />
                        <span className="truncate font-medium">Encrypted for scheduled tasks</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveStoredKey(provider.id)}
                        className="h-6 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 shrink-0"
                      >
                        Remove
                      </Button>
                    </div>
                  )}

                  {/* Runtime Key */}
                  {hasRuntimeKey && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded">
                        <div className="flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-400 min-w-0">
                          <CheckCircle className="w-3 h-3 shrink-0" />
                          <span className="truncate font-medium">Runtime key (this session)</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveApiKey(provider.id)}
                          className="h-6 px-2 text-xs shrink-0"
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
                          className="w-full h-7 text-xs"
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
                    className="h-8 text-xs"
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSaveApiKey(provider.id, false)}
                      disabled={!tempApiKeys[provider.id]?.trim()}
                      className="flex-1 h-7 text-xs"
                    >
                      Runtime Only
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleSaveApiKey(provider.id, true)}
                      disabled={!tempApiKeys[provider.id]?.trim() || isSavingToBackend === provider.id}
                      className="flex-1 h-7 text-xs"
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

  const hasRuntimeKeysToTransfer = Object.entries(apiKeys).some(
    ([providerId, key]) => key && !storedProviders.includes(providerId)
  );

  return (
    <div className={`space-y-4 w-full ${className}`}>
      {/* Action Buttons */}
      <div className="flex items-center justify-between gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 cursor-help">
                <Info className="w-4 h-4" />
                <span className="text-xs">About API Keys</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-xs">
              <div className="space-y-2 text-xs">
                <p className="font-semibold">Two ways to use API keys:</p>
                <div>
                  <span className="font-medium text-blue-400 dark:text-blue-400">Runtime Keys:</span>
                  <p className="">One-time use for immediate operations (chat, ad-hoc annotation run). Stored in your browser only, not saved to backend.</p>
                </div>
                <div>
                  <span className="font-medium text-green-400 dark:text-green-400">Stored Keys:</span>
                  <p className="">Encrypted and saved for scheduled tasks, background embeddings, and recurring jobs. Required when you're away.</p>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex gap-2 shrink-0">
          {hasRuntimeKeysToTransfer && (
            <Button
              variant="default"
              size="sm"
              onClick={handleTransferAllToBackend}
              disabled={isTransferringAll}
            >
              {isTransferringAll ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Transferring...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Transfer All to Backend
                </>
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.href = '/accounts/settings#api-keys'}
            className="shrink-0"
          >
            <Lock className="w-4 h-4 mr-2" />
            Manage Stored Keys
          </Button>
        </div>
      </div>

      <Tabs value={activeCapability} onValueChange={(v) => setActiveCapability(v as ProviderCapability)} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          {(Object.keys(providers) as ProviderCapability[]).map((capability) => (
            <TabsTrigger key={capability} value={capability} className="text-xs px-2">
              <div className="flex items-center gap-1 min-w-0">
                {CAPABILITY_ICONS[capability]}
                <span className="hidden md:inline truncate">{CAPABILITY_NAMES[capability]}</span>
              </div>
            </TabsTrigger>
          ))}
        </TabsList>

        {(Object.keys(providers) as ProviderCapability[]).map((capability) => (
          <TabsContent key={capability} value={capability} className="space-y-4 w-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
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

            <div className="grid gap-4 w-full">
              {providers[capability].map((provider) => renderProviderCard(provider, capability))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

