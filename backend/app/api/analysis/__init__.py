"""Analysis domain: pluggable adapters for Flow ANALYZE step. Use analysis.services for AnalysisService."""

from app.api.analysis.models import AnalysisAdapter
from app.api.analysis.protocols import AnalysisAdapterProtocol

__all__ = ["AnalysisAdapter", "AnalysisAdapterProtocol"]
