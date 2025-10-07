# Article View System

Unified article rendering system for all article types in the platform.

## Architecture

### Format Detection
Automatically detects article format based on metadata and content:
- **Composed**: User-authored with `{{asset:...}}` embeds
- **Markdown**: Search results, web scraping
- **HTML**: RSS feeds, web content
- **Text**: Plain text fallback

### Components

**ArticleView.tsx** - Main routing component
- Detects article format
- Routes to appropriate renderer
- Handles featured images and child galleries

**ArticleHeader.tsx** - Shared header for all articles
- Source badge (RSS, Search, Composed, Web)
- Publication date and author
- Tags and metadata
- External link and edit actions

**ArticleFeaturedImage.tsx** - Featured image display
- Uses `top_image` from metadata
- Falls back to first child with `is_hero_image: true`
- Shows media credits

**Renderers:**
- `HtmlArticleRenderer.tsx` - Sanitized HTML for RSS content
- `MarkdownArticleRenderer.tsx` - ReactMarkdown for search/web articles
- `ComposedArticleRenderer.tsx` - Embedded asset rendering

### Usage

```tsx
import { ArticleView } from './Views/article';

<ArticleView
  asset={asset}
  childAssets={childAssets}
  onEdit={handleEdit}
  onAssetClick={handleAssetClick}
/>
```

### Metadata Standards

All articles should have:
```typescript
{
  content_format: 'html' | 'markdown',
  content_source: 'user' | 'rss_feed' | 'search_result' | 'web_scrape',
  author?: string,
  publication_date?: string,
  summary?: string,
  top_image?: string
}
```

## Features

✅ Unified view for all article types  
✅ Format auto-detection  
✅ Featured images with credits  
✅ Related media gallery  
✅ Source badges  
✅ Clean, semantic rendering  
✅ Full TypeScript support
