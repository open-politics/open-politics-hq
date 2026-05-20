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
import { useActiveJobsStore } from '@/zustand_stores/storeActiveJobs';
import { AssetsService, BundlesService } from '@/client';
import { SearchResultData } from './SearchResultViewer';

interface SearchResultIngestorProps {
  results: SearchResultData[];
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /**
   * Bubble up the ``IngestionJob`` id when SearXNG-style snippets get queued
   * for background scraping. Parent (Chat) attaches a ``<JobProgressBanner>``
   * so the user sees live progress instead of opaque silence.
   */
  onJobCreated?: (jobId: number, urlCount: number) => void;
}

export function SearchResultIngestor({
  results,
  open,
  onClose,
  onSuccess,
  onJobCreated
}: SearchResultIngestorProps) {
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles, createBundle } = useBundleStore();
  const addActiveJob = useActiveJobsStore((s) => s.addJob);
  
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

      // Ingest — backend splits inline-vs-scrape per content length.
      const { inlineCount, scrapeJobId, scrapeUrlCount } = await ingestResults(results, targetBundleId);

      if (scrapeJobId && activeInfospace?.id) {
        // Push to the chat-wide active-jobs store so the Chat parent renders
        // a <JobProgressBanner>. Avoids prop-drilling through the renderer tree.
        addActiveJob({
          jobId: scrapeJobId,
          infospaceId: activeInfospace.id,
          label: `Scraping ${scrapeUrlCount} URL${scrapeUrlCount === 1 ? '' : 's'}`,
        });
        // Optional callback for parents that prefer explicit handoff.
        onJobCreated?.(scrapeJobId, scrapeUrlCount);
      }

      const summary: string[] = [];
      if (inlineCount > 0) summary.push(`${inlineCount} ingested directly`);
      if (scrapeUrlCount > 0) summary.push(`${scrapeUrlCount} queued for scraping`);
      toast.success(
        summary.length
          ? `Search results: ${summary.join(', ')}${targetBundleId ? ' (bundle)' : ''}`
          : 'No assets created',
      );
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
  ): Promise<{ inlineCount: number; scrapeJobId: number | null; scrapeUrlCount: number }> => {
    if (!activeInfospace?.id) {
      return { inlineCount: 0, scrapeJobId: null, scrapeUrlCount: 0 };
    }

    try {
      // Backend now returns { assets, scrape_job_id, scrape_url_count }.
      // assets[] = built inline (Tavily-style full content). scrape_job_id =
      // background IngestionJob handling SearXNG-style snippets via Newspaper4k.
      const response: any = await AssetsService.ingestSearchResults({
        infospaceId: activeInfospace.id,
        requestBody: {
            results: results.map(r => ({
            title: r.title,
            url: r.url,
            content: r.text_content || r.content || '',
            score: r.score,
            provider: r.provider,
            file_info: r.source_metadata ?? undefined,
            facets: undefined,
          })),
          bundle_id: bundleId
        }
      });

      const assets = response?.assets ?? [];
      return {
        inlineCount: Array.isArray(assets) ? assets.length : 0,
        scrapeJobId: response?.scrape_job_id ?? null,
        scrapeUrlCount: response?.scrape_url_count ?? 0,
      };
    } catch (err: any) {
      console.error('Failed to ingest search results:', err);
      throw err;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="">
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
                    <SelectContent className="max-h-80 overflow-y-auto">
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

