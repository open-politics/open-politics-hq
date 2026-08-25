/**
 * derive — the panes a query proposes.
 *
 * **The query proposes, configuration disposes.** The rule, verbatim from
 * `PANEL_MAPPING §5` and adopted rather than reinvented:
 *
 * > A channel with no explicit setting follows the query; a channel the user
 * > has touched shows a "pinned" marker and stops following; a "reset to
 * > query" affordance puts it back. Derivation happens on *commit*, never per
 * > keystroke, and only ever turns panes **on** — never hides one the user is
 * > reading.
 *
 * That last clause is the one that matters in practice. A derivation that can
 * remove panes means editing a query makes the thing you were reading vanish,
 * and the analyst learns not to edit the query.
 *
 * The preset table lives on the backend (`graph/channels.py::PANE_PRESETS`)
 * because it resolves through the schema's own declarations — `PANEL:Motives`
 * lands on the vector preset in a contract that never says "interests". This
 * module mirrors only the *shape* decisions, which are about layout.
 */
import type { PaneRegion, PaneSpec, SurfaceKind } from './paneTypes';
import { paneId } from './paneTypes';

/** Where a preset's pane goes, and what it looks like. Layout only — what the
 *  pane CONTAINS is resolved server-side from the contract. */
interface PaneShape {
  region: PaneRegion;
  kind?: SurfaceKind;
  follow: PaneSpec['follow'];
  /** Starting query for the pane, when it is not simply the panel's. */
  q?: string;
}

const SHAPES: Record<string, PaneShape> = {
  // `node` sits top-left because that is where the eye goes when something is
  // selected, and because the right column is where the *lists* live — a
  // detail pane competing with them for the same column meant the thing you
  // just clicked appeared below three things you did not.
  node: { region: 'left', kind: 'detail', follow: 'selection' },
  // The rows behind the picture. Right column, because it is the surface a
  // reader spends time in — the canvas answers "what is the shape of this",
  // the table answers "what actually happened", and only one of those is read
  // line by line.
  rows: { region: 'right', kind: 'table', follow: 'lens' },
  // Bounded, and a MAP rather than a ranked list of place names — a list of
  // places sorted by count grows with the corpus and tells you nothing a map
  // tells you instantly.
  places: { region: 'left', kind: 'map', follow: 'lens' },
  observations: { region: 'right', kind: 'items', follow: 'lens' },
  evidence: { region: 'right', kind: 'items', follow: 'selection' },
  interests: { region: 'right', kind: 'items', follow: 'lens' },
  clusters: { region: 'right', kind: 'list', follow: 'lens' },
  // The one surface that runs source → graph. Left column, under the node
  // detail: both answer "what is this", from the two directions.
  docs: { region: 'left', kind: 'docs', follow: 'lens' },
  steps: { region: 'bottom', kind: 'lanes', follow: 'lens' },
  lanes: { region: 'bottom', kind: 'lanes', follow: 'lens' },
  activity: { region: 'bottom', kind: 'lanes', follow: 'lens' },
};

const DEFAULT_SHAPE: PaneShape = { region: 'right', kind: undefined, follow: 'lens' };

/**
 * Pane names a query names, in order. `PANEL:Observations PANEL:Places`.
 *
 * A bare name runs to the next space; a quoted one may contain them. The
 * previous pattern allowed spaces unquoted, so `PANEL:interests PANEL:places`
 * captured `interests PANEL` — a pane literally titled "interests PANEL", and
 * one fewer pane than asked for.
 */
export function panelNames(q: string): string[] {
  const out: string[] = [];
  const re = /\bPANEL:\s*("[^"]*"|'[^']*'|[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q ?? '')) !== null) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^["']|["']$/g, '');
      if (name) out.push(name);
    }
  }
  return out;
}

/** What the engine resolved for one inferred pane. */
export interface InferredPane {
  name: string;
  /** Scope, resolved server-side from the declared roles — `type:"Interest"`,
   *  `BY place`. The frontend cannot compute this: it needs the contract. */
  q?: string | null;
  kind?: SurfaceKind | null;
}

/** A fresh pane for a name, with the shape its preset implies.
 *
 *  `q` comes from the engine when it inferred one, because the *scope* of a
 *  pane depends on what the contract declared and only the backend can see
 *  that. Layout is decided here; content is not. */
export function makePane(
  name: string,
  existing: ReadonlyArray<PaneSpec>,
  region?: PaneRegion,
  inferred?: InferredPane,
  derived = false,
): PaneSpec {
  const shape = SHAPES[name.trim().toLowerCase()] ?? DEFAULT_SHAPE;
  return {
    id: paneId(name, existing),
    name: name.trim(),
    region: region ?? shape.region,
    kind: (inferred?.kind as SurfaceKind | undefined) ?? shape.kind,
    follow: shape.follow,
    q: inferred?.q || shape.q,
    linked: true,
    ...(derived ? { derived: true } : {}),
  };
}

/**
 * Panes the ENGINE derived, reconciled against what is there.
 *
 * Additive-only is right for a pane the analyst opened and wrong for a pane
 * that is a view of the query: a table pane exists because `SECTION:` named a
 * section, so when the query names a different one the pane must follow. It
 * cannot be protected as "something you were reading" — nobody chose it.
 *
 * Concretely: the panel was stuck showing one pane called `exhibits`, reading
 * "No rows for this query", while the engine returned tables for `observations`
 * and `actors`. Seeding was gated on `panes.length === 0`, so once a panel had
 * any pane at all, a new section could never get one.
 *
 * Panes the analyst made are untouched — order, region, size and all.
 */
export function reconcileDerived(
  current: ReadonlyArray<PaneSpec>,
  inferred: ReadonlyArray<InferredPane>,
): PaneSpec[] {
  const want = new Map(inferred.map(p => [p.name.trim().toLowerCase(), p]));
  const mine = current.filter(p => !p.derived);
  const kept = current.filter(
    p => p.derived && want.has(p.name.trim().toLowerCase()),
  );
  const have = new Set([
    ...mine.map(p => p.name.trim().toLowerCase()),
    ...kept.map(p => p.name.trim().toLowerCase()),
  ]);

  const out = [...kept];
  for (const inf of inferred) {
    const key = inf.name.trim().toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    out.push(makePane(inf.name, [...out, ...mine], undefined, inf, true));
  }
  // Analyst panes last so a derived table never displaces one in its region.
  return [...out, ...mine];
}

/**
 * Panes after a query commit: everything already there, plus anything the
 * query newly names.
 *
 * Additive by construction. A pane the query stops naming stays — the analyst
 * put it there or kept it there, and a query edit is not a request to close
 * what they were reading. Removing a pane is a gesture, not a side effect.
 */
export function derivePanes(
  q: string,
  current: ReadonlyArray<PaneSpec>,
  /** What the engine resolved for this run's preset names, so a pane the query
   *  asks for by name gets the same scope as one that was seeded. Without it,
   *  `PANEL:interests` created a pane that folded the WHOLE node set — a list
   *  of everything, under a name promising interests. */
  inferred: ReadonlyArray<InferredPane> = [],
): PaneSpec[] {
  const byName = new Map(inferred.map(p => [p.name.trim().toLowerCase(), p]));
  const out = [...current];
  const have = new Set(current.map(p => p.name.trim().toLowerCase()));
  for (const name of panelNames(q)) {
    const key = name.toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    out.push(makePane(name, out, undefined, byName.get(key)));
  }
  return out;
}

/** The query a pane actually runs: its own when unlinked, else the panel's. */
export function paneQuery(spec: PaneSpec, panelQuery: string): string {
  if (!spec.linked) return spec.q ?? '';
  // A linked pane inherits the panel's filters and adds its own scope.
  // Concatenation is the composition rule, because both halves are the same
  // language — which is the point of there being one language.
  //
  // One exception, and it is what keeps "panes narrow, never widen" true:
  // `SECTION:` **replaces** rather than unions. Sections union with each
  // other, so an Evidence pane inheriting the panel's `SECTION:places` and
  // adding its own would show places AND evidence — wider than the canvas,
  // under a name promising narrower.
  const own = spec.q ?? '';
  const inherited = /\bSECTION:/i.test(own)
    ? panelQuery.split(/\s+/).filter(t => !/^SECTION:/i.test(t)).join(' ')
    : panelQuery;
  return [inherited, own].filter(s => s.trim()).join(' ');
}
