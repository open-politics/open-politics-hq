"""
Shared filter clauses for reactive watchers.

Used to exclude superseded assets and children of superseded parents
from all content and annotation watchers.
"""

from sqlalchemy.sql import exists

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
    superseded_parent = exists().where(
        Asset.id == asset_col.parent_asset_id,
        Asset.is_superseded == True,
    )
    return [
        asset_col.is_superseded == False,
        ~superseded_parent,
    ]
