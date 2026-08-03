/**
 * HUD channels — "what goes in this pane", as a binding.
 *
 * A channel is one slot in a panel's viz map that consumes a binding. The graph
 * already has them (`node_group_by`, `edge_weight_field`); these are the same
 * idea one level up, where the slot is a HUD region rather than a visual
 * encoding. The user never sees the word — they see a labelled dropdown.
 *
 * The point of expressing the HUD this way is that **nothing is hardcoded as
 * "the activity source" or "the item source"**. Point `items` at evidence
 * occurrences and evidence becomes the item list; point `bars` at a different
 * projection and the histogram counts something else. What we consider
 * activity, observations or evidence is what we define it to be, and it can
 * switch without a code change.
 *
 * Selectors here are **pure functions over the assembled graph**. Occurrences
 * arrive carrying label, interval, place, magnitude, evidence and
 * `source_annotation_ids`, and participants are reachable through their edges —
 * so the panes need no fetch of their own and can never disagree with the
 * canvas about what is on screen.
 */
import type { GraphEdge, GraphNode } from '../graphTypes';

/** Where a pane takes its rows from. */
export type PaneFollow = 'lens' | 'selection';

export interface ItemsChannel {
  /** Restrict to one kind of occurrence (`node_type`). Empty = all of them. */
  nodeType?: string | null;
  /** Follow the panel's query, or the current selection/pins. */
  follow: PaneFollow;
  sort: 'time' | 'magnitude' | 'label';
}

export interface EvidenceChannel {
  /** `inline` reads the justification riding each node/edge; `occurrences`
   *  reads `Evidence`-typed occurrences reachable by a `supports` edge. Most
   *  corpora have one or the other, so `both` is the useful default. */
  source: 'inline' | 'occurrences' | 'both';
  follow: PaneFollow;
}

export interface BarsChannel {
  /** Inline puts the scrubber in the layout flow; overlay floats it on the
   *  canvas. Deliberately a prop rather than two components — which one reads
   *  better depends on the dashboard, and switching should not be a rewrite. */
  placement: 'inline' | 'overlay' | 'hidden';
  /** Which clock the bars AND the cursor run on — the same vocabulary as
   *  `LanesChannel.clock`, and one value rather than two because the histogram
   *  disagreeing with the filter is the bug this replaced. */
  clock: 'time' | 'activity';
}

export interface LanesChannel {
  /** What a lane is keyed on. `place` gives time × space; anything categorical
   *  works, because a lane is a grouping, not a geography.
   *
   *  `event` is the one that reads as a narrative: the band is a named
   *  happening and the ticks inside it are what each document reported of it —
   *  chapters and sentences. It is also the only key resolved from the EDGE
   *  set, because an occurrence's occasion is reached through `during`. */
  rows: 'place' | 'node_type' | 'kind' | 'group' | 'event';
  /** `time` is when it happened; `activity` is the period it is *about*.
   *  Where they differ — a deposition describing events fifteen years earlier —
   *  the difference is the finding. */
  clock: 'time' | 'activity';
  enabled: boolean;
}

export interface HudConfig {
  items: ItemsChannel;
  evidence: EvidenceChannel;
  bars: BarsChannel;
  lanes: LanesChannel;
}

export const defaultHudConfig: HudConfig = {
  items: { nodeType: null, follow: 'lens', sort: 'time' },
  evidence: { source: 'both', follow: 'selection' },
  bars: { placement: 'inline', clock: 'time' },
  // Off by default: it earns its space only once occurrences carry places or
  // a second clock, and an empty lane chart is worse than no lane chart.
  lanes: { rows: 'place', clock: 'time', enabled: false },
};

// ─── Selectors ───────────────────────────────────────────────────────────────

/** One participant of an occurrence, with the role it played. */
export interface ItemParticipant {
  id: string;
  label: string;
  type: string;
  role?: string | null;
}

/** A row in the items pane — an occurrence, flattened for reading. */
export interface HudItem {
  node: GraphNode;
  participants: ItemParticipant[];
  evidenceCount: number;
}

/**
 * Occurrences currently on screen, as readable rows.
 *
 * The canvas gives you position and connection; it cannot show a payment's
 * amount, date, place, participants and supporting quote at once. A list can.
 * So an occurrence is a node *and* a row — same object, two representations —
 * and this is the second one.
 */
export function selectItems(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  channel: ItemsChannel,
  focusIds?: ReadonlySet<string>,
): HudItem[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const parts = new Map<string, ItemParticipant[]>();
  for (const e of edges) {
    const target = byId.get(e.targetId);
    if (!target || !byId.get(e.sourceId)) continue;
    if (byId.get(e.sourceId)!.kind !== 'occurrence') continue;
    const list = parts.get(e.sourceId) ?? [];
    list.push({ id: target.id, label: target.label, type: target.type, role: e.role });
    parts.set(e.sourceId, list);
  }

  const want = channel.nodeType?.trim().toLowerCase() || null;
  const rows: HudItem[] = [];
  for (const n of nodes) {
    if (n.kind !== 'occurrence') continue;
    if (want && (n.nodeType || n.type || '').toLowerCase() !== want) continue;
    // Following the selection means: this occurrence, or one touching a
    // focused node. Clicking an actor should surface what they did, not
    // just the actor.
    if (channel.follow === 'selection' && focusIds && focusIds.size > 0) {
      const touches = focusIds.has(n.id)
        || (parts.get(n.id) ?? []).some(p => focusIds.has(p.id));
      if (!touches) continue;
    }
    rows.push({
      node: n,
      participants: parts.get(n.id) ?? [],
      evidenceCount: (n.evidence?.length ?? 0),
    });
  }

  const key = channel.sort;
  rows.sort((a, b) => {
    if (key === 'magnitude') {
      return (b.node.magnitude ?? -Infinity) - (a.node.magnitude ?? -Infinity);
    }
    if (key === 'label') return a.node.label.localeCompare(b.node.label);
    // Undated rows sink rather than sorting as the year zero.
    const at = a.node.t0 ?? '', bt = b.node.t0 ?? '';
    if (!at && !bt) return 0;
    if (!at) return 1;
    if (!bt) return -1;
    return at.localeCompare(bt);
  });
  return rows;
}

/** A row in the evidence pane. */
export interface HudEvidence {
  id: string;
  /** Verbatim words from the document. The whole point — if we cannot quote
   *  it, the claim should not be on screen. */
  quote?: string | null;
  reasoning?: string | null;
  source?: string | null;
  locator?: string | null;
  /** supports | contradicts | corrects | retracts — changes how it reads. */
  stance?: string | null;
  /** What this grounds, for the jump-back gesture. */
  aboutId: string;
  aboutLabel: string;
}

function readInline(
  raw: any,
  aboutId: string,
  aboutLabel: string,
  i: number,
  /** The thing being grounded, when it is a node we have. */
  about?: GraphNode,
): HudEvidence {
  const spans = Array.isArray(raw?.text_spans) ? raw.text_spans : [];
  const quote = spans.map((s: any) => s?.text_snippet ?? s?.text ?? '')
    .filter(Boolean).join(' … ') || null;
  // **A justification inherits the epistemics of what it grounds.**
  //
  // The justification payload carries the document's words and the model's
  // reasoning — it has no stance of its own, and it should not. How a claim
  // was *made* is a property of the claim: a deposition row is `denies` or
  // `does_not_recall` or `asserts`, and the quote behind it means the opposite
  // thing depending which. Rendering every quote alike is how a graph starts
  // asserting what a witness denied.
  //
  // So the row falls back to the occurrence's own modality (forwarded onto the
  // node by the projection), which is the same value `edgeEpistemics` paints
  // edges from — one source, so the pane and the canvas cannot disagree.
  const p = about?.properties ?? {};
  const stance = raw?.stance ?? p.stance ?? p.modality ?? p.epistemic ?? null;
  return {
    id: `${aboutId}:inline:${i}`,
    quote,
    reasoning: raw?.reasoning ?? null,
    source: raw?.source ?? p.source ?? null,
    locator: raw?.locator ?? raw?.page ?? p.locator ?? null,
    stance,
    aboutId,
    aboutLabel,
  };
}

/**
 * Evidence for what is on screen — or for what is selected.
 *
 * Two sources, both already on the wire, because documents differ: most carry
 * an inline justification per row, while ones that *number* their evidence
 * (transcripts, exhibits, docketed filings) get `Evidence` occurrences joined
 * by a `supports` edge. `both` covers a mixed corpus.
 */
export function selectEvidence(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  channel: EvidenceChannel,
  focusIds?: ReadonlySet<string>,
): HudEvidence[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const inFocus = (id: string) =>
    channel.follow !== 'selection' || !focusIds || focusIds.size === 0
      || focusIds.has(id);

  const out: HudEvidence[] = [];

  if (channel.source !== 'occurrences') {
    for (const n of nodes) {
      if (!n.evidence?.length || !inFocus(n.id)) continue;
      n.evidence.forEach((raw, i) => out.push(readInline(raw, n.id, n.label, i, n)));
    }
    for (const e of edges) {
      const ev = (e as any).evidence as any[] | undefined;
      if (!ev?.length) continue;
      const label = `${byId.get(e.sourceId)?.label ?? '?'} → ${byId.get(e.targetId)?.label ?? '?'}`;
      if (!inFocus(e.sourceId) && !inFocus(e.targetId)) continue;
      ev.forEach((raw, i) => out.push(
        readInline(raw, e.sourceId, label, i, byId.get(e.sourceId)),
      ));
    }
  }

  if (channel.source !== 'inline') {
    // **Either direction.** The link between a claim and the exhibit behind it
    // is written by whichever row the document made it easy to write. A
    // `cites` role runs claim → exhibit, because that is where the citation
    // appears in the text; a `supports` row runs exhibit → claim. Both mean
    // the same edge, and the pane reads the exhibit end whichever way it
    // points rather than making the schema author pick a direction to please
    // a renderer.
    const isEvidence = (n?: GraphNode) =>
      !!n && (n.nodeType || n.type || '').toLowerCase() === 'evidence';

    for (const e of edges) {
      const a = byId.get(e.sourceId);
      const b = byId.get(e.targetId);
      const [ev, about] = isEvidence(a) ? [a, b] : isEvidence(b) ? [b, a] : [];
      if (!ev || !about || ev === about) continue;
      if (!inFocus(about.id)) continue;
      const p = ev.properties ?? {};
      out.push({
        id: `${ev.id}->${about.id}`,
        quote: p.quote ?? ev.label,
        reasoning: p.reasoning ?? null,
        source: p.source ?? null,
        locator: p.locator ?? null,
        stance: p.stance ?? null,
        aboutId: about.id,
        aboutLabel: about.label,
      });
    }
  }
  return out;
}
