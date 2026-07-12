'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  AlertCircle, ChevronDown, ChevronRight, FileText, FolderOpen, Globe,
  Loader2, Radio, Rss, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sourceConfigurationRegistry, type FieldSchema, type ConfigurableSourceKind } from '@/lib/sourceConfigurationRegistry';
import type { SourceKind } from '@/lib/annotations/types';
import { useSourceForm, type SourceFormInit } from './useSourceForm';
import { BundlePicker } from '@/components/collection/assets/BundlePicker';
import { DockBack, DockClose } from '../DockNav';
import type { SurfaceContentProps } from '../types';

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  rss: Rss, web_search: Search, web: Globe, crawl: Globe, upload: FileText, directory: FolderOpen,
};

// Schedule collapses the old on/off switch + preset grid into one control:
// "One-time" (stream off) or a poll cadence (stream on). One decision, one row.
const SCHEDULE_OPTIONS = [
  { label: 'One-time', value: 0 },
  { label: 'Every 5 min', value: 300 },
  { label: 'Every 15 min', value: 900 },
  { label: 'Hourly', value: 3600 },
  { label: 'Every 6 hours', value: 21600 },
  { label: 'Daily', value: 86400 },
];

/** Schema-driven field renderer (the label is rendered by the caller). */
function renderField(field: FieldSchema, value: any, onChange: (name: string, value: any) => void, errors: string[]) {
  const hasError = errors.some((e) => e.includes(field.name));
  const errorMessage = errors.find((e) => e.includes(field.name));
  const base = cn('w-full text-sm', hasError && 'border-red-500 focus:ring-red-500');

  switch (field.type) {
    case 'text':
    case 'url':
      return (
        <div className="space-y-1">
          <Input type={field.type === 'url' ? 'url' : 'text'} value={value || ''} onChange={(e) => onChange(field.name, e.target.value)} placeholder={field.placeholder} className={base} />
          {hasError && <p className="text-xs text-red-500">{errorMessage}</p>}
        </div>
      );
    case 'number':
      return (
        <div className="space-y-1">
          <Input type="number" value={value || ''} onChange={(e) => onChange(field.name, parseInt(e.target.value) || 0)} placeholder={field.placeholder} min={field.validation?.min} max={field.validation?.max} className={base} />
          {hasError && <p className="text-xs text-red-500">{errorMessage}</p>}
        </div>
      );
    case 'textarea':
      return (
        <div className="space-y-1">
          <Textarea value={value || ''} onChange={(e) => onChange(field.name, e.target.value)} placeholder={field.placeholder} className={base} rows={3} />
          {hasError && <p className="text-xs text-red-500">{errorMessage}</p>}
        </div>
      );
    case 'select':
      return (
        <div className="space-y-1">
          <Select value={value} onValueChange={(val) => onChange(field.name, val)}>
            <SelectTrigger className={base}><SelectValue placeholder={field.placeholder} /></SelectTrigger>
            <SelectContent>
              {field.options?.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {hasError && <p className="text-xs text-red-500">{errorMessage}</p>}
        </div>
      );
    case 'multiselect':
      return (
        <div className="space-y-1">
          <Textarea value={Array.isArray(value) ? value.join(', ') : ''} onChange={(e) => onChange(field.name, e.target.value.split(',').map((v) => v.trim()).filter(Boolean))} placeholder={field.placeholder} className={base} rows={2} />
          <p className="text-xs text-muted-foreground">Separate values with commas</p>
          {hasError && <p className="text-xs text-red-500">{errorMessage}</p>}
        </div>
      );
    default:
      return null;
  }
}

/**
 * One source-creation surface, four presentations. The layout is identity-first:
 * lead with the kind + name, foreground the *locator* (the thing being monitored —
 * a feed url, a query), fold secondary knobs behind "Advanced", and collapse the
 * whole schedule into a single cadence select. Draft state lives in `useSourceForm`
 * so re-hosting (dock ↔ chat ↔ overlay) never resets it.
 *
 * `mode === 'inline'` is the chat presentation: a self-contained action card whose
 * confirm button sits right in the conversation (no dock chrome, no scroll box).
 */
export function SourceForm({
  init,
  mode,
  close,
  back,
  onSuccess,
}: SurfaceContentProps<SourceFormInit> & { onSuccess?: (result?: any) => void }) {
  // In a Surface, creating just closes it (onSuccess falls back to close). Standalone
  // hosts (e.g. FlowCanvas, the chat confirm card) pass a distinct onSuccess so
  // create ≠ cancel.
  const f = useSourceForm(init, onSuccess ?? close);
  const docked = mode === 'panel';
  const inline = mode === 'inline';
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const fields = f.schema?.uiSchema.fields ?? [];
  const requiredFields = fields.filter((x) => x.required);
  const optionalFields = fields.filter((x) => !x.required);

  const KindIcon = f.selectedKind ? (KIND_ICONS[f.selectedKind] ?? FileText) : Radio;
  const title = f.isEditing ? 'Edit source' : f.lockKind ? 'Confirm recurring source' : 'New source';

  // Schedule as a single value: 0 → one-time (stream off), else poll cadence.
  const scheduleValue = f.streamEnabled ? String(f.pollInterval) : '0';
  const onScheduleChange = (v: string) => {
    const n = Number(v);
    if (n === 0) { f.setStreamEnabled(false); return; }
    f.setStreamEnabled(true);
    f.setPollInterval(n);
  };

  const fieldLabel = (field: FieldSchema) => (
    <Label className="flex items-center gap-1 text-xs text-muted-foreground">
      {field.label}
      {field.required && <span className="text-red-500">*</span>}
    </Label>
  );

  const body = (
    <>
      {/* Kind picker — only from scratch (locked when promoting a search / editing). */}
      {!f.lockKind && !f.isEditing && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <div className="flex flex-wrap gap-1.5">
            {f.supportedKinds.map((kind) => {
              const Icon = KIND_ICONS[kind] ?? FileText;
              const sel = f.selectedKind === kind;
              return (
                <button
                  key={kind}
                  onClick={() => f.handleKindChange(kind as ConfigurableSourceKind)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                    sel ? 'border-primary bg-primary/5 text-foreground' : 'text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  <Icon className={cn('size-3.5', sel ? 'text-primary' : 'text-muted-foreground')} />
                  {sourceConfigurationRegistry.getSchema(kind as ConfigurableSourceKind)?.uiSchema.title || kind}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {f.selectedKind && f.schema && (
        <>
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Name <span className="text-red-500">*</span></Label>
            <Input value={f.name} onChange={(e) => f.setName(e.target.value)} placeholder="Descriptive name" className="text-sm" />
          </div>

          {/* Locator — the thing being monitored, foregrounded. */}
          {requiredFields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              {fieldLabel(field)}
              {renderField(field, sourceConfigurationRegistry.getFieldValue(f.config, field.name), f.handleConfigChange, f.validationErrors)}
            </div>
          ))}

          {/* Secondary knobs (max items, depth, …) stay out of the way. */}
          {optionalFields.length > 0 && (
            <div>
              <button
                onClick={() => setShowAdvanced((s) => !s)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {showAdvanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                Advanced
              </button>
              {showAdvanced && (
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {optionalFields.map((field) => (
                    <div key={field.name} className={cn('space-y-1.5', (field.type === 'textarea' || field.type === 'multiselect') && 'sm:col-span-2')}>
                      {fieldLabel(field)}
                      {renderField(field, sourceConfigurationRegistry.getFieldValue(f.config, field.name), f.handleConfigChange, f.validationErrors)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Schedule — one cadence control. */}
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium">Check for new content</div>
              <p className="truncate text-xs text-muted-foreground">
                {f.streamEnabled ? 'HQ polls this source on a schedule' : 'Fetch once, no monitoring'}
              </p>
            </div>
            <Select value={scheduleValue} onValueChange={onScheduleChange}>
              <SelectTrigger className="h-8 w-[130px] shrink-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCHEDULE_OPTIONS.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Output bundle */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Output bundle</Label>
            <BundlePicker
              bundles={f.bundles}
              value={f.targetBundleId}
              onChange={(id) => f.setTargetBundleId(id)}
              newName={f.targetBundleName}
              onNewNameChange={(n) => f.setTargetBundleName(n)}
            />
            <p className="text-[11px] leading-tight text-muted-foreground">
              Where this source drops what it ingests — an existing bundle, a new one, or the root.
            </p>
          </div>
        </>
      )}

      {f.validationErrors.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-300">
          <div className="mb-1 flex items-center gap-1.5 font-medium"><AlertCircle className="size-3.5" /> Please fix:</div>
          <ul className="ml-5 list-disc space-y-0.5">{f.validationErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </>
  );

  return (
    <div
      className={cn(
        'flex flex-col',
        inline && 'overflow-hidden rounded-lg border border-primary/30 bg-primary/[0.03]',
        mode === 'panel' && 'h-full',
        mode === 'overlay' && 'max-h-[80vh]',
        mode === 'popover' && 'max-h-[34rem]',
      )}
    >
      {/* Header — a single slim row; dock nav appears only when docked. */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {docked && back && <DockBack onClick={back} />}
        <KindIcon className={cn('size-4 shrink-0', f.lockKind || inline ? 'text-primary/80' : 'text-muted-foreground')} />
        <div className="min-w-0 flex-1 text-sm font-medium">{title}</div>
        {f.lockKind && f.selectedKind && (
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
            {f.selectedKind.replace('_', ' ')}
          </span>
        )}
        {docked && <DockClose onClick={close} />}
      </div>

      {/* Body */}
      <div className={cn('space-y-3.5 p-3', !inline && 'min-h-0 flex-1 overflow-y-auto')}>
        {body}
      </div>

      {/* Footer — the confirm button travels with the surface, so inline-in-chat it
          lands right in the conversation. */}
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={close} className="text-sm">{inline ? 'Dismiss' : 'Cancel'}</Button>
        <Button size="sm" onClick={() => f.submit()} disabled={!f.selectedKind || f.isSubmitting} className="min-w-28 text-sm">
          {f.isSubmitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
          {f.isEditing ? 'Save changes' : 'Create source'}
        </Button>
      </div>
    </div>
  );
}
