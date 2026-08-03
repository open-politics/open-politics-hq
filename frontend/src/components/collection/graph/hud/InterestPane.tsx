'use client';

/**
 * InterestPane — the `why` axis, read three ways.
 *
 * **Profile** — how much of a selected actor's activity each interest accounts
 * for. Derived from `actor → occurrence → interest`, never asserted.
 *
 * **Impact** — how big an interest is: acts, actors, magnitude, span, places.
 *
 * **Convergence** — who aligns disproportionately to their connection. The one
 * question here that cannot be asked any other way.
 *
 * Every number in this pane is computed from the graph on screen, so it always
 * matches what the canvas shows. And every one of them is downstream of a
 * `serves[]` that a schema required a justification for — which is the property
 * that keeps this on the analysis side of the line. An interest with no quote
 * behind it should never have reached the graph.
 */
import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, Users } from 'lucide-react';
import type { GraphEdge, GraphNode } from '../graphTypes';
import { convergencePairs, interestImpact } from './convergence';

type Tab = 'profile' | 'impact' | 'converge';

interface Props {
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  /** Write a `serves:` filter — clicking an interest scopes everything. */
  onScopeToInterest?: (interest: string) => void;
}

function Bars({ entries }: { entries: Array<[string, number]> }) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <ul className="space-y-0.5 px-2.5 py-1.5">
      {entries.map(([label, v]) => (
        <li key={label} className="text-[11px]">
          <div className="flex items-baseline gap-1">
            <span className="truncate">{label}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {v.toLocaleString()}
            </span>
          </div>
          <div className="mt-px h-1 rounded-sm bg-muted">
            <div className="h-full rounded-sm bg-primary/60"
                 style={{ width: `${(v / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function InterestPane({
  nodes, edges, selectedNodeId, onSelectNode, onScopeToInterest,
}: Props) {
  const [tab, setTab] = useState<Tab>('impact');

  const selected = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const profile = useMemo(() => {
    const g = selected?.groupValue;
    if (!g || typeof g !== 'object' || Array.isArray(g)) return [];
    return Object.entries(g as Record<string, number>).sort((a, b) => b[1] - a[1]);
  }, [selected]);

  const impact = useMemo(() => interestImpact(nodes, edges), [nodes, edges]);
  const pairs = useMemo(() => convergencePairs(nodes, edges), [nodes, edges]);

  const TABS: Array<[Tab, string, number]> = [
    ['impact', 'Impact', impact.length],
    ['profile', 'Profile', profile.length],
    ['converge', 'Converge', pairs.length],
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-border/40 px-2 py-1">
        {TABS.map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'rounded px-1.5 text-[10px]',
              tab === id ? 'bg-primary/15 text-foreground'
                         : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        profile.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            Select an actor to see what their activity serves. The profile is
            derived from their acts, not declared.
          </p>
        ) : <Bars entries={profile} />
      )}

      {tab === 'impact' && (
        impact.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            No interests in view. Bind <code>serves</code> on an observation
            projection to enable this.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {impact.map(r => (
              <li key={r.interest}>
                <button
                  type="button"
                  onClick={() => onScopeToInterest?.(r.interest)}
                  className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-muted/60"
                >
                  <div className="truncate font-medium">{r.interest}</div>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <span className="tabular-nums">{r.occurrences} acts</span>
                    <span className="tabular-nums">{r.actors} actors</span>
                    {r.magnitude > 0 && (
                      <span className="tabular-nums">Σ {r.magnitude.toLocaleString()}</span>
                    )}
                    {r.places > 0 && <span className="tabular-nums">{r.places} places</span>}
                    {r.from && (
                      <span className="tabular-nums">
                        {r.from.slice(0, 4)}–{(r.to ?? '').slice(0, 4) || 'now'}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'converge' && (
        pairs.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            No alignment beyond what connection explains. That is the ordinary
            case — actors who act together share interests by construction.
          </p>
        ) : (
          <>
            <p className="flex gap-1.5 px-2.5 py-1.5 text-[10px] leading-snug text-muted-foreground">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-500" />
              {/* The caveat rides the pane, not a doc nobody reads. */}
              Alignment without contact. Could be coordination, or independent
              response to the same incentive — this only says where to look.
            </p>
            <ul className="divide-y divide-border/40">
              {pairs.map(p => (
                <li key={`${p.a.id}|${p.b.id}`} className="px-2.5 py-1.5 text-xs">
                  <div className="flex items-center gap-1">
                    <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <button type="button" onClick={() => onSelectNode?.(p.a.id)}
                            className="truncate hover:underline">{p.a.label}</button>
                    <span className="text-muted-foreground">·</span>
                    <button type="button" onClick={() => onSelectNode?.(p.b.id)}
                            className="truncate hover:underline">{p.b.label}</button>
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                      {p.residual.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <span>{p.hops == null ? 'no path' : `${p.hops} hops`}</span>
                    <span className="truncate">{p.shared.slice(0, 3).join(', ')}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </div>
  );
}
