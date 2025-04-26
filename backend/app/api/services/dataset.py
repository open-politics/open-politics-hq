# backend/app/api/services/dataset.py
import logging
from typing import List, Optional, Tuple, Dict, Any
from sqlmodel import Session, select, func
from fastapi import HTTPException, status
import json
import uuid
from datetime import datetime, timezone

# Import base service types
from app.api.services.classification import ClassificationService
from app.api.services.ingestion import IngestionService
from app.api.services.service_utils import validate_workspace_access

from app.models import Dataset, DatasetCreate, DatasetUpdate, User, Workspace
from app.models import DataRecord, ClassificationScheme, ClassificationJob, ClassificationResult, DataSource

logger = logging.getLogger(__name__)



class DatasetService:
    """Service layer for managing Dataset resources."""

    def __init__(
        self,
        session: Session, # Use base Session type
        # Inject service base types
        classification_service: ClassificationService,
        ingestion_service: IngestionService
    ):
        """Initialize with Session and dependent services via DI."""
        self.session = session
        self.classification_service = classification_service
        self.ingestion_service = ingestion_service
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

    def export_dataset_package(
        self,
        user_id: int,
        workspace_id: int,
        dataset_id: int,
        include_record_content: bool = False,
        include_results: bool = False
    ) -> Dict[str, Any]:
        """
        Export a dataset as a package.
        READ-ONLY - Does not commit.
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        dataset = self.session.get(Dataset, dataset_id)
        if not dataset or dataset.workspace_id != workspace_id:
            raise ValueError("Dataset not found or not accessible")

        export_data = {
            "name": dataset.name,
            "description": dataset.description,
            "custom_metadata": dataset.custom_metadata,
            "created_at": dataset.created_at.isoformat() if dataset.created_at else None,
            "updated_at": dataset.updated_at.isoformat() if dataset.updated_at else None,
            "datarecords": [],
            "source_jobs": [],
            "source_schemes": []
        }

        # Export DataRecords
        if dataset.datarecord_ids:
            records = self.session.exec(
                select(DataRecord).where(
                    DataRecord.id.in_(dataset.datarecord_ids)
                )
            ).all()

            for record in records:
                record_data = {
                    "source_metadata": record.source_metadata,
                    "event_timestamp": record.event_timestamp.isoformat() if record.event_timestamp else None,
                    "url_hash": record.url_hash,
                    "content_hash": record.content_hash
                }
                if include_record_content:
                    record_data["text_content"] = record.text_content

                if include_results:
                    record_data["classification_results"] = [
                        {
                            "scheme_id": result.scheme_id,
                            "value": result.value,
                            "timestamp": result.timestamp.isoformat() if result.timestamp else None
                        }
                        for result in record.classification_results
                    ]

                export_data["datarecords"].append(record_data)

        # Export source jobs
        if dataset.source_job_ids:
            jobs = self.session.exec(
                select(ClassificationJob).where(
                    ClassificationJob.id.in_(dataset.source_job_ids)
                )
            ).all()

            export_data["source_jobs"] = [
                {
                    "name": job.name,
                    "description": job.description,
                    "configuration": job.configuration,
                    "status": job.status,
                    "created_at": job.created_at.isoformat() if job.created_at else None
                }
                for job in jobs
            ]

        # Export source schemes
        if dataset.source_scheme_ids:
            schemes = self.session.exec(
                select(ClassificationScheme).where(
                    ClassificationScheme.id.in_(dataset.source_scheme_ids)
                )
            ).all()

            export_data["source_schemes"] = [
                {
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

        return export_data

    def import_dataset_package(
        self,
        target_user_id: int,
        target_workspace_id: int,
        package_data: Dict[str, Any],
        conflict_resolution_strategy: str = 'skip'
    ) -> Dataset:
        """
        Import a dataset from a package.
        MODIFIES DATA - Commits transaction.
        """
        try:
            validate_workspace_access(self.session, target_workspace_id, target_user_id)

            # Create dataset
            dataset = Dataset(
                workspace_id=target_workspace_id,
                user_id=target_user_id,
                name=package_data.get("name", "Imported Dataset"),
                description=package_data.get("description"),
                custom_metadata=package_data.get("custom_metadata", {})
            )
            self.session.add(dataset)
            self.session.flush()  # Get dataset ID

            # Import schemes first
            scheme_id_map = {}
            for scheme_data in package_data.get("source_schemes", []):
                try:
                    new_scheme = self.classification_service.find_or_create_scheme_from_definition(
                        workspace_id=target_workspace_id,
                        user_id=target_user_id,
                        scheme_definition=scheme_data,
                        conflict_strategy=conflict_resolution_strategy
                    )
                    if new_scheme:
                        scheme_id_map[scheme_data.get("id")] = new_scheme.id
                except Exception as e:
                    logger.warning(f"Failed to import scheme: {e}")

            # Import jobs
            job_id_map = {}
            for job_data in package_data.get("source_jobs", []):
                try:
                    # Map scheme IDs in job configuration
                    if "scheme_ids" in job_data.get("configuration", {}):
                        job_data["configuration"]["scheme_ids"] = [
                            scheme_id_map.get(old_id, old_id)
                            for old_id in job_data["configuration"]["scheme_ids"]
                        ]

                    new_job = self.classification_service.find_or_create_job_from_config(
                        workspace_id=target_workspace_id,
                        user_id=target_user_id,
                        job_config_export=job_data,
                        import_context={"scheme": scheme_id_map},
                        conflict_strategy=conflict_resolution_strategy
                    )
                    if new_job:
                        job_id_map[job_data.get("id")] = new_job.id
                except Exception as e:
                    logger.warning(f"Failed to import job: {e}")

            # Import records
            record_id_map = {}
            for record_data in package_data.get("datarecords", []):
                try:
                    new_record = self.ingestion_service.find_or_create_datarecord_from_data(
                        workspace_id=target_workspace_id,
                        user_id=target_user_id,
                        record_data=record_data,
                        conflict_strategy=conflict_resolution_strategy
                    )
                    if new_record:
                        record_id_map[record_data.get("id")] = new_record.id
                except Exception as e:
                    logger.warning(f"Failed to import record: {e}")

            # Update dataset with mapped IDs
            dataset.source_scheme_ids = list(scheme_id_map.values())
            dataset.source_job_ids = list(job_id_map.values())
            dataset.datarecord_ids = list(record_id_map.values())

            self.session.commit()
            self.session.refresh(dataset)
            return dataset

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to import dataset package: {str(e)}")


# Removed dummy factory function

# Factory function REMOVED - Now in deps.py
# def get_dataset_service() -> DatasetService:
#     """Returns an instance of the DatasetService with dependencies injected via Depends()."""
#     # The constructor will get dependencies via Depends() from FastAPI
#     return DatasetService() 