# Article Studio - Free-Form Content Composer

## Overview

The Article Studio provides a powerful interface for composing rich articles with embedded assets and bundle references. It replaces the fragmented, verbose asset view components with a unified composition experience.

## Components

### 🎨 ArticleComposer
Main composition interface with:
- Rich text editor with markdown support
- Asset library sidebar for embedding
- Bundle reference management
- Live preview with embedded asset rendering
- Drag & drop asset embedding

### 🧩 AssetEmbed
Universal asset embedding component that renders assets in different modes:
- **inline**: Minimal chip-style display
- **card**: Full preview card with metadata
- **reference**: Simple link to asset
- **attachment**: Download-style listing

### 📖 ComposedArticleView
Enhanced article viewer that:
- Renders embedded assets in-place
- Shows referenced bundles
- Provides editing interface for composed articles
- Supports rich metadata display

### 🎯 MarkdownRenderer
Simple markdown processor for preview mode with support for:
- Headers (# ## ###)
- Bold/italic (**text** *text*)
- Links [text](url)
- Basic lists

## Usage

### Creating Articles

1. Click "Create Article" in Asset Manager
2. Enter title and optional summary
3. Write content in markdown format
4. Embed assets by:
   - Double-clicking from asset library
   - Dragging into content editor
   - Using `{{asset:ID:mode:size}}` syntax
5. Reference bundles from the Bundles tab
6. Preview and save

### Embedding Syntax

```
{{asset:123:card:medium}}     // Embed asset 123 as medium card
{{asset:456:inline:small}}    // Embed asset 456 as small inline
{{asset:789:reference:any}}   // Reference asset 789 as link
```

### Asset Embed Modes

- **inline**: `{{asset:123:inline:small}}` → Chip-style display
- **card**: `{{asset:123:card:medium}}` → Full preview card  
- **reference**: `{{asset:123:reference:any}}` → Simple link
- **attachment**: `{{asset:123:attachment:any}}` → Download listing

## Backend Support

### New Endpoint
`POST /api/v1/infospaces/{id}/assets/compose-article`

### ContentService.compose_article()
Creates article assets with:
- Embedded asset child references
- Bundle references in metadata
- Rich composition metadata
- Proper parent-child relationships

## Data Structure

### Composed Article Metadata
```json
{
  "composition_type": "free_form_article",
  "summary": "Article summary",
  "embedded_assets": [
    {
      "asset_id": 123,
      "mode": "card",
      "size": "medium", 
      "caption": "Custom caption",
      "position": 0
    }
  ],
  "referenced_bundles": [456, 789],
  "metadata": {
    "author": "John Doe",
    "category": "Analysis",
    "tags": ["climate", "policy"]
  }
}
```

## Benefits

✅ **Unified Experience**: Single interface for all content composition
✅ **Rich Embedding**: Multiple display modes for different content types  
✅ **Asset Reuse**: Easy discovery and embedding of existing assets
✅ **Bundle Integration**: Reference related collections
✅ **Live Preview**: See final result before publishing
✅ **Extensible**: Easy to add new embed modes and asset types

## Future Enhancements

- [ ] Drag & drop reordering of embedded assets
- [ ] Rich text editor with WYSIWYG interface
- [ ] Asset mention autocomplete (@asset:name)
- [ ] Template system for common article structures
- [ ] Export to PDF/HTML formats
- [ ] Collaborative editing features
