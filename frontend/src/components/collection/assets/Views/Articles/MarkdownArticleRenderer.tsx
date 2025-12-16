import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArticleRendererProps } from './types';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * MarkdownArticleRenderer - Full-featured markdown renderer
 * 
 * Supports GitHub Flavored Markdown including:
 * - Tables, strikethrough, task lists
 * - Headers, lists, blockquotes
 * - Links, images, code blocks
 */
export default function MarkdownArticleRenderer({ content, className }: ArticleRendererProps & { className?: string }) {
  if (!content) {
    return (
      <div className="text-muted-foreground italic">
        No content available
      </div>
    );
  }

  return (
    <div className={cn(
      "prose prose-sm md:prose-base dark:prose-invert max-w-none",
      // Table styling
      "[&_table]:w-full [&_table]:border-collapse [&_table]:my-4",
      "[&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:bg-muted [&_th]:text-left [&_th]:font-semibold",
      "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
      "[&_tr:hover]:bg-muted/50",
      className
    )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headers
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mt-6 mb-4">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-semibold mt-5 mb-3">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>
          ),
          // Paragraphs
          p: ({ children }) => (
            <p className="mb-4 leading-relaxed">{children}</p>
          ),
          // Links
          a: ({ node, ...props }) => (
            <a 
              {...props} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            />
          ),
          // Images
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
            ),
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/30 pl-4 italic text-muted-foreground my-4">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
