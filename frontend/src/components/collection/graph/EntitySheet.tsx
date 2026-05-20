'use client';

/**
 * Slide-over editor for a single Entity.
 *
 * Shows aliases (read-only chips — these are managed by resolution / merge),
 * editable ``additional_types`` (multi-tag for queries and display), and a
 * collapsed JSON view of ``properties``. Save calls
 * ``EntitiesService.updateEntity`` and emits an ``onSaved`` callback so the
 * caller can refresh.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, X } from 'lucide-react';
import { EntitiesService } from '@/client';
import type { EntityRead, EntityUpdate } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';

interface Props {
  entity: EntityRead | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const EntitySheet: React.FC<Props> = ({ entity, open, onClose, onSaved }) => {
  const { activeInfospace } = useInfospaceStore();
  const [additionalTypes, setAdditionalTypes] = useState<string[]>([]);
  const [typeInput, setTypeInput] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-seed local form state when the sheet opens for a new entity.
  useEffect(() => {
    if (!open || !entity) return;
    setAdditionalTypes(entity.additional_types ?? []);
    setTypeInput('');
  }, [open, entity]);

  const aliases = useMemo(
    () => (entity?.aliases ?? []).filter(a => a !== entity?.canonical_name),
    [entity],
  );

  const addType = () => {
    const v = typeInput.trim();
    if (!v) return;
    setAdditionalTypes(prev => prev.includes(v) ? prev : [...prev, v]);
    setTypeInput('');
  };

  const removeType = (t: string) => setAdditionalTypes(prev => prev.filter(x => x !== t));

  const handleSave = async () => {
    if (!activeInfospace || !entity) return;
    setSaving(true);
    try {
      const body: EntityUpdate = {
        additional_types: additionalTypes,
      };
      await EntitiesService.updateEntity({
        infospaceId: activeInfospace.id,
        entityId: entity.id,
        requestBody: body,
      });
      toast.success('Entity updated');
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

  const dirty = JSON.stringify(additionalTypes) !== JSON.stringify(entity.additional_types ?? []);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>{entity.canonical_name}</span>
            <Badge variant="secondary" className="text-[10px]">{entity.entity_type}</Badge>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Canon-scoped vocabulary entry. Aliases are managed by resolution
            and merge — edit additional types here.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-5 py-4">
          <div className="space-y-2">
            <Label className="text-xs">Aliases</Label>
            {aliases.length === 0 ? (
              <p className="text-xs text-muted-foreground">No aliases yet — they accumulate as resolution merges variants.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {aliases.map(a => (
                  <Badge key={a} variant="outline" className="text-[11px]">{a}</Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Additional types</Label>
            <p className="text-[11px] text-muted-foreground">
              Multi-type tags for queries and display. The primary
              <span className="font-mono mx-1">entity_type</span>stays singular for resolution matching.
            </p>
            <div className="flex gap-2">
              <Input
                value={typeInput}
                onChange={e => setTypeInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addType();
                  }
                }}
                placeholder="e.g. politician, head_of_state"
                className="h-8 text-sm flex-1"
              />
              <Button size="sm" variant="outline" onClick={addType} disabled={!typeInput.trim()}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            {additionalTypes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {additionalTypes.map(t => (
                  <Badge key={t} variant="secondary" className="gap-1 pr-1">
                    {t}
                    <button
                      type="button"
                      className="ml-0.5 rounded hover:bg-muted/50"
                      onClick={() => removeType(t)}
                      aria-label={`Remove type ${t}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {entity.properties && Object.keys(entity.properties).length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Properties</Label>
              <pre className="text-[11px] bg-muted/40 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(entity.properties, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default EntitySheet;
