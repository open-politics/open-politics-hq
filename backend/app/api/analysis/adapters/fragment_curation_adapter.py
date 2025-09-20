
import logging
from typing import Any, Dict

from sqlmodel import Session, select

from app.api.analysis.protocols import AnalysisAdapterProtocol
from app.api.v1.endpoints.asset.utils import get_asset_by_id
from app.models import Asset

logger = logging.getLogger(__name__)


class FragmentCurationAdapter(AnalysisAdapterProtocol):
    """
    Manually promotes a specific piece of data to an Asset's permanent metadata.

    This adapter is designed for a manual, human-in-the-loop workflow where an
    analyst selects a valuable insight from a raw annotation and promotes it
    to a permanent, queryable "fragment" on the asset's record.
    """

    def __init__(self, session: Session, config: Dict[str, Any], **kwargs):
        """
        Initializes the adapter.

        Args:
            session: The database session.
            config: The adapter's configuration, which is not used in this adapter
                    as configuration is provided at execution time.
        """
        self.session = session
        self.config = config

    def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Executes the fragment promotion.

        This method writes a new fragment to the `metadata.fragments` field
        of a target asset. It creates the `fragments` key if it doesn't exist.

        Args:
            config: A dictionary containing the execution parameters:
                - target_asset_id (int): The ID of the asset to update.
                - fragment_key (str): The name for the intelligence fragment
                  (e.g., "Key People", "OSINT Relevance").
                - fragment_value (Any): The data to be promoted.
                - source_ref (str): A reference to the origin of the data
                  (e.g., "annotation/123", "user/jane.doe").
                - curated_by_ref (str, optional): A reference to the user or
                  process that curated the fragment. Defaults to None.

        Returns:
            A dictionary confirming the asset ID and the key of the fragment
            that was created or updated.
        """
        target_asset_id = config["target_asset_id"]
        fragment_key = config["fragment_key"]
        fragment_value = config["fragment_value"]
        source_ref = config["source_ref"]
        curated_by_ref = config.get("curated_by_ref")

        logger.info(
            f"Executing fragment promotion for asset {target_asset_id} "
            f"with key '{fragment_key}'."
        )

        asset = get_asset_by_id(self.session, target_asset_id)

        # Ensure metadata is a dictionary
        if asset.metadata is None:
            asset.metadata = {}

        # Initialize the 'fragments' namespace if it doesn't exist
        if "fragments" not in asset.metadata:
            asset.metadata["fragments"] = {}

        # Create or update the fragment record
        fragment_record = {
            "value": fragment_value,
            "source_ref": source_ref,
            "timestamp": self.session.exec(
                select(Asset.updated_at).where(Asset.id == target_asset_id)
            )
            .one()
            .isoformat(),
        }
        if curated_by_ref:
            fragment_record["curated_by_ref"] = curated_by_ref

        asset.metadata["fragments"][fragment_key] = fragment_record

        # Mark the metadata as modified to ensure SQLAlchemy detects the change
        from sqlalchemy.orm.attributes import flag_modified

        flag_modified(asset, "metadata")

        self.session.add(asset)
        self.session.commit()
        self.session.refresh(asset)

        logger.info(
            f"Successfully promoted fragment '{fragment_key}' for asset {target_asset_id}."
        )

        return {
            "asset_id": target_asset_id,
            "promoted_fragment_key": fragment_key,
            "final_fragments": asset.metadata.get("fragments"),
        } 