import logging
from typing import Dict, Any, List, Union, Optional, Set
from enum import Enum
from abc import ABC, abstractmethod
import re
from datetime import datetime
import operator as op

logger = logging.getLogger(__name__)

class FilterOperator(str, Enum):
    """Supported filter operators with type constraints."""
    # Comparison operators (numeric, string, datetime)
    EQ = "=="              # Equal to
    NE = "!="              # Not equal to
    LT = "<"               # Less than
    LE = "<="              # Less than or equal
    GT = ">"               # Greater than
    GE = ">="              # Greater than or equal
    
    # String operators
    CONTAINS = "contains"           # String contains substring
    NOT_CONTAINS = "not_contains"   # String does not contain substring
    STARTS_WITH = "starts_with"     # String starts with prefix
    ENDS_WITH = "ends_with"         # String ends with suffix
    REGEX = "regex"                 # String matches regex pattern
    
    # Collection operators
    IN = "in"                       # Value is in collection
    NOT_IN = "not_in"              # Value is not in collection
    
    # Existence operators
    EXISTS = "exists"               # Field exists and is not None
    NOT_EXISTS = "not_exists"       # Field does not exist or is None

class LogicalOperator(str, Enum):
    """Logical operators for combining filter rules."""
    AND = "and"
    OR = "or"
    NOT = "not"

class FilterRule:
    """A single filter rule with field, operator, and value."""
    
    def __init__(self, field: str, operator: FilterOperator, value: Any = None):
        self.field = field
        self.operator = FilterOperator(operator)
        self.value = value
        self._validate()
    
    def _validate(self):
        """Validate rule configuration."""
        # Existence operators shouldn't have values
        if self.operator in [FilterOperator.EXISTS, FilterOperator.NOT_EXISTS]:
            if self.value is not None:
                raise ValueError(f"Operator {self.operator} should not have a value")
        else:
            if self.value is None:
                raise ValueError(f"Operator {self.operator} requires a value")
    
    def _get_field_value(self, data: Dict[str, Any]) -> Any:
        """Get value from nested field path (e.g., 'metadata.score')."""
        keys = self.field.split('.')
        current = data
        
        for key in keys:
            if not isinstance(current, dict) or key not in current:
                return None
            current = current[key]
        
        return current
    
    def evaluate(self, data: Dict[str, Any]) -> bool:
        """Evaluate this rule against data."""
        field_value = self._get_field_value(data)
        
        try:
            if self.operator == FilterOperator.EXISTS:
                return field_value is not None
            elif self.operator == FilterOperator.NOT_EXISTS:
                return field_value is None
            
            # For all other operators, field must exist
            if field_value is None:
                return False
            
            if self.operator == FilterOperator.EQ:
                return field_value == self.value
            elif self.operator == FilterOperator.NE:
                return field_value != self.value
            elif self.operator == FilterOperator.LT:
                return field_value < self.value
            elif self.operator == FilterOperator.LE:
                return field_value <= self.value
            elif self.operator == FilterOperator.GT:
                return field_value > self.value
            elif self.operator == FilterOperator.GE:
                return field_value >= self.value
            elif self.operator == FilterOperator.CONTAINS:
                return str(self.value).lower() in str(field_value).lower()
            elif self.operator == FilterOperator.NOT_CONTAINS:
                return str(self.value).lower() not in str(field_value).lower()
            elif self.operator == FilterOperator.STARTS_WITH:
                return str(field_value).lower().startswith(str(self.value).lower())
            elif self.operator == FilterOperator.ENDS_WITH:
                return str(field_value).lower().endswith(str(self.value).lower())
            elif self.operator == FilterOperator.REGEX:
                return bool(re.search(str(self.value), str(field_value), re.IGNORECASE))
            elif self.operator == FilterOperator.IN:
                return field_value in self.value
            elif self.operator == FilterOperator.NOT_IN:
                return field_value not in self.value
            
            return False
            
        except (TypeError, ValueError) as e:
            logger.warning(f"Filter evaluation error for {self.field} {self.operator} {self.value}: {e}")
            return False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert rule to dictionary representation."""
        result = {
            "field": self.field,
            "operator": self.operator.value
        }
        if self.value is not None:
            result["value"] = self.value
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FilterRule":
        """Create rule from dictionary representation."""
        return cls(
            field=data["field"],
            operator=data["operator"],
            value=data.get("value")
        )

class FilterExpression:
    """A composable filter expression that can combine rules with logical operators."""
    
    def __init__(self, 
                 rules: Optional[List[FilterRule]] = None,
                 operator: LogicalOperator = LogicalOperator.AND,
                 sub_expressions: Optional[List["FilterExpression"]] = None):
        self.rules = rules or []
        self.operator = LogicalOperator(operator)
        self.sub_expressions = sub_expressions or []
    
    def add_rule(self, field: str, operator: FilterOperator, value: Any = None) -> "FilterExpression":
        """Add a rule to this expression."""
        self.rules.append(FilterRule(field, operator, value))
        return self
    
    def add_expression(self, expression: "FilterExpression") -> "FilterExpression":
        """Add a sub-expression to this expression."""
        self.sub_expressions.append(expression)
        return self
    
    def evaluate(self, data: Dict[str, Any]) -> bool:
        """Evaluate this expression against data."""
        # Evaluate all rules
        rule_results = [rule.evaluate(data) for rule in self.rules]
        
        # Evaluate all sub-expressions
        expr_results = [expr.evaluate(data) for expr in self.sub_expressions]
        
        # Combine all results
        all_results = rule_results + expr_results
        
        if not all_results:
            return True  # Empty expression matches everything
        
        if self.operator == LogicalOperator.AND:
            return all(all_results)
        elif self.operator == LogicalOperator.OR:
            return any(all_results)
        elif self.operator == LogicalOperator.NOT:
            # NOT applies to the combined result
            if self.operator == LogicalOperator.AND:
                return not all(all_results)
            else:
                return not any(all_results)
        
        return False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert expression to dictionary representation."""
        return {
            "operator": self.operator.value,
            "rules": [rule.to_dict() for rule in self.rules],
            "sub_expressions": [expr.to_dict() for expr in self.sub_expressions]
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FilterExpression":
        """Create expression from dictionary representation."""
        rules = [FilterRule.from_dict(rule_data) for rule_data in data.get("rules", [])]
        sub_expressions = [cls.from_dict(expr_data) for expr_data in data.get("sub_expressions", [])]
        
        return cls(
            rules=rules,
            operator=data.get("operator", LogicalOperator.AND),
            sub_expressions=sub_expressions
        )

class FilterFactory:
    """Factory for creating common filter patterns."""
    
    @staticmethod
    def create_threshold_filter(field: str, threshold: float, operator: FilterOperator = FilterOperator.GE) -> FilterExpression:
        """Create a simple threshold filter."""
        return FilterExpression().add_rule(field, operator, threshold)
    
    @staticmethod
    def create_range_filter(field: str, min_value: Any, max_value: Any) -> FilterExpression:
        """Create a range filter (min <= field <= max)."""
        return FilterExpression(operator=LogicalOperator.AND).add_rule(
            field, FilterOperator.GE, min_value
        ).add_rule(
            field, FilterOperator.LE, max_value
        )
    
    @staticmethod
    def create_keyword_filter(field: str, keywords: List[str], match_any: bool = True) -> FilterExpression:
        """Create a keyword matching filter."""
        operator = LogicalOperator.OR if match_any else LogicalOperator.AND
        expression = FilterExpression(operator=operator)
        
        for keyword in keywords:
            expression.add_rule(field, FilterOperator.CONTAINS, keyword)
        
        return expression
    
    @staticmethod
    def create_whitelist_filter(field: str, allowed_values: List[Any]) -> FilterExpression:
        """Create a whitelist filter."""
        return FilterExpression().add_rule(field, FilterOperator.IN, allowed_values)
    
    @staticmethod
    def create_blacklist_filter(field: str, blocked_values: List[Any]) -> FilterExpression:
        """Create a blacklist filter."""
        return FilterExpression().add_rule(field, FilterOperator.NOT_IN, blocked_values)

class FilterService:
    """Service for managing and applying filters across the system."""
    
    def __init__(self):
        self._saved_filters: Dict[str, FilterExpression] = {}
    
    def save_filter(self, name: str, filter_expression: FilterExpression):
        """Save a filter expression for reuse."""
        self._saved_filters[name] = filter_expression
        logger.info(f"Saved filter '{name}'")
    
    def get_filter(self, name: str) -> Optional[FilterExpression]:
        """Get a saved filter by name."""
        return self._saved_filters.get(name)
    
    def list_filters(self) -> List[str]:
        """List all saved filter names."""
        return list(self._saved_filters.keys())
    
    def apply_filter(self, filter_expression: FilterExpression, data_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Apply a filter expression to a list of data items."""
        return [item for item in data_items if filter_expression.evaluate(item)]
    
    def create_from_config(self, config: Dict[str, Any]) -> FilterExpression:
        """Create a filter expression from configuration dictionary."""
        if "expression" in config:
            return FilterExpression.from_dict(config["expression"])
        
        # Legacy format support - convert simple rules to expression
        if "rules" in config:
            rules = []
            for rule_config in config["rules"]:
                rules.append(FilterRule.from_dict(rule_config))
            
            operator = LogicalOperator(config.get("operator", LogicalOperator.AND))
            return FilterExpression(rules=rules, operator=operator)
        
        raise ValueError("Invalid filter configuration format")

# Global filter service instance
filter_service = FilterService()

# Pre-built common filters
filter_service.save_filter(
    "high_priority", 
    FilterFactory.create_threshold_filter("priority_score", 7.0)
)

filter_service.save_filter(
    "threat_indicators",
    FilterFactory.create_keyword_filter("content", ["threat", "attack", "breach", "vulnerability"])
)

filter_service.save_filter(
    "english_content",
    FilterFactory.create_whitelist_filter("language", ["en", "en-US", "en-GB"])
) 