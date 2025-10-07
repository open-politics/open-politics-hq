'use client'

import { marked } from 'marked'
import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown)
  return tokens.map(token => token.raw)
}

const MemoizedMarkdownBlock = memo(
  ({ content }: { content: string }) => {
    return (
      <ReactMarkdown
        components={{
          p: ({ node, children, ...props }) => (
            <p {...props} className="mb-4 last:mb-0">{children}</p>
          ),
          h1: ({ node, children, ...props }) => (
            <h1 {...props} className="text-2xl font-bold mb-4 mt-6 first:mt-0">{children}</h1>
          ),
          h2: ({ node, children, ...props }) => (
            <h2 {...props} className="text-xl font-bold mb-3 mt-5 first:mt-0">{children}</h2>
          ),
          h3: ({ node, children, ...props }) => (
            <h3 {...props} className="text-lg font-semibold mb-2 mt-4 first:mt-0">{children}</h3>
          ),
          ul: ({ node, children, ...props }) => (
            <ul {...props} className="list-disc list-inside mb-4 space-y-1">{children}</ul>
          ),
          ol: ({ node, children, ...props }) => (
            <ol {...props} className="list-decimal list-inside mb-4 space-y-1">{children}</ol>
          ),
          a: ({ node, children, ...props }) => (
            <a 
              {...props} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {children}
            </a>
          ),
          code: ({ node, inline, children, ...props }: any) => 
            inline ? (
              <code className="bg-muted px-1 py-0.5 rounded text-sm" {...props}>{children}</code>
            ) : (
              <code className="block bg-muted p-3 rounded-lg overflow-x-auto text-sm mb-4" {...props}>{children}</code>
            ),
          blockquote: ({ node, children, ...props }) => (
            <blockquote {...props} className="border-l-4 border-muted-foreground/20 pl-4 italic mb-4">{children}</blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    )
  },
  (prevProps, nextProps) => {
    if (prevProps.content !== nextProps.content) return false
    return true
  }
)

MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock'

export const MemoizedMarkdown = memo(
  ({ content, id }: { content: string; id: string }) => {
    const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content])

    return blocks.map((block, index) => (
      <MemoizedMarkdownBlock content={block} key={`${id}-block_${index}`} />
    ))
  }
)

MemoizedMarkdown.displayName = 'MemoizedMarkdown'

