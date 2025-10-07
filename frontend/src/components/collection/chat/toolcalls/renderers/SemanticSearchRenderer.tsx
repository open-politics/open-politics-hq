/**
 * Semantic Search Renderer
 * 
 * Renders chunk-level search results from semantic_search tool.
 * Displays similarity scores, asset info, and chunk content.
 */

import React, { useState } from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps, SemanticSearchResult } from '../shared/types';
import { FileText, AlertCircle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface ChunkResult {
  rank: number;
  similarity: number;
  distance: number;
  asset_id: number;
  asset_uuid: string;
  asset_title: string;
  asset_kind: string;
  chunk_id: number;
  chunk_index: number;
  chunk_text: string;
  chunk_metadata?: Record<string, any>;
}

/**
 * Component for a single chunk result
 */
function ChunkCard({ 
  chunk, 
  isExpanded, 
  onToggle, 
  onAssetClick 
}: { 
  chunk: ChunkResult; 
  isExpanded: boolean; 
  onToggle: () => void;
  onAssetClick?: (assetId: number) => void;
}) {
  // Determine similarity color
  const getSimilarityColor = (similarity: number) => {
    if (similarity >= 0.8) return 'text-green-600 dark:text-green-400';
    if (similarity >= 0.6) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-orange-600 dark:text-orange-400';
  };
  
  // Format asset kind
  const formatKind = (kind: string) => {
    const kindMap: Record<string, string> = {
      'text': 'Text',
      'web': 'Web',
      'pdf': 'PDF',
      'csv': 'CSV',
      'json': 'JSON',
      'youtube': 'YouTube',
      'twitter': 'Twitter',
    };
    return kindMap[kind] || kind.toUpperCase();
  };
  
  // Truncate text preview
  const getPreview = (text: string, maxLength: number = 200) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div className="border rounded p-2 hover:bg-accent/20 transition-colors">
      <div className="flex items-start justify-between gap-2">
        {/* Left: Content */}
        <div className="flex-1 min-w-0">
          {/* Header: Rank, Asset Title, Kind */}
          <div className="flex items-center gap-1 mb-1">
            <Badge variant="outline" className="font-mono text-[9px] h-4 px-1">
              #{chunk.rank}
            </Badge>
            <button
              onClick={() => onAssetClick?.(chunk.asset_id)}
              className="font-medium text-xs hover:underline truncate flex items-center gap-0.5 group"
            >
              <FileText className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{chunk.asset_title}</span>
              <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </button>
            <Badge variant="secondary" className="text-[9px] h-4 px-1">
              {formatKind(chunk.asset_kind)}
            </Badge>
          </div>
          
          {/* Chunk Info */}
          <div className="text-[9px] text-muted-foreground mb-1 flex items-center gap-1">
            <span>Chunk #{chunk.chunk_index}</span>
            {chunk.chunk_metadata?.start_char && chunk.chunk_metadata?.end_char && (
              <span className="text-muted-foreground/70">
                • {chunk.chunk_metadata.start_char}-{chunk.chunk_metadata.end_char}
              </span>
            )}
          </div>
          
          {/* Content Preview/Full */}
          <div className={cn(
            "text-[10px] whitespace-pre-wrap break-words leading-relaxed",
            !isExpanded && "line-clamp-2"
          )}>
            {isExpanded ? chunk.chunk_text : getPreview(chunk.chunk_text, 200)}
          </div>
          
          {/* Toggle button if text is long */}
          {chunk.chunk_text && chunk.chunk_text.length > 200 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className="mt-1 h-5 text-[9px] px-1"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-2.5 w-2.5 mr-0.5" />
                  Less
                </>
              ) : (
                <>
                  <ChevronDown className="h-2.5 w-2.5 mr-0.5" />
                  More
                </>
              )}
            </Button>
          )}
        </div>
        
        {/* Right: Similarity Score */}
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <div className={cn(
            "text-lg font-bold font-mono",
            getSimilarityColor(chunk.similarity)
          )}>
            {(chunk.similarity * 100).toFixed(0)}%
          </div>
          <div className="text-[8px] text-muted-foreground">
            sim
          </div>
          {chunk.distance !== undefined && (
            <div className="text-[8px] text-muted-foreground/70 font-mono">
              {chunk.distance.toFixed(3)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Main renderer component
 */
function SemanticSearchResultComponent({ 
  result, 
  compact, 
  onAssetClick 
}: ToolResultRenderProps) {
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  
  const typedResult = result as SemanticSearchResult;
  
  // Handle empty or error states
  if (!typedResult.results || typedResult.results.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 border border-dashed rounded-lg">
        <AlertCircle className="h-4 w-4" />
        <span>No results found for this query.</span>
      </div>
    );
  }
  
  const toggleExpand = (chunkId: number) => {
    setExpandedChunks(prev => {
      const next = new Set(prev);
      if (next.has(chunkId)) {
        next.delete(chunkId);
      } else {
        next.add(chunkId);
      }
      return next;
    });
  };
  
  // Compact view - just show count
  if (compact) {
    return (
      <div className="text-xs text-muted-foreground">
        Found {typedResult.total_results} chunk{typedResult.total_results !== 1 ? 's' : ''} 
        {typedResult.asset_ids && ` across ${typedResult.asset_ids.length} asset${typedResult.asset_ids.length !== 1 ? 's' : ''}`}
      </div>
    );
  }
  
  // Full view
  return (
    <div className="space-y-2">
      {/* Header with query info */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b">
        <div className="flex-1 min-w-0">
          {typedResult.multi_query ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium">Multi-Query</span>
              <Badge variant="secondary" className="text-[9px] h-4 px-1">
                {typedResult.queries.length} queries
              </Badge>
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground truncate">
              "{typedResult.queries[0]}"
            </div>
          )}
        </div>
        
        <div className="text-right shrink-0">
          <div className="text-lg font-bold">{typedResult.total_results}</div>
        </div>
      </div>
      
      {/* Results */}
      <ScrollArea className="max-h-[300px]">
        <div className="space-y-1.5 pr-2">
          {typedResult.results.map((chunk) => (
            <ChunkCard
              key={`chunk-${chunk.chunk_id}`}
              chunk={chunk}
              isExpanded={expandedChunks.has(chunk.chunk_id)}
              onToggle={() => toggleExpand(chunk.chunk_id)}
              onAssetClick={onAssetClick}
            />
          ))}
        </div>
      </ScrollArea>
      
      {/* Footer stats */}
      {typedResult.asset_ids && typedResult.asset_ids.length > 0 && (
        <div className="text-[9px] text-muted-foreground pt-1.5 border-t border-border/50">
          {typedResult.asset_ids.length} unique asset{typedResult.asset_ids.length !== 1 ? 's' : ''}
          {typedResult.query_results_map && Object.keys(typedResult.query_results_map).length > 1 && (
            <details className="mt-1">
              <summary className="cursor-pointer hover:text-foreground">Per-query</summary>
              <div className="mt-1 ml-2 space-y-0.5">
                {Object.entries(typedResult.query_results_map).map(([query, count]) => (
                  <div key={query} className="font-mono truncate">
                    "{query}": {count}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renderer registration export
 */
export const SemanticSearchRenderer: ToolResultRenderer = {
  toolName: 'semantic_search',
  
  canHandle: (result: any) => {
    return result && (
      (result.results && Array.isArray(result.results)) ||
      result.queries !== undefined
    );
  },
  
  render: (props: ToolResultRenderProps) => {
    return <SemanticSearchResultComponent {...props} />;
  },
  
  getSummary: (result: any) => {
    const typed = result as SemanticSearchResult;
    if (typed.multi_query) {
      return `${typed.total_results} chunks from ${typed.queries.length} queries`;
    }
    return `${typed.total_results} chunks for "${typed.queries[0]}"`;
  }
};

