"""
Service for classification operations.

This module contains the business logic for all classification-related operations,
including managing classification jobs, schemes, and results.
"""
import logging.config
import logging
import json # Added for import
import uuid # Added for export
from typing import Any, Dict, List, Optional, Type, Union, Tuple, Set
from datetime import datetime, timezone
from enum import Enum

from sqlmodel import Session, select, func
from sqlalchemy.orm import selectinload 
from pydantic import BaseModel, Field, create_model
from fastapi import HTTPException # 

# Import ClassificationProvider base type
from app.api.services.providers.base import ClassificationProvider

from app.models import (
    ClassificationScheme,
    ClassificationJob,
    ClassificationJobCreate,
    ClassificationJobStatus,
    ClassificationResult,
    ClassificationResultCreate,
    DataRecord,
    DataSource,
    User,
    Workspace,
    ClassificationField,
    FieldType,
    EnhancedClassificationResultRead,
    ClassificationSchemeUpdate,
    ClassificationSchemeCreate,
    ClassificationResultRead,
    ClassificationJobUpdate,
    ClassificationJobRead,
    ClassificationSchemeRead
)
# Removed direct provider import, use dependency injection
# from app.api.services.providers import ClassificationProvider, get_classification_provider
from app.api.services.service_utils import validate_workspace_access
# Removed Celery app import, tasks will handle their own logic
# from app.core.celery_app import celery # Import celery app instance

# Configure logging
logging.config.dictConfig({
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'detailed': {
            'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s - [%(filename)s:%(lineno)d]'
        }
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'detailed',
            'level': 'DEBUG'
        },
        'file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': 'classification_service.log',
            'maxBytes': 10485760,  # 10MB
            'backupCount': 5,
            'formatter': 'detailed',
            'level': 'INFO'
        }
    },
    'loggers': {
        'classification_service': {
            'handlers': ['console', 'file'],
            'level': 'DEBUG',
            'propagate': False
        }
    }
})

logger = logging.getLogger('classification_service')

# Add logging decorator for method entry/exit
from functools import wraps
from time import time
from typing import Callable

def log_method(func: Callable) -> Callable:
    """Decorator to log method entry, exit, and execution time."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        method_name = func.__name__
        logger.debug(f"Entering {method_name}")
        start_time = time()
        try:
            result = func(*args, **kwargs)
            execution_time = time() - start_time
            logger.debug(f"Exiting {method_name} - Execution time: {execution_time:.2f}s")
            return result
        except Exception as e:
            execution_time = time() - start_time
            logger.error(
                f"Error in {method_name} - Execution time: {execution_time:.2f}s - Error: {str(e)}",
                exc_info=True
            )
            raise
    return wrapper

# --- Custom Exceptions ---

class ClassificationError(Exception):
    """Base exception for classification service errors."""
    pass

class JobNotFoundError(ClassificationError):
    """Raised when a job cannot be found."""
    pass

class SchemeNotFoundError(ClassificationError):
    """Raised when a scheme cannot be found."""
    pass

class ResultNotFoundError(ClassificationError):
    """Raised when a result cannot be found."""
    pass

class InvalidStatusTransitionError(ClassificationError):
    """Raised when attempting an invalid job status transition."""
    pass

class JobCancellationError(ClassificationError):
    """Raised when job cancellation fails."""
    pass

class ValidationError(ClassificationError):
    """Raised when validation fails."""
    pass

class BulkOperationError(ClassificationError):
    """Raised when a bulk operation partially fails."""
    def __init__(self, message: str, successful_ids: List[int], failed_ids: Dict[int, str]):
        self.message = message
        self.successful_ids = successful_ids
        self.failed_ids = failed_ids
        super().__init__(message)

class JobPauseError(ClassificationError):
    """Raised when job pause operation fails."""
    pass

class JobResumeError(ClassificationError):
    """Raised when job resume operation fails."""
    pass

# --- Status Transition Validation ---

class StatusTransition:
    """Defines valid job status transitions."""
    VALID_TRANSITIONS = {
        ClassificationJobStatus.PENDING: {
            ClassificationJobStatus.RUNNING,
            ClassificationJobStatus.FAILED,
            ClassificationJobStatus.PAUSED  # Add PAUSED as valid transition
        },
        ClassificationJobStatus.RUNNING: {
            ClassificationJobStatus.COMPLETED,
            ClassificationJobStatus.COMPLETED_WITH_ERRORS,
            ClassificationJobStatus.FAILED,
            ClassificationJobStatus.PAUSED  # Add PAUSED as valid transition
        },
        ClassificationJobStatus.PAUSED: {  # Add PAUSED state transitions
            ClassificationJobStatus.RUNNING,  # Can resume
            ClassificationJobStatus.FAILED    # Can fail from paused
        },
        ClassificationJobStatus.COMPLETED: set(),  # Terminal state
        ClassificationJobStatus.COMPLETED_WITH_ERRORS: set(),  # Terminal state
        ClassificationJobStatus.FAILED: {ClassificationJobStatus.PENDING}  # Can retry failed jobs
    }

    @classmethod
    def validate(cls, current_status: ClassificationJobStatus, new_status: ClassificationJobStatus) -> bool:
        """
        Validate if a status transition is allowed.
        
        Args:
            current_status: The current job status
            new_status: The desired new status
            
        Returns:
            bool: True if transition is valid
            
        Raises:
            InvalidStatusTransitionError: If transition is not allowed
        """
        if new_status not in cls.VALID_TRANSITIONS.get(current_status, set()):
            raise InvalidStatusTransitionError(
                f"Cannot transition from {current_status} to {new_status}"
            )
        return True

# --- Core Logic Functions (for use by Service and Tasks) ---

def _core_create_job(
    session: Session,
    workspace_id: int,
    user_id: int,
    job_data: ClassificationJobCreate
) -> ClassificationJob:
    """Core logic to create a classification job."""
    # Use the utility function for validation
    workspace = validate_workspace_access(session, workspace_id, user_id)

    # Get configuration data
    config = job_data.configuration or {}
    datasource_ids = config.get('datasource_ids', [])
    scheme_ids = config.get('scheme_ids', [])

    # Validate required configuration
    if not datasource_ids:
        raise ValueError("Configuration must include 'datasource_ids' list")
    if not scheme_ids:
        raise ValueError("Configuration must include 'scheme_ids' list")

    # Fetch and validate datasources
    datasources = session.exec(
        select(DataSource).where(
            DataSource.id.in_(datasource_ids),
            DataSource.workspace_id == workspace_id
        )
    ).all()

    if len(datasources) != len(datasource_ids):
        raise ValueError("One or more datasources not found in workspace")

    # Fetch and validate schemes
    schemes = session.exec(
        select(ClassificationScheme).where(
            ClassificationScheme.id.in_(scheme_ids),
            ClassificationScheme.workspace_id == workspace_id
        )
    ).all()

    if len(schemes) != len(scheme_ids):
        raise ValueError("One or more classification schemes not found in workspace")

    # Create job
    job = ClassificationJob(
        name=job_data.name,
        description=job_data.description,
        configuration=job_data.configuration,
        workspace_id=workspace_id,
        user_id=user_id,
        status=ClassificationJobStatus.PENDING, # Start as pending
        target_datasources=datasources,
        target_schemes=schemes
    )

    session.add(job)
    session.flush() # Ensure ID is available before returning
    session.refresh(job) # Load relationships
    logger.info(f"Core: Created classification job {job.id} for workspace {workspace_id}")
    return job

def _core_update_job_status(
    session: Session,
    job_id: int,
    status: ClassificationJobStatus,
    error_message: Optional[str] = None
) -> ClassificationJob:
    """Core logic to update job status."""
    job = session.get(ClassificationJob, job_id)
    if not job:
        logger.error(f"Core: Classification job {job_id} not found during status update.")
        raise ValueError(f"Classification job {job_id} not found")

    job.status = status
    job.error_message = error_message
    job.updated_at = datetime.now(timezone.utc)

    session.add(job)
    session.flush()
    session.refresh(job)
    logger.info(f"Core: Updated classification job {job_id} status to {status}")
    return job

def _core_classify_text(
    session: Session,
    provider: ClassificationProvider, # Pass provider instance
    text: str,
    scheme_id: int,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """Core logic to classify text using a scheme."""
    if not text:
        logger.warning(f"Core: Empty text provided for classification with scheme {scheme_id}")
        return {}

    # Get the classification scheme with fields
    scheme = session.get(ClassificationScheme, scheme_id, options=[selectinload(ClassificationScheme.fields)])
    if not scheme:
        raise ValueError(f"Classification scheme {scheme_id} not found")

    try:
        # Prepare model specification - pass the scheme object directly
        model_spec = scheme
        # Call the provider (use the instance passed)
        result = provider.classify(
            text=text,
            model_spec=model_spec,
            instructions=scheme.model_instructions # Pass instructions separately
        )
        return result

    except Exception as e:
        logger.error(f"Core: Classification failed for scheme {scheme_id}: {str(e)}", exc_info=True)
        raise ValueError(f"Classification failed: {str(e)}")


def _core_create_results_batch(
    session: Session,
    results_data: List[Dict[str, Any]]
) -> int:
    """Core logic to create classification results in batch."""
    if not results_data:
        return 0

    job_id = results_data[0].get('job_id')
    if not job_id:
        raise ValueError("results_data items must include job_id")

    record_ids = list({r.get('datarecord_id') for r in results_data if r.get('datarecord_id')})
    scheme_ids = list({r.get('scheme_id') for r in results_data if r.get('scheme_id')})

    # Check for existing results
    existing_keys = set()
    if record_ids and scheme_ids:
        existing_stmt = select(
            ClassificationResult.datarecord_id,
            ClassificationResult.scheme_id
        ).where(
            ClassificationResult.job_id == job_id,
            ClassificationResult.datarecord_id.in_(record_ids),
            ClassificationResult.scheme_id.in_(scheme_ids)
        )
        existing_results = session.exec(existing_stmt).all()
        existing_keys = {(res[0], res[1]) for res in existing_results}

    results_to_create = []
    for data in results_data:
        record_id = data.get('datarecord_id')
        scheme_id = data.get('scheme_id')
        if not record_id or not scheme_id:
            continue

        key = (record_id, scheme_id)
        if key not in existing_keys:
            try:
                result = ClassificationResult.model_validate(data)
                results_to_create.append(result)
            except Exception as validation_error:
                logger.error(f"Core: ClassificationResult validation failed for data {data}: {validation_error}", exc_info=True)
                raise ValueError(f"ClassificationResult validation failed: {validation_error}") from validation_error

    if not results_to_create:
        logger.info(f"Core: No new results to create in batch for job {job_id}")
        return 0

    try:
        session.add_all(results_to_create)
        session.flush() # Flush changes to session
        logger.debug(f"Core: Prepared batch of {len(results_to_create)} results for job {job_id}")
        return len(results_to_create)
    except Exception as e:
        logger.error(f"Core: Error adding batch of results for job {job_id}: {e}", exc_info=True)
        raise # Re-raise the exception for the caller (service method or task) to handle

# --- ClassificationService Class ---

class ClassificationService:
    """
    Service for handling classification operations.
    """

    def __init__(
        self,
        session: Session, 
        classification_provider: ClassificationProvider # Use base ClassificationProvider type
    ):
        """
        Initialize the classification service with dependencies injected.
        """
        self.session = session
        self.provider = classification_provider

    @log_method
    def create_job(
        self,
        workspace_id: int,
        user_id: int,
        job_data: ClassificationJobCreate
    ) -> ClassificationJob:
        """
        Create a new classification job.
        MODIFIES DATA - Commits transaction.
        """
        logger.info(
            "Creating job in workspace %d for user %d - Name: %s",
            workspace_id, user_id, job_data.name
        )
        try:
            validate_workspace_access(self.session, workspace_id, user_id)
            
            # Validate configuration
            config = job_data.configuration
            self.validate_job_configuration(config)
            logger.debug("Job configuration validated successfully")

            # Create job
            job = ClassificationJob(
                workspace_id=workspace_id,
                user_id=user_id,
                status=ClassificationJobStatus.PENDING,
                **job_data.model_dump()
            )
            self.session.add(job)
            self.session.commit()
            self.session.refresh(job)
            logger.info("Created job %d successfully", job.id)

            # Queue the job
            try:
                self.queue_classification_job(job.id)
                logger.info("Job %d queued successfully", job.id)
            except Exception as e:
                logger.error("Failed to queue job %d: %s", job.id, str(e))
                self.update_job_status(
                    job_id=job.id,
                    status=ClassificationJobStatus.FAILED,
                    error_message=f"Failed to queue job: {e}"
                )
                raise

            return job

        except Exception as e:
            self.session.rollback()
            logger.error(
                "Failed to create job in workspace %d: %s",
                workspace_id, str(e), exc_info=True
            )
            raise ValueError(f"Failed to create classification job: {str(e)}")

    @log_method
    def queue_classification_job(self, job_id: int) -> None:
        """
        Queue a classification job for processing.
        This method triggers the background task for processing the job.
        
        Args:
            job_id: The ID of the job to queue
            
        Raises:
            ValueError: If the job cannot be queued
        """
        logger.info("Attempting to queue job %d", job_id)
        try:
            from app.api.tasks.classification import process_classification_job
            process_classification_job.delay(job_id)
            logger.info("Successfully queued job %d", job_id)
        except Exception as e:
            logger.error("Failed to queue job %d: %s", job_id, str(e), exc_info=True)
            raise ValueError(f"Failed to queue job: {str(e)}")

    @log_method
    def get_job(
        self,
        job_id: int,
        user_id: Optional[int] = None
    ) -> Optional[ClassificationJob]:
        """
        Get a classification job by ID.
        READ-ONLY - Does not commit.
        """
        logger.debug("Fetching job %d for user %s", job_id, user_id or "None")
        job = self.session.get(ClassificationJob, job_id)
        if not job:
            logger.warning("Job %d not found", job_id)
            return None

        if user_id:
            try:
                validate_workspace_access(self.session, job.workspace_id, user_id)
                logger.debug("Access validated for job %d", job_id)
            except HTTPException:
                logger.warning(
                    "Access denied for job %d to user %d",
                    job_id, user_id
                )
                return None

        return job

    def classify_text(
        self,
        text: str,
        scheme_id: int,
        api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Classify text using a scheme.
        READ-ONLY - Does not commit.
        """
        scheme = self.session.get(ClassificationScheme, scheme_id)
        if not scheme:
            raise ValueError(f"Classification scheme {scheme_id} not found")

        try:
            model_spec = scheme.model_dump()
            if api_key:
                model_spec["api_key"] = api_key

            return self.provider.classify(text, model_spec, scheme.model_instructions)
        except Exception as e:
            raise ValueError(f"Classification failed: {str(e)}")

    def create_result(
        self,
        job_id: int,
        datarecord_id: int,
        scheme_id: int,
        value: Dict[str, Any]
    ) -> ClassificationResult:
        """
        Create a classification result.
        MODIFIES DATA - Commits transaction.
        """
        try:
            # Check for existing result
            existing = self.session.exec(
                select(ClassificationResult).where(
                    ClassificationResult.job_id == job_id,
                    ClassificationResult.datarecord_id == datarecord_id,
                    ClassificationResult.scheme_id == scheme_id
                )
            ).first()

            if existing:
                raise ValueError("Classification result already exists")

            result = ClassificationResult(
                job_id=job_id,
                datarecord_id=datarecord_id,
                scheme_id=scheme_id,
                value=value,
                timestamp=datetime.now(timezone.utc)
            )
            self.session.add(result)
            self.session.commit()
            self.session.refresh(result)
            return result

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to create classification result: {str(e)}")

    def create_results_batch(
        self,
        results_data: List[Dict[str, Any]]
    ) -> int:
        """
        Create multiple classification results in a batch.
        MODIFIES DATA - Commits transaction.
        """
        try:
            created_count = 0
            for data in results_data:
                try:
                    result = ClassificationResult(**data)
                    self.session.add(result)
                    created_count += 1
                except Exception as e:
                    logger.warning(f"Failed to create result: {e}")

            self.session.commit()
            return created_count

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to create results batch: {str(e)}")

    def update_job_status(
        self,
        job_id: int,
        status: ClassificationJobStatus,
        error_message: Optional[str] = None
    ) -> ClassificationJob:
        """
        Update a job's status.
        MODIFIES DATA - Commits transaction.
        
        Args:
            job_id: The ID of the job to update
            status: The new status
            error_message: Optional error message for failed states
            
        Returns:
            The updated job
            
        Raises:
            JobNotFoundError: If job not found
            InvalidStatusTransitionError: If status transition is invalid
        """
        try:
            job = self.session.get(ClassificationJob, job_id)
            if not job:
                raise JobNotFoundError(f"Classification job {job_id} not found")

            # Validate status transition
            StatusTransition.validate(job.status, status)

            # Update status and error message
            job.status = status
            if error_message is not None:
                job.error_message = error_message
            job.updated_at = datetime.now(timezone.utc)

            self.session.add(job)
            self.session.commit()
            self.session.refresh(job)
            return job

        except (JobNotFoundError, InvalidStatusTransitionError) as e:
            self.session.rollback()
            raise e
        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to update job status: {str(e)}")

    # --- Scheme Methods ---

    def _validate_scheme_field(self, field_data: ClassificationField):
        """Validate a single ClassificationField definition."""
        if field_data.type == FieldType.INT:
            if field_data.scale_min is None or field_data.scale_max is None:
                raise ValueError(f"Field '{field_data.name}': scale_min/max required for INT type")
            if field_data.scale_min >= field_data.scale_max:
                raise ValueError(f"Field '{field_data.name}': scale_min must be less than scale_max")
        elif field_data.type == FieldType.LIST_STR and field_data.is_set_of_labels:
            if not field_data.labels or len(field_data.labels) < 2:
                raise ValueError(f"Field '{field_data.name}': At least 2 labels required")
        elif field_data.type == FieldType.LIST_DICT:
            if not field_data.dict_keys or len(field_data.dict_keys) < 1:
                 raise ValueError(f"Field '{field_data.name}': dict_keys required for LIST_DICT")
            valid_types = {'str', 'int', 'float', 'bool'}
            for key_def in field_data.dict_keys:
                if key_def.type not in valid_types:
                     raise ValueError(f"Field '{field_data.name}': Invalid key type '{key_def.type}'")

    def create_scheme(
        self,
        user_id: int,
        workspace_id: int,
        scheme_data: ClassificationSchemeCreate
    ) -> ClassificationScheme:
        """
        Create a new classification scheme.
        MODIFIES DATA - Commits transaction.
        """
        try:
            validate_workspace_access(self.session, workspace_id, user_id)

            # Create scheme
            scheme = ClassificationScheme(
                workspace_id=workspace_id,
                user_id=user_id,
                **scheme_data.model_dump(exclude={"fields"})
            )
            self.session.add(scheme)
            self.session.flush()  # Get scheme ID for fields

            # Create fields
            for field_data in scheme_data.fields:
                field = ClassificationField(
                    scheme_id=scheme.id,
                    **field_data.model_dump()
                )
                self.session.add(field)

            self.session.commit()
            self.session.refresh(scheme)
            return scheme

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to create classification scheme: {str(e)}")

    def list_schemes(
        self,
        user_id: int,
        workspace_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[ClassificationSchemeRead]:
        """
        List classification schemes in a workspace.
        READ-ONLY - Does not commit.
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        statement = select(ClassificationScheme).where(
            ClassificationScheme.workspace_id == workspace_id
        ).offset(skip).limit(limit)

        schemes = self.session.exec(statement).all()
        return [ClassificationSchemeRead.model_validate(s) for s in schemes]

    def get_scheme(
        self,
        scheme_id: int,
        user_id: int,
        workspace_id: int
    ) -> Optional[ClassificationSchemeRead]:
        """
        Get a classification scheme by ID.
        READ-ONLY - Does not commit.
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        scheme = self.session.get(ClassificationScheme, scheme_id)
        if not scheme or scheme.workspace_id != workspace_id:
            return None

        return ClassificationSchemeRead.model_validate(scheme)

    def update_scheme(
        self,
        scheme_id: int,
        user_id: int,
        workspace_id: int,
        update_data: ClassificationSchemeUpdate
    ) -> Optional[ClassificationSchemeRead]:
        """
        Update a classification scheme.
        MODIFIES DATA - Commits transaction.
        """
        try:
            validate_workspace_access(self.session, workspace_id, user_id)

            scheme = self.session.get(ClassificationScheme, scheme_id)
            if not scheme or scheme.workspace_id != workspace_id:
                return None

            # Update fields
            update_dict = update_data.model_dump(exclude_unset=True)
            for key, value in update_dict.items():
                setattr(scheme, key, value)

            self.session.add(scheme)
            self.session.commit()
            self.session.refresh(scheme)
            return ClassificationSchemeRead.model_validate(scheme)

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to update classification scheme: {str(e)}")

    def delete_scheme(
        self,
        scheme_id: int,
        user_id: int,
        workspace_id: int
    ) -> bool:
        """
        Delete a classification scheme.
        MODIFIES DATA - Commits transaction.
        """
        try:
            validate_workspace_access(self.session, workspace_id, user_id)

            scheme = self.session.get(ClassificationScheme, scheme_id)
            if not scheme or scheme.workspace_id != workspace_id:
                return False

            self.session.delete(scheme)
            self.session.commit()
            return True

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to delete classification scheme: {str(e)}")

    def delete_all_schemes_in_workspace(
        self,
        user_id: int,
        workspace_id: int
    ) -> int:
        """Delete all schemes in a workspace."""
        workspace = validate_workspace_access(self.session, workspace_id, user_id)

        statement = select(ClassificationScheme).where(ClassificationScheme.workspace_id == workspace_id)
        schemes_to_delete = self.session.exec(statement).all()
        count = len(schemes_to_delete)

        if count > 0:
            for scheme in schemes_to_delete:
                self.session.delete(scheme)
            self.session.flush() # Flush deletions
            logger.info(f"Deleted {count} schemes from workspace {workspace_id}")

        return count

    # --- Job Methods ---

    def get_job_details(
        self,
        job_id: int,
        user_id: int,
        workspace_id: int,
        include_counts: bool = True
    ) -> Optional[ClassificationJobRead]:
        """
        Get detailed job information including optional counts.
        READ-ONLY - Does not commit.
        """
        job = self.get_job(job_id, user_id)
        if not job or job.workspace_id != workspace_id:
            return None

        job_data = ClassificationJobRead.model_validate(job)
        
        if include_counts:
            # Add result count
            result_count = self.session.exec(
                select(func.count(ClassificationResult.id)).where(
                    ClassificationResult.job_id == job_id
                )
            ).one()
            job_data.result_count = result_count

            # Add total records targeted
            config = job.configuration or {}
            datasource_ids = config.get('datasource_ids', [])
            if datasource_ids:
                from app.models import DataRecord
                record_count = self.session.exec(
                    select(func.count(DataRecord.id)).where(
                        DataRecord.datasource_id.in_(datasource_ids)
                    )
                ).one()
                job_data.datarecord_count = record_count

        return job_data

    def list_jobs(
        self,
        user_id: int,
        workspace_id: int,
        skip: int = 0,
        limit: int = 100,
        include_counts: bool = True
    ) -> Tuple[List[ClassificationJobRead], int]:
        """
        List classification jobs with optional counts.
        READ-ONLY - Does not commit.
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        # Get total count
        count_stmt = select(func.count(ClassificationJob.id)).where(
            ClassificationJob.workspace_id == workspace_id
        )
        total_count = self.session.exec(count_stmt).one()

        # Get jobs
        stmt = select(ClassificationJob).where(
            ClassificationJob.workspace_id == workspace_id
        ).offset(skip).limit(limit)
        jobs = self.session.exec(stmt).all()

        # Convert to read models with counts if requested
        job_reads = []
        for job in jobs:
            job_read = self.get_job_details(
                job_id=job.id,
                user_id=user_id,
                workspace_id=workspace_id,
                include_counts=include_counts
            )
            if job_read:
                job_reads.append(job_read)

        return job_reads, total_count

    def update_job(
        self,
        job_id: int,
        user_id: int,
        workspace_id: int,
        update_data: ClassificationJobUpdate
    ) -> Optional[ClassificationJobRead]:
        """
        Update a classification job.
        MODIFIES DATA - Commits transaction.
        """
        job = self.get_job(job_id, user_id)
        if not job or job.workspace_id != workspace_id:
            return None

        try:
            update_dict = update_data.model_dump(exclude_unset=True)
            for key, value in update_dict.items():
                setattr(job, key, value)

            self.session.add(job)
            self.session.commit()
            self.session.refresh(job)

            return self.get_job_details(job_id, user_id, workspace_id)
        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to update job: {str(e)}")

    def delete_job(
        self,
        job_id: int,
        user_id: int,
        workspace_id: int
    ) -> bool:
        """
        Delete a classification job and its results.
        MODIFIES DATA - Commits transaction.
        """
        job = self.get_job(job_id, user_id)
        if not job or job.workspace_id != workspace_id:
            return False

        try:
            # Delete associated results first
            self.session.exec(
                select(ClassificationResult).where(
                    ClassificationResult.job_id == job_id
                )
            ).delete()
            
            # Delete the job
            self.session.delete(job)
            self.session.commit()
            return True
        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to delete job: {str(e)}")

    # --- Result Methods ---

    def get_result(
        self,
        result_id: int,
        user_id: int,
        workspace_id: int
    ) -> Optional[ClassificationResultRead]:
        """
        Get a specific classification result.
        READ-ONLY - Does not commit.
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        result = self.session.get(ClassificationResult, result_id)
        if not result:
            return None

        # Verify result belongs to a job in the workspace
        job = self.get_job(result.job_id)
        if not job or job.workspace_id != workspace_id:
            return None

        return ClassificationResultRead.model_validate(result)

    def list_results(
        self,
        user_id: int,
        workspace_id: int,
        job_id: Optional[int] = None,
        datarecord_ids: Optional[List[int]] = None,
        scheme_ids: Optional[List[int]] = None,
        skip: int = 0,
        limit: int = 100
    ) -> List[EnhancedClassificationResultRead]:
        """
        List classification results with filters.
        READ-ONLY - Does not commit.
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        # Build query
        stmt = select(ClassificationResult)
        
        if job_id:
            stmt = stmt.where(ClassificationResult.job_id == job_id)
        if datarecord_ids:
            stmt = stmt.where(ClassificationResult.datarecord_id.in_(datarecord_ids))
        if scheme_ids:
            stmt = stmt.where(ClassificationResult.scheme_id.in_(scheme_ids))

        # Add workspace filter via job relationship
        stmt = stmt.join(ClassificationJob).where(
            ClassificationJob.workspace_id == workspace_id
        )

        # Add pagination
        stmt = stmt.offset(skip).limit(limit)

        # Execute query
        results = self.session.exec(stmt).all()

        # Convert to enhanced read models
        enhanced_results = []
        for result in results:
            # Get scheme for display value calculation
            scheme = self.session.get(ClassificationScheme, result.scheme_id)
            if not scheme:
                continue

            enhanced = EnhancedClassificationResultRead(
                **result.model_dump(),
                scheme_fields=scheme.fields
            )
            enhanced_results.append(enhanced)

        return enhanced_results

    # --- Export/Import Methods ---

    def export_scheme(
        self,
        scheme_id: int,
        user_id: int,
        include_results: bool = False # Results generally not included
    ) -> Dict[str, Any]:
        """
        Export a classification scheme.
        """
        # get_scheme uses self.session and handles validation internally
        scheme_read = self.get_scheme(scheme_id=scheme_id, user_id=user_id, workspace_id=-1) # Pass dummy workspace_id initially
        if not scheme_read:
            # If get_scheme returns None, it means not found or access denied
            raise ValueError(f"Scheme {scheme_id} not found or access denied")

        # Check actual workspace access after getting the scheme
        try:
            validate_workspace_access(self.session, scheme_read.workspace_id, user_id)
        except HTTPException:
            raise ValueError(f"Access denied to scheme {scheme_id}")

        export_data = {
            "meta": {
                "export_type": "scheme",
                "export_version": "1.0",
                "export_date": datetime.now(timezone.utc).isoformat(),
                "export_id": str(uuid.uuid4()),
                "original_id": scheme_read.id
            },
            "scheme": {
                "name": scheme_read.name,
                "description": scheme_read.description,
                "model_instructions": scheme_read.model_instructions,
                "validation_rules": scheme_read.validation_rules,
                "fields": [f.model_dump() for f in scheme_read.fields]
            }
        }

        if include_results:
             logger.warning("Exporting results with schemes is not fully implemented.")

        return export_data

    def import_scheme(
        self,
        user_id: int,
        workspace_id: int,
        import_data: Dict[str, Any]
    ) -> ClassificationScheme:
        """
        Import a classification scheme into a workspace.
        """
        meta = import_data.get("meta", {})
        if meta.get("export_type") != "scheme":
            raise ValueError("Import file is not a scheme export")

        scheme_data = import_data.get("scheme")
        if not scheme_data:
            raise ValueError("Scheme data missing in import file")

        workspace = validate_workspace_access(self.session, workspace_id, user_id)

        # Prepare scheme creation data
        scheme_create_data = ClassificationSchemeCreate(
            name=f"{scheme_data.get('name', 'Imported Scheme')} (Imported)",
            description=scheme_data.get("description"),
            model_instructions=scheme_data.get("model_instructions"),
            validation_rules=scheme_data.get("validation_rules"),
            fields=scheme_data.get("fields", [])
        )

        # Use the existing create_scheme method
        new_scheme = self.create_scheme(user_id=user_id, workspace_id=workspace_id, scheme_data=scheme_create_data)
        logger.info(f"Imported Scheme '{new_scheme.name}' ({new_scheme.id}) into workspace {workspace_id}")
        return new_scheme

    def export_job(
        self,
        job_id: int,
        user_id: int,
        include_results: bool = True
    ) -> Dict[str, Any]:
        """
        Export a classification job, optionally including results.
        """
        # get_job uses self.session and validates access
        job = self.get_job(job_id=job_id, user_id=user_id)
        if not job:
            raise ValueError(f"Job {job_id} not found or access denied")

        export_data = {
            "meta": {
                "export_type": "job",
                "export_version": "1.0",
                "export_date": datetime.now(timezone.utc).isoformat(),
                "export_id": str(uuid.uuid4()),
                "original_id": job.id
            },
            "job": {
                "name": job.name,
                "description": job.description,
                "configuration": job.configuration,
                "status": job.status.value,
                "error_message": job.error_message
            }
        }

        if include_results:
            results = self.session.exec(
                select(ClassificationResult).where(ClassificationResult.job_id == job_id)
            ).all()
            export_data["results"] = [
                {
                    "datarecord_id": r.datarecord_id,
                    "scheme_id": r.scheme_id,
                    "value": r.value,
                    "timestamp": r.timestamp.isoformat() if r.timestamp else None
                }
                for r in results
            ]

        return export_data

    def import_job(
        self,
        user_id: int,
        workspace_id: int,
        import_data: Dict[str, Any],
        original_id_map: Dict[str, Dict[int, int]]
    ) -> ClassificationJob:
        """
        Import a classification job into a workspace.
        """
        meta = import_data.get("meta", {})
        if meta.get("export_type") != "job":
            raise ValueError("Import file is not a job export")

        job_data = import_data.get("job")
        if not job_data:
            raise ValueError("Job data missing in import file")

        workspace = validate_workspace_access(self.session, workspace_id, user_id)

        # Map original IDs in configuration
        config = job_data.get("configuration", {})
        original_ds_ids = config.get("datasource_ids", [])
        original_scheme_ids = config.get("scheme_ids", [])

        new_ds_ids = [original_id_map.get("datasource", {}).get(orig_id) for orig_id in original_ds_ids]
        new_scheme_ids = [original_id_map.get("scheme", {}).get(orig_id) for orig_id in original_scheme_ids]

        valid_new_ds_ids = [id for id in new_ds_ids if id is not None]
        valid_new_scheme_ids = [id for id in new_scheme_ids if id is not None]

        if len(valid_new_ds_ids) != len(original_ds_ids):
             logger.warning(f"Could not map all original DataSource IDs for imported job {job_data.get('name')}")
        if len(valid_new_scheme_ids) != len(original_scheme_ids):
             logger.warning(f"Could not map all original Scheme IDs for imported job {job_data.get('name')}")

        if not valid_new_ds_ids or not valid_new_scheme_ids:
             raise ValueError("Cannot import job without valid datasources and schemes.")

        config["datasource_ids"] = valid_new_ds_ids
        config["scheme_ids"] = valid_new_scheme_ids

        # Prepare job creation data
        job_create_data = ClassificationJobCreate(
            name=f"{job_data.get('name', 'Imported Job')} (Imported)",
            description=job_data.get("description"),
            configuration=config
        )

        # Use the existing create_job method
        # The task trigger inside create_job might run, status will be PENDING.
        new_job = self.create_job(workspace_id=workspace_id, user_id=user_id, job_data=job_create_data)
        logger.info(f"Imported Job '{new_job.name}' (ID: {new_job.id}) into workspace {workspace_id}")
        return new_job

    def find_or_create_scheme_from_definition(
        self,
        workspace_id: int,
        user_id: int,
        scheme_definition: Dict[str, Any],
        conflict_strategy: str = 'skip'
    ) -> ClassificationScheme:
        """
        Finds an existing scheme by name or creates a new one from definition.
        """
        scheme_name = scheme_definition.get("name")
        if not scheme_name:
            raise ValueError("Scheme definition must include a name.")

        # Check for existing scheme
        existing_scheme = self.session.exec(
            select(ClassificationScheme).where(
                ClassificationScheme.workspace_id == workspace_id,
                ClassificationScheme.name == scheme_name
            )
        ).first()

        if existing_scheme:
            logger.info(f"Found existing scheme '{scheme_name}' (ID: {existing_scheme.id}) in workspace {workspace_id}. Using existing.")
            return existing_scheme
        else:
            logger.info(f"No existing scheme named '{scheme_name}' found in workspace {workspace_id}. Creating new.")
            try:
                scheme_create_data = ClassificationSchemeCreate(
                    name=scheme_name,
                    description=scheme_definition.get("description"),
                    model_instructions=scheme_definition.get("model_instructions"),
                    validation_rules=scheme_definition.get("validation_rules"),
                    fields=scheme_definition.get("fields", [])
                )
            except Exception as pydantic_error:
                raise ValueError(f"Invalid scheme definition format for '{scheme_name}': {pydantic_error}") from pydantic_error

            # Use the existing create_scheme method
            new_scheme = self.create_scheme(user_id=user_id, workspace_id=workspace_id, scheme_data=scheme_create_data)
            logger.info(f"Successfully created imported scheme '{new_scheme.name}' (ID: {new_scheme.id})")
            return new_scheme

    def find_or_create_job_from_config(
        self,
        workspace_id: int,
        user_id: int,
        job_config_export: Dict[str, Any],
        import_context: Dict[str, Dict[int, int]],
        conflict_strategy: str = 'skip'
    ) -> ClassificationJob:
        """
        Finds or creates a Classification Job based on imported config.
        """
        job_name = job_config_export.get("name")
        if not job_name:
            raise ValueError("Job configuration must include a name.")

        existing_job = self.session.exec(
            select(ClassificationJob).where(
                ClassificationJob.workspace_id == workspace_id,
                ClassificationJob.name == job_name
            )
        ).first()

        if existing_job:
            logger.info(f"Found existing job '{job_name}' (ID: {existing_job.id}) in workspace {workspace_id}. Using existing.")
            return existing_job
        else:
            logger.info(f"No existing job named '{job_name}' found in workspace {workspace_id}. Creating new.")

            config = job_config_export.get("configuration", {})
            original_scheme_ids = config.get("scheme_ids", [])
            original_ds_ids = config.get("datasource_ids", [])

            scheme_id_map = import_context.get("scheme", {})
            datasource_id_map = import_context.get("datasource", {})

            new_scheme_ids = [scheme_id_map.get(orig_id) for orig_id in original_scheme_ids]
            new_ds_ids = [datasource_id_map.get(orig_id) for orig_id in original_ds_ids]

            valid_new_scheme_ids = [id for id in new_scheme_ids if id is not None]
            valid_new_ds_ids = [id for id in new_ds_ids if id is not None]

            if len(valid_new_scheme_ids) != len(original_scheme_ids):
                logger.warning(f"Could not map all original Scheme IDs for imported job '{job_name}'")
            if len(valid_new_ds_ids) != len(original_ds_ids):
                logger.warning(f"Could not map all original DataSource IDs for imported job '{job_name}'")

            if not valid_new_scheme_ids or not valid_new_ds_ids:
                raise ValueError(f"Cannot create job '{job_name}' due to missing mapped Schemes or DataSources.")

            new_config = config.copy()
            new_config["scheme_ids"] = valid_new_scheme_ids
            new_config["datasource_ids"] = valid_new_ds_ids

            try:
                job_create_data = ClassificationJobCreate(
                    name=job_name,
                    description=job_config_export.get("description"),
                    configuration=new_config
                )
            except Exception as pydantic_error:
                raise ValueError(f"Invalid job configuration format for '{job_name}': {pydantic_error}") from pydantic_error

            # Use the existing create_job method
            new_job = self.create_job(workspace_id=workspace_id, user_id=user_id, job_data=job_create_data)
            logger.info(f"Successfully created imported job '{new_job.name}' (ID: {new_job.id})")
            return new_job

    def cancel_job(
        self,
        job_id: int,
        user_id: int,
        workspace_id: int
    ) -> ClassificationJob:
        """
        Cancel a running or pending classification job.
        MODIFIES DATA - Commits transaction.
        
        Args:
            job_id: The ID of the job to cancel
            user_id: The ID of the user requesting cancellation
            workspace_id: The workspace ID for validation
            
        Returns:
            The updated job
            
        Raises:
            JobNotFoundError: If job not found
            InvalidStatusTransitionError: If job cannot be cancelled
            JobCancellationError: If cancellation fails
        """
        job = self.get_job(job_id, user_id)
        if not job or job.workspace_id != workspace_id:
            raise JobNotFoundError(f"Job {job_id} not found")

        if job.status not in [ClassificationJobStatus.PENDING, ClassificationJobStatus.RUNNING]:
            raise InvalidStatusTransitionError(f"Cannot cancel job in status {job.status}")

        try:
            # Try to revoke the Celery task if it's running
            if job.status == ClassificationJobStatus.RUNNING:
                from app.api.tasks.classification import process_classification_job
                process_classification_job.AsyncResult(str(job_id)).revoke(terminate=True)

            # Update job status
            job.status = ClassificationJobStatus.FAILED
            job.error_message = "Job cancelled by user"
            self.session.add(job)
            self.session.commit()
            self.session.refresh(job)
            return job

        except Exception as e:
            self.session.rollback()
            raise JobCancellationError(f"Failed to cancel job: {str(e)}")

    def retry_job(
        self,
        job_id: int,
        user_id: int,
        workspace_id: int
    ) -> ClassificationJob:
        """
        Retry a failed classification job.
        MODIFIES DATA - Commits transaction.
        
        Args:
            job_id: The ID of the job to retry
            user_id: The ID of the user requesting retry
            workspace_id: The workspace ID for validation
            
        Returns:
            The updated job
            
        Raises:
            JobNotFoundError: If job not found
            InvalidStatusTransitionError: If job cannot be retried
        """
        job = self.get_job(job_id, user_id)
        if not job or job.workspace_id != workspace_id:
            raise JobNotFoundError(f"Job {job_id} not found")

        if job.status != ClassificationJobStatus.FAILED:
            raise InvalidStatusTransitionError(f"Can only retry failed jobs, current status: {job.status}")

        try:
            # Update status and clear error
            job.status = ClassificationJobStatus.PENDING
            job.error_message = None
            self.session.add(job)
            self.session.commit()
            self.session.refresh(job)

            # Queue the job
            self.queue_classification_job(job.id)
            return job

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to retry job: {str(e)}")

    def create_jobs_batch(
        self,
        workspace_id: int,
        user_id: int,
        jobs_data: List[ClassificationJobCreate]
    ) -> Tuple[List[ClassificationJob], Dict[int, str]]:
        """
        Create multiple classification jobs in a batch.
        MODIFIES DATA - Commits transaction.
        
        Args:
            workspace_id: The workspace ID
            user_id: The user creating the jobs
            jobs_data: List of job creation data
            
        Returns:
            Tuple of (successful jobs list, failed jobs dict)
            
        Raises:
            BulkOperationError: If any jobs fail to create
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        successful_jobs = []
        failed_indices = {}

        for i, job_data in enumerate(jobs_data):
            try:
                job = ClassificationJob(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    status=ClassificationJobStatus.PENDING,
                    **job_data.model_dump()
                )
                self.session.add(job)
                successful_jobs.append(job)
            except Exception as e:
                failed_indices[i] = str(e)
                logger.warning(f"Failed to create job at index {i}: {e}")

        if successful_jobs:
            try:
                self.session.commit()
                # Queue successful jobs
                for job in successful_jobs:
                    try:
                        self.queue_classification_job(job.id)
                    except Exception as e:
                        failed_indices[job.id] = f"Created but failed to queue: {str(e)}"
            except Exception as e:
                self.session.rollback()
                raise ValueError(f"Failed to commit batch: {str(e)}")

        if failed_indices:
            raise BulkOperationError(
                message="Some jobs failed to create",
                successful_ids=[job.id for job in successful_jobs],
                failed_ids=failed_indices
            )

        return successful_jobs

    def delete_jobs_batch(
        self,
        workspace_id: int,
        user_id: int,
        job_ids: List[int]
    ) -> Tuple[List[int], Dict[int, str]]:
        """
        Delete multiple classification jobs in a batch.
        MODIFIES DATA - Commits transaction.
        
        Args:
            workspace_id: The workspace ID
            user_id: The user deleting the jobs
            job_ids: List of job IDs to delete
            
        Returns:
            Tuple of (successfully deleted IDs, failed deletions dict)
            
        Raises:
            BulkOperationError: If any jobs fail to delete
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        successful_ids = []
        failed_ids = {}

        # First verify all jobs exist and are in deletable state
        jobs = self.session.exec(
            select(ClassificationJob).where(
                ClassificationJob.id.in_(job_ids),
                ClassificationJob.workspace_id == workspace_id
            )
        ).all()

        found_ids = {job.id for job in jobs}
        missing_ids = set(job_ids) - found_ids
        for missing_id in missing_ids:
            failed_ids[missing_id] = "Job not found"

        for job in jobs:
            try:
                if job.status in [ClassificationJobStatus.RUNNING, ClassificationJobStatus.PENDING]:
                    # Try to cancel running/pending jobs
                    try:
                        self.cancel_job(job.id, user_id, workspace_id)
                    except Exception as e:
                        failed_ids[job.id] = f"Failed to cancel: {str(e)}"
                        continue

                # Delete associated results
                self.session.exec(
                    select(ClassificationResult).where(
                        ClassificationResult.job_id == job.id
                    )
                ).delete()

                self.session.delete(job)
                successful_ids.append(job.id)
            except Exception as e:
                failed_ids[job.id] = str(e)

        if successful_ids:
            try:
                self.session.commit()
            except Exception as e:
                self.session.rollback()
                raise ValueError(f"Failed to commit batch deletion: {str(e)}")

        if failed_ids:
            raise BulkOperationError(
                message="Some jobs failed to delete",
                successful_ids=successful_ids,
                failed_ids=failed_ids
            )

        return successful_ids, failed_ids

    def create_schemes_batch(
        self,
        workspace_id: int,
        user_id: int,
        schemes_data: List[ClassificationSchemeCreate]
    ) -> Tuple[List[ClassificationScheme], Dict[int, str]]:
        """
        Create multiple classification schemes in a batch.
        MODIFIES DATA - Commits transaction.
        
        Args:
            workspace_id: The workspace ID
            user_id: The user creating the schemes
            schemes_data: List of scheme creation data
            
        Returns:
            Tuple of (successful schemes list, failed schemes dict)
            
        Raises:
            BulkOperationError: If any schemes fail to create
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        successful_schemes = []
        failed_indices = {}

        for i, scheme_data in enumerate(schemes_data):
            try:
                # Validate fields
                for field in scheme_data.fields:
                    self._validate_scheme_field(field)

                scheme = ClassificationScheme(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    **scheme_data.model_dump(exclude={'fields'})
                )
                self.session.add(scheme)
                self.session.flush()  # Get scheme ID for fields

                # Create fields
                for field_data in scheme_data.fields:
                    field = ClassificationField(
                        scheme_id=scheme.id,
                        **field_data.model_dump()
                    )
                    self.session.add(field)

                successful_schemes.append(scheme)
            except Exception as e:
                failed_indices[i] = str(e)
                logger.warning(f"Failed to create scheme at index {i}: {e}")

        if successful_schemes:
            try:
                self.session.commit()
                for scheme in successful_schemes:
                    self.session.refresh(scheme)
            except Exception as e:
                self.session.rollback()
                raise ValueError(f"Failed to commit batch: {str(e)}")

        if failed_indices:
            raise BulkOperationError(
                message="Some schemes failed to create",
                successful_ids=[scheme.id for scheme in successful_schemes],
                failed_ids=failed_indices
            )

        return successful_schemes

    def delete_schemes_batch(
        self,
        workspace_id: int,
        user_id: int,
        scheme_ids: List[int]
    ) -> Tuple[List[int], Dict[int, str]]:
        """
        Delete multiple classification schemes in a batch.
        MODIFIES DATA - Commits transaction.
        
        Args:
            workspace_id: The workspace ID
            user_id: The user deleting the schemes
            scheme_ids: List of scheme IDs to delete
            
        Returns:
            Tuple of (successfully deleted IDs, failed deletions dict)
            
        Raises:
            BulkOperationError: If any schemes fail to delete
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        successful_ids = []
        failed_ids = {}

        # Check for schemes in use
        in_use_schemes = self.session.exec(
            select(ClassificationResult.scheme_id, func.count()).where(
                ClassificationResult.scheme_id.in_(scheme_ids)
            ).group_by(ClassificationResult.scheme_id)
        ).all()
        in_use_map = dict(in_use_schemes)

        # Get all schemes to delete
        schemes = self.session.exec(
            select(ClassificationScheme).where(
                ClassificationScheme.id.in_(scheme_ids),
                ClassificationScheme.workspace_id == workspace_id
            )
        ).all()

        found_ids = {scheme.id for scheme in schemes}
        missing_ids = set(scheme_ids) - found_ids
        for missing_id in missing_ids:
            failed_ids[missing_id] = "Scheme not found"

        for scheme in schemes:
            try:
                if scheme.id in in_use_map:
                    failed_ids[scheme.id] = f"Scheme has {in_use_map[scheme.id]} results"
                    continue

                # Delete fields first (should be handled by cascade, but being explicit)
                self.session.exec(
                    select(ClassificationField).where(
                        ClassificationField.scheme_id == scheme.id
                    )
                ).delete()

                self.session.delete(scheme)
                successful_ids.append(scheme.id)
            except Exception as e:
                failed_ids[scheme.id] = str(e)

        if successful_ids:
            try:
                self.session.commit()
            except Exception as e:
                self.session.rollback()
                raise ValueError(f"Failed to commit batch deletion: {str(e)}")

        if failed_ids:
            raise BulkOperationError(
                message="Some schemes failed to delete",
                successful_ids=successful_ids,
                failed_ids=failed_ids
            )

        return successful_ids, failed_ids

    def create_results_batch(
        self,
        job_id: int,
        results_data: List[Dict[str, Any]]
    ) -> Tuple[List[ClassificationResult], Dict[int, str]]:
        """
        Create multiple classification results in a batch.
        MODIFIES DATA - Commits transaction.
        
        Args:
            job_id: The job ID these results belong to
            results_data: List of result data dictionaries
            
        Returns:
            Tuple of (successful results list, failed results dict)
            
        Raises:
            JobNotFoundError: If job not found
            BulkOperationError: If any results fail to create
        """
        job = self.session.get(ClassificationJob, job_id)
        if not job:
            raise JobNotFoundError(f"Job {job_id} not found")

        successful_results = []
        failed_indices = {}

        # Get all schemes used in this batch for validation
        scheme_ids = {data.get('scheme_id') for data in results_data if data.get('scheme_id')}
        schemes = {
            scheme.id: scheme for scheme in self.session.exec(
                select(ClassificationScheme).where(
                    ClassificationScheme.id.in_(scheme_ids)
                )
            ).all()
        }

        for i, data in enumerate(results_data):
            try:
                # Check for required fields
                if not all(k in data for k in ['datarecord_id', 'scheme_id', 'value']):
                    raise ValueError("Missing required fields")

                # Check for existing result
                existing = self.session.exec(
                    select(ClassificationResult).where(
                        ClassificationResult.job_id == job_id,
                        ClassificationResult.datarecord_id == data['datarecord_id'],
                        ClassificationResult.scheme_id == data['scheme_id']
                    )
                ).first()

                if existing:
                    failed_indices[i] = "Result already exists"
                    continue

                # Validate result value against scheme
                scheme = schemes.get(data['scheme_id'])
                if not scheme:
                    failed_indices[i] = f"Scheme {data['scheme_id']} not found"
                    continue

                # Create result
                result = ClassificationResult(
                    job_id=job_id,
                    timestamp=datetime.now(timezone.utc),
                    **data
                )
                self.session.add(result)
                successful_results.append(result)

            except Exception as e:
                failed_indices[i] = str(e)
                logger.warning(f"Failed to create result at index {i}: {e}")

        if successful_results:
            try:
                self.session.commit()
                for result in successful_results:
                    self.session.refresh(result)
            except Exception as e:
                self.session.rollback()
                raise ValueError(f"Failed to commit batch: {str(e)}")

        if failed_indices:
            raise BulkOperationError(
                message="Some results failed to create",
                successful_ids=[result.id for result in successful_results],
                failed_ids=failed_indices
            )

        return successful_results

    def delete_results_batch(
        self,
        workspace_id: int,
        user_id: int,
        result_ids: List[int]
    ) -> Tuple[List[int], Dict[int, str]]:
        """
        Delete multiple classification results in a batch.
        MODIFIES DATA - Commits transaction.
        
        Args:
            workspace_id: The workspace ID
            user_id: The user deleting the results
            result_ids: List of result IDs to delete
            
        Returns:
            Tuple of (successfully deleted IDs, failed deletions dict)
            
        Raises:
            BulkOperationError: If any results fail to delete
        """
        validate_workspace_access(self.session, workspace_id, user_id)

        successful_ids = []
        failed_ids = {}

        # Get all results to delete, joining with job to check workspace
        results = self.session.exec(
            select(ClassificationResult).join(ClassificationJob).where(
                ClassificationResult.id.in_(result_ids),
                ClassificationJob.workspace_id == workspace_id
            )
        ).all()

        found_ids = {result.id for result in results}
        missing_ids = set(result_ids) - found_ids
        for missing_id in missing_ids:
            failed_ids[missing_id] = "Result not found or not accessible"

        for result in results:
            try:
                self.session.delete(result)
                successful_ids.append(result.id)
            except Exception as e:
                failed_ids[result.id] = str(e)

        if successful_ids:
            try:
                self.session.commit()
            except Exception as e:
                self.session.rollback()
                raise ValueError(f"Failed to commit batch deletion: {str(e)}")

        if failed_ids:
            raise BulkOperationError(
                message="Some results failed to delete",
                successful_ids=successful_ids,
                failed_ids=failed_ids
            )

        return successful_ids, failed_ids

    def pause_job(
        self,
        job_id: int,
        user_id: int,
        workspace_id: int
    ) -> ClassificationJob:
        """
        Pause a running classification job.
        MODIFIES DATA - Commits transaction.
        
        Args:
            job_id: The ID of the job to pause
            user_id: The ID of the user requesting pause
            workspace_id: The workspace ID for validation
            
        Returns:
            The updated job
            
        Raises:
            JobNotFoundError: If job not found
            InvalidStatusTransitionError: If job cannot be paused
            JobPauseError: If pause operation fails
        """
        job = self.get_job(job_id, user_id)
        if not job or job.workspace_id != workspace_id:
            raise JobNotFoundError(f"Job {job_id} not found")

        try:
            # Validate transition to PAUSED
            StatusTransition.validate(job.status, ClassificationJobStatus.PAUSED)

            # Try to pause the Celery task
            if job.status == ClassificationJobStatus.RUNNING:
                from app.api.tasks.classification import process_classification_job
                process_classification_job.AsyncResult(str(job_id)).pause()

            # Update job status
            job.status = ClassificationJobStatus.PAUSED
            job.error_message = "Job paused by user"
            job.updated_at = datetime.now(timezone.utc)
            self.session.add(job)
            self.session.commit()
            self.session.refresh(job)
            return job

        except InvalidStatusTransitionError:
            raise
        except Exception as e:
            self.session.rollback()
            raise JobPauseError(f"Failed to pause job: {str(e)}")

    def resume_job(
        self,
        job_id: int,
        user_id: int,
        workspace_id: int
    ) -> ClassificationJob:
        """
        Resume a paused classification job.
        MODIFIES DATA - Commits transaction.
        
        Args:
            job_id: The ID of the job to resume
            user_id: The ID of the user requesting resume
            workspace_id: The workspace ID for validation
            
        Returns:
            The updated job
            
        Raises:
            JobNotFoundError: If job not found
            InvalidStatusTransitionError: If job cannot be resumed
            JobResumeError: If resume operation fails
        """
        job = self.get_job(job_id, user_id)
        if not job or job.workspace_id != workspace_id:
            raise JobNotFoundError(f"Job {job_id} not found")

        try:
            # Validate transition to RUNNING
            StatusTransition.validate(job.status, ClassificationJobStatus.RUNNING)

            # Try to resume the Celery task
            if job.status == ClassificationJobStatus.PAUSED:
                from app.api.tasks.classification import process_classification_job
                process_classification_job.AsyncResult(str(job_id)).resume()

            # Update job status
            job.status = ClassificationJobStatus.RUNNING
            job.error_message = None
            job.updated_at = datetime.now(timezone.utc)
            self.session.add(job)
            self.session.commit()
            self.session.refresh(job)
            return job

        except InvalidStatusTransitionError:
            raise
        except Exception as e:
            self.session.rollback()
            raise JobResumeError(f"Failed to resume job: {str(e)}")

    def validate_job_configuration(self, config: Dict[str, Any]) -> None:
        """
        Validate job configuration.
        
        Args:
            config: The job configuration to validate
            
        Raises:
            ValidationError: If configuration is invalid
        """
        required_fields = {'scheme_ids', 'datasource_ids'}
        if not all(field in config for field in required_fields):
            raise ValidationError(f"Missing required fields: {required_fields - set(config.keys())}")

        if not isinstance(config['scheme_ids'], list) or not config['scheme_ids']:
            raise ValidationError("scheme_ids must be a non-empty list")

        if not isinstance(config['datasource_ids'], list) or not config['datasource_ids']:
            raise ValidationError("datasource_ids must be a non-empty list")

        # Check that all referenced schemes exist
        schemes = self.session.exec(
            select(ClassificationScheme).where(
                ClassificationScheme.id.in_(config['scheme_ids'])
            )
        ).all()
        found_scheme_ids = {scheme.id for scheme in schemes}
        missing_scheme_ids = set(config['scheme_ids']) - found_scheme_ids
        if missing_scheme_ids:
            raise ValidationError(f"Schemes not found: {missing_scheme_ids}")

        # Check that all referenced datasources exist
        from app.models import DataSource
        datasources = self.session.exec(
            select(DataSource).where(
                DataSource.id.in_(config['datasource_ids'])
            )
        ).all()
        found_datasource_ids = {ds.id for ds in datasources}
        missing_datasource_ids = set(config['datasource_ids']) - found_datasource_ids
        if missing_datasource_ids:
            raise ValidationError(f"Datasources not found: {missing_datasource_ids}")