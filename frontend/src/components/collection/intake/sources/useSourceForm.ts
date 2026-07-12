'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { sourceConfigurationRegistry, type ConfigurableSourceKind } from '@/lib/sourceConfigurationRegistry';
import type { SourceKind } from '@/lib/annotations/types';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useBundleStore } from '@/zustand_stores/storeBundles';

/**
 * Headless logic for creating a source. One form, two entry states:
 *  - blank (Sources → New): pick a kind, fill config, set schedule.
 *  - prefilled (Web Search → Make recurrent): kind locked, config seeded from the
 *    search, opened at the stream step. State lives here so the surface can
 *    re-host popover↔overlay freely.
 */

export interface SourceFormInit {
  kind?: SourceKind;
  name?: string;
  config?: any;
  /** Promote opens at 'stream' and locks the kind. */
  startStep?: 'source' | 'config' | 'stream';
  lockKind?: boolean;
  streamEnabled?: boolean;
  pollInterval?: number;
  bundleId?: number;
  /** Set to edit an existing source (submit updates instead of creates). */
  sourceId?: number;
  /** Presentation: compact single scroll, or stepped with a flow indicator. */
  layout?: 'compact' | 'stepped';
}

export function useSourceForm(init?: SourceFormInit, onSuccess?: (result: any) => void) {
  const { createSource, updateSource } = useSourceStore();
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles } = useBundleStore();

  const sourceId = init?.sourceId;
  const isEditing = sourceId != null;

  const [selectedKind, setSelectedKind] = useState<SourceKind | null>(init?.kind ?? null);
  const [config, setConfig] = useState<any>(init?.config ?? {});
  const [name, setName] = useState(init?.name ?? '');
  // Promoting a search means "make it recurrent" — default the stream on.
  const [streamEnabled, setStreamEnabled] = useState(init?.streamEnabled ?? init?.startStep === 'stream');
  const [pollInterval, setPollInterval] = useState(init?.pollInterval ?? 21600);
  const [targetBundleId, setTargetBundleId] = useState<number | undefined>(init?.bundleId);
  const [targetBundleName, setTargetBundleName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    if (activeInfospace?.id) fetchBundles(activeInfospace.id);
  }, [activeInfospace?.id, fetchBundles]);

  const handleKindChange = (kind: SourceKind) => {
    setSelectedKind(kind);
    setConfig({});
    setValidationErrors([]);
    const schema = sourceConfigurationRegistry.getSchema(kind);
    if (schema) {
      setName(schema.uiSchema.title);
    }
  };

  const handleConfigChange = (fieldName: string, value: any) => {
    setConfig((prev: any) => sourceConfigurationRegistry.setFieldValue(prev, fieldName, value));
    setValidationErrors((prev) => prev.filter((e) => !e.includes(fieldName)));
  };

  const validateForm = (): boolean => {
    const errors: string[] = [];
    if (!name.trim()) errors.push('Source name is required');
    if (!selectedKind) errors.push('Please select a source type');
    if (selectedKind) errors.push(...sourceConfigurationRegistry.validateConfiguration(selectedKind, config).errors);
    setValidationErrors(errors);
    return errors.length === 0;
  };

  const submit = async (): Promise<boolean> => {
    if (!validateForm()) { toast.error('Please fix the validation errors'); return false; }
    if (!selectedKind || !activeInfospace) { toast.error('Select a source type and ensure an infospace is active.'); return false; }
    setIsSubmitting(true);
    const sourceData = {
      name,
      kind: selectedKind,
      details: config,
      target_bundle_id: targetBundleId,
      target_bundle_name: targetBundleName || undefined,
      is_active: streamEnabled,
      poll_interval_seconds: streamEnabled ? pollInterval : 300,
      output_bundle_id: targetBundleId,
    } as any;
    try {
      const result = isEditing
        ? await updateSource(sourceId!, sourceData)
        : await createSource(sourceData);
      if (result) {
        toast.success(`Source "${result.name}" ${isEditing ? 'updated' : 'created'}.`);
        onSuccess?.(result);
        return true;
      }
      return false;
    } catch (e) {
      toast.error(`Failed to ${isEditing ? 'update' : 'create'} source: ${e instanceof Error ? e.message : 'Unknown error'}`);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    selectedKind, handleKindChange,
    config, handleConfigChange,
    name, setName,
    streamEnabled, setStreamEnabled,
    pollInterval, setPollInterval,
    targetBundleId, setTargetBundleId,
    targetBundleName, setTargetBundleName,
    isSubmitting, validationErrors, submit,
    bundles,
    schema: selectedKind ? sourceConfigurationRegistry.getSchema(selectedKind) : null,
    supportedKinds: sourceConfigurationRegistry.getSupportedKinds(),
    lockKind: init?.lockKind ?? false,
    startStep: init?.startStep ?? 'source',
    isEditing,
    layout: init?.layout ?? 'compact',
  };
}
