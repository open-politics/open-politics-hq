  'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Brain, Microscope, FileText, Search, Activity, Terminal, Settings, MessageSquare, Database, Sparkles } from "lucide-react"
import Link from "next/link"
import ProviderHub from '@/components/collection/management/ProviderHub'
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
            <Link href="/hq/chat" className="block">
              <Card className="bg-teal-50/40 dark:bg-teal-950/20 group-hover:shadow-sm group-hover:border-teal-300 dark:group-hover:border-teal-700 transition-all duration-200 cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-teal-500/20 dark:bg-teal-500/25 text-teal-700 dark:text-teal-400">
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

          <div className="group">
            <Link href="/hq/infospaces/annotation-runner" className="block">
              <Card className="bg-blue-50/40 dark:bg-blue-950/20 group-hover:shadow-sm group-hover:border-blue-300 dark:group-hover:border-blue-700 transition-all duration-200 cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-blue-500/20 dark:bg-blue-500/25 text-blue-700 dark:text-blue-400">
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
        </div>
      </div>

      {/* Stores Section */}
      <div className="mb-6">
        <h2 className="text-lg font-medium mb-4 text-gray-700 dark:text-gray-300">Stores</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="group">
            <Link href="/hq/infospaces/asset-manager" className="block">
              <Card className="bg-green-50/40 dark:bg-green-950/20 group-hover:shadow-sm group-hover:border-green-300 dark:group-hover:border-green-700 transition-all duration-200 cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-green-500/20 dark:bg-green-500/25 text-green-700 dark:text-green-400">
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
              <Card className="bg-sky-50/40 dark:bg-sky-950/20 group-hover:shadow-sm group-hover:border-sky-300 dark:group-hover:border-sky-700 transition-all duration-200 cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-sky-500/20 dark:bg-sky-500/25 text-sky-700 dark:text-sky-400">
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
          {/* AI Provider Configuration Card */}
          <div className="group">
            <Card className="bg-gray-50/40 dark:bg-gray-900/20 group-hover:shadow-sm group-hover:border-gray-400 dark:group-hover:border-gray-600 transition-all duration-200">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-md bg-gray-500/15 dark:bg-gray-500/20 text-gray-700 dark:text-gray-400">
                    <Settings className="w-4 h-4" />
                  </div>
                  <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                    Provider Configuration
                  </CardTitle>
                </div>
                <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                  Manage AI, search, embedding, and geocoding providers
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                <ProviderHub />
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <ModelManager showModels={true} showProviderSelector={false} />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="group">
            <Card className="bg-gray-50/40 dark:bg-gray-900/20 group-hover:shadow-sm group-hover:border-gray-400 dark:group-hover:border-gray-600 transition-all duration-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-gray-500/15 dark:bg-gray-500/20 text-gray-700 dark:text-gray-400">
                      <Database className="w-4 h-4" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                        Infospaces
                      </CardTitle>
                      <CardDescription className="text-sm text-gray-600 dark:text-blue-200">
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
                  {/* Infospace List */}
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {infospaces.slice(0, 3).map((infospace) => (
                      <div 
                        key={infospace.id}
                        className={`group flex items-center justify-between p-2 rounded text-sm transition-colors ${
                          infospace.id === activeInfospace?.id 
                            ? 'bg-gray-50/20 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-600' 
                            : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${infospace.id === activeInfospace?.id ? 'bg-gray-600 dark:bg-gray-400' : 'bg-gray-400 dark:bg-gray-500'}`}></div>
                          <span className="truncate">{infospace.name}</span>
                          {infospace.embedding_model && (
                            <div title="This infospace has created embeddings for its content">
                              <Sparkles className="w-3 h-3 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        {infospace.id === activeInfospace?.id ? (
                          ""
                        ) : (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 px-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
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