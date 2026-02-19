"""Analysis domain: pluggable adapters for Flow ANALYZE step. Use analysis.services for AnalysisService."""

from app.api.modules.analysis.models import AnalysisAdapter
from app.api.modules.analysis.protocols import AnalysisAdapterProtocol

__all__ = ["AnalysisAdapter", "AnalysisAdapterProtocol"]
