'use client';

import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
  Code2
} from "lucide-react";
import { useProvidersStore, ProviderCapability, ProviderMetadata } from '@/zustand_stores/storeProviders';
import { toast } from 'sonner';
import { UtilsService } from '@/client';

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

  // Fetch unified providers on mount
  useEffect(() => {
    fetchProviders();
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

  const handleSaveApiKey = (providerId: string) => {
    const key = tempApiKeys[providerId]?.trim();
    if (!key) {
      toast.error('Please enter an API key');
      return;
    }

    setApiKey(providerId, key);
    setTempApiKeys((prev) => ({ ...prev, [providerId]: '' }));
    toast.success(`API key saved for ${getProvider(providerId)?.name}`);
  };

  const handleRemoveApiKey = (providerId: string) => {
    removeApiKey(providerId);
    toast.success(`API key removed for ${getProvider(providerId)?.name}`);
  };

  const handleSelectProvider = (capability: ProviderCapability, providerId: string) => {
    setSelection(capability, { providerId });
    toast.success(`Selected ${getProvider(providerId)?.name} for ${CAPABILITY_NAMES[capability]}`);
  };

  const renderProviderCard = (provider: ProviderMetadata, capability: ProviderCapability) => {
    const isSelected = selections[capability]?.providerId === provider.id;
    const hasKey = hasApiKey(provider.id);
    const needsKey = needsApiKey(provider.id);
    const showApiKeyWarning = needsKey && !hasKey;

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
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium flex items-center gap-1 min-w-0">
                  <Key className="w-3 h-3 shrink-0" />
                  <span className="truncate">{provider.api_key_name || 'API Key'}</span>
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

              {/* Server env fallback info */}
              {provider.has_env_fallback && !hasKey && (
                <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 p-2 rounded border border-green-200 dark:border-green-800">
                  ✓ Server configured (you can add your own key to override)
                </div>
              )}

              {/* API Key Input/Display */}
              {hasKey ? (
                <div className="flex items-center justify-between gap-2 p-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded">
                  <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400 min-w-0">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{provider.has_env_fallback ? 'Using your API key (overriding server)' : 'API key configured'}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveApiKey(provider.id)}
                    className="h-7 text-xs shrink-0"
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder={provider.has_env_fallback ? "Enter your key to override" : "Enter API key"}
                      value={tempApiKeys[provider.id] || ''}
                      onChange={(e) => setTempApiKeys((prev) => ({
                        ...prev,
                        [provider.id]: e.target.value,
                      }))}
                      className="text-xs"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSaveApiKey(provider.id)}
                      disabled={!tempApiKeys[provider.id]?.trim()}
                      className="shrink-0"
                    >
                      Save
                    </Button>
                  </div>
                  {showApiKeyWarning && (
                    <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <AlertCircle className="w-3 h-3" />
                      API key required to use this provider
                    </div>
                  )}
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

  return (
    <div className={`space-y-4 w-full ${className}`}>
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          Provider Configuration
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Configure AI providers for different capabilities. Local providers run on your infrastructure, cloud providers require API keys.
        </p>
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

