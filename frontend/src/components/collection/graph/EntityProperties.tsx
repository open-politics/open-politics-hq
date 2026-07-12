'use client';

/**
 * EntityProperties — the typed, schema-driven editor for a canon entry's
 * `properties` bag. It's the direct-UI replacement for the raw JSON textarea.
 *
 * The entry's type may declare an ordered set of typed slots (the canon's
 * `type_schemas[type]`); those render first as labelled, type-appropriate
 * inputs. Any keys on the entry beyond the declared slots show as removable
 * "extra" rows with their own type picker — so freeform power is never lost and
 * nothing is dropped. An "Edit as JSON" escape hatch covers structured values
 * the flat editor can't represent inline.
 *
 * Guidance, not a gate: undeclared types and extra keys are always allowed; the
 * declared schema only decides which inputs to render and in what order.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TagInput } from '@/components/ui/tag-input';
import { Braces, Code2, Plus, Trash2, Asterisk } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CanonPropertyDef } from '@/client';
import { PropertyTypePicker } from './PropertyTypePicker';
import {
  type CanonPropType, inferPropType, isComplexValue, isEmptyValue,
  toInputString, parseInputValue, emptyValueForType,
} from './canonProperties';

interface Row {
  id: string;
  key: string;
  type: CanonPropType;
  value: any;
  declared: boolean;
  complex: boolean;
  touched: boolean;
  description?: string;
  required?: boolean;
}

interface Props {
  /** Declared slots for the entry's current type ([] when the type declares none). */
  schema: CanonPropertyDef[];
  value: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  /** Changes when a different entry opens — triggers a fresh re-seed from `value`. */
  resetKey: React.Key;
  disabled?: boolean;
  /** Reports false while the raw-JSON escape hatch holds invalid JSON. */
  onValidityChange?: (valid: boolean) => void;
}

const hasOwn = (o: any, k: string) => o && Object.prototype.hasOwnProperty.call(o, k);

function seedRows(schema: CanonPropertyDef[], obj: Record<string, any>): Row[] {
  const declared = new Set(schema.map(s => s.name));
  const rows: Row[] = schema.map(s => {
    const v = obj?.[s.name];
    return {
      id: `d:${s.name}`, key: s.name, type: (s.type as CanonPropType) || 'text',
      value: v, declared: true, complex: isComplexValue(v), touched: hasOwn(obj, s.name),
      description: s.description ?? undefined, required: !!s.required,
    };
  });
  for (const k of Object.keys(obj || {})) {
    if (declared.has(k)) continue;
    const v = obj[k];
    rows.push({ id: `x:${k}`, key: k, type: inferPropType(v), value: v, declared: false, complex: isComplexValue(v), touched: true });
  }
  return rows;
}

function rowsToObject(rows: Row[]): Record<string, any> {
  const obj: Record<string, any> = {};
  for (const r of rows) {
    const key = r.key.trim();
    if (!key) continue;
    if (r.complex) { obj[key] = r.value; continue; }
    if (r.type === 'boolean') { if (r.value === true || r.touched) obj[key] = !!r.value; continue; }
    if (isEmptyValue(r.value)) continue;
    obj[key] = r.value;
  }
  return obj;
}

/** One value control, switched on the row's type. */
const ValueInput: React.FC<{ row: Row; disabled?: boolean; onValue: (v: any) => void }> = ({ row, disabled, onValue }) => {
  if (row.type === 'boolean') {
    return <Switch checked={row.value === true} onCheckedChange={onValue} disabled={disabled} aria-label={row.key} />;
  }
  if (row.type === 'list') {
    return <TagInput value={Array.isArray(row.value) ? row.value : []} onChange={onValue} disabled={disabled} placeholder="Add value…" aria-label={row.key} />;
  }
  const inputType = row.type === 'number' || row.type === 'integer' ? 'number'
    : row.type === 'date' ? 'date' : row.type === 'url' ? 'url' : 'text';
  return (
    <Input
      type={inputType}
      value={toInputString(row.value)}
      disabled={disabled}
      onChange={(e) => onValue(parseInputValue(row.type, e.target.value))}
      placeholder={row.type === 'url' ? 'https://…' : undefined}
      className="h-8 text-sm"
      aria-label={row.key}
    />
  );
};

export const EntityProperties: React.FC<Props> = ({ schema, value, onChange, resetKey, disabled, onValidityChange }) => {
  const [rows, setRows] = useState<Row[]>(() => seedRows(schema, value));
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState<string | null>(null);

  const schemaKey = useMemo(() => JSON.stringify(schema.map(s => [s.name, s.type])), [schema]);
  const lastReset = useRef<React.Key | symbol>(Symbol('init'));
  const lastSchemaKey = useRef<string>(schemaKey);
  const newCount = useRef(0);

  // Re-seed on a fresh entry; on a type change (same entry), rebuild keeping the
  // values already entered. Neither path emits, so opening never marks dirty.
  useEffect(() => {
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      lastSchemaKey.current = schemaKey;
      setRows(seedRows(schema, value));
      setRawMode(false); setRawError(null);
    } else if (lastSchemaKey.current !== schemaKey) {
      lastSchemaKey.current = schemaKey;
      setRows(prev => seedRows(schema, rowsToObject(prev)));
    }
  }, [resetKey, schemaKey, schema, value]);

  useEffect(() => { onValidityChange?.(rawMode ? !rawError : true); }, [rawMode, rawError, onValidityChange]);

  const commit = (next: Row[]) => { setRows(next); onChange(rowsToObject(next)); };
  const patchRow = (id: string, patch: Partial<Row>) =>
    commit(rows.map(r => (r.id === id ? { ...r, ...patch, touched: true } : r)));
  const removeRow = (id: string) => commit(rows.filter(r => r.id !== id));
  const addRow = () =>
    commit([...rows, { id: `n:${newCount.current++}`, key: '', type: 'text', value: undefined, declared: false, complex: false, touched: true }]);

  const enterRaw = () => {
    setRawText(JSON.stringify(rowsToObject(rows), null, 2));
    setRawError(null);
    setRawMode(true);
  };
  const onRawChange = (text: string) => {
    setRawText(text);
    try {
      const parsed = JSON.parse(text || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setRawError('Properties must be a JSON object.');
        return;
      }
      setRawError(null);
      const next = seedRows(schema, parsed);
      setRows(next);
      onChange(parsed);
    } catch (e: any) {
      setRawError(e?.message ?? 'Invalid JSON');
    }
  };

  const declaredRows = rows.filter(r => r.declared);
  const extraRows = rows.filter(r => !r.declared);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Properties</span>
        <Button
          type="button" variant="ghost" size="sm"
          className="h-6 gap-1.5 px-2 text-[11px] text-muted-foreground"
          onClick={() => (rawMode ? setRawMode(false) : enterRaw())}
        >
          {rawMode ? <><Braces className="h-3 w-3" />Visual</> : <><Code2 className="h-3 w-3" />Edit as JSON</>}
        </Button>
      </div>

      {rawMode ? (
        <div className="space-y-1.5">
          <Textarea
            value={rawText}
            onChange={(e) => onRawChange(e.target.value)}
            spellCheck={false}
            disabled={disabled}
            className="font-mono text-[11px] min-h-[160px]"
            aria-label="Properties JSON"
          />
          {rawError && <p className="text-[11px] text-red-500">Invalid — {rawError}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {declaredRows.length === 0 && extraRows.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No properties yet. Declare a shape for this type under <span className="font-medium">Types</span>, or add one below.
            </p>
          )}

          {declaredRows.length > 0 && (
            <div className="space-y-2">
              {declaredRows.map(r => (
                <div key={r.id} className="grid grid-cols-[minmax(7rem,9rem)_1fr] items-start gap-2">
                  <div className="flex min-w-0 items-center gap-1 pt-1.5">
                    <span className="truncate text-xs font-medium" title={r.description}>{r.key}</span>
                    {r.required && <Asterisk className="h-2.5 w-2.5 shrink-0 text-amber-500" />}
                  </div>
                  {r.complex
                    ? <ComplexNote />
                    : <ValueInput row={r} disabled={disabled} onValue={(v) => patchRow(r.id, { value: v })} />}
                </div>
              ))}
            </div>
          )}

          {extraRows.length > 0 && (
            <div className="space-y-2">
              {declaredRows.length > 0 && <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Extra</div>}
              {extraRows.map(r => (
                <div key={r.id} className="flex items-start gap-1.5">
                  <Input
                    value={r.key} disabled={disabled}
                    onChange={(e) => patchRow(r.id, { key: e.target.value })}
                    placeholder="key" className="h-8 w-[8rem] shrink-0 text-sm font-mono" aria-label="Property key"
                  />
                  {!r.complex && (
                    <PropertyTypePicker
                      value={r.type} disabled={disabled}
                      onValueChange={(t) => patchRow(r.id, { type: t, value: emptyValueForType(t) })}
                      className="w-[7.5rem] shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    {r.complex
                      ? <ComplexNote />
                      : <ValueInput row={r} disabled={disabled} onValue={(v) => patchRow(r.id, { value: v })} />}
                  </div>
                  {!disabled && (
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(r.id)} aria-label={`Remove ${r.key || 'property'}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!disabled && (
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={addRow}>
              <Plus className="h-3.5 w-3.5" />Add property
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

const ComplexNote: React.FC = () => (
  <div className="flex h-8 items-center rounded-md border border-dashed px-2.5 text-[11px] text-muted-foreground">
    Structured value — edit in JSON
  </div>
);

export default EntityProperties;
