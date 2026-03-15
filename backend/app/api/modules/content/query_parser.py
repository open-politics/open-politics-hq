"""
Query parser for the asset query language.

Parses a query string into a structured ParsedQuery that compiles to AssetQuery.
Pure Python, no DB, fully testable.

Syntax:
    corruption                              # FTS (unquoted words, AND'd)
    "Deutsche Bank"                         # FTS phrase (adjacent words)
    -sports                                 # FTS negation (websearch_to_tsquery handles natively)
    ~corruption                             # semantic similarity (asset embeddings)
    ~corruption>0.7                         # semantic with similarity threshold
    kind:pdf                                # asset kind filter
    kind:pdf,email                          # kind OR
    -kind:image                             # exclude kind
    after:2019-01                           # date range (event_timestamp -> created_at)
    before:2022-12
    bundle:"leaked docs"                    # bundle scope (name or ID)
    entity:"Angela Merkel"                  # exact entity (graph -> text fallback)
    entity:"A","B"                          # entity OR (either entity)
    entity:~politician                      # semantic entity (entity embeddings)
    entity:~politician>0.7                  # semantic entity with threshold
    -entity:"name"                          # exclude entity
    annotation:sentiment>=0.8              # annotation field filter
    annotation:category=="financial"       # annotation exact match
    annotation:doc.topics.0=="climate"     # nested JSONB path
    run:42                                  # scope annotation queries to run

Composition: space = AND, comma = OR within filter, - = NOT, ~ = semantic.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class AnnotationFilter:
    field: str
    op: str  # ==, !=, >=, >, <=, <
    value: str
    negated: bool = False


@dataclass
class SemanticClause:
    text: str
    threshold: float | None = None
    threshold_op: str | None = None  # >, >=, <, <=


@dataclass
class ParsedQuery:
    # Free text — passed directly to websearch_to_tsquery (handles quotes, -, or)
    text: str = ""
    # Semantic search on asset embeddings
    semantic: SemanticClause | None = None
    # Filters
    kinds: list[str] = field(default_factory=list)
    excluded_kinds: list[str] = field(default_factory=list)
    date_after: str | None = None
    date_before: str | None = None
    bundle_ref: str | None = None
    # Entities — inner list = OR, outer list = AND
    entities: list[list[str]] = field(default_factory=list)
    entity_negations: list[str] = field(default_factory=list)
    entity_semantic: SemanticClause | None = None
    # Annotations
    annotations: list[AnnotationFilter] = field(default_factory=list)
    run_ids: list[int] = field(default_factory=list)

    @property
    def has_text(self) -> bool:
        return bool(self.text.strip())

    @property
    def has_semantic(self) -> bool:
        return self.semantic is not None or self.entity_semantic is not None

    @property
    def has_filters(self) -> bool:
        return bool(
            self.kinds or self.excluded_kinds or self.date_after or self.date_before
            or self.bundle_ref or self.entities or self.entity_negations
            or self.entity_semantic or self.annotations or self.run_ids
        )

    @property
    def is_empty(self) -> bool:
        return not self.has_text and not self.has_semantic and not self.has_filters

    def to_dict(self) -> dict:
        """Parsed structure for frontend pill rendering."""
        d: dict = {}
        if self.text:
            d["text"] = self.text
        if self.semantic:
            d["semantic"] = _semantic_dict(self.semantic)
        if self.kinds:
            d["kinds"] = self.kinds
        if self.excluded_kinds:
            d["excluded_kinds"] = self.excluded_kinds
        if self.date_after:
            d["date_after"] = self.date_after
        if self.date_before:
            d["date_before"] = self.date_before
        if self.bundle_ref:
            d["bundle_ref"] = self.bundle_ref
        if self.entities:
            d["entities"] = self.entities
        if self.entity_negations:
            d["entity_negations"] = self.entity_negations
        if self.entity_semantic:
            d["entity_semantic"] = _semantic_dict(self.entity_semantic)
        if self.annotations:
            d["annotations"] = [
                {"field": a.field, "op": a.op, "value": a.value, **({"negated": True} if a.negated else {})}
                for a in self.annotations
            ]
        if self.run_ids:
            d["run_ids"] = self.run_ids
        return d


def _semantic_dict(s: SemanticClause) -> dict:
    d: dict = {"text": s.text}
    if s.threshold is not None:
        d["threshold"] = s.threshold
    if s.threshold_op:
        d["op"] = s.threshold_op
    return d


# ─── Tokenizer ───

def _tokenize(raw: str) -> list[str]:
    """Split query string into tokens, respecting quoted strings."""
    tokens: list[str] = []
    current: list[str] = []
    in_quotes = False
    for ch in raw:
        if ch == '"':
            in_quotes = not in_quotes
            current.append(ch)
        elif ch == ' ' and not in_quotes:
            if current:
                tokens.append(''.join(current))
                current = []
        else:
            current.append(ch)
    if current:
        tokens.append(''.join(current))
    return tokens


# ─── Value helpers ───

_THRESHOLD_RE = re.compile(r'([><]=?)([\d.]+)$')
_ANNOTATION_OP_RE = re.compile(r'^([a-zA-Z0-9_.]+)(==|!=|>=|>|<=|<)(.+)$')
_PREFIX_RE = re.compile(r'^(-)?([a-z]+):(.+)$', re.DOTALL)

_KNOWN_PREFIXES = frozenset({"kind", "after", "before", "bundle", "run", "entity", "annotation"})


def _strip_quotes(s: str) -> str:
    if len(s) >= 2 and s.startswith('"') and s.endswith('"'):
        return s[1:-1]
    return s


def _parse_comma_values(s: str) -> list[str]:
    """Parse comma-separated values, respecting quotes."""
    parts: list[str] = []
    current: list[str] = []
    in_q = False
    for ch in s:
        if ch == '"':
            in_q = not in_q
        elif ch == ',' and not in_q:
            parts.append(_strip_quotes(''.join(current).strip()))
            current = []
            continue
        current.append(ch)
    if current:
        parts.append(_strip_quotes(''.join(current).strip()))
    return [p for p in parts if p]


def _parse_semantic(raw: str) -> SemanticClause:
    """Parse semantic value: 'query', 'query>0.7', '"phrase">0.5'."""
    m = _THRESHOLD_RE.search(raw)
    if m:
        query = _strip_quotes(raw[:m.start()])
        return SemanticClause(text=query, threshold_op=m.group(1), threshold=float(m.group(2)))
    return SemanticClause(text=_strip_quotes(raw))


# ─── Main parser ───

def parse(raw: str) -> ParsedQuery:
    """Parse a query string into structured filters."""
    q = ParsedQuery()
    if not raw or not raw.strip():
        return q

    tokens = _tokenize(raw.strip())
    text_parts: list[str] = []

    for token in tokens:
        # Try prefix match: [-]prefix:value
        prefix_match = _PREFIX_RE.match(token)

        if prefix_match and prefix_match.group(2) in _KNOWN_PREFIXES:
            negated = prefix_match.group(1) == '-'
            prefix = prefix_match.group(2)
            rest = prefix_match.group(3)

            if prefix == 'kind':
                values = _parse_comma_values(rest)
                if negated:
                    q.excluded_kinds.extend(values)
                else:
                    q.kinds.extend(values)

            elif prefix == 'after':
                q.date_after = _strip_quotes(rest)

            elif prefix == 'before':
                q.date_before = _strip_quotes(rest)

            elif prefix == 'bundle':
                q.bundle_ref = _strip_quotes(rest)

            elif prefix == 'run':
                try:
                    q.run_ids.append(int(_strip_quotes(rest)))
                except ValueError:
                    pass

            elif prefix == 'entity':
                if rest.startswith('~'):
                    q.entity_semantic = _parse_semantic(rest[1:])
                else:
                    values = _parse_comma_values(rest)
                    if negated:
                        q.entity_negations.extend(values)
                    else:
                        q.entities.append(values)

            elif prefix == 'annotation':
                ann_match = _ANNOTATION_OP_RE.match(rest)
                if ann_match:
                    q.annotations.append(AnnotationFilter(
                        field=ann_match.group(1),
                        op=ann_match.group(2),
                        value=_strip_quotes(ann_match.group(3)),
                        negated=negated,
                    ))

            continue

        # No prefix — semantic (~) or free text
        if token.startswith('~'):
            q.semantic = _parse_semantic(token[1:])
        else:
            # Everything else is free text (websearch_to_tsquery handles quotes, -, or)
            text_parts.append(token)

    q.text = ' '.join(text_parts)
    return q
