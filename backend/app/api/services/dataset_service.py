# backend/app/api/services/dataset.py
import logging
from typing import List, Optional, Tuple, Dict, Any
from sqlmodel import Session, select, func
from datetime import datetime, timezone

# Import base service types
from app.api.services.service_utils import validate_infospace_access
from app.api.providers.base import StorageProvider

from app.models import Dataset, Asset, AnnotationRun, Annotation, ResultStatus, User
from app.schemas import DatasetCreate, DatasetUpdate

logger = logging.getLogger(__name__)

# ───────────────────────────────────────────────────────────── Dataset ──── #

class DatasetService:
    """Service for handling datasets."""

    def __init__(
        self,
        session: Session,
        storage_provider: StorageProvider,
        source_instance_id: Optional[str] = None
    ):
        """Initialize the service with required dependencies."""
        self.session = session
        self.storage_provider = storage_provider
        self.source_instance_id = source_instance_id
    
    def create_dataset(
        self,
        user_id: int,
        infospace_id: int,
        dataset_in: DatasetCreate
    ) -> Dataset:
        """
        Create a new dataset.
        
        Args:
            user_id: ID of the user creating the dataset
            infospace_id: ID of the infospace
            dataset_in: Dataset creation data
            
        Returns:
            The created dataset
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Creating dataset '{dataset_in.name}' in infospace {infospace_id} by user {user_id}")
        
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Validate assets exist and belong to infospace
        if dataset_in.asset_ids:
            for asset_id in dataset_in.asset_ids:
                asset = self.session.get(Asset, asset_id)
                if not asset or asset.infospace_id != infospace_id:
                    raise ValueError(f"Asset ID {asset_id} not found or does not belong to infospace {infospace_id}.")
        
        db_dataset = Dataset.model_validate(dataset_in)
        db_dataset.infospace_id = infospace_id
        db_dataset.user_id = user_id
        
        self.session.add(db_dataset)
        self.session.commit()
        self.session.refresh(db_dataset)
        logger.info(f"Service: Dataset '{db_dataset.name}' (ID: {db_dataset.id}) created.")
        return db_dataset
    
    def get_dataset(
        self,
        dataset_id: int,
        user_id: int,
        infospace_id: int
    ) -> Optional[Dataset]:
        """
        Get a dataset.
        
        Args:
            dataset_id: ID of the dataset
            user_id: ID of the user
            infospace_id: ID of the infospace
            
        Returns:
            The dataset if found and accessible
            
        Raises:
            ValueError: If validation fails
        """
        logger.debug(f"Service: Getting dataset {dataset_id} for infospace {infospace_id}, user {user_id}")
        validate_infospace_access(self.session, infospace_id, user_id)
        
        dataset = self.session.get(Dataset, dataset_id)
        if dataset and dataset.infospace_id == infospace_id and dataset.user_id == user_id:
            return dataset
        if dataset:
            logger.warning(f"Service: Dataset {dataset_id} found but infospace_id or user_id mismatch.")
        return None
    
    def list_datasets(
        self,
        user_id: int,
        infospace_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> Tuple[List[Dataset], int]:
        """
        List datasets in an infospace.
        
        Args:
            user_id: ID of the user
            infospace_id: ID of the infospace
            skip: Number of records to skip
            limit: Maximum number of records to return
            
        Returns:
            Tuple of (datasets, total_count)
            
        Raises:
            ValueError: If validation fails
        """
        logger.debug(f"Service: Listing datasets for infospace {infospace_id}, user {user_id}")
        
        validate_infospace_access(self.session, infospace_id, user_id)
        
        query = (
            select(Dataset)
            .where(Dataset.infospace_id == infospace_id, Dataset.user_id == user_id)
            .offset(skip)
            .limit(limit)
            .order_by(Dataset.name)
        )
        
        datasets = list(self.session.exec(query).all())
        
        count_query = (
            select(func.count(Dataset.id))
            .where(Dataset.infospace_id == infospace_id, Dataset.user_id == user_id)
        )
        total_count = self.session.exec(count_query).one_or_none() or 0
        
        return datasets, total_count
    
    def update_dataset(
        self,
        dataset_id: int,
        user_id: int,
        infospace_id: int,
        dataset_in: DatasetUpdate
    ) -> Optional[Dataset]:
        """
        Update a dataset.
        
        Args:
            dataset_id: ID of the dataset to update
            user_id: ID of the user updating the dataset
            infospace_id: ID of the infospace
            dataset_in: Dataset update data
            
        Returns:
            The updated dataset
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Updating dataset {dataset_id} in infospace {infospace_id} by user {user_id}")
        
        db_dataset = self.get_dataset(dataset_id, user_id, infospace_id)
        if not db_dataset:
            return None
        
        # Validate new assets if provided
        if dataset_in.asset_ids is not None:
            for asset_id in dataset_in.asset_ids:
                asset = self.session.get(Asset, asset_id)
                if not asset or asset.infospace_id != infospace_id:
                    raise ValueError(f"Asset ID {asset_id} not found or does not belong to infospace {infospace_id}.")
        
        update_data = dataset_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_dataset, key, value)
        db_dataset.updated_at = datetime.now(timezone.utc)
        
        self.session.add(db_dataset)
        self.session.commit()
        self.session.refresh(db_dataset)
        logger.info(f"Service: Dataset {dataset_id} updated.")
        return db_dataset
    
    def delete_dataset(
        self,
        dataset_id: int,
        user_id: int,
        infospace_id: int
    ) -> bool:
        """
        Delete a dataset.
        
        Args:
            dataset_id: ID of the dataset to delete
            user_id: ID of the user deleting the dataset
            infospace_id: ID of the infospace
            
        Returns:
            True if successful
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Deleting dataset {dataset_id} from infospace {infospace_id} by user {user_id}")
        
        db_dataset = self.get_dataset(dataset_id, user_id, infospace_id)
        if not db_dataset:
            return False
        
        self.session.delete(db_dataset)
        self.session.commit()
        logger.info(f"Service: Dataset {dataset_id} deleted.")
        return True
    
    def create_dataset_from_run(
        self,
        run_id: int,
        user_id: int,
        infospace_id: int,
        dataset_name: Optional[str] = None,
        dataset_description: Optional[str] = None,
    ) -> Dataset:
        """
        Create a dataset from an annotation run.
        
        Args:
            run_id: ID of the annotation run
            user_id: ID of the user creating the dataset
            infospace_id: ID of the infospace
            dataset_name: Optional name for the dataset
            dataset_description: Optional description for the dataset
            
        Returns:
            The created dataset
            
        Raises:
            ValueError: If validation fails
        """
        logger.info(f"Service: Creating dataset from annotation run {run_id} for user {user_id}")
        
        validate_infospace_access(self.session, infospace_id, user_id)
        
        run = self.session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != infospace_id:
            raise ValueError(f"Annotation run {run_id} not found or does not belong to infospace {infospace_id}.")
        if run.user_id != user_id:
            pass

        annotations = self.session.exec(
            select(Annotation)
            .where(
                Annotation.run_id == run_id,
                Annotation.status == ResultStatus.SUCCESS
            )
        ).all()
        
        if not annotations:
            raise ValueError(f"No successful annotations found in run {run_id} to create dataset from.")
        
        asset_ids = sorted(list(set(a.asset_id for a in annotations)))
        
        final_dataset_name = dataset_name or f"Dataset from Run {run.name} ({run.id})"
        final_dataset_description = dataset_description or f"Assets from successful annotations in Run: {run.name} (ID: {run.id}) - created {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"

        dataset_create_obj = DatasetCreate(
            name=final_dataset_name,
            description=final_dataset_description,
            asset_ids=asset_ids
        )
        
        return self.create_dataset(user_id=user_id, infospace_id=infospace_id, dataset_in=dataset_create_obj)

# Removed dummy factory function

# Factory function REMOVED - Now in deps.py
# def get_dataset_service() -> DatasetService:
#     """Returns an instance of the DatasetService with dependencies injected via Depends()."""
#     # The constructor will get dependencies via Depends() from FastAPI
#     return DatasetService() 