'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Folder, Globe, MessageSquare, Key, Brain, SquareTerminal, Microscope, FileText, FolderCog, Search, Activity } from "lucide-react"
import { InfospaceItems } from "@/components/collection/unsorted/AppSidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useApiKeysStore } from "@/zustand_stores/storeApiKeys"
import { useState, useEffect } from "react"
import Link from "next/link"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import ModelManager from '@/components/collection/infospaces/management/ModelManager'
import { toast } from 'sonner'

export default function DesksPage() {
  const { apiKeys, setApiKey, selectedProvider, selectedModel } = useApiKeysStore();
  const [tempApiKey, setTempApiKey] = useState('');

  const handleSaveApiKey = () => {
    console.log('Save attempt:', { selectedProvider, tempApiKey: tempApiKey ? '[HIDDEN]' : 'empty' });
    if (selectedProvider && tempApiKey) {
      console.log('Calling setApiKey with provider:', selectedProvider);
      setApiKey(selectedProvider, tempApiKey);
      setTempApiKey('');
      console.log('After setApiKey, current apiKeys:', apiKeys);
      toast.success(`API key saved for ${selectedProvider}`);
    } else {
      console.log('Save failed - missing provider or key');
      toast.error('Please select a provider and enter an API key');
    }
  };

  const maskApiKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 8) return key;
    return `${key.slice(0, 4)}${'*'.repeat(key.length - 8)}${key.slice(-4)}`;
  };

  return (
    <div className="p-6 max-h-full rounded-lg overflow-y-auto">
      <div className="flex items-center mb-6">
        <h1 className="text-2xl font-bold">Home</h1>
      </div>

      {/* Tools Section */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Tools</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          

          <div className="relative transition-all duration-200 h-full">
            <Link href="/hq/infospaces/annotation-runner" className="h-full block">
              <Card className="backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
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

          <div className="relative transition-all duration-200 h-full">
            <Link href="/hq/infospaces/monitors" className="h-full block">
              <Card className="backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-[var(--tool-monitors-from)] to-[var(--tool-monitors-to)] "></div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5" />
                    Monitors
                  </CardTitle>
                  <CardDescription>
                    Set up automated classification and analysis workflows
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>

          <div className="relative transition-all duration-200 h-full">
            <Card className="backdrop-blur-sm transition-all duration-200 hover:shadow-lg relative h-full overflow-hidden opacity-75 cursor-default">
              <div className="absolute inset-0 bg-gradient-to-r from-[var(--tool-globe-from)] to-[var(--tool-globe-to)] rounded-lg"></div>
              <div className="absolute top-2 right-2 bg-blue-400 text-blue-900 text-xs px-2 py-1 rounded-full font-medium z-20">
                Coming Soon
              </div>
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
          </div>

          {/* <div className="relative transition-all duration-200 h-full">
            <Link href="/hq/infospaces/chat" className="h-full block">
              <Card className="transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-[var(--tool-search-from)] to-[var(--tool-search-to)] rounded-lg"></div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="w-5 h-5" />
                    Content Search
                  </CardTitle>
                  <CardDescription>
                    Ask questions about your assets using AI-powered retrieval
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div> */}
        </div>
      </div>

      {/* Stores Section */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Stores</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="relative transition-all duration-200 h-full">
            <Link href="/hq/infospaces/annotation-schemes" className="h-full block">
              <Card className="backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
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
            <Link href="/hq/infospaces/asset-manager" className="h-full block">
              <Card className="backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-[var(--store-documents-from)] to-[var(--store-documents-to)] rounded-lg"></div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Assets
                  </CardTitle>
                  <CardDescription>
                    Manage your collection of documents, articles, images, and more
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>
        </div>
      </div>

      {/* Infospace & Settings Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Infospace & Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* AI Model Configuration Card */}
          <div className="relative transition-all duration-200 h-full bg-gradient-to-r from-[var(--settings-ai-from)] to-[var(--settings-ai-to)] rounded-lg">
            <Card className="backdrop-blur-sm transition-all duration-200 relative h-full overflow-hidden">
              <div className="absolute inset-0 -z-10"></div>
              <CardHeader className="relative z-10">
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  AI Model
                </CardTitle>
                <CardDescription>
                  Configure your LLM provider and model settings
                </CardDescription>
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-gray-500">
                    <Link href="https://aistudio.google.com/app/apikey" rel="noopener noreferrer" className="text-blue-800 dark:text-blue-200 hover:underline">
                      How to get an API key (Google)
                    </Link>
                  </span>
                </div>
              </CardHeader>
              <CardContent className="relative z-10">
                <div className="space-y-4">
                  <ModelManager />

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
                        disabled={!selectedProvider || !tempApiKey}
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

          <div className="relative transition-all duration-200 h-full bg-gradient-to-r from-[var(--settings-Infospace-from)] to-[var(--settings-Infospace-to)] rounded-lg">
            <Link href="/hq/infospaces/infospace-manager" className="h-full block">
              <Card className="backdrop-blur-sm transition-all duration-200 hover:scale-[1.01] hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
                <div className="absolute inset-0 -z-10"></div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FolderCog className="w-5 h-5" />
                    Infospace Manager
                  </CardTitle>
                  <CardDescription>
                    Manage your Infospace settings and configurations
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