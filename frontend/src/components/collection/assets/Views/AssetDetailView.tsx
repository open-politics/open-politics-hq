'use client';

import React, { useState, useEffect, useCallback, useMemo, ChangeEvent, useRef } from 'react';
import { Separator } from "@/components/ui/separator";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { format } from "date-fns"
import { Button } from '@/components/ui/button';
import { AssetRead, AssetUpdate } from '@/client';
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from '@/components/ui/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import ReactMarkdown from 'react-markdown';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext } from "@/components/ui/pagination"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { formatDistanceToNowStrict } from 'date-fns';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import useAuth from '@/hooks/useAuth';
import { Textarea } from "@/components/ui/textarea"
import Link from 'next/link';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { useTreeStore } from '@/zustand_stores/storeTree';
import { useMediaBlobStore } from '@/zustand_stores/storeMediaBlobs';
import { useAssetQuery, type QueryResult } from '@/hooks/useAssetQuery';
import type { TreeNode } from '@/client';
import { toast } from 'sonner';
import { ExternalLink, Info, Trash2, UploadCloud, Download, RefreshCw, Eye, Play, FileText, List, ChevronDown, ChevronUp, Search, File, X, CheckCircle, AlertCircle, ArrowUp, ArrowDown, Files, Type, Loader2, Table as TableIcon, Layers, Image as ImageIcon, Globe, Video, Music, FileSpreadsheet, Settings, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTextSpanHighlight, useTextSpanHighlightSafe } from '@/components/collection/contexts/TextSpanHighlightContext';
import { HighlightedText } from '@/components/ui/highlighted-text';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import AssetDetailViewCsv from './AssetDetailViewCsv';
import AssetDetailViewPdf from './AssetDetailViewPdf';
import AssetDetailViewTextBlock from './AssetDetailViewTextBlock';
import { PdfAssetContent } from './PdfAssetContent';
import ComposedArticleView from '../Composer/ComposedArticleView';
import { ArticleView } from './Articles';
import TextContentRenderer from './Articles/TextContentRenderer';
import EditableCsvViewer from './EditableCsvViewer';
import { FragmentInlineList } from './Fragments';
import AssetMetaHeader, { formatEventTimestampForInput } from './AssetMetaHeader';
import { useFragmentCuration } from '@/hooks/useFragmentCuration';
import { useToggleFavorite } from '@/hooks/useToggleFavorite';
import { getAssetIcon, getAssetKindConfig } from '@/components/collection/assets/assetKindConfig';
import { getAssetMeta } from '@/lib/utils';
import { AssetFeedView } from '../Feed/AssetFeedView';
import { useSemanticSearch } from '@/hooks/useSemanticSearch';
import type { AssetFeedItem } from '../Feed/types';
// import MboxViewer from './viewers/MboxViewer';
// import CsvViewer from './viewers/CsvViewer';
// import useSpecializedView from '@/hooks/useSpecializedView';

// Define Sort Direction type
type SortDirection = 'asc' | 'desc' | null;

// Normalized CSV row item — works for both tree browse and query search
export interface CsvRowListItem {
  assetId: number;
  name: string;
  partIndex: number;
  originalRowData?: Record<string, any>;
  highlight?: string | null;
  score?: number | null;
}

function treeNodeToCsvRow(node: TreeNode): CsvRowListItem {
  const fi = node.file_info as Record<string, any> | null | undefined;
  return {
    assetId: parseInt(node.id.replace('asset-', ''), 10),
    name: node.name,
    partIndex: (fi?.data_row_index as number) ?? 0,
    originalRowData: fi?.original_row_data as Record<string, any> | undefined,
  };
}

function queryResultToCsvRow(result: QueryResult): CsvRowListItem {
  const fi = result.asset.file_info as Record<string, any> | null | undefined;
  return {
    assetId: result.asset.id,
    name: result.asset.title,
    partIndex: result.asset.part_index ?? (fi?.data_row_index as number) ?? 0,
    originalRowData: fi?.original_row_data as Record<string, any> | undefined,
    highlight: result.highlight,
    score: result.score,
  };
}

interface AssetDetailViewProps {
  onEdit: (item: AssetRead) => void;
  schemas: any[]; // Placeholder for classification schemes
  selectedAssetId: number | null;
  highlightAssetIdOnOpen: number | null;
  onLoadIntoRunner?: (jobId: number, jobName: string) => void;
  enableHighlighting?: boolean; // Enable text span highlighting (default: false)
}

const AssetDetailView = ({
  onEdit,
  schemas,
  selectedAssetId,
  highlightAssetIdOnOpen,
  onLoadIntoRunner,
  enableHighlighting = false
}: AssetDetailViewProps) => {
  // --- Stores ---
  const { activeInfospace } = useInfospaceStore();
  const { getAssetById, updateAsset, fetchChildAssets, reprocessAsset, requestEnrichment } = useAssetStore();
  const { deleteFragment } = useFragmentCuration();

  // --- State Hooks ---
  const [asset, setAsset] = useState<AssetRead | null>(null);

  // Favorite toggle
  const { isFavorited, toggleFavorite } = useToggleFavorite({ asset });
  const [isLoadingAsset, setIsLoadingAsset] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [inlineEditActive, setInlineEditActive] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftEventTimestamp, setDraftEventTimestamp] = useState('');
  const [draftTextContent, setDraftTextContent] = useState('');
  const [isSavingInline, setIsSavingInline] = useState(false);

  // Child assets state (used for non-CSV children + CsvOverviewContent grid mapping)
  const [childAssets, setChildAssets] = useState<AssetRead[]>([]);
  const [isLoadingChildren, setIsLoadingChildren] = useState(false);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const [selectedChildAsset, setSelectedChildAsset] = useState<AssetRead | null>(null);
  const [childSearchTerm, setChildSearchTerm] = useState('');
  const [debouncedCsvSearch, setDebouncedCsvSearch] = useState('');

  // Debounce CSV search term (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCsvSearch(childSearchTerm), 300);
    return () => clearTimeout(timer);
  }, [childSearchTerm]);

  // CSV-specific: tree browse + query search
  const [csvBrowseItems, setCsvBrowseItems] = useState<CsvRowListItem[]>([]);
  const [csvBrowseTotal, setCsvBrowseTotal] = useState(0);
  const [csvBrowseHasMore, setCsvBrowseHasMore] = useState(false);
  const [csvBrowseLoading, setCsvBrowseLoading] = useState(false);
  const isCsvAsset = asset?.kind === 'csv';
  const csvSearchActive = isCsvAsset && debouncedCsvSearch.trim().length > 0;

  const { fetchChildren: treeFetchChildren, getFullAsset: treeGetFullAsset } = useTreeStore();

  // CSV search via query endpoint (only active when searching within a CSV)
  const csvSearchQuery = useAssetQuery({
    infospaceId: activeInfospace?.id || 0,
    query: debouncedCsvSearch,
    parentAssetId: isCsvAsset ? asset?.id : undefined,
    sort: debouncedCsvSearch.trim() ? 'relevance' : 'part_index',
    limit: 200,
    enabled: csvSearchActive && !!asset?.id,
  });

  // Normalized CSV items: browse mode uses tree, search mode uses query
  const csvItems: CsvRowListItem[] = useMemo(() => {
    if (!isCsvAsset) return [];
    if (csvSearchActive) {
      return csvSearchQuery.results.map(queryResultToCsvRow);
    }
    return csvBrowseItems;
  }, [isCsvAsset, csvSearchActive, csvSearchQuery.results, csvBrowseItems]);

  const csvTotal = csvSearchActive ? csvSearchQuery.total : csvBrowseTotal;
  const csvHasMore = csvSearchActive ? csvSearchQuery.hasMore : csvBrowseHasMore;
  const csvIsLoading = csvSearchActive ? csvSearchQuery.isLoading : csvBrowseLoading;

  // Text span highlighting
  const { getSpansForAsset } = useTextSpanHighlight();

  // Media blob URLs are now managed by Zustand store (storeMediaBlobs)
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'content' | 'children'>('content');

  // Reprocess dialog state
  const [isReprocessDialogOpen, setIsReprocessDialogOpen] = useState(false);
  const [reprocessOptions, setReprocessOptions] = useState({
    delimiter: 'auto',
    skip_rows: 0,
    encoding: 'utf-8',
  });
  const [isReprocessing, setIsReprocessing] = useState(false);

  // Force refresh trigger to ensure UI updates
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Semantic search for related assets
  // Memoize the query to prevent unnecessary re-searches
  const relatedAssetsQuery = useMemo(() => {
    if (!asset) return '';
    return `${asset.title || ''} ${asset.text_content?.slice(0, 500) || ''}`.trim();
  }, [asset?.id, asset?.title, asset?.text_content]);
  
  const kindConfig = asset ? getAssetKindConfig(asset.kind) : null;
  const { results: relatedAssetsResults } = useSemanticSearch({
    query: relatedAssetsQuery,
    enabled:
      !!asset &&
      !!activeInfospace?.enable_related_assets &&
      !!kindConfig?.showRelatedAssets &&
      !!(activeInfospace?.enrichment_config as any)?.embedding?.model_name &&
      relatedAssetsQuery.length > 0,
    limit: 6,
    parentAssetId: asset?.parent_asset_id || undefined,
    assetKinds: ['article', 'web'],
  });
  // const { data: specializedViewData, loading: isLoadingSpecializedView, error: specializedViewError } = useSpecializedView(asset);
  const specializedViewData = null;
  const isLoadingSpecializedView = false;
  const specializedViewError = null;

  const fetchingRef = useRef(false);
  const currentAssetIdRef = useRef<number | null>(null);

  const fetchAsset = useCallback(async () => {
    if (!selectedAssetId || !activeInfospace?.id) {
      setAsset(null);
      setAssetError(null);
      setChildAssets([]);
      return;
    }

    if (selectedAssetId === currentAssetIdRef.current && !fetchingRef.current) {
      return; // Already fetched this asset
    }

    console.log(`Fetching asset ${selectedAssetId}`);
    setIsLoadingAsset(true);
    setAssetError(null);
    setChildAssets([]);
    setSelectedChildAsset(null);
    fetchingRef.current = true;

    try {
      const fetchedAsset = await getAssetById(selectedAssetId);
      if (fetchedAsset) {
        setAsset(fetchedAsset);
        currentAssetIdRef.current = selectedAssetId;
        
        // Fetch child assets if this asset is a container or hierarchical type
        const fc = getAssetKindConfig(fetchedAsset.kind);
        if (fc?.canHaveChildren || fetchedAsset.is_container) {
          await fetchChildren(fetchedAsset.id, fetchedAsset);
        }
      } else {
        setAssetError('Asset not found');
        setAsset(null);
      }
    } catch (err: any) {
      console.error("Error fetching asset:", err);
      const errorDetail = err.message || "Unknown error";
      setAssetError(`Failed to load asset details: ${errorDetail}`);
      setAsset(null);
    } finally {
      setIsLoadingAsset(false);
      fetchingRef.current = false;
    }
  }, [selectedAssetId, activeInfospace?.id, getAssetById]);

  // Fetch CSV children via tree (paginated, sorted by part_index)
  const fetchCsvChildrenFromTree = useCallback(async (parentId: number, append = false) => {
    setCsvBrowseLoading(true);
    try {
      const skip = append ? csvBrowseItems.length : 0;
      const { TreeNavigationService } = await import('@/client');
      const response = await TreeNavigationService.getTreeChildren({
        infospaceId: activeInfospace!.id,
        parentId: `asset-${parentId}`,
        skip,
        limit: 200,
      });
      const items = response.children
        .filter((n: TreeNode) => n.kind === 'csv_row')
        .map(treeNodeToCsvRow);
      if (append) {
        setCsvBrowseItems(prev => [...prev, ...items]);
      } else {
        setCsvBrowseItems(items);
      }
      setCsvBrowseTotal(response.total_children);
      setCsvBrowseHasMore(response.has_more);
    } catch (err: any) {
      console.error('[AssetDetailView] CSV tree fetch error:', err);
      setChildrenError(err.message || 'Failed to load CSV rows');
    } finally {
      setCsvBrowseLoading(false);
    }
  }, [activeInfospace?.id, csvBrowseItems.length]);

  const handleCsvLoadMore = useCallback(() => {
    if (!asset?.id || csvIsLoading) return;
    if (csvSearchActive) {
      csvSearchQuery.loadMore();
    } else {
      fetchCsvChildrenFromTree(asset.id, true);
    }
  }, [asset?.id, csvIsLoading, csvSearchActive, csvSearchQuery, fetchCsvChildrenFromTree]);

  // Fetch children: CSV uses tree, others use asset store
  const fetchChildren = useCallback(async (parentId: number, parentAsset: AssetRead) => {
    console.log(`[AssetDetailView] Fetching children for parent asset ID: ${parentId}`);
    setIsLoadingChildren(true);
    setChildrenError(null);
    setChildAssets([]);
    setSelectedChildAsset(null);

    // CSV: use tree endpoint (paginated, part_index sorted)
    if (parentAsset.kind === 'csv') {
      setIsLoadingChildren(false);
      await fetchCsvChildrenFromTree(parentId);
      return;
    }

    // Non-CSV: use existing asset store path
    try {
      const children = await fetchChildAssets(parentId);
      if (children && children.length > 0) {
        setChildAssets(children);
        setRefreshTrigger(prev => prev + 1);
      } else {
        setChildAssets([]);
      }
    } catch (err: any) {
      console.error("Error fetching child assets:", err);
      setChildrenError(err.message || "Failed to load child assets");
      setChildAssets([]);
    } finally {
      setIsLoadingChildren(false);
    }
  }, [fetchChildAssets, fetchCsvChildrenFromTree]);

  const pdfDraftTextFromAsset = useCallback((a: AssetRead, children: AssetRead[]) => {
    if (a.text_content?.trim()) return a.text_content;
    if (children.length > 0) {
      const sorted = [...children].sort((x, y) => (x.part_index ?? 0) - (y.part_index ?? 0));
      return sorted.map((c) => c.text_content || '').join('\n\n');
    }
    return a.text_content ?? '';
  }, []);

  const resetInlineEditDrafts = useCallback(
    (a: AssetRead | null, children: AssetRead[] = []) => {
      if (!a) return;
      setDraftTitle(a.title ?? '');
      setDraftEventTimestamp(formatEventTimestampForInput(a.event_timestamp));
      setDraftTextContent(a.kind === 'pdf' ? pdfDraftTextFromAsset(a, children) : (a.text_content ?? ''));
    },
    [pdfDraftTextFromAsset]
  );

  const handleStartInlineEdit = useCallback(() => {
    if (!asset) return;
    resetInlineEditDrafts(asset, childAssets);
    setInlineEditActive(true);
  }, [asset, childAssets, resetInlineEditDrafts]);

  const handleCancelInlineEdit = useCallback(() => {
    setInlineEditActive(false);
    if (asset) resetInlineEditDrafts(asset, childAssets);
  }, [asset, childAssets, resetInlineEditDrafts]);

  const handleSaveInlineEdit = useCallback(async () => {
    if (!asset || !activeInfospace?.id) return;
    setIsSavingInline(true);
    const updatePayload: AssetUpdate = {
      title: draftTitle,
      text_content: draftTextContent,
    };
    if (draftEventTimestamp.trim()) {
      const parsed = new Date(draftEventTimestamp);
      if (Number.isNaN(parsed.getTime())) {
        toast.error('Invalid event time.');
        setIsSavingInline(false);
        return;
      }
      updatePayload.event_timestamp = parsed.toISOString();
    } else {
      updatePayload.event_timestamp = null;
    }
    const updated = await updateAsset(asset.id, updatePayload);
    setIsSavingInline(false);
    if (updated) {
      setAsset(updated);
      setInlineEditActive(false);
      resetInlineEditDrafts(updated, childAssets);
      toast.success('Asset updated.');
    }
  }, [asset, activeInfospace?.id, draftTitle, draftEventTimestamp, draftTextContent, updateAsset, resetInlineEditDrafts, childAssets]);

  useEffect(() => {
    setInlineEditActive(false);
  }, [selectedAssetId]);

  useEffect(() => {
    if (!inlineEditActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancelInlineEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inlineEditActive, handleCancelInlineEdit]);

  // fetchMediaBlob is now handled by Zustand store (storeMediaBlobs)
  // Access via: useMediaBlobStore.getState().getBlobUrl(blobPath)

  // --- Computed values ---
  const filteredChildAssets = useMemo(() => {
    if (!childSearchTerm.trim()) return childAssets;
    
    const term = childSearchTerm.toLowerCase();
    return childAssets.filter(child => 
      child.title?.toLowerCase().includes(term) ||
      child.id.toString().includes(term) ||
      child.text_content?.toLowerCase().includes(term) ||
      child.source_identifier?.toLowerCase().includes(term)
    );
  }, [childAssets, childSearchTerm, refreshTrigger]);

  const hasChildren = useMemo(() => childAssets.length > 0 || csvBrowseItems.length > 0, [childAssets, csvBrowseItems, refreshTrigger]);
  const isHierarchicalAsset = useMemo(() => {
    if (!asset) return false;
    const config = getAssetKindConfig(asset.kind);
    return (config?.canHaveChildren ?? false) || !!asset.is_container;
  }, [asset, refreshTrigger]);

  // --- Effects ---
  useEffect(() => {
    fetchAsset();
  }, [fetchAsset]);

  // Reset tab to content when switching between assets
  useEffect(() => {
    setActiveTab('content');
  }, [selectedAssetId]);

  useEffect(() => {
    if (!highlightAssetIdOnOpen || childAssets.length === 0) return;
    const assetToSelect = childAssets.find((c) => c.id === highlightAssetIdOnOpen);
    if (!assetToSelect) return;
    setSelectedChildAsset(assetToSelect);
    setChildSearchTerm('');
    setActiveTab('children');
  }, [highlightAssetIdOnOpen, childAssets]);

  // Blob URL cleanup is now handled by Zustand store

  // Authenticated media components - Now using extracted components from Viewers/
  // Import AuthenticatedPDF from '../Viewers/AuthenticatedPDF' instead
  // Import AuthenticatedImage, AuthenticatedVideo, AuthenticatedAudio similarly when needed
  
  // Temporary: Keep AuthenticatedImage/Video/Audio using old pattern for now
  // TODO: Extract these to use Zustand store as well
  const AuthenticatedImage = useMemo(() => {
    return ({ blobPath, alt, className }: { blobPath: string; alt: string; className?: string }) => {
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
      const loadImage = async () => {
        setIsLoading(true);
        setHasError(false);
        try {
          const { getBlobUrl } = useMediaBlobStore.getState();
          const blobUrl = await getBlobUrl(blobPath);
          if (blobUrl) {
            setImageSrc(blobUrl);
          } else {
            setHasError(true);
          }
        } catch (error) {
          setHasError(true);
        } finally {
          setIsLoading(false);
        }
      };
      
      loadImage();
    }, [blobPath]);

    if (isLoading) {
      return (
        <div className="flex items-center justify-center p-8 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading image...</span>
        </div>
      );
    }

    if (hasError || !imageSrc) {
      return (
        <div className="text-center text-muted-foreground p-8">
          <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>Image could not be loaded</p>
              </div>
      );
    }

      return <img src={imageSrc} alt={alt} className={className} />;
    };
  }, []);

  const AuthenticatedVideo = useMemo(() => {
    return ({ blobPath, className }: { blobPath: string; className?: string }) => {
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
      const loadVideo = async () => {
        setIsLoading(true);
        setHasError(false);
        try {
          const { getBlobUrl } = useMediaBlobStore.getState();
          const blobUrl = await getBlobUrl(blobPath);
          if (blobUrl) {
            setVideoSrc(blobUrl);
          } else {
            setHasError(true);
          }
        } catch (error) {
          setHasError(true);
        } finally {
          setIsLoading(false);
        }
      };
      
      loadVideo();
    }, [blobPath]);

    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading video...</span>
        </div>
      );
    }

    if (hasError || !videoSrc) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <Video className="h-12 w-12 opacity-50 mb-2" />
          <p>Video could not be loaded</p>
        </div>
      );
    }

      return (
        <video controls className={className} preload="metadata">
          <source src={videoSrc} />
          Your browser does not support the video tag.
        </video>
      );
    };
  }, []);

  const AuthenticatedAudio = useMemo(() => {
    return ({ blobPath, className }: { blobPath: string; className?: string }) => {
    const [audioSrc, setAudioSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
      const loadAudio = async () => {
        setIsLoading(true);
        setHasError(false);
        try {
          const { getBlobUrl } = useMediaBlobStore.getState();
          const blobUrl = await getBlobUrl(blobPath);
          if (blobUrl) {
            setAudioSrc(blobUrl);
          } else {
            setHasError(true);
          }
        } catch (error) {
          setHasError(true);
        } finally {
          setIsLoading(false);
        }
      };
      
      loadAudio();
    }, [blobPath]);

    if (isLoading) {
      return (
        <div className="flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading audio...</span>
        </div>
      );
    }

    if (hasError || !audioSrc) {
      return (
        <div className="flex items-center justify-center text-muted-foreground">
          <Music className="h-12 w-12 opacity-50 mb-2" />
          <p>Audio could not be loaded</p>
        </div>
      );
    }

      return (
        <audio controls className={className}>
          <source src={audioSrc} />
          Your browser does not support the audio tag.
        </audio>
      );
    };
  }, []);

  // --- Helper functions ---
  // Helper function to detect if content is HTML
  const isHtmlContent = (text: string): boolean => {
    // Check for common HTML tags
    return /<\/?[a-z][\s\S]*>/i.test(text);
  };

  // Helper function to sanitize HTML content (basic XSS protection)
  const sanitizeHtml = (html: string): string => {
    // Remove script tags and event handlers
    let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=\s*[^\s>]*/gi, '');
    
    // Ensure external links open in new tab
    sanitized = sanitized.replace(/<a\s+/gi, '<a target="_blank" rel="noopener noreferrer" ');
    
    return sanitized;
  };

  const renderTextDisplay = (text: string | null, assetId?: number, assetUuid?: string) => {
    if (!text) {
      return (
        <ScrollArea className="h-[200px] w-full rounded-md p-3 text-sm bg-background">
          <div className="whitespace-pre-wrap break-words w-full max-w-full">
            <span className="text-muted-foreground italic">No text content available.</span>
          </div>
        </ScrollArea>
      );
    }

    // Check if we have text spans to highlight for this asset (only if highlighting is enabled)
    const textSpans = (enableHighlighting && assetId !== undefined) ? getSpansForAsset(assetId, assetUuid) : [];
    const shouldHighlight = textSpans.length > 0;

    return (
      <div className="space-y-2">
        <ScrollArea className="h-[200px] w-full rounded-md p-3 text-sm bg-background">
          <div className="whitespace-pre-wrap break-words w-full max-w-full">
            {shouldHighlight ? (
              <HighlightedText 
                text={text} 
                spans={textSpans}
                highlightClassName="bg-yellow-200 dark:bg-yellow-800/70 px-1 text-yellow-900 dark:text-yellow-100 z-[1001]"
              />
            ) : (
              text
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  const handleChildAssetClick = (childAsset: AssetRead) => {
    console.log(`[AssetDetailView] Page clicked: Asset ID ${childAsset.id}, part_index: ${childAsset.part_index}, calculated page: ${(childAsset.part_index || 0) + 1}`);

    setSelectedChildAsset(selectedChildAsset?.id === childAsset.id ? null : childAsset);

    // If clicking a child asset from the content tab previews, switch to children tab
    if (activeTab === 'content' && childAsset) {
      setActiveTab('children');
    }
  };

  // CSV row click: fetch full AssetRead for the detail panel
  const handleCsvRowSelect = useCallback(async (item: CsvRowListItem) => {
    // Toggle off if same row clicked
    if (selectedChildAsset?.id === item.assetId) {
      setSelectedChildAsset(null);
      return;
    }
    try {
      const full = await treeGetFullAsset(item.assetId);
      setSelectedChildAsset(full);
    } catch (err) {
      console.error('[AssetDetailView] Failed to load CSV row detail:', err);
      setSelectedChildAsset(null);
    }
  }, [selectedChildAsset?.id, treeGetFullAsset]);

  const openCsvRowByPartIndex = useCallback(async (partIndex: number) => {
    setChildSearchTerm('');

    // If the row is already loaded, just select it
    const loaded = csvBrowseItems.find(r => r.partIndex === partIndex);
    if (loaded) {
      try {
        const full = await treeGetFullAsset(loaded.assetId);
        setSelectedChildAsset(full);
      } catch { setSelectedChildAsset(null); }
      setActiveTab('children');
      return;
    }

    // Row not in loaded page — load a page that contains it, then select
    try {
      const { TreeNavigationService } = await import('@/client');
      const pageSize = 200;
      const skip = Math.max(0, partIndex - 20); // some context above the target
      const resp = await TreeNavigationService.getTreeChildren({
        infospaceId: activeInfospace!.id,
        parentId: `asset-${asset!.id}`,
        skip,
        limit: pageSize,
      });

      // Replace browse items with this page
      const items = resp.children
        .filter((n: TreeNode) => n.kind === 'csv_row')
        .map(treeNodeToCsvRow);
      setCsvBrowseItems(items);
      setCsvBrowseTotal(resp.total_children);
      setCsvBrowseHasMore(resp.has_more);

      // Find the target row in the new page and select it
      const target = items.find((r: CsvRowListItem) => r.partIndex === partIndex);
      if (target) {
        const full = await treeGetFullAsset(target.assetId);
        setSelectedChildAsset(full);
      } else {
        setSelectedChildAsset(null);
        toast.message('No row asset for this line', { description: 'Reprocess the CSV if rows are missing.' });
      }
    } catch {
      setSelectedChildAsset(null);
      toast.message('No row asset for this line', { description: 'Reprocess the CSV if rows are missing.' });
    }
    setActiveTab('children');
  }, [csvBrowseItems, treeGetFullAsset, activeInfospace?.id, asset?.id]);

  const handleReprocessAsset = useCallback(async (useCustomOptions: boolean = false) => {
    if (!asset) return;
    
    setIsReprocessing(true);
    try {
      const options = useCustomOptions ? {
        delimiter: reprocessOptions.delimiter === 'auto' ? undefined : reprocessOptions.delimiter,
        skip_rows: reprocessOptions.skip_rows || undefined,
        encoding: reprocessOptions.encoding === 'utf-8' ? undefined : reprocessOptions.encoding,
      } : undefined;
      
      const success = await reprocessAsset(asset.id, options);
      if (success) {
        setIsReprocessDialogOpen(false);
        toast.success(`Asset "${asset.title}" reprocessed successfully. Refreshing child assets...`);
        
        // Wait a moment for backend processing to complete, then refetch
        setTimeout(async () => {
          if (asset) {
            console.log(`[Reprocess] Fetching updated child assets for asset ${asset.id}`);
            
            try {
              await fetchChildren(asset.id, asset);
              
              // Also refresh the main asset to get updated metadata
              const updatedAsset = await getAssetById(asset.id);
              if (updatedAsset) {
                setAsset(updatedAsset);
                console.log(`[Reprocess] Refreshed main asset details for asset ${asset.id}`);
              }
              
              toast.success(`Child assets refreshed! Found ${childAssets.length} CSV rows.`);
            } catch (error) {
              console.error('[Reprocess] Error during refresh:', error);
              toast.error(`Reprocessing completed but refresh failed. Try clicking the "🔍 Debug & Refetch" button.`);
            }
          }
        }, 1500);
      }
    } catch (error) {
      console.error('Error reprocessing asset:', error);
      toast.error(`Failed to reprocess asset: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsReprocessing(false);
    }
  }, [asset, reprocessOptions, reprocessAsset, fetchChildren, getAssetById, childAssets.length]);

  // --- Helper Components for Asset Content ---

  const ImageAssetContent = ({ asset, AuthenticatedImage }: { asset: AssetRead; AuthenticatedImage: React.ComponentType<{ blobPath: string; alt: string; className?: string }> }) => {
    const [sourceFailed, setSourceFailed] = React.useState(false);

    React.useEffect(() => {
      setSourceFailed(false);
    }, [asset.id]);

    const showExternalImage = asset.source_identifier && !sourceFailed;
    const showAuthenticatedImage = asset.blob_path && (!asset.source_identifier || sourceFailed);

      return (
      <div className="p-4 h-full flex flex-col">
        <div className="flex-1 flex items-center justify-center bg-muted/20 rounded p-4">
          <div className="max-w-full max-h-full overflow-auto">
            {showExternalImage && (
              <img
                src={asset.source_identifier!}
                alt={asset.title || 'Asset image'}
                className="max-w-full max-h-96 object-contain rounded"
                onError={() => setSourceFailed(true)}
              />
            )}
            {showAuthenticatedImage && (
              <AuthenticatedImage
                blobPath={asset.blob_path!}
                alt={asset.title || 'Asset image'}
                className="max-w-full max-h-96 object-contain rounded"
              />
            )}
            {!asset.source_identifier && !asset.blob_path && (
        <div className="text-center text-muted-foreground p-8">
          <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>Image could not be loaded</p>
              </div>
            )}
          </div>
        </div>
        </div>
      );
  };

  // PdfAssetContent is now imported from './PdfAssetContent'

const VideoAssetContent = ({ asset, AuthenticatedVideo }: { asset: AssetRead; AuthenticatedVideo: React.ComponentType<{ blobPath: string; className?: string }> }) => (
    <div className="p-4 h-full flex flex-col">
        <div className="flex-1 bg-muted/20 rounded overflow-hidden flex items-center justify-center">
            {asset.blob_path && <AuthenticatedVideo blobPath={asset.blob_path} className="max-w-full max-h-96" />}
        </div>
        </div>
      );

const AudioAssetContent = ({ asset, AuthenticatedAudio }: { asset: AssetRead; AuthenticatedAudio: React.ComponentType<{ blobPath: string; className?: string }> }) => (
    <div className="p-4 h-full flex flex-col">
        <div className="flex-1 flex items-center justify-center">
            <div className="bg-muted/20 rounded p-6 w-full max-w-md">
                {asset.blob_path && <AuthenticatedAudio blobPath={asset.blob_path} className="w-full" />}
            </div>
        </div>
        </div>
      );

const WebContent = ({ asset, hasChildren, childAssets, setActiveTab, handleChildAssetClick, AuthenticatedImage, enableHighlighting = false, hideMainText = false }: { asset: AssetRead; hasChildren: boolean; childAssets: AssetRead[]; setActiveTab: (tab: 'content' | 'children') => void; handleChildAssetClick: (a: AssetRead) => void; AuthenticatedImage: React.ComponentType<{ blobPath: string; alt: string; className?: string }>; enableHighlighting?: boolean; hideMainText?: boolean }) => {
  // Add state for featured image swapping
  const [currentFeaturedImage, setCurrentFeaturedImage] = React.useState<AssetRead | null>(null);

  // Text span highlighting - safe hook returns null when no provider is available
  const highlightCtx = useTextSpanHighlightSafe();
  const webTextSpans = (enableHighlighting && highlightCtx && asset.text_content) 
    ? highlightCtx.getSpansForAsset(asset.id, asset.uuid) 
    : [];
  const shouldHighlightWeb = webTextSpans.length > 0;

  // Helper function to check if an image URL is a .gif file
  const isGifImage = (url: string): boolean => {
    return url.toLowerCase().includes('.gif');
  };

  // Filter out .gif files from child assets
  const nonGifChildAssets = childAssets.filter(child => {
    if (child.kind !== 'image') return true; // Keep non-image assets
    
    // Filter out .gif files
    if (child.source_identifier && isGifImage(child.source_identifier)) return false;
    if (child.blob_path && isGifImage(child.blob_path)) return false;
    
    return true;
  });

  // Separate images by role for better display (using filtered assets)
  const originalFeaturedImage = nonGifChildAssets.find(child => 
    child.kind === 'image' && 
    child.part_index === 0 && 
    child.file_info?.image_role === 'featured'
  );
  
  // Use current featured image or fall back to original
  const featuredImage = currentFeaturedImage || originalFeaturedImage;
  
  const contentImages = nonGifChildAssets.filter(child => 
    child.kind === 'image' && 
    child.file_info?.image_role === 'content' &&
    child.id !== featuredImage?.id // Exclude the currently featured image
  ).sort((a, b) => (a.part_index || 0) - (b.part_index || 0));

  // Function to swap images
  const handleImageSwap = (newFeaturedImage: AssetRead) => {
    setCurrentFeaturedImage(newFeaturedImage);
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden min-w-0 max-w-full">
      {/* Article Content */}
      <div className="flex-1 w-full overflow-y-auto min-w-0 max-w-full overflow-x-hidden">
        <div className="max-w-4xl mx-auto px-6 py-6 w-full min-w-0 max-w-full overflow-hidden">
          {/* Summary if available */}
          {(() => {
            const summary = asset.facets?.summary ?? asset.file_info?.summary;
            return summary && typeof summary === 'string' ? (
              <div className="mb-6 p-3 bg-muted/30 rounded-lg border-l-4 border-primary">
                <p className="text-sm text-muted-foreground italic">
                  Summary:
                  {summary}
                </p>
              </div>
            ) : null;
          })()}
          
          {/* Featured Image - Large and Prominent */}
          {featuredImage && (
            <div className="mb-6">
              <div className="relative rounded-lg overflow-hidden shadow-lg bg-muted/20">
                {featuredImage.source_identifier ? (
                  <img 
                    src={featuredImage.source_identifier} 
                    alt={featuredImage.title || 'Featured image'} 
                    className="w-full h-auto max-h-96 object-cover"
                    onError={(e) => {
                      // If external image fails, try blob path
                      if (featuredImage.blob_path) {
                        e.currentTarget.style.display = 'none';
                        const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                        if (fallback) fallback.classList.remove('hidden');
                      }
                    }}
                  />
                ) : featuredImage.blob_path ? (
                  <AuthenticatedImage 
                    blobPath={featuredImage.blob_path} 
                    alt={featuredImage.title || 'Featured image'} 
                    className="w-full h-auto max-h-96 object-cover"
                  />
                ) : null}
                
                {/* Fallback for blob path */}
                {featuredImage.blob_path && featuredImage.source_identifier && (
                  <div className="hidden w-full">
                    <AuthenticatedImage 
                      blobPath={featuredImage.blob_path} 
                      alt={featuredImage.title || 'Featured image'} 
                      className="w-full h-auto max-h-96 object-cover"
                    />
                  </div>
                )}
              </div>
              
              {/* Image caption */}
              {featuredImage.title && featuredImage.title !== asset.title && (
                <p className="text-xs text-muted-foreground mt-2 italic text-center">
                  {featuredImage.title.replace(/^Featured:\s*/, '')}
                </p>
              )}
            </div>
          )}

          {/* Content Images - Compact gallery directly below featured image */}
          {contentImages.length > 0 && (
            <div className="mb-6">
              <div className="flex flex-wrap gap-2">
                {contentImages.slice(0, 6).map((imageAsset, index) => (
                  <div 
                    key={imageAsset.id} 
                    className="group cursor-pointer rounded-md overflow-hidden border-border/50 hover:border-hover:shadow-md transition-all duration-200 bg-muted/30"
                    onClick={() => handleImageSwap(imageAsset)}
                  >
                    <div className="w-20 h-20 bg-muted/50 overflow-hidden">
                      {imageAsset.source_identifier ? (
                        <img 
                          src={imageAsset.source_identifier} 
                          alt={imageAsset.title || `Content image ${index + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          onError={(e) => {
                            // Fallback to placeholder
                            e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik04NSA4NUgxMTVWMTE1SDg1Vjg1WiIgZmlsbD0iIzlDQTNBRiIvPgo8L3N2Zz4K';
                          }}
                        />
                      ) : imageAsset.blob_path ? (
                        <AuthenticatedImage 
                          blobPath={imageAsset.blob_path} 
                          alt={imageAsset.title || `Content image ${index + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {contentImages.length > 6 && (
                  <div 
                    className="w-20 h-20 rounded-md border-dashed border-border/50 flex items-center justify-center text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setActiveTab('children')}
                  >
                    <div className="text-center">
                      <span className="text-xs font-medium">+{contentImages.length - 6}</span>
                      <div className="text-xs">more</div>
                    </div>
                  </div>
                )}
              </div>
              {contentImages.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  {contentImages.length} content images • Click to feature
                </p>
              )}
            </div>
          )}

          {/* Article Text Content */}
          {asset.text_content && !hideMainText && (
            <div className="w-full min-w-0 max-w-full overflow-hidden">
              {shouldHighlightWeb ? (
                <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none w-full min-w-0 max-w-full overflow-hidden break-words">
                  <HighlightedText 
                    text={asset.text_content} 
                    spans={webTextSpans}
                    highlightClassName="bg-yellow-200 dark:bg-yellow-800/70 px-0.5 text-yellow-900 dark:text-yellow-100"
                  />
                </div>
              ) : (
                <TextContentRenderer 
                  content={asset.text_content} 
                  className="w-full min-w-0 max-w-full overflow-hidden break-words"
                />
              )}
            </div>
          )}

          {/* Article Metadata */}
          <div className="mt-8 pt-6 border-t w-full min-w-0 max-w-full overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm w-full min-w-0 max-w-full">
              
              {/* Basic Info */}
              <div className="space-y-2">
                <h4 className="font-semibold text-muted-foreground">Article Info</h4>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <strong className="w-20 shrink-0">ID:</strong>
                    <span className="font-mono text-xs">{asset.id}</span>
                  </div>
                  {asset.file_info?.content_length && typeof asset.file_info.content_length === 'number' ? (
                    <div className="flex items-center gap-2">
                      <strong className="w-20 shrink-0">Length:</strong>
                      <span>{asset.file_info.content_length.toLocaleString()} characters</span>
                    </div>
                  ) : null}
                  {asset.file_info?.scraped_at && typeof asset.file_info.scraped_at === 'string' ? (
                    <div className="flex items-center gap-2">
                      <strong className="w-20 shrink-0">Scraped:</strong>
                      <span>{formatDistanceToNowStrict(new Date(asset.file_info.scraped_at), { addSuffix: true })}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Images Info */}
              {hasChildren && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-muted-foreground">Media Assets</h4>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <strong className="w-20 shrink-0">Images:</strong>
                      <span>{nonGifChildAssets.filter(child => child.kind === 'image').length} total</span>
                      <Button variant="outline" size="sm" onClick={() => setActiveTab('children')} className="ml-auto">
                        View All
                      </Button>
                    </div>
                    {featuredImage && (
                      <div className="text-xs text-muted-foreground ml-20">
                        • 1 featured image
                      </div>
                    )}
                    {contentImages.length > 0 && (
                      <div className="text-xs text-muted-foreground ml-20">
                        • {contentImages.length} content images
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Advanced Metadata (Collapsible) */}
            {(() => {
              const meta = getAssetMeta(asset);
              return Object.keys(meta).length > 0 && (
                <Collapsible className="mt-4 min-w-0 max-w-full overflow-hidden">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between p-0">
                      <span className="text-xs font-semibold text-muted-foreground">Advanced Metadata</span>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="min-w-0 max-w-full overflow-hidden">
                    <pre className="text-xs bg-muted/50 p-3 rounded overflow-auto max-h-40 mt-2 break-all whitespace-pre-wrap max-w-full">
                      {JSON.stringify(meta, null, 2)}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};

const CsvOverviewContent = React.memo(({ asset, hasChildren, childAssets, csvBrowseItems, csvBrowseTotal, isReprocessing, handleReprocessAsset, setIsReprocessDialogOpen, activeInfospace, getAssetById, fetchChildren, onOpenCsvRow, highlightAssetIdOnOpen }: any) => {
    const rowCount = csvBrowseTotal || childAssets?.length || 0;

    const handleSaveSuccess = async () => {
      console.log('[CsvOverviewContent] Save success callback triggered, refreshing asset:', asset?.id);
      if (asset) {
        try {
          const updatedAsset = await getAssetById(asset.id);
          if (updatedAsset) {
            console.log('[CsvOverviewContent] Parent asset refreshed');
          }
          await fetchChildren(asset.id, asset);
          console.log('[CsvOverviewContent] Children refetched');
        } catch (error) {
          console.error('[CsvOverviewContent] Error refreshing after save:', error);
        }
      }
    };

    const handleMaterializeCSV = () => {
      handleReprocessAsset(false);
    };

    /** `highlightAssetIdOnOpen` is often the parent CSV id; only forward row child ids to the grid. */
    const csvWorkspaceHighlightChildId = useMemo(() => {
      if (highlightAssetIdOnOpen == null) return null;
      // Check browse items (from tree) first, then fall back to childAssets
      const isBrowseChild = (csvBrowseItems || []).some((r: CsvRowListItem) => r.assetId === highlightAssetIdOnOpen);
      if (isBrowseChild) return highlightAssetIdOnOpen;
      const isChildRow = (childAssets || []).some((c: AssetRead) => c.id === highlightAssetIdOnOpen);
      return isChildRow ? highlightAssetIdOnOpen : null;
    }, [highlightAssetIdOnOpen, csvBrowseItems, childAssets]);

    // Build minimal rowChildAssets for EditableCsvViewer highlight lookup
    // (only needs id + part_index for the workspaceHighlightChildId feature)
    const rowChildAssetsForGrid = useMemo(() => {
      if (childAssets && childAssets.length > 0) return childAssets;
      // Synthesize minimal AssetRead-like objects from csvBrowseItems
      return (csvBrowseItems || []).map((r: CsvRowListItem) => ({
        id: r.assetId,
        part_index: r.partIndex,
        title: r.name,
      }));
    }, [childAssets, csvBrowseItems]);

    return (
      <div className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col ">
          {asset.blob_path && typeof asset.blob_path === 'string' && activeInfospace?.id ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex h-full min-h-[min(72vh,760px)] flex-1 flex-col overflow-hidden rounded-md border bg-background shadow-sm">
                  <EditableCsvViewer
                    blobPath={asset.blob_path}
                    title={asset.title || 'CSV File'}
                    assetId={asset.id}
                    infospaceId={activeInfospace.id}
                    className="h-full min-h-0 flex-1 border-0"
                    onSaveSuccess={handleSaveSuccess}
                    fetchMediaBlob={(blobPath: string) => useMediaBlobStore.getState().getBlobUrl(blobPath)}
                    rowChildAssets={rowChildAssetsForGrid}
                    onOpenCsvRow={onOpenCsvRow}
                    workspaceHighlightChildId={csvWorkspaceHighlightChildId}
                  />
                </div>
              </div>
          ) : (
              <div className="flex min-h-[8rem] shrink-0 flex-col items-center justify-center overflow-hidden rounded-md border bg-background p-6 text-muted-foreground">
                  <FileSpreadsheet className="h-12 w-12 mb-4" />
                  <div className="text-center mb-4">
                    <p className="font-medium mb-1">No CSV file available</p>
                    <p className="text-xs">This CSV was created via chat and has no underlying file</p>
                  </div>
                  {hasChildren && rowCount > 0 && (
                    <Button
                      onClick={handleMaterializeCSV}
                      disabled={isReprocessing}
                      className="gap-2"
                    >
                      {isReprocessing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Generating file & processing...
                        </>
                      ) : (
                        <>
                          <FileSpreadsheet className="h-4 w-4" />
                          Generate & Load CSV File ({rowCount} rows)
                        </>
                      )}
                    </Button>
                  )}
                  {!hasChildren && (
                    <p className="text-xs text-muted-foreground">Add rows in the Children tab first</p>
                  )}
              </div>
          )}

          {!hasChildren && asset?.kind === 'csv' && (
            <div className="mt-4 p-3 bg-yellow-50 border-yellow-200 rounded w-full max-w-full">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
                <h4 className="text-sm font-medium text-yellow-800">No CSV rows found</h4>
              </div>
              <div className="text-xs text-yellow-700 space-y-1 w-full max-w-full">
                <p>This CSV file has no child row assets. This usually means:</p>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li>Wrong delimiter detected (your CSV uses semicolons ";" but commas "," were expected)</li>
                  <li>The header row is not at the expected position</li>
                  <li>Processing failed during initial upload</li>
                </ul>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={() => handleReprocessAsset(false)} disabled={isReprocessing} className="h-7 px-2 text-xs bg-blue-100 border-blue-300 hover:bg-blue-200">{isReprocessing ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Processing...</> : <><RefreshCw className="h-3 w-3 mr-1" />Auto Reprocess</>}</Button>
                  <Button variant="outline" size="sm" onClick={() => setIsReprocessDialogOpen(true)} disabled={isReprocessing} className="h-7 px-2 text-xs bg-orange-100 border-orange-300 hover:bg-orange-200"><Settings className="h-3 w-3 mr-1" />Custom Options</Button>
                </div>
              </div>
            </div>
          )}
      </div>
    );
});

// CSV Row Content - displays structured column data for CSV row assets
const CsvRowContent = ({ asset }: { asset: AssetRead }) => {
  const rowData = (asset.file_info as Record<string, unknown>)?.original_row_data as Record<string, unknown> || {};
  const columnNames = Object.keys(rowData);

  return (
    <div className="p-4 space-y-4">
      {/* Row Position */}
      <div className="text-sm text-muted-foreground mb-4">
        Row Position: <span className="font-semibold text-foreground">{asset.part_index !== null ? asset.part_index + 1 : 'N/A'}</span>
      </div>

      <Separator />

      {/* Column Data */}
      {columnNames.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold mb-3 text-muted-foreground flex items-center gap-2">
            <TableIcon className="h-4 w-4" />
            Column Data ({columnNames.length} columns)
          </h4>
          <div className="grid gap-3 w-full">
            {columnNames.map((columnName, index) => (
              <div key={index} className="border rounded-lg p-3 min-w-0">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <strong className="text-sm text-muted-foreground truncate flex-1 min-w-0" title={columnName}>{columnName}</strong>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(String(rowData[columnName] || ''));
                      toast.success(`Copied "${columnName}" value`);
                    }}
                    className="h-6 px-2 text-xs flex-shrink-0"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div className="text-sm bg-muted/30 p-2 rounded font-mono break-all w-full overflow-x-auto">
                  {String(rowData[columnName] || '')}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Column Data</AlertTitle>
          <AlertDescription>
            This CSV row asset does not have structured column data available.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

const DefaultAssetContent = ({ asset, renderTextDisplay, suppressTextBody = false }: { asset: AssetRead; renderTextDisplay: (text: string | null, assetId?: number, assetUuid?: string) => React.ReactNode; suppressTextBody?: boolean }) => (
    <div className="p-4 h-full w-full flex flex-col overflow-hidden min-w-0 max-w-full">
        <div className="flex-1 space-y-4 w-full min-w-0 max-w-full overflow-hidden">
            {asset.text_content && !suppressTextBody && (
                <div>
                    <h4 className="text-xs font-semibold mb-1.5 text-muted-foreground">Text Content</h4>
                    {renderTextDisplay(asset.text_content, asset.id, asset.uuid)}
                </div>
            )}
            {(() => {
                const meta = getAssetMeta(asset);
                return Object.keys(meta).length > 0 && (
                <div className="w-full min-w-0 max-w-full overflow-hidden">
                    <h4 className="text-xs font-semibold mb-1.5 text-muted-foreground">Metadata</h4>
                    <pre className="text-xs bg-muted/30 p-2 rounded overflow-auto max-h-32 break-all whitespace-pre-wrap w-full max-w-full">{JSON.stringify(meta, null, 2)}</pre>
                </div>
                );
            })()}
        </div>
    </div>
);

  // --- Render functions ---
  const renderContent = () => {
    if (!asset) return <div className="p-8 text-center text-muted-foreground">No asset selected.</div>;
    if (isLoadingAsset) return <div className="p-8 flex items-center justify-center mt-10"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading asset...</div>;
    if (assetError) return <div className="p-8 text-red-600 text-center">{assetError}</div>;

    let main: React.ReactNode;
    switch (asset.kind) {
      case 'article':
        main = (
          <ArticleView
            asset={asset}
            childAssets={childAssets}
            onAssetClick={handleChildAssetClick}
            enableHighlighting={enableHighlighting}
            hideMainBody={inlineEditActive}
          />
        );
        break;
      case 'image':
        main = <ImageAssetContent asset={asset} AuthenticatedImage={AuthenticatedImage} />;
        break;
      case 'pdf':
        main = (
          <PdfAssetContent
            asset={asset}
            hasChildren={hasChildren}
            childAssets={childAssets}
            setActiveTab={setActiveTab}
            handleChildAssetClick={handleChildAssetClick}
            textDraft={
              inlineEditActive
                ? { active: true, value: draftTextContent, onChange: setDraftTextContent }
                : undefined
            }
          />
        );
        break;
      case 'video':
        main = <VideoAssetContent asset={asset} AuthenticatedVideo={AuthenticatedVideo} />;
        break;
      case 'audio':
        main = <AudioAssetContent asset={asset} AuthenticatedAudio={AuthenticatedAudio} />;
        break;
      case 'web':
        main = (
          <WebContent
            asset={asset}
            hasChildren={hasChildren}
            childAssets={childAssets}
            setActiveTab={setActiveTab}
            handleChildAssetClick={handleChildAssetClick}
            AuthenticatedImage={AuthenticatedImage}
            enableHighlighting={enableHighlighting}
            hideMainText={inlineEditActive}
          />
        );
        break;
      case 'csv':
        main = (
          <CsvOverviewContent
            asset={asset}
            hasChildren={hasChildren}
            childAssets={childAssets}
            csvBrowseItems={csvBrowseItems}
            csvBrowseTotal={csvBrowseTotal}
            isReprocessing={isReprocessing}
            handleReprocessAsset={handleReprocessAsset}
            setIsReprocessDialogOpen={setIsReprocessDialogOpen}
            activeInfospace={activeInfospace}
            getAssetById={getAssetById}
            fetchChildren={fetchChildren}
            onOpenCsvRow={openCsvRowByPartIndex}
            highlightAssetIdOnOpen={highlightAssetIdOnOpen}
          />
        );
        break;
      case 'csv_row':
        main = <CsvRowContent asset={asset} />;
        break;
      default:
        main = <DefaultAssetContent asset={asset} renderTextDisplay={renderTextDisplay} suppressTextBody={inlineEditActive} />;
    }

    if (!inlineEditActive) return main;

    /* PDF: text edits live inside PdfAssetContent (same panel as read-only) */
    if (asset.kind === 'pdf') return main;

    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <div className="min-h-0 flex-1 min-w-0 overflow-y-auto overflow-x-hidden">{main}</div>
        <div className="shrink-0 border-t bg-muted/30 p-4 space-y-2 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]">
          <Label htmlFor="asset-inline-text" className="text-xs font-medium text-muted-foreground">
            Edit text content
          </Label>
          <Textarea
            id="asset-inline-text"
            value={draftTextContent}
            onChange={(e) => setDraftTextContent(e.target.value)}
            className="min-h-[160px] max-h-[min(40vh,420px)] resize-y text-sm leading-relaxed"
            spellCheck={false}
          />
        </div>
      </div>
    );
  };

  const renderChildAssets = () => {
    if (isLoadingChildren && childAssets.length === 0) {
      return (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading child assets...</span>
        </div>
      );
    }

    if (childrenError) {
      return (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Child Assets</AlertTitle>
          <AlertDescription>{childrenError}</AlertDescription>
        </Alert>
      );
    }

    if (!hasChildren) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No child assets found for this {asset?.kind || 'asset'}.
        </div>
      );
    }

    // Check if this is a web article with mostly image assets
    const imageAssets = filteredChildAssets.filter(child => child.kind === 'image');
    const isWebImageGallery = asset?.kind === 'web' && imageAssets.length > 0 && imageAssets.length >= filteredChildAssets.length * 0.7;

    if (isWebImageGallery) {
      // Render as image gallery for web articles
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 sticky -top-4 bg-background z-10 pb-2">
            <div className="relative flex-grow max-w-md">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search images..."
                value={childSearchTerm}
                onChange={(e) => setChildSearchTerm(e.target.value)}
                className="pl-8 h-9"
              />
        </div>
            <Badge variant="outline">
              {imageAssets.length} images
            </Badge>
          </div>

          {/* Image Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {imageAssets.map((imageAsset, index) => (
              <Card
                key={imageAsset.id}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-lg group",
                  selectedChildAsset?.id === imageAsset.id && "ring-2 ring-primary"
                )}
                onClick={() => handleChildAssetClick(imageAsset)}
              >
                <CardContent className="p-0">
                  {/* Image Preview */}
                  <div className="aspect-square rounded-t-lg overflow-hidden bg-muted/20">
                    {imageAsset.source_identifier ? (
                      <img 
                        src={imageAsset.source_identifier} 
                        alt={imageAsset.title || `Image ${imageAsset.id}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        onError={(e) => {
                          // Fallback to blob path if external fails
                          if (imageAsset.blob_path) {
                            e.currentTarget.style.display = 'none';
                            const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                            if (fallback) fallback.classList.remove('hidden');
                          }
                        }}
                      />
                    ) : null}
                    {imageAsset.blob_path && (
                      <AuthenticatedImage 
                        blobPath={imageAsset.blob_path} 
                        alt={imageAsset.title || `Image ${imageAsset.id}`}
                        className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 ${imageAsset.source_identifier ? 'hidden' : ''}`}
                      />
                    )}
                  </div>
                  
                  {/* Image Info */}
                  <div className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs">
                        {index + 1}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {imageAsset.kind}
                      </Badge>
                    </div>
                    <h4 className="font-medium text-sm truncate mb-1">
                      {(imageAsset.title || `Image ${imageAsset.id}`)
                        .replace(/\s*\(IMAGE\)\s*$/i, '')
                        .trim()}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      ID: {imageAsset.id}
                    </p>
                    {imageAsset.created_at && (
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNowStrict(new Date(imageAsset.created_at), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Selected Image Details */}
          {selectedChildAsset && selectedChildAsset.kind === 'image' && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ImageIcon className="h-5 w-5 text-purple-600" />
                  {(selectedChildAsset.title || `Image ${selectedChildAsset.id}`)
                    .replace(/\s*\(IMAGE\)\s*$/i, '')
                    .trim()}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Large Image Preview */}
                <div className="flex justify-center bg-muted/20 rounded-lg p-4">
                  {selectedChildAsset.source_identifier ? (
                    <img 
                      src={selectedChildAsset.source_identifier} 
                      alt={selectedChildAsset.title || `Image ${selectedChildAsset.id}`}
                      className="max-w-full max-h-96 object-contain rounded shadow-lg"
                      onError={(e) => {
                        // Fallback to blob path if external fails
                        if (selectedChildAsset.blob_path) {
                          e.currentTarget.style.display = 'none';
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                          if (fallback) fallback.classList.remove('hidden');
                        }
                      }}
                    />
                  ) : null}
                  {selectedChildAsset.blob_path && (
                    <AuthenticatedImage 
                      blobPath={selectedChildAsset.blob_path} 
                      alt={selectedChildAsset.title || `Image ${selectedChildAsset.id}`}
                      className={`max-w-full max-h-96 object-contain rounded shadow-lg ${selectedChildAsset.source_identifier ? 'hidden' : ''}`}
                    />
                  )}
                </div>
                
                {/* Image Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <strong>ID:</strong> {selectedChildAsset.id}
                  </div>
                  <div>
                    <strong>UUID:</strong> 
                    <code className="ml-1 text-xs">{selectedChildAsset.uuid}</code>
                  </div>
                  {selectedChildAsset.source_identifier && (
                    <div className="md:col-span-2">
                      <strong>Source URL:</strong>
                      <a 
                        href={selectedChildAsset.source_identifier} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="ml-1 text-primary hover:underline text-xs break-all"
                      >
                        {selectedChildAsset.source_identifier}
                      </a>
                    </div>
                  )}
                  {selectedChildAsset.event_timestamp && (
                    <div className="md:col-span-2">
                      <strong>Event Time:</strong> {format(new Date(selectedChildAsset.event_timestamp), "PPp")}
                    </div>
                  )}
                  {(() => {
                    const meta = getAssetMeta(selectedChildAsset);
                    return Object.keys(meta).length > 0 && (
                    <div className="md:col-span-2">
                      <strong>Metadata:</strong>
                      <pre className="text-xs bg-muted/50 p-2 rounded mt-1 overflow-auto max-h-32">
                        {JSON.stringify(meta, null, 2)}
                      </pre>
                    </div>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Non-image assets (if any) */}
          {filteredChildAssets.length > imageAssets.length && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Other Assets</h3>
              <div className="space-y-2">
                {filteredChildAssets.filter(child => child.kind !== 'image').map((childAsset, index) => (
                  <Card
                    key={childAsset.id}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/50",
                      selectedChildAsset?.id === childAsset.id && "bg-blue-50 dark:bg-blue-900/50 ring-2 ring-primary"
                    )}
                    onClick={() => handleChildAssetClick(childAsset)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
                          {getAssetIcon(childAsset.kind, "h-4 w-4")}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium truncate">{childAsset.title || `Asset ${childAsset.id}`}</h4>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <Badge variant="outline" className="capitalize">{childAsset.kind}</Badge>
                            <span>ID: {childAsset.id}</span>
                            {childAsset.created_at && (
                              <span>Created: {formatDistanceToNowStrict(new Date(childAsset.created_at), { addSuffix: true })}</span>
                            )}
                          </div>
                          {childAsset.text_content && (
                            <p className="text-xs text-muted-foreground mt-2 break-words max-w-full overflow-hidden">
                              {childAsset.text_content}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Default list view for non-image galleries
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 sticky top-0 bg-background z-10 pb-2">
          <div className="relative flex-grow max-w-md">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search child assets..."
              value={childSearchTerm}
              onChange={(e) => setChildSearchTerm(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Badge variant="outline">
            {filteredChildAssets.length} of {childAssets.length} items
            </Badge>
        </div>

        <div className="space-y-2">
          {filteredChildAssets.map((childAsset, index) => (
            <Card
              key={childAsset.id}
              className={cn(
                "cursor-pointer transition-colors hover:bg-muted/50",
                selectedChildAsset?.id === childAsset.id && "bg-blue-50 dark:bg-blue-900/50 ring-2 ring-primary"
              )}
              onClick={() => handleChildAssetClick(childAsset)}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate">{childAsset.title || `Asset ${childAsset.id}`}</h4>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <Badge variant="outline" className="capitalize">{childAsset.kind}</Badge>
                      <span>ID: {childAsset.id}</span>
                      {childAsset.created_at && (
                        <span>Created: {formatDistanceToNowStrict(new Date(childAsset.created_at), { addSuffix: true })}</span>
                      )}
                    </div>
                    {childAsset.text_content && (
                      <p className="text-xs text-muted-foreground mt-2 break-words max-w-full overflow-hidden">
                        {childAsset.text_content}
                      </p>
                    )}
          </div>
        </div>
        
                {selectedChildAsset?.id === childAsset.id && (
                  <div className="mt-3 pt-3 border-t space-y-2">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <strong>UUID:</strong> {childAsset.uuid}
                      </div>
                      {childAsset.source_identifier && (
                        <div>
                          <strong>Source ID:</strong> {childAsset.source_identifier}
              </div>
            )}
                      {childAsset.event_timestamp && (
                        <div>
                          <strong>Event Time:</strong> {format(new Date(childAsset.event_timestamp), "PPp")}
          </div>
                      )}
                    </div>
                    
                    {childAsset.text_content && (
                      <div className="mt-2">
                        <strong className="text-xs">Full Content:</strong>
                        <ScrollArea className="h-24 mt-1 p-2 bg-muted/50 rounded text-xs max-w-full overflow-hidden">
                          <div className="break-words whitespace-pre-wrap max-w-full">{childAsset.text_content}</div>
        </ScrollArea>
                      </div>
                    )}
                    
                    {(() => {
                      const meta = getAssetMeta(childAsset);
                      return Object.keys(meta).length > 0 && (
                      <div className="mt-2">
                        <strong className="text-xs">Metadata:</strong>
                        <pre className="text-xs bg-muted/50 p-2 rounded overflow-auto max-h-20 mt-1 break-words max-w-full">
                          {JSON.stringify(meta, null, 2)}
                        </pre>
                      </div>
                      );
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  // New PDF-specific children rendering function
  const renderPdfChildAssets = () => {
    if (isLoadingChildren && childAssets.length === 0) {
      return (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading PDF pages...</span>
        </div>
      );
    }

    if (childrenError) {
      return (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading PDF Pages</AlertTitle>
          <AlertDescription>{childrenError}</AlertDescription>
        </Alert>
      );
    }

    if (!hasChildren) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No PDF pages found for this document.
        </div>
      );
    }

    // Sort pages by part_index to ensure correct order
    const sortedPages = [...filteredChildAssets].sort((a, b) => (a.part_index || 0) - (b.part_index || 0));

    return (
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
        {/* Search and stats header */}
        <div className="flex shrink-0 items-center gap-2 bg-background pb-0 z-10">
          <div className="relative max-w-md flex-grow">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search PDF pages..."
              value={childSearchTerm}
              onChange={(e) => setChildSearchTerm(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Badge variant="outline">
            {sortedPages.length} pages
          </Badge>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        {/* PDF Pages Grid - Compact thumbnails */}
        <div
          className={cn(
            'grid min-h-0 gap-3 overflow-y-auto p-2',
            selectedChildAsset
              ? 'max-h-[min(42vh,22rem)] shrink-0'
              : 'flex-1'
          )}
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
        >
          {sortedPages.map((pageAsset, index) => (
            <Card
              key={pageAsset.id}
              className={cn(
                "cursor-pointer transition-all hover:shadow-lg group relative",
                selectedChildAsset?.id === pageAsset.id && "ring-2 ring-primary shadow-lg"
              )}
              onClick={() => handleChildAssetClick(pageAsset)}
            >
              <CardContent className="p-0">
                {/* Text preview in place of icon - main card content */}
                <div className="aspect-[4/3] rounded-t-lg overflow-hidden bg-muted/20 flex flex-col relative p-2">
                  {pageAsset.text_content ? (
                    <p className="text-xs text-muted-foreground line-clamp-4 overflow-hidden flex-1">
                      {pageAsset.text_content}
                    </p>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                      <FileText className="h-6 w-6 mb-1 opacity-50" />
                      <span className="text-xs">Page {(pageAsset.part_index !== null ? pageAsset.part_index + 1 : index + 1)}</span>
                    </div>
                  )}
                  {/* Page label overlay */}
                  <Badge variant="secondary" className="text-xs w-fit mt-auto shrink-0">
                    Page {(pageAsset.part_index !== null ? pageAsset.part_index + 1 : index + 1)}
                  </Badge>
                  {/* Selection indicator */}
                  {selectedChildAsset?.id === pageAsset.id && (
                    <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                      <Eye className="h-3 w-3" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Selected Page Detailed View */}
        {selectedChildAsset && (
          <div className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-lg font-semibold">
              Page {selectedChildAsset.part_index !== null ? selectedChildAsset.part_index + 1 : 'Unknown'}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  if (asset?.blob_path) {
                    const pageNum = (selectedChildAsset.part_index !== null ? selectedChildAsset.part_index + 1 : 1);
                    const viewUrl = `/api/v1/files/stream/${encodeURIComponent(asset.blob_path)}#page=${pageNum}`;
                    window.open(viewUrl, '_blank');
                  } else {
                    setActiveTab('content');
                  }
                }}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Page in New Tab
              </Button>
            </div>
            {/* Main Content */}
            <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto py-2">
              {/* Page Text Content */}
              <div className="flex min-h-0 flex-1 flex-col space-y-3">
                <h4 className="shrink-0 font-semibold text-sm">Extracted Text Content</h4>
                {selectedChildAsset.text_content ? (
                  <ScrollArea className="min-h-[12rem] w-full flex-1 border rounded-lg bg-background p-4">
                    <TextContentRenderer content={selectedChildAsset.text_content} />
                  </ScrollArea>
                ) : (
                  <div className="flex min-h-[12rem] flex-1 w-full items-center justify-center rounded-lg border bg-muted/10">
                    <div className="text-center text-muted-foreground">
                      <Type className="h-8 w-8 mx-auto mb-2" />
                      <p className="text-sm">No text content extracted</p>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
        </div>
      </div>
    );
  };

  return (
    <div className="asset-detail-view flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden">
      {isLoadingAsset ? (
        <div className="flex items-center justify-center h-full mt-10">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading asset...</span>
        </div>
      ) : assetError ? (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Asset</AlertTitle>
          <AlertDescription>{assetError}</AlertDescription>
        </Alert>
      ) : !asset ? (
        <div className="flex items-center justify-center h-full">
          <span className="text-muted-foreground">No asset selected.</span>
        </div>
      ) : (
        <>
          {/* Unified Meta Header */}
          <div className="shrink-0">
          <AssetMetaHeader 
            asset={asset}
            inlineEdit={{
              active: inlineEditActive,
              draftTitle,
              draftEventTimestamp,
              onDraftTitleChange: setDraftTitle,
              onDraftEventTimestampChange: setDraftEventTimestamp,
              onStart: handleStartInlineEdit,
              onSave: handleSaveInlineEdit,
              onCancel: handleCancelInlineEdit,
              isSaving: isSavingInline,
            }}
            onFragmentDelete={async (key) => {
              if (!asset?.id) return;
              
              const success = await deleteFragment({
                assetId: asset.id,
                fragmentKey: key,
              });
              
              if (success) {
                toast.success(`Fragment "${key}" deleted`);
                // Force refetch by clearing the cache ref, then refresh
                currentAssetIdRef.current = null;
                fetchAsset();
              } else {
                toast.error('Failed to delete fragment');
              }
            }}
            onRequestEnrichment={async (enricherName) => {
              if (!asset?.id) return;
              await requestEnrichment(asset.id, enricherName);
            }}
            isFavorited={isFavorited}
            onToggleFavorite={toggleFavorite}
            showActions={true}
            showFragments={true}
          />
          </div>

          {/* Main Content Area */}
          <div className="flex min-h-0 flex-1 flex-col max-w-full overflow-hidden">
            {isHierarchicalAsset && hasChildren ? (
              /* Tabs only when there are children */
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'content' | 'children')} className="w-full h-full flex flex-col min-w-0 !px-1 max-w-full overflow-hidden">
                <TabsList className="grid grid-cols-2 w-full flex-none sticky top-0 z-10 m-1 min-w-0 !px-0">
                  <TabsTrigger value="content">
                    {(() => {
                      switch (asset?.kind) {
                        case 'csv': return 'Overview';
                        case 'article': return 'Article';
                        case 'pdf': return 'Document';
                        case 'web': return 'Article';
                        default: return 'Content';
                      }
                    })()}
                  </TabsTrigger>
                  <TabsTrigger value="children" className="flex items-center gap-2">
                    <List className="h-4 w-4" />
                    {(() => {
                      switch (asset?.kind) {
                        case 'csv': return `Row Detail`;
                        case 'pdf': return `pages (${childAssets.length})`;
                        case 'article': return `${childAssets.length} related`;
                        case 'mbox': return `${childAssets.length} emails`;
                        case 'web': {
                          const imageCount = childAssets.filter(child => {
                            if (child.kind !== 'image') return false;
                            const isGif = (url: string) => url.toLowerCase().includes('.gif');
                            if (child.source_identifier && isGif(child.source_identifier)) return false;
                            if (child.blob_path && isGif(child.blob_path)) return false;
                            return true;
                          }).length;
                          return `Images (${imageCount})`;
                        }
                        default: return `Children (${childAssets.length})`;
                      }
                    })()}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="content" className="flex-1 min-h-0 overflow-y-auto p-4 min-w-0 max-w-full overflow-x-hidden">
                  {renderContent()}
                  
                  {/* Related Assets - Semantic Search */}
                  {asset &&
                    activeInfospace?.enable_related_assets &&
                    kindConfig?.showRelatedAssets &&
                    (activeInfospace?.enrichment_config as any)?.embedding?.model_name && (
                    <div className="mt-8 pt-8 border-t">
                      <AssetFeedView
                        title="Related Articles"
                        items={relatedAssetsResults
                          .filter(r => r.asset.id !== asset.id) // Exclude current asset
                          .slice(0, 6) // Limit to 6
                          .map(r => ({
                            asset: r.asset,
                            score: r.score,
                          }))}
                        cardSize="sm"
                        columns={3}
                        showControls={false}
                        onAssetClick={onEdit}
                        emptyMessage="No related articles found"
                      />
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="children" className="flex-1 min-h-0 overflow-y-auto p-4 min-w-0 max-w-full overflow-x-hidden">
                  {kindConfig?.childrenComponent === 'csv' ? (
                    <AssetDetailViewCsv
                      asset={asset}
                      items={csvItems}
                      total={csvTotal}
                      hasMore={csvHasMore}
                      isLoading={csvIsLoading}
                      childrenError={childrenError}
                      onRowSelect={handleCsvRowSelect}
                      onLoadMore={handleCsvLoadMore}
                      selectedChildAsset={selectedChildAsset}
                      highlightedAssetId={highlightAssetIdOnOpen}
                      rowListSearchTerm={childSearchTerm}
                      onRowListSearchTermChange={setChildSearchTerm}
                    />
                  ) : kindConfig?.childrenComponent === 'pdf' ? (
                    renderPdfChildAssets()
                  ) : (
                    renderChildAssets()
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              /* No tabs - just render content directly */
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 min-w-0 max-w-full">
                {renderContent()}
              </div>
            )}
        </div>
        </>
      )}
      
      {/* Reprocess CSV Dialog */}
      <Dialog 
        open={isReprocessDialogOpen} 
        onOpenChange={(open) => {
          setIsReprocessDialogOpen(open);
          if (!open) {
            setReprocessOptions({
              delimiter: 'auto',
              skip_rows: 0,
              encoding: 'utf-8',
            });
            setIsReprocessing(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reprocess CSV Asset</DialogTitle>
            <DialogDescription>
              Specify custom parsing options for your CSV file. Leave fields empty to use auto-detection.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="delimiter">Delimiter</Label>
              <Select
                value={reprocessOptions.delimiter}
                onValueChange={(value) => setReprocessOptions(prev => ({ ...prev, delimiter: value }))}
              >
                <SelectTrigger id="delimiter">
                  <SelectValue placeholder="Auto-detect delimiter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value=",">, (comma)</SelectItem>
                  <SelectItem value=";">; (semicolon)</SelectItem>
                  <SelectItem value={"\t"}>Tab</SelectItem>
                  <SelectItem value="|">| (pipe)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Your CSV shows: Group;Email;Password;Name (semicolon-separated)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="skip-rows">Skip Rows</Label>
              <Input
                id="skip-rows"
                type="number"
                min="0"
                max="10"
                value={reprocessOptions.skip_rows}
                onChange={(e) => setReprocessOptions(prev => ({ 
                  ...prev, 
                  skip_rows: parseInt(e.target.value) || 0 
                }))}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                Number of rows to skip before the header row (if header is not on line 1)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="encoding">Text Encoding</Label>
              <Select
                value={reprocessOptions.encoding}
                onValueChange={(value) => setReprocessOptions(prev => ({ ...prev, encoding: value }))}
              >
                <SelectTrigger id="encoding">
                  <SelectValue placeholder="Select encoding" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utf-8">UTF-8</SelectItem>
                  <SelectItem value="iso-8859-1">ISO-8859-1 (Latin-1)</SelectItem>
                  <SelectItem value="windows-1252">Windows-1252</SelectItem>
                  <SelectItem value="utf-16">UTF-16</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => setIsReprocessDialogOpen(false)}
              disabled={isReprocessing}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => handleReprocessAsset(true)}
              disabled={isReprocessing}
            >
              {isReprocessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reprocess CSV
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
        </Dialog>
    </div>
  );
};


export default AssetDetailView;