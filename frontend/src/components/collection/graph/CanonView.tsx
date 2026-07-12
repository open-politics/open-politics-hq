'use client';

/**
 * Canon workbench — the single surface for one canon and its entries.
 *
 * One table (canonical · type · aliases · tags · parents · properties), one
 * editor sheet, and the canon-level actions: edit metadata, import/export
 * (the portable file), merge, propose resolutions, delete-with-preview.
 * Entry creation uses the canon's id so each canon owns its members.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TagInput } from '@/components/ui/tag-input';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, Download, GitMerge, Inbox, Library, Loader2,
  MoreHorizontal, Pencil, Plus, Search, Shapes, Sparkles, Trash2, Upload,
} from 'lucide-react';
import {
  useCanon, useCanonEntities, useDeleteCanon, useMergeInCanon,
  useUpdateCanon, useExportCanon, useImportCanon, useCanonProposals, useEmbedCanon,
} from '@/hooks/useCanons';
import { CanonsService, EntitiesService } from '@/client';
import type { DeleteImpact, CanonEntryRead } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { DeletePreviewDialog } from './DeletePreviewDialog';
import { EntitySheet } from './EntitySheet';
import { ProposalReviewDialog } from './ProposalReviewDialog';
import { CanonProposalsPanel } from './CanonProposalsPanel';
import { CanonTypesEditor } from './CanonTypesEditor';
import { TypePicker } from './TypePicker';
import { toast } from 'sonner';

interface Props {
  canonId: number;
  onDeleted?: () => void;
}

type SortKey = 'canonical' | 'type';

export const CanonView: React.FC<Props> = ({ canonId, onDeleted }) => {
  const { activeInfospace } = useInfospaceStore();
  const { canon, loading: canonLoading, refresh: refreshCanon } = useCanon(canonId);
  const { entities, loading: entitiesLoading, refresh: refreshEntities } = useCanonEntities(canonId);
  const { merge, loading: merging } = useMergeInCanon();
  const { previewOrConfirm: previewDelete } = useDeleteCanon();
  const { update: updateCanon, loading: savingCanon } = useUpdateCanon();
  const { exportCanon } = useExportCanon();
  const { importCanon, loading: importing } = useImportCanon();
  const { embed: embedCanon, loading: embedding } = useEmbedCanon();
  const embeddingsOn = !!(activeInfospace?.enrichment_config as any)?.embedding?.model_name;
  // Pending proposals staged by "resolve into canon" mode. Always fetched (for
  // the count); the review section only renders when there's something to review.
  const { proposals: pendingProposals, refresh: refreshProposals } = useCanonProposals(canonId, { status: 'pending' });

  const [search, setSearch] = useState('');
  const [proposalsOpen, setProposalsOpen] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('canonical');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState('');
  const [creating, setCreating] = useState(false);
  const [isTypesOpen, setIsTypesOpen] = useState(false);

  const [mergeSelected, setMergeSelected] = useState<Set<number>>(new Set());
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [mergeKeepId, setMergeKeepId] = useState<number | null>(null);

  const [deleteEntityTarget, setDeleteEntityTarget] = useState<CanonEntryRead | null>(null);
  const [deletingEntity, setDeletingEntity] = useState(false);
  const [deleteCanonImpact, setDeleteCanonImpact] = useState<DeleteImpact | null>(null);
  const [editingEntity, setEditingEntity] = useState<CanonEntryRead | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposalTaskId, setProposalTaskId] = useState<string | null>(null);

  // Edit-canon dialog state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editExternalId, setEditExternalId] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);

  const visibleEntities = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = !q ? entities : entities.filter(e =>
      e.canonical.toLowerCase().includes(q) ||
      (e.type ?? '').toLowerCase().includes(q) ||
      (e.aliases ?? []).some(a => a.toLowerCase().includes(q)) ||
      (e.external_id ?? '').toLowerCase().includes(q),
    );
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) =>
      dir * (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '', undefined, { sensitivity: 'base' }),
    );
  }, [entities, search, sortKey, sortDir]);

  // Types already in use on entries — feed the type pickers alongside the
  // canon's declared types (the keys of type_schemas).
  const observedTypes = useMemo(() => {
    const s = new Set<string>();
    for (const e of entities) if (e.type) s.add(e.type);
    return Array.from(s);
  }, [entities]);
  const declaredTypes = useMemo(() => Object.keys(canon?.type_schemas ?? {}), [canon]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? <ChevronsUpDown className="h-3 w-3 opacity-40" />
      : sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;

  const handleCreate = useCallback(async () => {
    if (!activeInfospace || !createName.trim() || !createType.trim()) return;
    setCreating(true);
    try {
      await EntitiesService.createEntity({
        infospaceId: activeInfospace.id,
        requestBody: { canonical: createName.trim(), type: createType.trim(), canon_id: canonId },
      });
      toast.success('Entry created');
      setIsCreateOpen(false);
      setCreateName(''); setCreateType('');
      refreshEntities();
    } catch (e: any) {
      const detail = e?.body?.detail ?? e?.message ?? 'Failed to create entry';
      toast.error(typeof detail === 'string' ? detail : 'Failed to create entry');
    } finally {
      setCreating(false);
    }
  }, [activeInfospace, canonId, createName, createType, refreshEntities]);

  const toggleMergeSelect = (id: number) =>
    setMergeSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleMerge = useCallback(async () => {
    if (mergeSelected.size < 2 || !mergeKeepId) return;
    const result = await merge(canonId, Array.from(mergeSelected), mergeKeepId);
    if (result) {
      toast.success('Entries merged');
      setMergeSelected(new Set());
      setIsMergeOpen(false);
      setMergeKeepId(null);
      refreshEntities();
    }
  }, [merge, canonId, mergeSelected, mergeKeepId, refreshEntities]);

  const handleDeleteEntity = useCallback(async () => {
    if (!activeInfospace || !deleteEntityTarget) return;
    setDeletingEntity(true);
    try {
      await EntitiesService.deleteEntity({
        infospaceId: activeInfospace.id,
        entityId: deleteEntityTarget.id,
        requestBody: { confirm: true },
      });
      toast.success('Entry deleted');
      setDeleteEntityTarget(null);
      refreshEntities();
    } catch (e: any) {
      const detail = e?.body?.detail ?? e?.message ?? 'Failed to delete';
      toast.error(typeof detail === 'string' ? detail : 'Failed to delete');
    } finally {
      setDeletingEntity(false);
    }
  }, [activeInfospace, deleteEntityTarget, refreshEntities]);

  const beginDeleteCanon = useCallback(async () => {
    const preview = await previewDelete(canonId, false);
    if (preview) setDeleteCanonImpact(preview);
  }, [previewDelete, canonId]);

  const confirmDeleteCanon = useCallback(async () => {
    const result = await previewDelete(canonId, true);
    if (result?.confirmed) {
      toast.success('Canon deleted');
      setDeleteCanonImpact(null);
      onDeleted?.();
    }
  }, [previewDelete, canonId, onDeleted]);

  const handleProposeResolutions = useCallback(async () => {
    if (!activeInfospace) return;
    setProposing(true);
    try {
      const result = await CanonsService.proposeResolutionsAction({
        infospaceId: activeInfospace.id,
        requestBody: { target: 'entities', canon_id: canonId },
      }) as { task_id?: string };
      if (result?.task_id) setProposalTaskId(result.task_id);
      else toast.error('Dispatch did not return a task id');
    } catch (e: any) {
      const detail = e?.body?.detail ?? e?.message ?? 'Failed to dispatch';
      toast.error(typeof detail === 'string' ? detail : 'Failed to dispatch');
    } finally {
      setProposing(false);
    }
  }, [activeInfospace, canonId]);

  const openEdit = () => {
    if (!canon) return;
    setEditName(canon.name);
    setEditDesc(canon.description ?? '');
    setEditExternalId(canon.external_id ?? '');
    setEditTags(canon.tags ?? []);
    setIsEditOpen(true);
  };

  const handleSaveCanon = useCallback(async () => {
    const updated = await updateCanon(canonId, {
      name: editName.trim() || undefined,
      description: editDesc,
      external_id: editExternalId.trim() || null,
      tags: editTags,
    });
    if (updated) {
      toast.success('Canon updated');
      setIsEditOpen(false);
      refreshCanon();
    }
  }, [updateCanon, canonId, editName, editDesc, editExternalId, editTags, refreshCanon]);

  const handleExport = useCallback(async () => {
    if (!canon) return;
    const data = await exportCanon(canonId);
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(canon.name || 'canon').replace(/\s+/g, '-').toLowerCase()}.canon.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportCanon, canon, canonId]);

  const handleImportFile = useCallback(async (file: File) => {
    let payload: Record<string, any>;
    try { payload = JSON.parse(await file.text()); }
    catch { toast.error('Not a valid JSON file'); return; }
    const result = await importCanon(payload, canonId);
    if (result) refreshEntities();
  }, [importCanon, canonId, refreshEntities]);

  if (canonLoading || !canon) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isDefault = canon.id === activeInfospace?.default_canon_id;
  const isGeoDefault = canon.id === activeInfospace?.default_geo_canon_id;

  return (
    <div className="h-full flex flex-col">
      {/* ── Header: identity + metadata + canon-level menu ── */}
      <div className="border-b px-4 py-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Library className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h3 className="font-semibold truncate">{canon.name}</h3>
              {isDefault && <Badge variant="outline" className="text-[10px] font-normal">default</Badge>}
              {isGeoDefault && <Badge variant="outline" className="text-[10px] font-normal">geo</Badge>}
              <button onClick={openEdit} className="text-muted-foreground hover:text-foreground" aria-label="Edit canon">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
            {canon.description && <p className="text-xs text-muted-foreground">{canon.description}</p>}
            {(canon.external_id || (canon.tags ?? []).length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {canon.external_id && (
                  <span className="font-mono text-[10px] text-muted-foreground">{canon.external_id}</span>
                )}
                {(canon.tags ?? []).map(t => (
                  <Badge key={t} variant="secondary" className="text-[10px] font-normal">{t}</Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setIsTypesOpen(true)}>
              <Shapes className="h-3.5 w-3.5" />
              Types{declaredTypes.length > 0 ? ` (${declaredTypes.length})` : ''}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExport}><Download className="mr-2 h-3.5 w-3.5" />Export…</DropdownMenuItem>
                <DropdownMenuItem onClick={() => fileRef.current?.click()} disabled={importing}>
                  <Upload className="mr-2 h-3.5 w-3.5" />Import…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openEdit}><Pencil className="mr-2 h-3.5 w-3.5" />Edit canon</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsTypesOpen(true)}><Shapes className="mr-2 h-3.5 w-3.5" />Property types…</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => embedCanon(canonId)}
                  disabled={!embeddingsOn || embedding}
                  title={embeddingsOn ? 'Embed entries for fuzzy resolution' : 'Configure an embedding provider first'}
                >
                  <Sparkles className="mr-2 h-3.5 w-3.5" />Backfill embeddings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={beginDeleteCanon} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />Delete canon
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* ── Toolbar: search + primary actions ── */}
      <div className="border-b px-4 py-2 flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entries…"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <span className="text-xs text-muted-foreground">{visibleEntities.length} / {entities.length}</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-8" disabled={mergeSelected.size < 2}
          onClick={() => { setIsMergeOpen(true); setMergeKeepId(Array.from(mergeSelected)[0] ?? null); }}>
          <GitMerge className="h-3.5 w-3.5 mr-1" />Merge {mergeSelected.size > 0 ? `(${mergeSelected.size})` : ''}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" className="h-8" disabled={proposing || entities.length < 2} onClick={handleProposeResolutions}>
              {proposing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Scan for embedding-similar pairs to merge</TooltipContent>
        </Tooltip>
        <Button size="sm" className="h-8" onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />Entry
        </Button>
      </div>

      {/* ── Proposals: staged unmatched mentions awaiting human resolution ── */}
      {pendingProposals.length > 0 && (
        <div className="border-b">
          <button
            type="button"
            onClick={() => setProposalsOpen(o => !o)}
            className="flex w-full items-center gap-1.5 px-4 py-2 text-xs font-medium hover:bg-muted/40"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${proposalsOpen ? '' : '-rotate-90'}`} />
            <Inbox className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            Proposals ({pendingProposals.length})
          </button>
          {proposalsOpen && (
            <div className="max-h-64 overflow-y-auto px-4 pb-3">
              <CanonProposalsPanel
                canonId={canonId}
                onResolved={() => { refreshEntities(); refreshProposals(); }}
              />
            </div>
          )}
        </div>
      )}

      <ScrollArea className="flex-1">
        {entitiesLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : entities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Library className="h-10 w-10 mb-2 opacity-40" />
            <p className="text-sm">No entries yet.</p>
            <p className="text-xs mt-1">Curate from a run, import a canon file, or add one.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(true)}>Create entry</Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5 mr-1" />Import</Button>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('canonical')}>
                    Canonical <SortIcon k="canonical" />
                  </button>
                </TableHead>
                <TableHead>
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('type')}>
                    Type <SortIcon k="type" />
                  </button>
                </TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Parents</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleEntities.map(e => {
                const aliases = (e.aliases ?? []).filter(a => a !== e.canonical);
                return (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => setEditingEntity(e)}>
                    <TableCell onClick={(ev) => ev.stopPropagation()}>
                      <Checkbox checked={mergeSelected.has(e.id)} onCheckedChange={() => toggleMergeSelect(e.id)} aria-label={`Select ${e.canonical}`} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="truncate">{e.canonical}</span>
                      {e.external_id && <span className="ml-2 font-mono text-[10px] text-muted-foreground">{e.external_id}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 items-center">
                        {e.type && <Badge variant="secondary" className="font-normal">{e.type}</Badge>}
                        {(e.additional_types ?? []).map(t => <Badge key={t} variant="outline" className="text-[10px] font-normal">{t}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate text-xs">
                      {aliases.join(', ') || '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(e.tags ?? []).length === 0 ? <span className="text-xs text-muted-foreground">—</span>
                          : (e.tags ?? []).map(t => <Badge key={t} variant="secondary" className="text-[10px] font-normal">{t}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(e.parents ?? []).length === 0 ? '—' : `${(e.parents ?? []).length} ref${(e.parents ?? []).length > 1 ? 's' : ''}`}
                    </TableCell>
                    <TableCell onClick={(ev) => ev.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteEntityTarget(e)} aria-label={`Delete ${e.canonical}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ScrollArea>

      {/* Hidden import file input */}
      <input
        ref={fileRef} type="file" accept="application/json,.json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); e.target.value = ''; }}
      />

      {/* ── Edit canon ── */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit canon</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5"><Label className="text-xs">Name</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 text-sm" /></div>
            <div className="grid gap-1.5"><Label className="text-xs">Description</Label>
              <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} className="h-8 text-sm" /></div>
            <div className="grid gap-1.5"><Label className="text-xs">External ID</Label>
              <Input value={editExternalId} onChange={e => setEditExternalId(e.target.value)} placeholder="naturalearth:admin0 · …" className="h-8 text-sm font-mono" /></div>
            <div className="grid gap-1.5"><Label className="text-xs">Tags</Label>
              <TagInput value={editTags} onChange={setEditTags} placeholder="Organizational labels…" aria-label="Canon tags" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveCanon} disabled={savingCanon}>
              {savingCanon && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create entry ── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create entry in &ldquo;{canon.name}&rdquo;</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5"><Label className="text-xs">Canonical</Label>
              <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="The value everything folds to" className="h-8 text-sm" /></div>
            <div className="grid gap-1.5"><Label className="text-xs">Type</Label>
              <TypePicker value={createType} onValueChange={setCreateType} declaredTypes={declaredTypes} observedTypes={observedTypes} className="w-full" placeholder="country, person, organization…" /></div>
            <p className="text-[11px] text-muted-foreground">Aliases, tags, parents and properties are editable once created — open the entry.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !createName.trim() || !createType.trim()}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Merge ── */}
      <Dialog open={isMergeOpen} onOpenChange={setIsMergeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Merge entries</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Pick the entry to keep. Aliases, types and properties from the others fold into it.</p>
          <div className="grid gap-2 py-2">
            {Array.from(mergeSelected).map(id => {
              const e = entities.find(x => x.id === id);
              return e ? (
                <label key={e.id} className="flex items-center gap-2 p-2 rounded border cursor-pointer hover:bg-muted/50">
                  <input type="radio" name="keep" checked={mergeKeepId === e.id} onChange={() => setMergeKeepId(e.id)} />
                  <span className="font-medium">{e.canonical}</span>
                  {e.type && <Badge variant="secondary" className="text-xs font-normal">{e.type}</Badge>}
                </label>
              ) : null;
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMergeOpen(false)}>Cancel</Button>
            <Button onClick={handleMerge} disabled={merging || mergeSelected.size < 2 || !mergeKeepId}>
              {merging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteEntityTarget && (
        <Dialog open={!!deleteEntityTarget} onOpenChange={open => !open && setDeleteEntityTarget(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Delete entry?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              Delete &ldquo;{deleteEntityTarget.canonical}&rdquo;? Backing edges or curations will block this.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteEntityTarget(null)}>Cancel</Button>
              <Button onClick={handleDeleteEntity} disabled={deletingEntity}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {deletingEntity && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <DeletePreviewDialog
        open={!!deleteCanonImpact}
        impact={deleteCanonImpact}
        resourceLabel="canon"
        resourceName={canon.name}
        onConfirm={confirmDeleteCanon}
        onCancel={() => setDeleteCanonImpact(null)}
      />

      <EntitySheet
        entity={editingEntity}
        open={!!editingEntity}
        onClose={() => setEditingEntity(null)}
        onSaved={refreshEntities}
        typeSchemas={canon.type_schemas}
        entries={entities}
      />

      <CanonTypesEditor
        canon={canon}
        entries={entities}
        open={isTypesOpen}
        onClose={() => setIsTypesOpen(false)}
        onSaved={refreshCanon}
      />

      {proposalTaskId && (
        <ProposalReviewDialog
          open={!!proposalTaskId}
          onClose={() => setProposalTaskId(null)}
          canonId={canonId}
          taskId={proposalTaskId}
          onMerged={refreshEntities}
        />
      )}
    </div>
  );
};

export default CanonView;
