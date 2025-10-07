'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  FileText, 
  FolderPlus,
  AlertCircle,
  Loader2,
  Check
} from 'lucide-react';
import { toast } from 'sonner';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { AssetsService, BundlesService } from '@/client';
import { SearchResultData } from './SearchResultViewer';

interface SearchResultIngestorProps {
  results: SearchResultData[];
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function SearchResultIngestor({ 
  results, 
  open, 
  onClose,
  onSuccess 
}: SearchResultIngestorProps) {
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles, createBundle } = useBundleStore();
  
  const [destination, setDestination] = useState<'none' | 'existing' | 'new'>('none');
  const [selectedBundleId, setSelectedBundleId] = useState<number | null>(null);
  const [newBundleName, setNewBundleName] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load bundles when dialog opens
  useEffect(() => {
    if (open && activeInfospace?.id) {
      fetchBundles(activeInfospace.id);
    }
  }, [open, activeInfospace?.id, fetchBundles]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setDestination('none');
      setSelectedBundleId(null);
      setNewBundleName('');
      setError(null);
    }
  }, [open]);

  const validateForm = (): string | null => {
    if (destination === 'existing' && !selectedBundleId) {
      return 'Please select a bundle';
    }
    if (destination === 'new' && !newBundleName.trim()) {
      return 'Please enter a bundle name';
    }
    return null;
  };

  const handleIngest = async () => {
    if (!activeInfospace?.id) {
      setError('No active infospace');
      return;
    }

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsIngesting(true);
    setError(null);

    try {
      let targetBundleId: number | undefined = undefined;

      // Create new bundle if needed
      if (destination === 'new' && newBundleName.trim()) {
        const newBundle = await createBundle({
          name: newBundleName.trim(),
          description: `Created from chat search results`,
          asset_ids: []
        });
        if (newBundle) {
          targetBundleId = newBundle.id;
          toast.success(`Created bundle: ${newBundle.name}`);
        }
      } else if (destination === 'existing' && selectedBundleId) {
        targetBundleId = selectedBundleId;
      }

      // Ingest each result as an asset
      const ingestedCount = await ingestResults(results, targetBundleId);

      toast.success(`Successfully ingested ${ingestedCount} search results${targetBundleId ? ' into bundle' : ''}`);
      onSuccess?.();
      onClose();

    } catch (err: any) {
      console.error('Failed to ingest search results:', err);
      setError(err.message || 'Failed to ingest search results');
      toast.error('Failed to ingest search results');
    } finally {
      setIsIngesting(false);
    }
  };

  const ingestResults = async (
    results: SearchResultData[], 
    bundleId?: number
  ): Promise<number> => {
    if (!activeInfospace?.id) return 0;

    try {
      // Use the new bulk ingest endpoint with pre-fetched content
      const createdAssets = await AssetsService.ingestSearchResults({
        infospaceId: activeInfospace.id,
        requestBody: {
          results: results.map(r => ({
            title: r.title,
            url: r.url,
            content: r.text_content || r.content || '',
            score: r.score,
            provider: r.provider,
            source_metadata: r.source_metadata
          })),
          bundle_id: bundleId
        }
      });

      return createdAssets.length;
    } catch (err: any) {
      console.error('Failed to ingest search results:', err);
      throw err;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ingest Search Results</DialogTitle>
          <DialogDescription>
            Ingest {results.length} search result{results.length !== 1 ? 's' : ''} as assets
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Results Preview */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Selected Results</Label>
            <div className="max-h-32 overflow-y-auto space-y-1 p-2 border rounded-md">
              {results.map((result, idx) => (
                <div key={idx} className="text-xs truncate flex items-center gap-2">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{result.title}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bundle Destination */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Bundle Destination</Label>
            <RadioGroup value={destination} onValueChange={(value: any) => setDestination(value)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="none" id="dest-none" />
                <Label htmlFor="dest-none" className="font-normal cursor-pointer">
                  No bundle (add to infospace)
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <RadioGroupItem 
                  value="existing" 
                  id="dest-existing" 
                  disabled={!bundles || bundles.length === 0}
                />
                <Label 
                  htmlFor="dest-existing" 
                  className={`font-normal cursor-pointer ${(!bundles || bundles.length === 0) ? 'text-muted-foreground' : ''}`}
                >
                  Add to existing bundle
                </Label>
              </div>

              {destination === 'existing' && (
                <div className="pl-6">
                  <Select
                    value={selectedBundleId?.toString()}
                    onValueChange={(value) => setSelectedBundleId(parseInt(value))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a bundle..." />
                    </SelectTrigger>
                    <SelectContent>
                      {bundles.map((bundle) => (
                        <SelectItem key={bundle.id} value={bundle.id.toString()}>
                          <div className="flex items-center gap-2">
                            <span>{bundle.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {bundle.asset_count} assets
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center space-x-2">
                <RadioGroupItem value="new" id="dest-new" />
                <Label htmlFor="dest-new" className="font-normal cursor-pointer">
                  Create new bundle
                </Label>
              </div>

              {destination === 'new' && (
                <div className="pl-6">
                  <Input
                    placeholder="Enter bundle name..."
                    value={newBundleName}
                    onChange={(e) => setNewBundleName(e.target.value)}
                  />
                </div>
              )}
            </RadioGroup>
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isIngesting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleIngest}
            disabled={isIngesting}
          >
            {isIngesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Ingesting...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Ingest {results.length} Result{results.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

