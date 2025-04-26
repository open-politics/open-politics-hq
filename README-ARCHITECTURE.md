# Open Politics Backend Architecture Redesign

This document outlines the architectural redesign of the Open Politics backend, addressing issues with the previous codebase including inconsistent patterns, poor separation of concerns, and tight coupling to specific implementations.

## Goals of the Redesign

- **Clear Layers**: Separate API (Interface) from Service (Business Logic) from Data/Providers (DB/External Libs)
- **Decoupling**: Use interfaces/adapters for external dependencies to enable easy swapping of implementations
- **Consistent Patterns**: Establish standard approaches to common operations
- **Testability**: Make the codebase easier to test with clear boundaries and dependencies
- **Maintainability**: Improve code organization and documentation
- **Scalability**: Support multiple search/classification engines as mentioned in system requirements

## Architecture Overview

### Components

1. **API Layer** (`app/api/`)
   - Handles HTTP request/response cycles
   - Validates and processes input
   - Delegates business logic to services
   - Formats responses

2. **Service Layer** (`app/services/`)
   - Encapsulates business logic
   - Orchestrates workflows
   - Enforces business rules
   - Uses providers for external operations

3. **Provider Layer** (`app/services/providers/`)
   - Abstracts external dependencies (storage, search, classification, etc.)
   - Defines interfaces and concrete implementations

4. **Task Layer** (`app/tasks/`)
   - Handles background processing via Celery
   - Delegates business logic to services
   - Manages task-specific concerns (retries, progress)

5. **Data Layer** (`app/models/`)
   - Defines database models (unchanged from previous architecture)

### Key Design Patterns

1. **Service Pattern**: Centralized business logic in service classes
2. **Provider Pattern**: Abstract interfaces for external dependencies
3. **Dependency Injection**: Configure services with specific provider implementations
4. **Factory Functions**: Get service/provider instances for dependency injection

## Implementation Progress

So far, we have implemented:

1. **Provider Interfaces**:
   - `StorageProvider`: For file storage operations
   - `ScrapingProvider`: For web scraping operations
   - `SearchProvider`: For search operations
   - `ClassificationProvider`: For text classification operations
   - `GeospatialProvider`: For geospatial data operations

2. **Provider Implementations**:
   - `MinioStorageProvider`: MinIO implementation for storage
   - `OpolScrapingProvider`: OPOL implementation for scraping
   - `OpolSearchProvider`: OPOL implementation for search
   - `OpolClassificationProvider`: OPOL implementation for classification
   - `OpolGeospatialProvider`: OPOL implementation for geospatial data

3. **Services**:
   - `WorkspaceService`: For workspace management
   - `ClassificationService`: For classification operations
   - `IngestionService`: For data ingestion

4. **Refactored Components**:
   - `app/api/routes/workspaces.py`: API routes for workspace operations
   - `app/tasks/classification.py`: Task for classification job processing

## Next Steps

1. **Continue API Route Refactoring**:
   - Refactor remaining API routes to use the service layer
   - Start with high-priority routes like classification, ingestion, and search

2. **Complete Service Implementations**:
   - Implement `SchedulingService` for recurring tasks
   - Implement `SearchService` for search operations

3. **Task Refactoring**:
   - Refactor remaining Celery tasks to use the service layer
   - Simplify task code by delegating business logic to services

4. **Dependency Injection**:
   - Implement a dependency injection system for FastAPI routes
   - Simplify service/provider acquisition in routes

5. **Testing**:
   - Add unit tests for services
   - Add integration tests for API routes
   - Create mock providers for testing

6. **Documentation**:
   - Document API routes
   - Document service methods
   - Add usage examples

## Migration Strategy

The migration should be incremental, focusing on one functional area at a time:

1. Start with core components (workspace, classification)
2. Move to ingestion and data sources
3. Refactor search, entities, and geospatial components
4. Finally update scheduled tasks and background jobs

This approach allows for continuous operation during the migration, with gradual improvements to the codebase.

## Benefits

This new architecture offers several benefits:

1. **Clearer Code Organization**: Code is organized by function, not by framework component
2. **Easier Testing**: Services and providers can be tested in isolation
3. **Improved Flexibility**: Easy to swap implementations (e.g., changing from OPOL to another search engine)
4. **Consistency**: Standard patterns for common operations
5. **Reduced Duplication**: Business logic centralized in services
6. **Better Maintenance**: Clear boundaries and dependencies

## Getting Started for Developers

To work with the new architecture:

1. **Creating a New Feature**:
   - Define provider interfaces if needed
   - Implement a service with the business logic
   - Create API routes that use the service
   - Implement tasks if background processing is needed

2. **Updating Existing Code**:
   - Move business logic from routes to services
   - Replace direct external calls with provider calls
   - Update route handlers to use services

3. **Testing**:
   - Create mock providers for testing services
   - Test services in isolation
   - Test API routes with mocked services 