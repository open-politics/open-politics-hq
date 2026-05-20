import React, { useState, useMemo, useRef, useCallback, useEffect, Fragment } from 'react';
import { AssetRead } from '@/client';
import { AuthenticatedPDF } from '../Viewers/AuthenticatedPDF';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Layers, Search, ArrowUpCircle, ArrowDownCircle, ChevronDown } from 'lucide-react';
import TextContentRenderer from './Articles/TextContentRenderer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

/** Viewport width at or above this uses side‑by‑side when layout is Auto */
const PDF_SPLIT_WIDE_PX = 760;

/** 0-based start index of the `ordinal`-th non-overlapping case-insensitive match of `needle` in `haystack`, or -1 */
function nthMatchStart(haystack: string, needle: string, ordinal: number): number {
  const t = needle.trim();
  if (!t || ordinal < 0) return -1;
  const lower = haystack.toLowerCase();
  const tl = t.toLowerCase();
  let pos = 0;
  let n = 0;
  while (pos < lower.length) {
    const i = lower.indexOf(tl, pos);
    if (i < 0) return -1;
    if (n === ordinal) return i;
    n += 1;
    pos = i + tl.length;
  }
  return -1;
}

interface PdfAssetContentProps {
  asset: AssetRead;
  hasChildren: boolean;
  childAssets: AssetRead[];
  setActiveTab: (tab: 'content' | 'children') => void;
  handleChildAssetClick: (asset: AssetRead) => void;
  /** Inline text edit: same panel chrome, search, and max-height as read-only */
  textDraft?: {
    active: boolean;
    value: string;
    onChange: (value: string) => void;
  };
}

/** Renders text with search term highlighted; `activeHitIndex` selects which match gets the focus ring. */
function HighlightedTextContent({
  text,
  searchTerm,
  activeHitIndex = 0,
}: {
  text: string;
  searchTerm: string;
  activeHitIndex?: number;
}) {
  if (!searchTerm.trim()) {
    return <TextContentRenderer content={text} />;
  }
  const term = searchTerm.trim();
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  let hitOrdinal = 0;
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const ord = hitOrdinal;
        hitOrdinal += 1;
        return (
          <mark
            key={i}
            data-search-hit={ord}
            className={cn(
              'rounded bg-yellow-200 px-0.5 dark:bg-yellow-800/70',
              activeHitIndex === ord &&
                'ring-2 ring-primary ring-offset-1 ring-offset-background dark:ring-offset-background'
            )}
          >
            {part}
          </mark>
        );
      })}
    </span>
  );
}

type PdfSplitPreference = 'auto' | 'stacked' | 'side-by-side';

export const PdfAssetContent = React.memo<PdfAssetContentProps>(
  ({ asset, hasChildren, childAssets, setActiveTab, handleChildAssetClick, textDraft }) => {
    const [textSearchTerm, setTextSearchTerm] = useState('');
    const [splitPreference, setSplitPreference] = useState<PdfSplitPreference>('auto');
    const isMobile = useIsMobile();
    const splitMeasureRef = useRef<HTMLDivElement>(null);
    const [splitContainerWidth, setSplitContainerWidth] = useState(0);

    useEffect(() => {
      const el = splitMeasureRef.current;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? 0;
        setSplitContainerWidth(w);
      });
      ro.observe(el);
      setSplitContainerWidth(el.getBoundingClientRect().width);
      return () => ro.disconnect();
    }, []);

    const layout = useMemo((): 'stacked' | 'side-by-side' => {
      if (isMobile) return 'stacked';
      if (splitPreference === 'stacked') return 'stacked';
      if (splitPreference === 'side-by-side') return 'side-by-side';
      return splitContainerWidth >= PDF_SPLIT_WIDE_PX ? 'side-by-side' : 'stacked';
    }, [isMobile, splitPreference, splitContainerWidth]);

    /** Radix ScrollArea root — viewport is the real scroll container */
    const scrollAreaRootRef = useRef<HTMLDivElement | null>(null);
    const textBodyRef = useRef<HTMLDivElement>(null);
    const textEditRef = useRef<HTMLTextAreaElement>(null);

    // Full text: parent asset text_content, or concatenate from child pages
    const fullText = useMemo(() => {
      if (asset.text_content?.trim()) return asset.text_content;
      if (hasChildren && childAssets.length > 0) {
        const sorted = [...childAssets].sort((a, b) => (a.part_index ?? 0) - (b.part_index ?? 0));
        return sorted.map((c) => c.text_content || '').join('\n\n');
      }
      return '';
    }, [asset.text_content, hasChildren, childAssets]);

    const charCount = textDraft?.active ? textDraft.value.length : fullText.length;

    const textSearchSource = textDraft?.active ? textDraft.value : fullText;

    const textMatchIndices = useMemo(() => {
      const t = textSearchTerm.trim();
      if (!t) return [];
      const lower = textSearchSource.toLowerCase();
      const tl = t.toLowerCase();
      const out: number[] = [];
      let pos = 0;
      while (pos < lower.length) {
        const i = lower.indexOf(tl, pos);
        if (i < 0) break;
        out.push(i);
        pos = i + tl.length;
      }
      return out;
    }, [textSearchTerm, textSearchSource]);

    const textMatchCount = textMatchIndices.length;

    const [textSearchHitIndex, setTextSearchHitIndex] = useState(0);

    useEffect(() => {
      setTextSearchHitIndex(0);
    }, [textSearchTerm]);

    useEffect(() => {
      if (textMatchCount === 0) {
        setTextSearchHitIndex(0);
        return;
      }
      setTextSearchHitIndex((i) => Math.min(i, textMatchCount - 1));
    }, [textMatchCount]);

    const getScrollAreaViewport = useCallback((): HTMLElement | null => {
      const root = scrollAreaRootRef.current;
      if (!root) return null;
      return root.querySelector('[data-radix-scroll-area-viewport]');
    }, []);

    /**
     * Edit mode: move selection to the active hit when the user navigates (Enter / term change).
     * Intentionally does not depend on draft text so typing is not interrupted; recomputes offset
     * from the current textarea value when this runs.
     */
    useEffect(() => {
      if (!textDraft?.active || !textSearchTerm.trim() || textMatchCount === 0) return;
      const ta = textEditRef.current;
      if (!ta) return;
      const t = textSearchTerm.trim();
      const idx = nthMatchStart(ta.value, t, textSearchHitIndex);
      if (idx < 0) return;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(idx, idx + t.length);
      const before = ta.value.slice(0, idx);
      const line = before.split('\n').length;
      const lh = parseFloat(getComputedStyle(ta).lineHeight || '20') || 20;
      const targetLine = Math.max(1, line);
      ta.scrollTop = Math.max(0, (targetLine - 1) * lh - ta.clientHeight / 2 + lh / 2);
      requestAnimationFrame(() => {
        ta.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    }, [textDraft?.active, textSearchTerm, textSearchHitIndex, textMatchCount]);

    /** Read-only: scroll active search highlight into view (centered) */
    useEffect(() => {
      if (textDraft?.active || !textSearchTerm.trim() || textMatchCount === 0) return;
      const mark = textBodyRef.current?.querySelector(
        `mark[data-search-hit="${textSearchHitIndex}"]`
      );
      mark?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [textSearchHitIndex, textSearchTerm, textDraft?.active, fullText, textMatchCount]);

    /** Match read-only block height: grow with content inside ScrollArea (no fixed min-h jump) */
    useEffect(() => {
      const el = textEditRef.current;
      if (!el || !textDraft?.active) return;
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    }, [textDraft?.active, textDraft?.value]);

    const handleScrollToTop = useCallback(() => {
      const viewport = getScrollAreaViewport();
      viewport?.scrollTo({ top: 0, behavior: 'smooth' });
    }, [getScrollAreaViewport]);

    const handleScrollToBottom = useCallback(() => {
      const viewport = getScrollAreaViewport();
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
      }
    }, [getScrollAreaViewport]);

    const layoutTriggerLabel =
      splitPreference === 'auto'
        ? 'Layout · auto'
        : splitPreference === 'stacked'
          ? 'Layout · stacked'
          : 'Layout · split';

    return (
      <div className="h-full flex flex-col min-h-0 min-w-0">
        <div ref={splitMeasureRef} className="flex flex-col gap-2 flex-1 min-h-0 min-w-0">
          <div className="flex justify-end shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
                  aria-label="Choose PDF and text layout"
                >
                  <span>{layoutTriggerLabel}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[12.5rem]">
                <DropdownMenuRadioGroup
                  value={splitPreference}
                  onValueChange={(v) => setSplitPreference(v as PdfSplitPreference)}
                >
                  <DropdownMenuRadioItem value="auto" className="text-xs">
                    Automatic
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="stacked" className="text-xs">
                    PDF above text
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="side-by-side"
                    disabled={isMobile}
                    className="text-xs"
                  >
                    PDF left, text right
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div
            className={cn(
              'flex-1 min-h-0 min-w-0 flex gap-4',
              layout === 'side-by-side' ? 'flex-row' : 'flex-col'
            )}
          >
            <div
              className={cn(
                'bg-muted/20 rounded min-h-0 flex flex-col',
                layout === 'side-by-side' ? 'flex-1 min-w-0 basis-1/2' : 'flex-1 min-h-[200px]'
              )}
            >
              {asset.blob_path && (
                <AuthenticatedPDF
                  key={asset.blob_path}
                  blobPath={asset.blob_path}
                  title={asset.title || 'PDF Document'}
                  className="w-full h-full min-h-0 flex-1 border-0"
                />
              )}
            </div>

            {/* Full text content with search — same layout in edit (textarea replaces body only) */}
            {(fullText || textDraft?.active) && (
            <div
              className={cn(
                'border rounded-lg overflow-hidden bg-background flex flex-col min-h-0 relative',
                layout === 'side-by-side' ? 'flex-1 min-w-0 basis-1/2' : 'min-h-0 flex-1'
              )}
            >
              <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search in text..."
                    value={textSearchTerm}
                    onChange={(e) => setTextSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || textMatchCount === 0) return;
                      e.preventDefault();
                      setTextSearchHitIndex((i) => (i + 1) % textMatchCount);
                    }}
                    className="pl-8 h-8 text-sm"
                    aria-description={
                      textMatchCount > 0
                        ? `Match ${textSearchHitIndex + 1} of ${textMatchCount}. Enter for next.`
                        : undefined
                    }
                  />
                </div>
                {textMatchCount > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                    {textSearchHitIndex + 1}/{textMatchCount}
                  </span>
                )}
                <Badge variant="secondary" className="text-xs shrink-0">
                  {charCount.toLocaleString()} chars
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
                <ScrollArea
                  ref={scrollAreaRootRef}
                  className={cn(
                    'w-full',
                    layout === 'side-by-side'
                      ? 'flex-1 min-h-0 h-full'
                      : 'max-h-[500px] h-full'
                  )}
                >
                  <div
                    ref={textBodyRef}
                    className={cn(
                      'p-4 text-sm leading-relaxed',
                      textDraft?.active
                        ? 'text-foreground'
                        : 'prose prose-sm dark:prose-invert max-w-none'
                    )}
                  >
                    {textDraft?.active ? (
                      <textarea
                        ref={textEditRef}
                        value={textDraft.value}
                        onChange={(e) => {
                          textDraft.onChange(e.target.value);
                          const el = e.target;
                          el.style.height = '0px';
                          el.style.height = `${el.scrollHeight}px`;
                        }}
                        spellCheck={false}
                        aria-label="PDF text content"
                        rows={1}
                        className={cn(
                          'm-0 block w-full min-h-0 resize-none border-0 bg-transparent p-0',
                          'text-sm leading-relaxed text-foreground antialiased',
                          'shadow-none ring-0 outline-none',
                          'focus:border-0 focus:outline-none focus:ring-0 focus:ring-offset-0',
                          'focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                        )}
                      />
                    ) : (
                      <HighlightedTextContent
                        text={fullText}
                        searchTerm={textSearchTerm}
                        activeHitIndex={textSearchHitIndex}
                      />
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
            )}
          </div>
        </div>
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.asset.blob_path === nextProps.asset.blob_path &&
    prevProps.asset.id === nextProps.asset.id &&
    prevProps.asset.text_content === nextProps.asset.text_content &&
    prevProps.hasChildren === nextProps.hasChildren &&
    prevProps.childAssets === nextProps.childAssets &&
    prevProps.textDraft?.active === nextProps.textDraft?.active &&
    prevProps.textDraft?.value === nextProps.textDraft?.value
);

PdfAssetContent.displayName = 'PdfAssetContent';
