'use client';

/**
 * Top-level Canons surface: a searchable rail of the infospace's canons with a
 * workbench detail pane for the selected one.
 *
 *   Infospace > {Canons, Graphs}
 *
 * A canon is a portable vocabulary; multiple graphs resolve against the same
 * canon. Every infospace has a ``General`` canon (auto-created). New canons can
 * be authored from scratch or imported from a canon file.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Library, Loader2, Plus, Search, Upload } from 'lucide-react';
import { useCanons, useCreateCanon, useImportCanon } from '@/hooks/useCanons';
import { CanonView } from './CanonView';
import type { CanonCreate } from '@/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';

export const CanonsPanel: React.FC = () => {
  const { activeInfospace } = useInfospaceStore();
  const { canons, loading, refresh } = useCanons();
  const { create, loading: creating } = useCreateCanon();
  const { importCanon, loading: importing } = useImportCanon();

  const [selectedCanonId, setSelectedCanonId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-select the default canon (or the first) once loaded.
  useEffect(() => {
    if (selectedCanonId == null && canons.length > 0) {
      const defaultId = activeInfospace?.default_canon_id ?? null;
      const found = defaultId != null ? canons.find(c => c.id === defaultId) : null;
      setSelectedCanonId(found ? found.id : canons[0].id);
    }
  }, [canons, selectedCanonId, activeInfospace]);

  const sortedCanons = useMemo(() => {
    const q = search.trim().toLowerCase();
    const defaultId = activeInfospace?.default_canon_id;
    const filtered = !q ? canons : canons.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.external_id ?? '').toLowerCase().includes(q) ||
      (c.tags ?? []).some(t => t.toLowerCase().includes(q)),
    );
    return [...filtered].sort((a, b) => {
      if (a.id === defaultId) return -1;
      if (b.id === defaultId) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [canons, search, activeInfospace]);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    const body: CanonCreate = { name: createName.trim(), description: createDescription.trim() || null };
    const created = await create(body);
    if (created) {
      setIsCreateOpen(false);
      setCreateName(''); setCreateDescription('');
      setSelectedCanonId(created.id);
      refresh();
    }
  };

  const handleImportNew = async (file: File) => {
    let payload: Record<string, any>;
    try { payload = JSON.parse(await file.text()); }
    catch { toast.error('Not a valid JSON file'); return; }
    const created = await importCanon(payload); // no target → create/merge by external_id
    if (created) { setSelectedCanonId(created.id); refresh(); }
  };

  if (!activeInfospace) {
    return <p className="p-6 text-muted-foreground">Select an infospace to manage canons.</p>;
  }

  return (
    <div className="h-full flex">
      <div className="w-72 border-r flex flex-col">
        <div className="border-b px-3 py-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Library className="h-4 w-4" />Canons
          </h3>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => fileRef.current?.click()} disabled={importing}>
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Import a canon file</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setIsCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New canon</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search canons…" className="h-8 pl-7 text-sm" />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : sortedCanons.length === 0 ? (
            <div className="text-xs text-muted-foreground px-3 py-6 text-center">
              {canons.length === 0 ? 'No canons yet.' : 'No canons match.'}
            </div>
          ) : (
            <div className="py-1">
              {sortedCanons.map(canon => {
                const isSelected = canon.id === selectedCanonId;
                const isDefault = canon.id === activeInfospace.default_canon_id;
                const isGeoDefault = canon.id === activeInfospace.default_geo_canon_id;
                return (
                  <button
                    key={canon.id}
                    onClick={() => setSelectedCanonId(canon.id)}
                    className={`w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-start gap-2 ${isSelected ? 'bg-muted' : ''}`}
                  >
                    <Library className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium truncate">{canon.name}</span>
                        {isDefault && <Badge variant="outline" className="text-[9px] px-1 h-4 font-normal">default</Badge>}
                        {isGeoDefault && <Badge variant="outline" className="text-[9px] px-1 h-4 font-normal">geo</Badge>}
                      </div>
                      {canon.description && <p className="text-[11px] text-muted-foreground truncate">{canon.description}</p>}
                      {(canon.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {(canon.tags ?? []).slice(0, 3).map(t => (
                            <Badge key={t} variant="secondary" className="text-[9px] px-1 h-4 font-normal">{t}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      <div className="flex-1 min-w-0">
        {selectedCanonId ? (
          <CanonView canonId={selectedCanonId} onDeleted={() => { setSelectedCanonId(null); refresh(); }} />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <p className="text-sm">Select a canon, or create one.</p>
          </div>
        )}
      </div>

      <input
        ref={fileRef} type="file" accept="application/json,.json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportNew(f); e.target.value = ''; }}
      />

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create canon</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5"><Label className="text-xs">Name</Label>
              <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="e.g. Politics 2024" className="h-8 text-sm" /></div>
            <div className="grid gap-1.5"><Label className="text-xs">Description (optional)</Label>
              <Input value={createDescription} onChange={e => setCreateDescription(e.target.value)} placeholder="Brief description" className="h-8 text-sm" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CanonsPanel;
