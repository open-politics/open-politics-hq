'use client';

/**
 * Top-level Canons surface: list of canons in the active infospace, with a
 * detail pane for the selected canon.
 *
 * Mental model:
 *
 *   Infospace > {Canons, Graphs}
 *
 * A canon is a vocabulary; multiple graphs can resolve against the same canon.
 * Every infospace has at least one ``General`` canon (auto-created) and may
 * have a ``geo`` canon for cached coordinates.
 */

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Library, Loader2, MapPin, Plus, Users } from 'lucide-react';
import { useCanons, useCreateCanon } from '@/hooks/useCanons';
import { CanonView } from './CanonView';
import type { CanonCreate } from '@/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

export const CanonsPanel: React.FC = () => {
  const { activeInfospace } = useInfospaceStore();
  const { canons, loading, refresh } = useCanons();
  const { create, loading: creating } = useCreateCanon();

  const [selectedCanonId, setSelectedCanonId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createRole, setCreateRole] = useState<'general' | 'geo'>('general');

  // Auto-select the General default canon (or the first canon) once loaded.
  useEffect(() => {
    if (selectedCanonId == null && canons.length > 0) {
      const defaultId = activeInfospace?.default_canon_id ?? null;
      const found = defaultId != null ? canons.find(c => c.id === defaultId) : null;
      setSelectedCanonId(found ? found.id : canons[0].id);
    }
  }, [canons, selectedCanonId, activeInfospace]);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    const body: CanonCreate = {
      name: createName.trim(),
      description: createDescription.trim() || null,
      role: createRole,
    };
    const created = await create(body);
    if (created) {
      setIsCreateOpen(false);
      setCreateName('');
      setCreateDescription('');
      setCreateRole('general');
      setSelectedCanonId(created.id);
      refresh();
    }
  };

  if (!activeInfospace) {
    return <p className="p-6 text-muted-foreground">Select an infospace to manage canons.</p>;
  }

  return (
    <div className="h-full flex">
      <div className="w-64 border-r flex flex-col">
        <div className="border-b px-3 py-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Library className="h-4 w-4" />
            Canons
          </h3>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : canons.length === 0 ? (
            <div className="text-xs text-muted-foreground px-3 py-6 text-center">
              No canons yet.
            </div>
          ) : (
            <div className="py-1">
              {canons.map(canon => {
                const isSelected = canon.id === selectedCanonId;
                const isDefault = canon.id === activeInfospace.default_canon_id;
                const isGeoDefault = canon.id === activeInfospace.default_geo_canon_id;
                const Icon = canon.role === 'geo' ? MapPin : Users;
                return (
                  <button
                    key={canon.id}
                    onClick={() => setSelectedCanonId(canon.id)}
                    className={`w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-start gap-2 ${
                      isSelected ? 'bg-muted' : ''
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium truncate">{canon.name}</span>
                        {isDefault && <Badge variant="outline" className="text-[9px] px-1 h-4">default</Badge>}
                        {isGeoDefault && <Badge variant="outline" className="text-[9px] px-1 h-4">geo</Badge>}
                      </div>
                      {canon.description && (
                        <p className="text-[11px] text-muted-foreground truncate">{canon.description}</p>
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
          <CanonView
            canonId={selectedCanonId}
            onDeleted={() => {
              setSelectedCanonId(null);
              refresh();
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <p className="text-sm">Select a canon, or create a new one.</p>
          </div>
        )}
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create canon</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="e.g. Politics 2024"
              />
            </div>
            <div className="grid gap-2">
              <Label>Description (optional)</Label>
              <Input
                value={createDescription}
                onChange={e => setCreateDescription(e.target.value)}
                placeholder="Brief description"
              />
            </div>
            <div className="grid gap-2">
              <Label>Role</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={createRole}
                onChange={e => setCreateRole(e.target.value as 'general' | 'geo')}
              >
                <option value="general">General — entities and concepts</option>
                <option value="geo">Geo — places with cached coordinates</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CanonsPanel;
