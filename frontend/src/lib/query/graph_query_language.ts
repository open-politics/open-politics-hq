/**
 * GQL — Graph Query Language (client mirror)
 *
 * AQL's sibling for graphs. The backend (`modules/graph/gql.py`) does the real
 * parsing; this is a lightweight mirror that drives the query bar's pills and
 * the syntax reference, exactly as `asset_query_language.ts` does for AQL.
 *
 * ═══════════════════════════════════════════════════════════
 *  SYNTAX
 * ═══════════════════════════════════════════════════════════
 *
 *  Free text (substring match on node names):
 *    merkel                          any node whose name contains it
 *    "Deutsche Bank"                 phrase with spaces
 *
 *  Node / edge filters:
 *    type:Person                     node entity type
 *    type:Person,Company             either type (comma = OR)
 *    -type:Location                  exclude a type
 *    kind:occurrence  kind:entity    what HAPPENED vs what PERSISTS
 *    role:speaker                    node appeared in that projection role
 *    label=="Acme Ltd"               the node's own name, EXACTLY
 *    predicate:funds,owns            edge predicate
 *    -predicate:mentions             exclude a predicate
 *    serves:opacity                  nodes serving an interest
 *    serves:territorial_control+     …rolled up through `subsumes`
 *    field:document.observations[*]  only this projection's atoms
 *
 *  Row properties (pushed into SQL — never leave the database):
 *    confidence>0.8                  numeric comparison on a row column
 *    kind=="quote"                   exact match
 *    doc.relevance>0.7               a field on the DOCUMENT, one level up —
 *                                    discards whole annotations before any
 *                                    row is exploded
 *    doc.title=="Docket 12"
 *
 *  Graph shape (computed after aggregation):
 *    degree>3                        well-connected nodes only
 *    weight>2                        strong edges only
 *    mentions>5                      frequently named nodes
 *    converge>0.6                    actors whose interest profiles overlap MORE
 *                                    than their graph distance predicts. Zero at
 *                                    one hop — two who already work together are
 *                                    a description, not a finding.
 *
 *  Time (interval overlap; undated items are kept):
 *    after:2020-01                   still alive at or after
 *    before:2023                     began at or before
 *
 *  Space (needs geocoded nodes):
 *    near:"Berlin"<200km             within a radius of a placed node
 *
 *  Traversal:
 *    from:"Angela Merkel"            seed node (substring match)
 *    from:"A","B"                    either seed (comma = OR)
 *    from:"A" from:"B"               BOTH — separate tokens intersect, which
 *                                    is how co-presence is asked
 *    hops:2                          how far to walk (default 1, max 10).
 *                                    Counts ACTOR steps: an occurrence between
 *                                    two people is one step, not two.
 *    hops:2-origin                   …without the node you started from
 *    hops:2-paths                    …without the connective nodes
 *    hops:2-origin-paths             both, in either order
 *
 * ═══════════════════════════════════════════════════════════
 *  RULES
 * ═══════════════════════════════════════════════════════════
 *
 *  Space between tokens  →  AND
 *  Comma within a value  →  OR
 *  - prefix              →  NOT
 *  "quotes"              →  a value containing spaces
 *
 *  Traversal runs last. It walks the graph as bounded by time and space, and
 *  `type:`/`role:`/`kind:` then pick what to *show* from what it reached — so
 *  `type:Location from:"Merkel" hops:2` means "the places within two hops of
 *  Merkel", not "a route made only of places". Identity filters select; they
 *  never block a path. And it walks the *projection* (the capped top-N node
 *  set), not the entire database.
 */

export type GraphPillType =
  /** A binding — `VECTOR:`, `PANEL:`, `WEIGHT:`. Says what the surviving set
   *  DOES, never what is in it. */
  | 'channel'
  | 'text'
  | 'type'
  | 'role'
  | 'predicate'
  | 'field'
  | 'row'
  | 'shape'
  | 'time'
  | 'near'
  | 'from'
  | 'hops'
  | 'kind'
  | 'serves'
  | 'doc'
  | 'label';

export interface GraphQueryPill {
  type: GraphPillType;
  label: string;
  value: string;
  negated: boolean;
  /** Original token, so the bar can reconstruct the string after an edit. */
  raw: string;
  /** Which tier this runs in — the bar shows it, because "pushed to SQL" vs
   *  "computed on the projection" is the difference between a filter that
   *  scales and one bounded by the node cap. */
  tier: 1 | 2 | 3;
}

/**
 * The grammar, mirrored from `graph/gql.py::TOKENS`.
 *
 * **One table, generated four ways.** This used to be a hand-kept list beside
 * three others — the engine docstring, `GRAPH_QUERY.md` and the MCP tool
 * description — which meant adding a token was eight edits and the four copies
 * drifted into teaching different things. `graph_tokens.test.ts` asserts this
 * equals the Python table, so drift fails a test instead of confusing a user.
 *
 * `semantics` carries the gotcha rather than the syntax, and is the reason the
 * MCP copy was the best of the four: a model handed only prefixes writes
 * queries that parse and answer the wrong question.
 */
export interface GqlToken {
  token: string;
  tier: 1 | 2 | 3;
  hint: string;
  semantics?: string | null;
  example?: string | null;
  /** Which declared value space it draws from — `interests` means "this run's
   *  interest roster", not a literal. Drives autocomplete. */
  values?: string | null;
}

export const GQL_TOKENS: readonly GqlToken[] = [
  { token: '<text>', tier: 2, hint: 'Free text — substring match on node names.',
    semantics: 'An unparseable token becomes this rather than an error, so a half-typed query is harmless. The cost is that a typo\'d prefix silently becomes a name search.',
    example: 'merkel' },
  { token: 'type:<type>', tier: 2, hint: "Node entity type; an occurrence's node_type too.",
    semantics: 'An IDENTITY filter: it selects, and never blocks a traversal path.',
    example: 'type:Person,Organization', values: 'entity types' },
  { token: 'kind:<kind>', tier: 2, hint: 'occurrence (happened) vs entity (persists).',
    example: 'kind:occurrence', values: 'occurrence | entity' },
  { token: 'role:<role>', tier: 2, hint: 'The slot a node occupied in its occurrence.',
    semantics: 'With `degree>` this becomes role-SCOPED degree, which is how an intermediary is discovered rather than declared: `via` in 340 payments is a finding, 340 connections is a shrug.',
    example: 'role:via degree>20', values: 'role slots' },
  { token: 'serves:<interest>', tier: 2, hint: 'The why axis — who serves this interest.',
    semantics: 'A trailing `+` rolls up through `subsumes` and walks `furthers` backward, so a mundane licensing delay reaches the plan it belongs to. The `+` survives quoting, which matters because interests are multi-word far more often than not.',
    example: 'serves:"port privatisation"+', values: 'interests' },
  { token: 'predicate:<pred>', tier: 1, hint: 'Edge predicate.',
    example: 'predicate:funds,owns', values: 'predicates' },
  { token: 'field:<path>', tier: 1, hint: 'Restrict to one projection.',
    semantics: 'The scan for every other projection never happens, so this is the cheapest filter in the language.',
    example: 'field:document.observations[*]', values: 'projection paths' },
  { token: 'SECTION:<section>', tier: 1, hint: 'Restrict to one section, by its own name.',
    semantics: 'The readable spelling of `field:` — the engine resolves `places` to `document.places[*]` against this run, so nobody has to know the contract\'s internal path to ask about its content. Same tier, same cost: a skipped projection is a scan that never happens.',
    example: 'SECTION:places', values: 'section names' },
  { token: '<field><op><value>', tier: 1, hint: 'Any column on the exploded row.',
    semantics: 'Numeric comparisons are guarded: a non-numeric value compares as NULL rather than raising.',
    example: 'confidence>0.8' },
  { token: 'doc.<field><op><value>', tier: 1, hint: 'A field on the DOCUMENT, not the row.',
    semantics: "Climbs out of the exploded row to the annotation's own object. The row is what happened; the document is where it was said.",
    example: 'doc.relevance>0.7' },
  { token: 'label==<name>', tier: 2, hint: "The node's own name, matched EXACTLY.",
    semantics: 'Exact where bare free text is a substring, because asking for one occurrence by name should not also return nine that merely contain it.',
    example: 'label=="Deutsche Bank"' },
  { token: 'degree><n>', tier: 2, hint: 'Edge count on the surviving subgraph.',
    semantics: "Counts edges whose far end was filtered out, so `role:via degree>20` still answers 'how many payments does this bank route'. Corrupted by corpus mix in a mixed infospace — see WEIGHT(ref:corpus).",
    example: 'degree>3' },
  { token: 'weight><n>', tier: 2, hint: 'Edge attestation.', example: 'weight>2' },
  { token: 'mentions><n>', tier: 2, hint: 'How often a node was named.', example: 'mentions>5' },
  { token: 'converge><n>', tier: 2, hint: 'Interest affinity between two actors, [-1, 1].',
    semantics: 'A cosine over interest profiles, and NOTHING else. It used to be multiplied by a distance penalty, which capped it at 0.5 forever because sharing an interest puts two actors at exactly two hops. Pair with `contact` for the finding.',
    example: 'converge>0.6 contact>2' },
  { token: 'contact><n>', tier: 2, hint: 'Graph distance, in hops, to the actor it converges with.',
    semantics: "Unreachable pairs pass every floor: no path at all is the STRONGEST form of 'without contact', not a missing value.",
    example: 'converge>0.6 contact>2' },
  { token: 'after:<date>', tier: 2, hint: 'Interval overlap — undated items are KEPT.',
    example: 'after:2020-01' },
  { token: 'before:<date>', tier: 2, hint: 'Interval overlap — undated items are KEPT.',
    example: 'before:2023' },
  { token: 'near:<place><<n>km', tier: 2, hint: 'Within a radius of a geocoded node.',
    example: 'near:"Berlin"<200km', values: 'place names' },
  { token: 'from:<name>', tier: 3, hint: 'Traversal seed — substring match on node names.',
    semantics: 'Separate `from:` tokens INTERSECT (reachable from BOTH — the co-presence question); commas inside one token union.',
    example: 'from:"E1" from:"E2"' },
  { token: 'hops:<n>', tier: 3, hint: 'How far to walk. Default 1, max 10.',
    semantics: 'Hops count ACTOR steps — occurrences are contracted, so actor→occurrence→actor is ONE hop. `-origin` and `-paths` each SUBTRACT, in any order.',
    example: 'hops:2-origin-paths' },
  { token: 'ANY(<q>, <q>)', tier: 2, hint: 'The union of several sub-queries.',
    semantics: 'The one grouping form. Composes by intersection with everything else, so ANY(...) type:Organization reads as it looks. A pinned node, edge, cluster and interest are each already a query fragment, which is what makes a pin page one string.',
    example: 'ANY(label=="Acme", serves:"port access"+) type:Organization' },
] as const;

/** Prefix list for the picker, derived so it cannot drift from `GQL_TOKENS`. */
export const GQL_PREFIXES = GQL_TOKENS
  .filter(t => t.token.includes(':') && !t.token.startsWith('<') && !t.token.startsWith('doc.'))
  .map(t => ({
    prefix: `${t.token.split(':')[0]}:`,
    hint: t.hint,
    tier: t.tier,
  }));

export const GQL_EXAMPLES = [
  { q: 'type:Person', desc: 'Only people' },
  { q: 'merkel', desc: 'Nodes whose name contains "merkel"' },
  { q: 'degree>3', desc: 'Only well-connected nodes' },
  { q: 'predicate:funds,owns', desc: 'Only funding or ownership edges' },
  { q: 'from:"Angela Merkel" hops:2', desc: 'Two hops out from one entity' },
  { q: 'type:Location from:"Merkel" hops:2', desc: 'Places within two hops, and how they connect' },
  { q: 'type:Location from:"Merkel" hops:2-paths', desc: 'Just the places' },
  { q: 'from:"A" from:"B" kind:occurrence', desc: 'What A and B were both in' },
  { q: 'doc.relevance>0.7', desc: 'Only documents scored relevant (SQL pushdown)' },
  { q: 'label=="Acme Ltd"', desc: 'One node by exact name' },
  { q: 'role:via degree>20', desc: 'Intermediaries — degree counted in the via slot only' },
  { q: 'converge>0.6 contact>2', desc: 'Aligned on an interest, with nothing within two hops connecting them' },
  { q: 'ANY(label=="Acme Ltd", serves:"port access"+)', desc: 'Either — the union form a pin page compiles to' },
  { q: 'confidence>0.8', desc: 'High-confidence rows only (SQL pushdown)' },
  { q: 'after:2020 before:2023', desc: 'Active in that window' },
  { q: 'field:document.observations[*]', desc: 'One projection only' },
  { q: 'near:"Berlin"<200km', desc: 'Within 200km of Berlin' },
  { q: 'type:Company degree>2 predicate:funds', desc: 'Composite' },
] as const;

const PREFIX_RE = /^(-)?([a-z_]+):([\s\S]+)$/;
/** A channel clause: UPPERCASE name, colon, selector. The one reserved rule —
 *  uppercase binds, lowercase filters — and it has to be checked BEFORE the
 *  lowercase prefix and free-text branches or a binding becomes a name search. */
const CHANNEL_RE = /^([A-Z][A-Z0-9_]*):([\s\S]*)$/;
const CMP_RE = /^([a-zA-Z_][a-zA-Z0-9_.]*)\s*(>=|<=|==|!=|>|<)\s*(.+)$/;
const SHAPE_KEYS = new Set(['degree', 'weight', 'mentions', 'frequency', 'converge', 'contact']);

/** Quote-aware tokenizer — mirrors `content/query.py:_tokenize`. */
function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current: string[] = [];
  let inQuotes = false;
  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current.push(ch);
    } else if (ch === ' ' && !inQuotes) {
      if (current.length) { tokens.push(current.join('')); current = []; }
    } else {
      current.push(ch);
    }
  }
  if (current.length) tokens.push(current.join(''));
  return tokens;
}

function stripQuotes(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

const PREFIX_PILL: Record<string, { type: GraphPillType; label: string; tier: 1 | 2 | 3 }> = {
  type: { type: 'type', label: 'Type', tier: 2 },
  kind: { type: 'kind', label: 'Kind', tier: 2 },
  serves: { type: 'serves', label: 'Serves', tier: 2 },
  role: { type: 'role', label: 'Role', tier: 2 },
  predicate: { type: 'predicate', label: 'Predicate', tier: 1 },
  pred: { type: 'predicate', label: 'Predicate', tier: 1 },
  field: { type: 'field', label: 'Field', tier: 1 },
  after: { type: 'time', label: 'After', tier: 2 },
  before: { type: 'time', label: 'Before', tier: 2 },
  from: { type: 'from', label: 'From', tier: 3 },
  hops: { type: 'hops', label: 'Hops', tier: 3 },
  near: { type: 'near', label: 'Near', tier: 2 },
};

/** Parse a GQL string into display pills. */
export function parseGraphQueryToPills(query: string): GraphQueryPill[] {
  if (!query?.trim()) return [];
  const pills: GraphQueryPill[] = [];

  for (const token of tokenize(query.trim())) {
    // **UPPERCASE is a channel, and a channel is not a filter.**
    //
    // This is the one reserved rule of the language and the mirror did not
    // know it, so every binding fell through to the free-text branch below and
    // became a substring match on node names. `PANEL:interests` filtered the
    // canvas to nodes literally called "PANEL:interests" — none — and then
    // poisoned every pane query built from the same string, which is why a
    // perfectly good query came back with an empty everything and no error.
    //
    // Reported as its own pill so the bar shows it is *doing* something rather
    // than narrowing something.
    const chan = token.match(CHANNEL_RE);
    if (chan) {
      pills.push({
        type: 'channel',
        label: chan[1],
        value: chan[2],
        negated: false,
        raw: token,
        tier: 2,
      });
      continue;
    }

    const pm = token.match(PREFIX_RE);
    if (pm) {
      const negated = pm[1] === '-';
      const meta = PREFIX_PILL[pm[2]];
      if (meta) {
        pills.push({
          ...meta,
          value: stripQuotes(pm[3]),
          negated,
          raw: token,
        });
        continue;
      }
    }

    const cm = token.match(CMP_RE);
    if (cm) {
      // Three destinations, and the bar must say which: a shape predicate runs
      // on the assembled projection, a `doc.` predicate is pushed into SQL one
      // level ABOVE the row, and `label=` is an exact name match after
      // aggregation. Showing them all as generic "row" would misstate what
      // scales and what does not.
      const key = cm[1].toLowerCase();
      const kind: GraphPillType =
        SHAPE_KEYS.has(key) ? 'shape'
          : key.startsWith('doc.') ? 'doc'
            : (key === 'label' || key === 'name') ? 'label'
              : 'row';
      pills.push({
        type: kind,
        label: cm[1],
        value: `${cm[2]} ${stripQuotes(cm[3])}`,
        negated: false,
        raw: token,
        tier: kind === 'row' || kind === 'doc' ? 1 : 2,
      });
      continue;
    }

    pills.push({
      type: 'text', label: 'Name', value: stripQuotes(token),
      negated: false, raw: token, tier: 2,
    });
  }
  return pills;
}

export function graphPillsToQuery(pills: GraphQueryPill[]): string {
  return pills.map(p => p.raw).join(' ');
}

/** Remove one pill by index and rebuild the string. */
export function removeGraphPill(query: string, index: number): string {
  const pills = parseGraphQueryToPills(query);
  pills.splice(index, 1);
  return graphPillsToQuery(pills);
}

/**
 * Toggle a `prefix:value` token.
 *
 * This is what lets the filter chips and the query string be **one** source of
 * truth: a chip click rewrites the query rather than holding separate hidden
 * state. Without that, the companion could only drive one of the two and
 * "what's shown" would stop being inspectable.
 */
export function toggleGraphToken(
  query: string,
  prefix: string,
  value: string,
  { negated = false }: { negated?: boolean } = {},
): string {
  const quoted = /[\s,]/.test(value) ? `"${value}"` : value;
  const token = `${negated ? '-' : ''}${prefix}:${quoted}`;
  const pills = parseGraphQueryToPills(query);
  const idx = pills.findIndex(p => p.raw === token);
  if (idx >= 0) {
    pills.splice(idx, 1);
    return graphPillsToQuery(pills);
  }
  return (query.trim() ? `${query.trim()} ` : '') + token;
}

export function hasGraphToken(query: string, prefix: string, value: string): boolean {
  const quoted = /[\s,]/.test(value) ? `"${value}"` : value;
  return parseGraphQueryToPills(query).some(
    p => p.raw === `${prefix}:${quoted}` || p.raw === `-${prefix}:${quoted}`,
  );
}

/**
 * Values currently excluded by a `-prefix:value` token.
 *
 * The read half of `toggleGraphToken`. Together they let a legend or a filter
 * chip be a *view of the query* rather than a second, invisible filter living
 * in component state — which is what "one source of truth" has to mean in
 * practice: the query survives reload, travels with a shared dashboard, and is
 * the thing the companion writes.
 */
export function negatedValues(query: string, pillType: GraphPillType): Set<string> {
  return new Set(
    parseGraphQueryToPills(query)
      .filter(p => p.negated && p.type === pillType)
      .map(p => p.value),
  );
}

/**
 * Rewrite the query so exactly *next* is excluded for this prefix.
 *
 * Takes the whole desired set rather than one toggle, because that is the
 * shape the existing filter panels emit — they hand back a new Set. Diffing
 * here keeps their API untouched while moving the truth into the string.
 */
export function setNegatedValues(
  query: string,
  pillType: GraphPillType,
  next: ReadonlySet<string>,
): string {
  const current = negatedValues(query, pillType);
  let out = query;
  for (const v of current) if (!next.has(v)) out = toggleGraphToken(out, pillType, v, { negated: true });
  for (const v of next) if (!current.has(v)) out = toggleGraphToken(out, pillType, v, { negated: true });
  return out;
}

/** Append a raw token (used by the reference popover's example buttons). */
export function appendGraphToken(query: string, token: string): string {
  return (query.trim() ? `${query.trim()} ` : '') + token;
}
