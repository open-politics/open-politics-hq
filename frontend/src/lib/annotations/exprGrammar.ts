/**
 * Tiny advisory parser for `derive` expressions — mirrors the backend
 * surface in `backend/app/core/expr.py`.
 *
 * The backend is the source of truth at evaluation time (`/view` formula
 * phase). This module gives the FormulaEditor cheap, synchronous
 * client-side validation: surface unbalanced parens, unknown identifiers,
 * malformed `@formula[k].col` references, etc. *before* the user hits
 * preview.
 *
 * Grammar (matches `core/expr.py`):
 *
 *   expr        := comparison | arith
 *   comparison  := arith (==|!=|<|<=|>|>=) arith
 *   arith       := term ((+|-) term)*
 *   term        := factor ((*|/|%) factor)*
 *   factor      := unary | '(' expr ')'
 *   unary       := ('-' | '+')? primary
 *   primary     := number | string | identifier | call | subscript | conditional
 *   conditional := expr 'if' expr 'else' expr
 *   call        := identifier '(' [expr (',' expr)* ] ')'
 *   subscript   := identifier '[' expr (',' expr)* ']' ('.' identifier)?
 *                  // composition: @formula_name[k1, k2].col
 *   identifier  := letter-or-underscore-or-at, then alphanumerics/underscores
 *
 * What this validator does NOT do: full type checking. The backend has the
 * real expression evaluator; this is for fast UI feedback.
 */

export const SAFE_BUILTINS = new Set<string>([
  'min', 'max', 'abs', 'round', 'log', 'clamp', 'len', 'coalesce',
]);

export interface ExprDiagnostic {
  kind: 'error' | 'warn';
  message: string;
  /** 0-indexed character offset where the problem starts. */
  start: number;
  /** 0-indexed character offset where the problem ends (exclusive). */
  end: number;
}

export interface ExprToken {
  kind:
    | 'number'
    | 'string'
    | 'ident'
    | 'at'          // @formula_name reference
    | 'op'
    | 'lparen' | 'rparen'
    | 'lbracket' | 'rbracket'
    | 'comma'
    | 'dot'
    | 'keyword';
  text: string;
  start: number;
  end: number;
}

const KEYWORDS = new Set(['if', 'else']);
const OPERATORS = [
  '==', '!=', '<=', '>=', '<', '>',
  '+', '-', '*', '/', '%',
];

/**
 * Tokenize a derive expression. Returns the token stream — callers can
 * highlight tokens (mono pill for `@formula`, blue for builtin call, etc.)
 * even when the expression is otherwise malformed.
 */
export function tokenize(expr: string): ExprToken[] {
  const out: ExprToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];

    // whitespace
    if (/\s/.test(c)) { i++; continue; }

    // number (possibly fractional)
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < expr.length && /[0-9.]/.test(expr[i])) i++;
      out.push({ kind: 'number', text: expr.slice(start, i), start, end: i });
      continue;
    }

    // string literal (single or double quoted)
    if (c === '"' || c === "'") {
      const start = i;
      const quote = c;
      i++;
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) i++;
        i++;
      }
      if (i < expr.length) i++; // consume closing quote
      out.push({ kind: 'string', text: expr.slice(start, i), start, end: i });
      continue;
    }

    // @formula identifier
    if (c === '@') {
      const start = i;
      i++;
      while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i])) i++;
      out.push({ kind: 'at', text: expr.slice(start, i), start, end: i });
      continue;
    }

    // identifier / keyword
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i])) i++;
      const text = expr.slice(start, i);
      out.push({
        kind: KEYWORDS.has(text) ? 'keyword' : 'ident',
        text, start, end: i,
      });
      continue;
    }

    // multi-char operators first
    let matched = false;
    for (const op of OPERATORS) {
      if (expr.startsWith(op, i)) {
        out.push({ kind: 'op', text: op, start: i, end: i + op.length });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // punctuation
    if (c === '(') { out.push({ kind: 'lparen', text: '(', start: i, end: i + 1 }); i++; continue; }
    if (c === ')') { out.push({ kind: 'rparen', text: ')', start: i, end: i + 1 }); i++; continue; }
    if (c === '[') { out.push({ kind: 'lbracket', text: '[', start: i, end: i + 1 }); i++; continue; }
    if (c === ']') { out.push({ kind: 'rbracket', text: ']', start: i, end: i + 1 }); i++; continue; }
    if (c === ',') { out.push({ kind: 'comma', text: ',', start: i, end: i + 1 }); i++; continue; }
    if (c === '.') { out.push({ kind: 'dot', text: '.', start: i, end: i + 1 }); i++; continue; }

    // unrecognised character — emit a single-char token as `op` so the
    // validator can flag it. Backend will reject anyway.
    out.push({ kind: 'op', text: c, start: i, end: i + 1 });
    i++;
  }
  return out;
}

/**
 * Identifier scope known to the FormulaEditor at validate time. Pass the
 * Formula's dim names + measure names + derive names; @formula references
 * are checked against the dashboard's saved formulas (passed separately).
 */
export interface ExprScope {
  /** Dim names declared on `Formula.group[].name`. */
  dims: Set<string>;
  /** Measure names declared on `Formula.measures[].name`. */
  measures: Set<string>;
  /** Derive names declared earlier in the same `Formula.derives[]` list. */
  derives: Set<string>;
  /** Saved formula names on `DashboardConfig.formulas[].name`. */
  formulas: Set<string>;
}

/**
 * Validate a derive expression. Returns a list of diagnostics — empty when
 * the expression looks clean. Doesn't try to be exhaustive — it catches the
 * common authoring mistakes (typo on a measure name, unbalanced brackets,
 * unknown @formula reference). Backend has the last word.
 */
export function validate(expr: string, scope: ExprScope): ExprDiagnostic[] {
  const diags: ExprDiagnostic[] = [];
  const tokens = tokenize(expr);
  if (tokens.length === 0) {
    return [{ kind: 'error', message: 'empty expression', start: 0, end: 0 }];
  }

  // Bracket balance.
  const stack: ExprToken[] = [];
  for (const t of tokens) {
    if (t.kind === 'lparen' || t.kind === 'lbracket') {
      stack.push(t);
    } else if (t.kind === 'rparen') {
      const top = stack.pop();
      if (!top || top.kind !== 'lparen') {
        diags.push({ kind: 'error', message: 'unmatched )', start: t.start, end: t.end });
      }
    } else if (t.kind === 'rbracket') {
      const top = stack.pop();
      if (!top || top.kind !== 'lbracket') {
        diags.push({ kind: 'error', message: 'unmatched ]', start: t.start, end: t.end });
      }
    }
  }
  for (const t of stack) {
    diags.push({ kind: 'error', message: `unclosed ${t.text}`, start: t.start, end: t.end });
  }

  // Identifier scope checks.
  const known = new Set<string>([
    ...scope.dims, ...scope.measures, ...scope.derives, ...SAFE_BUILTINS,
  ]);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'at') {
      const name = t.text.slice(1);
      if (!name) {
        diags.push({ kind: 'error', message: '@ must be followed by a formula name', start: t.start, end: t.end });
      } else if (!scope.formulas.has(name)) {
        diags.push({ kind: 'error', message: `@${name}: no formula by that name`, start: t.start, end: t.end });
      } else {
        // Composition must be subscripted: @name[...]
        const next = tokens[i + 1];
        if (!next || next.kind !== 'lbracket') {
          diags.push({
            kind: 'warn',
            message: `@${name} should be subscripted — @${name}[k1, k2].col`,
            start: t.start, end: t.end,
          });
        }
      }
      continue;
    }
    if (t.kind !== 'ident') continue;
    // Identifier followed by `(` is a call — check builtins.
    const next = tokens[i + 1];
    if (next && next.kind === 'lparen') {
      if (!SAFE_BUILTINS.has(t.text)) {
        diags.push({ kind: 'error', message: `${t.text}: unknown function`, start: t.start, end: t.end });
      }
      continue;
    }
    // Standalone identifier — must be a dim, measure, derive, or builtin.
    if (!known.has(t.text)) {
      diags.push({
        kind: 'error',
        message: `${t.text}: not a dim, measure, or derive on this formula`,
        start: t.start, end: t.end,
      });
    }
  }

  return diags;
}

/**
 * Walk an expression and extract all @formula references. The FormulaEditor
 * uses this to warn the author when their derive depends on another formula
 * that doesn't exist yet (or autocomplete it).
 */
export function extractFormulaReferences(expr: string): string[] {
  const tokens = tokenize(expr);
  return tokens.filter(t => t.kind === 'at').map(t => t.text.slice(1));
}
