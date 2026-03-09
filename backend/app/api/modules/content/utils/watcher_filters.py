"""
Shared filter clauses for reactive watchers.

Used to exclude superseded assets and children of superseded parents
from all content and annotation watchers.

Uses denormalized parent_is_superseded for O(1) indexed filter (no correlated subquery).
"""

from app.api.modules.content.models import Asset


def non_superseded_filter(asset_col=None):
    """
    SQL clauses to exclude superseded assets and children of superseded parents.

    Args:
        asset_col: The Asset table/alias to use. Defaults to Asset.

    Returns:
        List of SQLAlchemy expressions to add to .where().
    """
    if asset_col is None:
        asset_col = Asset
    return [
        asset_col.is_superseded == False,
        asset_col.parent_is_superseded == False,
    ]
