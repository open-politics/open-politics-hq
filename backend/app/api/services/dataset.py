# backend/app/api/services/dataset.py
import logging
from typing import List, Optional, Tuple, Dict, Any
from sqlmodel import Session, select, func
from fastapi import HTTPException, status
import json
import uuid
from datetime import datetime, timezone
import os

# Import base service types
from app.api.services.classification import ClassificationService
from app.api.services.ingestion import IngestionService
from app.api.services.service_utils import validate_workspace_access
from app.api.services.package import PackageBuilder, PackageImporter, DataPackage, PackageMetadata
from app.api.services.providers.base import StorageProvider

from app.models import Dataset, DatasetCreate, DatasetUpdate, User, Workspace
from app.models import DataRecord, ClassificationScheme, ClassificationJob, ClassificationResult, DataSource, ResourceType
from app.models import DataSourceType

logger = logging.getLogger(__name__)



class DatasetService:
    """Service layer for managing Dataset resources."""

    def __init__(
        self,
        session: Session, 
        classification_service: ClassificationService,
        ingestion_service: IngestionService,
        storage_provider: StorageProvider,
        source_instance_id: Optional[str] = None
    ):
        """Initialize with Session and dependent services via DI."""
        self.session = session
        self.classification_service = classification_service
        self.ingestion_service = ingestion_service
        self.storage_provider = storage_provider
        self.source_instance_id = source_instance_id
        logger.info("DatasetService initialized")

    def create_dataset(self, user_id: int, workspace_id: int, dataset_in: DatasetCreate) -> Dataset:
        """
        Create a new dataset.
        MODIFIES DATA - Commits transaction.
        """
        try:
            validate_workspace_access(self.session, workspace_id, user_id)

            # Validation for existence of IDs within the workspace
            if dataset_in.datarecord_ids:
                count_stmt = select(func.count(DataRecord.id)).join(DataSource).where(DataRecord.id.in_(dataset_in.datarecord_ids), DataSource.workspace_id == workspace_id)
                record_count = self.session.exec(count_stmt).one()
                if record_count != len(dataset_in.datarecord_ids):
                    raise ValueError("One or more provided DataRecord IDs not found in this workspace.")

            if dataset_in.source_job_ids:
                count_stmt = select(func.count(ClassificationJob.id)).where(ClassificationJob.id.in_(dataset_in.source_job_ids), ClassificationJob.workspace_id == workspace_id)
                job_count = self.session.exec(count_stmt).one()
                if job_count != len(dataset_in.source_job_ids):
                    raise ValueError("One or more provided ClassificationJob IDs not found in this workspace.")

            if dataset_in.source_scheme_ids:
                count_stmt = select(func.count(ClassificationScheme.id)).where(ClassificationScheme.id.in_(dataset_in.source_scheme_ids), ClassificationScheme.workspace_id == workspace_id)
                scheme_count = self.session.exec(count_stmt).one()
                if scheme_count != len(dataset_in.source_scheme_ids):
                    raise ValueError("One or more provided ClassificationScheme IDs not found in this workspace.")

            db_obj = Dataset.model_validate(dataset_in, update={
                "workspace_id": workspace_id,
                "user_id": user_id
            })
            self.session.add(db_obj)
            self.session.commit()
            self.session.refresh(db_obj)
            logger.info(f"Created dataset {db_obj.id} ('{db_obj.name}') in workspace {workspace_id}")
            return db_obj

        except Exception as e:
            self.session.rollback()
            logger.error(f"Failed to create dataset: {str(e)}", exc_info=True)
            raise ValueError(f"Failed to create dataset: {str(e)}")

    def get_dataset(self, user_id: int, workspace_id: Optional[int], dataset_id: int) -> Optional[Dataset]:
        """
        Get a dataset by ID.
        READ-ONLY - Does not commit.
        If workspace_id is provided, it's validated.
        """
        if workspace_id is not None: # Only validate if workspace_id is given
            validate_workspace_access(self.session, workspace_id, user_id)

        dataset = self.session.get(Dataset, dataset_id)
        
        # If workspace_id was provided, ensure dataset belongs to it
        if dataset and workspace_id is not None and dataset.workspace_id != workspace_id:
            logger.warning(f"Dataset {dataset_id} found, but does not belong to specified workspace {workspace_id}.")
            return None # Or raise HTTPException(403) if strict matching to workspace is required

        # If workspace_id was NOT provided (e.g. fetching for share), ownership might be checked differently
        # For now, if no workspace_id, just return if user owns it.
        if dataset and workspace_id is None and dataset.user_id != user_id:
            logger.warning(f"User {user_id} attempting to access dataset {dataset_id} they don't own, without workspace context.")
            return None # Or raise

        if not dataset:
            return None
            
        return dataset

    def list_datasets(self, user_id: int, workspace_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[Dataset], int]:
        """
        List datasets in a workspace.
        READ-ONLY - Does not commit.
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        # Get total count
        count_stmt = select(func.count()).select_from(
            select(Dataset).where(
                Dataset.workspace_id == workspace_id
            ).subquery()
        )
        total_count = self.session.exec(count_stmt).one()

        # Get datasets
        statement = select(Dataset).where(
            Dataset.workspace_id == workspace_id
        ).offset(skip).limit(limit)

        datasets = self.session.exec(statement).all()
        logger.debug(f"Found {len(datasets)} datasets (total: {total_count}) in workspace {workspace_id}")
        return datasets, total_count

    def update_dataset(self, user_id: int, workspace_id: int, dataset_id: int, dataset_in: DatasetUpdate) -> Optional[Dataset]:
        """
        Update a dataset.
        MODIFIES DATA - Commits transaction.
        """
        try:
            validate_workspace_access(self.session, workspace_id, user_id)

            dataset = self.session.get(Dataset, dataset_id)
            if not dataset or dataset.workspace_id != workspace_id:
                return None

            update_data = dataset_in.model_dump(exclude_unset=True)

            # Validate IDs if they are being updated
            if 'datarecord_ids' in update_data and update_data['datarecord_ids'] is not None:
                count_stmt = select(func.count(DataRecord.id)).join(DataSource).where(DataRecord.id.in_(update_data['datarecord_ids']), DataSource.workspace_id == workspace_id)
                record_count = self.session.exec(count_stmt).one()
                if record_count != len(update_data['datarecord_ids']):
                    raise ValueError("One or more updated DataRecord IDs not found in this workspace.")

            if 'source_job_ids' in update_data and update_data['source_job_ids'] is not None:
                count_stmt = select(func.count(ClassificationJob.id)).where(ClassificationJob.id.in_(update_data['source_job_ids']), ClassificationJob.workspace_id == workspace_id)
                job_count = self.session.exec(count_stmt).one()
                if job_count != len(update_data['source_job_ids']):
                    raise ValueError("One or more updated ClassificationJob IDs not found in this workspace.")

            if 'source_scheme_ids' in update_data and update_data['source_scheme_ids'] is not None:
                count_stmt = select(func.count(ClassificationScheme.id)).where(ClassificationScheme.id.in_(update_data['source_scheme_ids']), ClassificationScheme.workspace_id == workspace_id)
                scheme_count = self.session.exec(count_stmt).one()
                if scheme_count != len(update_data['source_scheme_ids']):
                    raise ValueError("One or more updated ClassificationScheme IDs not found in this workspace.")

            # Ensure updated_at is always set using the provided model field
            update_data["updated_at"] = dataset_in.updated_at # Use the one generated by the model

            for key, value in update_data.items():
                setattr(dataset, key, value)

            self.session.add(dataset)
            self.session.commit()
            self.session.refresh(dataset)
            logger.info(f"Updated dataset {dataset.id} in workspace {workspace_id}")
            return dataset

        except Exception as e:
            self.session.rollback()
            logger.error(f"Failed to update dataset: {str(e)}", exc_info=True)
            raise ValueError(f"Failed to update dataset: {str(e)}")

    def delete_dataset(self, user_id: int, workspace_id: int, dataset_id: int) -> Optional[Dataset]:
        """
        Delete a dataset.
        MODIFIES DATA - Commits transaction.
        """
        try:
            validate_workspace_access(self.session, workspace_id, user_id)

            dataset = self.session.get(Dataset, dataset_id)
            if not dataset or dataset.workspace_id != workspace_id:
                return None

            deleted_dataset_name = dataset.name # Store for logging
            self.session.delete(dataset)
            self.session.commit()
            logger.info(f"Deleted dataset {dataset_id} ('{deleted_dataset_name}') from workspace {workspace_id}")
            return dataset 

        except Exception as e:
            self.session.rollback()
            logger.error(f"Failed to delete dataset: {str(e)}", exc_info=True)
            raise ValueError(f"Failed to delete dataset: {str(e)}")

    async def export_dataset_package(
        self,
        user_id: int,
        workspace_id: int,
        dataset_id: int,
        include_record_content: bool = False,
        include_results: bool = False,
        include_source_files: bool = True
    ) -> DataPackage:
        """
        Export a dataset as a self-contained package including all related resources.
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        dataset = self.session.get(Dataset, dataset_id)
        if not dataset or dataset.workspace_id != workspace_id:
            raise ValueError("Dataset not found or not accessible")

        builder = PackageBuilder(
            session=self.session,
            storage_provider=self.storage_provider,
            source_instance_id=self.source_instance_id
        )

        content: Dict[str, Any] = { 
            "dataset": {
                "entity_uuid": dataset.entity_uuid,
                "name": dataset.name,
                "description": dataset.description,
                "custom_metadata": dataset.custom_metadata,
                "created_at": dataset.created_at.isoformat() if dataset.created_at else None,
                "updated_at": dataset.updated_at.isoformat() if dataset.updated_at else None,
            }
        }

        records_in_dataset: List[DataRecord] = [] 
        if dataset.datarecord_ids:
            records_in_dataset = self.session.exec(
                select(DataRecord).where(
                    DataRecord.id.in_(dataset.datarecord_ids)
                )
            ).all()

            content["records"] = []
            datasource_map: Dict[int, Dict[str, Any]] = {} 

            for record in records_in_dataset:
                record_data: Dict[str, Any] = { 
                    "entity_uuid": record.entity_uuid,
                    "source_metadata": record.source_metadata,
                    "event_timestamp": record.event_timestamp.isoformat() if record.event_timestamp else None,
                    "url_hash": record.url_hash,
                    "content_hash": record.content_hash,
                    "title": record.title, 
                    "top_image": record.top_image, 
                    "images": record.images
                }

                if include_record_content:
                    record_data["text_content"] = record.text_content

                if record.datasource_id:
                    if record.datasource_id not in datasource_map:
                        ds = self.session.get(DataSource, record.datasource_id)
                        if ds:
                            datasource_map[record.datasource_id] = {
                                "entity_uuid": ds.entity_uuid,
                                "name": ds.name,
                                "type": ds.type.value
                            }
                    if record.datasource_id in datasource_map:
                        record_data["datasource_ref"] = datasource_map[record.datasource_id]

                if include_results and record.classification_results:
                    record_data["classification_results"] = []
                    for result_item in record.classification_results: 
                        result_data: Dict[str, Any] = { 
                            "scheme_uuid": result_item.scheme.entity_uuid,
                            "job_uuid": result_item.job.entity_uuid,
                            "value": result_item.value,
                            "timestamp": result_item.timestamp.isoformat() if result_item.timestamp else None,
                            "scheme_name": result_item.scheme.name,  
                            "job_name": result_item.job.name,
                            "status": result_item.status.value, 
                            "error_message": result_item.error_message
                        }
                        record_data["classification_results"].append(result_data)
                content["records"].append(record_data)

        if include_source_files:
            content["source_files_manifest"] = [] 
            processed_datasource_files = set() 

            for record_obj in records_in_dataset: 
                if record_obj.datasource_id:
                    datasource = self.session.get(DataSource, record_obj.datasource_id)
                    if datasource and datasource.type in [DataSourceType.PDF, DataSourceType.CSV, DataSourceType.BULK_PDF]:
                        storage_path = None
                        original_filename = None
                        
                        if datasource.type == DataSourceType.BULK_PDF and isinstance(record_obj.source_metadata, dict):
                            original_filename = record_obj.source_metadata.get('original_filename')
                            if original_filename and datasource.entity_uuid: 
                                storage_path = f"datasources/{datasource.entity_uuid}/{original_filename}"
                        else: 
                            if isinstance(datasource.origin_details, dict):
                                storage_path = datasource.origin_details.get('storage_path')
                                original_filename = datasource.origin_details.get('filename')

                        if not storage_path and isinstance(datasource.source_metadata, dict): 
                            storage_path = datasource.source_metadata.get('storage_path')
                        if not original_filename and isinstance(datasource.source_metadata, dict): 
                            original_filename = datasource.source_metadata.get('filename')
                        
                        if storage_path and original_filename:
                            if storage_path not in processed_datasource_files:
                                try:
                                    logger.debug(f"Fetching source file {storage_path} for dataset package (DataSource ID: {datasource.id}, Record ID: {record_obj.id}).")
                                    file_object = await self.storage_provider.get_file(storage_path)
                                    if file_object and hasattr(file_object, 'read'):
                                        file_data = await file_object.read()
                                        if hasattr(file_object, 'close'):
                                            file_object.close()
                                    else:
                                        logger.warning(f"Storage provider returned invalid file object for {storage_path}. Skipping.")
                                        continue

                                    builder._add_file(original_filename, file_data) 
                                    content["source_files_manifest"].append({
                                        "filename": original_filename,
                                        "original_datasource_uuid": datasource.entity_uuid,
                                        "original_datasource_id": datasource.id,
                                        "type": datasource.type.value,
                                        "linked_datarecord_uuid": record_obj.entity_uuid 
                                    })
                                    processed_datasource_files.add(storage_path)
                                    logger.info(f"Added source file '{original_filename}' from DataSource '{datasource.name}' for Record '{record_obj.id}' to dataset package.")
                                except FileNotFoundError:
                                    logger.warning(f"Source file {storage_path} for DataSource {datasource.id} (Record {record_obj.id}) not found in storage. Skipping.")
                                except Exception as e:
                                    logger.warning(f"Failed to include source file {storage_path} for DataSource {datasource.id} (Record {record_obj.id}): {e}", exc_info=True)
                        else:
                            logger.debug(f"No storage_path or original_filename for DataSource {datasource.id} (Record {record_obj.id}). Skipping file inclusion.")

        if dataset.source_scheme_ids:
            schemes = self.session.exec(
                select(ClassificationScheme).where(
                    ClassificationScheme.id.in_(dataset.source_scheme_ids)
                )
            ).all()
            content["classification_schemes"] = [
                ClassificationScheme.model_validate(scheme).model_dump(exclude_none=True) 
                for scheme in schemes
            ]

        if dataset.source_job_ids:
            jobs = self.session.exec(
                select(ClassificationJob).where(
                    ClassificationJob.id.in_(dataset.source_job_ids)
                )
            ).all()
            content["classification_jobs"] = [
                ClassificationJob.model_validate(job).model_dump(exclude={'target_datasources', 'target_schemes'}) 
                for job in jobs
            ]

        metadata = PackageMetadata(
            package_type=ResourceType.DATASET,
            source_entity_uuid=dataset.entity_uuid,
            source_instance_id=self.source_instance_id,
            description=f"Dataset: {dataset.name}",
            created_by=str(user_id), 
            created_at=datetime.now(timezone.utc)
        )
        return DataPackage(metadata, content, builder.files)

    async def import_dataset_package(
        self,
        target_user_id: int,
        target_workspace_id: int,
        package: DataPackage,
        conflict_resolution_strategy: str = 'skip', 
    ) -> Dataset:
        """
        Import a dataset package with all its nested resources.
        """
        if package.metadata.package_type != ResourceType.DATASET:
            raise ValueError("Invalid package type for dataset import")

        validate_workspace_access(self.session, target_workspace_id, target_user_id)
        
        importer = PackageImporter( 
            session=self.session,
            storage_provider=self.storage_provider,
            target_workspace_id=target_workspace_id,
            target_user_id=target_user_id
        )

        try:
            imported_dataset = await importer.import_dataset_package(
                package=package,
                conflict_strategy=conflict_resolution_strategy
            )
            
            self.session.commit()
            self.session.refresh(imported_dataset) 
            logger.info(f"Successfully imported and committed dataset {imported_dataset.name} with ID {imported_dataset.id}")
            return imported_dataset

        except ValueError as ve:
            self.session.rollback()
            logger.error(f"Dataset import validation failed: {ve}", exc_info=True)
            raise ve
        except Exception as e:
            self.session.rollback()
            logger.error(f"Critical error during dataset import package processing: {e}", exc_info=True)
            raise RuntimeError(f"Critical error during dataset import: {str(e)}")

    def create_dataset_from_job_run(
        self,
        job_id: int,
        user_id: int,
        workspace_id: int,
        dataset_name: Optional[str] = None,
        dataset_description: Optional[str] = None,
    ) -> Dataset:
        """
        Creates a new Dataset from a completed ClassificationJob run.
        The dataset will include all DataRecords that have results from this job
        and references to the schemes and job itself.

        MODIFIES DATA - Commits transaction via self.create_dataset.
        """
        logger.info(f"Attempting to create dataset from job {job_id} in workspace {workspace_id} for user {user_id}")
        validate_workspace_access(self.session, workspace_id, user_id)

        job = self.session.get(ClassificationJob, job_id)
        if not job:
            raise ValueError(f"ClassificationJob with ID {job_id} not found.")
        if job.workspace_id != workspace_id: 
            raise ValueError(f"ClassificationJob {job_id} does not belong to the specified workspace {workspace_id}.")
        
        record_ids_with_results_stmt = (
            select(ClassificationResult.datarecord_id)
            .where(ClassificationResult.job_id == job_id)
            .distinct()
        )
        datarecord_ids = self.session.exec(record_ids_with_results_stmt).all()
        if not datarecord_ids:
            logger.warning(f"No DataRecords with results found for job {job_id}. Dataset will have no linked records initially.")

        source_scheme_ids_from_job_config: List[int] = []
        if job.configuration and isinstance(job.configuration, dict):
            scheme_ids_in_config = job.configuration.get('scheme_ids', [])
            if isinstance(scheme_ids_in_config, list) and all(isinstance(sid, int) for sid in scheme_ids_in_config):
                 source_scheme_ids_from_job_config = scheme_ids_in_config
        
        source_scheme_ids_from_relationship = [s.id for s in job.target_schemes if s.id is not None]
        
        all_potential_scheme_ids = list(set(source_scheme_ids_from_job_config + source_scheme_ids_from_relationship))
        
        final_source_scheme_ids: List[int] = []
        if all_potential_scheme_ids:
            valid_schemes_stmt = select(ClassificationScheme.id).where(
                ClassificationScheme.id.in_(all_potential_scheme_ids),
                ClassificationScheme.workspace_id == workspace_id 
            )
            final_source_scheme_ids = self.session.exec(valid_schemes_stmt).all()

        if not final_source_scheme_ids: 
            logger.warning(f"No valid target schemes (found in workspace {workspace_id}) for job {job_id}. Dataset will have no linked schemes.")

        final_dataset_name = dataset_name or f"Dataset from Job: {job.name} ({job.id})"
        final_dataset_description = dataset_description or f"Automatically created dataset from the run of ClassificationJob ID {job.id} on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}."

        custom_meta = {
            "source_classification_job_id": job.id,
            "source_classification_job_uuid": job.entity_uuid,
            "source_classification_job_name": job.name,
            "job_status_at_dataset_creation": job.status.value if job.status else None,
            "job_completed_at": job.updated_at.isoformat() if job.updated_at else None
        }

        dataset_in = DatasetCreate(
            name=final_dataset_name,
            description=final_dataset_description,
            custom_metadata=custom_meta,
            datarecord_ids=list(datarecord_ids) if datarecord_ids else [], 
            source_job_ids=[job_id],
            source_scheme_ids=list(final_source_scheme_ids) if final_source_scheme_ids else [] 
        )

        logger.info(f"Proceeding to create dataset '{final_dataset_name}' with {len(datarecord_ids)} records, {len(final_source_scheme_ids)} schemes from job {job_id}.")
        
        try:
            new_dataset = self.create_dataset( 
                user_id=user_id,
                workspace_id=workspace_id, 
                dataset_in=dataset_in
            )
            logger.info(f"Successfully created Dataset {new_dataset.id} ('{new_dataset.name}') from job {job_id}.")
            return new_dataset
        except ValueError as ve:
            logger.error(f"Error during self.create_dataset call from job {job_id}: {ve}", exc_info=True)
            raise ve
        except Exception as e:
            logger.error(f"Unexpected error creating dataset from job {job_id}: {e}", exc_info=True)
            raise RuntimeError(f"Unexpected error while finalizing dataset creation from job: {str(e)}")

# Removed dummy factory function

# Factory function REMOVED - Now in deps.py
# def get_dataset_service() -> DatasetService:
#     """Returns an instance of the DatasetService with dependencies injected via Depends()."""
#     # The constructor will get dependencies via Depends() from FastAPI
#     return DatasetService() 