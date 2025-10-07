  'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Brain, Microscope, FileText, Search, Activity, Terminal, Settings, MessageSquare } from "lucide-react"
import Link from "next/link"
import ProviderManager from '@/components/collection/management/ProviderManager'
import ModelManager from '@/components/collection/management/ModelManager'
import withAuth from '@/hooks/withAuth'

function DesksPage() {

  return (
    <div className="p-6 max-h-full rounded-lg overflow-y-auto">
      <div className="flex items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">HQ</h1>
        </div>
      </div>

      {/* Tools Section */}
      <div className="mb-6">
        <h2 className="text-lg font-medium mb-4 text-gray-700 dark:text-gray-300">Tools</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">


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
          

          

          <div className="group">
            <Link href="/hq/infospaces/monitors" className="block">
              <Card className="group-hover:shadow-md group-hover:border-pink-200 dark:group-hover:border-pink-700 transition-all duration-200 cursor-pointer border border-pink-100 dark:border-pink-900 bg-pink-50/20 dark:bg-pink-950/10">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-pink-500/20 dark:bg-pink-500/20 text-pink-700 dark:text-pink-400">
                      <Activity className="w-4 h-4" />
                    </div>
                    <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                      Monitor
                    </CardTitle>
                  </div>
                  <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
                    Set up automated classification and analysis workflows
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>

          {/* <div className="relative transition-all duration-200 h-full">
            <Card className="backdrop-blur-sm transition-all duration-200 hover:shadow-lg relative h-full overflow-hidden opacity-75 cursor-default">
              <div className="absolute inset-0 bg-gradient-to-r from-[var(--tool-globe-from)] to-[var(--tool-globe-to)] rounded-lg"></div>
              <div className="absolute top-2 right-2 bg-blue-400 text-blue-900 text-xs px-2 py-1 rounded-full font-medium z-20">
                Coming Soon
              </div>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Chat
                </CardTitle>
                <CardDescription>
                  Chat with your data using local or remote AI models.
                </CardDescription>
              </CardHeader>
            </Card>
          </div> */}

          
        </div>
      </div>

      {/* Stores Section */}
      <div className="mb-6">
        <h2 className="text-lg font-medium mb-4 text-gray-700 dark:text-gray-300">Stores</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <Link href="/hq/infospaces/infospace-manager" className="block">
              <Card className="group-hover:shadow-md group-hover:border-slate-300 dark:group-hover:border-slate-600 transition-all duration-200 cursor-pointer border border-slate-200 dark:border-slate-700 bg-slate-50/20 dark:bg-slate-950/10">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-slate-500/20 dark:bg-slate-500/20 text-slate-700 dark:text-slate-400">
                      <Settings className="w-4 h-4" />
                    </div>
                    <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100">
                      Infospace Manager
                    </CardTitle>
                  </div>
                  <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
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

export default withAuth(DesksPage);