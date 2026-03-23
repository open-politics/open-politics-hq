'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { IngestionJobsService, InfospacesService } from '@/client';
import { OpenAPI } from '@/client/core/OpenAPI';
import { Loader2, FileCheck, MapPin, Image, Languages, BarChart3, Play, RefreshCw } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';

interface TaskStats {
  done: number;
  failed: number;
  skipped: number;
  last_run: string | null;
}

interface TaskStatus {
  name: string;
  tags: string[];
  capability: string | null;
  stats: TaskStats | null;
}

const ENRICHER_META: { name: string; label: string; icon: LucideIcon; capability?: string; description: string }[] = [
  { name: 'hash', label: 'Hash', icon: FileCheck, description: 'SHA-256 dedup' },
  { name: 'ocr', label: 'OCR', icon: Image, capability: 'ocr', description: 'PDF text extraction' },
  { name: 'geocoding', label: 'Geo', icon: MapPin, capability: 'geocoding', description: 'Location resolution' },
  { name: 'language_detection', label: 'Lang', icon: Languages, description: 'Language detection' },
  { name: 'quality_score', label: 'Quality', icon: BarChart3, description: 'Text quality metric' },
];

async function fetchTaskStatuses(): Promise<TaskStatus[]> {
  try {
    const res = await fetch(`${OpenAPI.BASE}/api/v1/providers/enrichment/status`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.tasks || [];
  } catch {
    return [];
  }
}

const EnrichmentConfig: React.FC = () => {
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles } = useBundleStore();
  const [selectedScope, setSelectedScope] = useState<string>('all');
  const [selectedEnricher, setSelectedEnricher] = useState('all');
  const [isTriggering, setIsTriggering] = useState(false);
  const [allTasks, setAllTasks] = useState<TaskStatus[]>([]);
  const [togglingEnricher, setTogglingEnricher] = useState<string | null>(null);

  const enrichmentConfig = (activeInfospace?.enrichment_config ?? {}) as Record<string, any>;

  const loadBundles = useCallback(async () => {
    if (!activeInfospace?.id) return;
    await fetchBundles(activeInfospace.id);
  }, [activeInfospace?.id, fetchBundles]);

  useEffect(() => { loadBundles(); }, [loadBundles]);

  useEffect(() => { fetchTaskStatuses().then(setAllTasks); }, []);

  const refreshStats = useCallback(() => { fetchTaskStatuses().then(setAllTasks); }, []);

  const enricherTasks = allTasks.filter(t => t.tags.includes('enrichment') && t.name !== 'embedding');

  const isEnricherEnabled = (name: string): boolean => {
    const val = enrichmentConfig[name];
    if (val === undefined || val === null) return true; // default: enabled
    if (typeof val === 'boolean') return val;
    if (typeof val === 'object') return true; // ProviderSelection = enabled
    return true;
  };

  const toggleEnricher = async (name: string, enabled: boolean) => {
    if (!activeInfospace?.id) return;
    setTogglingEnricher(name);
    try {
      const meta = ENRICHER_META.find(e => e.name === name);
      // For enrichers with capabilities, enabling means true (use system default provider)
      // For built-in enrichers, just boolean
      const newValue = enabled ? (meta?.capability ? true : true) : false;
      await InfospacesService.updateInfospace({
        infospaceId: activeInfospace.id,
        requestBody: {
          enrichment_config: { ...enrichmentConfig, [name]: newValue },
        } as any,
      });
      toast.success(`${meta?.label ?? name} ${enabled ? 'enabled' : 'disabled'}`);
      // Refresh infospace to get updated config
      useInfospaceStore.getState().fetchInfospaceById(activeInfospace.id);
    } catch {
      toast.error(`Failed to update ${name}`);
    } finally {
      setTogglingEnricher(null);
    }
  };

  const handleTriggerEnrich = async () => {
    if (!activeInfospace?.id) return;
    setIsTriggering(true);

    const targetBundles = selectedScope === 'all'
      ? bundles
      : bundles.filter(b => b.id.toString() === selectedScope);

    if (targetBundles.length === 0) {
      toast.error('No bundles to process.');
      setIsTriggering(false);
      return;
    }

    const targetEnrichers = selectedEnricher === 'all'
      ? ENRICHER_META.filter(e => isEnricherEnabled(e.name)).map(e => e.name)
      : [selectedEnricher];

    try {
      let started = 0;
      for (const bundle of targetBundles) {
        for (const enricher of targetEnrichers) {
          await IngestionJobsService.triggerBatchEnrich({
            infospaceId: activeInfospace.id,
            bundleId: bundle.id,
            requestBody: { enricher_name: enricher, batch_size: 50 },
          });
          started++;
        }
      }
      const label = selectedEnricher === 'all' ? 'All enrichers' : selectedEnricher;
      toast.success(`${label} started on ${targetBundles.length} bundle${targetBundles.length > 1 ? 's' : ''}`);
      refreshStats();
    } catch {
      toast.error('Failed to start enrichment');
    } finally {
      setIsTriggering(false);
    }
  };

  if (!activeInfospace) {
    return <div className="text-xs text-muted-foreground">Select an infospace first.</div>;
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Background Processing</h3>
        <button onClick={refreshStats} className="text-muted-foreground hover:text-foreground transition-colors" title="Refresh stats">
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Trigger — above tiles */}
      <div className="flex items-end gap-1.5 pt-1.25">
        <div className="grid gap-0.5 flex-1 min-w-0">
          <Label className="text-[10px] text-muted-foreground">Scope</Label>
          <Select value={selectedScope} onValueChange={setSelectedScope}>
            <SelectTrigger className="h-8.5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              <SelectItem value="all">All bundles</SelectItem>
              {bundles.map((b) => (
                <SelectItem key={b.id} value={b.id.toString()}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-0.5 flex-1 min-w-0">
          <Label className="text-[10px] text-muted-foreground">Enricher</Label>
          <Select value={selectedEnricher} onValueChange={setSelectedEnricher}>
            <SelectTrigger className="h-8.5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All enrichers</SelectItem>
              {ENRICHER_META.map((e) => (
                <SelectItem key={e.name} value={e.name}>{e.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="icon"
          variant="outline"
          onClick={handleTriggerEnrich}
          disabled={isTriggering}
          className="h-8.5 w-8.5 shrink-0"
        >
          {isTriggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        </Button>
      </div>

      {/* Enricher tiles */}
      <div className="grid grid-cols-3 gap-1.5">
        {ENRICHER_META.map((meta) => {
          const task = enricherTasks.find(t => t.name === meta.name);
          const stats = task?.stats;
          const Icon = meta.icon;
          const enabled = isEnricherEnabled(meta.name);
          const isToggling = togglingEnricher === meta.name;

          return (
            <div
              key={meta.name}
              className={`rounded-md border p-2 space-y-1.5 transition-opacity ${!enabled ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Icon className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[11px] font-medium">{meta.label}</span>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => toggleEnricher(meta.name, v)}
                  disabled={isToggling}
                  className="scale-[0.6] origin-right"
                />
              </div>
              {enabled && stats ? (
                <div className="text-center">
                  <div className="text-base font-semibold tabular-nums leading-none">{stats.done.toLocaleString()}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">
                    {stats.failed > 0 ? <span className="text-red-500">{stats.failed} failed</span> : 'processed'}
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-base font-semibold tabular-nums leading-none text-muted-foreground/40">—</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">{meta.description}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EnrichmentConfig;
