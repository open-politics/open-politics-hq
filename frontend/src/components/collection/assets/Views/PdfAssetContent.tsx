import React, { useState, useMemo, useRef, useCallback } from 'react';
import { AssetRead } from '@/client';
import { AuthenticatedPDF } from '../Viewers/AuthenticatedPDF';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Layers, Search, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import TextContentRenderer from './Articles/TextContentRenderer';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PdfAssetContentProps {
  asset: AssetRead;
  renderEditableField: (asset: AssetRead, field: 'title' | 'event_timestamp') => React.ReactNode;
  hasChildren: boolean;
  childAssets: AssetRead[];
  setActiveTab: (tab: 'content' | 'children') => void;
  handleChildAssetClick: (asset: AssetRead) => void;
}

/** Renders text with search term highlighted */
function HighlightedTextContent({ text, searchTerm }: { text: string; searchTerm: string }) {
  if (!searchTerm.trim()) {
    return <TextContentRenderer content={text} />;
  }
  const term = searchTerm.trim();
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  // split with capturing group yields [before, match1, between, match2, ...] - odd indices are matches
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/70 px-0.5 rounded">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </span>
  );
}

export const PdfAssetContent = React.memo<PdfAssetContentProps>(
  ({ asset, renderEditableField, hasChildren, childAssets, setActiveTab, handleChildAssetClick }) => {
    const [textSearchTerm, setTextSearchTerm] = useState('');
    // Find the actual scrollable div in the ScrollArea
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    // Full text: parent asset text_content, or concatenate from child pages
    const fullText = useMemo(() => {
      if (asset.text_content?.trim()) return asset.text_content;
      if (hasChildren && childAssets.length > 0) {
        const sorted = [...childAssets].sort((a, b) => (a.part_index ?? 0) - (b.part_index ?? 0));
        return sorted.map((c) => c.text_content || '').join('\n\n');
      }
      return '';
    }, [asset.text_content, hasChildren, childAssets]);

    // Helper: get the actual scrollable viewport inside ScrollArea
    const getScrollViewport = useCallback((): HTMLDivElement | null => {
      if (!scrollAreaRef.current) return null;
      // Try to find first descendant that is scrollable
      // ScrollArea implementation often forwards ref to a wrapper; inner div is scrollable
      // We'll grab the element with overflow-y: auto (or any, for robustness)

      const findScrollable = (el: HTMLElement): HTMLDivElement | null => {
        if (el.scrollHeight > el.clientHeight) return el as HTMLDivElement;
        for (let i = 0; i < el.children.length; i++) {
          const child = el.children[i];
          if (child instanceof HTMLElement) {
            const found = findScrollable(child);
            if (found) return found;
          }
        }
        return null;
      };
      return findScrollable(scrollAreaRef.current);
    }, []);

    const handleScrollToTop = useCallback(() => {
      const viewport = getScrollViewport();
      if (viewport) {
        viewport.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, [getScrollViewport]);

    const handleScrollToBottom = useCallback(() => {
      const viewport = getScrollViewport();
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
      }
    }, [getScrollViewport]);

    return (
      <div className="p-4 h-full flex flex-col">
        <div className="mb-4">
          {renderEditableField(asset, 'title')}
        </div>
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          <div className="flex-1 min-h-[300px] bg-muted/20 rounded overflow-hidden">
            {asset.blob_path && (
              <AuthenticatedPDF
                key={asset.blob_path}
                blobPath={asset.blob_path}
                title={asset.title || 'PDF Document'}
                className="w-full h-full border-0"
              />
            )}
          </div>

          {/* Full text content beneath document with search */}
          {fullText && (
            <div className="border rounded-lg overflow-hidden bg-background flex flex-col min-h-0 relative">
              <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search in text..."
                    value={textSearchTerm}
                    onChange={(e) => setTextSearchTerm(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {fullText.length.toLocaleString()} chars
                </Badge>
              </div>
              {/* SCROLL AREA + sticky scroll controls */}
              <div className="relative flex-1 min-h-0">
                {/* sticky/floating scroll up/down buttons */}
                <div
                  className="absolute right-2 top-4 z-20 flex flex-col gap-2"
                  style={{ pointerEvents: 'none' }}
                >
                  <button
                    type="button"
                    aria-label="Scroll to top"
                    onClick={handleScrollToTop}
                    tabIndex={-1}
                    className="bg-background shadow border border-muted hover:bg-muted text-muted-foreground rounded-full p-1 mb-1 transition-colors flex items-center justify-center"
                    style={{ pointerEvents: 'auto', position: 'relative' }}
                  >
                    <ArrowUpCircle className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    aria-label="Scroll to bottom"
                    onClick={handleScrollToBottom}
                    tabIndex={-1}
                    className="bg-background shadow border border-muted hover:bg-muted text-muted-foreground rounded-full p-1 transition-colors flex items-center justify-center"
                    style={{ pointerEvents: 'auto', position: 'relative' }}
                  >
                    <ArrowDownCircle className="h-6 w-6" />
                  </button>
                </div>
                <ScrollArea className="max-h-[500px] overflow-y-auto w-full h-full">
                  {/* Attach ref to outer wrapper, but scroll to correct inner element */}
                  <div ref={scrollAreaRef} className="h-full w-full">
                    <div
                      className="h-full overflow-y-auto"
                      tabIndex={-1}
                      style={{ outline: 'none' }}
                    >
                      <div className="p-4 text-sm prose prose-sm dark:prose-invert max-w-none">
                        <HighlightedTextContent text={fullText} searchTerm={textSearchTerm} />
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}

          {hasChildren && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-xs">
                  <Layers className="h-3 w-3 mr-1" />
                  {childAssets.length} PDF Pages
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Click a page preview or use the "PDF Pages" tab to view details
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.asset.blob_path === nextProps.asset.blob_path &&
    prevProps.asset.id === nextProps.asset.id &&
    prevProps.asset.text_content === nextProps.asset.text_content &&
    prevProps.hasChildren === nextProps.hasChildren &&
    prevProps.childAssets === nextProps.childAssets
);

PdfAssetContent.displayName = 'PdfAssetContent';
