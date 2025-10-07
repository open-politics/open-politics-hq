'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  Eye, 
  Search,
  ChevronRight,
  Folder,
  FolderOpen,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AssetRead, AssetKind, BundleRead } from '@/client'
import { formatDistanceToNow } from 'date-fns'
import AssetDetailView from '../assets/Views/AssetDetailView'
import BundleDetailView from '../assets/Views/BundleDetailView'
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext'
import { getAssetIcon, formatAssetKind } from '../assets/AssetSelector'
import { useBundleStore } from '@/zustand_stores/storeBundles'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { 
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'

interface ToolResultAssetBrowserProps {
  toolName: string
  result: any
  compact?: boolean
}

interface TreeItem {
  id: string
  type: 'folder' | 'asset'
  name: string
  asset?: AssetRead
  bundle?: { id: number; name: string; description?: string }
  children?: TreeItem[]
  level: number
  isExpanded: boolean
}

export function ToolResultAssetBrowser({ toolName, result, compact = false }: ToolResultAssetBrowserProps) {
  const { activeInfospace } = useInfospaceStore()
  const { fetchBundles } = useBundleStore()
  const [activeDetail, setActiveDetail] = useState<{ type: 'asset' | 'bundle'; id: number } | null>(null)
  const [selectedAssetInBundle, setSelectedAssetInBundle] = useState<number | null>(null)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')

  // Extract assets and bundles from result and build tree
  const { tree, totalFound, message } = useMemo(() => {
    const tree: TreeItem[] = []
    let totalFound = 0
    let message = ''

    if (toolName === 'search_assets' && result.assets) {
      const assets = result.assets as AssetRead[]
      totalFound = result.total_found || assets.length
      message = result.message || `Found ${totalFound} assets`
      
      // Add each asset as a root item
      assets.forEach(asset => {
        tree.push({
          id: `asset-${asset.id}`,
          type: 'asset',
          name: asset.title,
          asset,
          level: 0,
          isExpanded: false
        })
      })
    } else if (toolName === 'explore_bundles' && result.bundle_data) {
      const bundleData = result.bundle_data
      totalFound = result.bundles_explored || Object.keys(bundleData).length
      message = result.message || `Explored ${totalFound} bundles`
      
      // Add each bundle with its assets
      Object.entries(bundleData).forEach(([bundleId, data]: [string, any]) => {
        const bundleAssets = data.assets || []
        const children: TreeItem[] = bundleAssets.map((asset: AssetRead) => ({
          id: `asset-${asset.id}`,
          type: 'asset' as const,
          name: asset.title,
          asset,
          level: 1,
          isExpanded: false
        }))
        
        tree.push({
          id: `bundle-${bundleId}`,
          type: 'folder',
          name: data.bundle_name || `Bundle #${bundleId}`,
          bundle: {
            id: parseInt(bundleId),
            name: data.bundle_name || `Bundle #${bundleId}`,
            description: data.bundle_description
          },
          children,
          level: 0,
          isExpanded: false
        })
      })
    } else if (toolName === 'list_bundles' && result.bundles && Array.isArray(result.bundles)) {
      const bundles = result.bundles as any[]
      totalFound = result.total || bundles.length
      message = `Found ${totalFound} bundle${totalFound !== 1 ? 's' : ''}`
      
      // Add each bundle (without assets for now)
      bundles.forEach(bundle => {
        tree.push({
          id: `bundle-${bundle.id}`,
          type: 'folder',
          name: bundle.name,
          bundle: {
            id: bundle.id,
            name: bundle.name,
            description: bundle.description
          },
          level: 0,
          isExpanded: false
        })
      })
    }

    return { tree, totalFound, message }
  }, [toolName, result])

  // Fetch bundles when component mounts so BundleDetailView can access them
  useEffect(() => {
    if (activeInfospace?.id) {
      fetchBundles(activeInfospace.id)
    }
  }, [activeInfospace?.id, fetchBundles])

  // Filter tree based on search
  const filteredTree = useMemo(() => {
    if (!searchTerm.trim()) return tree
    
    const search = searchTerm.toLowerCase()
    const filterItems = (items: TreeItem[]): TreeItem[] => {
      return items.reduce((acc: TreeItem[], item) => {
        const matchesName = item.name.toLowerCase().includes(search)
        const filteredChildren = item.children ? filterItems(item.children) : undefined
        
        if (matchesName || (filteredChildren && filteredChildren.length > 0)) {
          acc.push({
            ...item,
            children: filteredChildren,
            isExpanded: true // Auto-expand when searching
          })
        }
        return acc
      }, [])
    }
    
    return filterItems(tree)
  }, [tree, searchTerm])

  const toggleExpanded = (itemId: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  const handleItemClick = (item: TreeItem) => {
    if (item.type === 'folder' && item.bundle) {
      setActiveDetail({ type: 'bundle', id: item.bundle.id })
      setSelectedAssetInBundle(null)
    } else if (item.asset) {
      setActiveDetail({ type: 'asset', id: item.asset.id })
    }
  }

  const handleEdit = () => {
    // No-op for tool results - read-only view
  }

  const renderTreeItem = (item: TreeItem): React.ReactNode => {
    const hasChildren = item.children && item.children.length > 0
    const isExpanded = expandedItems.has(item.id) || item.isExpanded
    const isActive = (item.type === 'folder' && activeDetail?.type === 'bundle' && activeDetail.id === item.bundle?.id) ||
                     (item.type === 'asset' && activeDetail?.type === 'asset' && activeDetail.id === item.asset?.id)

    if (item.type === 'folder') {
      return (
        <div key={item.id}>
          <div
            className={cn(
              "flex items-center gap-2 p-2 hover:bg-muted/70 cursor-pointer transition-colors",
              "border-t border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50",
              isActive && "bg-blue-50 dark:bg-blue-900/50 border-l-2 border-blue-500"
            )}
            style={{ paddingLeft: `${item.level * 1.5 + 0.5}rem` }}
            onClick={() => handleItemClick(item)}
          >
            <div className="w-4 h-4 flex items-center justify-center">
              {hasChildren && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-4 w-4 p-0"
                  onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}
                >
                  <ChevronRight className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-90")} />
                </Button>
              )}
            </div>
            <div className="w-4 h-4 flex items-center justify-center">
              {isExpanded ? (
                <FolderOpen className="h-4 w-4 text-blue-600" />
              ) : (
                <Folder className="h-4 w-4 text-blue-600" />
              )}
            </div>
            <span className="text-sm font-semibold flex-1 truncate">{item.name}</span>
            {hasChildren && (
              <Badge variant="secondary" className="text-xs">
                {item.children?.length} items
              </Badge>
            )}
          </div>
          {isExpanded && hasChildren && (
            <div className="ml-4 border-l-2 border-slate-200 dark:border-slate-700">
              {item.children?.map(child => renderTreeItem(child))}
            </div>
          )}
        </div>
      )
    }

    // Asset item
    return (
      <div
        key={item.id}
        className={cn(
          "flex items-center gap-2 p-2 hover:bg-muted/50 cursor-pointer transition-colors rounded-md",
          isActive && "bg-blue-50 dark:bg-blue-900/50 border-l-2 border-blue-500"
        )}
        style={{ paddingLeft: `${item.level * 1.5 + 0.5}rem` }}
        onClick={() => handleItemClick(item)}
      >
        <div className="w-4 h-4" />
        <div className="w-4 h-4 flex items-center justify-center">
          {item.asset && getAssetIcon(item.asset.kind)}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate block">{item.name}</span>
          {item.asset && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatAssetKind(item.asset.kind)}</span>
              {item.asset.updated_at && (
                <>
                  <span>•</span>
                  <span>{formatDistanceToNow(new Date(item.asset.updated_at))} ago</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (compact) {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">{message}</p>
        <p className="text-xs text-muted-foreground">
          Click to expand and browse results
        </p>
      </div>
    )
  }

  return (
    <TextSpanHighlightProvider>
      <div className="border rounded-lg overflow-hidden bg-background">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{message}</span>
            <Badge variant="secondary" className="text-xs">
              {totalFound} items
            </Badge>
          </div>
        </div>

        {/* Split pane content */}
        <div className="h-[600px]">
          <ResizablePanelGroup direction="horizontal" className="h-full w-full">
            <ResizablePanel 
              defaultSize={40} 
              minSize={30} 
              maxSize={70}
              className="min-w-[250px]"
            >
              <div className="h-full flex flex-col">
                {/* Search bar */}
                <div className="flex-none p-3 border-b">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search results..."
                      className="pl-8 h-9"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>

                {/* Tree view */}
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-1">
                    {filteredTree.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        No results found
                      </div>
                    ) : (
                      filteredTree.map(item => renderTreeItem(item))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle className="bg-border" />

            <ResizablePanel 
              defaultSize={60} 
              minSize={30} 
              maxSize={70}
            >
              <div className="h-full border-l">
                {activeDetail?.type === 'asset' ? (
                  <AssetDetailView
                    selectedAssetId={activeDetail.id}
                    highlightAssetIdOnOpen={null}
                    onEdit={handleEdit}
                    schemas={[]}
                  />
                ) : activeDetail?.type === 'bundle' ? (
                  (() => {
                    // Find the bundle data from tree
                    const bundleItem = tree.find(item => 
                      item.type === 'folder' && item.bundle?.id === activeDetail.id
                    )
                    
                    if (!bundleItem || !bundleItem.bundle) {
                      return (
                        <div className="h-full flex items-center justify-center p-6">
                          <div className="text-center">
                            <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
                            <h3 className="text-lg font-medium text-muted-foreground">Bundle not found</h3>
                          </div>
                        </div>
                      )
                    }
                    
                    // For list_bundles (no children), use the real BundleDetailView to fetch assets
                    if (!bundleItem.children || bundleItem.children.length === 0) {
                      return (
                        <BundleDetailView
                          selectedBundleId={activeDetail.id}
                          onLoadIntoRunner={undefined}
                          selectedAssetId={selectedAssetInBundle}
                          onAssetSelect={setSelectedAssetInBundle}
                          highlightAssetId={null}
                        />
                      )
                    }
                    
                    // For explore_bundles (has children), use inline view
                    return (
                      <ScrollArea className="h-full">
                        <div className="p-6 space-y-6">
                          {/* Bundle Header */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Folder className="h-6 w-6 text-blue-600" />
                              <h2 className="text-2xl font-bold">{bundleItem.bundle.name}</h2>
                            </div>
                            {bundleItem.bundle.description && (
                              <p className="text-muted-foreground">
                                {bundleItem.bundle.description}
                              </p>
                            )}
                            <Badge variant="secondary">
                              {bundleItem.children.length} assets
                            </Badge>
                          </div>

                          {/* Bundle Assets */}
                          <div className="space-y-2">
                            <h3 className="text-lg font-semibold">Assets</h3>
                            <div className="space-y-2">
                              {bundleItem.children.map(child => {
                                if (!child.asset) return null
                                const isSelected = selectedAssetInBundle === child.asset.id
                                
                                return (
                                  <div
                                    key={child.id}
                                    className={cn(
                                      "p-3 border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors",
                                      isSelected && "bg-accent border-primary"
                                    )}
                                    onClick={() => {
                                      setSelectedAssetInBundle(child.asset!.id)
                                      setActiveDetail({ type: 'asset', id: child.asset!.id })
                                    }}
                                  >
                                    <div className="flex items-start gap-3">
                                      <div className="w-8 h-8 flex items-center justify-center">
                                        {getAssetIcon(child.asset.kind)}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <h4 className="font-medium truncate">{child.asset.title}</h4>
                                        <div className="flex items-center gap-2 mt-1">
                                          <Badge variant="outline" className="text-xs">
                                            {formatAssetKind(child.asset.kind)}
                                          </Badge>
                                          {child.asset.updated_at && (
                                            <span className="text-xs text-muted-foreground">
                                              {formatDistanceToNow(new Date(child.asset.updated_at))} ago
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <Button variant="ghost" size="sm">
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      </ScrollArea>
                    )
                  })()
                ) : (
                  <div className="h-full flex items-center justify-center p-6">
                    <div className="text-center">
                      <Eye className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
                      <h3 className="text-lg font-medium text-muted-foreground">Select an item to view details</h3>
                      <p className="text-sm text-muted-foreground mt-2">
                        Browse the {totalFound} result{totalFound !== 1 ? 's' : ''} on the left
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </TextSpanHighlightProvider>
  )
}

