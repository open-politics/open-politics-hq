import React from 'react';
import { ArticleRendererProps } from './types';
import DOMPurify from 'dompurify';

export default function HtmlArticleRenderer({ content }: ArticleRendererProps) {
  if (!content) {
    return (
      <div className="text-muted-foreground italic">
        No content available
      </div>
    );
  }
  
  // Sanitize HTML content
  const sanitizedHtml = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
      'blockquote', 'code', 'pre',
      'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span'
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'class']
  });

  return (
    <div 
      className="prose prose-sm md:prose-base dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      style={{
        // Enhance HTML styling
        '--tw-prose-links': 'rgb(59 130 246)',
        '--tw-prose-bold': 'rgb(17 24 39)',
      } as React.CSSProperties}
    />
  );
}
