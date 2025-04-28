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
from app.api.services.package import PackageBuilder, PackageImporter, DataPackage
from app.api.services.providers.base import StorageProvider

from app.models import Dataset, DatasetCreate, DatasetUpdate, User, Workspace
from app.models import DataRecord, ClassificationScheme, ClassificationJob, ClassificationResult, DataSource, ResourceType
from app.models import DataSourceType

logger = logging.getLogger(__name__)



class DatasetService:
    """Service layer for managing Dataset resources."""

    def __init__(
        self,
        session: Session, # Use base Session type
        # Inject service base types
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
            raise ValueError(f"Failed to create dataset: {str(e)}")

    def get_dataset(self, user_id: int, workspace_id: int, dataset_id: int) -> Optional[Dataset]:
        """
        Get a dataset by ID.
        READ-ONLY - Does not commit.
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        dataset = self.session.get(Dataset, dataset_id)
        if not dataset or dataset.workspace_id != workspace_id:
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

            deleted_dataset = dataset  # Store for return
            self.session.delete(dataset)
            self.session.commit()
            logger.info(f"Deleted dataset {dataset_id} from workspace {workspace_id}")
            return deleted_dataset

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to delete dataset: {str(e)}")

    async def export_dataset_package(
        self,
        user_id: int,
        workspace_id: int,
        dataset_id: int,
        include_record_content: bool = False,
        include_results: bool = False,
        include_source_files: bool = True  # New parameter to control file inclusion
    ) -> DataPackage:
        """
        Export a dataset as a self-contained package including all related resources.
        
        Args:
            user_id: ID of user requesting export
            workspace_id: ID of workspace containing dataset
            dataset_id: ID of dataset to export
            include_record_content: Whether to include full text content of records
            include_results: Whether to include classification results
            include_source_files: Whether to include original source files (PDFs, CSVs)
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

        # Build base dataset metadata
        content = {
            "dataset": {
                "entity_uuid": dataset.entity_uuid,
                "name": dataset.name,
                "description": dataset.description,
                "custom_metadata": dataset.custom_metadata,
                "created_at": dataset.created_at.isoformat() if dataset.created_at else None,
                "updated_at": dataset.updated_at.isoformat() if dataset.updated_at else None,
            }
        }

        # Export DataRecords with enhanced metadata
        if dataset.datarecord_ids:
            records = self.session.exec(
                select(DataRecord).where(
                    DataRecord.id.in_(dataset.datarecord_ids)
                )
            ).all()

            content["records"] = []
            datasource_map = {}  # Cache for datasource lookups

            for record in records:
                record_data = {
                    "entity_uuid": record.entity_uuid,
                    "source_metadata": record.source_metadata,
                    "event_timestamp": record.event_timestamp.isoformat() if record.event_timestamp else None,
                    "url_hash": record.url_hash,
                    "content_hash": record.content_hash
                }

                # Include text content if requested
                if include_record_content:
                    record_data["text_content"] = record.text_content

                # Include datasource reference
                if record.datasource_id:
                    if record.datasource_id not in datasource_map:
                        datasource = self.session.get(DataSource, record.datasource_id)
                        if datasource:
                            datasource_map[record.datasource_id] = {
                                "entity_uuid": datasource.entity_uuid,
                                "name": datasource.name,
                                "type": datasource.type.value
                            }
                    if record.datasource_id in datasource_map:
                        record_data["datasource_ref"] = datasource_map[record.datasource_id]

                # Include classification results if requested
                if include_results and record.classification_results:
                    record_data["classification_results"] = []
                    for result in record.classification_results:
                        result_data = {
                            "scheme_uuid": result.scheme.entity_uuid,
                            "job_uuid": result.job.entity_uuid,
                            "value": result.value,
                            "timestamp": result.timestamp.isoformat() if result.timestamp else None,
                            "scheme_name": result.scheme.name,  # Include readable references
                            "job_name": result.job.name
                        }
                        record_data["classification_results"].append(result_data)

                content["records"].append(record_data)

        # Export source files if requested
        if include_source_files:
            content["source_files"] = []
            processed_sources = set()

            # Collect unique datasources from records
            for record in records:
                if record.datasource_id and record.datasource_id not in processed_sources:
                    datasource = self.session.get(DataSource, record.datasource_id)
                    if datasource and datasource.type in [DataSourceType.PDF, DataSourceType.CSV]:
                        storage_path = datasource.origin_details.get('storage_path')
                        if storage_path:
                            try:
                                file_content = await self.storage_provider.get_file(storage_path)
                                file_data = await file_content.read()
                                filename = os.path.basename(storage_path)
                                builder._add_file(filename, file_data)
                                content["source_files"].append({
                                    "filename": filename,
                                    "datasource_uuid": datasource.entity_uuid,
                                    "type": datasource.type.value
                                })
                            except Exception as e:
                                logger.warning(f"Failed to include source file for datasource {datasource.id}: {e}")
                    processed_sources.add(record.datasource_id)

        # Export source schemes
        if dataset.source_scheme_ids:
            schemes = self.session.exec(
                select(ClassificationScheme).where(
                    ClassificationScheme.id.in_(dataset.source_scheme_ids)
                )
            ).all()

            content["classification_schemes"] = [
                {
                    "entity_uuid": scheme.entity_uuid,
                    "name": scheme.name,
                    "description": scheme.description,
                    "model_instructions": scheme.model_instructions,
                    "validation_rules": scheme.validation_rules,
                    "fields": [
                        {
                            "name": field.name,
                            "description": field.description,
                            "type": field.type,
                            "scale_min": field.scale_min,
                            "scale_max": field.scale_max,
                            "is_set_of_labels": field.is_set_of_labels,
                            "labels": field.labels,
                            "dict_keys": field.dict_keys,
                            "is_time_axis_hint": field.is_time_axis_hint
                        }
                        for field in scheme.fields
                    ] if scheme.fields else []
                }
                for scheme in schemes
            ]

        # Export source jobs with configurations
        if dataset.source_job_ids:
            jobs = self.session.exec(
                select(ClassificationJob).where(
                    ClassificationJob.id.in_(dataset.source_job_ids)
                )
            ).all()

            content["classification_jobs"] = [
                {
                    "entity_uuid": job.entity_uuid,
                    "name": job.name,
                    "description": job.description,
                    "configuration": job.configuration,
                    "status": job.status.value,
                    "created_at": job.created_at.isoformat() if job.created_at else None,
                    # Include relationships
                    "target_schemes": [
                        {"entity_uuid": scheme.entity_uuid, "name": scheme.name}
                        for scheme in job.target_schemes
                    ],
                    "target_datasources": [
                        {"entity_uuid": ds.entity_uuid, "name": ds.name}
                        for ds in job.target_datasources
                    ]
                }
                for job in jobs
            ]

        # Create package metadata
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
        conflict_resolution_strategy: str = 'skip'
    ) -> Dataset:
        """
        Import a dataset package with all its nested resources.
        
        Args:
            target_user_id: ID of user importing the dataset
            target_workspace_id: ID of workspace to import into
            package: DataPackage object containing the dataset and related resources
            conflict_resolution_strategy: How to handle conflicts ('skip', 'update', 'replace')
        """
        if package.metadata.package_type != ResourceType.DATASET:
            raise ValueError("Invalid package type")

        validate_workspace_access(self.session, target_workspace_id, target_user_id)

        try:
            ds_data = package.content["dataset"]
            source_uuid = ds_data["entity_uuid"]

            # Check for existing import
            existing = self.session.exec(
                select(Dataset).where(
                    Dataset.imported_from_uuid == source_uuid,
                    Dataset.workspace_id == target_workspace_id
                )
            ).first()

            if existing and conflict_resolution_strategy == 'skip':
                return existing

            # Start a nested transaction for atomic import
            # All changes will be rolled back if any part fails
            transaction = self.session.begin_nested()

            try:
                # 1. Import Classification Schemes First
                scheme_id_map = {}  # Map source UUIDs to local IDs
                if "classification_schemes" in package.content:
                    for scheme_data in package.content["classification_schemes"]:
                        try:
                            scheme = self.classification_service.find_or_create_scheme_from_definition(
                                workspace_id=target_workspace_id,
                                user_id=target_user_id,
                                scheme_definition=scheme_data,
                                conflict_strategy=conflict_resolution_strategy
                            )
                            if scheme:
                                scheme_id_map[scheme_data["entity_uuid"]] = scheme.id
                        except Exception as e:
                            logger.warning(f"Failed to import scheme: {e}")
                            if conflict_resolution_strategy != 'skip':
                                raise

                # 2. Import Source Files and Create DataSources
                datasource_id_map = {}  # Map source UUIDs to local IDs
                if "source_files" in package.content:
                    for file_info in package.content["source_files"]:
                        try:
                            filename = file_info["filename"]
                            if filename not in package.files:
                                logger.warning(f"Missing file content for {filename}")
                                continue

                            # Store file in storage provider
                            file_content = package.files[filename]
                            storage_path = f"user_{target_user_id}/imported/{uuid.uuid4()}_{filename}"
                            await self.storage_provider.upload_file(file_content, storage_path)

                            # Create DataSource
                            datasource = await self.ingestion_service.create_datasource(
                                workspace_id=target_workspace_id,
                                user_id=target_user_id,
                                name=f"Imported: {filename}",
                                type=DataSourceType(file_info["type"]),
                                origin_details_str=json.dumps({"storage_path": storage_path}),
                                files=None  # File already uploaded
                            )
                            if datasource:
                                datasource_id_map[file_info["datasource_uuid"]] = datasource[0].id

                        except Exception as e:
                            logger.warning(f"Failed to import source file {filename}: {e}")
                            if conflict_resolution_strategy != 'skip':
                                raise

                # 3. Import Records
                record_id_map = {}  # Map source UUIDs to local IDs
                if "records" in package.content:
                    for record_data in package.content["records"]:
                        try:
                            # Find or create record
                            new_record = self.ingestion_service.find_or_create_datarecord_from_data(
                                workspace_id=target_workspace_id,
                                user_id=target_user_id,
                                record_data=record_data,
                                conflict_strategy=conflict_resolution_strategy
                            )
                            if new_record:
                                record_id_map[record_data["entity_uuid"]] = new_record.id

                                # Import classification results if present
                                if "classification_results" in record_data and include_results:
                                    for result_data in record_data["classification_results"]:
                                        if result_data["scheme_uuid"] in scheme_id_map:
                                            try:
                                                self.classification_service.create_result(
                                                    datarecord_id=new_record.id,
                                                    scheme_id=scheme_id_map[result_data["scheme_uuid"]],
                                                    job_id=None,  # Will be updated after job import
                                                    value=result_data["value"],
                                                    timestamp=datetime.fromisoformat(result_data["timestamp"]) if result_data.get("timestamp") else None
                                                )
                                            except Exception as e:
                                                logger.warning(f"Failed to import result for record {new_record.id}: {e}")

                        except Exception as e:
                            logger.warning(f"Failed to import record: {e}")
                            if conflict_resolution_strategy != 'skip':
                                raise

                # 4. Import Classification Jobs
                job_id_map = {}  # Map source UUIDs to local IDs
                if "classification_jobs" in package.content:
                    for job_data in package.content["classification_jobs"]:
                        try:
                            # Map scheme and datasource IDs in configuration
                            job_config = job_data["configuration"].copy()
                            if "scheme_ids" in job_config:
                                job_config["scheme_ids"] = [
                                    scheme_id_map.get(scheme_uuid)
                                    for scheme_uuid in job_data["target_schemes"]
                                    if scheme_uuid in scheme_id_map
                                ]
                            if "datasource_ids" in job_config:
                                job_config["datasource_ids"] = [
                                    datasource_id_map.get(ds_uuid)
                                    for ds_uuid in job_data["target_datasources"]
                                    if ds_uuid in datasource_id_map
                                ]

                            new_job = self.classification_service.find_or_create_job_from_config(
                                workspace_id=target_workspace_id,
                                user_id=target_user_id,
                                job_config_export=job_data,
                                import_context={
                                    "scheme": scheme_id_map,
                                    "datasource": datasource_id_map
                                },
                                conflict_strategy=conflict_resolution_strategy
                            )
                            if new_job:
                                job_id_map[job_data["entity_uuid"]] = new_job.id

                        except Exception as e:
                            logger.warning(f"Failed to import job: {e}")
                            if conflict_resolution_strategy != 'skip':
                                raise

                # 5. Create Dataset
                dataset = Dataset(
                    workspace_id=target_workspace_id,
                    user_id=target_user_id,
                    imported_from_uuid=source_uuid,
                    name=ds_data["name"],
                    description=ds_data.get("description"),
                    custom_metadata=ds_data.get("custom_metadata", {}),
                    created_at=datetime.fromisoformat(ds_data["created_at"]) if ds_data.get("created_at") else None,
                    updated_at=datetime.now(timezone.utc)
                )

                # Set relationships using mapped IDs
                dataset.source_scheme_ids = list(scheme_id_map.values())
                dataset.source_job_ids = list(job_id_map.values())
                dataset.datarecord_ids = list(record_id_map.values())

                self.session.add(dataset)
                transaction.commit()  # Commit the nested transaction

                logger.info(f"Successfully imported dataset {dataset.name} with {len(record_id_map)} records")
                return dataset

            except Exception as e:
                transaction.rollback()  # Rollback the nested transaction
                logger.error(f"Failed to import dataset package: {e}", exc_info=True)
                raise ValueError(f"Dataset import failed: {str(e)}")

        except Exception as e:
            self.session.rollback()  # Rollback the main transaction
            logger.error(f"Critical error during dataset import: {e}", exc_info=True)
            raise ValueError(f"Critical error during dataset import: {str(e)}")


# Removed dummy factory function

# Factory function REMOVED - Now in deps.py
# def get_dataset_service() -> DatasetService:
#     """Returns an instance of the DatasetService with dependencies injected via Depends()."""
#     # The constructor will get dependencies via Depends() from FastAPI
#     return DatasetService() 