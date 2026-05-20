/**
 * Math-line formula rendering + parsing.
 *
 * One Formula renders as a compact math expression:
 *
 *   GGL = ∑(severity · weight) / ∑(weight)
 *         where: type="regulatory" AND year>2020
 *
 *   n_active = count _{quarter}
 *
 *   ratio    = GGL / @gov_baseline.GGL
 *
 *   top_evs  = top 5 events by severity ↓     where: category="labor"
 *
 * The math text IS the canonical source for pros (typed entry day 1). The
 * structured Formula body is the source of truth at runtime — render and
 * parse are inverses of each other (modulo whitespace + token order).
 *
 * Conventions (settled with user):
 *
 *  - ∑ as shorthand for sum (visual density). All other aggregations as words:
 *    mean, count, median, mode, min, max, distribution, top.
 *  - · for multiplication inside ∑/sum() (rendering weighted aggregates).
 *  - Subscripts ``_{dim, dim}`` carry the group. Time interval as ``_{date:month}``
 *    or ``_{date by month}``.
 *  - ``where:`` clause for the filter (FilterSet).
 *  - ``@name.col`` for composition references.
 *  - ``↓`` / ``↑`` for top direction (descending default).
 *  - Logical operators stay AND/OR.
 *
 * The renderer here emits pure text. The React component in
 * ``FormulaMathLine.tsx`` re-tokenises this text and wires popovers on
 * clickable tokens.
 */

import type {
  Dimension,
  Formula,
  Measure,
  DeriveSpec,
  FilterSet,
  FieldCondition,
} from '@/client/types.gen';

// ─── Render: Formula → canonical math text ─────────────────────────────────

/**
 * Render a Formula as a single canonical math-text string. Includes the
 * name, the measure/derive expression, the group subscript, and the
 * (optional) ``where:`` filter clause.
 */
export function renderFormula(f: Formula): string {
  const out: string[] = [];

  // The LHS is the formula's name (and at most one derive name when the
  // derives finalize the answer). The RHS is the canonical expression.
  out.push(f.name);
  out.push(' = ');
  out.push(renderRhs(f));

  // Subscript dims. Time dims get their interval inline.
  const dimSub = renderDimSubscript(f.group ?? []);
  if (dimSub) out.push(dimSub);

  // Filter clause (where: …). Renders on the same line if short, otherwise
  // the caller (FormulaMathLine.tsx) wraps to a second line.
  const whereStr = renderFilter(f.filter);
  if (whereStr) {
    out.push('   where: ');
    out.push(whereStr);
  }

  return out.join('');
}

/**
 * The RHS of a formula's math line. When the formula declares one or more
 * ``derives``, the LAST derive is treated as the "answer column" and its
 * expression is what appears on the math line. Intermediate measures stay
 * hidden — they are the ingredients. (Pro users can expand the formula via
 * the structured editor to see them all.)
 */
function renderRhs(f: Formula): string {
  const measures = f.measures ?? [];
  const derives = f.derives ?? [];

  // Derive-final case: the last derive is the answer. Render its expression
  // verbatim — the user's derive expression already reads like math.
  if (derives.length > 0) {
    return derives[derives.length - 1].expr.trim();
  }

  // Single measure: render it directly.
  if (measures.length === 1) {
    return renderMeasure(measures[0], f.weight ?? null);
  }

  // Multi-measure: render each as a comma-separated tuple. This is the rare
  // case (the editor encourages one-measure-per-formula); the structured
  // editor surface owns the multi-measure shape.
  if (measures.length > 1) {
    return measures.map(m => renderMeasure(m, f.weight ?? null)).join(', ');
  }

  // No measures: default count(*) — what the engine does too.
  return 'count';
}

/**
 * One measure as math text. Reads the formula's ``weight`` to render
 * weighted sum/mean as ``sum(x · w)`` / ``sum(x · w) / sum(w)``.
 */
/** Last segment of a dotted JSONB path — what we display inline. The full
 *  path stays accessible via popovers (FormulaMathLine wires it on the
 *  token's ``ref``). */
export function pathLeaf(p: string | null | undefined): string {
  if (!p) return '';
  // Strip a trailing ``[*]`` if present, then take last dotted segment.
  const trimmed = p.replace(/\[\*\]$/, '');
  return trimmed.split('.').pop() ?? trimmed;
}

export function renderMeasure(m: Measure, weight: Measure | null): string {
  const agg = m.agg ?? 'count';
  // count: name OR count(field) when path is set.
  if (agg === 'count') {
    return m.path ? `count(${pathLeaf(m.path)})` : 'count';
  }
  // top: special form. ``top N events by field ↓``
  if (agg === 'top') {
    const n = m.top_n ?? 5;
    const by = m.top_by ? ` by ${pathLeaf(m.top_by)} ↓` : '';
    return `top ${n}${by}`;
  }
  // distribution(field): folds value into {value: count} per group.
  if (agg === 'distribution') {
    return `distribution(${pathLeaf(m.path)})`;
  }

  // sum / mean — weighted forms when weight is set.
  const path = pathLeaf(m.path);
  if (weight && weight.path && (agg === 'sum' || agg === 'mean')) {
    const wp = pathLeaf(weight.path);
    const num = `∑(${path} · ${wp})`;
    if (agg === 'mean') {
      return `${num} / ∑(${wp})`;
    }
    return num;
  }

  // Plain aggregations.
  if (agg === 'sum') return `∑(${path})`;
  return `${agg}(${path})`;  // mean / median / mode / min / max
}

/**
 * The ``_{dim, dim, …}`` subscript. Time dims render as
 * ``date:month`` (path:interval) when their interval differs from the dim
 * name, otherwise the dim name suffices.
 */
export function renderDimSubscript(group: Dimension[]): string {
  if (group.length === 0) return '';
  const parts = group.map(renderDim);
  return ` _{${parts.join(', ')}}`;
}

function renderDim(d: Dimension): string {
  // We render the dim NAME only on the math line — the path lives in the
  // popover (avoids walls of ``regulatorische_handlungen[*].subject_name``
  // in subscripts). Pros click into the popover for the path; the name is
  // the symbol on the math line.
  //
  // Time dims still need their interval visible — it changes the
  // semantics of the bucket. So time dims append ``by month`` etc.
  if (d.kind === 'time') {
    const iv = d.interval ?? 'month';
    // If the user named the dim after the interval, the name is redundant
    // — render just ``by interval``. Otherwise ``name by interval``.
    return d.name.toLowerCase() === iv ? `by ${iv}` : `${d.name} by ${iv}`;
  }
  return d.name;
}

/** Render a FilterSet as a one-line ``where:`` clause. */
export function renderFilter(filter: FilterSet | null | undefined): string {
  if (!filter || !filter.conditions || filter.conditions.length === 0) return '';
  const op = (filter.logic ?? 'and').toUpperCase();
  return filter.conditions.map(renderCondition).join(` ${op} `);
}

function renderCondition(c: FieldCondition): string {
  const opMap: Record<string, string> = {
    eq: '=', ne: '!=', equals: '=', not_equals: '!=',
    gt: '>', ge: '>=', greater_than: '>', greater_or_equal: '>=',
    lt: '<', le: '<=', less_than: '<', less_or_equal: '<=',
    in: 'in', not_in: 'not in',
    contains: 'contains', not_contains: 'not contains',
    between: 'between',
    exists: 'is set', not_exists: 'is not set',
    'relational.cooccurs': 'co-occurs',
  };
  const op = opMap[c.operator] ?? c.operator;
  const val = formatValue(c.value);
  if (op === 'is set' || op === 'is not set') return `${c.path} ${op}`;
  return `${c.path} ${op} ${val}`;
}

function formatValue(v: any): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`;
  return JSON.stringify(v);
}


// ─── Token stream — for the React renderer + click-to-edit popovers ────────

export type MathTokenKind =
  | 'name'              // LHS formula name (rename popover)
  | 'eq'                // the '=' separator
  | 'agg'               // 'sum' | '∑' | 'mean' | 'count' | etc. (agg picker popover)
  | 'field'             // a JSONB path (field picker popover)
  | 'op'                // operators · / + - · @
  | 'paren'             // ( ) [ ]
  | 'subscript-open'    // opens the _{ block (renderer wraps as <sub>)
  | 'subscript-close'   // closes the } block
  | 'subscript-content' // single dim entry inside subscript (per-dim popover)
  | 'composition'       // @formula_name.col (composition picker popover)
  | 'where-kw'          // 'where:' literal
  | 'logic'             // AND / OR
  | 'literal'           // string / number / 'null'
  | 'unknown';

export interface MathToken {
  kind: MathTokenKind;
  text: string;
  /** Path back into the formula's structured body for popover edits.
   *  For ``field`` tokens this is the JSONB path. For ``agg`` it's the
   *  measure name. For ``subscript-content`` it's the dim name. */
  ref?: string;
}

/**
 * Tokenise a rendered formula string back into a stream for the React
 * component to decorate. This is the read-side counterpart of
 * :func:`renderFormula` — it doesn't try to parse arbitrary input (use
 * :func:`parseFormula` for that), only what ``renderFormula`` emits.
 */
export function tokenizeFormula(f: Formula): MathToken[] {
  const tokens: MathToken[] = [];
  tokens.push({ kind: 'name', text: f.name, ref: f.name });
  tokens.push({ kind: 'eq', text: ' = ' });
  pushRhs(tokens, f);
  pushSubscript(tokens, f.group ?? []);
  if (f.filter && (f.filter.conditions ?? []).length > 0) {
    tokens.push({ kind: 'where-kw', text: '   where: ' });
    pushFilterTokens(tokens, f.filter);
  }
  return tokens;
}

function pushRhs(tokens: MathToken[], f: Formula): void {
  const measures = f.measures ?? [];
  const derives = f.derives ?? [];

  if (derives.length > 0) {
    const last = derives[derives.length - 1];
    tokens.push({ kind: 'unknown', text: last.expr.trim(), ref: last.name });
    return;
  }

  if (measures.length === 1) {
    pushMeasure(tokens, measures[0], f.weight ?? null);
    return;
  }

  if (measures.length > 1) {
    measures.forEach((m, i) => {
      if (i > 0) tokens.push({ kind: 'op', text: ', ' });
      pushMeasure(tokens, m, f.weight ?? null);
    });
    return;
  }

  tokens.push({ kind: 'agg', text: 'count', ref: '__implicit_count' });
}

function pushMeasure(tokens: MathToken[], m: Measure, weight: Measure | null): void {
  const agg = m.agg ?? 'count';
  if (agg === 'count') {
    tokens.push({ kind: 'agg', text: 'count', ref: m.name });
    if (m.path) {
      tokens.push({ kind: 'paren', text: '(' });
      tokens.push({ kind: 'field', text: pathLeaf(m.path), ref: m.path });
      tokens.push({ kind: 'paren', text: ')' });
    }
    return;
  }
  if (agg === 'top') {
    const n = m.top_n ?? 5;
    tokens.push({ kind: 'agg', text: `top ${n}`, ref: m.name });
    if (m.top_by) {
      tokens.push({ kind: 'op', text: ' by ' });
      tokens.push({ kind: 'field', text: pathLeaf(m.top_by), ref: m.top_by });
      tokens.push({ kind: 'op', text: ' ↓' });
    }
    return;
  }
  if (agg === 'distribution') {
    tokens.push({ kind: 'agg', text: 'distribution', ref: m.name });
    tokens.push({ kind: 'paren', text: '(' });
    tokens.push({ kind: 'field', text: pathLeaf(m.path), ref: m.path ?? undefined });
    tokens.push({ kind: 'paren', text: ')' });
    return;
  }

  const symbol: string = (agg === 'sum') ? '∑' : agg;
  // Weighted forms.
  if (weight && weight.path && (agg === 'sum' || agg === 'mean')) {
    tokens.push({ kind: 'agg', text: '∑', ref: m.name });
    tokens.push({ kind: 'paren', text: '(' });
    tokens.push({ kind: 'field', text: pathLeaf(m.path), ref: m.path ?? undefined });
    tokens.push({ kind: 'op', text: ' · ' });
    tokens.push({ kind: 'field', text: pathLeaf(weight.path), ref: weight.path });
    tokens.push({ kind: 'paren', text: ')' });
    if (agg === 'mean') {
      tokens.push({ kind: 'op', text: ' / ' });
      tokens.push({ kind: 'agg', text: '∑', ref: '__weight_denom' });
      tokens.push({ kind: 'paren', text: '(' });
      tokens.push({ kind: 'field', text: pathLeaf(weight.path), ref: weight.path });
      tokens.push({ kind: 'paren', text: ')' });
    }
    return;
  }

  tokens.push({ kind: 'agg', text: symbol, ref: m.name });
  tokens.push({ kind: 'paren', text: '(' });
  tokens.push({ kind: 'field', text: pathLeaf(m.path), ref: m.path ?? undefined });
  tokens.push({ kind: 'paren', text: ')' });
}

function pushSubscript(tokens: MathToken[], group: Dimension[]): void {
  if (group.length === 0) return;
  // The renderer turns ``subscript-open`` / ``subscript-close`` into a
  // <sub> wrapper around the dim labels — no literal ``_{`` characters
  // make it to the DOM, but the canonical text version keeps them so the
  // parser can round-trip.
  tokens.push({ kind: 'subscript-open', text: ' _{' });
  group.forEach((d, i) => {
    if (i > 0) tokens.push({ kind: 'op', text: ', ' });
    let label: string;
    if (d.kind === 'time') {
      const iv = d.interval ?? 'month';
      label = d.name.toLowerCase() === iv ? `by ${iv}` : `${d.name} by ${iv}`;
    } else {
      label = d.name;
    }
    tokens.push({ kind: 'subscript-content', text: label, ref: d.name });
  });
  tokens.push({ kind: 'subscript-close', text: '}' });
}

function pushFilterTokens(tokens: MathToken[], f: FilterSet): void {
  const conditions = f.conditions ?? [];
  const logic = (f.logic ?? 'and').toUpperCase();
  conditions.forEach((c, i) => {
    if (i > 0) {
      tokens.push({ kind: 'logic', text: ` ${logic} ` });
    }
    const fragment = renderCondition(c);
    tokens.push({ kind: 'literal', text: fragment, ref: c.path });
  });
}


// ─── Parse: math text → Formula body (partial) ─────────────────────────────

// Parser is intentionally tolerant — it parses the canonical shape
// ``renderFormula`` emits and a handful of common variants the user is
// likely to type. Anything it can't parse is left as-is in
// ``Formula.derives[0].expr`` so the backend has a chance to take a swing
// at it. The structured editor (token popovers) is the safety net for
// authors who don't want to remember the grammar.

export interface ParseResult {
  formula: Partial<Formula>;
  errors: string[];
  warnings: string[];
}

/**
 * Parse a math-line formula text into a partial Formula body. The result
 * carries best-effort structure plus diagnostic messages; the editor
 * shows the messages inline and uses the partial body to drive the
 * popovers.
 *
 * This is intentionally a small, focused parser — covers the canonical
 * shapes from :func:`renderFormula` plus minor variants. The full grammar
 * is in ``backend/app/core/expr.py``; ``exprGrammar.ts`` mirrors the derive
 * subset specifically. For the math line itself, we settle for tolerant
 * pattern matching here.
 */
export function parseFormula(text: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const eqIdx = text.indexOf('=');
  if (eqIdx === -1) {
    return {
      formula: {},
      errors: ['missing `=` — write `name = expression`'],
      warnings: [],
    };
  }
  const name = text.slice(0, eqIdx).trim();
  if (!name) errors.push('formula needs a name on the left of `=`');

  let rhs = text.slice(eqIdx + 1).trim();

  // Split off the `where:` filter clause.
  let filter: FilterSet | undefined;
  const whereMatch = rhs.match(/\s+where:\s*(.+)$/i);
  if (whereMatch) {
    filter = parseFilterClause(whereMatch[1], warnings);
    rhs = rhs.slice(0, whereMatch.index).trim();
  }

  // Split off the subscript `_{...}`.
  let group: Dimension[] = [];
  const subMatch = rhs.match(/\s*_\{([^}]+)\}\s*$/);
  if (subMatch) {
    group = parseDimSubscript(subMatch[1], warnings);
    rhs = rhs.slice(0, subMatch.index).trim();
  }

  // What's left is the measure/derive expression. We try to recognise the
  // canonical aggregate shapes first; if none match, treat as a derive
  // expression.
  const { measures, derives, weight } = parseRhs(rhs, warnings);

  return {
    formula: {
      name,
      group,
      measures,
      derives,
      weight: weight ?? null,
      filter,
    },
    errors,
    warnings,
  };
}

function parseRhs(rhs: string, warnings: string[]):
  { measures: Measure[]; derives: DeriveSpec[]; weight?: Measure }
{
  // Recognise the weighted-mean canonical form: ∑(X · W) / ∑(W)
  const wmean = rhs.match(/^[∑sum]+\(\s*([^()·*]+?)\s*[·*]\s*([^()]+?)\s*\)\s*\/\s*[∑sum]+\(\s*\1?\s*([^()]*)\s*\)$/);
  // (The above is fragile — better to use a more permissive matcher.)

  // Weighted form: ∑(path · weight_path) or sum(path · weight_path) — no
  // denominator means agg=sum, with denominator means agg=mean.
  const weightedSumMatch = rhs.match(/^(?:∑|sum)\s*\(\s*([^()·*]+?)\s*[·*]\s*([^()]+?)\s*\)$/);
  const weightedMeanMatch = rhs.match(
    /^(?:∑|sum)\s*\(\s*([^()·*]+?)\s*[·*]\s*([^()]+?)\s*\)\s*\/\s*(?:∑|sum)\s*\(\s*([^()]+?)\s*\)$/
  );

  if (weightedMeanMatch) {
    const [, valPath, wPath1, wPath2] = weightedMeanMatch;
    if (wPath1.trim() !== wPath2.trim()) {
      warnings.push(`weighted-mean numerator and denominator should use the same weight path`);
    }
    return {
      measures: [{ name: '_v', path: valPath.trim(), agg: 'mean' } as Measure],
      derives: [],
      weight: { name: '_w', path: wPath1.trim(), agg: 'count' } as Measure,
    };
  }

  if (weightedSumMatch) {
    const [, valPath, wPath] = weightedSumMatch;
    return {
      measures: [{ name: '_v', path: valPath.trim(), agg: 'sum' } as Measure],
      derives: [],
      weight: { name: '_w', path: wPath.trim(), agg: 'count' } as Measure,
    };
  }

  // Plain aggregations: agg(path) or `count` alone.
  const aggMatch = rhs.match(
    /^(count|sum|∑|mean|median|mode|min|max|distribution)(?:\s*\(\s*([^()]*)\s*\))?$/i
  );
  if (aggMatch) {
    const [, aggRaw, pathRaw] = aggMatch;
    const agg = aggRaw === '∑' ? 'sum' : aggRaw.toLowerCase();
    const path = pathRaw?.trim();
    return {
      measures: [{
        name: '_v',
        path: path || undefined,
        agg: agg as Measure['agg'],
      } as Measure],
      derives: [],
    };
  }

  // top N by field
  const topMatch = rhs.match(/^top\s+(\d+)(?:\s+by\s+([^\s↓↑]+)(?:\s+(↓|↑))?)?$/i);
  if (topMatch) {
    const [, n, by, _dir] = topMatch;
    return {
      measures: [{
        name: '_v',
        agg: 'top',
        top_n: Number(n),
        top_by: by,
      } as Measure],
      derives: [],
    };
  }

  // Fall through: treat the whole RHS as a derive expression. The author
  // probably wrote `a / b` or `x + y` and the structured editor / backend
  // will handle it. The `_v` measure stays as a default count so the
  // engine has something to GROUP BY.
  return {
    measures: [{ name: '_count', agg: 'count' } as Measure],
    derives: [{ name: '_v', expr: rhs }],
  };
}

function parseDimSubscript(text: string, warnings: string[]): Dimension[] {
  const parts = text.split(',').map(s => s.trim()).filter(Boolean);
  return parts.map(part => parseDim(part, warnings));
}

function parseDim(text: string, warnings: string[]): Dimension {
  // ``name:path by interval`` — time dim
  const timeMatch = text.match(/^([^:]+?)(?::(.+?))?\s+by\s+(day|week|month|quarter|year)$/i);
  if (timeMatch) {
    const [, name, path, interval] = timeMatch;
    return {
      name: name.trim(),
      path: (path ?? name).trim(),
      kind: 'time',
      interval: interval.toLowerCase() as Dimension['interval'],
    };
  }
  // ``name:path``
  const colonMatch = text.match(/^([^:]+):(.+)$/);
  if (colonMatch) {
    const [, name, path] = colonMatch;
    return {
      name: name.trim(),
      path: path.trim(),
      kind: 'field',
    };
  }
  // ``name`` — name and path are the same; default kind=field
  return { name: text, path: text, kind: 'field' };
}

function parseFilterClause(text: string, warnings: string[]): FilterSet {
  // Split on AND / OR — first occurrence wins as the FilterSet logic.
  const logicMatch = text.match(/\b(AND|OR)\b/i);
  const logic = (logicMatch ? logicMatch[1] : 'AND').toLowerCase() as 'and' | 'or';
  const splitter = new RegExp(`\\s+${logic}\\s+`, 'i');
  const condTexts = text.split(splitter).map(s => s.trim()).filter(Boolean);
  const conditions: FieldCondition[] = condTexts.map(c => parseCondition(c, warnings))
    .filter((c): c is FieldCondition => c !== null);
  return { logic, conditions };
}

function parseCondition(text: string, warnings: string[]): FieldCondition | null {
  // path OP value — pick the longest matching operator.
  const operators: Array<[string, FieldCondition['operator']]> = [
    [' is not set', 'not_exists'],
    [' is set', 'exists'],
    [' not contains ', 'not_contains'],
    [' contains ', 'contains'],
    [' not in ', 'not_in'],
    [' in ', 'in'],
    [' between ', 'between'],
    ['>=', 'ge'],
    ['<=', 'le'],
    ['!=', 'ne'],
    ['>', 'gt'],
    ['<', 'lt'],
    ['=', 'eq'],
  ];
  for (const [literal, op] of operators) {
    const idx = text.indexOf(literal);
    if (idx === -1) continue;
    const path = text.slice(0, idx).trim();
    const valueText = text.slice(idx + literal.length).trim();
    if (op === 'exists' || op === 'not_exists') {
      return { path, operator: op, value: null };
    }
    return { path, operator: op, value: parseValue(valueText) };
  }
  warnings.push(`could not parse condition: ${text}`);
  return null;
}

function parseValue(text: string): any {
  if (!text) return null;
  // Quoted string
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  // List
  if (text.startsWith('[') && text.endsWith(']')) {
    try { return JSON.parse(text); } catch { /* fall through */ }
  }
  // Number
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  // Boolean
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  // Bare identifier — keep as string.
  return text;
}
