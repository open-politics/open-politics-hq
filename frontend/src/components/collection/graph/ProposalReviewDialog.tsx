'use client';

/**
 * Streaming review dialog for ``propose_resolutions`` task output.
 *
 * Subscribes to ``resolution.proposals/{task_id}`` SSE stream. Each
 * ``proposal`` event appends a row; the ``done`` event flips the dialog
 * into "complete" state. The user accepts or skips each proposal one at
 * a time:
 *
 * - Entity proposal — ``mergeInCanon(canon_id, [keep_id, ...candidate_ids],
 *   keep_id)`` collapses duplicates into the keep entity.
 * - Predicate proposal — ``RenamePredicates({old_predicates: candidates,
 *   new_predicate: keep})`` renames graph edges in bulk.
 *
 * The task itself never writes to the DB — that's the explicit-consent
 * invariant. This dialog is the only place where proposals turn into
 * mutations.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, GitMerge, Loader2, Sparkles, Users, X } from 'lucide-react';
import { CanonsService, KnowledgeGraphsService } from '@/client';
import { useStream } from '@/hooks/useStream';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';

interface ResolutionProposal {
  kind: 'entity' | 'predicate';
  keep: string;
  keep_id?: number | null;
  candidates: string[];
  candidate_ids: number[];
  similarity: number;
  type?: string | null;
}

interface DoneStats {
  total: number;
  entities: number;
  predicates: number;
}

type RowState = 'pending' | 'merging' | 'merged' | 'skipped' | 'failed';

interface Row extends ResolutionProposal {
  id: string;        // synthetic stable id for keys + per-row state
  state: RowState;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Canon being scanned. Required for entity-merge accept path. */
  canonId: number;
  /** task_id returned by ``proposeResolutionsAction``; identifies the stream. */
  taskId: string;
  /** Fired after the dialog closes if any merges happened. */
  onMerged?: () => void;
}

const proposalKey = (p: ResolutionProposal): string => {
  const cand = p.candidate_ids.length > 0 ? p.candidate_ids.join(',') : p.candidates.join(',');
  return `${p.kind}:${p.keep_id ?? p.keep}:${cand}`;
};

export const ProposalReviewDialog: React.FC<Props> = ({
  open, onClose, canonId, taskId, onMerged,
}) => {
  const { activeInfospace } = useInfospaceStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [doneStats, setDoneStats] = useState<DoneStats | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [merged, setMerged] = useState(false);

  useStream<ResolutionProposal | DoneStats | { detail: string }>({
    infospaceId: activeInfospace?.id ?? 0,
    topic: 'resolution.proposals',
    resourceId: taskId,
    enabled: open && !!activeInfospace && !!taskId,
    onEvent: (event) => {
      if (event.type === 'proposal') {
        const p = event.data as ResolutionProposal;
        setRows(prev => {
          const id = proposalKey(p);
          if (prev.some(r => r.id === id)) return prev;
          return [...prev, { ...p, id, state: 'pending' }];
        });
      } else if (event.type === 'done') {
        setDoneStats(event.data as DoneStats);
      } else if (event.type === 'error') {
        setStreamError((event.data as any)?.detail ?? 'scan error');
      }
    },
  });

  const setRowState = (id: string, state: RowState) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, state } : r));
  };

  const acceptEntity = useCallback(async (row: Row) => {
    if (!activeInfospace || row.keep_id == null || row.candidate_ids.length === 0) return;
    setRowState(row.id, 'merging');
    try {
      await CanonsService.mergeInCanon({
        infospaceId: activeInfospace.id,
        canonId,
        requestBody: {
          entity_ids: [row.keep_id, ...row.candidate_ids],
          keep_id: row.keep_id,
        },
      });
      setRowState(row.id, 'merged');
      setMerged(true);
    } catch (e: any) {
      setRowState(row.id, 'failed');
      const detail = e?.body?.detail ?? e?.message ?? 'Merge failed';
      toast.error(typeof detail === 'string' ? detail : 'Merge failed');
    }
  }, [activeInfospace, canonId]);

  const acceptPredicate = useCallback(async (row: Row) => {
    if (!activeInfospace || row.candidates.length === 0) return;
    setRowState(row.id, 'merging');
    try {
      await KnowledgeGraphsService.renamePredicates({
        infospaceId: activeInfospace.id,
        requestBody: {
          old_predicates: row.candidates,
          new_predicate: row.keep,
        },
      });
      setRowState(row.id, 'merged');
      setMerged(true);
    } catch (e: any) {
      setRowState(row.id, 'failed');
      const detail = e?.body?.detail ?? e?.message ?? 'Rename failed';
      toast.error(typeof detail === 'string' ? detail : 'Rename failed');
    }
  }, [activeInfospace]);

  const handleAccept = (row: Row) => {
    if (row.kind === 'entity') void acceptEntity(row);
    else void acceptPredicate(row);
  };

  const handleSkip = (id: string) => setRowState(id, 'skipped');

  const handleClose = () => {
    if (merged) onMerged?.();
    setRows([]);
    setDoneStats(null);
    setStreamError(null);
    setMerged(false);
    onClose();
  };

  const pendingCount = useMemo(() => rows.filter(r => r.state === 'pending').length, [rows]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Resolution proposals
          </DialogTitle>
        </DialogHeader>

        <div className="text-xs text-muted-foreground space-y-0.5">
          {streamError ? (
            <p className="text-destructive">Error: {streamError}</p>
          ) : doneStats ? (
            <p>
              Scan complete — {doneStats.total} total
              {doneStats.entities > 0 && ` (${doneStats.entities} entit${doneStats.entities === 1 ? 'y' : 'ies'})`}
              {doneStats.predicates > 0 && ` (${doneStats.predicates} connection${doneStats.predicates === 1 ? '' : 's'})`}
            </p>
          ) : (
            <p className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Scanning… {rows.length} proposal{rows.length === 1 ? '' : 's'} so far
            </p>
          )}
          {pendingCount > 0 && doneStats && (
            <p>{pendingCount} pending review</p>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0 max-h-[55vh]">
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              {doneStats
                ? 'Nothing similar enough to propose at the current threshold.'
                : 'Awaiting first proposal...'}
            </div>
          ) : (
            <div className="space-y-2 py-1 pr-3">
              {rows.map(row => {
                const Icon = row.kind === 'entity' ? Users : GitMerge;
                const dim = row.state !== 'pending';
                return (
                  <div
                    key={row.id}
                    className={`border rounded-md p-2.5 space-y-1.5 ${dim ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm flex flex-wrap items-center gap-1.5">
                          <span className="font-medium truncate">{row.keep}</span>
                          <span className="text-muted-foreground text-xs">←</span>
                          <span className="font-medium truncate">{row.candidates.join(', ')}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px]">
                            sim {(row.similarity * 100).toFixed(0)}%
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {row.kind === 'entity' ? 'entity' : 'connection'}
                          </Badge>
                          {row.type && (
                            <Badge variant="outline" className="text-[10px]">{row.type}</Badge>
                          )}
                          {row.state === 'merged' && (
                            <Badge className="text-[10px] gap-1 bg-green-100 text-green-800 hover:bg-green-100">
                              <Check className="h-3 w-3" />
                              merged
                            </Badge>
                          )}
                          {row.state === 'skipped' && (
                            <Badge variant="outline" className="text-[10px]">skipped</Badge>
                          )}
                          {row.state === 'failed' && (
                            <Badge variant="destructive" className="text-[10px]">failed</Badge>
                          )}
                        </div>
                      </div>
                      {row.state === 'pending' && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleAccept(row)}
                            disabled={row.kind === 'entity' && row.keep_id == null}
                          >
                            <GitMerge className="h-3 w-3 mr-1" />
                            Merge
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleSkip(row.id)}
                          >
                            <X className="h-3 w-3 mr-1" />
                            Skip
                          </Button>
                        </div>
                      )}
                      {row.state === 'merging' && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0 mt-1.5" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {pendingCount > 0 ? 'Done (skip remaining)' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProposalReviewDialog;
