# Open Politics Architecture

## Overview

The Open Politics platform follows a clean architecture pattern with clear separation of concerns, modular design, and standardized interfaces for external integrations.

## Core Architecture

### 1. API Layer (`app/api/`)
- FastAPI routes and endpoints
- Request/response handling
- Input validation
- Authentication and authorization
- Service orchestration

### 2. Service Layer (`app/services/`)
- Business logic encapsulation
- Workflow orchestration
- Data validation and transformation
- Provider integration
- Transaction management

### 3. Provider Layer (`app/services/providers/`)
- Abstract interfaces for external dependencies
- Concrete implementations for:
  - Storage (MinIO)
  - Classification (OPOL)
  - Search (OPOL)
  - Geospatial (OPOL)
  - Scraping (OPOL)

### 4. Task Layer (`app/tasks/`)
- Celery background tasks
- Asynchronous processing
- Progress tracking
- Error handling and retries

### 5. Data Layer (`app/models/`)
- SQLModel database models
- Data validation
- Relationship management
- Type definitions

## Universal Data Transfer System (90% Complete)

The universal data transfer system enables seamless sharing of resources between instances while preserving relationships and content integrity.

### 1. Package Format (100% Complete)
```
package.zip/
├── metadata.json       # Package metadata and version info
├── manifest.json      # Entity relationships and dependencies
├── entities/          # JSON files for each entity
│   ├── dataset.json
│   ├── records.json
│   └── schemes.json
└── files/            # Binary files referenced by entities
    ├── file_1.pdf
    └── file_2.csv
```

### 2. Core Components (95% Complete)
- `PackageBuilder`: Creates export packages
- `PackageImporter`: Handles package imports
- `DataPackage`: Represents package format
- `PackageMetadata`: Package version and metadata

### 3. Database Schema (100% Complete)
- Entity UUID tracking
- Cross-instance references
- Relationship preservation
- Migration support

### 4. Frontend Integration (85% Complete)
- Dataset management UI
- Export/import dialogs
- Progress tracking
- Error handling
- Token-based sharing

### 5. API Endpoints (100% Complete)
- Dataset CRUD operations
- Export functionality
- Import handling
- Token-based sharing
- Progress tracking

### 6. Service Layer (95% Complete)
- `DatasetService`: Dataset management
- `ShareableService`: Resource sharing
- `PackageService`: Package handling
- Error handling and validation
- Transaction management

## Implementation Status

### Completed Features
✅ Package format definition
✅ Database schema updates
✅ Core export/import logic
✅ Entity UUID tracking
✅ File handling
✅ Service integration
✅ API endpoints
✅ Frontend components
✅ Basic error handling

### In Progress
🔄 Advanced error handling
🔄 Progress tracking improvements
🔄 Performance optimization
🔄 Documentation updates

### Pending
❌ Comprehensive testing
❌ Performance benchmarks
❌ Edge case handling
❌ Advanced validation

## Next Steps

1. **Testing (Priority)**
   - Unit tests for package handling
   - Integration tests for export/import
   - Performance testing
   - Edge case validation

2. **Performance**
   - Optimize large file handling
   - Improve memory usage
   - Add progress tracking
   - Implement chunked transfers

3. **Documentation**
   - API documentation
   - Usage examples
   - Deployment guide
   - Migration guide

4. **Frontend Enhancements**
   - Improved error feedback
   - Progress visualization
   - Batch operations
   - Preview functionality

## Design Patterns

1. **Service Pattern**
   - Centralized business logic
   - Clear interfaces
   - Dependency injection
   - Transaction management

2. **Provider Pattern**
   - Abstract interfaces
   - Concrete implementations
   - Dependency injection
   - Easy swapping of implementations

3. **Repository Pattern**
   - Data access abstraction
   - Query encapsulation
   - Caching support
   - Transaction handling

4. **Factory Pattern**
   - Service instantiation
   - Provider creation
   - Configuration management
   - Dependency injection

## Contributing

When adding new features:
1. Follow existing patterns
2. Add appropriate tests
3. Update documentation
4. Consider backward compatibility
5. Handle errors appropriately

## Testing Strategy

1. **Unit Tests**
   - Service methods
   - Provider implementations
   - Utility functions
   - Model validation

2. **Integration Tests**
   - API endpoints
   - Service workflows
   - Database operations
   - File operations

3. **End-to-End Tests**
   - Complete workflows
   - UI interactions
   - Error scenarios
   - Performance benchmarks 