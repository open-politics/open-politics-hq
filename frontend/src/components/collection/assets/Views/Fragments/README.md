# Fragment Display Components

Centralized components for displaying asset fragments across the application. Fragments are curated pieces of data extracted from assets, typically through annotation runs.

## Components

### FragmentDisplay
Main component that renders fragments based on view mode.

```tsx
<FragmentDisplay 
  fragments={asset.fragments as Record<string, any>}
  viewMode="full" // 'badge' | 'card' | 'full'
  onFragmentClick={(key, fragment) => console.log('Clicked:', key)}
  onRunClick={(runId) => console.log('Navigate to run:', runId)}
/>
```

**View Modes:**
- **badge**: Minimal view - shows just a count badge (e.g., "F3" for 3 fragments)
- **card**: Compact card view with key, value preview, and metadata
- **full**: Detailed view with complete value, all metadata, and schema information

### FragmentCountBadge
Simple badge showing the number of fragments.

```tsx
<FragmentCountBadge 
  count={Object.keys(asset.fragments).length}
  onClick={() => handleShowFragments()}
/>
```

### FragmentSectionHeader
Consistent header for fragment sections.

```tsx
<FragmentSectionHeader count={fragmentCount} />
```

## Usage Examples

### In CSV Detail View (Full Mode)
```tsx
{asset.fragments && Object.keys(asset.fragments).length > 0 && (
  <div>
    <FragmentSectionHeader count={Object.keys(asset.fragments).length} />
    <FragmentDisplay 
      fragments={asset.fragments as Record<string, any>}
      viewMode="full"
    />
  </div>
)}
```

### In Article View (Card Mode)
```tsx
{asset.fragments && Object.keys(asset.fragments).length > 0 && (
  <div className="mt-8 pt-6 border-t">
    <FragmentSectionHeader count={Object.keys(asset.fragments).length} />
    <FragmentDisplay 
      fragments={asset.fragments as Record<string, any>}
      viewMode="card"
    />
  </div>
)}
```

### In Table Rows (Badge Mode)
```tsx
{asset.fragments && Object.keys(asset.fragments).length > 0 && (
  <FragmentCountBadge 
    count={Object.keys(asset.fragments).length}
  />
)}
```

## Features

### Field Description Tooltips 💡
Each fragment field can display its description from the schema on hover:

- **Help Icon**: A small question mark icon appears next to the field name (only when description exists)
- **Hover Tooltip**: Hovering over the icon shows the field-specific description from the schema's `output_contract`
- **Smart Navigation**: The utility function navigates through nested schema structures (including arrays and objects)
- **Available in**: Both `card` and `full` view modes

### Annotation Run Links
Fragments from annotation runs include a clickable link to open the run in the annotation runner.

- Automatically detects `source_ref` like `"annotation_run:123"`
- Provides "Open in Runner" button
- Default navigation: `/hq/infospaces/annotation-runner?runId={runId}`
- Custom handler via `onRunClick` prop

### Schema Information
Fragments can be associated with annotation schemas:
- Displays schema name and description
- Field-specific descriptions shown on hover (see above)
- Loading state while fetching schema info
- Uses `useSchemaInfo` hook internally

### Color Coding
- **Blue**: Fragments from annotation runs
- **Purple**: Manually curated or other sources

### Copy to Clipboard
All fragment values can be copied with a single click.

## Fragment Data Structure

```typescript
interface FragmentData {
  value: any;                    // The extracted value
  source_ref?: string;           // e.g., "annotation_run:123"
  timestamp?: string;            // When it was curated
  curated_by_ref?: string;       // Who curated it
  schema_id?: number;            // Associated schema
  schema?: {
    id: number;
    name: string;
    description?: string;
  };
}
```

## Utilities

The package also exports utility functions:

- `extractRunIdFromSourceRef(sourceRef)` - Extract run ID from source reference
- `isFromAnnotationRun(fragment)` - Check if fragment is from annotation run
- `getDisplayFragmentKey(key)` - Format key for display (removes prefixes)
- `formatFragmentValue(value, maxLength)` - Format value with optional truncation
- `getFragmentColorScheme(fragment)` - Get color classes based on source
- `getFieldDescriptionFromSchema(schema, fragmentKey)` - Extract field description from schema's output_contract

## Integration

Currently integrated in:
- ✅ CSV Detail View (full mode in detail panel, badge in table)
- ✅ Article View (card mode)
- ⚠️ TODO: Asset Detail View
- ⚠️ TODO: Bundle View
- ⚠️ TODO: Search Results
