  'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Brain, Microscope, FileText, Search, Activity, Terminal, Settings, MessageSquare, Database, Sparkles } from "lucide-react"
import Link from "next/link"
import ProviderManager from '@/components/collection/management/ProviderManager'
import ModelManager from '@/components/collection/management/ModelManager'
import withAuth from '@/hooks/withAuth'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useEffect } from 'react'

function DesksPage() {
  const { infospaces, activeInfospace, fetchInfospaces, setActiveInfospace } = useInfospaceStore();

  useEffect(() => {
    fetchInfospaces();
  }, [fetchInfospaces]);

  const handleSwitchInfospace = (infospaceId: number) => {
    setActiveInfospace(infospaceId);
  };

  return (
    <div className="p-6 max-h-full rounded-lg overflow-y-auto">
      

      {/* Tools Section */}
      <div className="mb-6">
        <h2 className="text-lg font-medium mb-4 text-gray-700 dark:text-gray-300">Tools</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="group">
            <Link href="/hq/infospaces/annotation-runner" className="block">
              <Card className="group-hover:shadow-md group-hover:border-blue-200 dark:group-hover:border-blue-700 transition-all duration-200 cursor-pointer border border-blue-100 dark:border-blue-900 bg-blue-50/20 dark:bg-blue-950/10">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-blue-500/20 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">
                      <Terminal className="w-4 h-4" />
                    </div>
                    <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                      Analyser
                    </CardTitle>
                  </div>
                  <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                    Run classifications and analysis on your documents
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>

          <div className="group">
            <Link href="/hq/chat" className="block">
              <Card className="group-hover:shadow-md group-hover:border-teal-200 dark:group-hover:border-teal-700 transition-all duration-200 cursor-pointer border border-teal-100 dark:border-teal-900 bg-teal-50/20 dark:bg-teal-950/10">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-teal-500/20 dark:bg-teal-500/20 text-teal-700 dark:text-teal-400">
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                      Chat
                    </CardTitle>
                  </div>
                  <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                    Chat with your data using local or remote AI models.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>
        </div>
      </div>

      {/* Stores Section */}
      <div className="mb-6">
        <h2 className="text-lg font-medium mb-4 text-gray-700 dark:text-gray-300">Stores</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="group">
            <Link href="/hq/infospaces/asset-manager" className="block">
              <Card className="group-hover:shadow-md group-hover:border-green-200 dark:group-hover:border-green-700 transition-all duration-200 cursor-pointer border border-green-100 dark:border-green-900 bg-green-50/20 dark:bg-green-950/10">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-green-500/20 dark:bg-green-500/20 text-green-700 dark:text-green-400">
                      <FileText className="w-4 h-4" />
                    </div>
                    <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                      Assets
                    </CardTitle>
                  </div>
                  <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                    Manage your collection of documents, articles, images, and more
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>
          
          <div className="group">
            <Link href="/hq/infospaces/annotation-schemes" className="block">
              <Card className="group-hover:shadow-md group-hover:border-sky-200 dark:group-hover:border-sky-700 transition-all duration-200 cursor-pointer border border-sky-100 dark:border-sky-900 bg-sky-50/20 dark:bg-sky-950/10">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-sky-500/20 dark:bg-sky-500/20 text-sky-700 dark:text-sky-400">
                      <Microscope className="w-4 h-4" />
                    </div>
                    <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                      Schemas
                    </CardTitle>
                  </div>
                  <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                    Manage your classification schemes and analysis templates
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>
        </div>
      </div>

      {/* Infospace & Settings Section */}
      <div>
        <h2 className="text-lg font-medium mb-4 text-gray-700 dark:text-gray-300">Infospace & Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* AI Model Configuration Card */}
          <div className="group">
            <Card className="group-hover:shadow-md group-hover:border-gray-300 dark:group-hover:border-gray-600 transition-all duration-200 border border-gray-200 dark:border-gray-700">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-md bg-gray-500/20 dark:bg-gray-500/20 text-gray-700 dark:text-gray-400">
                    <Brain className="w-4 h-4" />
                  </div>
                  <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                    AI & Search Configuration
                  </CardTitle>
                </div>
                <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                  Configure your LLM and search provider settings
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ProviderManager />
                <div className="mt-6">
                  <ModelManager showProviderSelector={false} />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="group">
            <Card className="group-hover:shadow-md group-hover:border-slate-300 dark:group-hover:border-slate-600 transition-all duration-200 border border-slate-200 dark:border-slate-700 bg-slate-50/20 dark:bg-slate-950/10">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-slate-500/20 dark:bg-slate-500/20 text-slate-700 dark:text-slate-400">
                      <Database className="w-4 h-4" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                        Infospaces
                      </CardTitle>
                      <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                        {activeInfospace ? `Active: ${activeInfospace.name}` : 'No active infospace'}
                      </CardDescription>
                    </div>
                  </div>
                  <Link href="/hq/infospaces/infospace-manager">
                    <Button variant="outline" size="sm">
                      <Settings className="w-4 h-4 mr-1" />
                      Manage
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {/* Active Infospace Status */}
                  {activeInfospace && (
                    <div className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span className="text-sm font-medium text-green-800 dark:text-green-200">
                          {activeInfospace.name}
                        </span>
                        <Badge variant="secondary" className="text-xs">Active</Badge>
                      </div>
                      {activeInfospace.embedding_model && (
                        <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <Sparkles className="w-3 h-3" />
                          <span>Embeddings</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Infospace List */}
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {infospaces.slice(0, 3).map((infospace) => (
                      <div 
                        key={infospace.id}
                        className={`group flex items-center justify-between p-2 rounded text-sm cursor-pointer transition-colors ${
                          infospace.id === activeInfospace?.id 
                            ? 'bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-200' 
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                        onClick={() => handleSwitchInfospace(infospace.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate">{infospace.name}</span>
                          {infospace.embedding_model && (
                            <Sparkles className="w-3 h-3 text-muted-foreground" />
                          )}
                        </div>
                        {infospace.id === activeInfospace?.id ? (
                          <Badge variant="outline" className="text-xs">Active</Badge>
                        ) : (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 px-2 text-xs hover:bg-blue-100 dark:hover:bg-blue-900"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSwitchInfospace(infospace.id);
                            }}
                          >
                            Switch
                          </Button>
                        )}
                      </div>
                    ))}
                    {infospaces.length > 3 && (
                      <div className="text-xs text-muted-foreground text-center py-1">
                        +{infospaces.length - 3} more infospaces
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </div>
  )
}

export default withAuth(DesksPage);