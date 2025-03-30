'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Folder, Globe, MessageSquare, Key, Brain, SquareTerminal, Microscope, FileText, FolderCog } from "lucide-react"
import { workspaceItems } from "@/components/collection/unsorted/AppSidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useApiKeysStore } from "@/zustand_stores/storeApiKeys"
import { useState, useEffect } from "react"
import Link from "next/link"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClassificationService } from "@/client/services"
import ProviderSelector from '@/components/collection/workspaces/management/ProviderSelector'

interface Provider {
  name: string;
  models: string[];
}

export default function DesksPage() {
  const { apiKeys, setApiKey, selectedProvider, selectedModel, setSelectedProvider, setSelectedModel, clearAllKeys } = useApiKeysStore();
  const [tempApiKey, setTempApiKey] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await ClassificationService.getProviders();
        const providerList = response as Provider[];
        setProviders(providerList);
        
        // Set default provider and model if none selected
        if (!selectedProvider && providerList.length > 0) {
          const defaultProvider = providerList[0];
          setSelectedProvider(defaultProvider.name);
          if (defaultProvider.models.length > 0) {
            setSelectedModel(defaultProvider.models[0]);
          }
        }
      } catch (error) {
        console.error('Error fetching providers:', error);
      }
    };

    fetchProviders();
  }, []);

  useEffect(() => {
    // Update available models when provider changes
    const provider = providers.find(p => p.name === selectedProvider);
    setAvailableModels(provider?.models || []);
  }, [selectedProvider, providers]);

  const handleSaveApiKey = () => {
    if (selectedProvider) {
      setApiKey(selectedProvider, tempApiKey);
      setTempApiKey('');  
    }
  };

  const maskApiKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 8) return key;
    return `${key.slice(0, 4)}${'*'.repeat(key.length - 8)}${key.slice(-4)}`;
  };

  return (
    <div className="p-6 max-h-[calc(100vh-200px)] overflow-y-auto">
      <div className="flex items-center mb-6">
        <h1 className="text-2xl font-bold">Home</h1>
      </div>

      {/* Tools Section */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Tools</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
          <div className="relative transition-all duration-200 h-full">
            <Link href="/desks/home/globe" className="h-full block">
              <Card className="transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-[var(--tool-globe-from)] to-[var(--tool-globe-to)] rounded-lg"></div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="w-5 h-5" />
                    Globe View
                  </CardTitle>
                  <CardDescription>
                    Get an overview of events around the world pulled from our OPOL data engine.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>

          {/* <div className="relative transition-all duration-200 h-full">
            <Link href="/desks/home/chat" className="h-full block">
              <Card className="transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full">
                <div className="absolute inset-0 bg-gradient-to-r from-green-500 to-teal-500 blur-xl opacity-10 rounded-full -z-10 animate-pulse [animation-duration:3s]"></div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5" />
                    Chat Interface
                  </CardTitle>
                  <CardDescription>
                    AI-powered political analysis assistant.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div> */}

          <div className="relative transition-all duration-200 h-full">
            <Link href="/desks/home/workspaces/classification-runner" className="h-full block">
              <Card className="transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-[var(--tool-analyser-from)] to-[var(--tool-analyser-to)] rounded-lg"></div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <SquareTerminal className="w-5 h-5" />
                    Analyser
                  </CardTitle>
                  <CardDescription>
                    Run classifications and analysis on your documents
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>
        </div>
      </div>

      {/* Stores Section */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Stores</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="relative transition-all duration-200 h-full">
            <Link href="/desks/home/workspaces/classification-schemes" className="h-full block">
              <Card className="transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-[var(--store-schemes-from)] to-[var(--store-schemes-to)] rounded-lg"></div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Microscope className="w-5 h-5" />
                    Schemes
                  </CardTitle>
                  <CardDescription>
                    Manage your classification schemes
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>

          <div className="relative transition-all duration-200 h-full">
            <Link href="/desks/home/workspaces/document-manager" className="h-full block">
              <Card className="transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-[var(--store-documents-from)] to-[var(--store-documents-to)] rounded-lg"></div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Documents
                  </CardTitle>
                  <CardDescription>
                    Manage your document collection
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>
        </div>
      </div>

      {/* Workspace & Settings Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Workspace & Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* AI Model Configuration Card */}
          <div className="relative transition-all duration-200 h-full">
            <Card className="transition-all duration-200 relative h-full overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-[var(--settings-ai-from)] to-[var(--settings-ai-to)] rounded-lg"></div>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  AI Model
                </CardTitle>
                <CardDescription>
                  Configure your LLM provider and model settings
                </CardDescription>
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-gray-500">
                    <Link href="https://aistudio.google.com/apikey" className="text-blue-800 dark:text-blue-200">How to get an API key (Google)</Link>
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <ProviderSelector />

                  <div>
                    <label className="text-sm font-medium">API Keys</label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        type="password"
                        placeholder="Enter API key for selected provider"
                        value={tempApiKey}
                        onChange={(e) => setTempApiKey(e.target.value)}
                      />
                      <Button 
                        onClick={handleSaveApiKey}
                        disabled={!selectedProvider}
                      >
                        Save
                      </Button>
                    </div>
                    {/* Show all saved API keys */}
                    <div className="mt-2 space-y-1">
                      {Object.entries(apiKeys).map(([provider, key]) => (
                        <p key={provider} className="text-sm text-green-600">
                          ✓ {provider}: {maskApiKey(key)}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="relative transition-all duration-200 h-full">
            <Link href="/desks/home/workspaces/workspace-manager" className="h-full block">
              <Card className="transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-[var(--settings-workspace-from)] to-[var(--settings-workspace-to)] rounded-lg"></div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FolderCog className="w-5 h-5" />
                    Workspace Manager
                  </CardTitle>
                  <CardDescription>
                    Manage your workspace settings and configurations
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>

          
        </div>
      </div>
    </div>
  )
}