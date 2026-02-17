'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import AssetDetailView from './AssetDetailView';
import { Button } from '@/components/ui/button';
import { Maximize, Loader2, AlertCircle, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { AssetRead, AnnotationSchemaRead } from '@/client';
import { TextSpanHighlightProvider, useTextSpanHighlight } from '@/components/collection/contexts/TextSpanHighlightContext';
import { FormattedAnnotation } from '@/lib/annotations/types';
import AnnotationResultDisplay from '../../annotation/AnnotationResultDisplay';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { searchInAnnotationValue } from '@/lib/annotations/search';

interface AssetDetailOverlayProps {
  open: boolean;
  onClose: () => void;
  assetId: number | null;
  highlightAssetIdOnOpen: number | null;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
  onOpenManagerRequest?: () => void;
  // NEW: Optional annotation results to display alongside the asset
  annotationResults?: FormattedAnnotation[];
  schemas?: AnnotationSchemaRead[];
  // NEW: Optional run ID to filter results by current run only
  activeRunId?: number | null;
}

export default function AssetDetailOverlay({
  open,
  onClose,
  assetId,
  highlightAssetIdOnOpen,
  onLoadIntoRunner,
  onOpenManagerRequest,
  annotationResults = [],
  schemas = [],
  activeRunId = null
}: AssetDetailOverlayProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const { activeInfospace } = useInfospaceStore();
  const [dataFetched, setDataFetched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { getAssetById } = useAssetStore();
  const [asset, setAsset] = useState<AssetRead | null>(null);
  
  // Mobile: track which panel is visible (asset or annotations)
  const [mobileView, setMobileView] = useState<'asset' | 'annotations'>('asset');
  
  // Local search state for overlay
  const [overlaySearchTerm, setOverlaySearchTerm] = useState('');

  // Fetch the asset details
  const fetchAssetDetails = useCallback(async (id: number) => {
    if (!activeInfospace?.id) return null;
    
    try {
      const fetchedAsset = await getAssetById(id);
      return fetchedAsset;
    } catch (error) {
      console.error(`Error fetching asset ${id}:`, error);
      return null;
    }
  }, [activeInfospace?.id, getAssetById]);

  const fetchData = useCallback(async () => {
    if (!activeInfospace || !assetId) return;
    
    setIsLoading(true);
    setLoadError(null);
    
    try {
      const fetchedAsset = await fetchAssetDetails(assetId);
      
      if (fetchedAsset) {
        setAsset(fetchedAsset);
        setDataFetched(true);
      } else {
        setLoadError(`Could not find asset with ID: ${assetId}`);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoadError('Failed to load asset details.');
      toast.error('Failed to load asset details.');
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace, assetId, fetchAssetDetails]);

  useEffect(() => {
    if (open && assetId && activeInfospace && !dataFetched) {
      fetchData();
    }
  }, [open, assetId, activeInfospace, dataFetched, fetchData]);

  useEffect(() => {
    if (!open) {
      setDataFetched(false);
      setAsset(null);
      setLoadError(null);
      setMobileView('asset'); // Reset to asset view when closing
      setOverlaySearchTerm(''); // Reset search term when closing
    }
  }, [open]);

  const handleOpenInManager = () => {
    if (asset) {
      onOpenManagerRequest?.();
      onClose();
    }
  };

  const handleEdit = (_asset: AssetRead) => {
    // TODO: refactor handleEdit for assets
  };

  const handleLoadIntoRunner = (runId: number, runName: string) => {
    if (onLoadIntoRunner) {
      toast.success(`Loading into Classification Runner`, {
        description: `Loading run "${runName}" (ID: ${runId}) into the Classification Runner`,
        duration: 3000,
      });
      
      onLoadIntoRunner(runId, runName);
      onClose();
    }
  };

  // Filter annotation results for this specific asset and run
  const assetResults = useMemo(() => {
    if (!assetId || !annotationResults) {
      return [];
    }
    
    let filtered = annotationResults.filter(result => {
      const matchesAsset = result.asset_id === assetId;
      // If activeRunId is provided, also filter by run_id (use Number() to handle type mismatches)
      const matchesRun = !activeRunId || Number(result.run_id) === Number(activeRunId);
      return matchesAsset && matchesRun;
    });
    
    // Apply search term filtering if present (uses recursive search through nested values)
    if (overlaySearchTerm && overlaySearchTerm.trim().length > 0) {
      const searchTerm = overlaySearchTerm.trim();
      filtered = filtered.filter(result => {
        // Check asset title (if available)
        if (result.asset && typeof result.asset === 'object' && 'title' in result.asset) {
          const assetTitle = String((result.asset as any).title || '');
          if (assetTitle.toLowerCase().includes(searchTerm.toLowerCase())) return true;
        }
        // Check result value recursively
        if (result.value && searchInAnnotationValue(result.value, searchTerm)) {
          return true;
        }
        return false;
      });
    }
    
    return filtered;
  }, [assetId, annotationResults, activeRunId, overlaySearchTerm]);

  // Count results before search filtering (for panel visibility)
  const resultsBeforeSearch = useMemo(() => {
    if (!assetId || !annotationResults) return 0;
    return annotationResults.filter(result => {
      const matchesAsset = result.asset_id === assetId;
      // Use Number() to handle type mismatches
      const matchesRun = !activeRunId || Number(result.run_id) === Number(activeRunId);
      return matchesAsset && matchesRun;
    }).length;
  }, [assetId, annotationResults, activeRunId]);

  // Check if we should show the annotations panel (based on pre-search results, not post-search)
  const showAnnotations = resultsBeforeSearch > 0 && schemas.length > 0;

  // Helper component to clear highlights when overlay opens or assetId changes
  const HighlightClearer = ({ assetId, open }: { assetId: number | null; open: boolean }) => {
    const { clearHighlights } = useTextSpanHighlight();
    useEffect(() => {
      if (open && assetId) clearHighlights();
    }, [open, assetId, clearHighlights]);
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className={cn(
        "flex flex-col p-0",
        // Desktop: wider when showing annotations
        showAnnotations ? "max-w-[100vw] h-full" : "max-w-4xl",
        // Mobile: full screen
        "max-h-[90vh] sm:max-h-[100vh]",
        "w-auto md:w-[100vw]"
      )}>
        <DialogHeader className="flex flex-row items-center justify-between p-3 sm:p-4 border-b flex-shrink-0">
          <DialogTitle className="text-sm sm:text-base">
            Asset Details {assetId ? `(ID: ${assetId})` : ''}
            {showAnnotations && ` • ${assetResults.length} Annotation${assetResults.length !== 1 ? 's' : ''}`}
          </DialogTitle>
          {asset && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleOpenInManager}
              title="Open in Asset Manager"
              className="h-7 w-7 -mt-4 mr-8"
            >
              <Maximize className="size-4" />
            </Button>
          )}
        </DialogHeader>
        
        {/* Mobile: Toggle buttons when annotations exist */}
        {showAnnotations && (
          <div className="flex sm:hidden border-b bg-muted/30">
            <button
              onClick={() => setMobileView('asset')}
              className={cn(
                "flex-1 py-2 text-xs font-medium transition-colors",
                mobileView === 'asset' 
                  ? "bg-background border-b-2 border-primary" 
                  : "text-muted-foreground"
              )}
            >
              Asset Details
            </button>
            <button
              onClick={() => setMobileView('annotations')}
              className={cn(
                "flex-1 py-2 text-xs font-medium transition-colors",
                mobileView === 'annotations' 
                  ? "bg-background border-b-2 border-primary" 
                  : "text-muted-foreground"
              )}
            >
              Annotations ({assetResults.length})
            </button>
          </div>
        )}
        
        <TextSpanHighlightProvider>
          <HighlightClearer assetId={assetId} open={open} />
        <div className="flex-1 min-h-0 flex">
          {/* Left Panel: Asset Detail */}
          <div className={cn(
            "overflow-y-auto",
            // Desktop: flex layout with border when annotations present
            showAnnotations ? "hidden sm:flex sm:flex-1 sm:border-r" : "flex-1",
            // Mobile: show/hide based on toggle
            showAnnotations && mobileView === 'asset' && "flex flex-1",
            showAnnotations && mobileView === 'annotations' && "hidden"
          )}>
            <div className="p-3 sm:p-4 w-full">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-5 w-5 sm:h-6 sm:w-6 animate-spin mr-2" />
                  <p className="text-sm">Loading details...</p>
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center justify-center h-full text-destructive">
                  <AlertCircle className="h-8 w-8 sm:h-10 sm:w-10 mb-4" />
                  <p className="text-center text-sm">{loadError}</p>
                </div>
              ) : asset ? (
                <AssetDetailView
                  onEdit={handleEdit}
                  schemas={[]}
                  selectedAssetId={assetId}
                  highlightAssetIdOnOpen={highlightAssetIdOnOpen}
                  onLoadIntoRunner={handleLoadIntoRunner}
                  enableHighlighting={true}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm">No asset found or item does not exist.</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Right Panel: Annotation Results */}
          {showAnnotations && (
            <div className={cn(
              "flex flex-col overflow-hidden bg-muted/20",
              // Desktop: fixed width sidebar
              "hidden sm:flex sm:w-[500px]",
              // Mobile: full width when active
              mobileView === 'annotations' && "flex flex-1"
            )}>
              <div className="p-2.5 sm:p-3 border-b bg-card flex-shrink-0 space-y-2">
                <div>
                  <h3 className="font-semibold text-xs sm:text-sm">Annotation Results</h3>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                    {overlaySearchTerm && overlaySearchTerm.trim().length > 0
                      ? `${assetResults.length} of ${annotationResults.filter(r => r.asset_id === assetId && (!activeRunId || r.run_id === activeRunId)).length} result${assetResults.length !== 1 ? 's' : ''} match${assetResults.length !== 1 ? '' : 'es'} search`
                      : `${assetResults.length} result${assetResults.length !== 1 ? 's' : ''} for this asset`}
                  </p>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search annotations..."
                    value={overlaySearchTerm}
                    onChange={(e) => setOverlaySearchTerm(e.target.value)}
                    className="pl-7 pr-2 h-7 text-xs"
                  />
                  {overlaySearchTerm && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOverlaySearchTerm('')}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 p-0"
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Clear search</span>
                    </Button>
                  )}
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2.5 sm:p-3 space-y-2.5 sm:space-y-3">
                  {assetResults.length === 0 && overlaySearchTerm && overlaySearchTerm.trim().length > 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="text-sm">No matches found for "{overlaySearchTerm}"</p>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setOverlaySearchTerm('')}
                        className="mt-2 text-xs"
                      >
                        Clear search
                      </Button>
                    </div>
                  ) : (
                    assetResults.map((result) => {
                      const schema = schemas.find(s => s.id === result.schema_id);
                      if (!schema) return null;
                      
                      return (
                        <Card key={result.id} className="p-2.5 sm:p-3">
                          <AnnotationResultDisplay
                            result={result}
                            schema={schema}
                            asset={asset}
                            compact={false}
                            renderContext="default"
                            searchTerm={overlaySearchTerm}
                          />
                        </Card>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
          
        </div>
        </TextSpanHighlightProvider>
      </DialogContent>
    </Dialog>
  );
} 