---
title: "Assets & Bundles"
description: "Learn how to ingest, organize, and manage multi-modal content in Open Politics HQ through the unified asset system and flexible bundle organization."
---

## Overview

Assets represent content in Open Politics HQ - documents, web articles, images, data files, and media. The system automatically processes different content types and extracts text and metadata for analysis.

Bundles organize related assets into collections for targeted analysis and monitoring.

<CardGroup cols={2}>
  <Card title="Multi-Modal Support" icon="file-lines">
    Process text, images, audio, video, and structured data together in unified workflows
  </Card>
  <Card title="Automatic Processing" icon="magic-wand">
    Smart content extraction from PDFs, web scraping, CSV parsing, and media transcription
  </Card>
  <Card title="Flexible Organization" icon="folder-tree">
    Bundle assets into collections for targeted analysis and automated monitoring
  </Card>
  <Card title="Relationship Mapping" icon="sitemap">
    Automatic parent-child relationships between documents and their components
  </Card>
</CardGroup>

---

## Asset Types & Capabilities

Open Politics HQ supports a comprehensive range of content types, each with specialized processing capabilities:

### Documents & Text

<Tabs>
<Tab title="PDF Documents">
  **Processing**: Automatic text extraction with page-by-page breakdown
  
  - Extract text content from each page
  - Preserve document structure and metadata  
  - Handle scanned PDFs with OCR capabilities
  - Create child assets for individual pages
  
  **Use Cases**: Research papers, government documents, reports, legislation
</Tab>

<Tab title="Web Articles">
  **Processing**: Intelligent content scraping with media extraction
  
  - Extract clean article text and metadata
  - Identify and download associated images
  - Parse publication dates and author information
  - Handle RSS feeds and bulk URL processing
  
  **Use Cases**: News monitoring, blog analysis, social media tracking
</Tab>

<Tab title="Text Content">
  **Processing**: Direct text ingestion with metadata support
  
  - Raw text blocks with custom metadata
  - Structured article creation with embedded assets
  - Support for markdown and rich text formatting
  
  **Use Cases**: Interview transcripts, survey responses, social media posts
</Tab>
</Tabs>

### Structured Data

<Tabs>
<Tab title="CSV Files">
  **Processing**: Intelligent parsing with row-level asset creation
  
  - Automatic delimiter detection
  - Header row identification and validation
  - Create individual assets for each data row
  - Support for large files with streaming processing
  
  **Use Cases**: Survey data, financial records, voting data, statistical datasets
</Tab>

<Tab title="Email Archives">
  **Processing**: MBOX file parsing with thread reconstruction
  
  - Extract individual emails as separate assets
  - Preserve sender, recipient, and timestamp metadata
  - Maintain thread relationships between emails
  
  **Use Cases**: FOIA responses, leaked communications, organizational correspondence
</Tab>
</Tabs>

### Media Files

<Tabs>
<Tab title="Images">
  **Processing**: Visual content analysis and metadata extraction
  
  - Extract EXIF data and technical metadata
  - Support for JPG, PNG, GIF, WebP formats
  - Integration with multi-modal analysis workflows
  
  **Use Cases**: Protest photos, infographics, social media images, satellite imagery
</Tab>

<Tab title="Audio & Video">
  **Processing**: Transcription and content analysis (Coming Soon)
  
  - Automatic speech-to-text transcription
  - Speaker identification and segmentation
  - Visual scene analysis for video content
  
  **Use Cases**: Interviews, speeches, hearing recordings, broadcast content
</Tab>
</Tabs>

---

## Content Ingestion Methods

Open Politics HQ provides multiple ways to bring content into your workspace, each optimized for different use cases and data sources.

### File Upload

The most direct way to add content - drag and drop files or use the upload interface.

<Steps>
<Step title="Select Content Type">
  Choose the appropriate asset type for your content:
  - **PDF** for document analysis
  - **CSV** for structured data processing  
  - **Images** for visual content analysis
  - **Text** for direct content input
  
  *[Screenshot: Asset type selection interface]*
</Step>

<Step title="Configure Processing">
  Set processing options based on your needs:
  - **PDF Processing**: Page limits, image extraction, OCR settings
  - **CSV Processing**: Delimiter detection, encoding options, row limits
  - **Web Content**: Image extraction, content filtering, timeout settings
  
  *[Screenshot: Processing options configuration]*
</Step>

<Step title="Add to Bundle">
  Optionally add the asset to an existing bundle for organization and automated processing.
  
  *[Screenshot: Bundle selection during upload]*
</Step>
</Steps>

### Web Content Ingestion

Powerful web scraping capabilities for monitoring online sources.

<Tabs>
<Tab title="Single URL">
  **Process individual web pages**
  
  Enter a URL and the system will:
  - Extract clean article text
  - Download associated images
  - Parse metadata (author, date, tags)
  - Create child assets for media content
  
  *[Screenshot: Single URL ingestion interface]*
</Tab>

<Tab title="Bulk URLs">
  **Process multiple URLs at once**
  
  Upload a list of URLs or paste them directly:
  - Batch processing with rate limiting
  - Automatic retry for failed URLs
  - Progress tracking for large batches
  
  *[Screenshot: Bulk URL processing interface]*
</Tab>

<Tab title="RSS Feeds">
  **Monitor RSS feeds automatically**
  
  Add RSS feed URLs to automatically collect new articles:
  - Configurable item limits
  - Full content scraping
  - Automatic scheduling for updates
  
  *[Screenshot: RSS feed configuration]*
</Tab>
</Tabs>

### Search-Based Discovery

Transform web searches into analyzed datasets automatically.

<Info>
**Search Integration**: Use the built-in search feature to find relevant content across the web, then automatically import and process the results as assets in your workspace.
</Info>

*[Screenshot: Search-based content discovery interface]*

---

## Asset Relationships & Hierarchy

Open Politics HQ automatically creates relationships between assets to preserve document structure and enable sophisticated analysis workflows.

### Parent-Child Relationships

When processing complex documents, the system creates hierarchical relationships:

<Tabs>
<Tab title="PDF Processing">
  ```
  📄 "Research Report.pdf" (parent)
  ├── 📝 "Page 1" (child, extracted text)
  ├── 📝 "Page 2" (child, extracted text)  
  ├── 📝 "Page 3" (child, extracted text)
  └── 🖼️ "Figure 1" (child, extracted image)
  ```
  
  Each page becomes a separate asset for targeted analysis while maintaining connection to the source document.
</Tab>

<Tab title="Web Article Processing">
  ```
  🌐 "News Article" (parent)
  ├── 🖼️ "Featured Image" (child, role="featured")
  ├── 🖼️ "Chart 1" (child, role="content")
  └── 🖼️ "Photo Gallery" (child, role="content")
  ```
  
  Images are extracted and categorized by their role in the article structure.
</Tab>

<Tab title="CSV Processing">
  ```
  📊 "Survey Data.csv" (parent)
  ├── 📋 "Row 1: Respondent 001" (child)
  ├── 📋 "Row 2: Respondent 002" (child)
  ├── 📋 "Row 3: Respondent 003" (child)
  └── ... (additional rows)
  ```
  
  Each row becomes an individual asset for granular analysis and filtering.
</Tab>
</Tabs>

### Cross-References & Versioning

<Info>
**Smart Deduplication**: The system automatically detects and handles duplicate content, creating version chains for updated documents while preserving analysis history.
</Info>

**Version Tracking**: When the same source is updated, new versions are linked to previous ones:
```json Version Chain
{
  "current_asset_id": 1005,
  "previous_asset_id": 1001,
  "source_metadata": {
    "version": 2,
    "content_hash": "sha256:abc123...",
    "changes_detected": ["content_updated", "new_images"]
  }
}
```

---

## Bundle Organization

Bundles provide flexible organization for your assets, enabling targeted analysis and automated monitoring workflows.

### Creating & Managing Bundles

<Steps>
<Step title="Create Bundle">
  Define a logical collection of assets:
  
  ```json Bundle Creation
  {
    "name": "Climate Policy Analysis",
    "description": "Articles and documents related to climate policy changes",
    "asset_ids": [101, 102, 103],
    "bundle_metadata": {
      "research_project": "Climate-2024",
      "data_source": "news_monitoring",
      "collection_period": "2024-Q1"
    }
  }
  ```
</Step>

<Step title="Add Assets">
  Assets can be added to bundles during ingestion or after processing:
  
  <CodeGroup>
  ```bash During Ingestion
  curl -X POST "/api/v1/content/ingest" \
    -d '{
      "locator": "https://example.com/article",
      "bundle_id": 123
    }'
  ```
  
  ```bash After Processing
  curl -X POST "/api/v1/bundles/{id}/assets" \
    -d '{"asset_id": 456}'
  ```
  </CodeGroup>
</Step>

<Step title="Monitor Changes">
  Set up automated monitoring to analyze new assets as they're added to bundles (see [Monitors documentation](/monitors)).
</Step>
</Steps>

### Bundle Use Cases

<CardGroup cols={2}>
  <Card title="Topic Collections" icon="tags">
    **Example**: "Election Coverage 2024"
    
    Group all assets related to a specific topic or event for comprehensive analysis.
  </Card>
  
  <Card title="Source Monitoring" icon="rss">
    **Example**: "Government Press Releases"
    
    Automatically collect and analyze content from specific sources or feeds.
  </Card>
  
  <Card title="Time-Based Analysis" icon="calendar">
    **Example**: "Weekly News Digest"
    
    Organize assets by time periods for trend analysis and temporal comparisons.
  </Card>
  
  <Card title="Research Projects" icon="flask">
    **Example**: "Coalition Analysis Study"
    
    Collect diverse assets for specific research questions or academic studies.
  </Card>
</CardGroup>

---

## Advanced Asset Management

### Content Processing Options

Fine-tune how different content types are processed:

<Tabs>
<Tab title="PDF Processing">
  ```json PDF Options
  {
    "max_pages": 1000,
    "extract_images": true,
    "ocr_enabled": true,
    "preserve_formatting": false,
    "language_hint": "en"
  }
  ```
  
  - **OCR Support**: Handle scanned documents
  - **Image Extraction**: Pull out charts and figures  
  - **Page Limits**: Control processing scope for large documents
</Tab>

<Tab title="Web Scraping">
  ```json Web Options
  {
    "timeout": 30,
    "max_images": 8,
    "follow_redirects": true,
    "extract_metadata": true,
    "content_filters": {
      "min_content_length": 500,
      "exclude_patterns": ["advertisement", "cookie-notice"]
    }
  }
  ```
  
  - **Smart Filtering**: Remove ads and boilerplate content
  - **Metadata Extraction**: Author, publish date, tags
  - **Image Processing**: Automatic image discovery and download
</Tab>

<Tab title="CSV Processing">
  ```json CSV Options
  {
    "delimiter": "auto",
    "encoding": "utf-8",
    "skip_rows": 0,
    "max_rows": 50000,
    "column_mapping": {
      "date_column": "timestamp",
      "text_column": "content"
    }
  }
  ```
  
  - **Auto-Detection**: Delimiter and encoding detection
  - **Large File Support**: Streaming processing for big datasets
  - **Column Mapping**: Identify key columns for analysis
</Tab>
</Tabs>

### Asset Search & Discovery

<Tabs>
<Tab title="Text Search">
  Fast keyword-based search across all asset content:
  
  ```bash Text Search
  curl -X GET "/api/v1/assets/search" \
    -G -d "q=climate policy" \
    -d "asset_kinds=pdf,web" \
    -d "limit=20"
  ```
</Tab>

<Tab title="Semantic Search">
  AI-powered similarity search using embeddings:
  
  ```bash Semantic Search  
  curl -X POST "/api/v1/embeddings/search" \
    -d '{
      "query_text": "renewable energy legislation",
      "similarity_threshold": 0.7,
      "top_k": 10
    }'
  ```
</Tab>

<Tab title="Hybrid Search">
  Combine text and semantic search for best results:
  
  ```bash Hybrid Search
  curl -X GET "/api/v1/assets/search" \
    -G -d "q=carbon tax implementation" \
    -d "method=hybrid" \
    -d "semantic_weight=0.6"
  ```
</Tab>
</Tabs>

### Asset Metadata & Enrichment

Assets automatically collect rich metadata during processing:

- **File Information**: Original filename, size, format details
- **Processing Details**: Extraction settings, page counts, processing timestamps
- **Content Metadata**: Author, creation date, publication information
- **Analysis Fragments**: Curated findings promoted from analysis results
- **Relationship Data**: Parent-child connections and cross-references

*[Screenshot: Asset metadata viewer showing rich information]*

---

## Best Practices

### Content Organization Strategy

<Steps>
<Step title="Plan Your Bundle Structure">
  Think about how you'll analyze your content:
  
  - **By Topic**: Group related content for thematic analysis
  - **By Source**: Monitor specific publishers or feeds  
  - **By Time**: Track changes and trends over time
  - **By Project**: Organize around research questions
</Step>

<Step title="Use Descriptive Metadata">
  Add meaningful titles and descriptions:
  
  **Example**: "Senate Climate Bill - Final Version" with description "Final text of S.123 climate legislation with amendments" and relevant metadata tags.
  
  *[Screenshot: Metadata configuration interface]*
</Step>

<Step title="Configure Processing Appropriately">
  Match processing settings to your analysis needs:
  
  - **Research Documents**: Enable OCR, extract images, preserve formatting
  - **News Monitoring**: Fast processing, focus on text content
  - **Data Analysis**: Careful CSV parsing, validate column structures
</Step>
</Steps>

### Performance Optimization

<Tip>
**Large File Handling**: For files over 100MB, use streaming processing options and consider breaking large datasets into smaller chunks for faster analysis.
</Tip>

<Warning>
**Rate Limiting**: When processing many web URLs, add delays between requests to avoid being blocked by target sites. Use the built-in rate limiting options.
</Warning>

### Data Quality & Validation

<Check>
**Content Validation**: Always review automatically extracted content for accuracy, especially with scanned documents or complex web pages.
</Check>

<Steps>
<Step title="Verify Extraction Quality">
  Check a sample of processed assets to ensure content extraction meets your needs.
</Step>

<Step title="Handle Processing Errors">
  Monitor assets with `processing_status: "failed"` and adjust settings as needed.
</Step>

<Step title="Validate Relationships">
  Ensure parent-child relationships make sense for your analysis workflows.
</Step>
</Steps>

---

## Common Workflows

### Research Project Setup

<Steps>
<Step title="Create Project Bundle">
  Start by creating a bundle for your research project to organize all related content.
  
  *[Screenshot: Bundle creation interface]*
</Step>

<Step title="Gather Initial Content">
  Upload your initial documents, articles, and data files:
  - Drag and drop PDF documents
  - Add relevant web articles via URL
  - Import structured data from CSV files
  
  *[Screenshot: Multi-file upload interface]*
</Step>

<Step title="Monitor for New Content">
  Set up RSS feeds or search monitors to automatically collect new relevant content as it becomes available.
  
  *[Screenshot: RSS feed and search monitor setup]*
</Step>
</Steps>

### News Monitoring Workflow

<Steps>
<Step title="Set Up Content Sources">
  Configure RSS feeds, news sites, and search queries to automatically collect relevant articles.
</Step>

<Step title="Organize by Topic">
  Create bundles for different topics or themes you're tracking.
</Step>

<Step title="Enable Auto-Processing">
  Set up monitors to automatically analyze new content as it arrives.
</Step>
</Steps>

### Data Analysis Workflow

<Steps>
<Step title="Import Structured Data">
  Upload CSV files, spreadsheets, or database exports containing your research data.
</Step>

<Step title="Validate Data Quality">
  Review the automatically parsed data structure and adjust settings if needed.
</Step>

<Step title="Prepare for Analysis">
  Organize data into logical bundles based on your analysis questions.
</Step>
</Steps>

---

The asset and bundle system provides the foundation for all analysis in Open Politics HQ. With flexible ingestion options, automatic processing, and intelligent organization, you can quickly build comprehensive datasets for any research question.

Next, learn how to analyze your assets using [Annotation Schemas](/annotation-schemas) or explore [Chat Tools](/chat-tools) for interactive analysis.
