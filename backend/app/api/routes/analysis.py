import logging
import importlib
import asyncio # Added for checking async functions
from typing import Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, Body, Path
from sqlmodel import Session, select # Added select
from pydantic import BaseModel
from typing import Optional

from app.models import AnalysisAdapter, Annotation # Ensure this is correctly imported
from app.api.deps import SessionDep, CurrentUser, AnalysisServiceDep # Ensure these are correctly imported
from app.schemas import AnalysisAdapterRead, AnnotationRead # We'll need a Pydantic model for the response

logger = logging.getLogger(__name__)
router = APIRouter()

class PromoteFragmentRequest(BaseModel):
    fragment_key: str
    fragment_value: Any
    source_run_id: Optional[int] = None  # Original annotation run ID for proper source tracking

@router.post("/infospaces/{infospace_id}/assets/{asset_id}/fragments", response_model=AnnotationRead, tags=["Analysis Service"])
async def promote_fragment(
    *,
    infospace_id: int,
    asset_id: int,
    request: PromoteFragmentRequest,
    analysis_service: AnalysisServiceDep,
    current_user: CurrentUser
):
    """
    Promote a fragment of information to a permanent feature of an asset.
    This creates an auditable annotation and adds the fragment to the asset's metadata.
    """
    annotation = await analysis_service.promote_fragment(
        infospace_id=infospace_id,
        asset_id=asset_id,
        fragment_key=request.fragment_key,
        fragment_value=request.fragment_value,
        source_run_id=request.source_run_id
    )
    return annotation

@router.get("/analysis/adapters", response_model=List[AnalysisAdapterRead], tags=["Analysis Adapters"])
async def list_analysis_adapters(
    session: SessionDep,
    current_user: CurrentUser
):
    """
    List all active and available analysis adapters.
    """
    adapters = session.exec(select(AnalysisAdapter).where(AnalysisAdapter.is_active == True)).all()
    return adapters

@router.post("/analysis/adapters/{adapter_name}/execute", tags=["Analysis Adapters"])
async def execute_analysis_adapter(
    *,
    session: SessionDep,
    current_user: CurrentUser, # For authorization if needed / logging
    adapter_name: str = Path(..., description="The registered name of the adapter"),
    config: Dict[str, Any] = Body(...) # Configuration specific to the adapter
) -> Dict[str, Any]:
    logger.info(f"Executing adapter: {adapter_name} with config: {config} for user {current_user.id if current_user else 'anonymous'}")

    # 1. Fetch adapter details from DB
    adapter_record = session.exec(
        select(AnalysisAdapter).where(AnalysisAdapter.name == adapter_name, AnalysisAdapter.is_active == True)
    ).first()

    if not adapter_record:
        raise HTTPException(status_code=404, detail=f"Adapter '{adapter_name}' not found or not active.")
    
    if not adapter_record.module_path:
        raise HTTPException(status_code=500, detail=f"Adapter '{adapter_name}' is not configured with a module path.")

    # TODO: Validate 'config' against adapter_record.input_schema_definition (use jsonschema library or Pydantic model dynamically created from schema)
    # For now, we assume the config is valid as per the adapter's expectation.

    try:
        # 2. Dynamically import the adapter module and class
        module_name, class_name = adapter_record.module_path.rsplit('.', 1)
        adapter_module = importlib.import_module(module_name)
        AdapterClass = getattr(adapter_module, class_name)

        # 3. Instantiate and execute
        # Pass current_user if the adapter needs it for its operations (e.g. further permission checks)
        # Some adapters might not need it, so it's optional in their constructor.
        # For simplicity, let's assume the adapter constructor takes session and config.
        # If user context is needed within adapter, it can be passed in config or as separate param.
        adapter_instance = AdapterClass(
            session=session, 
            config=config,
            current_user=current_user,
            infospace_id=config.get("infospace_id") # Assuming infospace_id is passed in the config
        )
        
        # Check if execute is an async method
        if asyncio.iscoroutinefunction(adapter_instance.execute):
            result = await adapter_instance.execute()
        else:
            # If it's a synchronous method, consider running in a thread pool for non-blocking IO
            # For now, direct call for simplicity assuming DB operations are handled by FastAPI's async nature or are quick.
            # loop = asyncio.get_event_loop()
            # result = await loop.run_in_executor(None, adapter_instance.execute)
            result = adapter_instance.execute() 
            
        return result
        
    except ModuleNotFoundError:
        logger.error(f"Adapter module not found: {module_name} for adapter {adapter_name}")
        raise HTTPException(status_code=500, detail=f"Adapter '{adapter_name}' module could not be loaded.")
    except AttributeError:
        logger.error(f"Adapter class not found: {class_name} in module {module_name} for adapter {adapter_name}")
        raise HTTPException(status_code=500, detail=f"Adapter '{adapter_name}' class could not be loaded.")
    except ValueError as ve: # Catch config validation errors from adapter
         logger.error(f"Configuration error for adapter {adapter_name}: {ve}")
         raise HTTPException(status_code=400, detail=str(ve))
    except NotImplementedError as nie: # Catch if adapter features (like bundle input) aren't ready
        logger.error(f"Feature not implemented in adapter {adapter_name}: {nie}")
        raise HTTPException(status_code=501, detail=str(nie))
    except Exception as e:
        logger.exception(f"Error executing adapter '{adapter_name}': {e}")
        raise HTTPException(status_code=500, detail=f"Error executing adapter: {str(e)}")

# Placeholder for future CRUD operations on AnalysisAdapter records
# @router.post("/adapters", response_model=AnalysisAdapter, status_code=status.HTTP_201_CREATED)
# async def create_adapter_registration(
#     *, 
#     session: SessionDep, 
#     current_user: CurrentUser, # Typically admin/superuser
#     adapter_in: AnalysisAdapterCreate # Need an AnalysisAdapterCreate Pydantic model
# ):
#     # Logic to create an AnalysisAdapter record in the DB
#     # Ensure current_user has permissions
#     pass

# @router.get("/adapters", response_model=List[AnalysisAdapter])
# async def list_adapter_registrations(session: SessionDep, current_user: CurrentUser):
#     # Logic to list all active AnalysisAdapter records
#     pass 