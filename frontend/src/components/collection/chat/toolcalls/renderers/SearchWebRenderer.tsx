/**
 * Search Web Renderer
 * 
 * Renders web search results with rich previews, selection, and ingestion capabilities
 */

import React, { useState } from 'react';
import { ToolResultRenderProps } from '../shared/types';
import { useSelection } from '../shared/hooks';
import { resolveMarkdownUrls, formatPercentage, formatCount } from '../shared/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Globe,
  Calendar,
  Image as ImageIcon,
  Eye,
  Download,
  Check,
  Search,
  Sparkles,
  ExternalLink,
  Link as LinkIcon
} from 'lucide-react';
import { SearchResultViewer, SearchResultData } from '../../SearchResultViewer';
import { SearchResultIngestor } from '../../SearchResultIngestor';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

export interface SearchWebResult {
  query: string;
  provider: string;
  results: SearchResultData[];
  total_found: number;
  message: string;
}

export const SearchWebRenderer = {
  toolName: 'search_web',
  
  canHandle: (result: any): boolean => {
    return result && 
           typeof result === 'object' && 
           'results' in result && 
           Array.isArray(result.results) &&
           'provider' in result;
  },
  
  getSummary: (result: SearchWebResult): string => {
    return `Found ${result.total_found} results from ${result.provider}`;
  },
  
  render: function Render({ result, compact }: ToolResultRenderProps) {
    const searchResult = result as SearchWebResult;
    const selection = useSelection();
    const [viewingResult, setViewingResult] = useState<SearchResultData | null>(null);
    const [showIngestor, setShowIngestor] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    
    const results = searchResult.results || [];
    const hasResults = results.length > 0;
    
    // Filter results based on search
    const filteredResults = results.filter(r => 
      !searchTerm || 
      r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.content && r.content.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    
    if (compact) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <Globe className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
            <span className="font-medium">{searchResult.message}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-[10px] sm:text-xs">
              {searchResult.provider}
            </Badge>
            <span>•</span>
            <span>{searchResult.total_found} results</span>
          </div>
        </div>
      );
    }
    
    return (
      <>
        <div className="space-y-2">
          {/* Header with search query info */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Badge variant="secondary" className="text-[10px]">
                {searchResult.provider}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {searchResult.total_found}
              </Badge>
              {searchResult.query && (
                <span className="text-[10px] text-muted-foreground truncate">
                  "{searchResult.query}"
                </span>
              )}
            </div>
          </div>
          
          {/* Search and actions bar */}
          {hasResults && (
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Filter..."
                  className="pl-7 h-7 text-[11px]"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={() => selection.toggleAll(results.length)}
              >
                <Check className="h-3 w-3 mr-1" />
                {selection.isAllSelected(results.length) ? 'None' : 'All'}
              </Button>
              {selection.selected.size > 0 && (
                <Button
                  size="sm"
                  className="h-7 px-2 text-[10px]"
                  onClick={() => setShowIngestor(true)}
                >
                  <Download className="h-3 w-3 mr-1" />
                  Ingest ({selection.selected.size})
                </Button>
              )}
            </div>
          )}
          
          {/* Results list */}
          {hasResults ? (
            <ScrollArea className="h-[300px] -mx-1 px-1">
              <div className="space-y-1.5">
                {filteredResults.map((searchResult, index) => {
                  // Find original index for selection state
                  const originalIndex = results.findIndex(r => r.url === searchResult.url);
                  const isSelected = selection.selected.has(originalIndex);
                  
                  return (
                    <div
                      key={index}
                      className={cn(
                        "p-2 border rounded transition-all",
                        isSelected 
                          ? "bg-primary/5 border-primary/50" 
                          : "hover:bg-accent/30"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {/* Selection Checkbox */}
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => selection.toggle(originalIndex)}
                          className="mt-0.5 shrink-0"
                        />
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0 space-y-1">
                          {/* Title and URL */}
                          <div>
                            <h4 className="text-xs font-semibold leading-tight mb-0.5">
                              {searchResult.title}
                            </h4>
                            <a 
                              href={searchResult.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] text-muted-foreground hover:text-primary hover:underline flex items-center gap-0.5 truncate"
                            >
                              <Globe className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{searchResult.url}</span>
                              <ExternalLink className="h-2 w-2 shrink-0" />
                            </a>
                          </div>
                          
                          {/* Content preview */}
                          {searchResult.content && (
                            <div className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
                              <ReactMarkdown
                                components={{
                                  a: ({ node, children, ...props }) => (
                                    <a 
                                      {...props} 
                                      target="_blank" 
                                      rel="noopener noreferrer" 
                                      className="text-blue-600 dark:text-blue-400 font-semibold underline hover:no-underline"
                                    >
                                      {children}
                                    </a>
                                  ),
                                  p: ({ node, children, ...props }) => (
                                    <span {...props}>{children}</span>
                                  ),
                                }}
                              >
                                {resolveMarkdownUrls(searchResult.content.slice(0, 300), searchResult.url)}
                              </ReactMarkdown>
                            </div>
                          )}
                          
                          {/* Metadata badges */}
                          <div className="flex items-center gap-1 flex-wrap">
                            {searchResult.score && (
                              <Badge variant="secondary" className="text-[9px] h-4 px-1">
                                {formatPercentage(searchResult.score)}
                              </Badge>
                            )}
                            {searchResult.source_metadata?.published_date && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">
                                {new Date(searchResult.source_metadata.published_date).toLocaleDateString()}
                              </Badge>
                            )}
                            {searchResult.source_metadata?.image_count && searchResult.source_metadata.image_count > 0 && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">
                                <ImageIcon className="h-2 w-2 mr-0.5" />
                                {searchResult.source_metadata?.image_count}
                              </Badge>
                            )}
                            {searchResult.stub && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">
                                Ref
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1.5 text-[9px] ml-auto"
                              onClick={() => setViewingResult(searchResult)}
                            >
                              <Eye className="h-2.5 w-2.5 mr-0.5" />
                              View
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                
                {filteredResults.length === 0 && searchTerm && (
                  <div className="text-center py-6 text-muted-foreground">
                    <Search className="h-6 w-6 mx-auto mb-1 opacity-50" />
                    <p className="text-[10px]">No results match your filter</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Globe className="h-6 w-6 mx-auto mb-1 opacity-50" />
              <p className="text-[10px]">No search results found</p>
            </div>
          )}
        </div>
        
        {/* Search Result Viewer Modal */}
        <SearchResultViewer
          result={viewingResult}
          open={viewingResult !== null}
          onClose={() => setViewingResult(null)}
          onIngest={(result) => {
            setViewingResult(null);
            const index = results.findIndex((r: any) => r.url === result.url);
            if (index !== -1) {
              selection.setSelected(new Set([index]));
              setShowIngestor(true);
            }
          }}
        />
        
        {/* Search Result Ingestor Modal */}
        <SearchResultIngestor
          results={selection.getSelected(results)}
          open={showIngestor}
          onClose={() => setShowIngestor(false)}
          onSuccess={() => {
            selection.clear();
            setShowIngestor(false);
          }}
        />
      </>
    );
  }
};
