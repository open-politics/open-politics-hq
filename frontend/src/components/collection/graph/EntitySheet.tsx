'use client';

/**
 * Slide-over editor for a single CanonEntry — the workbench's editing surface.
 *
 * Every portable field is editable here: canonical, type (picked from the
 * canon's declared + observed types), external_id, aliases, additional_types,
 * tags, parents (searched from the canon's own entries), and the `properties`
 * bag — rendered as typed inputs driven by the type's declared shape
 * (`type_schemas`), with a raw-JSON escape hatch. Save calls
 * `EntitiesService.updateEntity` and emits `onSaved` so the caller refreshes.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { TagInput } from '@/components/ui/tag-input';
import { Loader2 } from 'lucide-react';
import { EntitiesService } from '@/client';
import type { CanonEntryRead, CanonEntryUpdate, CanonRead } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { TypePicker } from './TypePicker';
import { ParentPicker } from './ParentPicker';
import { EntityProperties } from './EntityProperties';
import { toast } from 'sonner';

interface Props {
  entity: CanonEntryRead | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** The canon's per-type property-shape declarations (drives the typed editor). */
  typeSchemas?: CanonRead['type_schemas'];
  /** The canon's entries — candidates for the type and parent pickers. */
  entries?: CanonEntryRead[];
}

/** Order-insensitive serialization so a reordered `properties` map isn't "dirty". */
const stable = (o: any): string => {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return `[${o.map(stable).join(',')}]`;
  return `{${Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',')}}`;
};

export const EntitySheet: React.FC<Props> = ({ entity, open, onClose, onSaved, typeSchemas, entries = [] }) => {
  const { activeInfospace } = useInfospaceStore();
  const [canonical, setCanonical] = useState('');
  const [type, setType] = useState('');
  const [externalId, setExternalId] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [additionalTypes, setAdditionalTypes] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [parents, setParents] = useState<string[]>([]);
  const [properties, setProperties] = useState<Record<string, any>>({});
  const [propsValid, setPropsValid] = useState(true);
  const [saving, setSaving] = useState(false);

  // Re-seed local form state whenever the sheet opens for a (new) entity.
  useEffect(() => {
    if (!open || !entity) return;
    setCanonical(entity.canonical ?? '');
    setType(entity.type ?? '');
    setExternalId(entity.external_id ?? '');
    setAliases(entity.aliases ?? []);
    setAdditionalTypes(entity.additional_types ?? []);
    setTags(entity.tags ?? []);
    setParents(entity.parents ?? []);
    setProperties((entity.properties as Record<string, any>) ?? {});
    setPropsValid(true);
  }, [open, entity]);

  const declaredTypes = useMemo(() => Object.keys(typeSchemas ?? {}), [typeSchemas]);
  const observedTypes = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.type) s.add(e.type);
    return Array.from(s);
  }, [entries]);
  const schema = useMemo(() => (typeSchemas?.[type] ?? []), [typeSchemas, type]);

  const dirty = useMemo(() => {
    if (!entity) return false;
    const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
    return (
      canonical !== (entity.canonical ?? '') ||
      type !== (entity.type ?? '') ||
      externalId !== (entity.external_id ?? '') ||
      !eq(aliases, entity.aliases ?? []) ||
      !eq(additionalTypes, entity.additional_types ?? []) ||
      !eq(tags, entity.tags ?? []) ||
      !eq(parents, entity.parents ?? []) ||
      stable(properties) !== stable(entity.properties ?? {})
    );
  }, [entity, canonical, type, externalId, aliases, additionalTypes, tags, parents, properties]);

  const handleSave = async () => {
    if (!activeInfospace || !entity || !propsValid) return;
    setSaving(true);
    try {
      const body: CanonEntryUpdate = {
        canonical: canonical.trim(),
        type: type.trim(),
        external_id: externalId.trim() || null,
        aliases,
        additional_types: additionalTypes,
        tags,
        parents,
        properties,
      };
      await EntitiesService.updateEntity({
        infospaceId: activeInfospace.id,
        entityId: entity.id,
        requestBody: body,
      });
      toast.success('Entry updated');
      onSaved?.();
      onClose();
    } catch (e: any) {
      const detail = e?.body?.detail ?? e?.message ?? 'Failed to update';
      toast.error(typeof detail === 'string' ? detail : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  if (!entity) return null;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="border-b p-4 pr-10">
          <SheetTitle className="flex items-center gap-2">
            <span className="truncate">{entity.canonical}</span>
            {entity.type && <Badge variant="secondary" className="text-[10px] font-normal">{entity.type}</Badge>}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Canon entry — the full workbench record. Everything here is portable
            and travels when the canon is exported.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-5 px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Canonical</Label>
              <Input value={canonical} onChange={(e) => setCanonical(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <TypePicker
                value={type}
                onValueChange={setType}
                declaredTypes={declaredTypes}
                observedTypes={observedTypes}
                className="w-full"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">External ID</Label>
            <Input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="wikidata:Q183 · naturalearth:admin0 · …"
              className="h-8 text-sm font-mono"
            />
            <p className="text-[11px] text-muted-foreground">Stable key for deterministic import-merge and cross-canon refs.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Aliases</Label>
            <TagInput value={aliases} onChange={setAliases} placeholder="Surface forms that fold to this entry…" variant="outline" aria-label="Aliases" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Additional types</Label>
            <TagInput value={additionalTypes} onChange={setAdditionalTypes} placeholder="Other type memberships…" aria-label="Additional types" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Tags</Label>
            <TagInput value={tags} onChange={setTags} placeholder="Organizational labels…" aria-label="Tags" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Parents</Label>
            <ParentPicker value={parents} onChange={setParents} entries={entries} selfId={entity.id} />
            <p className="text-[11px] text-muted-foreground">Same-canon refs (containment or subclass). A ref that doesn't resolve is unresolved, never broken.</p>
          </div>

          <div className="border-t pt-4">
            <EntityProperties
              schema={schema}
              value={properties}
              onChange={setProperties}
              onValidityChange={setPropsValid}
              resetKey={entity.id}
            />
          </div>
        </div>

        <SheetFooter className="border-t p-4 flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !dirty || !propsValid}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default EntitySheet;
