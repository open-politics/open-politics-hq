'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { IngestionJobsService } from '@/client';
import { Loader2, Sparkles, FileCheck, MapPin, Image } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

const ENRICHERS = [
  { name: 'hash', label: 'Content Hash', icon: FileCheck, description: 'SHA-256 for dedup and change detection' },
  { name: 'ocr', label: 'OCR', icon: Image, description: 'Extract text from PDF pages (Tesseract or Ollama)' },
  { name: 'geocoding', label: 'Geocoding', icon: MapPin, description: 'Resolve location facets to lat/lon' },
];

const EnrichmentConfig: React.FC = () => {
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles } = useBundleStore();
  const [selectedBundleId, setSelectedBundleId] = useState<number | null>(null);
  const [selectedEnricher, setSelectedEnricher] = useState('hash');
  const [isTriggering, setIsTriggering] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<Record<string, number> | null>(null);

  const loadBundles = useCallback(async () => {
    if (!activeInfospace?.id) return;
    await fetchBundles(activeInfospace.id);
  }, [activeInfospace?.id, fetchBundles]);

  useEffect(() => {
    loadBundles();
  }, [loadBundles]);

  useEffect(() => {
    if (bundles.length > 0 && !selectedBundleId) setSelectedBundleId(bundles[0].id);
  }, [bundles, selectedBundleId]);

  const loadProcessingStatus = useCallback(async () => {
    if (!activeInfospace?.id || !selectedBundleId) return;
    try {
      const res = await IngestionJobsService.getProcessingStatus({
        infospaceId: activeInfospace.id,
        bundleId: selectedBundleId,
      });
      setProcessingStatus(res as Record<string, number>);
    } catch {
      setProcessingStatus(null);
    }
  }, [activeInfospace?.id, selectedBundleId]);

  useEffect(() => {
    loadProcessingStatus();
  }, [loadProcessingStatus]);

  const handleTriggerEnrich = async () => {
    if (!activeInfospace?.id || !selectedBundleId) return;
    setIsTriggering(true);
    try {
      await IngestionJobsService.triggerBatchEnrich({
        infospaceId: activeInfospace.id,
        bundleId: selectedBundleId,
        requestBody: { enricher_name: selectedEnricher, batch_size: 50 },
      });
      toast.success(`Enrichment (${selectedEnricher}) started`);
      loadProcessingStatus();
    } catch (e) {
      toast.error('Failed to start enrichment');
    } finally {
      setIsTriggering(false);
    }
  };

  if (!activeInfospace) {
    return (
      <div className="p-6 text-muted-foreground">
        Select an infospace to configure enrichment.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Enrichment & OCR
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enrichers run automatically via reactive watchers (every 2 min). You can also trigger them manually per bundle.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">OCR Configuration</CardTitle>
          <CardDescription>
            Configure in .env: OCR_PROVIDER_TYPE (tesseract | ollama), OLLAMA_OCR_MODEL (e.g. llava).
            Same OLLAMA_BASE_URL as LLMs. Reuse LLM config menu for Ollama vision models.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Available Enrichers</CardTitle>
          <CardDescription>
            Watchers dispatch work automatically. Manual trigger runs on selected bundle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ENRICHERS.map((e) => {
            const Icon = e.icon;
            return (
              <div key={e.name} className="flex items-center gap-4 p-3 rounded-lg border">
                <Icon className="h-8 w-8 text-muted-foreground" />
                <div className="flex-1">
                  <p className="font-medium">{e.label}</p>
                  <p className="text-sm text-muted-foreground">{e.description}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual Trigger</CardTitle>
          <CardDescription>
            Run an enricher on a specific bundle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Bundle</Label>
            <Select
              value={selectedBundleId?.toString() ?? ''}
              onValueChange={(v) => setSelectedBundleId(v ? parseInt(v, 10) : null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select bundle" />
              </SelectTrigger>
              <SelectContent>
                {bundles.length === 0 ? (
                  <SelectItem value="_none">No bundles — fetch first</SelectItem>
                ) : (
                  bundles.map((b) => (
                    <SelectItem key={b.id} value={b.id.toString()}>
                      {b.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Enricher</Label>
            <Select value={selectedEnricher} onValueChange={setSelectedEnricher}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENRICHERS.map((e) => (
                  <SelectItem key={e.name} value={e.name}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={handleTriggerEnrich}
            disabled={!selectedBundleId || isTriggering}
          >
            {isTriggering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Run now
          </Button>
        </CardContent>
      </Card>

      {selectedBundleId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Processing Status</CardTitle>
            <CardDescription>
              Asset counts by status for selected bundle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {processingStatus ? (
              <div className="flex gap-4 flex-wrap">
                {Object.entries(processingStatus).map(([status, count]) => (
                  <span key={status} className="text-sm">
                    <strong>{status}:</strong> {count}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Load status...</p>
            )}
            <Button variant="outline" size="sm" className="mt-2" onClick={loadProcessingStatus}>
              Refresh
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EnrichmentConfig;
