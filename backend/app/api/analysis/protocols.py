from typing import Protocol, Any, Dict, Optional
from sqlmodel import Session
from app.models import User # Assuming User model is in app.models

class AnalysisAdapterProtocol(Protocol):
    """Protocol defining the interface for all analysis adapter classes."""

    def __init__(
        self, 
        session: Session, 
        config: Dict[str, Any], 
        current_user: Optional[User] = None, # Optional user context
        infospace_id: Optional[int] = None   # Optional infospace context for the adapter execution
    ):
        """
        Initialize the adapter with a database session, configuration, and optional user/infospace context.

        Args:
            session: The SQLAlchemy/SQLModel session.
            config: Adapter-specific configuration dictionary, validated against its input_schema_definition.
            current_user: The user initiating the analysis, if relevant for permissions or logging.
            infospace_id: The infospace ID in which the analysis is being performed, if relevant.
        """
        ...

    async def execute(self) -> Dict[str, Any]:
        """
        Execute the analysis logic.

        Returns:
            A dictionary containing the analysis results, conforming to the adapter's output_schema_definition.
        
        Raises:
            ValueError: If configuration is invalid or required data is missing.
            NotImplementedError: If a feature within the adapter is not yet implemented.
            Exception: For any other unrecoverable errors during execution.
        """
        ...

    # @classmethod
    # async def validate_config(
    #     cls, 
    #     config: Dict[str, Any], 
    #     input_schema: Dict[str, Any] # The adapter's registered input_schema_definition
    # ) -> bool:
    #     """
    #     Optional: Validate the provided configuration against the adapter's declared input schema.
    #     This could be called by the generic execution route before instantiating the adapter.
    #     Libraries like jsonschema can be used here.
        
    #     Args:
    #         config: The configuration dictionary to validate.
    #         input_schema: The JSONSchema definition for the adapter's input.
            
    #     Returns:
    #         True if the config is valid, False otherwise or raises ValueError.
    #     """
    #     ... 