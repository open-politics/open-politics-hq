"""A tiny safe expression language for formula derives.

Used by ``PanelProjection.derives`` (the intelligence-layer post-aggregate
verb — see ``docs/intelligence/HOW_TO.md`` § Six verbs). Each ``DeriveSpec``
declares a name and an expression; the expression is evaluated against a
namespace built from the row's scalars, weight, roles, derived values, and
any cross-formula references.

Why a custom evaluator (rather than ``eval``):

- Ban attribute access, name binding, ``__dunder__`` lookups, imports.
- Allow a fixed set of safe builtins (``min``, ``max``, ``abs``, ``log``,
  ``clamp``) without polluting the namespace.
- Make the expression surface stable so the DossierAgent can reason
  about what's reachable.

Grammar:

    expr        := comparison | arith
    comparison  := arith (==|!=|<|<=|>|>=) arith
    arith       := term ((+|-) term)*
    term        := factor ((*|/|%) factor)*
    factor      := unary | '(' expr ')'
    unary       := ('-' | '+')? primary
    primary     := number | string | identifier | call | subscript | conditional
    conditional := expr 'if' expr 'else' expr
    call        := identifier '(' [expr (',' expr)*] ')'
    subscript   := identifier '[' expr (',' expr)* ']' ('.' identifier)?
                    // composition lookup: @formula_name[k1, k2].col
    identifier  := /[A-Za-z_@][A-Za-z0-9_]*/

The subscript form covers the composition pattern: ``@firm_active_quarters[target, quarter].q_count``.
"""

from __future__ import annotations

import ast
import math
import re
from typing import Any, Callable

# Python's tokenizer rejects ``@`` inside expressions. We use the conceptual
# syntax ``@formula_name[...]`` in user-facing docs, but rewrite to
# ``__FORMULA_formula_name[...]`` before parsing. The Subscript visitor
# recognises the prefix and dispatches to FormulaLookup.
_FORMULA_PREFIX = "__FORMULA_"
_AT_REF_RE = re.compile(r"@([A-Za-z_][A-Za-z0-9_]*)")

# ─── Safe builtins ──────────────────────────────────────────────────────────

def _clamp(x: float, lo: float, hi: float) -> float:
    if x < lo:
        return lo
    if x > hi:
        return hi
    return x


def _log(x: float, base: float | None = None) -> float:
    if base is None:
        return math.log(x)
    return math.log(x, base)


SAFE_BUILTINS: dict[str, Callable[..., Any]] = {
    "min": min,
    "max": max,
    "abs": abs,
    "round": round,
    "log": _log,
    "clamp": _clamp,
    "len": len,
    "coalesce": lambda *xs: next((x for x in xs if x is not None), None),
}


# ─── Composition lookup hook ────────────────────────────────────────────────


class FormulaLookup:
    """A pluggable resolver for ``@formula_name[k1, k2].col`` expressions.

    The default implementation returns ``None`` for every lookup (so a
    ``derive`` that references another formula safely degrades to None
    when the source formula hasn't been materialised). Real implementations
    live in ``app.api.modules.annotation.formulas`` and bind to a
    ``DashboardConfig`` + run scope.
    """

    def lookup(
        self,
        formula_name: str,
        keys: tuple[Any, ...],
        column: str | None,
    ) -> Any:
        return None


# ─── Evaluator ──────────────────────────────────────────────────────────────


class _ExprEvaluator(ast.NodeVisitor):
    """Walk a parsed AST and evaluate against a namespace.

    Raises ``ValueError`` on anything outside the supported grammar so
    invalid expressions fail loudly at formula-save time rather than
    silently returning a garbage value.
    """

    def __init__(
        self,
        namespace: dict[str, Any],
        formula_lookup: FormulaLookup | None,
    ) -> None:
        self.ns = namespace
        self.fl = formula_lookup or FormulaLookup()

    def _unsupported(self, node: ast.AST) -> Any:
        raise ValueError(f"expression construct not allowed: {type(node).__name__}")

    # ── literal nodes ──────────────────────────────────────────────
    def visit_Constant(self, node: ast.Constant) -> Any:
        if isinstance(node.value, (int, float, str, bool)) or node.value is None:
            return node.value
        return self._unsupported(node)

    # ── identifier / lookup ────────────────────────────────────────
    def visit_Name(self, node: ast.Name) -> Any:
        n = node.id
        if n in SAFE_BUILTINS:
            return SAFE_BUILTINS[n]
        if n in self.ns:
            return self.ns[n]
        raise ValueError(f"unknown identifier in expression: {n!r}")

    # ── arithmetic ─────────────────────────────────────────────────
    def visit_BinOp(self, node: ast.BinOp) -> Any:
        left = self.visit(node.left)
        right = self.visit(node.right)
        op = node.op
        if isinstance(op, ast.Add):
            return left + right
        if isinstance(op, ast.Sub):
            return left - right
        if isinstance(op, ast.Mult):
            return left * right
        if isinstance(op, ast.Div):
            if right == 0:
                return None  # safe-divide: 0-denominator → None (not NaN, not raise)
            return left / right
        if isinstance(op, ast.Mod):
            return left % right
        if isinstance(op, ast.Pow):
            return left ** right
        return self._unsupported(node)

    def visit_UnaryOp(self, node: ast.UnaryOp) -> Any:
        v = self.visit(node.operand)
        if isinstance(node.op, ast.USub):
            return -v
        if isinstance(node.op, ast.UAdd):
            return v
        if isinstance(node.op, ast.Not):
            return not v
        return self._unsupported(node)

    # ── comparison ─────────────────────────────────────────────────
    def visit_Compare(self, node: ast.Compare) -> Any:
        left = self.visit(node.left)
        for op, right_node in zip(node.ops, node.comparators):
            right = self.visit(right_node)
            if isinstance(op, ast.Eq):
                ok = left == right
            elif isinstance(op, ast.NotEq):
                ok = left != right
            elif isinstance(op, ast.Lt):
                ok = left < right
            elif isinstance(op, ast.LtE):
                ok = left <= right
            elif isinstance(op, ast.Gt):
                ok = left > right
            elif isinstance(op, ast.GtE):
                ok = left >= right
            else:
                return self._unsupported(node)
            if not ok:
                return False
            left = right
        return True

    def visit_BoolOp(self, node: ast.BoolOp) -> Any:
        vals = [self.visit(v) for v in node.values]
        if isinstance(node.op, ast.And):
            result = True
            for v in vals:
                result = result and v
                if not result:
                    return result
            return result
        if isinstance(node.op, ast.Or):
            result = False
            for v in vals:
                result = result or v
                if result:
                    return result
            return result
        return self._unsupported(node)

    # ── conditional ────────────────────────────────────────────────
    def visit_IfExp(self, node: ast.IfExp) -> Any:
        return self.visit(node.body) if self.visit(node.test) else self.visit(node.orelse)

    # ── function call ──────────────────────────────────────────────
    def visit_Call(self, node: ast.Call) -> Any:
        if not isinstance(node.func, ast.Name):
            return self._unsupported(node)
        fn = self.visit(node.func)
        if not callable(fn):
            raise ValueError(f"not callable: {node.func.id!r}")
        args = [self.visit(a) for a in node.args]
        if node.keywords:
            raise ValueError("keyword arguments not allowed in expression")
        return fn(*args)

    # ── composition lookup: @formula_name[k1, k2].col ──────────────
    # The @-prefix is rewritten to __FORMULA_ before parsing (Python's
    # tokenizer can't ingest ``@`` mid-expression). The Subscript visitor
    # recognises the rewritten prefix and dispatches to FormulaLookup.
    def visit_Subscript(self, node: ast.Subscript) -> Any:
        if not isinstance(node.value, ast.Name) or not node.value.id.startswith(_FORMULA_PREFIX):
            return self._unsupported(node)
        formula_name = node.value.id[len(_FORMULA_PREFIX):]
        slice_node = node.slice
        if isinstance(slice_node, ast.Tuple):
            keys = tuple(self.visit(e) for e in slice_node.elts)
        else:
            keys = (self.visit(slice_node),)
        return self.fl.lookup(formula_name, keys, None)

    def visit_Attribute(self, node: ast.Attribute) -> Any:
        # Allow `@formula[k].col` — attribute on a Subscript whose value carries
        # the formula-reference prefix.
        if isinstance(node.value, ast.Subscript) and isinstance(node.value.value, ast.Name):
            base = node.value.value
            if base.id.startswith(_FORMULA_PREFIX):
                formula_name = base.id[len(_FORMULA_PREFIX):]
                slice_node = node.value.slice
                if isinstance(slice_node, ast.Tuple):
                    keys = tuple(self.visit(e) for e in slice_node.elts)
                else:
                    keys = (self.visit(slice_node),)
                return self.fl.lookup(formula_name, keys, node.attr)
        return self._unsupported(node)

    # ── catch-all ──────────────────────────────────────────────────
    def generic_visit(self, node: ast.AST) -> Any:
        return self._unsupported(node)


# ─── Public entry points ────────────────────────────────────────────────────


def parse_expr(expr: str) -> ast.AST:
    """Parse an expression to an AST. Raises ``ValueError`` on syntax errors.

    Rewrites ``@formula_name`` to ``__FORMULA_formula_name`` before parsing
    so Python's tokenizer accepts the formula-composition reference.
    """
    rewritten = _AT_REF_RE.sub(lambda m: _FORMULA_PREFIX + m.group(1), expr)
    try:
        return ast.parse(rewritten, mode="eval").body
    except SyntaxError as e:
        raise ValueError(f"invalid expression syntax: {expr!r} — {e}") from e


def evaluate(
    expr: str | ast.AST,
    namespace: dict[str, Any],
    formula_lookup: FormulaLookup | None = None,
) -> Any:
    """Evaluate a safe expression against a namespace.

    The ``namespace`` should contain whatever names the expression may
    reference — typically ``{"scalars": ..., "weight": ..., "roles": ...,
    "derived": ...}`` for a Formula derive step.

    The ``formula_lookup`` resolves ``@formula_name[k].col`` references
    for composition. ``None`` means lookups return ``None`` (safe default
    for tests + standalone validation).

    Raises ``ValueError`` on:
    - syntax errors
    - unsupported constructs (attribute access on arbitrary names, imports,
      assignments, function definitions, comprehensions, generator expressions)
    - unknown identifiers
    """
    tree = expr if isinstance(expr, ast.AST) else parse_expr(expr)
    return _ExprEvaluator(namespace, formula_lookup).visit(tree)
