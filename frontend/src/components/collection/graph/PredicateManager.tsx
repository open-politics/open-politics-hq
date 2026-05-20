'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, GitMerge, Search } from 'lucide-react';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

interface PredicateSummary {
  predicate: string;
  count: number;
}

async function fetchPredicates(infospaceId: number): Promise<PredicateSummary[]> {
  const res = await fetch(`/api/v1/infospaces/${infospaceId}/knowledge-graphs/predicates/summary`);
  if (!res.ok) throw new Error('Failed to load predicates');
  return res.json();
}

async function renamePredicates(infospaceId: number, oldPredicates: string[], newPredicate: string): Promise<{ updated: number }> {
  const res = await fetch(`/api/v1/infospaces/${infospaceId}/knowledge-graphs/predicates/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_predicates: oldPredicates, new_predicate: newPredicate }),
  });
  if (!res.ok) throw new Error('Failed to rename predicates');
  return res.json();
}

const PredicateManager: React.FC = () => {
  const { activeInfospace } = useInfospaceStore();
  const [predicates, setPredicates] = useState<PredicateSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadPredicates = useCallback(async () => {
    if (!activeInfospace?.id) return;
    setIsLoading(true);
    try {
      const data = await fetchPredicates(activeInfospace.id);
      setPredicates(data);
    } catch {
      toast.error('Failed to load connections');
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace?.id]);

  useEffect(() => { loadPredicates(); }, [loadPredicates]);

  const toggleSelect = (predicate: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(predicate)) next.delete(predicate);
      else next.add(predicate);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(p => p.predicate)));
  };

  const openMerge = () => {
    if (selected.size < 2) { toast.error('Select at least 2 connections to merge'); return; }
    const sorted = predicates.filter(p => selected.has(p.predicate)).sort((a, b) => b.count - a.count);
    setMergeTarget(sorted[0]?.predicate || '');
    setIsMergeOpen(true);
  };

  const executeMerge = async () => {
    if (!activeInfospace?.id || !mergeTarget.trim()) return;
    setIsSaving(true);
    try {
      const oldPredicates = Array.from(selected).filter(p => p !== mergeTarget.trim());
      const result = await renamePredicates(activeInfospace.id, oldPredicates, mergeTarget.trim());
      toast.success(`Merged ${result.updated} edges into "${mergeTarget.trim()}"`);
      setSelected(new Set());
      setIsMergeOpen(false);
      loadPredicates();
    } catch {
      toast.error('Failed to merge connections');
    } finally {
      setIsSaving(false);
    }
  };

  const filtered = searchFilter
    ? predicates.filter(p => p.predicate.toLowerCase().includes(searchFilter.toLowerCase()))
    : predicates;

  const totalEdges = predicates.reduce((sum, p) => sum + p.count, 0);

  if (!activeInfospace?.id) return <p className="text-muted-foreground text-sm p-4">Select an infospace first.</p>;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Connections</h3>
          <p className="text-xs text-muted-foreground">
            {predicates.length} connection type{predicates.length === 1 ? '' : 's'}, {totalEdges} edge{totalEdges === 1 ? '' : 's'} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size >= 2 && (
            <Button size="sm" variant="default" onClick={openMerge} className="text-xs h-7">
              <GitMerge className="h-3 w-3 mr-1" />
              Merge {selected.size}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={loadPredicates} disabled={isLoading} className="text-xs h-7">
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Filter connections..."
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
          className="h-8 text-xs pl-8"
        />
      </div>

      {/* Table */}
      <ScrollArea className="max-h-[calc(100vh-20rem)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={selected.size > 0 && selected.size === filtered.length}
                  onCheckedChange={selectAll}
                />
              </TableHead>
              <TableHead className="text-xs">Connection</TableHead>
              <TableHead className="text-xs text-right">Edges</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(({ predicate, count }) => (
              <TableRow key={predicate} className="cursor-pointer" onClick={() => toggleSelect(predicate)}>
                <TableCell>
                  <Checkbox checked={selected.has(predicate)} onCheckedChange={() => toggleSelect(predicate)} />
                </TableCell>
                <TableCell className="text-xs font-mono">{predicate}</TableCell>
                <TableCell className="text-xs text-right">
                  <Badge variant="secondary" className="text-[10px]">{count}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-8">
                  {searchFilter ? 'No matching connections' : 'No connections yet'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Merge Dialog */}
      <Dialog open={isMergeOpen} onOpenChange={setIsMergeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Merge connections</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Merging {selected.size} connections. All edges will use the target name.
            </div>
            <div className="flex flex-wrap gap-1">
              {Array.from(selected).map(p => (
                <Badge key={p} variant="outline" className="text-[10px] font-mono">{p}</Badge>
              ))}
            </div>
            <div>
              <Label className="text-xs">Target connection name</Label>
              <Input
                value={mergeTarget}
                onChange={e => setMergeTarget(e.target.value)}
                className="h-8 text-xs font-mono mt-1"
                placeholder="merged_connection_name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsMergeOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={executeMerge} disabled={isSaving || !mergeTarget.trim()}>
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <GitMerge className="h-3 w-3 mr-1" />}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PredicateManager;
