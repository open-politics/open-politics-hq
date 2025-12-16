import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import MarkdownArticleRenderer from './MarkdownArticleRenderer';

interface TextContentRendererProps {
  content: string;
  className?: string;
}

type ContentType = 'html' | 'markdown' | 'plaintext';

/**
 * TextContentRenderer - Universal content renderer
 * 
 * Auto-detects content type and routes to appropriate renderer:
 * - HTML → sanitized HTML with enhanced structure
 * - Markdown → MarkdownArticleRenderer (with GFM tables support)
 * - Plain text → paragraph-aware text rendering
 */
export default function TextContentRenderer({ content, className = '' }: TextContentRendererProps) {
  if (!content) {
    return (
      <div className="text-muted-foreground italic">
        No content available
      </div>
    );
  }

  const { contentType, processedContent } = useMemo(() => {
    const type = detectContentType(content);
    const processed = type === 'html' ? enhanceHtmlStructure(content) : content;
    return { contentType: type, processedContent: processed };
  }, [content]);

  const baseClass = `prose prose-sm md:prose-base dark:prose-invert max-w-none ${className}`.trim();

  switch (contentType) {
    case 'html':
      return (
        <div 
          className={`${baseClass} 
            [&_a]:text-primary [&_a]:hover:underline 
            [&_img]:rounded-lg [&_img]:my-4
            [&_p]:mb-4 [&_p]:leading-relaxed
            [&_br+br]:block [&_br+br]:h-4`}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(processedContent) }}
        />
      );
    
    case 'markdown':
      // Use existing MarkdownArticleRenderer with GFM support
      return (
        <MarkdownArticleRenderer 
          content={processedContent} 
          asset={null as any} // Not needed for rendering
          className={className}
        />
      );
    
    case 'plaintext':
    default:
      return (
        <article className={baseClass}>
          {renderPlainText(processedContent)}
        </article>
      );
  }
}

/**
 * Detect content type based on content patterns
 * Priority: Markdown > HTML > Plain text
 */
function detectContentType(text: string): ContentType {
  // Check for STRONG markdown indicators FIRST - these take priority over HTML
  const strongMarkdownPatterns = [
    /^#{1,6}\s+\S/m,        // Headers: # followed by space and text
    /^\|.+\|$/m,            // Tables: |content|
    /^\|[-:]+\|/m,          // Table separators: |---|, |:--|, etc.
    /```[\s\S]*?```/,       // Code blocks
  ];
  
  if (strongMarkdownPatterns.some(pattern => pattern.test(text))) {
    return 'markdown';
  }
  
  // Weaker markdown patterns - need 2+ to be confident
  const weakMarkdownPatterns = [
    /\[.+\]\(.+\)/,         // Links [text](url)
    /\*\*.+\*\*/,           // Bold **text**
    /(?<!\*)\*[^*]+\*(?!\*)/,  // Italic *text* (not bold)
    /^\s*[-*+]\s+\S/m,      // Unordered lists (with content after)
    /^\s*\d+\.\s+\S/m,      // Ordered lists (with content after)
    /^\s*>\s/m,             // Blockquotes
    /^---$/m,               // Horizontal rules
  ];
  
  const weakMatchCount = weakMarkdownPatterns.filter(pattern => pattern.test(text)).length;
  if (weakMatchCount >= 2) {
    return 'markdown';
  }
  
  // Now check for HTML tags
  const htmlTagMatch = text.match(/<\/?[a-z][^>]*>/gi);
  if (htmlTagMatch && htmlTagMatch.length >= 2) {
    return 'html';
  }
  
  // Single weak markdown pattern + any HTML = markdown (mixed content)
  if (weakMatchCount >= 1 && htmlTagMatch && htmlTagMatch.length >= 1) {
    return 'markdown';
  }
  
  // Single HTML tag - try HTML
  if (htmlTagMatch && htmlTagMatch.length >= 1) {
    return 'html';
  }
  
  return 'plaintext';
}

/**
 * Enhance HTML structure - convert flat HTML to proper paragraphs
 */
function enhanceHtmlStructure(html: string): string {
  const hasBlockStructure = /<(p|div|h[1-6]|ul|ol|blockquote|article|section)[^>]*>/i.test(html);
  
  if (hasBlockStructure) {
    return html;
  }
  
  let processed = html
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  
  // Convert double <br> to paragraph breaks
  processed = processed.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '</p><p>');
  
  // Convert double newlines to paragraph breaks
  processed = processed.replace(/\n\s*\n/g, '</p><p>');
  
  // Wrap in paragraph tags
  if (!processed.startsWith('<p>')) {
    processed = '<p>' + processed;
  }
  if (!processed.endsWith('</p>')) {
    processed = processed + '</p>';
  }
  
  // Clean up empty paragraphs
  processed = processed.replace(/<p>\s*<\/p>/g, '');
  processed = processed.replace(/<p>(\s|&nbsp;)*<\/p>/g, '');
  
  return processed;
}

/**
 * Sanitize HTML content
 */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
      'blockquote', 'code', 'pre',
      'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span', 'article', 'section'
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'class']
  });
}

/**
 * Render plain text with proper paragraph handling
 */
function renderPlainText(text: string): React.ReactNode[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);
  
  return paragraphs.map((paragraph, index) => {
    const trimmed = paragraph.trim();
    if (!trimmed) return null;
    
    // Blockquotes
    if (trimmed.startsWith('>') || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return (
        <blockquote 
          key={index}
          className="border-l-4 border-primary/30 pl-4 italic text-muted-foreground my-4"
        >
          {processInlineContent(trimmed.replace(/^[>"]\s*/, '').replace(/"$/, ''))}
        </blockquote>
      );
    }
    
    // Bullet lists
    const lines = trimmed.split('\n');
    const isBulletList = lines.length > 1 && lines.every(line => 
      /^[\s]*[-•*]\s/.test(line) || line.trim() === ''
    );
    
    if (isBulletList) {
      return (
        <ul key={index} className="list-disc pl-6 my-4 space-y-1">
          {lines.filter(line => line.trim()).map((line, i) => (
            <li key={i} className="text-foreground">
              {processInlineContent(line.replace(/^[\s]*[-•*]\s*/, ''))}
            </li>
          ))}
        </ul>
      );
    }
    
    // Numbered lists
    const isNumberedList = lines.length > 1 && lines.every(line => 
      /^[\s]*\d+[.)]\s/.test(line) || line.trim() === ''
    );
    
    if (isNumberedList) {
      return (
        <ol key={index} className="list-decimal pl-6 my-4 space-y-1">
          {lines.filter(line => line.trim()).map((line, i) => (
            <li key={i} className="text-foreground">
              {processInlineContent(line.replace(/^[\s]*\d+[.)]\s*/, ''))}
            </li>
          ))}
        </ol>
      );
    }
    
    // Regular paragraph
    return (
      <p key={index} className="mb-4 leading-relaxed text-foreground">
        {processInlineContent(trimmed)}
      </p>
    );
  }).filter(Boolean);
}

/**
 * Process inline content - URLs, line breaks
 */
function processInlineContent(text: string): React.ReactNode {
  const urlPattern = /(https?:\/\/[^\s<>\"]+)/g;
  const parts = text.split(urlPattern);
  
  if (parts.length === 1) {
    return renderWithLineBreaks(text);
  }
  
  return parts.map((part, index) => {
    if (urlPattern.test(part)) {
      urlPattern.lastIndex = 0;
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 underline break-all"
        >
          {part.length > 60 ? part.substring(0, 57) + '...' : part}
        </a>
      );
    }
    return <React.Fragment key={index}>{renderWithLineBreaks(part)}</React.Fragment>;
  });
}

function renderWithLineBreaks(text: string): React.ReactNode {
  const lines = text.split('\n');
  if (lines.length === 1) return text;
  
  return lines.map((line, index) => (
    <React.Fragment key={index}>
      {line}
      {index < lines.length - 1 && <br />}
    </React.Fragment>
  ));
}

export { detectContentType, sanitizeHtml, enhanceHtmlStructure };
export type { ContentType };
