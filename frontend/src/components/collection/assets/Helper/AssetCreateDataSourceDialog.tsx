'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { AssetKind } from '@/client/';
import {
    Loader2, UploadCloud, Link as LinkIcon, FileText, X, FileSpreadsheet,
    List, Type, Undo2, RefreshCw, Image as ImageIcon, Video, Music, Mail,
    FileUp, Plus, Trash2, Globe, CheckCircle, Clock, Upload, ExternalLink, Rss, Search
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertTriangle } from "lucide-react"
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { AssetRead } from '@/client/';
import RssFeedBrowser from '../RssFeedBrowser';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsMobile } from '@/hooks/use-mobile';


interface CreateAssetDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'individual' | 'bundle';
  initialFocus?: 'file' | 'url' | 'text';
  existingBundleId?: number;
  existingBundleName?: string;
}

interface BundleItem {
  id: string;
  type: 'file' | 'url' | 'text';
  kind: AssetKind;
  title: string;
  file?: File;
  url?: string;
  textContent?: string;
  status?: 'pending' | 'uploading' | 'processing' | 'complete' | 'error';
  progress?: number;
  error?: string;
}

interface UploadProgress {
  phase: 'preparing' | 'uploading' | 'processing' | 'complete' | 'error';
  message: string;
  progress: number;
  currentItem?: string;
  totalItems: number;
  completedItems: number;
  errors?: { item: string; error: string }[];
  backgroundTasks?: Array<{
    id: string;
    status: 'pending' | 'processing' | 'success' | 'failed';
    progress?: number;
    result?: any;
  }>;
}

const assetKinds: { value: AssetKind; label: string; description: string; icon: React.ElementType, group: 'file' | 'web' | 'text' }[] = [
  { value: 'pdf', label: 'PDF', description: 'Upload PDF documents.', icon: FileText, group: 'file' },
  { value: 'csv', label: 'CSV', description: 'Upload CSV files.', icon: FileSpreadsheet, group: 'file' },
  { value: 'image', label: 'Image(s)', description: 'Upload JPG, PNG, GIF files.', icon: ImageIcon, group: 'file' },
  { value: 'video', label: 'Video(s)', description: 'Upload MP4, MOV, AVI files.', icon: Video, group: 'file' },
  { value: 'audio', label: 'Audio(s)', description: 'Upload MP3, WAV, M4A files.', icon: Music, group: 'file' },
  { value: 'mbox', label: 'Email Box', description: 'Upload .mbox email archives.', icon: Mail, group: 'file' },
  { value: 'web', label: 'Web URL(s)', description: 'Scrape content from web pages.', icon: LinkIcon, group: 'web' },
  { value: 'text', label: 'Text Block', description: 'Paste or type raw text.', icon: Type, group: 'text' },
  { value: 'article', label: 'Article', description: 'Create an article container with related assets.', icon: FileText, group: 'text' },
];

const getAcceptString = (kind: AssetKind | null): string => {
    switch(kind) {
        case 'pdf': return '.pdf';
        case 'csv': return '.csv, text/csv';
        case 'image': return 'image/*';
        case 'video': return 'video/*';
        case 'audio': return 'audio/*';
        case 'mbox': return '.mbox';
        default: return '*/*';
    }
}

const getKindFromFile = (file: File): AssetKind => {
  const mimeType = file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase();
  
  if (mimeType.includes('pdf') || extension === 'pdf') return 'pdf';
  if (mimeType.includes('csv') || extension === 'csv') return 'csv';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (extension === 'mbox') return 'mbox';
  
  return 'text'; // Default fallback
};

const getItemIcon = (item: BundleItem) => {
  const kindInfo = assetKinds.find(k => k.value === item.kind);
  return kindInfo?.icon || FileText;
};

const getStatusIcon = (status?: string) => {
  switch (status) {
    case 'complete':
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    case 'uploading':
    case 'processing':
      return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
    case 'error':
      return <AlertTriangle className="h-4 w-4 text-red-600" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
};

const getStatusColor = (status?: string) => {
  switch (status) {
    case 'complete':
      return 'bg-green-100 border-green-200 text-green-800';
    case 'uploading':
    case 'processing':
      return 'bg-blue-100 border-blue-200 text-blue-800';
    case 'error':
      return 'bg-red-100 border-red-200 text-red-800';
    default:
      return 'bg-muted border-muted-foreground/20';
  }
};

export default function CreateAssetDialog({ open, onClose, mode, initialFocus, existingBundleId, existingBundleName }: CreateAssetDialogProps) {
  const { createAsset, isLoading: storeIsLoading, error: storeError, fetchAssets } = useAssetStore();
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles: fetchBundlesFromStore, addAssetToBundle, fetchBundles } = useBundleStore();
  
  const [bundleTitle, setBundleTitle] = useState('');
  const [items, setItems] = useState<BundleItem[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  
  // Destination state
  const [destination, setDestination] = useState<'individual' | 'new_bundle' | 'existing_bundle'>(mode === 'individual' ? 'individual' : (existingBundleId ? 'existing_bundle' : 'new_bundle'));
  const [selectedBundleId, setSelectedBundleId] = useState<number | string | undefined>(existingBundleId);

  // Adding new items state
  const urlInputRef = React.useRef<HTMLInputElement>(null);
  const [newUrl, setNewUrl] = useState('');
  const [newTextContent, setNewTextContent] = useState('');
  const [newTextTitle, setNewTextTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [useBackgroundProcessing, setUseBackgroundProcessing] = useState(false);
  const [backgroundTasks, setBackgroundTasks] = useState<any[]>([]);
  
  // Mobile responsive state
  const isMobile = useIsMobile();

  // Fetch bundles when dialog opens
  useEffect(() => {
    if (open && activeInfospace?.id) {
        fetchBundlesFromStore(activeInfospace.id);
    }
  }, [open, activeInfospace?.id, fetchBundlesFromStore]);

  // Sync state with props on open
  useEffect(() => {
    if (open) {
      const newDestination = mode === 'individual' ? 'individual' : (existingBundleId ? 'existing_bundle' : 'new_bundle');
      setDestination(newDestination);
      setSelectedBundleId(existingBundleId);
      if (mode === 'bundle' && existingBundleId) {
          setBundleTitle(existingBundleName || '');
      } else {
          setBundleTitle('');
      }
    }
  }, [mode, existingBundleId, existingBundleName, open]);

  useEffect(() => {
    if (open && initialFocus === 'url') {
      setTimeout(() => urlInputRef.current?.focus(), 100);
    }
  }, [open, initialFocus]);

  const resetForm = useCallback(() => {
    setBundleTitle('');
    setItems([]);
    setNewUrl('');
    setNewTextContent('');
    setNewTextTitle('');
    setFormError(null);
    setUploadProgress(null);
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setUseBackgroundProcessing(false);
    setBackgroundTasks([]);
    // Reset destination based on initial mode
    setDestination(mode === 'individual' ? 'individual' : (existingBundleId ? 'existing_bundle' : 'new_bundle'));
    setSelectedBundleId(existingBundleId);
  }, [mode, existingBundleId]);

  const handleClose = () => {
    if (uploadProgress && uploadProgress.phase !== 'complete' && uploadProgress.phase !== 'error') {
      // Don't allow closing during upload
      return;
    }
    resetForm();
    onClose();
  };

  const generateItemId = () => `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const handleFileSelect = (files: FileList | null, targetKind?: AssetKind) => {
    if (!files) return;
    
    const newItems: BundleItem[] = Array.from(files).map(file => ({
      id: generateItemId(),
      type: 'file',
      kind: targetKind || getKindFromFile(file),
      title: file.name.replace(/\.[^/.]+$/, ""),
      file,
      status: 'pending'
    }));
    
    setItems(prev => [...prev, ...newItems]);
    setFormError(null);
  };

  const handleAddUrl = () => {
    if (!newUrl.trim()) return;
    
    const newItem: BundleItem = {
      id: generateItemId(),
      type: 'url',
      kind: 'web',
      title: `Web: ${new URL(newUrl).hostname}`,
      url: newUrl.trim(),
      status: 'pending'
    };
    
    setItems(prev => [...prev, newItem]);
    setNewUrl('');
    setFormError(null);
  };

  const handleAddText = () => {
    if (!newTextContent.trim()) return;
    
    const newItem: BundleItem = {
      id: generateItemId(),
      type: 'text',
      kind: 'text',
      title: newTextTitle.trim() || `Text: ${newTextContent.substring(0, 30)}...`,
      textContent: newTextContent.trim(),
      status: 'pending'
    };
    
    setItems(prev => [...prev, newItem]);
    setNewTextContent('');
    setNewTextTitle('');
    setFormError(null);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
        console.log("DEBUG: Sending search query:", searchQuery, "with limit:", 20);
        const { SearchService } = await import('@/client');
        const response = await SearchService.searchContent({ requestBody: { query: searchQuery, limit: 20 as any}, args: {}, kwargs: {}}); 
        setSearchResults(response.results || []);
    } catch (error) {
        console.error("Search failed:", error);
        toast.error("Search failed. Please check the logs.");
    } finally {
        setIsSearching(false);
    }
  };

  const handleAddFromSearch = (result: any) => {
    const newItem: BundleItem = {
      id: generateItemId(),
      type: 'url',
      kind: 'web',
      title: result.title || `Web: ${new URL(result.url).hostname}`,
      url: result.url,
      status: 'pending'
    };
    setItems(prev => [...prev, newItem]);
  }

  const removeItem = (itemId: string) => {
    setItems(prev => prev.filter(item => item.id !== itemId));
  };

  const updateItemTitle = (itemId: string, newTitle: string) => {
    setItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, title: newTitle } : item
    ));
  };

  const updateItemStatus = (itemId: string, status: BundleItem['status'], error?: string, progress?: number) => {
    setItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, status, error, progress } : item
    ));
  };

  const generateBundleTitle = useCallback((items: BundleItem[]) => {
    if (items.length === 0) return '';
    
    // For file uploads, auto-generate a descriptive title
    const fileItems = items.filter(item => item.type === 'file');
    const urlItems = items.filter(item => item.type === 'url');
    const textItems = items.filter(item => item.type === 'text');
    
    if (fileItems.length === items.length) {
      // All files
      if (items.length === 1) {
        return items[0].title;
      } else {
        const kindCounts = items.reduce((acc, item) => {
          acc[item.kind] = (acc[item.kind] || 0) + 1;
          return acc;
        }, {} as Record<AssetKind, number>);
        
        const dominantKind = Object.entries(kindCounts).reduce((a, b) => 
          kindCounts[a[0] as AssetKind] > kindCounts[b[0] as AssetKind] ? a : b
        )[0] as AssetKind;
        
        const kindLabel = assetKinds.find(k => k.value === dominantKind)?.label || dominantKind;
        
        if (Object.keys(kindCounts).length === 1) {
          return `${kindLabel} Collection (${items.length} files)`;
        } else {
          return `Mixed Files Collection (${items.length} files)`;
        }
      }
    } else if (urlItems.length === items.length) {
      // All URLs
      return items.length === 1 ? `Web Article: ${items[0].title}` : `Web Collection (${items.length} URLs)`;
    } else {
      // Mixed content
      return `Mixed Content Collection (${items.length} items)`;
    }
  }, []);

  // Auto-generate bundle title when items change (for file uploads in bundle mode)
  useEffect(() => {
    if (destination === 'new_bundle' && items.length > 0 && !bundleTitle.trim()) {
      const autoTitle = generateBundleTitle(items);
      setBundleTitle(autoTitle);
    }
  }, [items, destination, bundleTitle, generateBundleTitle]);

  const validateForm = (): boolean => {
    setFormError(null);
    if (destination === 'new_bundle' && !bundleTitle.trim() && items.length > 0) {
      // Auto-generate title if empty for bundle mode
      const autoTitle = generateBundleTitle(items);
      setBundleTitle(autoTitle);
    }
    if (destination === 'new_bundle' && !bundleTitle.trim()) {
      setFormError('Please provide a title for the new bundle.');
      return false;
    }
    if (destination === 'existing_bundle' && !selectedBundleId) {
      setFormError('Please select a bundle to add to.');
      return false;
    }
    if (items.length === 0) {
      setFormError('Please add at least one item.');
      return false;
    }
    return true;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateForm()) {
      return;
    }

    if (!activeInfospace?.id) {
      toast.error("No active infospace selected");
      return;
    }

    setFormError(null);

    try {
      // Initialize upload progress
      setUploadProgress({
        phase: 'preparing',
        message: 'Preparing upload...',
        progress: 0,
        totalItems: items.length,
        completedItems: 0
      });

      // Mark all items as uploading
      setItems(prev => prev.map(item => ({ ...item, status: 'uploading' as const })));

      if (destination === 'individual') {
        await handleIndividualModeParallel();
      } else {
        await handleBundleModeParallel();
      }

    } catch (error) {
      console.error("Submission error caught in component:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to create assets";
      
      // Mark all items as error
      setItems(prev => prev.map(item => ({ 
        ...item, 
        status: item.status === 'complete' ? 'complete' : 'error' as const, 
        error: item.status === 'complete' ? undefined : errorMessage 
      })));
      
      setUploadProgress({
        phase: 'error',
        message: errorMessage,
        progress: 0,
        totalItems: items.length,
        completedItems: 0
      });
      
      setFormError(errorMessage);
      toast.error(errorMessage);
    }
  };

  // Parallel processing for individual mode
  const handleIndividualModeParallel = async () => {
    if (!activeInfospace?.id) return;

    setUploadProgress(prev => prev ? {
      ...prev,
      phase: 'uploading',
      message: 'Creating individual assets in parallel...',
      progress: 10
    } : null);

    const { AssetsService, FilestorageService } = await import('@/client/');
    const CONCURRENCY_LIMIT = 5; // Limit concurrent uploads to avoid overwhelming server
    
    // Separate items by type for optimal processing
    const fileItems = items.filter(item => item.type === 'file');
    const urlItems = items.filter(item => item.type === 'url');
    const textItems = items.filter(item => item.type === 'text');
    
    const createdAssets: AssetRead[] = [];
    let completedCount = 0;

        // Use enhanced bulk URL ingestion if multiple URLs (more efficient with newspaper4k)
        if (urlItems.length > 1) {
          try {
            setUploadProgress(prev => prev ? {
              ...prev,
              message: `Bulk processing ${urlItems.length} URLs...`,
              progress: 15
            } : null);

            const urls = urlItems.map(item => item.url!);
            
            // Use bulk ingestion with newspaper4k capabilities
            const bulkUrlAssets = await AssetsService.bulkIngestUrls({
              infospaceId: activeInfospace.id,
              requestBody: { 
                urls,
                base_title: "Bulk URL Collection",
                scrape_immediately: true
              }
            });

            // Update status for all URL items with enhanced feedback
            urlItems.forEach((item, index) => {
              if (bulkUrlAssets[index]) {
                const asset = bulkUrlAssets[index];
                const contentLength = asset.source_metadata?.content_length || 0;
                const imageCount = Array.isArray(asset.source_metadata?.images) ? asset.source_metadata.images.length : 0;
                
                updateItemStatus(
                  item.id, 
                  'complete', 
                  undefined, 
                  100
                );
                
                // Update item title with scraped title if available
                if (asset.title && asset.title !== item.title) {
                  updateItemTitle(item.id, asset.title);
                }
              } else {
                updateItemStatus(item.id, 'error', 'Failed to process URL');
              }
            });

            createdAssets.push(...bulkUrlAssets);
            completedCount += urlItems.length;

            setUploadProgress(prev => prev ? {
              ...prev,
              progress: 30,
              message: `Bulk processing completed for ${urlItems.length} URLs, now processing files...`,
          completedItems: completedCount
        } : null);

      } catch (error) {
        console.error('Bulk URL processing failed:', error);
        // Fall back to individual processing
        urlItems.forEach(item => {
          updateItemStatus(item.id, 'error', 'Bulk processing failed, trying individual...');
        });
      }
    }

    // Process remaining items (files, text, and individual URLs)
    const remainingItems = [
      ...fileItems,
      ...textItems,
      ...(urlItems.length <= 1 ? urlItems : urlItems.filter(item => {
        const status = items.find(i => i.id === item.id)?.status;
        return status !== 'complete';
      }))
    ];

    // Create a semaphore-like function to limit concurrent operations
    const processBatch = async (batch: BundleItem[]) => {
      const batchPromises = batch.map(async (item) => {
        try {
          updateItemStatus(item.id, 'uploading', undefined, 25);
          
          let newAsset: AssetRead | null = null;
          
          if (item.type === 'file' && item.file) {
            // Upload file and create asset directly
            updateItemStatus(item.id, 'uploading', undefined, 40);
            const uploadResponse = await FilestorageService.fileUpload({ 
              formData: { file: item.file }
            });
            updateItemStatus(item.id, 'processing', undefined, 70);
            const assetCreate = {
              title: item.title,
              kind: item.kind,
              blob_path: uploadResponse.object_name,
              source_metadata: { filename: uploadResponse.filename },
            };
            

            const assetResponse = await AssetsService.createAsset({ 
              infospaceId: activeInfospace.id, 
              requestBody: assetCreate 
            });
            newAsset = assetResponse || null;
            
          } else if (item.type === 'url' && item.url) {
            updateItemStatus(item.id, 'processing', undefined, 50);
            const assetCreate = {
              title: item.title,
              kind: 'web' as const,
              source_identifier: item.url,
            };
            
            const assetResponse = await AssetsService.createAsset({ 
              infospaceId: activeInfospace.id, 
              requestBody: assetCreate 
            });
            newAsset = assetResponse;
            
          } else if (item.type === 'text' && item.textContent) {
            updateItemStatus(item.id, 'processing', undefined, 50);
            const assetCreate = {
              title: item.title,
              kind: 'text' as const,
              text_content: item.textContent,
            };
            
            newAsset = await AssetsService.createAsset({ 
              infospaceId: activeInfospace.id, 
              requestBody: assetCreate 
            });
          }
          
          if (newAsset) {
            updateItemStatus(item.id, 'complete', undefined, 100);
            return { success: true, asset: newAsset, item };
          } else {
            throw new Error(`Failed to create asset for ${item.title}`);
          }
          
        } catch (error) {
          console.error(`Error creating asset for item ${item.title}:`, error);
          updateItemStatus(item.id, 'error', error instanceof Error ? error.message : 'Failed to create asset');
          return { success: false, error, item };
        }
      });

      return Promise.allSettled(batchPromises);
    };

    // Process remaining items in batches
    const baseProgress = urlItems.length > 1 ? 30 : 10;
    for (let i = 0; i < remainingItems.length; i += CONCURRENCY_LIMIT) {
      const batch = remainingItems.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await processBatch(batch);
      
      // Process results
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.success && result.value.asset) {
          createdAssets.push(result.value.asset);
        }
        completedCount++;
      });
      
      const progress = baseProgress + (completedCount / items.length) * (90 - baseProgress);
      setUploadProgress(prev => prev ? {
        ...prev,
        progress,
        message: `Created ${completedCount} of ${items.length} assets...`,
        completedItems: completedCount
      } : null);
    }

    if (createdAssets.length === 0) {
      throw new Error("No assets were created successfully");
    }

    setUploadProgress({
      phase: 'complete',
      message: `Successfully created ${createdAssets.length} individual asset(s)`,
      progress: 100,
      totalItems: items.length,
      completedItems: items.length
    });

    // Refresh data after successful upload
    setTimeout(async () => {
      await fetchAssets();
      toast.success(`${createdAssets.length} individual asset(s) created successfully.`);
      handleClose();
    }, 1500);
  };

  // Parallel processing for bundle mode
  const handleBundleModeParallel = async () => {
    if (!activeInfospace?.id) return;

    setUploadProgress(prev => prev ? {
      ...prev,
      phase: 'uploading',
      message: 'Creating bundle and assets in parallel...',
      progress: 10
    } : null);

    // Determine target bundle
    let targetBundleId: number;
    let targetBundleName: string;

    if (destination === 'existing_bundle' && selectedBundleId) {
      targetBundleId = typeof selectedBundleId === 'string' ? parseInt(selectedBundleId, 10) : selectedBundleId;
      const selectedBundle = bundles.find(b => b.id === targetBundleId);
      targetBundleName = selectedBundle?.name || 'Existing Bundle';
    } else {
      // Create the bundle first
      const { BundlesService } = await import('@/client');
            
      const kindCounts = items.reduce((acc, item) => {
        acc[item.kind] = (acc[item.kind] || 0) + 1;
        return acc;
      }, {} as Record<AssetKind, number>);
      
      const dominantKind = Object.entries(kindCounts).reduce((a, b) => 
        kindCounts[a[0] as AssetKind] > kindCounts[b[0] as AssetKind] ? a : b
      )[0] as AssetKind;
      
      const bundleDescription = items.length > 1 ? 
        `Collection containing ${items.length} assets` : 
        `${dominantKind.toUpperCase()} upload`;
      
      const bundleCreate = {
        name: bundleTitle,
        description: bundleDescription,
        purpose: `upload_mixed`,
      };

      const newBundle = await BundlesService.createBundle({
        infospaceId: activeInfospace.id,
        requestBody: bundleCreate
      });

      targetBundleId = newBundle.id;
      targetBundleName = newBundle.name;
      
      setUploadProgress(prev => prev ? {
        ...prev,
        message: `Bundle "${targetBundleName}" created, now creating assets...`,
        progress: 20
      } : null);
    }

    // Create all assets in parallel, then batch-add to bundle
    const { createAsset } = useAssetStore.getState();
    const { addAssetToBundle } = useBundleStore.getState();
    const CONCURRENCY_LIMIT = 5;
    
    const createdAssets: AssetRead[] = [];
    const tempBundlesToCleanup: number[] = [];
    let completedCount = 0;

    // Process asset creation in parallel batches
    const processBatch = async (batch: BundleItem[]) => {
      const batchPromises = batch.map(async (item) => {
        try {
          updateItemStatus(item.id, 'uploading', undefined, 25);
          
          let assetResult: { bundle: any; assets: AssetRead[] } | null = null;
          
          if (item.type === 'file' && item.file) {
            const fileFormData = new FormData();
            fileFormData.append('title', item.title);
            fileFormData.append('kind', item.kind);
            fileFormData.append('files', item.file);
            
            assetResult = await createAsset(fileFormData);
          } else if (item.type === 'url' && item.url) {
            const urlFormData = new FormData();
            urlFormData.append('title', item.title);
            urlFormData.append('kind', 'web');
            urlFormData.append('source_identifier', item.url);
            
            assetResult = await createAsset(urlFormData);
          } else if (item.type === 'text' && item.textContent) {
            const textFormData = new FormData();
            textFormData.append('title', item.title);
            textFormData.append('kind', 'text');
            textFormData.append('text_content', item.textContent);
            
            assetResult = await createAsset(textFormData);
          }
          
          if (assetResult && assetResult.assets && assetResult.assets.length > 0) {
            updateItemStatus(item.id, 'processing', undefined, 75);
            
            // Track temp bundle for cleanup if it's not our target
            if (assetResult.bundle && assetResult.bundle.id !== targetBundleId) {
              tempBundlesToCleanup.push(assetResult.bundle.id);
            }
            
            return { 
              success: true, 
              assets: assetResult.assets, 
              tempBundleId: assetResult.bundle?.id,
              item 
            };
          } else {
            throw new Error(`Failed to create asset for ${item.title}`);
          }
          
        } catch (error) {
          console.error(`Error creating asset for item ${item.title}:`, error);
          updateItemStatus(item.id, 'error', error instanceof Error ? error.message : 'Failed to create asset');
          return { success: false, error, item };
        }
      });

      return Promise.allSettled(batchPromises);
    };

    // Process asset creation in batches
    const allAssetResults: { success: boolean; assets?: AssetRead[]; item: BundleItem }[] = [];
    
    for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
      const batch = items.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await processBatch(batch);
      
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          allAssetResults.push(result.value);
          if (result.value.success && result.value.assets) {
            createdAssets.push(...result.value.assets);
          }
        }
        completedCount++;
      });
      
      const progress = 20 + (completedCount / items.length) * 50; // 20-70% for creation
      setUploadProgress(prev => prev ? {
        ...prev,
        progress,
        message: `Created ${completedCount} of ${items.length} assets...`,
        completedItems: completedCount
      } : null);
    }

    if (createdAssets.length === 0) {
      throw new Error("No assets were created successfully");
    }

    // Now batch-add all assets to target bundle in parallel
    setUploadProgress(prev => prev ? {
      ...prev,
      progress: 70,
      message: `Adding ${createdAssets.length} assets to "${targetBundleName}"...`,
    } : null);

    const bundleAddPromises = createdAssets.map(asset => 
      addAssetToBundle(targetBundleId, asset.id).catch(error => {
        console.error(`Failed to add asset ${asset.id} to bundle:`, error);
        return null;
      })
    );

    await Promise.allSettled(bundleAddPromises);

    // Cleanup temp bundles in parallel
    if (tempBundlesToCleanup.length > 0) {
      setUploadProgress(prev => prev ? {
        ...prev,
        progress: 85,
        message: 'Cleaning up temporary bundles...',
      } : null);

      const { BundlesService } = await import('@/client/sdk.gen');
      const cleanupPromises = [...new Set(tempBundlesToCleanup)].map(bundleId => 
        BundlesService.deleteBundle({ bundleId }).catch(error => {
          console.warn('Could not clean up auto-created bundle:', error);
        })
      );
      
      await Promise.allSettled(cleanupPromises);
    }

    // Mark successful items as complete
    allAssetResults.forEach(result => {
      if (result.success) {
        updateItemStatus(result.item.id, 'complete', undefined, 100);
      }
    });
    
    setUploadProgress({
      phase: 'complete',
      message: `Successfully added ${createdAssets.length} asset(s) to "${targetBundleName}"`,
      progress: 100,
      totalItems: items.length,
      completedItems: items.length
    });

    // Refresh data after successful upload
    setTimeout(async () => {
      const { fetchBundles } = useBundleStore.getState();
      await Promise.allSettled([
        fetchAssets(),
        fetchBundles(activeInfospace.id)
      ]);
      
      toast.success(`${createdAssets.length} asset(s) added to "${targetBundleName}".`);
      handleClose();
    }, 1500);
  };

  // Background task tracking
  const pollTaskStatus = useCallback(async (taskIds: string[]) => {
    if (taskIds.length === 0) return;
    
    try {
      // This would be a new API endpoint to check task status
      const response = await fetch(`/api/tasks/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_ids: taskIds })
      });
      
      if (response.ok) {
        const taskStatuses = await response.json();
        setBackgroundTasks(taskStatuses);
        
        // Update upload progress based on task statuses
        const completedTasks = taskStatuses.filter((t: any) => t.status === 'success' || t.status === 'failed');
        const failedTasks = taskStatuses.filter((t: any) => t.status === 'failed');
        
        setUploadProgress(prev => prev ? {
          ...prev,
          completedItems: completedTasks.length,
          errors: failedTasks.map((t: any) => ({ item: t.filename || t.id, error: t.error || 'Processing failed' }))
        } : null);
        
        // Stop polling when all tasks are complete
        if (completedTasks.length === taskStatuses.length) {
          setUseBackgroundProcessing(false);
          if (failedTasks.length === 0) {
            toast.success(`All ${taskStatuses.length} items processed successfully`);
            onClose();
          } else {
            toast.warning(`${completedTasks.length - failedTasks.length}/${taskStatuses.length} items processed successfully`);
          }
        }
      }
    } catch (error) {
      console.error('Failed to poll task status:', error);
    }
  }, [onClose]);

  // Poll task status when background tasks are active
  useEffect(() => {
    if (backgroundTasks.length === 0 || !useBackgroundProcessing) return;
    
    const taskIds = backgroundTasks.map(t => t.id);
    const interval = setInterval(() => {
      pollTaskStatus(taskIds);
    }, 2000); // Poll every 2 seconds
    
    return () => clearInterval(interval);
  }, [backgroundTasks, useBackgroundProcessing, pollTaskStatus]);

  const renderFileDropZone = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileUp className="h-4 w-4" />
          Add Files
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div 
          className={cn(
            "relative border-2 border-dashed border-muted-foreground/30 rounded-lg p-4 text-center cursor-pointer hover:border-primary transition-colors",
            uploadProgress && "pointer-events-none opacity-50"
          )}
          onClick={() => !uploadProgress && document.getElementById('file-upload')?.click()}
        >
          <FileUp className="mx-auto h-8 w-8 text-muted-foreground/70" />
          <p className="mt-2 text-sm text-muted-foreground">Click to browse or drag & drop</p>
          <p className="text-xs text-muted-foreground">Select multiple files at once • Any file type supported</p>
          <Input
            id="file-upload"
            type="file"
            onChange={(e) => handleFileSelect(e.target.files)}
            disabled={storeIsLoading || !!uploadProgress}
            multiple
            className="sr-only"
          />
        </div>
        
        <div className={cn(
          "grid gap-2",
          isMobile ? "grid-cols-2" : "grid-cols-3"
        )}>
          {assetKinds.filter(k => k.group === 'file').map((kind) => {
            const Icon = kind.icon;
            return (
              <Button
                key={kind.value}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (uploadProgress) return;
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = getAcceptString(kind.value);
                  input.multiple = true;
                  input.onchange = (e) => handleFileSelect((e.target as HTMLInputElement).files, kind.value);
                  input.click();
                }}
                disabled={!!uploadProgress}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 p-2",
                  isMobile ? "h-12" : "h-16"
                )}
              >
                <Icon className={cn(isMobile ? "h-3 w-3" : "h-4 w-4")} />
                <span className={cn(isMobile ? "text-xs" : "text-xs")}>{kind.label}</span>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );

  const renderUrlInput = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Add Web URLs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            ref={urlInputRef}
            placeholder="https://example.com"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            disabled={storeIsLoading || !!uploadProgress}
            className="flex-1"
            onKeyPress={(e) => e.key === 'Enter' && !uploadProgress && handleAddUrl()}
          />
          <Button 
            type="button" 
            onClick={handleAddUrl} 
            disabled={!newUrl.trim() || storeIsLoading || !!uploadProgress}
            size="sm"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderTextInput = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Type className="h-4 w-4" />
          Add Text Content
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          placeholder="Text block title"
          value={newTextTitle}
          onChange={(e) => setNewTextTitle(e.target.value)}
          disabled={storeIsLoading || !!uploadProgress}
        />
        <Textarea
          placeholder="Paste your text content here..."
          value={newTextContent}
          onChange={(e) => setNewTextContent(e.target.value)}
          rows={4}
          disabled={storeIsLoading || !!uploadProgress}
        />
        <Button 
          type="button" 
          onClick={handleAddText} 
          disabled={!newTextContent.trim() || storeIsLoading || !!uploadProgress}
          size="sm"
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Text Block
        </Button>
      </CardContent>
    </Card>
  );

  const renderRssBrowser = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Rss className="h-4 w-4" />
          Browse RSS Feeds
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Browse RSS feeds and select articles to ingest
        </p>
        <RssFeedBrowser
          onSelectArticle={(url, title) => {
            setNewUrl(url);
            handleAddUrl();
          }}
          onIngestArticle={(url, title) => {
            setNewUrl(url);
            handleAddUrl();
          }}
          destination={destination}
          selectedBundleId={selectedBundleId}
          bundleTitle={bundleTitle}
          trigger={
            <Button 
              type="button" 
              variant="outline"
              disabled={storeIsLoading || !!uploadProgress}
              size="sm"
              className="w-full"
            >
              <Rss className="h-4 w-4 mr-2" />
              Browse RSS
            </Button>
          }
        />
      </CardContent>
    </Card>
  );

  const renderSearchInput = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Search className="h-4 w-4" />
          Search & Add
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Search for articles, events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={storeIsLoading || !!uploadProgress || isSearching}
            className="flex-1"
            onKeyPress={(e) => e.key === 'Enter' && !isSearching && handleSearch()}
          />
          <Button 
            type="button" 
            onClick={handleSearch} 
            disabled={!searchQuery.trim() || storeIsLoading || !!uploadProgress || isSearching}
            size="sm"
          >
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
        {searchResults.length > 0 && (
            <ScrollArea className="h-48 border rounded-md p-2">
                <div className="space-y-2">
                    {searchResults.map((result, index) => (
                        <div key={index} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate" title={result.title}>{result.title}</p>
                                <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary truncate flex items-center gap-1">
                                    {result.url} <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                            <Button type="button" size="sm" variant="outline" onClick={() => handleAddFromSearch(result)}>
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        )}
      </CardContent>
    </Card>
  );

  const renderItemsList = () => {
    if (items.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>No items added yet</p>
          <p className="text-sm">Add files, URLs, or text content above</p>
        </div>
      );
    }

    return (
      <ScrollArea className={cn("pr-4", isMobile ? "h-48" : "h-64")}>
        <div className="space-y-2">
          {items.map((item) => {
            const Icon = getItemIcon(item);
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-2 border rounded-lg transition-colors",
                  isMobile ? "p-2" : "p-3 gap-3",
                  getStatusColor(item.status)
                )}
              >
                <div className="flex items-center gap-2">
                  {getStatusIcon(item.status)}
                  <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
                <div className="flex-1 min-w-0">
                  <Input
                    value={item.title}
                    onChange={(e) => updateItemTitle(item.id, e.target.value)}
                    disabled={storeIsLoading || !!uploadProgress}
                    className={cn("text-sm", isMobile ? "h-6 text-xs" : "h-7")}
                  />
                  <div className={cn("flex items-center gap-2 mt-1", isMobile && "flex-wrap")}>
                    <Badge variant="outline" className={cn(isMobile ? "text-xs px-1" : "text-xs")}>
                      {item.kind}
                    </Badge>
                    {item.type === 'file' && item.file && !isMobile && (
                      <span className="text-xs text-muted-foreground">
                        {(item.file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    )}
                    {item.type === 'url' && (
                      <span className={cn("text-xs text-muted-foreground truncate", isMobile && "max-w-[120px]")}>
                        {item.url}
                      </span>
                    )}
                    {item.status && item.status !== 'pending' && (
                      <Badge variant="outline" className={cn(
                        "text-xs",
                        item.status === 'complete' && "border-green-200 text-green-700",
                        item.status === 'error' && "border-red-200 text-red-700",
                        (item.status === 'uploading' || item.status === 'processing') && "border-blue-200 text-blue-700"
                      )}>
                        {item.status}
                      </Badge>
                    )}
                  </div>
                  {item.progress !== undefined && item.progress > 0 && (
                    <Progress value={item.progress} className="w-full h-1 mt-1" />
                  )}
                  {item.error && (
                    <p className="text-xs text-red-600 mt-1">{item.error}</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeItem(item.id)}
                  disabled={storeIsLoading || !!uploadProgress}
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    );
  };

  const renderUploadProgress = () => {
    if (!uploadProgress) return null;

    return (
      <Card className="border-primary/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            Upload Progress
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            {uploadProgress.phase === 'error' ? (
              <AlertTriangle className="h-4 w-4 text-red-600" />
            ) : uploadProgress.phase === 'complete' ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            )}
            <span className="text-sm font-medium">{uploadProgress.message}</span>
          </div>
          
          <Progress 
            value={uploadProgress.progress} 
            className={cn(
              "w-full h-2",
              uploadProgress.phase === 'error' && "bg-red-100",
              uploadProgress.phase === 'complete' && "bg-green-100"
            )}
          />
          
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{uploadProgress.completedItems} of {uploadProgress.totalItems} items</span>
            <span>{uploadProgress.progress}%</span>
          </div>
        </CardContent>
      </Card>
    );
  };

  const itemTypeCounts = useMemo(() => {
    const counts = items.reduce((acc, item) => {
      acc[item.kind] = (acc[item.kind] || 0) + 1;
      return acc;
    }, {} as Record<AssetKind, number>);
    
    return Object.entries(counts).map(([kind, count]) => ({
      kind: kind as AssetKind,
      count,
      info: assetKinds.find(k => k.value === kind)
    }));
  }, [items]);

  const isUploading = !!uploadProgress && uploadProgress.phase !== 'complete' && uploadProgress.phase !== 'error';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className={cn(
        "max-h-screen overflow-y-auto flex flex-col",
        isMobile ? "w-[95vw] max-w-[95vw] h-[90vh]" : "sm:max-w-4xl"
      )}>
        <DialogHeader>
          <DialogTitle className={cn(isMobile && "text-lg")}>
            {destination === 'existing_bundle'
              ? `Upload to Bundle: ${bundles.find(b => b.id === (typeof selectedBundleId === 'string' ? parseInt(selectedBundleId) : selectedBundleId))?.name || '...'}`
              : destination === 'new_bundle'
                ? 'Create New Bundle'
                : 'Upload & Create Assets'
            }
          </DialogTitle>
          <DialogDescription asChild>
            <div className={cn(isMobile && "text-sm")}>
              {destination === 'existing_bundle'
                ? `Add files, URLs, and text content to the selected bundle.`
                : destination === 'individual'
                  ? 'Upload files, scrape URLs, or create text content. Each item will be processed and saved as a separate asset.'
                  : (
                    <div className="space-y-1">
                      <div>Create a new bundle with multiple files, URLs, and text content.</div>
                      {!isMobile && (
                        <div className="text-xs text-muted-foreground">
                          💡 Tip: Add all related files to one bundle instead of creating separate bundles for each file.
                        </div>
                      )}
                    </div>
                  )
              }
            </div>
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {uploadProgress && renderUploadProgress()}

          {!uploadProgress && (
            <div className={cn(
              "grid gap-4",
              isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2 xl:grid-cols-4"
            )}>
              {renderFileDropZone()}
              {renderUrlInput()}
              {renderTextInput()}
              {renderRssBrowser()}
              {renderSearchInput()}
            </div>
          )}

          <div className="space-y-3 flex-1 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between">
              <Label>
                Items to Upload ({items.length} items)
              </Label>
              {itemTypeCounts.length > 0 && (
                <div className="flex gap-1">
                  {itemTypeCounts.map(({ kind, count, info }) => {
                    const Icon = info?.icon || FileText;
                    return (
                      <Badge key={kind} variant="secondary" className="text-xs">
                        <Icon className="h-3 w-3 mr-1" />
                        {count} {info?.label || kind}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
            
            <div className="border rounded-lg p-4 flex-1 overflow-y-auto">
              {renderItemsList()}
            </div>
          </div>

          {/* Destination Selector */}
          {!uploadProgress && items.length > 0 && (
            <div className="space-y-3 pt-4 border-t">
              <Label className="font-semibold">Destination</Label>
              <RadioGroup value={destination} onValueChange={(value) => setDestination(value as any)} className="space-y-2">
                <div className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50">
                  <RadioGroupItem value="individual" id="dest-individual" />
                  <Label htmlFor="dest-individual" className="font-normal cursor-pointer">
                    Create individual assets
                    <p className="text-xs text-muted-foreground">Each item will be a separate asset in the infospace.</p>
                  </Label>
                </div>
                
                <div className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50">
                  <RadioGroupItem value="new_bundle" id="dest-new" />
                  <Label htmlFor="dest-new" className="font-normal cursor-pointer">
                    Create a new bundle
                    <p className="text-xs text-muted-foreground">Group all items together in a new bundle.</p>
                  </Label>
                </div>
                {destination === 'new_bundle' && (
                  <div className="pl-8 pb-2">
                    <Label htmlFor="bundle-title" className="text-xs font-medium text-muted-foreground">Bundle Title</Label>
                    <Input
                      id="bundle-title"
                      value={bundleTitle}
                      onChange={(e) => setBundleTitle(e.target.value)}
                      placeholder={items.length > 0 ? generateBundleTitle(items) : "e.g., Research Documents Collection"}
                      disabled={storeIsLoading || isUploading}
                      className="mt-1"
                    />
                  </div>
                )}

                <div className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50">
                  <RadioGroupItem value="existing_bundle" id="dest-existing" disabled={!bundles || bundles.length === 0} />
                  <Label htmlFor="dest-existing" className={cn("font-normal cursor-pointer", (!bundles || bundles.length === 0) && "text-muted-foreground cursor-not-allowed")}>
                    Add to existing bundle
                    <p className="text-xs text-muted-foreground">Add all items to a bundle that already exists.</p>
                  </Label>
                </div>
                {destination === 'existing_bundle' && (
                  <div className="pl-8 pb-2">
                    <Select
                      value={selectedBundleId?.toString()}
                      onValueChange={(value) => setSelectedBundleId(parseInt(value))}
                      disabled={!bundles || bundles.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={bundles.length > 0 ? "Select a bundle" : "No bundles available"} />
                      </SelectTrigger>
                      <SelectContent>
                        {bundles.map((bundle) => (
                          <SelectItem key={bundle.id} value={bundle.id.toString()}>
                            {bundle.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </RadioGroup>
            </div>
          )}

          {formError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Validation Error</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          {storeError && !formError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Creation Error</AlertTitle>
              <AlertDescription>{storeError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className={cn(isMobile && "flex-col-reverse gap-2")}>
            <Button 
              type="button" 
              variant="outline" 
              onClick={handleClose} 
              disabled={isUploading}
              className={cn(isMobile && "w-full")}
            >
              {isUploading ? 'Uploading...' : 'Cancel'}
            </Button>
            <Button 
              type="submit" 
              disabled={storeIsLoading || items.length === 0 || isUploading}
              className={cn(isMobile && "w-full")}
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isMobile ? 'Processing...' : (uploadProgress?.message || 'Processing...')}
                </>
              ) : storeIsLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {'Processing...'}
                </>
              ) : destination === 'individual' ? (
                isMobile ? `Upload ${items.length}` : `Upload ${items.length} Item${items.length !== 1 ? 's' : ''}`
              ) : destination === 'existing_bundle' ? (
                isMobile ? `Add ${items.length}` : `Add to Bundle (${items.length} items)`
              ) : (
                isMobile ? `Create Bundle` : `Create Bundle (${items.length} items)`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}