'use client'

/**
 * @deprecated This component is legacy and maintained for backward compatibility.
 * 
 * For new tool renderers, use the Intelligence Tool System:
 * - Create a renderer in `toolcalls/renderers/`
 * - Register it in `toolcalls/core/registerRenderers.ts`
 * - Use `ToolResultDisplay` to render results
 * 
 * See toolcalls/README.md for documentation and examples.
 */

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  Search, 
  FileText, 
  Globe, 
  Rss, 
  Database, 
  CheckCircle2, 
  XCircle,
  ExternalLink,
  Calendar,
  Hash,
  Tag,
  ImageIcon,
  Eye,
  Download,
  Check
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAssetIcon, formatAssetKind, getAssetBadgeClass } from '@/components/collection/assets/AssetSelector'
import { SearchResultViewer, SearchResultData } from './SearchResultViewer'
import { SearchResultIngestor } from './SearchResultIngestor'

interface StructuredToolResponseProps {
  toolName: string
  result: any
  compact?: boolean
  onAssetClick?: (assetId: number) => void
  onBundleClick?: (bundleId: number) => void
}

export function StructuredToolResponse({ 
  toolName, 
  result, 
  compact = false,
  onAssetClick,
  onBundleClick 
}: StructuredToolResponseProps) {
  // State for search result selection and viewing
  const [selectedResults, setSelectedResults] = useState<Set<number>>(new Set())
  const [viewingResult, setViewingResult] = useState<SearchResultData | null>(null)
  const [showIngestor, setShowIngestor] = useState(false)
  
  if (!result || typeof result !== 'object') {
    return null
  }

  // Handle selection toggle
  const toggleResultSelection = (index: number) => {
    const newSelected = new Set(selectedResults)
    if (newSelected.has(index)) {
      newSelected.delete(index)
    } else {
      newSelected.add(index)
    }
    setSelectedResults(newSelected)
  }

  // Handle select all/none
  const toggleSelectAll = (results: any[]) => {
    if (selectedResults.size === results.length) {
      setSelectedResults(new Set())
    } else {
      setSelectedResults(new Set(results.map((_, idx) => idx)))
    }
  }

  // Get selected results for ingestion
  const getSelectedResultsData = (results: any[]): SearchResultData[] => {
    return Array.from(selectedResults)
      .map(idx => results[idx])
      .filter(Boolean)
  }

  // NOTE: Legacy tools (search_assets, explore_bundles, list_bundles) have been replaced
  // by navigate() with the ConversationalAssetExplorer renderer

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'search_assets':
        return <Search className="h-4 w-4" />
      case 'search_web':
      case 'search_and_ingest':
      case 'search_news_with_clarification':
        return <Globe className="h-4 w-4" />
      case 'analyze_assets':
        return <FileText className="h-4 w-4" />
      case 'discover_rss_feeds':
      case 'ingest_rss_feeds':
        return <Rss className="h-4 w-4" />
      case 'list_schemas':
      case 'list_bundles':
      case 'explore_bundles':
        return <Database className="h-4 w-4" />
      default:
        return <Database className="h-4 w-4" />
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-yellow-600" />
      default:
        return <CheckCircle2 className="h-4 w-4 text-blue-600" />
    }
  }

  const renderSearchAssetsResponse = (result: any) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {getStatusIcon(result.status || 'success')}
        <span className="text-sm font-medium">{result.message}</span>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Hash className="h-3 w-3" />
          <span>Found: {result.total_found}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tag className="h-3 w-3" />
          <span>Method: {result.search_method}</span>
        </div>
      </div>

      {result.assets && result.assets.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Assets Found:</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {result.assets.slice(0, compact ? 3 : 5).map((asset: any, index: number) => (
              <div key={index} className="flex items-center gap-2 p-2 bg-muted/50 rounded text-xs hover:bg-muted transition-colors">
                <FileText className="h-3 w-3 text-muted-foreground" />
                <Button
                  variant="link"
                  className="h-auto p-0 text-xs truncate flex-1 justify-start font-normal"
                  onClick={() => onAssetClick?.(asset.id)}
                >
                  {asset.title}
                </Button>
                <Badge variant="outline" className="text-xs">
                  {asset.kind}
                </Badge>
              </div>
            ))}
            {result.assets.length > (compact ? 3 : 5) && (
              <div className="text-xs text-muted-foreground text-center">
                +{result.assets.length - (compact ? 3 : 5)} more assets
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  const renderSearchAndIngestResponse = (result: any) => {
    const searchResults = result.search_results || []
    const hasSearchResults = searchResults.length > 0
    const allSelected = selectedResults.size === searchResults.length && searchResults.length > 0

    return (
      <>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {getStatusIcon(result.status)}
            <span className="text-sm font-medium">{result.message}</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Globe className="h-3 w-3" />
              <span>Provider: {result.provider}</span>
            </div>
            <div className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              <span>Found: {result.results_processed} | Ingested: {result.assets_created}</span>
            </div>
          </div>

          {/* Display search results with selection */}
          {hasSearchResults && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">
                  Search Results ({searchResults.length})
                  {selectedResults.size > 0 && (
                    <span className="text-muted-foreground ml-2">
                      ({selectedResults.size} selected)
                    </span>
                  )}
                </h4>
                <div className="flex items-center gap-2">
                  {selectedResults.size > 0 && (
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowIngestor(true)}
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Ingest Selected
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => toggleSelectAll(searchResults)}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {searchResults.slice(0, compact ? 3 : 12).map((searchResult: any, index: number) => (
                  <div
                    key={index}
                    className={cn(
                      "p-3 border rounded-md transition-colors",
                      selectedResults.has(index) 
                        ? "bg-primary/5 border-primary/50" 
                        : "hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Selection Checkbox */}
                      <Checkbox
                        checked={selectedResults.has(index)}
                        onCheckedChange={() => toggleResultSelection(index)}
                        className="mt-1"
                      />
                      
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h5 className="text-sm font-medium truncate">
                              {searchResult.title}
                            </h5>
                            <p className="text-xs text-muted-foreground truncate">
                              {searchResult.url}
                            </p>
                            {searchResult.content && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {searchResult.content}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {searchResult.score && (
                              <Badge variant="secondary" className="text-xs">
                                {(searchResult.score * 100).toFixed(0)}%
                              </Badge>
                            )}
                            {searchResult.source_metadata?.published_date && (
                              <span className="text-xs text-muted-foreground">
                                {new Date(searchResult.source_metadata.published_date).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {/* Metadata badges */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {searchResult.source_metadata?.image_count > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <ImageIcon className="h-3 w-3 mr-1" />
                              {searchResult.source_metadata.image_count} images
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setViewingResult(searchResult)}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            View Full
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {searchResults.length > (compact ? 3 : 12) && (
                  <div className="text-center">
                    <Badge variant="outline" className="text-xs">
                      +{searchResults.length - (compact ? 3 : 12)} more results
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Display ingested asset IDs if any */}
          {result.asset_ids && result.asset_ids.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Ingested Assets:</h4>
              <div className="flex flex-wrap gap-1">
                {result.asset_ids.slice(0, compact ? 5 : 10).map((id: number, index: number) => (
                  <Button
                    key={index}
                    variant="secondary"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => onAssetClick?.(id)}
                  >
                    #{id}
                  </Button>
                ))}
                {result.asset_ids.length > (compact ? 5 : 10) && (
                  <Badge variant="outline" className="text-xs">
                    +{result.asset_ids.length - (compact ? 5 : 10)} more
                  </Badge>
                )}
              </div>
            </div>
          )}

          {result.bundle_id && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Tag className="h-3 w-3" />
              <Button
                variant="link"
                className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onBundleClick?.(result.bundle_id)}
              >
                Added to bundle #{result.bundle_id}
              </Button>
            </div>
          )}
        </div>

        {/* Search Result Viewer Modal */}
        <SearchResultViewer
          result={viewingResult}
          open={viewingResult !== null}
          onClose={() => setViewingResult(null)}
          onIngest={(result) => {
            setViewingResult(null)
            const index = searchResults.findIndex((r: any) => r.url === result.url)
            if (index !== -1) {
              setSelectedResults(new Set([index]))
              setShowIngestor(true)
            }
          }}
        />

        {/* Search Result Ingestor Modal */}
        <SearchResultIngestor
          results={getSelectedResultsData(searchResults)}
          open={showIngestor}
          onClose={() => setShowIngestor(false)}
          onSuccess={() => {
            setSelectedResults(new Set())
            setShowIngestor(false)
          }}
        />
      </>
    )
  }

  const renderAnalyzeAssetsResponse = (result: any) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {getStatusIcon(result.status)}
        <span className="text-sm font-medium">{result.message}</span>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Hash className="h-3 w-3" />
          <span>Run ID: {result.run_id}</span>
        </div>
        <div className="flex items-center gap-1">
          <FileText className="h-3 w-3" />
          <span>Assets: {result.assets_analyzed}</span>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        <strong>Run Name:</strong> {result.run_name}
      </div>
    </div>
  )

  const renderRSSFeedsResponse = (result: any) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {getStatusIcon(result.status)}
        <span className="text-sm font-medium">{result.message}</span>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
        {result.country && (
          <div className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            <span>Country: {result.country}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Hash className="h-3 w-3" />
          <span>Found: {result.feeds_found || result.assets_created}</span>
        </div>
      </div>

      {result.feeds && result.feeds.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">RSS Feeds:</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {result.feeds.slice(0, compact ? 3 : 5).map((feed: any, index: number) => (
              <div key={index} className="flex items-center gap-2 p-2 bg-muted/50 rounded text-xs">
                <Rss className="h-3 w-3 text-muted-foreground" />
                <span className="truncate flex-1">{feed.title || feed.name || `Feed ${index + 1}`}</span>
                {feed.url && (
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {result.asset_ids && result.asset_ids.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Created Assets:</h4>
          <div className="flex flex-wrap gap-1">
            {result.asset_ids.slice(0, compact ? 5 : 10).map((id: number, index: number) => (
              <Button
                key={index}
                variant="secondary"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onAssetClick?.(id)}
              >
                #{id}
              </Button>
            ))}
            {result.asset_ids.length > (compact ? 5 : 10) && (
              <Badge variant="outline" className="text-xs">
                +{result.asset_ids.length - (compact ? 5 : 10)} more
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  )


  const renderListSchemasResponse = (result: any[]) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <span className="text-sm font-medium">Found {result.length} schemas</span>
      </div>
      
      <div className="space-y-2">
        {result.map((schema: any) => (
          <div key={schema.id} className="p-2 bg-muted/50 rounded">
            <div className="flex items-center gap-2">
              <FileText className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium">{schema.name}</span>
              {schema.version && (
                <Badge variant="outline" className="text-xs">
                  v{schema.version}
                </Badge>
              )}
            </div>
            {schema.description && (
              <p className="text-xs text-muted-foreground mt-1 ml-5">
                {schema.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )


  const renderGenericResponse = (result: any) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {getStatusIcon(result.status || 'success')}
        <span className="text-sm font-medium">{result.message || 'Operation completed'}</span>
      </div>
      
      {result.status === 'error' && result.error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          <strong>Error:</strong> {result.error}
        </div>
      )}

      {/* Show other relevant fields */}
      {Object.entries(result).map(([key, value]) => {
        if (key === 'message' || key === 'status' || key === 'error') return null
        
        return (
          <div key={key} className="text-xs text-muted-foreground">
            <strong>{key}:</strong> {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </div>
        )
      })}
    </div>
  )

  const renderResponse = () => {
    // Handle legacy array results (list_schemas, etc)
    if (Array.isArray(result)) {
      if (toolName === 'list_schemas') {
        return renderListSchemasResponse(result)
      }
      // For other arrays, show as generic
      return renderGenericResponse({ items: result, count: result.length })
    }
    
    switch (toolName) {
      case 'search_assets':
        return renderSearchAssetsResponse(result)
      case 'search_web':
      case 'search_and_ingest':
      case 'search_news_with_clarification':
        return renderSearchAndIngestResponse(result)
      case 'analyze_assets':
        return renderAnalyzeAssetsResponse(result)
      case 'discover_rss_feeds':
      case 'ingest_rss_feeds':
        return renderRSSFeedsResponse(result)
      default:
        return renderGenericResponse(result)
    }
  }

  return (
    <Card className={cn("w-full max-h-96 max-w-[80vw] md:max-w-[70vw] lg:max-w-[55vw]", compact && "text-xs")}>
      <CardHeader className={cn("pb-2", compact && "pb-1")}>
        <CardTitle className={cn("flex items-center gap-2", compact && "text-sm")}>
          {getToolIcon(toolName)}
          <span className="capitalize">{toolName.replace(/_/g, ' ')}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className={cn(compact && "pt-1")}>
        {renderResponse()}
      </CardContent>
    </Card>
  )
}
