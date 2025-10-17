'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import AssetDetailView from './AssetDetailView';
import { Button } from '@/components/ui/button';
import { Maximize, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { AssetRead, AnnotationSchemaRead } from '@/client';
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { FormattedAnnotation } from '@/lib/annotations/types';
import AnnotationResultDisplay from '../../annotation/AnnotationResultDisplay';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

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
}

export default function AssetDetailOverlay({
  open,
  onClose,
  assetId,
  highlightAssetIdOnOpen,
  onLoadIntoRunner,
  onOpenManagerRequest,
  annotationResults = [],
  schemas = []
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
    }
  }, [open]);

  const handleOpenInManager = () => {
    if (asset) {
      onOpenManagerRequest?.();
      onClose();
    }
  };

  const handleEdit = (asset: AssetRead) => {
    console.warn('handleEdit needs refactoring for assets');
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

  // Filter annotation results for this specific asset
  const assetResults = useMemo(() => {
    if (!assetId || !annotationResults) {
      console.log('[AssetDetailOverlay] No assetId or annotationResults', { assetId, annotationResultsCount: annotationResults?.length });
      return [];
    }
    const filtered = annotationResults.filter(result => result.asset_id === assetId);
    console.log('[AssetDetailOverlay] Filtered annotation results', {
      assetId,
      totalResults: annotationResults.length,
      filteredResults: filtered.length,
      filtered: filtered.map(r => ({ id: r.id, schema_id: r.schema_id }))
    });
    return filtered;
  }, [assetId, annotationResults]);

  // Check if we should show the annotations panel
  const showAnnotations = assetResults.length > 0 && schemas.length > 0;
  
  console.log('[AssetDetailOverlay] Rendering with', {
    open,
    assetId,
    asset: asset?.id,
    assetKind: asset?.kind,
    assetResultsCount: assetResults.length,
    schemasCount: schemas.length,
    showAnnotations,
    annotationResultsTotal: annotationResults?.length
  });

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className={cn(
        "flex flex-col p-0",
        // Desktop: wider when showing annotations
        showAnnotations ? "max-w-[95vw]" : "max-w-4xl",
        // Mobile: full screen
        "max-h-[90vh] sm:max-h-[90vh]",
        "w-[100vw] sm:w-auto"
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
                <TextSpanHighlightProvider>
                  <AssetDetailView
                    onEdit={handleEdit}
                    schemas={[]}
                    selectedAssetId={assetId}
                    highlightAssetIdOnOpen={highlightAssetIdOnOpen}
                    onLoadIntoRunner={handleLoadIntoRunner}
                  />
                </TextSpanHighlightProvider>
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
              <div className="p-2.5 sm:p-3 border-b bg-card flex-shrink-0">
                <h3 className="font-semibold text-xs sm:text-sm">Annotation Results</h3>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                  {assetResults.length} result{assetResults.length !== 1 ? 's' : ''} for this asset
                </p>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2.5 sm:p-3 space-y-2.5 sm:space-y-3">
                  {assetResults.map((result) => {
                    const schema = schemas.find(s => s.id === result.schema_id);
                    if (!schema) {
                      console.warn('[AssetDetailOverlay] No schema found for result', {
                        resultId: result.id,
                        schemaId: result.schema_id,
                        availableSchemas: schemas.map(s => s.id)
                      });
                      return null;
                    }
                    
                    return (
                      <Card key={result.id} className="p-2.5 sm:p-3">
                        <AnnotationResultDisplay
                          result={result}
                          schema={schema}
                          compact={false}
                          renderContext="default"
                        />
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
          
          {/* Debug Panel - temporarily show when annotations should be there but aren't */}
          {!showAnnotations && assetId && annotationResults && annotationResults.length > 0 && (
            <div className="w-full sm:w-[300px] flex flex-col overflow-hidden bg-yellow-50 dark:bg-yellow-950/20 border-l-2 border-yellow-500">
              <div className="p-2.5 sm:p-3 border-b bg-yellow-100 dark:bg-yellow-900/20">
                <h3 className="font-semibold text-xs sm:text-sm text-yellow-900 dark:text-yellow-100">Debug Info</h3>
                <p className="text-[10px] sm:text-xs text-yellow-700 dark:text-yellow-300 mt-0.5">
                  Why aren't annotations showing?
                </p>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2.5 sm:p-3 space-y-2 text-[10px] sm:text-xs">
                  <div><strong>Asset ID:</strong> {assetId}</div>
                  <div><strong>Total Results:</strong> {annotationResults.length}</div>
                  <div><strong>Filtered Results:</strong> {assetResults.length}</div>
                  <div><strong>Schemas Available:</strong> {schemas.length}</div>
                  <div><strong>Show Annotations:</strong> {showAnnotations ? 'Yes' : 'No'}</div>
                  <Separator className="my-2" />
                  <div className="space-y-1">
                    <strong>Sample Results Asset IDs:</strong>
                    {annotationResults.slice(0, 5).map(r => (
                      <div key={r.id} className="font-mono text-[9px] sm:text-[10px]">
                        Result {r.id}: asset_id={r.asset_id} {r.asset_id === assetId ? '✓' : '✗'}
                      </div>
                    ))}
                  </div>
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
} 