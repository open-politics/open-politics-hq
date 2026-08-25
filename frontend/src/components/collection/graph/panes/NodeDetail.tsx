'use client';

/**
 * NodeDetail — everything known about one node.
 *
 * The old node panel showed a label, a type, a source list and an evidence
 * rail, while the wire carried far more: both clocks and the gap between them,
 * the place ladder with the *rung* each entry came from, roles, magnitude with
 * its unit, the interest profile, the resolved size and which projections
 * produced the node. A reader asking "what is this?" got the two facts a
 * triplet graph could have told them.
 *
 * The rule here is blunt, and it is the one the user asked for: **never hide a
 * non-empty field.** What a node *is* changes with the query — the same run
 * viewed through a different projection produces nodes with different
 * properties — so a fixed list of fields to display is wrong by construction.
 * The panel renders what is there, grouped by what kind of fact it is.
 *
 * Every row is a `<Value>`, so the justification behind a field is one gesture
 * away from the field itself rather than living in a separate rail.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { Value, type AxisKind } from './Value';
import { readPole } from '../hud/convergence';
import type { GraphEdge, GraphNode } from '../graphTypes';

export interface NodeDetailProps {
  node: GraphNode;
  edges: ReadonlyArray<GraphEdge>;
  /** Degree, from the rendered edge set. */
  degree?: number;
  /** Documents this node came from, already resolved to titles. */
  documents?: Array<{ assetId: number; title?: string | null }>;
  onOpenAsset?: (assetId: number) => void;
  /** Which fields to show, in order. Absent ⇒ everything non-empty. */
  show?: string[];
  className?: string;
}

/** `document.observations[*]` → `observations`.
 *
 *  Mirrors `graph/rows.py::section_of`. The last segment, because a contract
 *  path is written outward-in while a user-written address is written
 *  inward-out. */
function sectionOf(path: string): string {
  return (path || '').split('.').pop()!.replace('[*]', '').trim();
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="px-2 py-1">
      <div className="mb-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <dl className="space-y-0.5">{items}</dl>
    </div>
  );
}

function Row({ label, children, axisKind, unit, provenance }: {
  label: string;
  children: React.ReactNode;
  axisKind?: AxisKind;
  unit?: string | null;
  provenance?: React.ComponentProps<typeof Value>['provenance'];
}) {
  if (children == null || children === '' ) return null;
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <dt className="w-24 shrink-0 truncate text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">
        <Value value={children} axisKind={axisKind} unit={unit} provenance={provenance} />
      </dd>
    </div>
  );
}

/** `2014-03-02 → open` rather than a bare pair, because an open end is a
 *  different claim from a closed one and should not render alike. */
function interval(t0?: string | null, t1?: string | null): string | null {
  if (!t0 && !t1) return null;
  if (t0 && !t1) return `${t0} → open`;
  if (!t0 && t1) return `→ ${t1}`;
  return t0 === t1 ? t0! : `${t0} → ${t1}`;
}

export function NodeDetail({
  node, edges, degree, documents, onOpenAsset, show, className,
}: NodeDetailProps) {
  const wanted = show?.length ? new Set(show.map(s => s.toLowerCase())) : null;
  const on = (k: string) => !wanted || wanted.has(k);

  const when = interval(node.t0, node.t1);
  const covers = interval(node.a0, node.a1);
  // The gap between the two clocks IS the finding in a deposition corpus: a
  // 2020 statement about 2004 is a bar at 2004 with a mark at 2020, and saying
  // so is better than making a reader compute it.
  const clocksDiffer = when && covers && when !== covers;

  const firstEvidence = node.evidence?.[0];
  const provenance = firstEvidence
    ? { reasoning: firstEvidence.reasoning ?? null }
    : undefined;

  const profile = node.profile && typeof node.profile === 'object'
    ? Object.entries(node.profile).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    : [];

  return (
    <div className={cn('divide-y divide-border/40 overflow-y-auto', className)}>
      <Group title="identity">
        {on('label') && <Row key="l" label="name">{node.label}</Row>}
        {on('type') && <Row key="t" label="type">{node.nodeType || node.type}</Row>}
        {on('kind') && <Row key="k" label="kind">{node.kind ?? 'entity'}</Row>}
        {on('aliases') && node.aliases?.length
          ? <Row key="a" label="also called">{node.aliases.join(' · ')}</Row> : null}
      </Group>

      <Group title="position">
        {on('when') && <Row key="w" label="when" axisKind="interval">{when}</Row>}
        {on('covers') && <Row key="c" label="covers" axisKind="interval">{covers}</Row>}
        {clocksDiffer && (
          <div key="gap" className="pt-0.5 text-[10px] leading-snug text-amber-700 dark:text-amber-400">
            Recorded and subject periods differ — the gap is the finding, not an error.
          </div>
        )}
        {/* The place LADDER, with rungs. A stated site and a document's
            subject are both "where", and presenting them alike is how a
            filing's topic comes to read as a whereabouts. */}
        {on('places') && node.places?.length ? (
          <div key="p" className="pt-0.5">
            {node.places.map((pl, i) => (
              <div key={`${pl.place}-${i}`} className="flex items-baseline gap-2 text-[11px]">
                <dt className="w-24 shrink-0 truncate text-muted-foreground">
                  {i === 0 ? 'places' : ''}
                </dt>
                <dd className="min-w-0 flex-1">
                  <span>{pl.place}</span>
                  {pl.source && (
                    <span className="ml-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                      {pl.source}
                    </span>
                  )}
                  {pl.lat == null && (
                    <span className="ml-1 text-[9px] text-muted-foreground">no coords</span>
                  )}
                </dd>
              </div>
            ))}
          </div>
        ) : null}
      </Group>

      <Group title="measure">
        {on('size') && node.size != null && (
          <Row key="s" label="size">{node.size.toFixed(3)}</Row>
        )}
        {on('degree') && degree != null && (
          <Row key="d" label="connections">{degree}</Row>
        )}
        {on('mentions') && node.frequency != null && (
          // "named 8×" is what the number means. "8×" beside a label reading
          // `named` is a column header pretending to be a sentence.
          <Row key="f" label="mentioned">{`${node.frequency} times`}</Row>
        )}
        {/* Uncalibrated by declaration: the engine refuses to sum it across
            documents and the reader is told why rather than left to assume. */}
        {on('magnitude') && node.magnitude != null && (
          <Row key="m" label="magnitude" axisKind="metric" unit={null}
               provenance={provenance}>
            {node.magnitude}
          </Row>
        )}
      </Group>

      <Group title="structure">
        {on('cluster') && node.cluster
          ? <Row key="cl" label="grouped with">{node.cluster}</Row> : null}
        {on('roles') && node.roles?.length
          ? <Row key="r" label="appears as">{node.roles.join(' · ')}</Row> : null}
        {/* **The section names, not the contract paths.** This row used to read
            `document.attributes[*] · document.interests[*] ·
            document.observations[*]` — the address of the data instead of a
            statement about the node, and the single most JSON-shaped thing left
            in the panel. What a reader wants is *where this was said*, and the
            section is what the schema author called it. */}
        {on('layers') && node.sourcePaths?.length
          ? (
            <Row key="sp" label="described in">
              {[...new Set(node.sourcePaths.map(sectionOf))].join(' · ')}
            </Row>
          ) : null}
        {on('profile') && profile.length ? (
          <div key="pr" className="pt-0.5">
            {profile.slice(0, 8).map(([key, v]) => {
              const { label, direction } = readPole(key);
              const against = direction === 'opposes' || v < 0;
              return (
                <div key={key} className="flex items-baseline gap-2 text-[11px]">
                  <dt className="w-24 shrink-0 truncate text-muted-foreground">
                    {key === profile[0][0] ? 'serves' : ''}
                  </dt>
                  <dd className="flex min-w-0 flex-1 items-baseline gap-1">
                    <span className="truncate">{label}</span>
                    {direction && (
                      <span className={cn('text-[9px] uppercase',
                        against ? 'text-rose-500' : 'text-emerald-600')}>
                        {against ? 'opposes' : 'serves'}
                      </span>
                    )}
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {Math.abs(v)}
                    </span>
                  </dd>
                </div>
              );
            })}
          </div>
        ) : null}
      </Group>

      {/* Whatever the projection forwarded. Unknown by construction — which is
          exactly why they cannot be a fixed list. */}
      {on('properties') && node.properties && Object.keys(node.properties).length > 0 && (
        <Group title="properties">
          {Object.entries(node.properties).map(([k, v]) => (
            <Row key={k} label={k} provenance={provenance}>
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </Row>
          ))}
        </Group>
      )}

      {on('docs') && documents?.length ? (
        <Group title={`documents · ${documents.length}`}>
          {documents.map(d => (
            <div key={d.assetId} className="text-[11px]">
              <button
                type="button"
                onClick={() => onOpenAsset?.(d.assetId)}
                className="truncate text-left hover:underline"
              >
                {d.title || `asset ${d.assetId}`}
              </button>
            </div>
          ))}
        </Group>
      ) : null}

      {on('evidence') && node.evidence?.length ? (
        <Group title={`justifications · ${node.evidence.length}`}>
          {node.evidence.map((e, i) => (
            <div key={i} className="text-[11px]">
              <Value value="" bare provenance={{ reasoning: e.reasoning ?? null }} />
              {e.reasoning && (
                <p className="leading-snug text-muted-foreground">{e.reasoning}</p>
              )}
            </div>
          ))}
        </Group>
      ) : null}
    </div>
  );
}
