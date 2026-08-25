/**
 * graphStyle — the visual declarations a contract already carries.
 *
 * A schema author can pick a colour, an icon and an arrow head per node type
 * and per predicate. Several surfaces write them, and until recently the
 * renderer read **none** of them: it looked for a legacy `graphConfig` key
 * that the current authoring path stopped writing. The declarations were being
 * carefully preserved all the way to a dead end.
 *
 * This walks the contract for every form those declarations take and returns
 * them in the shape the renderer consumes, so wiring them up is a lookup
 * rather than a feature.
 *
 * ## Four tiers, weakest first
 *
 * ```
 *   graphConfig.entityTypes.*          legacy nesting, pre-`x-*` contracts
 *   x-entityColor / x-entityIcon       one FIELD  — "the payer"
 *   x-entityTypeColors / …Icons        a TYPE map — the graph editor's palette
 *   x-nodeStyles  (contract root)      the SCHEMA's palette — what both
 *                                      editors write today
 * ```
 *
 * The order is not arbitrary. Each tier is more explicitly *about a type* than
 * the one below it, and the last is the only one that can name a type nothing
 * else can reach — a section's self-node (`Event`, `Observation`, `Evidence`),
 * which has no entity field to hang a declaration on.
 *
 * ## Why the field tier is the weak one
 *
 * `x-entityIcon` sits on a field, and a field is not a type. Two fields typed
 * `Person` can carry different icons, and a graph that colours by type has no
 * way to honour both. Worse, ref fields inherit their targets' vocabulary, and
 * for a while they inherited their visuals with it: in schema 18397 the icon
 * declared on `interests` rode into `relations.from`, which declares
 * `x-entityType: "Person"` — so reading field declarations naively made every
 * *person* wear the interest glyph. Refs are skipped here for that reason, and
 * `adapters.ts` no longer copies visuals across one in the first place.
 */

/** Which way a predicate's edge points. A declared vocabulary, not free text:
 *  an arrow claims a direction, and `both` and `none` are different claims
 *  from `forward` rather than absences of one. */
export type ArrowDirection = 'forward' | 'backward' | 'both' | 'none';

const ARROWS: ReadonlySet<string> = new Set<ArrowDirection>([
  'forward', 'backward', 'both', 'none',
]);

/** What an author can say about how a node type looks. One object per type,
 *  rather than a colour map beside an icon map that can disagree about which
 *  types exist or how they are spelled. */
export interface NodeStyle {
  color?: string;
  icon?: string;
}

/** The JSON Schema extension carrying the schema-level palette, at the root of
 *  `output_contract`. Keyed by node type as the author spelled it. */
export const NODE_STYLES_EXTENSION = 'x-nodeStyles';

export interface GraphStyleDeclarations {
  /** Entity type (uppercased) → colour. */
  typeColors: Record<string, string>;
  /** Entity type (uppercased) → icon name. */
  typeIcons: Record<string, string>;
  predicateColors: Record<string, string>;
  predicateIcons: Record<string, string>;
  predicateArrows: Record<string, ArrowDirection>;
}

const EMPTY: GraphStyleDeclarations = {
  typeColors: {}, typeIcons: {},
  predicateColors: {}, predicateIcons: {}, predicateArrows: {},
};

const isObj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Read a `{ type: {icon, color} }` map into the flat per-attribute maps the
 *  renderer wants. Tolerant of junk: a malformed entry is dropped, not
 *  propagated as a style nobody can see is wrong. */
export function readNodeStyles(
  raw: unknown,
): { colors: Record<string, string>; icons: Record<string, string> } {
  const colors: Record<string, string> = {};
  const icons: Record<string, string> = {};
  if (!isObj(raw)) return { colors, icons };

  for (const [type, style] of Object.entries(raw)) {
    if (!type || !isObj(style)) continue;
    const key = type.toUpperCase();
    if (typeof style.color === 'string' && style.color) colors[key] = style.color;
    if (typeof style.icon === 'string' && style.icon) icons[key] = style.icon;
  }
  return { colors, icons };
}

/**
 * Collect every visual declaration in a contract.
 *
 * The tiers below the root palette are walked rather than looked up in one
 * place, because where they land depends on how the schema was authored — a
 * type map on a graph field, a per-field declaration on an entity, and both
 * can be nested inside sections. A walk is cheap (contracts are small) and
 * cannot be wrong about a shape it has not seen.
 */
export function readGraphStyle(contract: unknown): GraphStyleDeclarations {
  if (!isObj(contract)) return EMPTY;

  // One accumulator per tier, composed at the end. Merging as we walk would
  // make precedence depend on property order in the JSON, which is not
  // something an author states or can see.
  const legacyColors: Record<string, string> = {};
  const legacyIcons: Record<string, string> = {};
  const fieldColors: Record<string, string> = {};
  const fieldIcons: Record<string, string> = {};
  const mapColors: Record<string, string> = {};
  const mapIcons: Record<string, string> = {};

  const out: GraphStyleDeclarations = {
    typeColors: {}, typeIcons: {},
    predicateColors: {}, predicateIcons: {}, predicateArrows: {},
  };

  const merge = (target: Record<string, string>, src: unknown, upper: boolean) => {
    if (!isObj(src)) return;
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'string' && v) target[upper ? k.toUpperCase() : k] = v;
    }
  };

  /** Arrows are a closed vocabulary — an unrecognised value is dropped rather
   *  than passed through, because the renderer would have to guess and a guess
   *  about direction is a claim about the data. */
  const mergeArrows = (target: Record<string, ArrowDirection>, src: unknown) => {
    if (!isObj(src)) return;
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'string' && ARROWS.has(v)) target[k] = v as ArrowDirection;
    }
  };

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isObj(node)) return;

    merge(mapColors, node['x-entityTypeColors'], true);
    merge(mapIcons, node['x-entityTypeIcons'], true);
    merge(out.predicateColors, node['x-predicateColors'], false);
    merge(out.predicateIcons, node['x-predicateIcons'], false);
    mergeArrows(out.predicateArrows, node['x-predicateArrows']);

    // Per-FIELD declarations. `x-entityColor` on a field that declares
    // `x-entityType: "Organization"` is a statement about organisations, so it
    // fills the type map — but only from a field that owns its vocabulary. A
    // ref field's types come from its targets and so, once, did its visuals;
    // honouring those paints one type with another type's glyph.
    const t = node['x-entityType'];
    if (typeof t === 'string' && t && node['x-ref'] === undefined) {
      const key = t.toUpperCase();
      const colour = node['x-entityColor'];
      const icon = node['x-entityIcon'];
      if (typeof colour === 'string' && colour && !fieldColors[key]) fieldColors[key] = colour;
      if (typeof icon === 'string' && icon && !fieldIcons[key]) fieldIcons[key] = icon;
    }

    // Legacy: the editor used to nest everything under one `graphConfig`
    // object. Still read, so a contract authored before the `x-*` keys keeps
    // its appearance rather than silently reverting to defaults.
    const legacy = node.graphConfig;
    if (isObj(legacy)) {
      merge(legacyColors, legacy.entityTypes?.typeColors, true);
      merge(legacyIcons, legacy.entityTypes?.typeIcons, true);
      merge(out.predicateColors, legacy.relationshipSchema?.predicateColors, false);
      merge(out.predicateIcons, legacy.relationshipSchema?.predicateIcons, false);
      mergeArrows(out.predicateArrows, legacy.relationshipSchema?.predicateArrows);
    }

    for (const v of Object.values(node)) walk(v);
  };

  walk(contract);

  // The schema-level palette. Root only: it is a statement about the whole
  // contract, and a nested copy would be a statement about nothing in
  // particular.
  const root = readNodeStyles(contract[NODE_STYLES_EXTENSION]);

  out.typeColors = { ...legacyColors, ...fieldColors, ...mapColors, ...root.colors };
  out.typeIcons = { ...legacyIcons, ...fieldIcons, ...mapIcons, ...root.icons };
  return out;
}

/** Did the author declare anything at all? Used to keep `undefined` flowing
 *  where nothing was said, so the renderer's own defaults still apply. */
export function hasGraphStyle(s: GraphStyleDeclarations): boolean {
  return Object.values(s).some(m => Object.keys(m).length > 0);
}
