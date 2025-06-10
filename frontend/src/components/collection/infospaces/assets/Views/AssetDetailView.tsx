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
import { AssetRead, AssetUpdate } from '@/client/models';
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from '@/components/ui/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
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
import { formatDistanceToNow } from 'date-fns';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import useAuth from '@/hooks/useAuth';
import { Textarea } from "@/components/ui/textarea"
import Link from 'next/link';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { toast } from 'sonner';
import { ExternalLink, Info, Edit2, Trash2, UploadCloud, Download, RefreshCw, Eye, Play, FileText, List, ChevronDown, ChevronUp, Search, File, PlusCircle, Save, X, CheckCircle, AlertCircle, ArrowUp, ArrowDown, Files, Type, Loader2, Table as TableIcon, Layers, Image as ImageIcon, Globe, Video, Music, FileSpreadsheet, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import AssetDetailViewCsv from './AssetDetailViewCsv';
import AssetDetailViewPdf from './AssetDetailViewPdf';
import AssetDetailViewTextBlock from './AssetDetailViewTextBlock';

// Define Sort Direction type
type SortDirection = 'asc' | 'desc' | null;

// ---> ADDED: State for inline editing <---
interface EditState {
  assetId: number;
  field: 'title' | 'event_timestamp';
  value: string;
}
// ---> END ADDED <---

interface AssetDetailViewProps {
  onEdit: (item: AssetRead) => void;
  schemes: any[]; // Placeholder for classification schemes
  selectedAssetId: number | null;
  highlightAssetIdOnOpen: number | null;
  onLoadIntoRunner?: (jobId: number, jobName: string) => void;
}

const AssetDetailView = ({
  onEdit,
  schemes,
  selectedAssetId,
  highlightAssetIdOnOpen,
  onLoadIntoRunner
}: AssetDetailViewProps) => {
  // --- State Hooks ---
  const [asset, setAsset] = useState<AssetRead | null>(null);
  const [isLoadingAsset, setIsLoadingAsset] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [editingAsset, setEditingAsset] = useState<EditState | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  
  // Child assets state
  const [childAssets, setChildAssets] = useState<AssetRead[]>([]);
  const [isLoadingChildren, setIsLoadingChildren] = useState(false);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const [selectedChildAsset, setSelectedChildAsset] = useState<AssetRead | null>(null);
  const [childSearchTerm, setChildSearchTerm] = useState('');

  // Media blob URLs for authenticated access
  const [mediaBlobUrls, setMediaBlobUrls] = useState<Map<string, string>>(new Map());
  const [isLoadingMedia, setIsLoadingMedia] = useState<Set<string>>(new Set());
  
  // Promise cache for ongoing fetch operations
  const fetchPromiseCache = useRef<Map<string, Promise<string | null>>>(new Map());
  
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

  const { activeInfospace } = useInfospaceStore();
  const { getAssetById, updateAsset, fetchChildAssets, reprocessAsset } = useAssetStore();

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
        if (fetchedAsset.kind === 'csv' || fetchedAsset.kind === 'pdf' || fetchedAsset.kind === 'mbox' || fetchedAsset.kind === 'web' || fetchedAsset.is_container) {
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

  const fetchChildren = useCallback(async (parentId: number, parentAsset: AssetRead) => {
    console.log(`[AssetDetailView] Fetching children for parent asset ID: ${parentId}`);
    setIsLoadingChildren(true);
    setChildrenError(null);
    
    // Clear existing children first to force UI update
    setChildAssets([]);
    setSelectedChildAsset(null);
    
    try {
      const children = await fetchChildAssets(parentId);
      console.log(`[AssetDetailView] API Response - Fetched ${children?.length || 0} child assets for parent ${parentId}:`, children);
      
      if (children && children.length > 0) {
        setChildAssets(children);
        console.log(`[AssetDetailView] State updated with ${children.length} child assets`);
        
        // Force UI refresh by incrementing trigger
        setRefreshTrigger(prev => {
          const newTrigger = prev + 1;
          console.log(`[AssetDetailView] Incrementing refresh trigger: ${prev} -> ${newTrigger}`);
          return newTrigger;
        });
        
        // Remove automatic tab switching - always stay on content tab
        // Users can manually switch to children tab if they want to see the child assets
      } else {
        setChildAssets([]);
        console.log(`[AssetDetailView] No child assets returned or empty array`);
      }
    } catch (err: any) {
      console.error("Error fetching child assets:", err);
      setChildrenError(err.message || "Failed to load child assets");
      setChildAssets([]);
    } finally {
      setIsLoadingChildren(false);
    }
  }, [fetchChildAssets]);

  // Function to fetch authenticated media files and create blob URLs
  const fetchMediaBlob = useCallback(async (blobPath: string): Promise<string | null> => {
    if (!blobPath || !activeInfospace?.id) return null;

    // Check if we already have a blob URL for this path
    if (mediaBlobUrls.has(blobPath)) {
      return mediaBlobUrls.get(blobPath)!;
    }

    // Check if we already have a pending promise for this path
    if (fetchPromiseCache.current.has(blobPath)) {
      return fetchPromiseCache.current.get(blobPath)!;
    }

    // Create and cache the fetch promise
    const fetchPromise = (async (): Promise<string | null> => {
      setIsLoadingMedia(prev => new Set([...prev, blobPath]));

      try {
        const response = await fetch(`/api/v1/files/stream/${encodeURIComponent(blobPath)}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Update the cache with the successful result
        setMediaBlobUrls(prev => new Map(prev.set(blobPath, blobUrl)));
        return blobUrl;
      } catch (error) {
        console.error('Error fetching media blob:', error);
        toast.error(`Failed to load media: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
      } finally {
        setIsLoadingMedia(prev => {
          const newSet = new Set(prev);
          newSet.delete(blobPath);
          return newSet;
        });
        // Remove the promise from cache when done
        fetchPromiseCache.current.delete(blobPath);
      }
    })();

    // Cache the promise so other callers can wait for the same result
    fetchPromiseCache.current.set(blobPath, fetchPromise);
    return fetchPromise;
  }, [activeInfospace?.id, mediaBlobUrls]);

  // Function to fetch CSV content as text
  const fetchCSVContent = useCallback(async (blobPath: string): Promise<string | null> => {
    if (!blobPath || !activeInfospace?.id) return null;

    try {
      const response = await fetch(`/api/v1/files/stream/${encodeURIComponent(blobPath)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
      }

      const csvText = await response.text();
      return csvText;
    } catch (error) {
      console.error('Error fetching CSV content:', error);
      toast.error(`Failed to load CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }, [activeInfospace?.id]);

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

  const hasChildren = useMemo(() => childAssets.length > 0, [childAssets, refreshTrigger]);
  const isHierarchicalAsset = useMemo(() => 
    asset && (asset.kind === 'csv' || asset.kind === 'pdf' || asset.kind === 'mbox' || asset.kind === 'article' || asset.kind === 'web' || asset.is_container),
    [asset, refreshTrigger]
  );

  // --- Effects ---
  useEffect(() => {
    fetchAsset();
  }, [fetchAsset]);

  // Reset tab to content when switching between assets
  useEffect(() => {
    setActiveTab('content');
  }, [selectedAssetId]);

  useEffect(() => {
    if (highlightAssetIdOnOpen && childAssets.length > 0) {
      const assetToSelect = childAssets.find(c => c.id === highlightAssetIdOnOpen);
      if (assetToSelect && selectedChildAsset?.id !== highlightAssetIdOnOpen) {
        setSelectedChildAsset(assetToSelect);
        // Remove automatic tab switching - let users manually switch to children tab if needed
      }
    }
  }, [highlightAssetIdOnOpen, childAssets, selectedChildAsset]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      // Cleanup all blob URLs
      mediaBlobUrls.forEach(url => {
        URL.revokeObjectURL(url);
      });
      
      // Clear the promise cache
      fetchPromiseCache.current.clear();
    };
  }, []); // Remove mediaBlobUrls from dependencies to avoid recreating the cleanup function

  // CSV content display component
  const AuthenticatedCSV = ({ 
    blobPath, 
    title, 
    className,
    childAssets,
    onRowClick
  }: { 
    blobPath: string; 
    title: string; 
    className?: string;
    childAssets: AssetRead[];
    onRowClick: (asset: AssetRead) => void;
  }) => {
    const [csvContent, setCsvContent] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      const loadCSV = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const content = await fetchCSVContent(blobPath);
          setCsvContent(content);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load CSV');
        } finally {
          setIsLoading(false);
        }
      };

      loadCSV();
    }, [blobPath]);

    if (isLoading) {
      return (
        <div className={cn("flex items-center justify-center p-8", className)}>
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading CSV content...</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className={cn("flex items-center justify-center p-8 text-red-600", className)}>
          <AlertCircle className="h-5 w-5 mr-2" />
          <span>Error: {error}</span>
        </div>
      );
    }

    if (!csvContent) {
      return (
        <div className={cn("flex items-center justify-center p-8 text-muted-foreground", className)}>
          <FileSpreadsheet className="h-12 w-12 mb-2" />
          <span>No CSV content available</span>
        </div>
      );
    }

    // Parse CSV content
    const lines = csvContent.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      return (
        <div className={cn("flex items-center justify-center p-8 text-muted-foreground", className)}>
          <span>Empty CSV file</span>
        </div>
      );
    }

    // Parse CSV (simple parsing - assumes comma delimiter and handles quoted fields)
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let currentField = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            // Escaped quote
            currentField += '"';
            i++; // Skip the next quote
          } else {
            // Toggle quote state
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          // Field separator
          result.push(currentField.trim());
          currentField = '';
        } else {
          currentField += char;
        }
      }
      
      // Add the last field
      result.push(currentField.trim());
      return result;
    };

    const rows = lines.map(parseCSVLine);
    const headers = rows[0] || [];
    const dataRows = rows.slice(1);

    return (
      <div className={cn("h-full flex flex-col", className)}>
        <div className="flex-none p-2 bg-muted/30 border-b">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{title}</h4>
            <Badge variant="outline" className="text-xs">
              {dataRows.length} rows × {headers.length} columns
            </Badge>
          </div>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  {headers.map((header, index) => (
                    <th key={index} className="px-2 py-1 text-left font-medium text-xs">
                      {header || `Column ${index + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.slice(0, 100).map((row, rowIndex) => {
                  const matchingChild = childAssets.find(child => child.part_index === rowIndex);
                  return (
                    <tr 
                      key={rowIndex} 
                      className="hover:bg-primary/10 cursor-pointer"
                      onClick={() => {
                        if (matchingChild) {
                          onRowClick(matchingChild);
                        } else {
                          toast.warning(`Could not find a corresponding asset for row ${rowIndex + 2}. It might still be processing or not exist.`);
                        }
                      }}
                    >
                      {headers.map((_, colIndex) => (
                        <td key={colIndex} className="px-2 py-1 text-xs max-w-[200px] truncate">
                          {row[colIndex] || ''}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {dataRows.length > 100 && (
              <div className="p-4 text-center text-muted-foreground text-sm">
                Showing first 100 rows of {dataRows.length} total rows.
                <br />
                <span className="text-xs">Use the "CSV Rows" tab to browse individual rows as sub-assets.</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  // Authenticated media components
  const AuthenticatedImage = ({ blobPath, alt, className }: { blobPath: string; alt: string; className?: string }) => {
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
      const loadImage = async () => {
        setIsLoading(true);
        setHasError(false);
        try {
          const blobUrl = await fetchMediaBlob(blobPath);
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

  const AuthenticatedPDF = ({ blobPath, title, className }: { blobPath: string; title: string; className?: string }) => {
    const [pdfSrc, setPdfSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string>('');

    useEffect(() => {
      const loadPDF = async () => {
        console.log(`[AuthenticatedPDF] Loading PDF from blobPath: ${blobPath}`);
        setIsLoading(true);
        setHasError(false);
        setErrorMessage('');
        
        try {
          const blobUrl = await fetchMediaBlob(blobPath);
          if (blobUrl) {
            console.log(`[AuthenticatedPDF] Successfully created blob URL: ${blobUrl}`);
            setPdfSrc(blobUrl);
          } else {
            console.error(`[AuthenticatedPDF] Failed to create blob URL for: ${blobPath}`);
            setHasError(true);
            setErrorMessage('Failed to load PDF content');
          }
        } catch (error) {
          console.error(`[AuthenticatedPDF] Error loading PDF:`, error);
          setHasError(true);
          setErrorMessage(error instanceof Error ? error.message : 'Unknown error loading PDF');
        } finally {
          setIsLoading(false);
        }
      };
      
      loadPDF();
      
      // Cleanup function to revoke blob URL
      return () => {
        if (pdfSrc) {
          console.log(`[AuthenticatedPDF] Cleaning up blob URL: ${pdfSrc}`);
          URL.revokeObjectURL(pdfSrc);
        }
      };
    }, [blobPath]);

    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
          <Loader2 className="h-8 w-8 animate-spin mb-4" />
          <span className="text-sm">Loading PDF...</span>
          <span className="text-xs mt-1 opacity-70">{title}</span>
        </div>
      );
    }

    if (hasError || !pdfSrc) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
          <FileText className="h-16 w-16 opacity-50 mb-4" />
          <p className="text-center mb-2">PDF could not be loaded</p>
          {errorMessage && <p className="text-xs text-red-600 text-center">{errorMessage}</p>}
          <p className="text-xs text-center opacity-70 mt-2">File: {title}</p>
          <Button 
            variant="outline" 
            size="sm" 
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </div>
      );
    }

    return (
      <div className={cn("relative w-full h-full", className)}>
        <iframe 
          src={pdfSrc} 
          title={title}
          className="w-full h-full border-0"
          style={{ minHeight: '400px' }}
          onLoad={() => console.log(`[AuthenticatedPDF] PDF iframe loaded successfully`)}
          onError={(e) => {
            console.error(`[AuthenticatedPDF] PDF iframe error:`, e);
            setHasError(true);
            setErrorMessage('PDF viewer failed to load');
          }}
        />
        {/* Fallback for browsers that don't support PDF viewing */}
        <div className="absolute top-2 right-2">
          <Button
            variant="outline"
            size="sm"
            asChild
            className="bg-background/80 hover:bg-background"
          >
            <a href={pdfSrc} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </a>
          </Button>
        </div>
      </div>
    );
  };

  const AuthenticatedVideo = ({ blobPath, className }: { blobPath: string; className?: string }) => {
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
      const loadVideo = async () => {
        setIsLoading(true);
        setHasError(false);
        try {
          const blobUrl = await fetchMediaBlob(blobPath);
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

  const AuthenticatedAudio = ({ blobPath, className }: { blobPath: string; className?: string }) => {
    const [audioSrc, setAudioSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
      const loadAudio = async () => {
        setIsLoading(true);
        setHasError(false);
        try {
          const blobUrl = await fetchMediaBlob(blobPath);
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

  console.log(`[AssetDetailView] Asset ${asset?.id} (${asset?.kind}): hasChildren=${hasChildren}, childAssets.length=${childAssets.length}, isHierarchicalAsset=${isHierarchicalAsset}`);

  // --- Helper functions ---
  const getFormattedTimestamp = (isoString: string | null | undefined): string => {
    if (!isoString) return '';
    try {
    const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch (e) {
      console.error("Error formatting timestamp:", e);
      return '';
    }
  };

  const getAssetIcon = (kind: string, className?: string) => {
    const iconClass = className || "h-4 w-4";
    switch (kind) {
      case 'pdf': return <FileText className={`${iconClass} text-red-600`} />;
      case 'csv': return <FileSpreadsheet className={`${iconClass} text-green-600`} />;
      case 'image': return <ImageIcon className={`${iconClass} text-purple-600`} />;
      case 'video': return <Video className={`${iconClass} text-orange-600`} />;
      case 'audio': return <Music className={`${iconClass} text-teal-600`} />;
      case 'mbox':
      case 'email': return <FileText className={`${iconClass} text-blue-600`} />;
      case 'web': return <Globe className={`${iconClass} text-sky-600`} />;
      case 'text':
      case 'text_chunk': return <Type className={`${iconClass} text-indigo-600`} />;
      case 'article': return <FileText className={`${iconClass} text-amber-600`} />;
      default: return <File className={`${iconClass} text-muted-foreground`} />;
    }
  };

  const renderEditableField = (asset: AssetRead | null, field: 'title' | 'event_timestamp') => {
    if (!asset) return null;

    const isEditingThisField = editingAsset?.assetId === asset.id && editingAsset?.field === field;
    const displayValue = field === 'title' ? asset.title : asset.event_timestamp;
    const inputType = field === 'event_timestamp' ? 'datetime-local' : 'text';
    const label = field === 'title' ? 'Title' : 'Event Timestamp';

    const currentDisplayValue = field === 'event_timestamp' ? getFormattedTimestamp(displayValue) : (displayValue || 'N/A');

    return (
      <div className="flex items-center gap-2 text-sm mb-1">
        <strong className="w-28 shrink-0">{label}:</strong>
        {isEditingThisField ? (
          <div className="flex items-center gap-1 flex-grow min-w-0">
            <Input
              type={inputType}
              value={editingAsset.value}
              onChange={(e) => setEditingAsset({ ...editingAsset, value: e.target.value })}
              className="h-7 text-xs px-1 py-0.5 flex-grow"
              autoFocus
            />
            <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600 hover:bg-green-100" onClick={handleSaveEdit} disabled={isSavingEdit}>
              {isSavingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 hover:bg-red-100" onClick={handleCancelEdit} disabled={isSavingEdit}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-grow min-w-0">
            <span className="truncate flex-grow" title={typeof currentDisplayValue === 'string' ? currentDisplayValue : undefined}>
              {currentDisplayValue}
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => startEditing(asset.id, field, field === 'event_timestamp' ? getFormattedTimestamp(displayValue) : displayValue)}>
              <Edit2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderTextDisplay = (text: string | null) => (
    <ScrollArea className="h-[200px] w-full rounded-md p-3 text-sm bg-background">
      {text || <span className="text-muted-foreground italic">No text content available.</span>}
    </ScrollArea>
  );

  const handleSaveEdit = async () => {
    if (!editingAsset || !activeInfospace?.id) return;
    setIsSavingEdit(true);

    const updatePayload: AssetUpdate = {};
    if (editingAsset.field === 'title') {
      updatePayload.title = editingAsset.value;
    } else if (editingAsset.field === 'event_timestamp') {
      try {
        const parsedDate = new Date(editingAsset.value);
        if (isNaN(parsedDate.getTime())) {
          throw new Error("Invalid date format");
        }
        updatePayload.event_timestamp = parsedDate.toISOString();
      } catch (e) {
        toast.error("Invalid timestamp format. Use YYYY-MM-DDTHH:mm format.");
        setIsSavingEdit(false);
        return;
      }
    }

    const updatedAsset = await updateAsset(editingAsset.assetId, updatePayload);

    setIsSavingEdit(false);
    if (updatedAsset) {
      setEditingAsset(null);
      setAsset(updatedAsset);
      toast.success("Asset updated.");
    }
  };

  const handleCancelEdit = () => {
    setEditingAsset(null);
  };

  const startEditing = (assetId: number, field: 'title' | 'event_timestamp', currentValue: string | null | undefined) => {
    setEditingAsset({ assetId, field, value: currentValue || '' });
  };

  const handleChildAssetClick = (childAsset: AssetRead) => {
    setSelectedChildAsset(selectedChildAsset?.id === childAsset.id ? null : childAsset);
  };

  const handleReprocessAsset = async (useCustomOptions: boolean = false) => {
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
        }, 1500); // Reduced from 2000ms to 1500ms
      }
    } catch (error) {
      console.error('Error reprocessing asset:', error);
      toast.error(`Failed to reprocess asset: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
      setIsReprocessing(false);
    }
  };

  // --- Helper Components for Asset Content ---

  const ArticleAssetContent = ({ asset, renderEditableField, hasChildren, childAssets, setActiveTab, handleChildAssetClick, renderTextDisplay }: { asset: AssetRead, renderEditableField: any, hasChildren: boolean, childAssets: AssetRead[], setActiveTab: any, handleChildAssetClick: any, renderTextDisplay: any }) => (
    <div className="p-4 bg-muted/30 h-full flex flex-col">
      <h3 className="text-lg font-semibold mb-3 flex items-center">
        <FileText className="h-5 w-5 mr-2 text-amber-500" />
        Article Container
      </h3>
      <div className="space-y-2 mb-4 text-sm">
        {renderEditableField(asset, 'title')}
        <p><strong>Kind:</strong> {asset.kind}</p>
        <p><strong>ID:</strong> {asset.id}</p>
        {asset.source_identifier && <p><strong>Source:</strong> {asset.source_identifier}</p>}
        {renderEditableField(asset, 'event_timestamp')}
        </div>
      {asset.text_content && (
        <div className="flex-1">
          <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Article Content</h4>
          {renderTextDisplay(asset.text_content)}
        </div>
      )}
      {hasChildren && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <Badge variant="secondary" className="text-xs">
              <Layers className="h-3 w-3 mr-1" />
              {childAssets.length} Related Assets
            </Badge>
            <Button variant="outline" size="sm" onClick={() => setActiveTab('children')}>
              <Eye className="h-4 w-4 mr-2" />
              View Related Assets
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {childAssets.slice(0, 4).map((childAsset, index) => (
              <div key={childAsset.id} className="rounded p-2 hover:bg-muted/50 cursor-pointer text-xs" onClick={() => handleChildAssetClick(childAsset)}>
                <div className="flex items-center gap-1">
                  {getAssetIcon(childAsset.kind, "h-3 w-3")}
                  <span className="truncate">{childAsset.title}</span>
        </div>
                {childAsset.text_content && <p className="truncate text-muted-foreground mt-1">{childAsset.text_content.substring(0, 30)}...</p>}
              </div>
            ))}
            {childAssets.length > 4 && <div className="rounded p-2 text-xs text-muted-foreground flex items-center justify-center">+{childAssets.length - 4} more</div>}
          </div>
              </div>
            )}
      {asset.source_metadata && Object.keys(asset.source_metadata).length > 0 && (
        <div className="mt-3 pt-3 border-t">
          <h4 className="text-xs font-semibold mb-1.5 text-muted-foreground">Article Metadata</h4>
          <pre className="text-xs bg-background p-2 rounded overflow-auto max-h-32">{JSON.stringify(asset.source_metadata, null, 2)}</pre>
          </div>
      )}
      {/* Summary if available */}
      {asset.source_metadata?.summary && typeof asset.source_metadata.summary === 'string' ? (
        <div className="mt-4 p-3 bg-muted/30 rounded-lg border-l-4 border-primary">
          <p className="text-sm text-muted-foreground italic">
            {asset.source_metadata.summary}
          </p>
        </div>
      ) : null}
      </div>
    );

  const ImageAssetContent = ({ asset, renderEditableField, AuthenticatedImage }: { asset: AssetRead, renderEditableField: any, AuthenticatedImage: any }) => {
    const [sourceFailed, setSourceFailed] = React.useState(false);

    React.useEffect(() => {
      setSourceFailed(false);
    }, [asset.id]);

    const showExternalImage = asset.source_identifier && !sourceFailed;
    const showAuthenticatedImage = asset.blob_path && (!asset.source_identifier || sourceFailed);

      return (
      <div className="p-4 bg-muted/30 h-full flex flex-col">
        <h3 className="text-lg font-semibold mb-3 flex items-center">
          <ImageIcon className="h-5 w-5 mr-2 text-primary" />
          Image Asset
        </h3>
        <div className="space-y-2 mb-4 text-sm">
          {renderEditableField(asset, 'title')}
          <p><strong>Kind:</strong> {asset.kind}</p>
          <p><strong>ID:</strong> {asset.id}</p>
          {asset.source_metadata?.filename && <p><strong>Filename:</strong> {String(asset.source_metadata.filename)}</p>}
          {asset.blob_path && <p><strong>File Path:</strong> {asset.blob_path}</p>}
          {renderEditableField(asset, 'event_timestamp')}
        </div>
        <div className="flex-1 flex items-center justify-center bg-background rounded p-4">
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

  const PdfAssetContent = ({ asset, renderEditableField, AuthenticatedPDF, hasChildren, childAssets, setActiveTab, handleChildAssetClick }: { asset: AssetRead, renderEditableField: any, AuthenticatedPDF: any, hasChildren: boolean, childAssets: AssetRead[], setActiveTab: any, handleChildAssetClick: any }) => (
  <div className="p-4 bg-muted/30 h-full flex flex-col">
    <h3 className="text-lg font-semibold mb-3 flex items-center">
      <FileText className="h-5 w-5 mr-2 text-primary" />
      PDF Document
    </h3>
    <div className="space-y-2 mb-4 text-sm">
      {renderEditableField(asset, 'title')}
      <p><strong>Kind:</strong> {asset.kind}</p>
      <p><strong>ID:</strong> {asset.id}</p>
      {asset.source_metadata?.filename && <p><strong>Filename:</strong> {String(asset.source_metadata.filename)}</p>}
      {(asset.source_metadata?.page_count !== undefined && asset.source_metadata?.page_count !== null) && <p><strong>Pages:</strong> {String(asset.source_metadata.page_count)}</p>}
      {renderEditableField(asset, 'event_timestamp')}
        </div>
    <div className="flex-1 bg-background rounded overflow-hidden">
      {asset.blob_path && <AuthenticatedPDF blobPath={asset.blob_path} title={asset.title || 'PDF Document'} className="w-full h-full border-0" />}
        </div>
    {hasChildren && (
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <Badge variant="secondary" className="text-xs">
            <Layers className="h-3 w-3 mr-1" />
            {childAssets.length} PDF Pages
          </Badge>
          <Button variant="outline" size="sm" onClick={() => setActiveTab('children')}>
            <Eye className="h-4 w-4 mr-2" />
            View Pages
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {childAssets.slice(0, 3).map((childAsset, index) => (
            <div key={childAsset.id} className="rounded p-2 hover:bg-muted/50 cursor-pointer text-xs" onClick={() => handleChildAssetClick(childAsset)}>
              <div className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                <span>Page {index + 1}</span>
              </div>
              {childAsset.text_content && <p className="truncate text-muted-foreground mt-1">{childAsset.text_content.substring(0, 50)}...</p>}
            </div>
          ))}
          {childAssets.length > 3 && <div className="rounded p-2 text-xs text-muted-foreground flex items-center justify-center">+{childAssets.length - 3} more</div>}
        </div>
      </div>
    )}
      </div>
    );

const VideoAssetContent = ({ asset, renderEditableField, AuthenticatedVideo }: { asset: AssetRead, renderEditableField: any, AuthenticatedVideo: any }) => (
    <div className="p-4 bg-muted/30 h-full flex flex-col">
        <h3 className="text-lg font-semibold mb-3 flex items-center"><Video className="h-5 w-5 mr-2 text-primary" />Video Asset</h3>
        <div className="space-y-2 mb-4 text-sm">
            {renderEditableField(asset, 'title')}
            <p><strong>Kind:</strong> {asset.kind}</p>
            <p><strong>ID:</strong> {asset.id}</p>
            {asset.source_metadata?.filename && <p><strong>Filename:</strong> {String(asset.source_metadata.filename)}</p>}
            {renderEditableField(asset, 'event_timestamp')}
        </div>
        <div className="flex-1 bg-background rounded overflow-hidden flex items-center justify-center">
            {asset.blob_path && <AuthenticatedVideo blobPath={asset.blob_path} className="max-w-full max-h-96" />}
        </div>
        </div>
      );

const AudioAssetContent = ({ asset, renderEditableField, AuthenticatedAudio }: { asset: AssetRead, renderEditableField: any, AuthenticatedAudio: any }) => (
    <div className="p-4 bg-muted/30 h-full flex flex-col">
        <h3 className="text-lg font-semibold mb-3 flex items-center"><Music className="h-5 w-5 mr-2 text-primary" />Audio Asset</h3>
        <div className="space-y-2 mb-4 text-sm flex-grow">
            {renderEditableField(asset, 'title')}
            <p><strong>Kind:</strong> {asset.kind}</p>
            <p><strong>ID:</strong> {asset.id}</p>
            <p><strong>Filename:</strong> {String(asset.source_metadata?.filename)}</p>
            {renderEditableField(asset, 'event_timestamp')}
        </div>
        <div className="bg-background rounded p-6 flex items-center justify-center">
            {asset.blob_path && <AuthenticatedAudio blobPath={asset.blob_path} className="w-full max-w-md" />}
        </div>
        </div>
      );

const WebContent = ({ asset, renderEditableField, renderTextDisplay, hasChildren, childAssets, setActiveTab, handleChildAssetClick, AuthenticatedImage }: { asset: AssetRead, renderEditableField: any, renderTextDisplay: any, hasChildren: boolean, childAssets: AssetRead[], setActiveTab: any, handleChildAssetClick: any, AuthenticatedImage: any }) => {
  // Add state for featured image swapping
  const [currentFeaturedImage, setCurrentFeaturedImage] = React.useState<AssetRead | null>(null);

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
    child.source_metadata?.image_role === 'featured'
  );
  
  // Use current featured image or fall back to original
  const featuredImage = currentFeaturedImage || originalFeaturedImage;
  
  const contentImages = nonGifChildAssets.filter(child => 
    child.kind === 'image' && 
    child.source_metadata?.image_role === 'content' &&
    child.id !== featuredImage?.id // Exclude the currently featured image
  ).sort((a, b) => (a.part_index || 0) - (b.part_index || 0));

  // Function to swap images
  const handleImageSwap = (newFeaturedImage: AssetRead) => {
    setCurrentFeaturedImage(newFeaturedImage);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Article Header */}
      <div className="flex-none px-8 pb-6 bg-background">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
          <Globe className="h-4 w-4" />
          <span>Article</span>
          {asset.event_timestamp && (
            <>
              <span>•</span>
              <span>{format(new Date(asset.event_timestamp), "PPP")}</span>
            </>
          )}
        </div>
        
        <h1 className="text-2xl font-bold leading-tight mb-4 text-foreground">
          {asset.title || 'Untitled Article'}
        </h1>
        
        {asset.source_identifier && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Source:</span>
            <a 
              href={asset.source_identifier} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-primary hover:underline flex items-center gap-1"
            >
              {new URL(asset.source_identifier).hostname}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
        
        {/* Summary if available */}
        {asset.source_metadata?.summary && typeof asset.source_metadata.summary === 'string' ? (
          <div className="mt-4 p-3 bg-muted/30 rounded-lg border-l-4 border-primary">
            <p className="text-sm text-muted-foreground italic">
              {asset.source_metadata.summary}
            </p>
          </div>
        ) : null}
      </div>

      {/* Article Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          
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
          {asset.text_content && (
            <div className="prose prose-gray max-w-none">
              <div className="text-base leading-relaxed text-foreground whitespace-pre-wrap">
                {asset.text_content}
              </div>
            </div>
          )}

          {/* Article Metadata */}
          <div className="mt-8 pt-6 border-t">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              
              {/* Basic Info */}
              <div className="space-y-2">
                <h4 className="font-semibold text-muted-foreground">Article Info</h4>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <strong className="w-20 shrink-0">ID:</strong>
                    <span className="font-mono text-xs">{asset.id}</span>
                  </div>
                  {asset.source_metadata?.content_length && typeof asset.source_metadata.content_length === 'number' ? (
                    <div className="flex items-center gap-2">
                      <strong className="w-20 shrink-0">Length:</strong>
                      <span>{asset.source_metadata.content_length.toLocaleString()} characters</span>
                    </div>
                  ) : null}
                  {asset.source_metadata?.scraped_at && typeof asset.source_metadata.scraped_at === 'string' ? (
                    <div className="flex items-center gap-2">
                      <strong className="w-20 shrink-0">Scraped:</strong>
                      <span>{formatDistanceToNow(new Date(asset.source_metadata.scraped_at), { addSuffix: true })}</span>
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
            {asset.source_metadata && Object.keys(asset.source_metadata).length > 0 && (
              <Collapsible className="mt-4">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between p-0">
                    <span className="text-xs font-semibold text-muted-foreground">Advanced Metadata</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="text-xs bg-muted/50 p-3 rounded overflow-auto max-h-40 mt-2">
                    {JSON.stringify(asset.source_metadata, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const CsvOverviewContent = ({ asset, renderEditableField, AuthenticatedCSV, hasChildren, childAssets, isReprocessing, handleReprocessAsset, setIsReprocessDialogOpen, setSelectedChildAsset, isLoadingChildren, childrenError, isHierarchicalAsset, refreshTrigger, fetchChildren, renderTextDisplay, setActiveTab }: any) => {
    const handleRowSelect = (childAsset: AssetRead) => {
      setSelectedChildAsset(childAsset);
      setActiveTab('children');
    };

    return (
      <div className="p-4 bg-muted/30 h-full flex flex-col">
          <h3 className="text-lg font-semibold mb-3 flex items-center"><FileSpreadsheet className="h-5 w-5 mr-2 text-primary" />CSV File Overview</h3>
          <div className="space-y-2 mb-4 text-sm">
              {renderEditableField(asset, 'title')}
              <p><strong>Kind:</strong> {asset.kind}</p>
              <p><strong>ID:</strong> {asset.id}</p>
              <p><strong>Filename:</strong> {String(asset.source_metadata?.filename)}</p>
              <p><strong>Total Rows:</strong> {String(asset.source_metadata?.row_count)}</p>
              {asset.blob_path && <p><strong>File Path:</strong> {asset.blob_path}</p>}
              {renderEditableField(asset, 'event_timestamp')}
          </div>
          {asset.blob_path && typeof asset.blob_path === 'string' ? (
              <div className="flex-1 bg-background rounded overflow-hidden">
                  <AuthenticatedCSV 
                    blobPath={asset.blob_path} 
                    title={asset.title || 'CSV File'} 
                    className="w-full h-full border-0"
                    childAssets={childAssets}
                    onRowClick={handleRowSelect}
                  />
              </div>
          ) : (
              <div className="flex-1 bg-background rounded overflow-hidden flex items-center justify-center text-muted-foreground">
                  <FileSpreadsheet className="h-12 w-12 mb-2" />
                  <div className="text-center"><p>No CSV file content available</p><p className="text-xs">Content may be available in individual row assets</p></div>
              </div>
          )}
          {hasChildren && (
              <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-xs"><FileSpreadsheet className="h-3 w-3 mr-1" />{childAssets.length} CSV Rows</Badge>
                      <div className="flex gap-2">
                          <Button variant="default" size="sm" onClick={() => handleReprocessAsset(false)} disabled={isReprocessing} className="h-7 px-3">{isReprocessing ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Auto-Processing...</> : <><RefreshCw className="h-3 w-3 mr-1" />Auto Reprocess</>}</Button>
                          <Button variant="outline" size="sm" onClick={() => setIsReprocessDialogOpen(true)} disabled={isReprocessing} className="h-7 px-3"><Settings className="h-3 w-3 mr-1" />Custom Options</Button>
                      </div>
                  </div>
                  <div className="space-y-1">
                      <h4 className="text-sm font-medium">Sample Rows:</h4>
                      {childAssets.slice(0, 3).map((childAsset: AssetRead, index: number) => (
                          <div key={childAsset.id} className="rounded p-2 hover:bg-muted/50 cursor-pointer text-xs" onClick={() => { handleRowSelect(childAsset); }}>
                              <div className="flex items-center gap-2">
                                  <span className="font-semibold">Row {index + 1}:</span>
                                  {childAsset.text_content && <span className="truncate text-muted-foreground">{childAsset.text_content.substring(0, 100)}...</span>}
                              </div>
                          </div>
                      ))}
                      {childAssets.length > 3 && <div className="text-xs text-muted-foreground">+{childAssets.length - 3} more rows (view in Rows tab)</div>}
                  </div>
              </div>
          )}
          {!hasChildren && asset.kind === 'csv' && (
            <div className="mt-4 p-3 bg-yellow-50 border-yellow-200 rounded">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <h4 className="text-sm font-medium text-yellow-800">No CSV rows found</h4>
              </div>
              <div className="text-xs text-yellow-700 space-y-1">
                <p>This CSV file has no child row assets. This usually means:</p>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li>Wrong delimiter detected (your CSV uses semicolons ";" but commas "," were expected)</li>
                  <li>The header row is not at the expected position</li>
                  <li>Processing failed during initial upload</li>
                </ul>
                <div className="mt-3 p-2 bg-yellow-100 border-yellow-300 rounded text-xs">
                  <div className="font-semibold mb-1">Debug Info:</div>
                  <div>Child assets array length: {childAssets.length}</div>
                  <div>Is loading children: {isLoadingChildren ? 'Yes' : 'No'}</div>
                  <div>Children error: {childrenError || 'None'}</div>
                  <div>Has children computed: {hasChildren ? 'Yes' : 'No'}</div>
                  <div>Is hierarchical asset: {isHierarchicalAsset ? 'Yes' : 'No'}</div>
                  <div>Asset ID: {asset.id}</div>
                  <div>Active tab: {activeTab}</div>
                  <div>Refresh trigger: {refreshTrigger}</div>
                  <button onClick={() => { console.log('=== DEBUG STATE ==='); console.log('childAssets:', childAssets); console.log('hasChildren:', hasChildren); console.log('isLoadingChildren:', isLoadingChildren); console.log('childrenError:', childrenError); console.log('isHierarchicalAsset:', isHierarchicalAsset); console.log('refreshTrigger:', refreshTrigger); fetchChildren(asset.id, asset); }} className="mt-2 px-2 py-1 bg-blue-100 border-blue-300 rounded hover:bg-blue-200 text-blue-800">🔍 Debug & Refetch</button>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={() => handleReprocessAsset(false)} disabled={isReprocessing} className="h-7 px-2 text-xs bg-blue-100 border-blue-300 hover:bg-blue-200">{isReprocessing ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Processing...</> : <><RefreshCw className="h-3 w-3 mr-1" />Auto Reprocess</>}</Button>
                  <Button variant="outline" size="sm" onClick={() => setIsReprocessDialogOpen(true)} disabled={isReprocessing} className="h-7 px-2 text-xs bg-orange-100 border-orange-300 hover:bg-orange-200"><Settings className="h-3 w-3 mr-1" />Custom Options</Button>
                </div>
              </div>
            </div>
          )}
          {asset.source_metadata && Object.keys(asset.source_metadata).length > 0 && (
              <div className="mt-3 pt-3 border-t">
                  <h4 className="text-xs font-semibold mb-1.5 text-muted-foreground">File Metadata</h4>
                  <pre className="text-xs bg-background p-2 rounded overflow-auto max-h-32">{JSON.stringify(asset.source_metadata, null, 2)}</pre>
              </div>
          )}
      </div>
    );
};

const DefaultAssetContent = ({ asset, renderEditableField, renderTextDisplay }: { asset: AssetRead, renderEditableField: any, renderTextDisplay: any }) => (
    <div className="p-4 bg-muted/30 h-full flex flex-col">
        <h3 className="text-lg font-semibold mb-3 flex items-center"><FileText className="h-5 w-5 mr-2 text-primary" />Asset Details</h3>
        <div className="space-y-2 mb-4 text-sm flex-grow">
            {renderEditableField(asset, 'title')}
            <p><strong>Kind:</strong> {asset.kind}</p>
            <p><strong>ID:</strong> {asset.id}</p>
            <p><strong>UUID:</strong> {asset.uuid}</p>
            {asset.source_identifier && <p><strong>Source ID:</strong> {asset.source_identifier}</p>}
            {asset.blob_path && <p><strong>Blob Path:</strong> {asset.blob_path}</p>}
            {renderEditableField(asset, 'event_timestamp')}
            {asset.text_content && (
                <div className="mt-3 pt-3 border-t">
                    <h4 className="text-xs font-semibold mb-1.5 text-muted-foreground">Text Content</h4>
                    {renderTextDisplay(asset.text_content)}
                </div>
            )}
            {asset.source_metadata && Object.keys(asset.source_metadata).length > 0 && (
                <div className="mt-3 pt-3 border-t">
                    <h4 className="text-xs font-semibold mb-1.5 text-muted-foreground">Source Metadata</h4>
                    <pre className="text-xs bg-background p-2 rounded overflow-auto max-h-32">{JSON.stringify(asset.source_metadata, null, 2)}</pre>
                </div>
            )}
        </div>
    </div>
);

  // --- Render functions ---
  const renderContent = () => {
    if (!asset) {
      return <div className="p-4 text-center text-muted-foreground">Asset details not loaded.</div>;
    }

    // Check if we should use a specialized full-view component instead of inline content
    const useSpecializedView = (kind: string) => {
      // Use specialized components for complex assets or when they provide better UX
      // For now, we will render overview content in the 'content' tab for all assets,
      // and use the 'children' tab for detailed child asset views.
      return false;
    };

    // Use specialized full-view components for better experience
    if (useSpecializedView(asset.kind)) {
      switch (asset.kind) {
        // This block is now unused due to useSpecializedView returning false,
        // but kept for potential future use.
        case 'csv':
          return (
            <AssetDetailViewCsv
              asset={asset}
              childAssets={childAssets}
              isLoadingChildren={isLoadingChildren}
              childrenError={childrenError}
              onChildAssetSelect={setSelectedChildAsset}
              selectedChildAsset={selectedChildAsset}
              highlightedAssetId={highlightAssetIdOnOpen}
            />
          );
        default:
          break;
      }
    }

    // Use inline content renderers for simpler asset types
    const rendererProps = {
      asset,
      renderEditableField,
      AuthenticatedImage,
      AuthenticatedPDF,
      AuthenticatedVideo,
      AuthenticatedAudio,
      AuthenticatedCSV,
      hasChildren,
      childAssets,
      setActiveTab,
      handleChildAssetClick,
      isReprocessing,
      handleReprocessAsset,
      setIsReprocessDialogOpen,
      setSelectedChildAsset,
      isLoadingChildren,
      childrenError,
      isHierarchicalAsset,
      refreshTrigger,
      fetchChildren,
      renderTextDisplay,
    };

    switch (asset.kind) {
      case 'article':
        return <ArticleAssetContent {...rendererProps} />;
      case 'image':
        return <ImageAssetContent {...rendererProps} />;
      case 'pdf':
        return <PdfAssetContent {...rendererProps} />;
      case 'video':
        return <VideoAssetContent {...rendererProps} />;
      case 'audio':
        return <AudioAssetContent {...rendererProps} />;
      case 'web':
        return <WebContent {...rendererProps} />;
      case 'csv':
        return <CsvOverviewContent {...rendererProps} />;
      default:
        return <DefaultAssetContent {...rendererProps} />;
    }
  };

  const renderChildAssets = () => {
    if (isLoadingChildren) {
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
                        {formatDistanceToNow(new Date(imageAsset.created_at), { addSuffix: true })}
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
                  {selectedChildAsset.source_metadata && Object.keys(selectedChildAsset.source_metadata).length > 0 && (
                    <div className="md:col-span-2">
                      <strong>Metadata:</strong>
                      <pre className="text-xs bg-muted/50 p-2 rounded mt-1 overflow-auto max-h-32">
                        {JSON.stringify(selectedChildAsset.source_metadata, null, 2)}
                      </pre>
                    </div>
                  )}
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
                              <span>Created: {formatDistanceToNow(new Date(childAsset.created_at), { addSuffix: true })}</span>
                            )}
                          </div>
                          {childAsset.text_content && (
                            <p className="text-xs text-muted-foreground mt-2 truncate">
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
                        <span>Created: {formatDistanceToNow(new Date(childAsset.created_at), { addSuffix: true })}</span>
                      )}
                    </div>
                    {childAsset.text_content && (
                      <p className="text-xs text-muted-foreground mt-2 truncate">
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
                        <ScrollArea className="h-24 mt-1 p-2 bg-muted/50 rounded text-xs">
                          {childAsset.text_content}
        </ScrollArea>
                      </div>
                    )}
                    
                    {childAsset.source_metadata && Object.keys(childAsset.source_metadata).length > 0 && (
                      <div className="mt-2">
                        <strong className="text-xs">Metadata:</strong>
                        <pre className="text-xs bg-muted/50 p-2 rounded overflow-auto max-h-20 mt-1">
                          {JSON.stringify(childAsset.source_metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="asset-detail-view w-full h-full flex flex-col">
      {isLoadingAsset ? (
        <div className="flex items-center justify-center h-full">
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
          {/* Top Section: Header/Metadata */}
          <div className="flex-none p-4 border-b">
            <div className="flex justify-between items-start mb-1">
              <h2 className="text-lg font-semibold">{asset.title || `Asset ${asset.id}`}</h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <Badge variant="outline" className="capitalize">{asset.kind}</Badge>
              <span>ID: {asset.id}</span>
              {hasChildren && (
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  <Layers className="h-3 w-3 mr-1" />
                  {childAssets.length} child assets
                </Badge>
              )}
              {asset.created_at && (
                <span>Created: {format(new Date(asset.created_at), "PP")}</span>
              )}
              {asset.updated_at && (
                <span>Updated: {formatDistanceToNow(new Date(asset.updated_at), { addSuffix: true })}</span>
              )}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'content' | 'children')} className="w-full h-full flex flex-col">
              <TabsList className={cn(
                "grid w-full flex-none sticky top-0 bg-background z-10 px-4 pt-2 mb-1",
                isHierarchicalAsset && hasChildren ? "grid-cols-2" : "grid-cols-1"
              )}>
                <TabsTrigger value="content">
                  {(() => {
                    const useSpecializedView = asset?.kind === 'csv';
                    if (useSpecializedView) {
                      return 'CSV Data';
                    }
                    
                    switch (asset?.kind) {
                      case 'csv': return 'CSV Overview';
                      case 'article': return 'Article Overview';
                      case 'image': return 'Image View';
                      case 'video': return 'Video Player';
                      case 'audio': return 'Audio Player';
                      case 'web': return 'Article';
                      default: return 'Asset Content';
                    }
                  })()}
                </TabsTrigger>
                {isHierarchicalAsset && hasChildren && (
                  <TabsTrigger value="children" className="flex items-center gap-2">
                    <TableIcon className="h-4 w-4" />
                    {(() => {
                      switch (asset?.kind) {
                        case 'csv': return `CSV Rows (${childAssets.length})`;
                        case 'pdf': return `PDF Pages (${childAssets.length})`;
                        case 'article': return `Related Assets (${childAssets.length})`;
                        case 'mbox': return `Emails (${childAssets.length})`;
                        case 'web': {
                          // For web assets, show filtered image count
                          const imageCount = childAssets.filter(child => {
                            if (child.kind !== 'image') return false;
                            const isGif = (url: string) => url.toLowerCase().includes('.gif');
                            if (child.source_identifier && isGif(child.source_identifier)) return false;
                            if (child.blob_path && isGif(child.blob_path)) return false;
                            return true;
                          }).length;
                          return `Images (${imageCount})`;
                        }
                        default: return `Child Assets (${childAssets.length})`;
                      }
                    })()}
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="content" className="flex-1 min-h-0 overflow-y-auto p-4">
                {renderContent()}
              </TabsContent>

              {isHierarchicalAsset && hasChildren && (
                <TabsContent value="children" className="flex-1 min-h-0 overflow-y-auto p-4">
                  {asset.kind === 'csv' ? (
                    <AssetDetailViewCsv
                      asset={asset}
                      childAssets={childAssets}
                      isLoadingChildren={isLoadingChildren}
                      childrenError={childrenError}
                      onChildAssetSelect={handleChildAssetClick}
                      selectedChildAsset={selectedChildAsset}
                      highlightedAssetId={highlightAssetIdOnOpen}
                    />
                  ) : (
                    renderChildAssets()
                  )}
                </TabsContent>
              )}
            </Tabs>
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
    }

export default AssetDetailView;