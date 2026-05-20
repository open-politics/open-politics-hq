'use client';

/**
 * CompareBySubjectButton — header action that spawns sibling panels
 * narrowed to one subject each, so the asymmetry between subjects under
 * the same projection reads off the dashboard at a glance.
 *
 * Wraps a popover with a multi-select over the projection's subject canon.
 * On confirm, builds clones via ``buildComparisonSplitClones`` and appends
 * them to the dashboard with a side-by-side grid_position.
 */

import React, { useMemo, useState } from 'react';
import { Columns, Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { buildComparisonSplitClones } from '@/lib/annotations/scopes';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import type { PanelConfig } from '@/lib/annotations/types';
import type { AnnotationSchemaRead } from '@/client';
import type { EntityLookupEntry } from '@/hooks/useCanonEntityLookup';

export interface CompareBySubjectButtonProps {
  sourcePanel: PanelConfig;
  schema?: AnnotationSchemaRead | null;
  /** Canon entities to choose from. Filtered to the projection's subject
   *  entity_type when present. */
  entities: EntityLookupEntry[];
  /** When the projection has multiple roles, which one is the subject. */
  subjectRole?: string;
  /** Hide entirely when not applicable (e.g. projection has no entity roles). */
  visible?: boolean;
}

export const CompareBySubjectButton: React.FC<CompareBySubjectButtonProps> = ({
  sourcePanel,
  schema,
  entities,
  subjectRole = 'subject',
  visible = true,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const setDashboardConfig = useAnnotationRunStore(s => s.setDashboardConfig);
  const setDashboardDirty = useAnnotationRunStore(s => s.setDashboardDirty);
  const dashboardConfig = useAnnotationRunStore(s => s.dashboardConfig);

  const subjectEntityType = sourcePanel.projection?.roles?.[subjectRole]?.entity_type;
  const candidates = useMemo(() => {
    const filtered = subjectEntityType
      ? entities.filter(e => e.entity_type?.toLowerCase() === subjectEntityType.toLowerCase())
      : entities;
    if (!search.trim()) return filtered;
    const q = search.trim().toLowerCase();
    return filtered.filter(e => e.canonical_name.toLowerCase().includes(q));
  }, [entities, subjectEntityType, search]);

  const toggle = (name: string) =>
    setSelected(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);

  const handleConfirm = () => {
    if (!dashboardConfig) {
      toast.warning('No active dashboard.');
      return;
    }
    if (selected.length === 0) return;
    let clones: PanelConfig[];
    try {
      clones = buildComparisonSplitClones({
        sourcePanel,
        subjects: selected.map(name => ({ name, label: name })),
        schema: schema ?? null,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to build comparison clones.');
      return;
    }

    const N = clones.length;
    const cloneW = N <= 2 ? 6 : N === 3 ? 4 : 3;
    const cloneH = sourcePanel.grid_position?.h ?? 4;
    const maxY = Math.max(
      0,
      ...dashboardConfig.panels.map(p => (p.grid_position?.y ?? 0) + (p.grid_position?.h ?? 0)),
    );
    const placedClones: PanelConfig[] = clones.map((c, i) => ({
      ...c,
      grid_position: {
        x: (i * cloneW) % 12,
        y: maxY + Math.floor((i * cloneW) / 12) * cloneH,
        w: cloneW,
        h: cloneH,
      },
    }));

    setDashboardConfig({
      ...dashboardConfig,
      panels: [...dashboardConfig.panels, ...placedClones],
    });
    setDashboardDirty(true);
    toast.success(`Spawned ${N} comparison panel${N === 1 ? '' : 's'}.`);
    setSelected([]);
    setSearch('');
    setOpen(false);
  };

  if (!visible) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 flex-shrink-0"
          title={`Compare by ${subjectRole} — split this panel into siblings, one per subject`}
          aria-label={`Compare by ${subjectRole}`}
        >
          <Columns className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="end" side="bottom">
        <div className="p-2 border-b">
          <div className="text-xs font-semibold mb-1">
            Compare by {subjectRole}
            {subjectEntityType && (
              <span className="ml-1 text-muted-foreground font-normal">
                · {subjectEntityType}
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mb-2">
            Pick 2-4 subjects to spawn side-by-side panels.
          </div>
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter…"
            className="h-7 text-xs"
          />
        </div>
        <ScrollArea className="max-h-[260px]">
          <div className="p-1">
            {candidates.length === 0 && (
              <div className="text-[11px] italic text-muted-foreground px-2 py-2">
                No matching entities.
              </div>
            )}
            {candidates.map(e => {
              const isSelected = selected.includes(e.canonical_name);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggle(e.canonical_name)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-muted',
                    isSelected && 'bg-muted',
                  )}
                >
                  <span className={cn('h-3 w-3 shrink-0', !isSelected && 'opacity-0')}>
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="flex-1 truncate">{e.canonical_name}</span>
                  <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
                    {e.entity_type}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
        <div className="p-2 border-t flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {selected.length} selected
          </span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => { setSelected([]); setSearch(''); setOpen(false); }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleConfirm}
            disabled={selected.length === 0}
          >
            Spawn {selected.length || ''}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
