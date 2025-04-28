"""
Package handling for universal data transfer.

This module defines the package format and provides utilities for
creating and processing data packages.
"""
import logging
import json
import zipfile
import tempfile
import os
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timezone
import uuid
from pathlib import Path
from sqlalchemy import select
from sqlmodel import Session
from fastapi import UploadFile

from app.models import (
    DataSource,
    DataRecord,
    ClassificationScheme,
    ClassificationJob,
    Dataset,
    ResourceType,
    ClassificationResult,
    ClassificationField
)
from app.api.services.providers.base import StorageProvider

logger = logging.getLogger(__name__)

class PackageMetadata:
    """Metadata for a data package."""
    def __init__(
        self,
        package_type: ResourceType,
        source_entity_uuid: str,
        source_instance_id: Optional[str] = None,
        format_version: str = "1.0",
        created_at: Optional[datetime] = None,
        created_by: Optional[str] = None,
        description: Optional[str] = None,
    ):
        self.package_type = package_type
        self.source_entity_uuid = source_entity_uuid
        self.source_instance_id = source_instance_id or "unknown"
        self.format_version = format_version
        self.created_at = created_at or datetime.now(timezone.utc)
        self.created_by = created_by
        self.description = description
        self.package_uuid = str(uuid.uuid4())

    def to_dict(self) -> Dict[str, Any]:
        """Convert metadata to dictionary."""
        return {
            "package_type": self.package_type.value,
            "source_entity_uuid": self.source_entity_uuid,
            "source_instance_id": self.source_instance_id,
            "format_version": self.format_version,
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
            "description": self.description,
            "package_uuid": self.package_uuid
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PackageMetadata":
        """Create metadata from dictionary."""
        return cls(
            package_type=ResourceType(data["package_type"]),
            source_entity_uuid=data["source_entity_uuid"],
            source_instance_id=data.get("source_instance_id"),
            format_version=data["format_version"],
            created_at=datetime.fromisoformat(data["created_at"]),
            created_by=data.get("created_by"),
            description=data.get("description")
        )

class DataPackage:
    """
    Represents a self-contained data package for transfer.
    
    The package consists of:
    - manifest.json: Contains metadata and entity definitions
    - files/: Directory containing associated files (PDFs, CSVs, etc.)
    """
    def __init__(
        self,
        metadata: PackageMetadata,
        content: Dict[str, Any],
        files: Optional[Dict[str, bytes]] = None
    ):
        self.metadata = metadata
        self.content = content
        self.files = files or {}

    def to_zip(self, output_path: str) -> None:
        """Write package to a ZIP file."""
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # Write manifest
            manifest = {
                "metadata": self.metadata.to_dict(),
                "content": self.content
            }
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))

            # Write files
            for filename, content in self.files.items():
                zf.writestr(f"files/{filename}", content)

    @classmethod
    def from_zip(cls, zip_path: str) -> "DataPackage":
        """Create package from a ZIP file."""
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # Read manifest
            manifest_data = json.loads(zf.read("manifest.json"))
            metadata = PackageMetadata.from_dict(manifest_data["metadata"])
            content = manifest_data["content"]

            # Read files
            files = {}
            for filename in zf.namelist():
                if filename.startswith("files/"):
                    name = Path(filename).name
                    files[name] = zf.read(filename)

            return cls(metadata, content, files)

    @classmethod
    async def from_upload(cls, file: UploadFile) -> "DataPackage":
        """Create package from an uploaded file."""
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_path = temp_file.name

        try:
            return cls.from_zip(temp_path)
        finally:
            os.unlink(temp_path)

class PackageBuilder:
    """
    Helper class for building data packages.
    """
    def __init__(
        self,
        session: Session,
        storage_provider: StorageProvider,
        source_instance_id: Optional[str] = None
    ):
        self.session = session
        self.storage_provider = storage_provider
        self.source_instance_id = source_instance_id
        self.files: Dict[str, bytes] = {}

    async def _fetch_file_content(self, object_name: str) -> bytes:
        """Fetch file content from storage."""
        file_obj = await self.storage_provider.get_file(object_name)
        return await file_obj.read()

    def _add_file(self, filename: str, content: bytes) -> None:
        """Add a file to the package."""
        self.files[filename] = content

    async def build_datasource_package(
        self,
        datasource: DataSource,
        include_records: bool = True,
        include_results: bool = False
    ) -> DataPackage:
        """Build a package for a DataSource."""
        content: Dict[str, Any] = {
            "datasource": {
                "entity_uuid": datasource.entity_uuid,
                "name": datasource.name,
                "type": datasource.type.value,
                "description": getattr(datasource, "description", None),
                "origin_details": datasource.origin_details,
                "source_metadata": datasource.source_metadata
            }
        }

        # Handle files if present
        if "storage_path" in datasource.origin_details:
            try:
                file_content = await self._fetch_file_content(
                    datasource.origin_details["storage_path"]
                )
                filename = Path(datasource.origin_details["storage_path"]).name
                self._add_file(filename, file_content)
                content["datasource"]["file_reference"] = filename
            except Exception as e:
                logger.error(f"Failed to fetch file for DataSource {datasource.id}: {e}")

        # Add records if requested
        if include_records and datasource.data_records:
            content["records"] = []
            for record in datasource.data_records:
                record_data = {
                    "entity_uuid": record.entity_uuid,
                    "text_content": record.text_content,
                    "source_metadata": record.source_metadata,
                    "event_timestamp": record.event_timestamp.isoformat() if record.event_timestamp else None,
                    "url_hash": record.url_hash,
                    "content_hash": record.content_hash
                }
                if include_results and record.classification_results:
                    record_data["results"] = [
                        {
                            "scheme_uuid": result.scheme.entity_uuid,
                            "job_uuid": result.job.entity_uuid,
                            "value": result.value,
                            "timestamp": result.timestamp.isoformat() if result.timestamp else None
                        }
                        for result in record.classification_results
                    ]
                content["records"].append(record_data)

        metadata = PackageMetadata(
            package_type=ResourceType.DATA_SOURCE,
            source_entity_uuid=datasource.entity_uuid,
            source_instance_id=self.source_instance_id,
            description=f"DataSource: {datasource.name}"
        )

        return DataPackage(metadata, content, self.files)

    async def build_scheme_package(
        self,
        scheme: ClassificationScheme,
        include_results: bool = False
    ) -> DataPackage:
        """Build a package for a ClassificationScheme."""
        content: Dict[str, Any] = {
            "scheme": {
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
        }

        # Add results if requested
        if include_results:
            results = self.session.exec(
                select(ClassificationResult).where(
                    ClassificationResult.scheme_id == scheme.id
                )
            ).all()

            content["results"] = [
                {
                    "record_uuid": result.datarecord.entity_uuid,
                    "job_uuid": result.job.entity_uuid,
                    "value": result.value,
                    "timestamp": result.timestamp.isoformat() if result.timestamp else None
                }
                for result in results
            ]

        metadata = PackageMetadata(
            package_type=ResourceType.SCHEMA,
            source_entity_uuid=scheme.entity_uuid,
            source_instance_id=self.source_instance_id,
            description=f"ClassificationScheme: {scheme.name}"
        )

        return DataPackage(metadata, content, self.files)

    async def build_job_package(
        self,
        job: ClassificationJob,
        include_results: bool = True
    ) -> DataPackage:
        """Build a package for a ClassificationJob."""
        content: Dict[str, Any] = {
            "job": {
                "entity_uuid": job.entity_uuid,
                "name": job.name,
                "description": job.description,
                "configuration": job.configuration,
                "status": job.status.value,
                "error_message": job.error_message,
                "created_at": job.created_at.isoformat() if job.created_at else None,
                "updated_at": job.updated_at.isoformat() if job.updated_at else None,
            }
        }

        # Add scheme references
        content["job"]["target_schemes"] = [
            {
                "entity_uuid": scheme.entity_uuid,
                "name": scheme.name
            }
            for scheme in job.target_schemes
        ]

        # Add datasource references
        content["job"]["target_datasources"] = [
            {
                "entity_uuid": ds.entity_uuid,
                "name": ds.name
            }
            for ds in job.target_datasources
        ]

        # Add results if requested
        if include_results:
            content["results"] = [
                {
                    "record_uuid": result.datarecord.entity_uuid,
                    "scheme_uuid": result.scheme.entity_uuid,
                    "value": result.value,
                    "timestamp": result.timestamp.isoformat() if result.timestamp else None
                }
                for result in job.classification_results
            ]

        metadata = PackageMetadata(
            package_type=ResourceType.CLASSIFICATION_JOB,
            source_entity_uuid=job.entity_uuid,
            source_instance_id=self.source_instance_id,
            description=f"ClassificationJob: {job.name}"
        )

        return DataPackage(metadata, content, self.files)

    async def build_dataset_package(
        self,
        dataset: Dataset,
        include_record_content: bool = False,
        include_results: bool = False
    ) -> DataPackage:
        """Build a package for a Dataset."""
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

        # Add records
        if dataset.datarecord_ids:
            records = self.session.exec(
                select(DataRecord).where(
                    DataRecord.id.in_(dataset.datarecord_ids)
                )
            ).all()

            content["records"] = []
            for record in records:
                record_data = {
                    "entity_uuid": record.entity_uuid,
                    "source_metadata": record.source_metadata,
                    "event_timestamp": record.event_timestamp.isoformat() if record.event_timestamp else None,
                    "url_hash": record.url_hash,
                    "content_hash": record.content_hash
                }
                if include_record_content:
                    record_data["text_content"] = record.text_content

                if include_results:
                    record_data["results"] = [
                        {
                            "scheme_uuid": result.scheme.entity_uuid,
                            "job_uuid": result.job.entity_uuid,
                            "value": result.value,
                            "timestamp": result.timestamp.isoformat() if result.timestamp else None
                        }
                        for result in record.classification_results
                    ]
                content["records"].append(record_data)

        # Add source jobs
        if dataset.source_job_ids:
            jobs = self.session.exec(
                select(ClassificationJob).where(
                    ClassificationJob.id.in_(dataset.source_job_ids)
                )
            ).all()

            content["source_jobs"] = [
                {
                    "entity_uuid": job.entity_uuid,
                    "name": job.name,
                    "description": job.description,
                    "configuration": job.configuration,
                    "status": job.status.value,
                    "created_at": job.created_at.isoformat() if job.created_at else None
                }
                for job in jobs
            ]

        # Add source schemes
        if dataset.source_scheme_ids:
            schemes = self.session.exec(
                select(ClassificationScheme).where(
                    ClassificationScheme.id.in_(dataset.source_scheme_ids)
                )
            ).all()

            content["source_schemes"] = [
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

        metadata = PackageMetadata(
            package_type=ResourceType.DATASET,
            source_entity_uuid=dataset.entity_uuid,
            source_instance_id=self.source_instance_id,
            description=f"Dataset: {dataset.name}"
        )

        return DataPackage(metadata, content, self.files)

class PackageImporter:
    """
    Helper class for importing data packages.
    """
    def __init__(
        self,
        session: Session,
        storage_provider: StorageProvider,
        target_workspace_id: int,
        target_user_id: int
    ):
        self.session = session
        self.storage_provider = storage_provider
        self.workspace_id = target_workspace_id
        self.user_id = target_user_id
        self.uuid_map: Dict[str, Dict[str, Any]] = {}

    async def _store_file(self, filename: str, content: bytes) -> str:
        """Store a file in the storage provider."""
        object_name = f"user_{self.user_id}/imported/{uuid.uuid4()}_{filename}"
        await self.storage_provider.upload_file(content, object_name)
        return object_name

    def _register_imported_entity(
        self,
        entity_type: str,
        source_uuid: str,
        local_entity: Any
    ) -> None:
        """Register an imported entity for reference."""
        if entity_type not in self.uuid_map:
            self.uuid_map[entity_type] = {}
        self.uuid_map[entity_type][source_uuid] = {
            "local_id": local_entity.id,
            "local_uuid": local_entity.entity_uuid
        }

    async def import_datasource_package(
        self,
        package: DataPackage,
        conflict_strategy: str = 'skip'
    ) -> DataSource:
        """Import a DataSource package."""
        if package.metadata.package_type != ResourceType.DATA_SOURCE:
            raise ValueError("Invalid package type")

        ds_data = package.content["datasource"]
        source_uuid = ds_data["entity_uuid"]

        # Check for existing import
        existing = self.session.exec(
            select(DataSource).where(
                DataSource.imported_from_uuid == source_uuid,
                DataSource.workspace_id == self.workspace_id
            )
        ).first()

        if existing and conflict_strategy == 'skip':
            return existing

        # Handle file if present
        if "file_reference" in ds_data:
            filename = ds_data["file_reference"]
            if filename not in package.files:
                raise ValueError(f"Missing file: {filename}")
            
            storage_path = await self._store_file(filename, package.files[filename])
            ds_data["origin_details"]["storage_path"] = storage_path

        # Create new DataSource
        new_ds = DataSource(
            workspace_id=self.workspace_id,
            user_id=self.user_id,
            imported_from_uuid=source_uuid,
            name=ds_data["name"],
            type=ds_data["type"],
            description=ds_data.get("description"),
            origin_details=ds_data["origin_details"],
            source_metadata=ds_data["source_metadata"]
        )
        self.session.add(new_ds)
        self.session.flush()
        self._register_imported_entity("datasource", source_uuid, new_ds)

        # Import records if present
        if "records" in package.content:
            for record_data in package.content["records"]:
                new_record = DataRecord(
                    datasource_id=new_ds.id,
                    imported_from_uuid=record_data["entity_uuid"],
                    text_content=record_data["text_content"],
                    source_metadata=record_data["source_metadata"],
                    event_timestamp=datetime.fromisoformat(record_data["event_timestamp"]) if record_data.get("event_timestamp") else None,
                    url_hash=record_data.get("url_hash"),
                    content_hash=record_data.get("content_hash")
                )
                self.session.add(new_record)
                self._register_imported_entity("record", record_data["entity_uuid"], new_record)

        self.session.commit()
        return new_ds

    async def import_scheme_package(
        self,
        package: DataPackage,
        conflict_strategy: str = 'skip'
    ) -> ClassificationScheme:
        """Import a ClassificationScheme package."""
        if package.metadata.package_type != ResourceType.SCHEMA:
            raise ValueError("Invalid package type")

        scheme_data = package.content["scheme"]
        source_uuid = scheme_data["entity_uuid"]

        # Check for existing import
        existing = self.session.exec(
            select(ClassificationScheme).where(
                ClassificationScheme.imported_from_uuid == source_uuid,
                ClassificationScheme.workspace_id == self.workspace_id
            )
        ).first()

        if existing and conflict_strategy == 'skip':
            return existing

        # Create new scheme
        new_scheme = ClassificationScheme(
            workspace_id=self.workspace_id,
            user_id=self.user_id,
            imported_from_uuid=source_uuid,
            name=scheme_data["name"],
            description=scheme_data.get("description"),
            model_instructions=scheme_data.get("model_instructions"),
            validation_rules=scheme_data.get("validation_rules")
        )
        self.session.add(new_scheme)
        self.session.flush()
        self._register_imported_entity("scheme", source_uuid, new_scheme)

        # Create fields
        for field_data in scheme_data.get("fields", []):
            field = ClassificationField(
                scheme_id=new_scheme.id,
                name=field_data["name"],
                description=field_data["description"],
                type=field_data["type"],
                scale_min=field_data.get("scale_min"),
                scale_max=field_data.get("scale_max"),
                is_set_of_labels=field_data.get("is_set_of_labels"),
                labels=field_data.get("labels"),
                dict_keys=field_data.get("dict_keys"),
                is_time_axis_hint=field_data.get("is_time_axis_hint")
            )
            self.session.add(field)

        # Import results if present
        if "results" in package.content:
            for result_data in package.content["results"]:
                # Look up record and job by UUID
                record_uuid = result_data["record_uuid"]
                job_uuid = result_data["job_uuid"]

                if "record" in self.uuid_map and record_uuid in self.uuid_map["record"]:
                    record_id = self.uuid_map["record"][record_uuid]["local_id"]
                    if "job" in self.uuid_map and job_uuid in self.uuid_map["job"]:
                        job_id = self.uuid_map["job"][job_uuid]["local_id"]

                        result = ClassificationResult(
                            datarecord_id=record_id,
                            scheme_id=new_scheme.id,
                            job_id=job_id,
                            value=result_data["value"],
                            timestamp=datetime.fromisoformat(result_data["timestamp"]) if result_data.get("timestamp") else None
                        )
                        self.session.add(result)

        self.session.commit()
        return new_scheme

    async def import_job_package(
        self,
        package: DataPackage,
        conflict_strategy: str = 'skip'
    ) -> ClassificationJob:
        """Import a ClassificationJob package."""
        if package.metadata.package_type != ResourceType.CLASSIFICATION_JOB:
            raise ValueError("Invalid package type")

        job_data = package.content["job"]
        source_uuid = job_data["entity_uuid"]

        # Check for existing import
        existing = self.session.exec(
            select(ClassificationJob).where(
                ClassificationJob.imported_from_uuid == source_uuid,
                ClassificationJob.workspace_id == self.workspace_id
            )
        ).first()

        if existing and conflict_strategy == 'skip':
            return existing

        # Create new job
        new_job = ClassificationJob(
            workspace_id=self.workspace_id,
            user_id=self.user_id,
            imported_from_uuid=source_uuid,
            name=job_data["name"],
            description=job_data.get("description"),
            configuration=job_data["configuration"],
            status=job_data["status"],
            error_message=job_data.get("error_message"),
            created_at=datetime.fromisoformat(job_data["created_at"]) if job_data.get("created_at") else None,
            updated_at=datetime.fromisoformat(job_data["updated_at"]) if job_data.get("updated_at") else None
        )
        self.session.add(new_job)
        self.session.flush()
        self._register_imported_entity("job", source_uuid, new_job)

        # Link schemes and datasources if they exist in the UUID map
        for scheme_ref in job_data.get("target_schemes", []):
            scheme_uuid = scheme_ref["entity_uuid"]
            if "scheme" in self.uuid_map and scheme_uuid in self.uuid_map["scheme"]:
                scheme_id = self.uuid_map["scheme"][scheme_uuid]["local_id"]
                scheme = self.session.get(ClassificationScheme, scheme_id)
                if scheme:
                    new_job.target_schemes.append(scheme)

        for ds_ref in job_data.get("target_datasources", []):
            ds_uuid = ds_ref["entity_uuid"]
            if "datasource" in self.uuid_map and ds_uuid in self.uuid_map["datasource"]:
                ds_id = self.uuid_map["datasource"][ds_uuid]["local_id"]
                datasource = self.session.get(DataSource, ds_id)
                if datasource:
                    new_job.target_datasources.append(datasource)

        # Import results if present
        if "results" in package.content:
            for result_data in package.content["results"]:
                # Look up record and scheme by UUID
                record_uuid = result_data["record_uuid"]
                scheme_uuid = result_data["scheme_uuid"]

                if "record" in self.uuid_map and record_uuid in self.uuid_map["record"]:
                    record_id = self.uuid_map["record"][record_uuid]["local_id"]
                    if "scheme" in self.uuid_map and scheme_uuid in self.uuid_map["scheme"]:
                        scheme_id = self.uuid_map["scheme"][scheme_uuid]["local_id"]

                        result = ClassificationResult(
                            datarecord_id=record_id,
                            scheme_id=scheme_id,
                            job_id=new_job.id,
                            value=result_data["value"],
                            timestamp=datetime.fromisoformat(result_data["timestamp"]) if result_data.get("timestamp") else None
                        )
                        self.session.add(result)

        self.session.commit()
        return new_job

    async def import_dataset_package(
        self,
        package: DataPackage,
        conflict_strategy: str = 'skip'
    ) -> Dataset:
        """Import a Dataset package."""
        if package.metadata.package_type != ResourceType.DATASET:
            raise ValueError("Invalid package type")

        ds_data = package.content["dataset"]
        source_uuid = ds_data["entity_uuid"]

        # Check for existing import
        existing = self.session.exec(
            select(Dataset).where(
                Dataset.imported_from_uuid == source_uuid,
                Dataset.workspace_id == self.workspace_id
            )
        ).first()

        if existing and conflict_strategy == 'skip':
            return existing

        # Create new dataset
        new_dataset = Dataset(
            workspace_id=self.workspace_id,
            user_id=self.user_id,
            imported_from_uuid=source_uuid,
            name=ds_data["name"],
            description=ds_data.get("description"),
            custom_metadata=ds_data.get("custom_metadata", {}),
            created_at=datetime.fromisoformat(ds_data["created_at"]) if ds_data.get("created_at") else None,
            updated_at=datetime.fromisoformat(ds_data["updated_at"]) if ds_data.get("updated_at") else None
        )
        self.session.add(new_dataset)
        self.session.flush()
        self._register_imported_entity("dataset", source_uuid, new_dataset)

        # Import records
        record_id_map = {}
        for record_data in package.content.get("records", []):
            record_uuid = record_data["entity_uuid"]
            # Check if record already exists
            if "record" in self.uuid_map and record_uuid in self.uuid_map["record"]:
                record_id_map[record_uuid] = self.uuid_map["record"][record_uuid]["local_id"]
                continue

            # Create new record
            new_record = DataRecord(
                imported_from_uuid=record_uuid,
                text_content=record_data.get("text_content", ""),
                source_metadata=record_data["source_metadata"],
                event_timestamp=datetime.fromisoformat(record_data["event_timestamp"]) if record_data.get("event_timestamp") else None,
                url_hash=record_data.get("url_hash"),
                content_hash=record_data.get("content_hash")
            )
            self.session.add(new_record)
            self.session.flush()
            self._register_imported_entity("record", record_uuid, new_record)
            record_id_map[record_uuid] = new_record.id

            # Import results if present
            if "results" in record_data:
                for result_data in record_data["results"]:
                    scheme_uuid = result_data["scheme_uuid"]
                    job_uuid = result_data["job_uuid"]

                    if "scheme" in self.uuid_map and scheme_uuid in self.uuid_map["scheme"]:
                        scheme_id = self.uuid_map["scheme"][scheme_uuid]["local_id"]
                        if "job" in self.uuid_map and job_uuid in self.uuid_map["job"]:
                            job_id = self.uuid_map["job"][job_uuid]["local_id"]

                            result = ClassificationResult(
                                datarecord_id=new_record.id,
                                scheme_id=scheme_id,
                                job_id=job_id,
                                value=result_data["value"],
                                timestamp=datetime.fromisoformat(result_data["timestamp"]) if result_data.get("timestamp") else None
                            )
                            self.session.add(result)

        # Import source jobs
        job_id_map = {}
        for job_data in package.content.get("source_jobs", []):
            job_uuid = job_data["entity_uuid"]
            if "job" in self.uuid_map and job_uuid in self.uuid_map["job"]:
                job_id_map[job_uuid] = self.uuid_map["job"][job_uuid]["local_id"]
                continue

            # Create new job
            new_job = ClassificationJob(
                workspace_id=self.workspace_id,
                user_id=self.user_id,
                imported_from_uuid=job_uuid,
                name=job_data["name"],
                description=job_data.get("description"),
                configuration=job_data["configuration"],
                status=job_data["status"],
                created_at=datetime.fromisoformat(job_data["created_at"]) if job_data.get("created_at") else None
            )
            self.session.add(new_job)
            self.session.flush()
            self._register_imported_entity("job", job_uuid, new_job)
            job_id_map[job_uuid] = new_job.id

        # Import source schemes
        scheme_id_map = {}
        for scheme_data in package.content.get("source_schemes", []):
            scheme_uuid = scheme_data["entity_uuid"]
            if "scheme" in self.uuid_map and scheme_uuid in self.uuid_map["scheme"]:
                scheme_id_map[scheme_uuid] = self.uuid_map["scheme"][scheme_uuid]["local_id"]
                continue

            # Create new scheme
            new_scheme = ClassificationScheme(
                workspace_id=self.workspace_id,
                user_id=self.user_id,
                imported_from_uuid=scheme_uuid,
                name=scheme_data["name"],
                description=scheme_data.get("description"),
                model_instructions=scheme_data.get("model_instructions"),
                validation_rules=scheme_data.get("validation_rules")
            )
            self.session.add(new_scheme)
            self.session.flush()
            self._register_imported_entity("scheme", scheme_uuid, new_scheme)
            scheme_id_map[scheme_uuid] = new_scheme.id

            # Create fields
            for field_data in scheme_data.get("fields", []):
                field = ClassificationField(
                    scheme_id=new_scheme.id,
                    name=field_data["name"],
                    description=field_data["description"],
                    type=field_data["type"],
                    scale_min=field_data.get("scale_min"),
                    scale_max=field_data.get("scale_max"),
                    is_set_of_labels=field_data.get("is_set_of_labels"),
                    labels=field_data.get("labels"),
                    dict_keys=field_data.get("dict_keys"),
                    is_time_axis_hint=field_data.get("is_time_axis_hint")
                )
                self.session.add(field)

        # Update dataset with mapped IDs
        new_dataset.source_scheme_ids = list(scheme_id_map.values())
        new_dataset.source_job_ids = list(job_id_map.values())
        new_dataset.datarecord_ids = list(record_id_map.values())

        self.session.commit()
        return new_dataset 