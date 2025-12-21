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
    <div className="h-full p-6 flex flex-col min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-y-auto scrollbar-hide">
      {/* Compact Infospace Indicator - Top Right */}
      <div className="flex justify-end mb-2">
        <Card className="bg-gray-50/40 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700 w-auto max-w-xs">
          <CardHeader className="p-1">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1 rounded bg-gray-500/15 dark:bg-gray-500/20">
                  <Database className="w-3.5 h-3.5 text-gray-700 dark:text-gray-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                    {activeInfospace?.name || 'No active infospace'}
                  </div>
                  {activeInfospace?.embedding_model && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Sparkles className="w-3 h-3" />
                      <span>Embeddings active</span>
                    </div>
                  )}
                </div>
              </div>
              <Link href="/hq/infospaces/infospace-manager">
                <Button variant="ghost" size="sm" className="h-7 px-2">
                  <Settings className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
        </Card>
      </div>

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

      {/* Provider Configuration Section - Full Width */}
      <div>
        <h2 className="text-lg font-medium mb-4 text-gray-700 dark:text-gray-300">Foundation Services & Provider Configuration</h2>
        <Card className="bg-gray-50/40 dark:bg-gray-900/20 border-gray-300 dark:border-gray-700">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-md bg-gray-500/15 dark:bg-gray-500/20 text-gray-700 dark:text-gray-400">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                  Manage AI, Search, Embedding, and Geocoding Providers
                </CardTitle>
                <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                  Configure your AI models and service providers
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <ProviderHub />
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <ModelManager showModels={true} showProviderSelector={false} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default withAuth(DesksPage);