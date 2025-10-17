# Tool Result System

Clean, consistent, and extensible architecture for rendering MCP tool results in the intelligence chat.

## Quick Start

### Using Existing Renderers

Tool results automatically render via the registry:

```tsx
import { ToolResultDisplay } from '@/components/collection/chat/toolcalls';

<ToolResultDisplay
  toolName="navigate"
  result={result}
  compact={false}
  onAssetClick={(id) => console.log('Asset', id)}
/>
```

### Creating a New Renderer

1. Create `renderers/YourToolRenderer.tsx`:

```tsx
import { ToolResultRenderer, ToolResultRenderProps } from '../core/ToolResultRegistry';
import { ResultHeader, CompactResult, EmptyResult } from '../shared/ResultComponents';

export const YourToolRenderer: ToolResultRenderer = {
  toolName: 'your_tool',
  
  canHandle: (result: any) => {
    return result?.some_identifying_field !== undefined;
  },
  
  getSummary: (result: any) => {
    return `Processed ${result.count} items`;
  },
  
  render: ({ result, compact }: ToolResultRenderProps) => {
    if (compact) {
      return <CompactResult items={...} total={...} />;
    }
    
    return (
      <div className="space-y-3">
        <ResultHeader count={result.count} label="items" />
        {/* Your content */}
      </div>
    );
  },
};
```

2. Register in `core/registerRenderers.ts`:

```tsx
import { YourToolRenderer } from '../renderers/YourToolRenderer';

export function initializeToolRenderers(): void {
  toolResultRegistry.register(NavigateRenderer);
  toolResultRegistry.register(YourToolRenderer); // Add this
  // ... other renderers
}
```

## Architecture

```
┌─────────────────────────────────────┐
│ Chat Message                        │
│ ┌─────────────────────────────────┐ │
│ │ ToolExecutionIndicator          │ │  ← Routing wrapper
│ │ ┌─────────────────────────────┐ │ │
│ │ │ ToolResultDisplay           │ │ │  ← Registry lookup
│ │ │ ┌─────────────────────────┐ │ │ │
│ │ │ │ YourRenderer            │ │ │ │  ← Direct rendering
│ │ │ │ • ResultHeader          │ │ │ │
│ │ │ │ • Content               │ │ │ │
│ │ │ │ • ResultFooter          │ │ │ │
│ │ │ └─────────────────────────┘ │ │ │
│ │ └─────────────────────────────┘ │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Key Principle**: Renderers control their complete presentation. No wrapper chrome.

## Design Guidelines

### Spacing
All renderers use standard spacing:

```tsx
<div className="space-y-3">      {/* Main sections: 12px */}
  <ResultHeader ... />
  
  <div className="space-y-2">     {/* Sub-sections: 8px */}
    <Item />
    <Item />
  </div>
  
  <ResultFooter ... />
</div>
```

### Colors
Use semantic theme colors:

```tsx
// Primary content
<span className="text-foreground">Main text</span>

// Secondary/metadata
<span className="text-muted-foreground">Metadata</span>

// Interactive
<button className="text-primary hover:text-primary/80">Action</button>

// Status
<span className="text-green-600">Success</span>
<span className="text-red-600">Error</span>
```

### Typography
```tsx
// Headers
<span className="text-sm font-medium">Section Title</span>

// Body text
<p className="text-sm">Regular content</p>

// Metadata
<span className="text-xs text-muted-foreground">Details</span>
```

### Containers
```tsx
// Content that needs a border
<div className="rounded-md border bg-card p-3">
  Content
</div>

// Scrollable content
<div className="max-h-96 overflow-auto rounded-md border bg-card">
  Long content
</div>
```

## Shared Components

### ResultHeader
Inline metadata display (replaces card headers):

```tsx
<ResultHeader 
  count={24} 
  label="assets" 
  query="search term"
  badge="loaded"
/>
```

Renders: **24 assets** `"search term"` `loaded`

### CompactResult
For inline display in thinking sections:

```tsx
<CompactResult
  items={items.map(i => ({ id: i.id, name: i.title }))}
  total={24}
  resource="assets"
  query="climate"
/>
```

Renders:
```
24 assets "climate"
  • First item
  • Second item
  • Third item
  ... and 21 more
```

### EmptyResult
Consistent empty states:

```tsx
<EmptyResult resource="assets" />
```

Renders: ∅ No assets found

## Modes

### Compact Mode (`compact={true}`)
- Used inline in thinking sections
- Simple text, no borders
- Minimal space usage

```tsx
if (compact) {
  return <CompactResult ... />;
}
```

### Full Mode (`compact={false}`)
- Used in dedicated result sections
- Interactive UI with borders
- Full feature set

```tsx
return (
  <div className="space-y-3">
    <ResultHeader ... />
    <InteractiveContent />
  </div>
);
```

## Current Renderers

### NavigateRenderer ✨ New Pattern
- Uses Magic UI File Tree
- Handles assets, bundles, schemas, runs
- Clean inline metadata
- Both compact and full modes

### SearchWebRenderer
- Web search results
- Result selection
- Ingestion workflow
- Status: Needs migration to new pattern

### SemanticSearchRenderer
- Vector search results
- Chunk highlighting
- Similarity scores
- Status: Needs migration to new pattern

### GetRunDashboardRenderer
- Annotation run dashboards
- Live status updates
- Result visualization
- Status: Needs migration to new pattern

### OrganizeRenderer
- Bundle operations
- Success/failure states
- Status: Needs review

### GenericRenderer
- Fallback for unknown tools
- JSON display
- Always available

## Files

```
toolcalls/
├── core/
│   ├── ToolResultRegistry.tsx    # Central registry
│   ├── ToolResultDisplay.tsx     # Renderer selector
│   └── registerRenderers.ts      # Registration
├── renderers/
│   ├── NavigateRenderer.tsx      # ✨ New pattern reference
│   ├── SearchWebRenderer.tsx
│   ├── SemanticSearchRenderer.tsx
│   ├── GetRunDashboardRenderer.tsx
│   ├── OrganizeRenderer.tsx
│   └── GenericRenderer.tsx
├── viewers/
│   └── AssetTreeViewer.tsx       # Complex tree component
├── shared/
│   ├── types.ts                  # Type definitions
│   ├── utils.tsx                 # Helper functions
│   ├── hooks.ts                  # React hooks
│   ├── ResultComponents.tsx      # ✨ Shared UI primitives
│   └── ToolResultCard.tsx        # Legacy wrapper
├── ARCHITECTURE.md               # Design principles
├── MIGRATION_GUIDE.md            # Migration steps
└── README.md                     # This file
```

## Best Practices

### ✅ Do

- Use `ResultHeader` for metadata (not card headers)
- Implement both compact and full modes
- Use standard spacing (`space-y-3`)
- Use semantic colors (`text-muted-foreground`)
- Make renderers self-contained
- Handle empty states gracefully

### ❌ Don't

- Add extra card wrappers
- Use custom header components
- Implement custom spacing
- Use fixed colors
- Rely on parent styling
- Forget compact mode

## Testing

```tsx
// Test both modes
<YourRenderer result={testData} compact={false} />
<YourRenderer result={testData} compact={true} />

// Test edge cases
<YourRenderer result={{ items: [] }} compact={false} />  // Empty
<YourRenderer result={{ items: many }} compact={false} /> // Long list
```

## Migration Status

- ✅ Core system established
- ✅ Shared components created
- ✅ NavigateRenderer migrated (reference implementation)
- ⏳ SearchWebRenderer - pending
- ⏳ SemanticSearchRenderer - pending
- ⏳ GetRunDashboardRenderer - pending
- ⏳ OrganizeRenderer - review needed

## Contributing

When adding a new tool renderer:

1. Follow NavigateRenderer as reference
2. Use shared ResultComponents
3. Implement both compact and full modes
4. Add to registerRenderers.ts
5. Update this README
6. Test in chat context

## Questions?

- See `ARCHITECTURE.md` for design rationale
- See `MIGRATION_GUIDE.md` for migration steps
- See `NavigateRenderer.tsx` for reference implementation

