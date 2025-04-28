# API Services Architecture

This directory contains the application's business logic layer in the form of services. The services layer implements a clean architecture pattern, addressing separation of concerns, dependency injection, and modular design.

## Key Design Principles

1. **Service Layer Pattern**: Services encapsulate business logic, providing a clean, consistent API for the application's core functionality.
2. **Provider Pattern**: External integrations (storage, classification, search, etc.) are accessed through provider interfaces.
3. **Dependency Injection**: Services are configured with specific provider implementations via FastAPI's dependency injection.
4. **Single Responsibility**: Each service focuses on a specific domain with clear boundaries.
5. **Universal Data Transfer**: Resources can be packaged and transferred between instances while preserving relationships.

## Project Structure

```
backend/
├── app/
│   ├── api/
│   │   ├── routes/                    # API endpoint definitions
│   │   │   ├── classification_jobs.py
│   │   │   ├── classification_results.py
│   │   │   ├── classification_schemes.py
│   │   │   ├── datarecords.py
│   │   │   ├── datasets.py
│   │   │   ├── datasources.py
│   │   │   ├── filestorage.py
│   │   │   ├── shareables.py
│   │   │   ├── users.py
│   │   │   └── workspaces.py
│   │   ├── services/                  # Business logic layer
│   │   │   ├── providers/            # Provider interfaces & implementations
│   │   │   │   ├── base.py           # Provider interfaces (ABC)
│   │   │   │   ├── classification.py # Classification providers
│   │   │   │   ├── geospatial.py     # Geospatial providers
│   │   │   │   ├── scraping.py       # Web scraping providers
│   │   │   │   ├── search.py         # Search providers
│   │   │   │   └── storage.py        # Storage providers
│   │   │   ├── classification.py     # Classification operations
│   │   │   ├── dataset.py           # Dataset management
│   │   │   ├── ingestion.py         # Data ingestion
│   │   │   ├── package.py           # Universal data transfer
│   │   │   ├── recurring_tasks.py   # Task scheduling
│   │   │   ├── shareable.py         # Shareable resources
│   │   │   └── workspace.py         # Workspace management
│   │   ├── tasks/                    # Background task definitions
│   │   │   ├── classification.py
│   │   │   ├── ingestion.py
│   │   │   ├── recurring_classification.py
│   │   │   ├── recurring_ingestion.py
│   │   │   └── scheduling.py
│   │   ├── v1/                      # Version 1 API routes
│   │   │   ├── entities/
│   │   │   ├── locations/
│   │   │   ├── satellite/
│   │   │   └── search/
│   │   └── v2/                      # Version 2 API routes
│   │       ├── articles.py
│   │       ├── classification.py
│   │       ├── entities.py
│   │       ├── flows/
│   │       ├── geo.py
│   │       └── scores.py
│   ├── core/                        # Core application components
│   │   ├── config.py               # Configuration
│   │   ├── db.py                   # Database setup
│   │   ├── security.py             # Security utilities
│   │   └── celery_app.py           # Celery configuration
│   ├── models.py                    # SQLModel definitions
│   └── tests/                      # Test suite
│       ├── api/
│       ├── crud/
│       ├── search/
│       └── workflow/
```

## Core Services

### Data Management
- **`DatasetService`**: CRUD operations for datasets, export/import functionality
- **`IngestionService`**: Data source and record management, file uploads
- **`ClassificationService`**: Classification schemes, jobs, and results
- **`WorkspaceService`**: Workspace management and access control

### Universal Data Transfer (80% Complete)
The universal data transfer system enables seamless sharing of resources between instances:

1. **Package Format (95% Complete)**
   - Self-contained ZIP archives
   - Standardized metadata
   - UUID-based entity tracking
   - File content preservation
   - Version compatibility

2. **Database Schema (90% Complete)**
   ```sql
   entity_uuid: UUID (unique, indexed)
   imported_from_uuid: UUID (indexed, nullable)
   ```
   - Added to key tables (datasource, datarecord, scheme, job, dataset)
   - Migration handles existing records
   - Enables cross-instance entity tracking

3. **Export Process (85% Complete)**
   - Builds self-contained packages
   - Preserves entity relationships
   - Handles file attachments
   - Includes metadata and provenance

4. **Import Process (80% Complete)**
   - Entity reconciliation
   - Relationship preservation
   - Conflict resolution
   - File storage management

5. **Integration Status**
   - API Endpoints: 60% Complete
   - UI Components: 10% Complete
   - Testing: 0% Complete
   - Documentation: 30% Complete

### Provider Interfaces

Key provider interfaces that abstract external dependencies:

- **`StorageProvider`**: File storage (e.g., MinIO)
- **`ClassificationProvider`**: Text classification
- **`SearchProvider`**: Search functionality
- **`GeospatialProvider`**: Geospatial operations
- **`ScrapingProvider`**: Web scraping

## Implementation Status

### Completed Features
- ✓ Package format definition
- ✓ Database schema updates
- ✓ Basic export/import logic
- ✓ Entity UUID tracking
- ✓ File handling
- ✓ Service integration

### In Progress
- 🔄 API endpoint implementation
- 🔄 Error handling improvements
- 🔄 Transaction management
- 🔄 Progress tracking

### Pending
- ❌ Comprehensive testing
- ❌ UI components
- ❌ Documentation
- ❌ Performance optimization
- ❌ Validation improvements

## Next Steps (Priority Order)

1. **Testing (Critical)**
   - Unit tests for package handling
   - Integration tests for export/import
   - Performance benchmarks

2. **UI Integration**
   - Progress tracking components
   - Export/import wizards
   - Error handling & feedback

3. **Robustness**
   - Improved validation
   - Better error recovery
   - Transaction management
   - Version compatibility

4. **Documentation**
   - API documentation
   - Usage examples
   - Deployment guide

## Usage Examples

### Export Dataset
```python
# In dataset_service.py
async def export_dataset_package(self, dataset_id: int) -> bytes:
    dataset = self.get_dataset(dataset_id)
    builder = PackageBuilder(self.session, self.storage_provider)
    package = await builder.build_dataset_package(dataset)
    return package.to_zip()
```

### Import Dataset
```python
# In dataset_service.py
async def import_dataset_package(self, file: UploadFile, workspace_id: int) -> Dataset:
    package = await DataPackage.from_upload(file)
    importer = PackageImporter(self.session, self.storage_provider, workspace_id)
    return await importer.import_dataset_package(package)
```

## Testing

Services can be tested independently with mock providers:

```python
def test_dataset_export():
    mock_storage = MockStorageProvider()
    service = DatasetService(storage_provider=mock_storage)
    package = await service.export_dataset_package(dataset_id=1)
    assert package.metadata.package_type == ResourceType.DATASET
```

## Contributing

When adding new features:

1. Follow existing patterns for services and providers
2. Update tests and documentation
3. Consider universal data transfer implications
4. Maintain backward compatibility
5. Add appropriate error handling 