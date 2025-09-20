import logging
from typing import Optional, List, Dict, Any, Type, Coroutine
import importlib
import asyncio

from sqlmodel import Session, select
from fastapi import HTTPException

from app.models import AnalysisAdapter, User, Annotation, Asset # Add other models as needed
from app.core.config import AppSettings

# Import specific service dependencies this service might orchestrate or use

from .annotation_service import AnnotationService 
from .asset_service import AssetService
from app.api.providers.model_registry import ModelRegistryService
from app.api.analysis.protocols import AnalysisAdapterProtocol # Import the protocol

logger = logging.getLogger(__name__)

class AnalysisService:
    def __init__(self, session: Session, 
                 model_registry: ModelRegistryService,
                 annotation_service: AnnotationService,
                 asset_service: AssetService,
                 current_user: Optional[User] = None, # Passed from deps if route requires auth
                 settings: Optional[AppSettings] = None # Passed from deps
               ):
        self.session = session
        self.model_registry = model_registry
        self.annotation_service = annotation_service
        self.asset_service = asset_service
        self.current_user = current_user
        self.settings = settings
        logger.info("AnalysisService initialized.")

    async def execute_adapter(
        self,
        adapter_name: str,
        config: Dict[str, Any],
        infospace_id: int # For context and adapter potentially needing it
    ) -> Dict[str, Any]:
        """
        Loads and executes a registered Analysis Adapter.
        The current_user and infospace_id from the route context can be passed 
        into the adapter's constructor if the adapter needs them.
        """
        logger.info(f"AnalysisService: Executing adapter '{adapter_name}' with config {config} for infospace {infospace_id}")

        adapter_record = self.session.exec(
            select(AnalysisAdapter).where(AnalysisAdapter.name == adapter_name, AnalysisAdapter.is_active == True)
        ).first()

        if not adapter_record:
            raise HTTPException(status_code=404, detail=f"Adapter '{adapter_name}' not found or not active.")
        
        if not adapter_record.module_path:
            raise HTTPException(status_code=500, detail=f"Adapter '{adapter_name}' is not configured with a module path.")

        # TODO: Implement robust validation of 'config' against adapter_record.input_schema_definition
        # using jsonschema or by dynamically creating a Pydantic model from the schema for validation.
        # Example (conceptual - jsonschema library needed):
        # from jsonschema import validate, exceptions
        # try:
        #     validate(instance=config, schema=adapter_record.input_schema_definition)
        # except exceptions.ValidationError as e_val:
        #     raise HTTPException(status_code=400, detail=f"Invalid configuration for adapter '{adapter_name}': {e_val.message}")

        try:
            module_name, class_name = adapter_record.module_path.rsplit('.', 1)
            adapter_module = importlib.import_module(module_name)
            AdapterClass = getattr(adapter_module, class_name)
            
            # Instantiate adapter, passing context
            # The adapter __init__ must match AnalysisAdapterProtocol
            adapter_instance: AnalysisAdapterProtocol = AdapterClass(
                session=self.session, 
                config=config,
                current_user=self.current_user, # Pass user from service context
                infospace_id=infospace_id # Pass infospace_id from route context
            )
            
            result: Dict[str, Any]
            if asyncio.iscoroutinefunction(adapter_instance.execute):
                result = await adapter_instance.execute()
            else:
                # For synchronous execute methods, run in a thread pool to avoid blocking FastAPI event loop
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, adapter_instance.execute) 
            
            # TODO: Optionally validate result against adapter_record.output_schema_definition
            return result
            
        except ModuleNotFoundError:
            logger.error(f"Adapter module not found: {module_name} for adapter {adapter_name}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Adapter '{adapter_name}' module could not be loaded.")
        except AttributeError:
            logger.error(f"Adapter class '{class_name}' not found in module '{module_name}' for adapter {adapter_name}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Adapter '{adapter_name}' class could not be loaded.")
        except ValueError as ve: 
             logger.error(f"Configuration or data error for adapter {adapter_name}: {ve}", exc_info=True)
             raise HTTPException(status_code=400, detail=str(ve))
        except NotImplementedError as nie:
            logger.error(f"Feature not implemented in adapter {adapter_name}: {nie}", exc_info=True)
            raise HTTPException(status_code=501, detail=str(nie))
        except Exception as e:
            logger.exception(f"Error executing adapter '{adapter_name}': {e}")
            raise HTTPException(status_code=500, detail=f"Error executing adapter '{adapter_name}': {str(e)}")

    # --- Methods for managing AnalysisAdapter registrations (CRUD) --- 
    # These would typically be admin-level operations.
    def create_adapter_registration(
        self, 
        adapter_data: Dict[str, Any], # Should be an AnalysisAdapterCreate Pydantic model
        # user: User # For permission check
    ) -> AnalysisAdapter:
        # if not user.is_superuser: raise HTTPException(status_code=403, detail="Not authorized")
        # db_adapter = AnalysisAdapter.model_validate(adapter_data)
        # self.session.add(db_adapter)
        # self.session.commit()
        # self.session.refresh(db_adapter)
        # return db_adapter
        raise NotImplementedError("Adapter registration CRUD not fully implemented.")

    def list_adapter_registrations(self, active_only: bool = True) -> List[AnalysisAdapter]:
        # query = select(AnalysisAdapter)
        # if active_only: query = query.where(AnalysisAdapter.is_active == True)
        # return self.session.exec(query).all()
        raise NotImplementedError("Adapter registration CRUD not fully implemented.")
    
    # Get, Update, Delete methods for adapter registrations would follow. 