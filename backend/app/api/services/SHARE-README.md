Technical Summary of Changes for Enhanced Sharing & Portability
This document outlines the key technical modifications and additions made to enhance data sharing, export, and import capabilities within the application. The core strategy revolved around standardizing on a PackageBuilder and PackageImporter system for robust data transfer.
I. Standardization on Package System (PackageBuilder/PackageImporter):
PackageImporter Transaction Control:
Modified all import_*_package methods in PackageImporter (backend/app/api/services/package.py) to remove internal self.session.commit() calls. They now rely on self.session.flush() for obtaining necessary IDs and defer transaction commits to the calling service. This allows for more encompassing transaction management by the services orchestrating complex imports (e.g., Workspace import).
ShareableService Refactoring:
Dependencies: ShareableService (shareable.py) constructor now accepts StorageProvider and source_instance_id (from settings) to facilitate use of PackageBuilder. The dependency injector in deps.py was updated accordingly.
Export Logic (_get_export_data_for_resource, export_resource):
Refactored to use PackageBuilder.build_*_package() for DATA_SOURCE, SCHEMA, CLASSIFICATION_JOB, and DATASET resource types.
export_resource now intelligently creates either a .zip package (if the DataPackage contains files, e.g., for DataSources with original PDFs, or Datasets/Workspaces which are inherently ZIPs) or a .json file (for file-less packages like Schemes, or DataPackages without files).
Workspace export (ResourceType.WORKSPACE) was also updated to use this flow, now returning a DataPackage (ZIP) from WorkspaceService.export_workspace.
Batch Export Logic (export_resources_batch):
Updated to correctly handle the DataPackage objects returned by the revised _get_export_data_for_resource. If a nested package has files (e.g., a DataSource), it's zipped individually and then added to the main batch ZIP. File-less packages are added as JSON.
Import Logic (import_resource):
Significantly refactored to handle both .zip packages and .json (file-less) package manifests.
If a .zip is for a WORKSPACE, it's routed to WorkspaceService.import_workspace.
Other .zip packages (e.g., Dataset, DataSource with files) or .json manifests (e.g., Scheme, Job) are processed using PackageImporter.
Manages session.commit() or session.rollback() for imports handled by PackageImporter.
II. Enhanced Dataset Functionality (for "Full Runs"):
DatasetService.create_dataset_from_job_run:
New method added to dataset.py to create a Dataset entity from a given ClassificationJob ID.
It populates the new Dataset with DataRecord IDs that have results for the job, and links the source ClassificationJob and ClassificationSchemes.
Scheme IDs are gathered from both job.configuration['scheme_ids'] and job.target_schemes, then validated against the target workspace.
API Endpoint for Dataset from Job:
Added POST /workspaces/{workspace_id}/classification_jobs/{job_id}/create_dataset route in classification_jobs.py to expose this service functionality.
DatasetService.export_dataset_package Refinements:
Improved logic for including source files (include_source_files=True), especially for BULK_PDF DataSources, ensuring original filenames and correct storage paths are used.
Ensured proper serialization of nested ClassificationScheme and ClassificationJob objects within the dataset package manifest (using .model_dump()).
Type hints and logging were improved.
API Endpoint for Dataset Export:
The POST /workspaces/{workspace_id}/datasets/{dataset_id}/export route in datasets.py was updated to include include_source_files query parameter, passing it to the service.
DatasetService.get_dataset Update:
The workspace_id parameter was made optional to allow fetching a dataset by its owner user ID without strict workspace context, useful for share link scenarios.
III. Comprehensive Workspace Export/Import:
WorkspaceService Dependencies:
WorkspaceService.__init__ (workspace.py) now accepts StorageProvider and ShareableService dependencies, and source_instance_id. deps.py updated.
WorkspaceService.export_workspace Overhaul:
Method is now async.
Returns a DataPackage.
Uses PackageBuilder to construct a comprehensive package:
Includes workspace details.
Iterates through DataSources, ClassificationSchemes, ClassificationJobs, and Datasets within the workspace.
For each nested entity, calls the appropriate builder.build_*_package() method (e.g., build_datasource_package, build_dataset_package).
The content of these nested packages is stored in lists within the main workspace package's content (e.g., datasources_content, datasets_content).
All files from nested packages are accumulated into the main PackageBuilder's files attribute, resulting in a single ZIP for the entire workspace.
WorkspaceService.import_workspace Overhaul:
Method is now async and expects a filepath to a workspace ZIP package.
Loads the main DataPackage from the ZIP.
Creates a new Workspace for the importing user.
Uses PackageImporter to import nested entities:
Iterates through datasources_content, schemes_content, etc., from the loaded package.
For each nested entity's content, reconstructs a temporary DataPackage object (importantly, passing the files collection from the main workspace ZIP package to it).
Calls the relevant importer.import_*_package() method.
Manages the overall database transaction (commit/rollback).
Cleans up the temporary ZIP file.
"Import Workspace from Token" Feature:
New method WorkspaceService.import_workspace_from_token added.
Uses injected ShareableService to validate the share token and retrieve original workspace ID and owner ID.
Calls self.export_workspace to get the DataPackage of the source workspace.
Saves this package to a temporary ZIP.
Calls self.import_workspace to import from this temp ZIP into a new workspace for the current user.
Handles optional renaming of the newly imported workspace.
Cleans up the temp ZIP.
New API endpoint POST /workspaces/import_from_token in workspaces.py exposes this service method.
IV. "View Shared Dataset Package Summary" Feature:
New Pydantic Models (models.py):
DatasetPackageFileManifestItem, DatasetPackageEntitySummary, DatasetPackageSummary created to structure the summary response.
ShareableService.get_dataset_package_summary_from_token:
New async method added to shareable.py.
Validates the dataset share token and retrieves original dataset ID and owner ID.
Calls dataset_service.export_dataset_package (with minimal content flags, but including results and file manifest for summary purposes).
Parses the resulting DataPackage's metadata and content to populate and return a DatasetPackageSummary.
API Endpoint for Summary View:
New GET /shareables/view_dataset_package_summary/{token} route added in shareables.py.
V. General Improvements:
Improved logging with exc_info=True in several service error handlers.
Enhanced type hinting in various service methods.
Refinements in transaction management (commits deferred to higher-level service methods).
This series of changes significantly enhances the application's capabilities for data exchange, backup, and collaborative workflows by providing structured, comprehensive, and consistent mechanisms for exporting and importing key entities and entire projects.
