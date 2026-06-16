'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  AlertCircle, ArrowRight, ChevronDown, ChevronRight, FileText, FolderOpen, Globe, Info,
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

const POLL_PRESETS = [
  { label: '5 min', value: 300 },
  { label: '15 min', value: 900 },
  { label: '1 hour', value: 3600 },
  { label: '6 hours', value: 21600 },
];

const FLOW_STEPS = [
  { key: 'source', label: 'Source' },
  { key: 'config', label: 'Configure' },
  { key: 'stream', label: 'Stream' },
  { key: 'output', label: 'Output' },
] as const;

/** Restores the source → configure → stream → output flow indicator (stepped layout). */
function FlowSteps({ done }: { done: Record<string, boolean> }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
      {FLOW_STEPS.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 && <ArrowRight className="size-3 shrink-0 text-muted-foreground/40" />}
          <div
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
              done[s.key] ? 'border-primary/40 bg-primary/5 text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className={cn('flex size-4 items-center justify-center rounded-full text-[9px]', done[s.key] ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
              {i + 1}
            </span>
            {s.label}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/** Schema-driven field renderer (ported verbatim from the old config component). */
function renderField(field: FieldSchema, value: any, onChange: (name: string, value: any) => void, errors: string[]) {
  const hasError = errors.some((e) => e.includes(field.name));
  const errorMessage = errors.find((e) => e.includes(field.name));
  const base = cn('w-full', hasError && 'border-red-500 focus:ring-red-500');

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
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Switch checked={value || false} onCheckedChange={(val) => onChange(field.name, val)} />
          <Label className="text-sm">{field.label}</Label>
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

const Section = ({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="size-3.5" /> {title}
    </div>
    {children}
  </div>
);

export function SourceForm({
  init,
  mode,
  close,
  back,
  onSuccess,
}: SurfaceContentProps<SourceFormInit> & { onSuccess?: () => void }) {
  // In a Surface, creating just closes it (onSuccess falls back to close). Standalone
  // hosts (e.g. FlowCanvas) pass a distinct onSuccess so create ≠ cancel.
  const f = useSourceForm(init, onSuccess ?? close);
  const promote = !f.isEditing && f.lockKind && f.startStep === 'stream';
  const stepped = f.layout === 'stepped';
  const docked = mode === 'panel';
  const [showConfig, setShowConfig] = React.useState(!promote);

  const stepDone: Record<string, boolean> = {
    source: !!f.selectedKind,
    config: !!f.selectedKind && Object.keys(f.config || {}).length > 0,
    stream: f.streamEnabled,
    output: f.targetBundleId != null || !!f.targetBundleName,
  };

  // Config block: source name + schema-driven fields.
  const configBlock = f.selectedKind && f.schema ? (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Source name <span className="text-red-500">*</span></Label>
        <Input value={f.name} onChange={(e) => f.setName(e.target.value)} placeholder="Descriptive name" className="text-sm" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {f.schema.uiSchema.fields.map((field) => (
          <div key={field.name} className={cn('space-y-1', (field.type === 'textarea' || field.type === 'multiselect') && 'sm:col-span-2')}>
            <Label className="flex items-center gap-1.5 text-xs">
              {field.label}
              {field.required && <span className="text-red-500">*</span>}
              {field.help && <Info className="size-3 text-muted-foreground" />}
            </Label>
            {renderField(field, sourceConfigurationRegistry.getFieldValue(f.config, field.name), f.handleConfigChange, f.validationErrors)}
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const streamBlock = (
    <Section icon={Radio} title="Stream">
      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-2.5">
        <div className="min-w-0 pr-2">
          <div className="text-sm font-medium">Run continuously</div>
          <p className="truncate text-xs text-muted-foreground">Poll for new content on a schedule</p>
        </div>
        <Switch checked={f.streamEnabled} onCheckedChange={f.setStreamEnabled} />
      </div>
      {f.streamEnabled && (
        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {POLL_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => f.setPollInterval(p.value)}
              className={cn('rounded-md border px-1 py-1.5 text-xs transition-colors', f.pollInterval === p.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </Section>
  );

  const outputBlock = (
    <Section icon={FolderOpen} title="Output bundle">
      <BundlePicker
        bundles={f.bundles}
        value={f.targetBundleId}
        onChange={(id) => f.setTargetBundleId(id)}
        newName={f.targetBundleName}
        onNewNameChange={(n) => f.setTargetBundleName(n)}
      />
      <p className="text-[11px] leading-tight text-muted-foreground">
        Where this source drops what it ingests — an existing bundle (nested ones included), a new one, or the root.
      </p>
    </Section>
  );

  return (
    <div className={cn('flex flex-col', mode === 'panel' ? 'h-full' : mode === 'overlay' ? 'max-h-[80vh]' : 'max-h-[34rem]')}>
      {/* Header — dock nav lives on the title row. */}
      <div className="space-y-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          {docked && back && <DockBack onClick={back} />}
          <div className="min-w-0 flex-1">
            {f.isEditing ? (
              <div className="flex items-center gap-2 text-sm font-medium">
                {f.selectedKind && React.createElement(KIND_ICONS[f.selectedKind] ?? FileText, { className: 'size-4 text-muted-foreground' })}
                <span>Edit source</span>
                {f.name && <span className="truncate text-muted-foreground">· {f.name}</span>}
              </div>
            ) : f.lockKind && f.selectedKind ? (
              <div className="flex items-center gap-2 text-sm font-medium">
                {React.createElement(KIND_ICONS[f.selectedKind] ?? FileText, { className: 'size-4 text-muted-foreground' })}
                <span className="capitalize">{f.selectedKind.replace('_', ' ')} source</span>
                {f.name && <span className="truncate text-muted-foreground">· {f.name}</span>}
              </div>
            ) : (
              <div className="text-sm font-medium">New source</div>
            )}
          </div>
          {docked && <DockClose onClick={close} />}
        </div>
        {stepped && <FlowSteps done={stepDone} />}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {/* From-scratch: kind picker first */}
        {!f.lockKind && (
          <Section icon={Search} title="Source type">
            <div className="grid grid-cols-2 gap-1.5">
              {f.supportedKinds.map((kind) => {
                const Icon = KIND_ICONS[kind] ?? FileText;
                const sel = f.selectedKind === kind;
                return (
                  <button
                    key={kind}
                    onClick={() => f.handleKindChange(kind as ConfigurableSourceKind)}
                    className={cn('flex items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors', sel ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}
                  >
                    <Icon className={cn('size-4', sel ? 'text-primary' : 'text-muted-foreground')} />
                    <span className="truncate">{sourceConfigurationRegistry.getSchema(kind as ConfigurableSourceKind)?.uiSchema.title || kind}</span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {/* Promote foregrounds stream + output; from-scratch shows config then stream/output. */}
        {promote ? (
          <>
            {streamBlock}
            {outputBlock}
            {configBlock && (
              <div className="rounded-md border">
                <button onClick={() => setShowConfig((s) => !s)} className="flex w-full items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                  {showConfig ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  Search settings (from your search)
                </button>
                {showConfig && <div className="border-t p-2.5">{configBlock}</div>}
              </div>
            )}
          </>
        ) : (
          <>
            {configBlock}
            {f.selectedKind && streamBlock}
            {f.selectedKind && outputBlock}
          </>
        )}

        {f.validationErrors.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-300">
            <div className="mb-1 flex items-center gap-1.5 font-medium"><AlertCircle className="size-3.5" /> Please fix:</div>
            <ul className="ml-5 list-disc space-y-0.5">{f.validationErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t p-2.5">
        <Button variant="ghost" size="sm" onClick={close} className="text-sm">Cancel</Button>
        <Button size="sm" onClick={() => f.submit()} disabled={!f.selectedKind || f.isSubmitting} className="min-w-28 text-sm">
          {f.isSubmitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
          {f.isEditing ? 'Save changes' : 'Create source'}
        </Button>
      </div>
    </div>
  );
}
