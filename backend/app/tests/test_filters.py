"""
Tests for FilterRule, FilterExpression, and FilterFactory.

These are pure Python — no DB, no infrastructure. They test the in-memory
filter evaluation that flow FILTER steps use as fallback when SQL pushdown
can't handle the expression.
"""
import pytest

from app.api.modules.flow.services.filter_service import (
    FilterRule,
    FilterExpression,
    FilterFactory,
    FilterOperator,
    LogicalOperator,
)


# ═══════════════════════════════════════════════════
# FilterRule — single predicate evaluation
# ═══════════════════════════════════════════════════

class TestFilterRule:
    """Test individual rule evaluation against data dicts."""

    # --- comparison operators ---

    def test_eq(self):
        rule = FilterRule("status", FilterOperator.EQ, "active")
        assert rule.evaluate({"status": "active"}) is True
        assert rule.evaluate({"status": "inactive"}) is False

    def test_ne(self):
        rule = FilterRule("status", FilterOperator.NE, "failed")
        assert rule.evaluate({"status": "active"}) is True
        assert rule.evaluate({"status": "failed"}) is False

    def test_gt(self):
        rule = FilterRule("score", FilterOperator.GT, 0.5)
        assert rule.evaluate({"score": 0.8}) is True
        assert rule.evaluate({"score": 0.5}) is False
        assert rule.evaluate({"score": 0.3}) is False

    def test_ge(self):
        rule = FilterRule("score", FilterOperator.GE, 0.5)
        assert rule.evaluate({"score": 0.5}) is True
        assert rule.evaluate({"score": 0.8}) is True
        assert rule.evaluate({"score": 0.3}) is False

    def test_lt(self):
        rule = FilterRule("count", FilterOperator.LT, 10)
        assert rule.evaluate({"count": 5}) is True
        assert rule.evaluate({"count": 10}) is False

    def test_le(self):
        rule = FilterRule("count", FilterOperator.LE, 10)
        assert rule.evaluate({"count": 10}) is True
        assert rule.evaluate({"count": 11}) is False

    # --- string operators ---

    def test_contains(self):
        rule = FilterRule("title", FilterOperator.CONTAINS, "climate")
        assert rule.evaluate({"title": "Climate Policy Report"}) is True
        assert rule.evaluate({"title": "Economic Analysis"}) is False

    def test_contains_case_insensitive(self):
        rule = FilterRule("title", FilterOperator.CONTAINS, "CLIMATE")
        assert rule.evaluate({"title": "climate policy"}) is True

    def test_not_contains(self):
        rule = FilterRule("title", FilterOperator.NOT_CONTAINS, "spam")
        assert rule.evaluate({"title": "Important Report"}) is True
        assert rule.evaluate({"title": "This is spam"}) is False

    def test_starts_with(self):
        rule = FilterRule("title", FilterOperator.STARTS_WITH, "report")
        assert rule.evaluate({"title": "Report on Climate"}) is True
        assert rule.evaluate({"title": "Climate Report"}) is False

    def test_ends_with(self):
        rule = FilterRule("path", FilterOperator.ENDS_WITH, ".pdf")
        assert rule.evaluate({"path": "document.pdf"}) is True
        assert rule.evaluate({"path": "document.txt"}) is False

    def test_regex(self):
        rule = FilterRule("code", FilterOperator.REGEX, r"^[A-Z]{2}-\d+$")
        assert rule.evaluate({"code": "DE-123"}) is True
        # String comparisons are case-insensitive in the filter implementation
        assert rule.evaluate({"code": "de-123"}) is True
        assert rule.evaluate({"code": "ABC"}) is False

    # --- collection operators ---

    def test_in(self):
        rule = FilterRule("kind", FilterOperator.IN, ["pdf", "csv", "text"])
        assert rule.evaluate({"kind": "pdf"}) is True
        assert rule.evaluate({"kind": "image"}) is False

    def test_not_in(self):
        rule = FilterRule("kind", FilterOperator.NOT_IN, ["spam", "junk"])
        assert rule.evaluate({"kind": "pdf"}) is True
        assert rule.evaluate({"kind": "spam"}) is False

    # --- existence operators ---

    def test_exists(self):
        rule = FilterRule("metadata.score", FilterOperator.EXISTS)
        assert rule.evaluate({"metadata": {"score": 0.5}}) is True
        assert rule.evaluate({"metadata": {}}) is False
        assert rule.evaluate({}) is False

    def test_not_exists(self):
        rule = FilterRule("metadata.score", FilterOperator.NOT_EXISTS)
        assert rule.evaluate({"metadata": {}}) is True
        assert rule.evaluate({"metadata": {"score": 0.5}}) is False

    # --- dot-path traversal ---

    def test_nested_field(self):
        rule = FilterRule("metadata.language", FilterOperator.EQ, "en")
        assert rule.evaluate({"metadata": {"language": "en"}}) is True
        assert rule.evaluate({"metadata": {"language": "de"}}) is False

    def test_deeply_nested_field(self):
        rule = FilterRule("a.b.c", FilterOperator.EQ, 42)
        assert rule.evaluate({"a": {"b": {"c": 42}}}) is True
        assert rule.evaluate({"a": {"b": {"c": 0}}}) is False

    def test_missing_field_returns_false(self):
        """Missing field on comparison → False, not crash."""
        rule = FilterRule("nonexistent", FilterOperator.EQ, "value")
        assert rule.evaluate({}) is False

    # --- serialization ---

    def test_roundtrip(self):
        rule = FilterRule("score", FilterOperator.GE, 0.5)
        d = rule.to_dict()
        restored = FilterRule.from_dict(d)
        assert restored.field == "score"
        assert restored.operator == FilterOperator.GE
        assert restored.value == 0.5

    # --- validation ---

    def test_exists_rejects_value(self):
        """EXISTS/NOT_EXISTS must have value=None."""
        with pytest.raises(ValueError):
            FilterRule("field", FilterOperator.EXISTS, "something")

    def test_comparison_requires_value(self):
        """Non-existence operators must have a value."""
        with pytest.raises(ValueError):
            FilterRule("field", FilterOperator.EQ)


# ═══════════════════════════════════════════════════
# FilterExpression — composite logic
# ═══════════════════════════════════════════════════

class TestFilterExpression:
    """Test composite filter expressions."""

    def test_empty_expression_matches_everything(self):
        expr = FilterExpression()
        assert expr.evaluate({"anything": "goes"}) is True
        assert expr.evaluate({}) is True

    def test_and_all_must_match(self):
        expr = FilterExpression(operator=LogicalOperator.AND)
        expr.add_rule("score", FilterOperator.GE, 0.5)
        expr.add_rule("status", FilterOperator.EQ, "active")
        assert expr.evaluate({"score": 0.8, "status": "active"}) is True
        assert expr.evaluate({"score": 0.8, "status": "failed"}) is False
        assert expr.evaluate({"score": 0.3, "status": "active"}) is False

    def test_or_any_can_match(self):
        expr = FilterExpression(operator=LogicalOperator.OR)
        expr.add_rule("kind", FilterOperator.EQ, "pdf")
        expr.add_rule("kind", FilterOperator.EQ, "csv")
        assert expr.evaluate({"kind": "pdf"}) is True
        assert expr.evaluate({"kind": "csv"}) is True
        assert expr.evaluate({"kind": "image"}) is False

    def test_nested_expressions(self):
        """AND of (score >= 0.5) AND (kind == pdf OR kind == csv)."""
        kind_expr = FilterExpression(operator=LogicalOperator.OR)
        kind_expr.add_rule("kind", FilterOperator.EQ, "pdf")
        kind_expr.add_rule("kind", FilterOperator.EQ, "csv")

        root = FilterExpression(operator=LogicalOperator.AND)
        root.add_rule("score", FilterOperator.GE, 0.5)
        root.add_expression(kind_expr)

        assert root.evaluate({"score": 0.8, "kind": "pdf"}) is True
        assert root.evaluate({"score": 0.8, "kind": "image"}) is False
        assert root.evaluate({"score": 0.3, "kind": "pdf"}) is False

    def test_fluent_api(self):
        """add_rule and add_expression return self for chaining."""
        expr = (
            FilterExpression(operator=LogicalOperator.AND)
            .add_rule("a", FilterOperator.EQ, 1)
            .add_rule("b", FilterOperator.GT, 0)
        )
        assert expr.evaluate({"a": 1, "b": 5}) is True

    def test_roundtrip(self):
        expr = FilterExpression(operator=LogicalOperator.AND)
        expr.add_rule("score", FilterOperator.GE, 0.5)
        expr.add_rule("status", FilterOperator.EQ, "active")

        d = expr.to_dict()
        restored = FilterExpression.from_dict(d)
        # Same behavior
        assert restored.evaluate({"score": 0.8, "status": "active"}) is True
        assert restored.evaluate({"score": 0.3, "status": "active"}) is False


# ═══════════════════════════════════════════════════
# FilterFactory — convenience constructors
# ═══════════════════════════════════════════════════

class TestFilterFactory:

    def test_threshold_filter(self):
        expr = FilterFactory.create_threshold_filter("score", 0.7)
        assert expr.evaluate({"score": 0.8}) is True
        assert expr.evaluate({"score": 0.7}) is True
        assert expr.evaluate({"score": 0.5}) is False

    def test_threshold_filter_custom_operator(self):
        expr = FilterFactory.create_threshold_filter("score", 0.7, operator=FilterOperator.GT)
        assert expr.evaluate({"score": 0.7}) is False  # GT, not GE
        assert expr.evaluate({"score": 0.8}) is True

    def test_range_filter(self):
        expr = FilterFactory.create_range_filter("score", 0.3, 0.8)
        assert expr.evaluate({"score": 0.5}) is True
        assert expr.evaluate({"score": 0.3}) is True  # inclusive
        assert expr.evaluate({"score": 0.8}) is True  # inclusive
        assert expr.evaluate({"score": 0.1}) is False
        assert expr.evaluate({"score": 0.9}) is False

    def test_keyword_filter_any(self):
        expr = FilterFactory.create_keyword_filter("title", ["climate", "energy"])
        assert expr.evaluate({"title": "Climate Policy Report"}) is True
        assert expr.evaluate({"title": "Energy Markets"}) is True
        assert expr.evaluate({"title": "Sports News"}) is False

    def test_keyword_filter_all(self):
        expr = FilterFactory.create_keyword_filter("title", ["climate", "policy"], match_any=False)
        assert expr.evaluate({"title": "Climate Policy Report"}) is True
        assert expr.evaluate({"title": "Climate Change"}) is False

    def test_whitelist_filter(self):
        expr = FilterFactory.create_whitelist_filter("kind", ["pdf", "csv"])
        assert expr.evaluate({"kind": "pdf"}) is True
        assert expr.evaluate({"kind": "image"}) is False

    def test_blacklist_filter(self):
        expr = FilterFactory.create_blacklist_filter("kind", ["spam", "junk"])
        assert expr.evaluate({"kind": "pdf"}) is True
        assert expr.evaluate({"kind": "spam"}) is False
