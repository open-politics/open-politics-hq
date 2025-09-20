import React from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TextSpan {
  start_char_offset: number;
  end_char_offset: number;
  text_snippet: string;
  asset_uuid?: string;
  // Additional fields for tooltip information
  fieldName?: string;
  schemaName?: string;
  justificationReasoning?: string;
  // For colored highlighting
  highlightClassName?: string;
}

interface HighlightedTextProps {
  text: string;
  spans?: TextSpan[];
  className?: string;
  highlightClassName?: string;
  maxLength?: number;
  showContext?: boolean;
  contextLength?: number;
}

interface HighlightSegment {
  text: string;
  highlighted: boolean;
  spanIndex?: number;
}

/**
 * Component that highlights text spans within a larger text using character offsets.
 * Useful for showing justified text with highlighted evidence spans.
 */
export const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  spans = [],
  className = '',
  highlightClassName = 'bg-yellow-200 dark:bg-yellow-800 px-1 rounded',
  maxLength,
  showContext = false,
  contextLength = 50
}) => {
  // Sort spans by start offset to process them in order
  const sortedSpans = React.useMemo(() => {
    return spans
      .filter(span => span.start_char_offset >= 0 && span.end_char_offset <= text.length)
      .sort((a, b) => a.start_char_offset - b.start_char_offset);
  }, [spans, text.length]);

  // If showing context mode, extract highlighted portions with context
  const contextSegments = React.useMemo(() => {
    if (!showContext || sortedSpans.length === 0) return null;

    return sortedSpans.map((span, index) => {
      const start = Math.max(0, span.start_char_offset - contextLength);
      const end = Math.min(text.length, span.end_char_offset + contextLength);
      const contextText = text.slice(start, end);
      
      // Calculate relative positions within the context
      const relativeStart = span.start_char_offset - start;
      const relativeEnd = span.end_char_offset - start;
      
      return {
        contextText,
        highlightStart: relativeStart,
        highlightEnd: relativeEnd,
        original: span.text_snippet,
        hasPrefix: start > 0,
        hasSuffix: end < text.length
      };
    });
  }, [showContext, sortedSpans, text, contextLength]);

  // Build segments for full text highlighting
  const segments = React.useMemo((): HighlightSegment[] => {
    if (showContext || sortedSpans.length === 0) return [];

    const result: HighlightSegment[] = [];
    let currentIndex = 0;

    sortedSpans.forEach((span, spanIndex) => {
      // Add text before this span (if any)
      if (currentIndex < span.start_char_offset) {
        result.push({
          text: text.slice(currentIndex, span.start_char_offset),
          highlighted: false
        });
      }

      // Add the highlighted span
      result.push({
        text: text.slice(span.start_char_offset, span.end_char_offset),
        highlighted: true,
        spanIndex
      });

      currentIndex = Math.max(currentIndex, span.end_char_offset);
    });

    // Add remaining text after all spans
    if (currentIndex < text.length) {
      result.push({
        text: text.slice(currentIndex),
        highlighted: false
      });
    }

    return result;
  }, [sortedSpans, text, showContext]);

  // Truncate text if maxLength is specified
  const displayText = React.useMemo(() => {
    if (!maxLength || text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }, [text, maxLength]);

  if (showContext && contextSegments) {
    return (
      <div className={cn('space-y-2', className)}>
        {contextSegments.map((segment, index) => (
          <div key={index} className="text-sm">
            {segment.hasPrefix && <span className="text-muted-foreground">...</span>}
            <span>
              {segment.contextText.slice(0, segment.highlightStart)}
              <span className={highlightClassName}>
                {segment.contextText.slice(segment.highlightStart, segment.highlightEnd)}
              </span>
              {segment.contextText.slice(segment.highlightEnd)}
            </span>
            {segment.hasSuffix && <span className="text-muted-foreground">...</span>}
          </div>
        ))}
      </div>
    );
  }

  // For regular highlighting mode
  if (segments.length === 0) {
    return (
      <span className={className}>
        {maxLength ? displayText : text}
      </span>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("whitespace-pre-wrap word-break break-words", className)} style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
        {segments.map((segment, index) => {
          if (!segment.highlighted) {
            return (
              <span key={index}>
                {segment.text}
              </span>
            );
          }

          // Find the corresponding span data for tooltip information
          const spanData = segment.spanIndex !== undefined ? sortedSpans[segment.spanIndex] : null;
          const spanHighlightClass = spanData?.highlightClassName || highlightClassName;
          
          // Create unique ID for this span to enable scrolling
          const spanId = spanData ? `span-${spanData.start_char_offset}-${spanData.end_char_offset}` : `highlight-${index}`;
          
          if (spanData && (spanData.fieldName || spanData.schemaName || spanData.justificationReasoning)) {
            return (
              <Tooltip key={index}>
                <TooltipTrigger asChild>
                  <span
                    id={spanId}
                    className={cn(
                      spanHighlightClass,
                      "cursor-help border-b border-dashed border-current px-1 rounded"
                    )}
                  >
                    {segment.text}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-md bg-background border-border shadow-lg z-[1050]">
                  <ScrollArea className="max-h-[300px] w-full overflow-y-auto">
                    <div className="space-y-2 p-2">
                      {spanData.fieldName && (
                        <div className="">
                          Field: {spanData.fieldName}
                        </div>
                      )}
                      {spanData.schemaName && (
                        <div className="text-xs font-semibold text-primary">
                          {spanData.schemaName}
                        </div>
                      )}
                      {spanData.justificationReasoning && (
                        <div className="text-xs text-foreground leading-relaxed">
                          {spanData.justificationReasoning}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground italic border-t pt-2 mt-2">
                        "{spanData.text_snippet}"
                      </div>
                    </div>
                  </ScrollArea>
                </TooltipContent>
              </Tooltip>
            );
          }

          // Fallback for highlighted text without tooltip data
          return (
            <span
              key={index}
              id={spanId}
              className={cn(spanHighlightClass, "px-1 rounded")}
            >
              {segment.text}
            </span>
          );
        })}
      </div>
    </TooltipProvider>
  );
};

/**
 * Component specifically for displaying text span snippets in tooltips or small spaces
 */
export const TextSpanSnippets: React.FC<{
  spans: TextSpan[];
  className?: string;
  maxSnippets?: number;
}> = ({ spans, className, maxSnippets = 5 }) => {
  const displaySpans = spans.slice(0, maxSnippets);
  const remainingCount = spans.length - displaySpans.length;

  return (
    <div className={cn('space-y-1 z-[1002]', className)}>
      {displaySpans.map((span, index) => (
        <div key={index} className="text-xs p-2 bg-muted/50 rounded border-l-2 border-primary">
          <div className="font-medium text-xs mb-1">Text Evidence {index + 1}:</div>
          <div className="text-xs italic">"{span.text_snippet}"</div>
        </div>
      ))}
      {remainingCount > 0 && (
        <div className="text-xs text-muted-foreground italic">
          ... and {remainingCount} more text span{remainingCount > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default HighlightedText; 