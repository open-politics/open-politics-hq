'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { AlertCircle, ChevronDown, ChevronRight, ListChecks, Loader2, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SchemePreview } from '@/components/collection/annotation/schemaCreation/SchemePreview';
import type { AdvancedSchemeField } from '@/lib/annotations/types';
import {
  useSchemaForm,
  leanTypeOf,
  optionsOf,
  LEAN_FIELD_TYPES,
  type SchemaFormInit,
} from './useSchemaForm';
import { DockBack, DockClose } from '../DockNav';
import type { SurfaceContentProps } from '../types';

/** One lean field row: name · type · required · description · (choices). */
function FieldRow({
  field,
  onName,
  onType,
  onDesc,
  onRequired,
  onOptions,
  onRemove,
}: {
  field: AdvancedSchemeField;
  onName: (v: string) => void;
  onType: (v: any) => void;
  onDesc: (v: string) => void;
  onRequired: (v: boolean) => void;
  onOptions: (v: string[]) => void;
  onRemove: () => void;
}) {
  const ui = leanTypeOf(field);
  const showOptions = ui === 'choice' || ui === 'list_choice';

  return (
    <div className="space-y-2 rounded-md border bg-background/60 p-2.5">
      <div className="flex items-center gap-2">
        <Input
          value={field.name}
          onChange={(e) => onName(e.target.value)}
          placeholder="field_name"
          className="h-8 flex-1 font-mono text-xs"
        />
        <Select value={ui} onValueChange={onType}>
          <SelectTrigger className="h-8 w-[140px] shrink-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LEAN_FIELD_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={onRemove}
          title="Remove field"
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <Textarea
        value={field.description ?? ''}
        onChange={(e) => onDesc(e.target.value)}
        placeholder="What should the model extract for this field?"
        className="text-xs"
        rows={2}
      />

      {showOptions && (
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Choices (comma-separated)</Label>
          <Input
            value={optionsOf(field).join(', ')}
            onChange={(e) => onOptions(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
            placeholder="e.g. negative, neutral, positive"
            className="h-8 text-xs"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Switch checked={field.required} onCheckedChange={onRequired} id={`req-${field.id}`} />
        <Label htmlFor={`req-${field.id}`} className="text-[11px] text-muted-foreground">Required</Label>
      </div>
    </div>
  );
}

/**
 * A lean schema-authoring surface for the chat. Same container-agnostic contract as
 * `SourceForm`: `mode === 'inline'` is a self-contained card whose confirm button
 * sits in the conversation. Simple field kinds only — the full field editor
 * (graph/entity/canon/nesting) lives in `AnnotationSchemaEditor`, not here.
 */
export function SchemaForm({
  init,
  mode,
  close,
  back,
  onSuccess,
}: SurfaceContentProps<SchemaFormInit> & { onSuccess?: (result?: any) => void }) {
  const f = useSchemaForm(init, onSuccess ?? close);
  const docked = mode === 'panel';
  const inline = mode === 'inline';
  const [showPreview, setShowPreview] = React.useState(false);

  const body = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Name <span className="text-red-500">*</span></Label>
        <Input value={f.name} onChange={(e) => f.setName(e.target.value)} placeholder="e.g. Coverage coding" className="text-sm" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Description</Label>
        <Textarea value={f.description} onChange={(e) => f.setDescription(e.target.value)} placeholder="What this schema codes, in one line" className="text-sm" rows={2} />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Fields</Label>
        {f.fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            onName={(v) => f.updateField(field.id, { name: v })}
            onType={(v) => f.setFieldType(field.id, v)}
            onDesc={(v) => f.updateField(field.id, { description: v })}
            onRequired={(v) => f.updateField(field.id, { required: v })}
            onOptions={(v) => f.setFieldOpts(field.id, v)}
            onRemove={() => f.removeField(field.id)}
          />
        ))}
        <Button variant="outline" size="sm" onClick={f.addField} className="w-full text-xs">
          <Plus className="mr-1.5 size-3.5" /> Add field
        </Button>
      </div>

      {/* Live preview of the schema as coded. */}
      <div>
        <button
          onClick={() => setShowPreview((s) => !s)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {showPreview ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Preview
        </button>
        {showPreview && (
          <div className="mt-2 rounded-md border bg-muted/30 p-2">
            <SchemePreview scheme={f.formData} />
          </div>
        )}
      </div>

      {f.errors.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-300">
          <div className="mb-1 flex items-center gap-1.5 font-medium"><AlertCircle className="size-3.5" /> Please fix:</div>
          <ul className="ml-5 list-disc space-y-0.5">{f.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
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
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {docked && back && <DockBack onClick={back} />}
        <ListChecks className={cn('size-4 shrink-0', inline ? 'text-primary/80' : 'text-muted-foreground')} />
        <div className="min-w-0 flex-1 text-sm font-medium">Build a schema</div>
        {docked && <DockClose onClick={close} />}
      </div>

      <div className={cn('space-y-3.5 p-3', !inline && 'min-h-0 flex-1 overflow-y-auto')}>
        {body}
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={close} className="text-sm">{inline ? 'Dismiss' : 'Cancel'}</Button>
        <Button size="sm" onClick={() => f.submit()} disabled={f.isSubmitting} className="min-w-28 text-sm">
          {f.isSubmitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
          Create schema
        </Button>
      </div>
    </div>
  );
}
