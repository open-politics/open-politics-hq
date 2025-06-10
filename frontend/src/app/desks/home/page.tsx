'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Folder, Globe, MessageSquare, Key, Brain, SquareTerminal, Microscope, FileText, FolderCog } from "lucide-react"
import { InfospaceItems } from "@/components/collection/unsorted/AppSidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useApiKeysStore } from "@/zustand_stores/storeApiKeys"
import { useState, useEffect } from "react"
import Link from "next/link"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import ProviderSelector from '@/components/collection/infospaces/management/ProviderSelector'

export default function DesksPage() {
  const { apiKeys, setApiKey, selectedProvider, selectedModel } = useApiKeysStore();
  const [tempApiKey, setTempApiKey] = useState('');

  const handleSaveApiKey = () => {
    if (selectedProvider && tempApiKey) {
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
            <Link href="/desks/home/infospaces/annotation-runner" className="h-full block">
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
            <Link href="/desks/home/infospaces/classification-schemes" className="h-full block">
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
            <Link href="/desks/home/infospaces/asset-manager" className="h-full block">
              <Card className="transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
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
                    <Link href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-800 dark:text-blue-200">
                      How to get an API key (Google)
                    </Link>
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

          <div className="relative transition-all duration-200 h-full">
            <Link href="/desks/home/infospaces/Infospace-manager" className="h-full block">
              <Card className="transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer relative h-full overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-[var(--settings-Infospace-from)] to-[var(--settings-Infospace-to)] rounded-lg"></div>
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