'use client';

/**
 * CanonTypesEditor — declare, per entity type, the property shape its entries
 * carry (`Canon.type_schemas`). The canon-scoped cousin of the annotation schema
 * editor: each type is a card of ordered, typed property slots.
 *
 * This is guidance, not validation — it drives which typed inputs the entry
 * editor renders for an entry of a given type. Entries keep a free-form bag, so
 * undeclared types and extra keys always remain possible.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Plus, Shapes, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CanonRead, CanonPropertyDef, CanonEntryRead } from '@/client';
import { useUpdateCanon } from '@/hooks/useCanons';
import { PropertyTypePicker } from './PropertyTypePicker';
import { type CanonPropType, inferPropType, isComplexValue } from './canonProperties';
import { toast } from 'sonner';

interface Suggestion { key: string; type: CanonPropType; count: number }

interface Props {
  canon: CanonRead;
  /** The canon's entries — their `type`s surface here even before being declared. */
  entries?: CanonEntryRead[];
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface TypeDraft { type: string; props: CanonPropertyDef[] }

/**
 * Declared types (with their slots) first, then types only *observed* on entries
 * (no declared shape yet, empty slot list) — so the editor lists everything in
 * the canon, not just what's already declared. An observed type only becomes a
 * persisted declaration once it's given a property (see `handleSave`).
 */
function seedDrafts(ts: CanonRead['type_schemas'], entries: CanonEntryRead[]): TypeDraft[] {
  const declared: TypeDraft[] = Object.entries(ts ?? {}).map(([type, props]) => ({ type, props: (props ?? []).map(p => ({ ...p })) }));
  const have = new Set(declared.map(d => d.type));
  const observed: TypeDraft[] = [];
  for (const e of entries) {
    if (!e.type || have.has(e.type)) continue;
    have.add(e.type);
    observed.push({ type: e.type, props: [] });
  }
  observed.sort((a, b) => a.type.localeCompare(b.type, undefined, { sensitivity: 'base' }));
  return [...declared, ...observed];
}

export const CanonTypesEditor: React.FC<Props> = ({ canon, entries = [], open, onClose, onSaved }) => {
  const { update, loading } = useUpdateCanon();
  const [drafts, setDrafts] = useState<TypeDraft[]>([]);

  // Seed only on the open→true edge so a background entities refresh mid-edit
  // can't clobber in-progress changes.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) setDrafts(seedDrafts(canon.type_schemas, entries));
    prevOpen.current = open;
  }, [open, canon, entries]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries) if (e.type) m[e.type] = (m[e.type] ?? 0) + 1;
    return m;
  }, [entries]);

  // Property keys already present on entries of each type, with a voted value-
  // type and occurrence count. Powers the one-click "from entries" suggestions.
  // Complex (nested/object) values are skipped — the flat slot editor can't
  // represent them, so they belong in the entry's raw-JSON escape hatch.
  const suggestionsByType = useMemo(() => {
    const acc: Record<string, Record<string, { votes: Record<string, number>; count: number }>> = {};
    for (const e of entries) {
      if (!e.type) continue;
      for (const [k, v] of Object.entries((e.properties ?? {}) as Record<string, any>)) {
        if (isComplexValue(v)) continue;
        const cell = ((acc[e.type] ??= {})[k] ??= { votes: {}, count: 0 });
        const vt = inferPropType(v);
        cell.votes[vt] = (cell.votes[vt] ?? 0) + 1;
        cell.count += 1;
      }
    }
    const out: Record<string, Suggestion[]> = {};
    for (const [t, byKey] of Object.entries(acc)) {
      out[t] = Object.entries(byKey)
        .map(([key, { votes, count }]) => ({
          key,
          type: (Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'text') as CanonPropType,
          count,
        }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    }
    return out;
  }, [entries]);

  const setType = (i: number, patch: Partial<TypeDraft>) =>
    setDrafts(d => d.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const setProp = (ti: number, pi: number, patch: Partial<CanonPropertyDef>) =>
    setDrafts(d => d.map((t, idx) => idx !== ti ? t : { ...t, props: t.props.map((p, j) => (j === pi ? { ...p, ...patch } : p)) }));
  const addType = () => setDrafts(d => [...d, { type: '', props: [] }]);
  const removeType = (i: number) => setDrafts(d => d.filter((_, idx) => idx !== i));
  const addProp = (ti: number, seed?: Partial<CanonPropertyDef>) =>
    setDrafts(d => d.map((t, idx) => idx !== ti ? t : { ...t, props: [...t.props, { name: '', type: 'text', description: null, required: false, ...seed }] }));
  const removeProp = (ti: number, pi: number) => setDrafts(d => d.map((t, idx) => idx !== ti ? t : { ...t, props: t.props.filter((_, j) => j !== pi) }));

  const handleSave = async () => {
    // Trim; drop blank type/property names. A type only persists once it has a
    // real property shape — an observed type left untouched stays undeclared
    // (it still shows next time, sourced from its entries), keeping type_schemas
    // free of meaningless empty declarations.
    const type_schemas: Record<string, CanonPropertyDef[]> = {};
    for (const t of drafts) {
      const name = t.type.trim();
      if (!name) continue;
      const props = t.props
        .filter(p => p.name.trim())
        .map(p => ({ name: p.name.trim(), type: p.type || 'text', description: p.description?.trim() || null, required: !!p.required }));
      if (props.length === 0) continue;
      type_schemas[name] = props;
    }
    const updated = await update(canon.id, { type_schemas });
    if (updated) {
      toast.success('Property types saved');
      onSaved?.();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Shapes className="h-4 w-4" />Property types</DialogTitle>
          <DialogDescription className="text-xs">
            Declare the property shape for each entity type in <span className="font-medium">{canon.name}</span>. This
            guides the entry editor — it’s never enforced, so entries can still carry extra keys or undeclared types.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] -mx-1 px-1">
          <div className="space-y-3 py-1">
            {drafts.length === 0 && (
              <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                No declared types yet. Add one to give its entries a typed property shape.
              </div>
            )}

            {drafts.map((t, ti) => {
              const draftNames = new Set(t.props.map(p => p.name.trim()).filter(Boolean));
              const sugg = (suggestionsByType[t.type.trim()] ?? []).filter(s => !draftNames.has(s.key));
              return (
              <div key={ti} className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.props.some(p => p.name.trim()) ? 'bg-primary' : 'bg-muted-foreground/40')} />
                  <Input
                    value={t.type} onChange={(e) => setType(ti, { type: e.target.value })}
                    placeholder="type name (e.g. person)" className="h-8 max-w-[16rem] text-sm font-medium"
                  />
                  {counts[t.type.trim()] > 0 && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">{counts[t.type.trim()]} in use</span>
                  )}
                  <div className="flex-1" />
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeType(ti)} aria-label={`Remove type ${t.type || ''}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {t.props.length > 0 && (
                  <div className="space-y-1.5">
                    {t.props.map((p, pi) => (
                      <div key={pi} className="flex items-center gap-1.5">
                        <Input
                          value={p.name} onChange={(e) => setProp(ti, pi, { name: e.target.value })}
                          placeholder="property" className="h-8 w-[9rem] shrink-0 text-sm font-mono"
                        />
                        <PropertyTypePicker value={(p.type as CanonPropType) || 'text'} onValueChange={(v) => setProp(ti, pi, { type: v })} className="w-[7.5rem] shrink-0" />
                        <Input
                          value={p.description ?? ''} onChange={(e) => setProp(ti, pi, { description: e.target.value })}
                          placeholder="description (optional)" className="h-8 flex-1 text-sm"
                        />
                        <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground" title="Required">
                          <Switch checked={!!p.required} onCheckedChange={(v) => setProp(ti, pi, { required: v })} className="scale-90" />
                          req
                        </label>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeProp(ti, pi)} aria-label="Remove property">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {sugg.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">From entries:</span>
                    {sugg.slice(0, 12).map(s => (
                      <button
                        key={s.key} type="button"
                        onClick={() => addProp(ti, { name: s.key, type: s.type })}
                        title={`Seen on ${s.count} ${s.count === 1 ? 'entry' : 'entries'} — add as ${s.type}`}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Plus className="h-2.5 w-2.5" />
                        <span className="font-mono">{s.key}</span>
                        <span className="opacity-60">{s.type}</span>
                      </button>
                    ))}
                    {sugg.length > 12 && <span className="text-[10px] text-muted-foreground/70">+{sugg.length - 12} more</span>}
                  </div>
                )}

                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" onClick={() => addProp(ti)}>
                  <Plus className="h-3.5 w-3.5" />Add property
                </Button>
              </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="items-center">
          <Button type="button" variant="outline" size="sm" className="mr-auto gap-1.5" onClick={addType}>
            <Plus className="h-3.5 w-3.5" />Add type
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CanonTypesEditor;
