"""
web_search/dialects — which wires exist.
========================================

  answer_engine   tavily    a ranked list plus a synthesized answer
  metasearch      searxng   a ranked list, nothing else
"""

from app.api.modules.foundation_service_providers.web_search.provider import WebSearch


WebSearch.dialect("answer_engine", module="answer_engine", adapter="AnswerEngineSearch")
WebSearch.dialect("metasearch", module="metasearch", adapter="MetasearchSearch")
