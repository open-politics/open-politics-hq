/**
 * fold — a pane's query, applied to the graph already on screen.
 *
 * **One fetch, N folds.** The panel's query bounds what is fetched; a pane
 * narrows and folds that set and never widens it. That is what makes a pane
 * physically unable to disagree with the canvas: there is one set of nodes and
 * edges in memory and every pane is a reduction of it. A pane that needed its
 * own fetch would be a second answer to the same question, arriving later.
 *
 * The reduction is the four-stage pipeline the grammar names, minus the stages
 * the client cannot run:
 *
 * ```
 *   filter ──▶ walk ──▶ fold ──▶ (compare)
 *   here       here      here     server-side; needs both sides of a set op
 * ```
 *
 * Tier-1 tokens (`predicate:`, `confidence>`, `field:`, `doc.`) are *row scope*
 * and were already applied when the data was fetched, so a pane restating one
 * is a no-op rather than an error — the same token means the same thing at
 * both altitudes, which is the property that lets a pane query be written by
 * the same bar as the panel's.
 */
import type { GraphEdge, GraphNode } from '../graphTypes';
import {
  parseGraphQueryToPills, type GraphQueryPill,
} from '@/lib/query/graph_query_language';
import type { Surface, SurfaceKind, SurfaceRow } from './paneTypes';
import { inferKind } from './paneTypes';
import { quoteOf } from '../hud/hudChannels';
import { DEFAULT_RUNGS, resolvePlace } from '../forcegraph/anchors';

/**
 * Where a node is, resolved **exactly as the canvas resolves it**.
 *
 * A node's coordinates usually do not sit on `lat`/`lon`: they sit on a rung
 * of the place ladder in `places[]`, and `resolvePlace` is what picks the
 * strongest rung that holds at the current moment. Reading the top-level
 * fields instead made the Places pane report "9 without coordinates" for nodes
 * the canvas was plotting perfectly well a few pixels away — two answers to
 * "where is this", from one set of nodes, which is precisely the disagreement
 * a single in-memory fold is supposed to make impossible.
 */
function coordsOf(n: GraphNode, cursor?: string | null): [number | null, number | null] {
  const best = resolvePlace(n, DEFAULT_RUNGS, cursor ?? null);
  if (best?.place?.lat != null && best.place.lon != null) {
    return [best.place.lat, best.place.lon];
  }
  return [n.lat ?? null, n.lon ?? null];
}

export interface FoldInput {
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
  /** The pane's query — its own when unlinked, the panel's when linked. */
  q: string;
  /** Panel-level legend, so a pane can show what the engine decided. */
  legend?: string[];
  /** Selection scope, when the pane follows one. */
  focusIds?: ReadonlySet<string>;
  /** annotation id → asset id, for provenance on a row. */
  assetOf?: (annotationId: number) => number | undefined;
  /** Explicit kind override from the PaneSpec. */
  kind?: SurfaceKind;
  /** Scrubber position — place entries are interval-scoped, so a node anchors
   *  somewhere different at different moments. Passed so the pane moves with
   *  the canvas rather than pinning to whichever address was seen first. */
  cursor?: string | null;
}

/** Values of one pill type, lowercased. */
function valuesOf(pills: GraphQueryPill[], type: string): Set<string> {
  return new Set(
    pills.filter(p => p.type === type && !p.negated)
      .map(p => p.value.toLowerCase()),
  );
}

function negatedOf(pills: GraphQueryPill[], type: string): Set<string> {
  return new Set(
    pills.filter(p => p.type === type && p.negated)
      .map(p => p.value.toLowerCase()),
  );
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/**
 * Which nodes a pane query keeps.
 *
 * Deliberately **identity filters only**. Traversal and shape predicates
 * (`degree>`, `converge>`, `hops:`) need the whole graph and the server has
 * already run them for the panel; re-running an approximation of them over the
 * capped client view would produce a second, quieter number that disagrees.
 * When a pane needs those, it is a *widening* pane and takes its own fetch.
 */
export function selectNodes(
  nodes: ReadonlyArray<GraphNode>,
  q: string,
  focusIds?: ReadonlySet<string>,
): GraphNode[] {
  const pills = parseGraphQueryToPills(q ?? '');
  const types = valuesOf(pills, 'type');
  const exTypes = negatedOf(pills, 'type');
  const kinds = valuesOf(pills, 'kind');
  const roles = valuesOf(pills, 'role');
  const labels = valuesOf(pills, 'label');
  // Free text only. `channel` pills are bindings — they say what the set DOES,
  // not what is in it — and treating one as a name substring is what made a
  // query full of `PANEL:`/`CONNECT:` clauses select nothing at all.
  const text = pills.filter(p => p.type === 'text' && !p.negated)
    .map(p => norm(p.value));

  // `SECTION:places` — the address space's own name for a projection. The
  // engine turns it into `field:document.places[*]` and filters in SQL; here
  // it matches the section a node's `sourcePaths` came from, so a pane scoped
  // this way narrows to the same set the canvas does.
  const sections = new Set(
    pills.filter(p => p.type === 'channel' && p.label === 'SECTION')
      .flatMap(p => p.value.split(','))
      .map(v => norm(v).split('.')[0])
      .filter(Boolean),
  );
  const inSection = (n: GraphNode) =>
    (n.sourcePaths ?? []).some(
      p => sections.has(norm(p).split('.').pop()!.replace('[*]', '')),
    );

  return nodes.filter(n => {
    if (sections.size && !inSection(n)) return false;
    if (focusIds && focusIds.size > 0 && !focusIds.has(n.id)) return false;
    const t = norm(n.nodeType || n.type);
    if (types.size && !types.has(t)) return false;
    if (exTypes.has(t)) return false;
    if (kinds.size && !kinds.has(norm(n.kind ?? 'entity'))) return false;
    if (roles.size && !(n.roles ?? []).some(r => roles.has(norm(r)))) return false;
    if (labels.size && !labels.has(norm(n.label))) return false;
    if (text.length && !text.every(t2 => norm(n.label).includes(t2))) return false;
    return true;
  });
}

/** The `BY` keys a pane query folds on. Absent ⇒ an unfolded set. */
export function foldKeys(q: string): string[] {
  const m = /\bBY\s+([a-z_][a-z0-9_.]*(?:\s*,\s*[a-z_][a-z0-9_.]*)*)/i.exec(q ?? '');
  if (!m) return [];
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}

/** Read one fold key off a node. Unknown keys read as empty rather than
 *  throwing — a half-typed `BY` should not blank a pane. */
function keyValue(n: GraphNode, key: string): string {
  switch (key) {
    case 'type': return n.nodeType || n.type || '';
    case 'kind': return n.kind ?? 'entity';
    case 'label': case 'node': case 'name': return n.label;
    case 'place': return n.places?.[0]?.place ?? n.place ?? '';
    case 'role': return (n.roles ?? [])[0] ?? '';
    case 'group': return typeof n.groupValue === 'string' ? n.groupValue : '';
    default: {
      const v = (n.properties ?? {})[key];
      return v == null ? '' : String(v);
    }
  }
}

/** The measure a row carries. `size` when the engine resolved a `WEIGHT:`
 *  binding, else the honest fallback of how often it was named. */
function measureOf(n: GraphNode): number {
  return n.size != null ? n.size : (n.frequency ?? 1);
}

function provenanceOf(n: GraphNode) {
  const first = n.evidence?.[0];
  return {
    justification: first?.reasoning ?? null,
    quote: quoteOf(first),
    annotationIds: n.annotationIds ?? [],
  };
}

/**
 * Reduce the graph to a surface, per the pane's query.
 *
 * With no `BY`, the surface is the set itself — one row per node, which is
 * what an "items" list has always been. With one key it is a ranked fold; with
 * two, a cross. Nothing about which of those is which is written here: the
 * kind is *inferred* from what came out, so `BY place` produces a map because
 * places have coordinates and not because anyone wrote a map pane.
 */
export function fold(input: FoldInput): Surface {
  const { nodes, edges, q, focusIds, legend, kind, cursor } = input;
  const keys = foldKeys(q);
  const picked = selectNodes(nodes, q, focusIds);

  if (keys.length === 0) {
    // Unfolded: every row IS a node, so it carries what the node is. A pane
    // showing only a name and a count has thrown away the reason to list it.
    const rows: SurfaceRow[] = picked.map(n => ({
      keys: [],
      value: measureOf(n),
      nodeId: n.id,
      label: n.label,
      type: n.nodeType || n.type || null,
      kind: n.kind ?? null,
      place: n.places?.[0]?.place ?? n.place ?? null,
      roles: n.roles ?? [],
      properties: n.properties ?? {},
      magnitude: n.magnitude ?? null,
      docCount: (n.annotationIds ?? []).length,
      t0: n.t0 ?? null,
      t1: n.t1 ?? null,
      lat: coordsOf(n, cursor)[0],
      lon: coordsOf(n, cursor)[1],
      ...provenanceOf(n),
    }));
    // Time first when the set has any, because a list of things that happened
    // reads as a sequence; otherwise by measure.
    rows.sort((a, b) =>
      a.t0 && b.t0 ? a.t0.localeCompare(b.t0) : b.value - a.value);
    return { kind: kind ?? inferKind(rows, []), rows, keyNames: [], legend };
  }

  const buckets = new Map<string, SurfaceRow>();
  for (const n of picked) {
    const k = keys.map(key => keyValue(n, key));
    // A node with no value for the fold key is genuinely outside the fold, not
    // a member of a bucket called "". Dropping it is the honest reading; the
    // count in the header is what tells you it happened.
    if (k.some(v => !v)) continue;
    const id = k.join('|');
    const prev = buckets.get(id);
    if (prev) {
      prev.value += measureOf(n);
      // The bucket's extent is the hull of its members'.
      if (n.t0 && (!prev.t0 || n.t0 < prev.t0)) prev.t0 = n.t0;
      if (prev.t1 !== null) prev.t1 = n.t1 && n.t1 > (prev.t1 ?? '') ? n.t1 : prev.t1;
      if (!n.t1) prev.t1 = null;   // an open end swallows a closed one
    } else {
      buckets.set(id, {
        keys: k,
        value: measureOf(n),
        label: k.join(' · '),
        nodeId: keys.length === 1 && keys[0] === 'label' ? n.id : undefined,
        t0: n.t0 ?? null,
        t1: n.t1 ?? null,
        lat: coordsOf(n, cursor)[0],
        lon: coordsOf(n, cursor)[1],
        ...provenanceOf(n),
      });
    }
  }

  const rows = Array.from(buckets.values()).sort((a, b) => b.value - a.value);
  return { kind: kind ?? inferKind(rows, keys), rows, keyNames: keys, legend };
}

/**
 * Justifications in scope, as rows.
 *
 * The old evidence pane had a three-way `inline | occurrences | both` selector
 * because a justification riding a node and an `Evidence`-typed occurrence
 * were modelled as two things. They are one thing from two ends, so this reads
 * both and says so per row.
 */
export function foldEvidence(input: FoldInput): Surface {
  const { nodes, edges, focusIds, q, legend } = input;
  const scope = new Set(selectNodes(nodes, q, focusIds).map(n => n.id));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const rows: SurfaceRow[] = [];

  const push = (
    raw: any, id: string, label: string, i: number, annotationIds?: number[],
  ) => {
    const quote = quoteOf(raw);
    const reasoning = raw?.reasoning ?? null;
    if (!quote && !reasoning) return;
    rows.push({
      keys: [], value: 1, nodeId: id, label,
      justification: reasoning, quote, annotationIds: annotationIds ?? [],
    });
  };

  for (const n of nodes) {
    if (scope.size && !scope.has(n.id)) continue;
    (n.evidence ?? []).forEach((e, i) => push(e, n.id, n.label, i, n.annotationIds));
  }
  for (const e of edges) {
    if (scope.size && !scope.has(e.sourceId) && !scope.has(e.targetId)) continue;
    const label = `${byId.get(e.sourceId)?.label ?? '?'} → ${byId.get(e.targetId)?.label ?? '?'}`;
    (e.evidence ?? []).forEach((ev, i) => push(ev, e.sourceId, label, i, e.annotationIds));
  }
  return { kind: 'list', rows, keyNames: [], legend };
}
