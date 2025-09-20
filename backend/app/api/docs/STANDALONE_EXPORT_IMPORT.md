# Standalone Annotation Run and Workspace Export/Import System

## Overview

This document outlines the implementation of an independent export/import system for annotation runs and complete workspaces that enables seamless data transfer between different instances (e.g., local development to production). This system builds on the existing package infrastructure but provides standalone capabilities for annotation-focused workflows.

## Current State Analysis

### Existing Infrastructure
- **PackageBuilder/PackageImporter**: Core infrastructure for data packaging and restoration
- **InfospaceService**: Handles infospace-level exports and imports
- **BackupService**: Provides infospace backup functionality
- **UserBackupService**: System-level user backup functionality (newly implemented)

### Gaps for Standalone Exports
1. **Granular Annotation Run Export**: Need ability to export individual runs with their complete context
2. **Cross-Instance Compatibility**: Better handling of UUID conflicts and instance differences
3. **Selective Import**: Choose what components to import from a package
4. **Annotation-Centric Packages**: Purpose-built packages for annotation workflows
5. **Dependency Resolution**: Smart handling of schema dependencies and asset references

## Implementation Plan

### Phase 1: Annotation Run Export System

#### 1.1 Enhanced Annotation Run Export
Create a specialized export system for individual annotation runs that includes:

```python
class AnnotationRunExporter:
    """Specialized exporter for annotation runs with full context."""
    
    async def export_annotation_run(
        self,
        run_id: int,
        export_options: AnnotationRunExportOptions
    ) -> str:
        """
        Export a complete annotation run with all dependencies.
        
        Includes:
        - Run metadata and configuration
        - All target schemas with dependencies
        - Source assets (with selective inclusion)
        - All annotations and justifications
        - Asset chunks and embeddings (optional)
        - Related datasets (optional)
        
        Returns path to the generated package.
        """
```

#### 1.2 Export Options Configuration
```python
class AnnotationRunExportOptions:
    include_source_assets: bool = True          # Include original asset files
    include_embeddings: bool = False            # Include pre-computed embeddings
    include_chunks: bool = True                 # Include asset chunks
    include_datasets: bool = False              # Include related datasets
    include_dependencies: bool = True           # Include schema dependencies
    asset_format: str = "reference"             # "reference", "inline", "external"
    preserve_uuids: bool = False                # Keep original UUIDs or generate new ones
    target_instance_id: Optional[str] = None    # Target instance for compatibility
    compression_level: int = 6                  # ZIP compression level
```

#### 1.3 Annotation Run Package Structure
```
annotation_run_package.zip
├── manifest.json                 # Package metadata and version
├── run/
│   ├── run_metadata.json        # AnnotationRun details
│   ├── configuration.json       # Run configuration
│   └── target_assets.json       # List of target asset references
├── schemas/
│   ├── primary_schemas.json     # Schemas used directly in the run
│   └── dependency_schemas.json  # Schemas referenced by primary schemas
├── annotations/
│   ├── annotations.jsonl        # All annotations (one per line)
│   └── justifications.jsonl     # All justifications
├── assets/
│   ├── metadata/                # Asset metadata files
│   │   ├── asset_1.json
│   │   └── asset_2.json
│   ├── files/                   # Original asset files (if included)
│   │   ├── asset_1_file.pdf
│   │   └── asset_2_file.jpg
│   └── chunks/                  # Asset chunks (if included)
│       ├── asset_1_chunks.jsonl
│       └── asset_2_chunks.jsonl
├── datasets/                    # Related datasets (if included)
│   └── dataset_metadata.json
└── compatibility/
    ├── instance_mapping.json   # Instance-specific ID mappings
    └── version_info.json       # Version compatibility information
```

### Phase 2: Workspace-Level Export Enhancement

#### 2.1 Enhanced Infospace Export
Extend the existing infospace export with annotation-focused features:

```python
class EnhancedInfospaceExporter:
    """Enhanced infospace exporter with annotation-run awareness."""
    
    async def export_infospace_with_runs(
        self,
        infospace_id: int,
        export_options: InfospaceExportOptions
    ) -> str:
        """
        Export infospace with detailed annotation run organization.
        
        Features:
        - Organized by annotation runs
        - Selective run inclusion
        - Cross-run dependency handling
        - Asset deduplication across runs
        """
```

#### 2.2 Selective Export Options
```python
class InfospaceExportOptions:
    # Existing options
    include_assets: bool = True
    include_annotations: bool = True
    include_runs: bool = True
    
    # New annotation-focused options
    selected_run_ids: Optional[List[int]] = None    # Export specific runs only
    include_incomplete_runs: bool = False           # Include failed/pending runs
    group_by_runs: bool = True                      # Organize exports by runs
    include_run_dependencies: bool = True           # Include assets/schemas used by runs
    deduplicate_assets: bool = True                 # Remove duplicate assets across runs
    include_run_analytics: bool = False             # Include run performance metrics
    export_format: str = "hierarchical"            # "hierarchical", "flat", "run_centric"
```

### Phase 3: Cross-Instance Import System

#### 3.1 Smart Import with Conflict Resolution
```python
class CrossInstanceImporter:
    """Smart importer that handles cross-instance conflicts."""
    
    async def import_with_conflict_resolution(
        self,
        package_path: str,
        target_infospace_id: Optional[int],
        import_options: CrossInstanceImportOptions
    ) -> ImportResult:
        """
        Import with intelligent conflict resolution.
        
        Features:
        - UUID conflict detection and resolution
        - Schema compatibility checking
        - Asset deduplication
        - Selective component import
        - Rollback on failure
        """
```

#### 3.2 Import Conflict Resolution
```python
class CrossInstanceImportOptions:
    conflict_strategy: str = "smart"              # "smart", "skip", "overwrite", "rename"
    preserve_relationships: bool = True           # Maintain annotation-asset relationships
    update_existing_schemas: bool = False         # Update schemas if they exist
    create_new_infospace: bool = False           # Create new infospace vs use existing
    target_infospace_name: Optional[str] = None  # Name for new infospace
    uuid_mapping_strategy: str = "generate"      # "preserve", "generate", "hybrid"
    owner_id: Optional[int] = None               # Override owner for imported data
    validate_before_import: bool = True          # Pre-validate package integrity
    dry_run: bool = False                        # Test import without making changes
```

#### 3.3 Import Result Tracking
```python
class ImportResult:
    success: bool
    created_infospace_id: Optional[int]
    imported_runs: List[int]
    imported_assets: List[int]
    imported_schemas: List[int]
    imported_annotations: int
    skipped_items: List[Dict]
    conflicts_resolved: List[Dict]
    warnings: List[str]
    errors: List[str]
    rollback_info: Optional[Dict]  # Information for potential rollback
```

### Phase 4: Testing and Validation Framework

#### 4.1 Export/Import Testing Tools
```python
class ExportImportTester:
    """Comprehensive testing framework for export/import operations."""
    
    async def test_roundtrip_fidelity(
        self,
        source_run_id: int,
        export_options: AnnotationRunExportOptions,
        import_options: CrossInstanceImportOptions
    ) -> FidelityReport:
        """
        Test data fidelity through export/import cycle.
        
        Validates:
        - Data completeness
        - Relationship integrity
        - Annotation accuracy
        - Asset accessibility
        - Schema compatibility
        """
    
    async def test_cross_instance_compatibility(
        self,
        package_path: str,
        target_instance_config: Dict
    ) -> CompatibilityReport:
        """
        Test package compatibility with target instance.
        
        Checks:
        - Version compatibility
        - Schema compatibility
        - Feature availability
        - Storage provider compatibility
        """
```

#### 4.2 Data Validation Framework
```python
class DataValidator:
    """Validates data integrity during import/export."""
    
    def validate_annotation_run_package(
        self, 
        package_path: str
    ) -> ValidationResult:
        """
        Validate annotation run package structure and content.
        
        Validates:
        - Package structure
        - JSON schema compliance
        - Reference integrity
        - File accessibility
        - Compression integrity
        """
    
    def validate_import_compatibility(
        self,
        package_manifest: Dict,
        target_infospace: Infospace
    ) -> CompatibilityResult:
        """
        Check if package can be imported into target infospace.
        
        Checks:
        - Schema version compatibility
        - Asset type support
        - Storage provider compatibility
        - Feature requirement compatibility
        """
```

## Implementation Details

### Database Schema Extensions

#### New Tables
```sql
-- Track export/import operations
CREATE TABLE export_operations (
    id SERIAL PRIMARY KEY,
    uuid UUID UNIQUE NOT NULL,
    operation_type VARCHAR(50) NOT NULL, -- 'annotation_run', 'infospace', 'user'
    source_id INTEGER NOT NULL,
    package_path VARCHAR(500),
    export_options JSONB,
    status VARCHAR(50) NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    file_size_bytes BIGINT,
    error_message TEXT
);

CREATE TABLE import_operations (
    id SERIAL PRIMARY KEY,
    uuid UUID UNIQUE NOT NULL,
    package_path VARCHAR(500) NOT NULL,
    target_infospace_id INTEGER REFERENCES infospaces(id),
    import_options JSONB,
    import_result JSONB,
    status VARCHAR(50) NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    rollback_info JSONB
);

-- Track cross-instance ID mappings
CREATE TABLE cross_instance_mappings (
    id SERIAL PRIMARY KEY,
    import_operation_id INTEGER REFERENCES import_operations(id),
    source_instance_id VARCHAR(100),
    source_entity_type VARCHAR(50), -- 'asset', 'schema', 'run', 'annotation'
    source_entity_id VARCHAR(100),
    target_entity_id INTEGER,
    mapping_strategy VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE
);
```

### API Endpoints

#### Annotation Run Export/Import
```python
# Export annotation run
POST /api/v1/annotation-runs/{run_id}/export
{
    "export_options": {
        "include_source_assets": true,
        "include_embeddings": false,
        "preserve_uuids": false,
        "target_instance_id": "prod-instance"
    }
}

# Import annotation run package
POST /api/v1/annotation-runs/import
{
    "package_url": "https://...",
    "target_infospace_id": 123,
    "import_options": {
        "conflict_strategy": "smart",
        "create_new_infospace": false,
        "validate_before_import": true
    }
}

# Get export/import status
GET /api/v1/operations/{operation_id}/status
```

#### Enhanced Infospace Export
```python
# Export infospace with annotation-run focus
POST /api/v1/infospaces/{infospace_id}/export-enhanced
{
    "export_options": {
        "selected_run_ids": [1, 2, 3],
        "group_by_runs": true,
        "include_run_dependencies": true,
        "export_format": "hierarchical"
    }
}
```

### File Handling and Storage

#### Package Storage Strategy
- **Local Development**: Store in temporary directories with cleanup
- **Production**: Store in dedicated export/import bucket with lifecycle policies
- **Cross-Instance**: Support direct URL sharing with secure token access

#### Large File Handling
- **Streaming**: Support streaming for large packages
- **Chunked Upload**: Enable resumable uploads for large exports
- **Compression**: Intelligent compression based on content type
- **Deduplication**: Asset-level deduplication to reduce package size

### Security and Access Control

#### Export Security
- **User Authorization**: Only export data user has access to
- **Sensitive Data**: Option to exclude sensitive annotations/assets
- **Audit Logging**: Complete audit trail of export operations
- **Rate Limiting**: Prevent abuse of export functionality

#### Import Security
- **Package Validation**: Comprehensive validation before import
- **Malware Scanning**: Optional scanning of uploaded packages
- **Rollback Capability**: Ability to rollback failed imports
- **Access Control**: Import into infospaces user owns/can access

## Testing Strategy

### Local to Production Testing Workflow

1. **Local Setup**:
   ```bash
   # Create test annotation run with diverse data
   python -m scripts.create_test_run --assets 10 --schemas 3 --annotations 100
   
   # Export the run
   python -m scripts.export_run --run-id 123 --format hierarchical
   ```

2. **Transfer to Production**:
   ```bash
   # Upload package to production
   curl -X POST https://prod.example.com/api/v1/annotation-runs/import \
        -F "package=@annotation_run_123.zip" \
        -F "options={\"conflict_strategy\": \"smart\"}"
   ```

3. **Validation**:
   ```bash
   # Validate import success
   python -m scripts.validate_import --operation-id 456 --check-fidelity
   ```

### Automated Testing
- **CI/CD Integration**: Automated export/import testing in CI pipeline
- **Fidelity Testing**: Automated comparison of pre/post import data
- **Performance Testing**: Test with packages of various sizes
- **Cross-Version Testing**: Test compatibility between different versions

## Migration Path

### Phase 1: Core Infrastructure (Week 1-2)
- Implement `AnnotationRunExporter` class
- Create enhanced package structure
- Basic export functionality

### Phase 2: Import Enhancement (Week 3-4)
- Implement `CrossInstanceImporter`
- Add conflict resolution logic
- Create validation framework

### Phase 3: UI Integration (Week 5-6)
- Add export/import UI to annotation run management
- Create export/import status monitoring
- Add validation reporting UI

### Phase 4: Testing & Polish (Week 7-8)
- Comprehensive testing framework
- Performance optimization
- Documentation and examples

## Future Enhancements

### Advanced Features
- **Incremental Export**: Export only changes since last export
- **Multi-Instance Sync**: Bidirectional synchronization between instances
- **Version Control**: Track package versions and enable rollback
- **Collaborative Features**: Share packages between users/organizations

### Performance Optimizations
- **Parallel Processing**: Parallel export/import of independent components
- **Streaming Processing**: Process large packages without loading entirely into memory
- **Caching**: Cache frequently exported data for faster subsequent exports
- **Delta Compression**: Only include changes from a baseline package

## Success Metrics

### Functionality Metrics
- **Export Success Rate**: >99% successful exports
- **Import Fidelity**: >99.9% data accuracy after import
- **Cross-Instance Compatibility**: Support for all major version combinations
- **Package Size Efficiency**: <50% size compared to naive JSON dumps

### Performance Metrics
- **Export Speed**: <2 minutes for typical annotation runs (<1000 annotations)
- **Import Speed**: <3 minutes for typical packages
- **Storage Efficiency**: <10MB per 1000 annotations with assets
- **UI Responsiveness**: All operations provide real-time progress

### User Experience Metrics
- **User Adoption**: >80% of teams using export/import for dev→prod workflow
- **Error Rate**: <1% user-reported issues with exports/imports
- **Support Tickets**: <5% of exports/imports requiring manual intervention

This comprehensive system will enable seamless data transfer between instances while maintaining data integrity and providing excellent user experience for annotation-focused workflows. 