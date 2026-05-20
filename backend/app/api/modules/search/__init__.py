"""Search domain: ``web`` (external) + ``assets`` (internal) + ``SearchHistory``.

Public surface:
* ``app.api.modules.search.web``    — web-search composition
* ``app.api.modules.search.assets`` — asset-search composition (over AssetQuery)
* ``SearchHistory`` model (re-exported below)
"""

from app.api.modules.search.models import SearchHistory

__all__ = [
    "SearchHistory",
]
