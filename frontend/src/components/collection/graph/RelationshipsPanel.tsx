'use client';

/**
 * Floating overlay panel for graph-scoped relationships.
 *
 * Each row is a derived per-pair aggregate over GraphEdge: edge_count +
 * predicates, optionally overlaid with a materialized EntityRelationship
 * row (pin / label / notes / tags). Click a row to edit the overlay; click
 * the focus icon to centre the pair on the graph.
 *
 * Data source: backend ``GET /infospaces/{iid}/graphs/{gid}/relationships``
 * (canonical-ordered groupby with LEFT JOIN). The panel filters by tag /
 * pinned-only by re-fetching with query params, and by name in-memory.
 */

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Pin, PinOff, Search, Tag, Target, X } from 'lucide-react';
import type { EntityRelationshipRead } from '@/client';
import { useRelationships, useUpsertRelationship } from '@/hooks/useRelationships';
import { RelationshipDialog } from './RelationshipDialog';
import type { GraphNode } from './graphTypes';

interface Props {
  graphId: number;
  /** Used to render entity labels by id. Built once per render in the parent. */
  nodesById: Map<number, GraphNode>;
  /** Click → focus this pair in the graph (highlight + zoom). */
  onSelectPair?: (a: number, b: number) => void;
  onClose: () => void;
}

const formatLabel = (n: GraphNode | undefined, fallback: number) =>
  n?.label || `#${fallback}`;

export const RelationshipsPanel: React.FC<Props> = ({
  graphId, nodesById, onSelectPair, onClose,
}) => {
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');

  const { relationships, loading, refresh } = useRelationships(graphId, {
    pinnedOnly,
    tags: activeTags.length > 0 ? activeTags : undefined,
  });
  const { upsert } = useUpsertRelationship();

  const [editing, setEditing] = useState<{
    a: { id: number; label: string };
    b: { id: number; label: string };
    initial: EntityRelationshipRead | null;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return relationships;
    return relationships.filter(r => {
      const aLabel = formatLabel(nodesById.get(r.entity_a_id), r.entity_a_id).toLowerCase();
      const bLabel = formatLabel(nodesById.get(r.entity_b_id), r.entity_b_id).toLowerCase();
      return aLabel.includes(q) || bLabel.includes(q);
    });
  }, [relationships, searchInput, nodesById]);

  // Tag universe — collect across all materialized rows so users see the
  // tags that exist in the graph, not just the ones currently selected.
  const tagUniverse = useMemo(() => {
    const set = new Set<string>();
    for (const r of relationships) (r.tags ?? []).forEach(t => set.add(t));
    return Array.from(set).sort();
  }, [relationships]);

  const toggleTag = (t: string) =>
    setActiveTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const togglePin = async (row: EntityRelationshipRead) => {
    await upsert(graphId, row.entity_a_id, row.entity_b_id, {
      is_pinned: !row.is_pinned,
    });
    refresh();
  };

  return (
    <>
      <div
        className="absolute top-2 right-2 z-30 w-[400px] max-w-[40%] max-h-[calc(100%-1rem)] flex flex-col bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="border-b px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pin className="h-3.5 w-3.5" />
            <h3 className="text-sm font-semibold">Relationships</h3>
            <span className="text-xs text-muted-foreground">{filtered.length}/{relationships.length}</span>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>

        <div className="px-3 py-2 space-y-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by entity..."
              className="h-7 text-xs pl-7"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant={pinnedOnly ? 'default' : 'outline'}
              className="h-6 text-[11px] px-2"
              onClick={() => setPinnedOnly(v => !v)}
            >
              {pinnedOnly ? <Pin className="h-3 w-3 mr-1" /> : <PinOff className="h-3 w-3 mr-1" />}
              Pinned
            </Button>
            {tagUniverse.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <Tag className="h-3 w-3 text-muted-foreground" />
                {tagUniverse.map(t => {
                  const active = activeTags.includes(t);
                  return (
                    <Badge
                      key={t}
                      variant={active ? 'default' : 'outline'}
                      className="text-[10px] cursor-pointer hover:bg-muted"
                      onClick={() => toggleTag(t)}
                    >
                      {t}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-6 px-3">
              {relationships.length === 0
                ? 'No relationships in this graph yet. Curate triplets to see derived pairs here.'
                : 'No matches for current filters.'}
            </div>
          ) : (
            <div>
              {filtered.map(row => {
                const a = nodesById.get(row.entity_a_id);
                const b = nodesById.get(row.entity_b_id);
                const aLabel = formatLabel(a, row.entity_a_id);
                const bLabel = formatLabel(b, row.entity_b_id);
                const tombstoned = row.is_active === false;
                return (
                  <div
                    key={`${row.entity_a_id}-${row.entity_b_id}`}
                    className={`px-3 py-2 border-b hover:bg-muted/30 ${tombstoned ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        title={row.is_pinned ? 'Unpin' : 'Pin'}
                        className={`mt-0.5 ${row.is_pinned ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
                        onClick={(e) => { e.stopPropagation(); togglePin(row); }}
                      >
                        {row.is_pinned ? <Pin className="h-3.5 w-3.5 fill-current" /> : <PinOff className="h-3.5 w-3.5" />}
                      </button>

                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left"
                        onClick={() => setEditing({
                          a: { id: row.entity_a_id, label: aLabel },
                          b: { id: row.entity_b_id, label: bLabel },
                          initial: row,
                        })}
                      >
                        <div className="text-sm flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium truncate">{aLabel}</span>
                          <span className="text-muted-foreground">↔</span>
                          <span className="font-medium truncate">{bLabel}</span>
                          {tombstoned && <Badge variant="destructive" className="text-[9px]">removed</Badge>}
                        </div>

                        <div className="flex flex-wrap items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                          <span>{row.edge_count} edge{row.edge_count === 1 ? '' : 's'}</span>
                          {row.predicates && row.predicates.length > 0 && (
                            <>
                              <span className="opacity-50">·</span>
                              {row.predicates.slice(0, 3).map(p => (
                                <Badge key={p} variant="outline" className="text-[9px] font-mono px-1 py-0">{p}</Badge>
                              ))}
                              {row.predicates.length > 3 && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0">+{row.predicates.length - 3}</Badge>
                              )}
                            </>
                          )}
                        </div>

                        {row.label && (
                          <p className="text-[11px] text-foreground italic mt-0.5 truncate">{row.label}</p>
                        )}
                        {row.tags && row.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {row.tags.map(t => (
                              <Badge key={t} variant="secondary" className="text-[9px] px-1 py-0">{t}</Badge>
                            ))}
                          </div>
                        )}
                        {row.notes && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{row.notes}</p>
                        )}
                      </button>

                      {onSelectPair && (
                        <button
                          type="button"
                          title="Focus on graph"
                          className="mt-0.5 text-muted-foreground hover:text-foreground"
                          onClick={(e) => { e.stopPropagation(); onSelectPair(row.entity_a_id, row.entity_b_id); }}
                        >
                          <Target className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {editing && (
        <RelationshipDialog
          graphId={graphId}
          entityA={editing.a}
          entityB={editing.b}
          initial={editing.initial}
          open={!!editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
};

export default RelationshipsPanel;
