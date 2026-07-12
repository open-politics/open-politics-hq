'use client';

/**
 * Pending CanonProposals review — the human side of "resolve into canon" mode.
 *
 * When a run resolves into a canon settled-only, exact/alias matches auto-apply
 * and every unmatched mention parks here as a durable CanonProposal. The
 * reviewer settles each one: merge the surface into an existing entry (alias
 * append), create a fresh entry, or dismiss it (which never re-prompts —
 * repeat sightings only bump its count). Settling re-curates the run so the
 * edges that were blocked while the surface was unsettled finally land.
 *
 * Mirrors ProposalReviewDialog's row layout, but these are persisted DB rows
 * (not a streaming scan) so each action hits the proposal action routes.
 */

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { GitMerge, Loader2, Plus, Tag, X } from 'lucide-react';
import { useCanonProposals, useAcceptProposal, useDismissProposal, useBulkTriageProposals, useCanonEntities } from '@/hooks/useCanons';

interface Props {
  canonId: number;
  /** When set, only proposals staged by this run are shown. */
  runId?: number;
  /** Fired after any proposal is accepted or dismissed (so the host can refresh entries). */
  onResolved?: () => void;
}

export const CanonProposalsPanel: React.FC<Props> = ({ canonId, runId, onResolved }) => {
  const { proposals, loading, refresh } = useCanonProposals(canonId, { status: 'pending', runId });
  const { entities } = useCanonEntities(canonId);
  const { accept } = useAcceptProposal();
  const { dismiss } = useDismissProposal();
  const { bulk, loading: bulkLoading } = useBulkTriageProposals();

  const [busyId, setBusyId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const entryNameById = useMemo(
    () => new Map(entities.map(e => [e.id, e.canonical])),
    [entities],
  );

  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allSelected = proposals.length > 0 && selected.size === proposals.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(proposals.map(p => p.id)));

  const handleAccept = async (proposalId: number, mergeIntoEntryId?: number) => {
    setBusyId(proposalId);
    const res = await accept(canonId, proposalId, mergeIntoEntryId);
    setBusyId(null);
    if (res) { await refresh(); onResolved?.(); }
  };

  const handleDismiss = async (proposalId: number) => {
    setBusyId(proposalId);
    const res = await dismiss(canonId, proposalId);
    setBusyId(null);
    if (res) { await refresh(); onResolved?.(); }
  };

  // Bulk supports the two universal actions (create-new / dismiss); the nuanced
  // merge-into-a-specific-entry stays per-row since each target differs.
  const handleBulk = async (kind: 'create' | 'dismiss') => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const res = await bulk(canonId, kind === 'create'
      ? { accept: ids.map(id => ({ proposal_id: id })) }
      : { dismiss: ids });
    if (res) { setSelected(new Set()); await refresh(); onResolved?.(); }
  };

  if (loading && proposals.length === 0) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (proposals.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No pending proposals.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all proposals" />
          {selected.size > 0 ? `${selected.size} selected` : `${proposals.length} pending`}
        </label>
        {selected.size > 0 && (
          <div className="flex items-center gap-1">
            {bulkLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={bulkLoading} onClick={() => handleBulk('create')}>
              <Plus className="h-3 w-3 mr-1" />Create new ({selected.size})
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={bulkLoading} onClick={() => handleBulk('dismiss')}>
              <X className="h-3 w-3 mr-1" />Dismiss ({selected.size})
            </Button>
          </div>
        )}
      </div>
      {selected.size === 0 && (
        <p className="text-xs text-muted-foreground">Settled-only mode stages unmatched mentions here.</p>
      )}

      <div className="space-y-2">
        {proposals.map(p => {
          const busy = busyId === p.id;
          const suggestions = p.suggested_entry_ids ?? [];
          return (
            <div key={p.id} className={`border rounded-md p-2.5 space-y-1.5 ${busy ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-2">
                <Checkbox
                  className="mt-0.5 shrink-0"
                  checked={selected.has(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                  aria-label={`Select ${p.surface}`}
                />
                <Tag className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm flex flex-wrap items-center gap-1.5">
                    <span className="font-medium truncate">{p.surface}</span>
                    <Badge variant="secondary" className="text-[10px]">{p.type}</Badge>
                    <span className="text-[10px] text-muted-foreground">seen ×{p.occurrence_count ?? 0}</span>
                  </div>
                </div>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0 mt-1" />}
              </div>

              <div className="flex flex-wrap items-center gap-1 pl-5">
                {suggestions.map(sid => (
                  <Button
                    key={sid}
                    size="sm"
                    variant="default"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => handleAccept(p.id, sid)}
                  >
                    <GitMerge className="h-3 w-3 mr-1" />
                    Merge → {entryNameById.get(sid) ?? `Entry ${sid}`}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={busy}
                  onClick={() => handleAccept(p.id)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Create new
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={busy}
                  onClick={() => handleDismiss(p.id)}
                >
                  <X className="h-3 w-3 mr-1" />
                  Dismiss
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CanonProposalsPanel;
