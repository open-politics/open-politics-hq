'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  ExternalLink, 
  Calendar, 
  Image as ImageIcon,
  FileText,
  Globe,
  X,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveMarkdownUrls, formatPercentage } from './toolcalls/shared/utils';

export interface SearchResultData {
  title: string;
  url: string;
  content: string;
  text_content?: string;
  score?: number;
  provider?: string;
  kind?: string;
  stub?: boolean;  // Indicates if this is a reference-only asset
  source_identifier?: string;
  source_metadata?: {
    search_query?: string;
    search_provider?: string;
    search_score?: number;
    search_rank?: number;
    published_date?: string;
    favicon?: string;
    tavily_images?: Array<{ url: string; description?: string }>;
    image_count?: number;
  };
}

interface SearchResultViewerProps {
  result: SearchResultData | null;
  open: boolean;
  onClose: () => void;
  onIngest?: (result: SearchResultData) => void;
}

export function SearchResultViewer({ 
  result, 
  open, 
  onClose,
  onIngest 
}: SearchResultViewerProps) {
  if (!result) return null;

  const handleIngest = () => {
    onIngest?.(result);
  };

  const fullContent = result.text_content || result.content;
  const hasImages = result.source_metadata?.tavily_images && result.source_metadata.tavily_images.length > 0;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl">{result.title}</DialogTitle>
              <DialogDescription className="flex items-center gap-2 mt-2">
                <Globe className="h-3 w-3" />
                <a 
                  href={result.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs hover:underline truncate"
                >
                  {result.url}
                </a>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-wrap">
          {result.score && (
            <Badge variant="secondary" className="text-xs">
              <Sparkles className="h-3 w-3 mr-1" />
              Score: {formatPercentage(result.score)}
            </Badge>
          )}
          {result.provider && (
            <Badge variant="outline" className="text-xs">
              {result.provider}
            </Badge>
          )}
          {result.source_metadata?.published_date && (
            <Badge variant="outline" className="text-xs">
              <Calendar className="h-3 w-3 mr-1" />
              {new Date(result.source_metadata.published_date).toLocaleDateString()}
            </Badge>
          )}
          {hasImages && (
            <Badge variant="outline" className="text-xs">
              <ImageIcon className="h-3 w-3 mr-1" />
              {result.source_metadata?.image_count || result.source_metadata?.tavily_images?.length} images
            </Badge>
          )}
        </div>

        <Separator />

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 pr-4">
            {/* Images Section */}
            {hasImages && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Images from Article
                </h3>
                <div className="grid grid-cols-2 gap-3 max-h-80 overflow-auto">
                  {result.source_metadata?.tavily_images?.map((image, idx) => (
                    <div key={idx} className="group relative">
                      <img
                        src={image.url}
                        alt={image.description || `Image ${idx + 1}`}
                        className="w-full h-48 object-cover rounded-lg border"
                        loading="lazy"
                      />
                      {image.description && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-2 rounded-b-lg opacity-0 group-hover:opacity-100 transition-opacity">
                          {image.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Content Section - Rendered as Markdown */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Full Content
              </h3>
              <div className="text-sm leading-relaxed max-h-screen overflow-auto space-y-4">
                <ReactMarkdown
                  components={{
                    a: ({ node, children, ...props }) => (
                      <a 
                        {...props} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-blue-600 dark:text-blue-400 hover:underline font-semibold underline"
                      >
                        {children}
                      </a>
                    ),
                    img: ({ node, ...props }) => (
                      <img {...props} alt={props.alt || ''} className="rounded-lg my-4 max-w-full" loading="lazy" />
                    ),
                    p: ({ node, children, ...props }) => (
                      <p {...props} className="mb-4">{children}</p>
                    ),
                    h1: ({ node, children, ...props }) => (
                      <h1 {...props} className="text-2xl font-bold mb-4 mt-6">{children}</h1>
                    ),
                    h2: ({ node, children, ...props }) => (
                      <h2 {...props} className="text-xl font-bold mb-3 mt-5">{children}</h2>
                    ),
                    h3: ({ node, children, ...props }) => (
                      <h3 {...props} className="text-lg font-semibold mb-2 mt-4">{children}</h3>
                    ),
                    ul: ({ node, children, ...props }) => (
                      <ul {...props} className="list-disc list-inside mb-4 space-y-1">{children}</ul>
                    ),
                    ol: ({ node, children, ...props }) => (
                      <ol {...props} className="list-decimal list-inside mb-4 space-y-1">{children}</ol>
                    ),
                  }}
                >
                  {resolveMarkdownUrls(fullContent, result.url)}
                </ReactMarkdown>
              </div>
            </div>

            {/* Metadata Section */}
            {result.source_metadata && (
              <div className="space-y-2 text-xs text-muted-foreground">
                <Separator />
                <div className="grid grid-cols-2 gap-2">
                  {result.source_metadata.search_query && (
                    <div>
                      <span className="font-medium">Search Query:</span> {result.source_metadata.search_query}
                    </div>
                  )}
                  {result.source_metadata.search_rank && (
                    <div>
                      <span className="font-medium">Rank:</span> #{result.source_metadata.search_rank}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <Separator />

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
          >
            Close
          </Button>
          {onIngest && (
            <Button
              size="sm"
              onClick={handleIngest}
            >
              <FileText className="h-4 w-4 mr-2" />
              Ingest This Result
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

