'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { AssetRead } from '@/client/models';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from '@/components/ui/button';
import { FileText, Image as ImageIcon, Video, Music, Globe, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from "@/lib/utils";
import { useTextSpanHighlight } from '@/contexts/TextSpanHighlightContext';
import { HighlightedText } from '@/components/ui/highlighted-text';

interface AssetContentPanelProps {
  asset: AssetRead;
  activeField?: string | null;
  selectedSpan?: { fieldKey: string; spanIndex: number; span: any } | null;
  className?: string;
}

const AssetContentPanel: React.FC<AssetContentPanelProps> = ({
  asset,
  activeField = null,
  selectedSpan = null,
  className
}) => {
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);
  const { getHighlightsForAsset, getColoredHighlightsForAsset } = useTextSpanHighlight();

  // Scroll to selected span when it changes
  useEffect(() => {
    if (selectedSpan?.span && selectedSpan.span.text_snippet) {
      // Use a slight delay to ensure the DOM has updated with the new highlights
      const timeoutId = setTimeout(() => {
        // Find span by text content (corrected spans should match properly)
        const allSpans = document.querySelectorAll('[id^="span-"]');
        const targetText = selectedSpan.span.text_snippet.trim();
        
        let spanElement: HTMLElement | null = null;
        
        // Exact text match
        for (const span of allSpans) {
          const spanText = span.textContent?.trim();
          if (spanText && spanText === targetText) {
            spanElement = span as HTMLElement;
            break;
          }
        }
        
        // Partial match fallback for longer snippets
        if (!spanElement && targetText.length > 20) {
          for (const span of allSpans) {
            const spanText = span.textContent?.trim();
            if (spanText && (spanText.includes(targetText) || targetText.includes(spanText))) {
              spanElement = span as HTMLElement;
              break;
            }
          }
        }
        
        if (spanElement) {
          // Scroll to the span with smooth animation and center it in view
          spanElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          });
          
          // Add a brief flash effect to help user locate the span
          spanElement.style.transition = 'all 0.3s ease';
          spanElement.style.transform = 'scale(1.02)';
          spanElement.style.boxShadow = '0 0 12px rgba(234, 179, 8, 0.6)';
          
          setTimeout(() => {
            spanElement.style.transform = '';
            spanElement.style.boxShadow = '';
          }, 800);
        } else {
          console.warn(`[AssetContentPanel] Could not find span for text: "${selectedSpan.span.text_snippet}"`);
        }
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [selectedSpan]);

  // Get text spans for highlighting - update when activeField, showAllFields, or selectedSpan changes
  const highlights = useMemo(() => {
    let baseHighlights: any[] = [];
    
    if (showAllFields) {
      // Use colored highlights for all fields
      baseHighlights = getColoredHighlightsForAsset(asset.id, asset.uuid, true);
    } else if (activeField) {
      // Show only active field highlights
      const allHighlights = getHighlightsForAsset(asset.id, asset.uuid);
      baseHighlights = allHighlights.filter(highlight => 
        highlight.fieldName === activeField || 
        highlight.fieldName === `document.${activeField}` ||
        highlight.fieldName === activeField.replace('document.', '')
      );
    }
    
    // If a specific span is selected, enhance it with special styling
    if (selectedSpan && selectedSpan.span) {
      const span = selectedSpan.span;
      
      // Find if the selected span is already in baseHighlights and replace it
      const existingSpanIndex = baseHighlights.findIndex(h => 
        h.start_char_offset === span.start_char_offset && 
        h.end_char_offset === span.end_char_offset
      );
      
      const selectedHighlight = {
        ...span,
        fieldName: selectedSpan.fieldKey,
        highlightClassName: 'bg-yellow-300 dark:bg-yellow-700/80 ring-2 ring-yellow-500 shadow-lg px-1 rounded'
      };
      
      if (existingSpanIndex >= 0) {
        // Replace the existing span with enhanced styling
        baseHighlights[existingSpanIndex] = selectedHighlight;
      } else {
        // Add the selected span if it's not already there
        baseHighlights.push(selectedHighlight);
      }
      
      // If showAllFields is false and we only want to show the selected span
      if (!showAllFields) {
        return [selectedHighlight];
      }
    }
    
    return baseHighlights;
  }, [asset.id, asset.uuid, activeField, showAllFields, selectedSpan, getHighlightsForAsset, getColoredHighlightsForAsset]);

  const renderAssetHeader = () => (
    <div className="flex-none p-3 border-b bg-muted/10">
      <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="capitalize text-xs">
                {asset.kind}
              </Badge>
              {asset.kind === 'pdf' && (
                <Badge variant="secondary" className="text-xs">
                  Text View
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                ID: {asset.id}
              </span>
            </div>
            <h3 className="text-sm font-semibold truncate">
              {asset.title || `Asset ${asset.id}`}
            </h3>
          {asset.source_identifier && (
            <div className="flex items-center gap-1 mt-1">
              <a 
                href={asset.source_identifier} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <span className="truncate max-w-[160px]">
                  {asset.source_identifier}
                </span>
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
              </a>
            </div>
          )}
        </div>
        
        {/* Highlight Toggle Controls */}
        <div className="flex items-center gap-1 ml-2">
          {selectedSpan ? (
            <div className="flex items-center gap-1">
              <span className="text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded border border-yellow-300">
                Span Selected
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllFields(!showAllFields)}
                className="text-xs h-6 px-2"
              >
                {showAllFields ? "Selected Only" : "Show All"}
              </Button>
            </div>
          ) : (
            <Button
              variant={showAllFields ? "default" : "outline"}
              size="sm"
              onClick={() => setShowAllFields(!showAllFields)}
              className="text-xs h-6 px-2"
            >
              {showAllFields ? "Active Only" : "Show All"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  const renderTextContent = () => {
    if (!asset.text_content) {
      return (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <FileText className="h-8 w-8 mr-2 opacity-50" />
          <span>No text content available</span>
        </div>
      );
    }

    return (
      <div className="prose prose-sm max-w-none p-3 overflow-hidden">
        <HighlightedText
          text={asset.text_content}
          spans={highlights}
          className="text-sm leading-relaxed"
        />
      </div>
    );
  };

  const renderImageContent = () => {
    const showExternalImage = asset.source_identifier && 
      (asset.source_identifier.startsWith('http://') || asset.source_identifier.startsWith('https://'));
    
    const showAuthenticatedImage = asset.blob_path && !showExternalImage;

    if (!showExternalImage && !showAuthenticatedImage) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <ImageIcon className="h-12 w-12 opacity-50 mr-2" />
          <span>Image could not be loaded</span>
        </div>
      );
    }

    return (
      <div className="p-3 h-full flex flex-col">
        {/* Ensure images are prominently displayed */}
        <div className="flex-1 flex items-center justify-center min-h-0">
          {showExternalImage && (
            <img
              src={asset.source_identifier!}
              alt={asset.title || 'Asset image'}
              className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
              style={{ minHeight: '200px' }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                // Could show fallback here
              }}
            />
          )}
          {showAuthenticatedImage && (
            <div className="text-center text-muted-foreground">
              <ImageIcon className="h-16 w-16 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium mb-2">Image Available</p>
              <p className="text-sm">Authenticated image display not implemented in this view</p>
              <p className="text-xs mt-2 opacity-75">Use the full asset detail view to see this image</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderVideoContent = () => (
    <div className="p-3 flex items-center justify-center">
      <div className="text-center text-muted-foreground">
        <Video className="h-12 w-12 mx-auto mb-2 opacity-50" />
        <p>Video content display not implemented in this view</p>
        {asset.source_identifier && (
          <a 
            href={asset.source_identifier} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-primary hover:underline inline-flex items-center gap-1 mt-2"
          >
            View Original
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );

  const renderAudioContent = () => (
    <div className="p-4 flex items-center justify-center">
      <div className="text-center text-muted-foreground">
        <Music className="h-12 w-12 mx-auto mb-2 opacity-50" />
        <p>Audio content display not implemented in this view</p>
        {asset.source_identifier && (
          <a 
            href={asset.source_identifier} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-primary hover:underline inline-flex items-center gap-1 mt-2"
          >
            View Original
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );

  const renderWebContent = () => {
    // For web content, show text content if available, otherwise show summary
    if (asset.text_content) {
      return renderTextContent();
    }

    const summary = asset.source_metadata?.summary as string | undefined;
    
    return (
      <div className="p-3">
        {summary && (
          <div className="mb-3 p-2.5 bg-muted/30 rounded-lg border-l-4 border-primary">
            <h4 className="text-sm font-medium mb-2">Summary</h4>
            <p className="text-sm text-muted-foreground italic">
              {summary}
            </p>
          </div>
        )}
        
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <Globe className="h-8 w-8 mr-2 opacity-50" />
          <div className="text-center">
            <p>Web content preview not available</p>
            {asset.source_identifier && (
              <a 
                href={asset.source_identifier} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-primary hover:underline inline-flex items-center gap-1 mt-2"
              >
                View Original Article
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderPdfContent = () => {
    // For justification viewing, we want to show the extracted text content with highlights,
    // not the PDF viewer itself. This maintains separation between asset viewing and justification viewing.
    if (!asset.text_content) {
      return (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <FileText className="h-8 w-8 mr-2 opacity-50" />
          <div className="text-center">
            <p>No extracted text content available</p>
            <p className="text-xs mt-1 opacity-75">Text must be extracted from PDF to view justifications</p>
          </div>
        </div>
      );
    }

    return (
      <div className="prose prose-sm max-w-none p-3 overflow-hidden">
        <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground border-b pb-2">
          <FileText className="h-4 w-4" />
          <span>Extracted PDF Text Content</span>
          <span className="ml-auto bg-muted px-2 py-1 rounded">
            {asset.text_content.length.toLocaleString()} characters
          </span>
        </div>
        <HighlightedText
          text={asset.text_content}
          spans={highlights}
          className="text-sm leading-relaxed"
        />
      </div>
    );
  };

  const renderContent = () => {
    switch (asset.kind) {
      case 'article':
      case 'text':
      case 'csv_row':
        return renderTextContent();
      case 'image':
        return renderImageContent();
      case 'video':
        return renderVideoContent();
      case 'audio':
        return renderAudioContent();
      case 'web':
        return renderWebContent();
      case 'pdf':
        return renderPdfContent();
      default:
        return renderTextContent();
    }
  };

  return (
    <div className={cn("h-full flex flex-col bg-background", className)}>
      {renderAssetHeader()}
      <ScrollArea className="flex-1">
        {renderContent()}
      </ScrollArea>
    </div>
  );
};

export default AssetContentPanel; 