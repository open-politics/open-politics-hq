import React from 'react';
import ReactMarkdown from 'react-markdown';
import { ArticleRendererProps } from './types';

export default function MarkdownArticleRenderer({ content }: ArticleRendererProps) {
  if (!content) {
    return (
      <div className="text-muted-foreground italic">
        No content available
      </div>
    );
  }

  return (
    <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none">
      <ReactMarkdown
        components={{
          // Custom link handling
          a: ({ node, ...props }) => (
            <a 
              {...props} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
            />
          ),
          // Custom image handling
          img: ({ node, alt, ...props }) => (
            <img 
              {...props}
              alt={alt || ''}
              className="rounded-lg max-w-full h-auto my-4"
              loading="lazy"
            />
          ),
          // Code blocks
          code: ({ node, inline, ...props }: any) => 
            inline ? (
              <code className="bg-muted px-1 py-0.5 rounded text-sm" {...props} />
            ) : (
              <code className="block bg-muted p-4 rounded-lg overflow-x-auto text-sm" {...props} />
            )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
