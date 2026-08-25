/**
 * pins — a pin is a query fragment, and a pin page is their union.
 *
 * The pin board used to hold node ids and nothing else, and its "sub-graph"
 * was `edges where both endpoints are pinned`. That is one of the things worth
 * pinning. The others — a cluster, an interest and everything under it, an
 * edge, a whole pane's scope — had nowhere to go, so assembling a filtered
 * highlight meant writing the query by hand every time.
 *
 * The observation: **each of those is already expressible as GQL.** So a pin
 * does not need a bespoke representation, a resolver, or a second highlight
 * path. It needs a `term`:
 *
 * ```
 *   node      label=="Adria Marine Ltd"
 *   edge      from:"A" from:"B" hops:1 predicate:funds
 *   cluster   type:Organization near:"Trieste"<80km
 *   vector    serves:"port privatisation"+          ← follows subsumes
 *   scope     <the pane's own string>
 *   doc       doc.asset_id:847020                   ← the document, not its cast
 * ```
 *
 * and a page is `ANY(t₁, t₂, …)`, which is why `ANY` had to exist. The payoff
 * is that a pin page is not a special view: it is a query, so it composes with
 * every filter in the language, survives a reload, can be handed to someone
 * else, and can be read and edited by a person who wants to know what the
 * highlight actually claims.
 */
import type { GraphEdge, GraphNode } from '../graphTypes';

export type PinKind = 'node' | 'edge' | 'cluster' | 'vector' | 'scope' | 'doc';

export interface Pin {
  id: string;
  kind: PinKind;
  /** What to show in the board. */
  label: string;
  /** A GQL fragment. The whole representation — there is nothing else. */
  term: string;
  /** Node ids this pin resolved to when it was made. A *hint* for the canvas
   *  highlight, never the definition: re-running the term is what makes a pin
   *  still mean something after the underlying run changes. */
  nodeIds?: string[];
}

export interface PinPage {
  id: string;
  label: string;
  pins: Pin[];
  /** Legacy: node ids pinned before pins carried terms. Migrated lazily by
   *  `readPage` so an existing board keeps working. */
  pinnedNodeIds?: string[];
}

export interface PinBoard {
  pages: PinPage[];
  activePageId: string;
  showLens: boolean;
}

/** Quote a value for GQL. Exact-match tokens need it whenever the value has a
 *  space, which entity names almost always do. */
function q(value: string): string {
  return `"${value.replace(/"/g, '')}"`;
}

export function pinNode(n: GraphNode): Pin {
  return {
    id: `node:${n.id}`,
    kind: 'node',
    label: n.label,
    term: `label==${q(n.label)}`,
    nodeIds: [n.id],
  };
}

export function pinEdge(e: GraphEdge, a: GraphNode, b: GraphNode): Pin {
  return {
    id: `edge:${e.id}`,
    kind: 'edge',
    label: `${a.label} → ${b.label}`,
    // Both seeds AND-intersect, which is exactly "reachable from both" — the
    // pair, and what sits between them.
    term: `from:${q(a.label)} from:${q(b.label)} hops:1`,
    nodeIds: [a.id, b.id],
  };
}

/** A fold bucket — whatever key produced it, as a filter on that key. */
export function pinCluster(key: string, value: string, nodeIds: string[]): Pin {
  const token = key === 'type' ? `type:${q(value)}`
    : key === 'kind' ? `kind:${value}`
    : key === 'role' ? `role:${q(value)}`
    : key === 'place' ? `near:${q(value)}<50km`
    : `label==${q(value)}`;
  return { id: `cluster:${key}:${value}`, kind: 'cluster', label: value, term: token, nodeIds };
}

/** An interest and everything under it. The `+` is the point: a pinned vector
 *  keeps meaning "this goal, however far down it was actually stated". */
export function pinVector(interest: string, nodeIds?: string[]): Pin {
  return {
    id: `vector:${interest}`,
    kind: 'vector',
    label: interest,
    term: `serves:${q(interest)}+`,
    nodeIds,
  };
}

/**
 * A document — **one pin, not one per thing it mentioned**.
 *
 * Pinning a document used to add a pin per node its rows minted, so a filing
 * naming eight exhibits produced eight pins called `exhibits #1 … #8` and the
 * board stopped saying anything a reader could act on. A document is a single
 * thing; what it *contains* is what the term resolves to, and that is the
 * subgraph the pin means.
 *
 * The row-level pin still exists and is reached the way it reads: open a row,
 * pin the thing it is about. The doc header pins the doc.
 *
 * `doc.asset_id` is tier 1 — a row condition compiled to SQL — so this
 * narrows the scan rather than filtering an assembled graph, and it keeps
 * meaning the same document after a re-run.
 */
export function pinDoc(assetId: number, title?: string | null, nodeIds?: string[]): Pin {
  return {
    id: `doc:${assetId}`,
    kind: 'doc',
    label: title?.trim() || `document ${assetId}`,
    term: `doc.asset_id:${assetId}`,
    // A hint for the canvas highlight, exactly as for every other kind: the
    // TERM is the definition, and re-running it is what survives a re-run.
    nodeIds,
  };
}

/** A pane's whole scope, kept. */
export function pinScope(label: string, term: string): Pin {
  return { id: `scope:${label}`, kind: 'scope', label, term };
}

/**
 * The query a page means.
 *
 * A single pin needs no wrapper — `ANY(x)` and `x` are the same set, and the
 * bare form is the one a person can read and edit. More than one unions.
 */
export function pageQuery(page: PinPage): string {
  const terms = page.pins.map(p => p.term.trim()).filter(Boolean);
  if (terms.length === 0) return '';
  if (terms.length === 1) return terms[0];
  return `ANY(${terms.join(', ')})`;
}

/** Node ids a page highlights, from the hints its pins carried. */
export function pageNodeIds(page: PinPage): Set<string> {
  const out = new Set<string>();
  for (const p of page.pins) for (const id of p.nodeIds ?? []) out.add(id);
  for (const id of page.pinnedNodeIds ?? []) out.add(id);
  return out;
}

/**
 * Read a page, migrating the node-id-only form.
 *
 * Boards written before pins carried terms hold bare ids. Rather than a
 * migration step nobody runs, they are upgraded on read: an id resolves to its
 * node and becomes a `label==` term, and an id that no longer resolves is
 * dropped, because a pin to something not in the run is not a pin.
 */
export function readPage(page: PinPage, nodes: ReadonlyArray<GraphNode>): PinPage {
  if (!page.pinnedNodeIds?.length) return { ...page, pins: page.pins ?? [] };
  const byId = new Map(nodes.map(n => [n.id, n]));
  const migrated = page.pinnedNodeIds
    .map(id => byId.get(id))
    .filter((n): n is GraphNode => !!n)
    .map(pinNode);
  const have = new Set((page.pins ?? []).map(p => p.id));
  return {
    ...page,
    pins: [...(page.pins ?? []), ...migrated.filter(p => !have.has(p.id))],
    pinnedNodeIds: undefined,
  };
}
