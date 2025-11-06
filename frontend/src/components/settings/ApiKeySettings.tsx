'use client';

import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Key, 
  CheckCircle, 
  Trash2,
  Lock,
  AlertCircle,
  Info,
  ExternalLink
} from "lucide-react";
import { toast } from 'sonner';
import { UsersService } from '@/client';

interface ApiKeySettingsProps {
  className?: string;
}

// Provider configuration for credential management
const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models and text-embedding',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-...'
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude models for reasoning',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-...'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini models',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AI...'
  },
  {
    id: 'voyage',
    name: 'Voyage AI',
    description: 'Voyage embeddings (recommended by Anthropic)',
    apiKeyUrl: 'https://www.voyageai.com',
    placeholder: 'pa-...'
  },
  {
    id: 'jina',
    name: 'Jina AI',
    description: 'Jina embeddings',
    apiKeyUrl: 'https://jina.ai',
    placeholder: 'jina_...'
  },
  {
    id: 'tavily',
    name: 'Tavily',
    description: 'AI-powered web search',
    apiKeyUrl: 'https://tavily.com',
    placeholder: 'tvly-...'
  },
  {
    id: 'mapbox',
    name: 'Mapbox',
    description: 'Geocoding and mapping',
    apiKeyUrl: 'https://account.mapbox.com',
    placeholder: 'pk...'
  }
];

export default function ApiKeySettings({ className = '' }: ApiKeySettingsProps) {
  const [savedProviders, setSavedProviders] = useState<string[]>([]);
  const [tempApiKeys, setTempApiKeys] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  useEffect(() => {
    loadSavedProviders();
  }, []);

  const loadSavedProviders = async () => {
    setIsLoading(true);
    try {
      const providers = await UsersService.listCredentialProviders();
      setSavedProviders(providers);
    } catch (error) {
      console.error('Failed to load saved providers:', error);
      toast.error('Failed to load saved providers');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveKey = async (providerId: string) => {
    const key = tempApiKeys[providerId]?.trim();
    if (!key) {
      toast.error('Please enter an API key');
      return;
    }

    setIsSaving(providerId);
    try {
      await UsersService.saveCredentials({
        requestBody: {
          credentials: { [providerId]: key }
        }
      });
      
      toast.success(`API key saved securely for ${PROVIDERS.find(p => p.id === providerId)?.name}`);
      setTempApiKeys((prev) => ({ ...prev, [providerId]: '' }));
      setSavedProviders((prev) => [...new Set([...prev, providerId])]);
    } catch (error) {
      console.error('Failed to save credential:', error);
      toast.error('Failed to save API key');
    } finally {
      setIsSaving(null);
    }
  };

  const handleDeleteKey = async (providerId: string) => {
    if (!confirm(`Remove API key for ${PROVIDERS.find(p => p.id === providerId)?.name}? Scheduled tasks using this provider will fail.`)) {
      return;
    }

    setIsDeleting(providerId);
    try {
      await UsersService.deleteCredential({ providerId });
      toast.success(`API key removed for ${PROVIDERS.find(p => p.id === providerId)?.name}`);
      setSavedProviders((prev) => prev.filter(id => id !== providerId));
    } catch (error) {
      console.error('Failed to delete credential:', error);
      toast.error('Failed to remove API key');
    } finally {
      setIsDeleting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Saved API Keys
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Save API keys securely for scheduled and background tasks
        </p>
      </div>

      {/* Info Alert */}
      <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
        <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <AlertDescription className="text-sm text-blue-900 dark:text-blue-100">
          <div className="space-y-2">
            <p className="font-medium">How this works:</p>
            <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-200">
              <li><strong>Runtime keys:</strong> Provide API keys when running tasks (one-time, not saved)</li>
              <li><strong>Stored keys:</strong> Save keys here for scheduled/background tasks</li>
              <li><strong>Security:</strong> Keys are encrypted with AES-256 and only decrypted when needed</li>
              <li><strong>Ollama:</strong> No API key needed - runs locally on your infrastructure</li>
            </ul>
          </div>
        </AlertDescription>
      </Alert>

      {/* Provider Cards */}
      <div className="grid gap-4">
        {PROVIDERS.map((provider) => {
          const hasSavedKey = savedProviders.includes(provider.id);
          const isSavingThis = isSaving === provider.id;
          const isDeletingThis = isDeleting === provider.id;

          return (
            <Card key={provider.id} className="border-gray-200 dark:border-gray-700">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                        {provider.name}
                      </CardTitle>
                      {hasSavedKey && (
                        <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Saved
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                      {provider.description}
                    </CardDescription>
                  </div>
                  
                  {provider.apiKeyUrl && (
                    <a
                      href={provider.apiKeyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 shrink-0"
                    >
                      Get Key
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                {hasSavedKey ? (
                  <div className="flex items-center justify-between gap-2 p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded">
                    <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                      <Lock className="w-4 h-4" />
                      <span>API key encrypted and saved</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteKey(provider.id)}
                      disabled={isDeletingThis}
                      className="h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                    >
                      {isDeletingThis ? (
                        <div className="animate-spin h-4 w-4 border-2 border-red-600 border-t-transparent rounded-full" />
                      ) : (
                        <>
                          <Trash2 className="w-3 h-3 mr-1" />
                          Remove
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <Key className="w-3 h-3" />
                      API Key
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder={provider.placeholder}
                        value={tempApiKeys[provider.id] || ''}
                        onChange={(e) => setTempApiKeys((prev) => ({
                          ...prev,
                          [provider.id]: e.target.value,
                        }))}
                        className="text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSaveKey(provider.id)}
                        disabled={!tempApiKeys[provider.id]?.trim() || isSavingThis}
                        className="shrink-0"
                      >
                        {isSavingThis ? (
                          <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        ) : (
                          'Save'
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Your key will be encrypted and stored securely for background tasks
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Footer Info */}
      <Alert className="bg-gray-50 dark:bg-gray-900/50">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-sm text-gray-600 dark:text-gray-400">
          Keys are encrypted with AES-256 and only decrypted when running your tasks. 
          You can revoke access anytime by removing them here.
          Prefer to self-host? All code is open source.
        </AlertDescription>
      </Alert>
    </div>
  );
}

