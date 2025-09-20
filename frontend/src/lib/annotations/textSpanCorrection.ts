/**
 * Text Span Auto-Correction Utilities
 * 
 * This module provides functions to automatically correct and validate text spans
 * to ensure they align with proper sentence boundaries and provide better highlighting.
 */

export interface TextSpan {
  start_char_offset: number;
  end_char_offset: number;
  text_snippet: string;
  asset_uuid?: string;
  // Additional fields for tooltip information
  fieldName?: string;
  schemaName?: string;
  justificationReasoning?: string;
}

export interface CorrectedTextSpan extends TextSpan {
  was_corrected: boolean;
  original_start?: number;
  original_end?: number;
  correction_reason?: string;
}

export interface SpanCorrectionOptions {
  /** Whether to extend spans to sentence boundaries */
  alignToSentences: boolean;
  /** Whether to extend spans to word boundaries if sentence alignment fails */
  alignToWords: boolean;
  /** Maximum distance to search for boundaries (characters) */
  maxSearchDistance: number;
  /** Minimum span length to consider valid */
  minSpanLength: number;
  /** Maximum span length to prevent overly long highlights */
  maxSpanLength: number;
  /** Whether to merge overlapping spans */
  mergeOverlapping: boolean;
  /** Whether to remove spans that are entirely whitespace */
  removeWhitespaceOnly: boolean;
}

export const DEFAULT_CORRECTION_OPTIONS: SpanCorrectionOptions = {
  alignToSentences: true,
  alignToWords: true,
  maxSearchDistance: 200,
  minSpanLength: 10,
  maxSpanLength: 500,
  mergeOverlapping: true,
  removeWhitespaceOnly: true,
};

/**
 * Find text snippet in the full text using intelligent search
 */
export function findTextSnippetPosition(
  fullText: string,
  snippet: string,
  options: { 
    caseSensitive?: boolean; 
    allowPartialMatch?: boolean;
    minMatchLength?: number;
  } = {}
): { start: number; end: number; confidence: number } | null {
  if (!fullText || !snippet) return null;
  
  const { caseSensitive = false, allowPartialMatch = true, minMatchLength = 10 } = options;
  const searchText = caseSensitive ? fullText : fullText.toLowerCase();
  const searchSnippet = caseSensitive ? snippet.trim() : snippet.trim().toLowerCase();
  
  if (searchSnippet.length < 3) return null;
  
  // Strategy 1: Exact match
  const exactIndex = searchText.indexOf(searchSnippet);
  if (exactIndex !== -1) {
    return {
      start: exactIndex,
      end: exactIndex + searchSnippet.length,
      confidence: 1.0
    };
  }
  
  // Strategy 2: Match with normalized whitespace
  const normalizedSnippet = searchSnippet.replace(/\s+/g, ' ');
  const normalizedText = searchText.replace(/\s+/g, ' ');
  const normalizedIndex = normalizedText.indexOf(normalizedSnippet);
  if (normalizedIndex !== -1) {
    // Find the original position by mapping back through whitespace differences
    let originalStart = 0;
    let normalizedPos = 0;
    
    while (normalizedPos < normalizedIndex && originalStart < fullText.length) {
      if (/\s/.test(fullText[originalStart])) {
        // Skip consecutive whitespace in original text
        while (originalStart < fullText.length && /\s/.test(fullText[originalStart])) {
          originalStart++;
        }
        normalizedPos++;
      } else {
        originalStart++;
        normalizedPos++;
      }
    }
    
    return {
      start: originalStart,
      end: originalStart + searchSnippet.length, // Approximate
      confidence: 0.9
    };
  }
  
  // Strategy 3: Partial matching for longer snippets
  if (allowPartialMatch && searchSnippet.length >= minMatchLength) {
    const words = searchSnippet.split(/\s+/).filter(w => w.length >= 3);
    if (words.length >= 2) {
      // Try to find a sequence of words
      for (let i = 0; i < words.length - 1; i++) {
        const wordPair = words[i] + '.*?' + words[i + 1];
        const regex = new RegExp(wordPair, caseSensitive ? 'g' : 'gi');
        const match = regex.exec(searchText);
        if (match) {
          return {
            start: match.index,
            end: match.index + match[0].length,
            confidence: 0.7
          };
        }
      }
      
      // Try first and last word
      if (words.length >= 3) {
        const firstLastPattern = words[0] + '.*?' + words[words.length - 1];
        const regex = new RegExp(firstLastPattern, caseSensitive ? 'g' : 'gi');
        const match = regex.exec(searchText);
        if (match) {
          return {
            start: match.index,
            end: match.index + match[0].length,
            confidence: 0.6
          };
        }
      }
    }
  }
  
  return null;
}

/**
 * Find sentence boundaries near a given position
 */
export function findSentenceBoundaries(
  text: string,
  position: number,
  maxDistance: number = 200
): { start: number; end: number } | null {
  // Sentence ending patterns
  const sentenceEndPattern = /[.!?]+[\s\n\r]*$/;
  const sentenceStartPattern = /^[\s\n\r]*[A-Z]/;
  
  // Search backwards for sentence start
  let sentenceStart = position;
  for (let i = position; i >= Math.max(0, position - maxDistance); i--) {
    const prevChar = text[i - 1];
    const currentChar = text[i];
    
    // Look for sentence ending followed by whitespace and capital letter
    if (prevChar && sentenceEndPattern.test(prevChar) && 
        currentChar && sentenceStartPattern.test(currentChar)) {
      sentenceStart = i;
      break;
    }
    
    // Also consider paragraph breaks as sentence boundaries
    if (i > 0 && text.slice(i - 2, i) === '\n\n') {
      sentenceStart = i;
      break;
    }
  }
  
  // If we're at the very beginning, start from 0
  if (sentenceStart === position && position < maxDistance) {
    sentenceStart = 0;
  }
  
  // Search forwards for sentence end
  let sentenceEnd = position;
  for (let i = position; i <= Math.min(text.length, position + maxDistance); i++) {
    const currentChar = text[i];
    const nextChar = text[i + 1];
    
    // Look for sentence ending
    if (currentChar && /[.!?]/.test(currentChar)) {
      // Include trailing whitespace and punctuation
      let endPos = i + 1;
      while (endPos < text.length && /[\s\n\r]/.test(text[endPos])) {
        endPos++;
      }
      sentenceEnd = endPos;
      break;
    }
    
    // Also consider paragraph breaks
    if (i < text.length - 1 && text.slice(i, i + 2) === '\n\n') {
      sentenceEnd = i;
      break;
    }
  }
  
  // If we couldn't find proper boundaries, return null
  if (sentenceStart === position && sentenceEnd === position) {
    return null;
  }
  
  return { start: sentenceStart, end: Math.min(sentenceEnd, text.length) };
}

/**
 * Find word boundaries near a given position
 */
export function findWordBoundaries(
  text: string,
  position: number,
  maxDistance: number = 50
): { start: number; end: number } | null {
  // Search backwards for word start
  let wordStart = position;
  for (let i = position; i >= Math.max(0, position - maxDistance); i--) {
    if (i === 0 || /\s/.test(text[i - 1])) {
      wordStart = i;
      break;
    }
  }
  
  // Search forwards for word end
  let wordEnd = position;
  for (let i = position; i <= Math.min(text.length, position + maxDistance); i++) {
    if (i === text.length || /\s/.test(text[i])) {
      wordEnd = i;
      break;
    }
  }
  
  return { start: wordStart, end: wordEnd };
}

/**
 * Auto-correct a single text span using intelligent text search
 */
export function correctTextSpan(
  text: string,
  span: TextSpan,
  options: SpanCorrectionOptions = DEFAULT_CORRECTION_OPTIONS
): CorrectedTextSpan {
  const result: CorrectedTextSpan = {
    ...span,
    was_corrected: false,
  };
  
  const originalStart = span.start_char_offset;
  const originalEnd = span.end_char_offset;
  
  // Primary strategy: Find text by content search
  const searchResult = findTextSnippetPosition(text, span.text_snippet);
  
  if (searchResult && searchResult.confidence >= 0.6) {
    console.log(`[TextSpanCorrection] Found "${span.text_snippet.slice(0, 50)}..." at position ${searchResult.start}-${searchResult.end} (confidence: ${searchResult.confidence.toFixed(2)})`);
    // Found the text, use search-based position
    let { start, end } = searchResult;
    
    // Apply boundary corrections to the found text
    if (options.alignToSentences) {
      const sentenceBounds = findSentenceBoundaries(text, Math.floor((start + end) / 2), options.maxSearchDistance);
      if (sentenceBounds && sentenceBounds.end - sentenceBounds.start <= options.maxSpanLength) {
        start = sentenceBounds.start;
        end = sentenceBounds.end;
        result.correction_reason = `Text found (confidence: ${searchResult.confidence.toFixed(1)}) and aligned to sentences`;
      } else {
        result.correction_reason = `Text found (confidence: ${searchResult.confidence.toFixed(1)})`;
      }
    } else if (options.alignToWords) {
      const startWordBounds = findWordBoundaries(text, start, 20);
      const endWordBounds = findWordBoundaries(text, end, 20);
      if (startWordBounds && endWordBounds) {
        start = startWordBounds.start;
        end = endWordBounds.end;
        result.correction_reason = `Text found (confidence: ${searchResult.confidence.toFixed(1)}) and aligned to words`;
      } else {
        result.correction_reason = `Text found (confidence: ${searchResult.confidence.toFixed(1)})`;
      }
    } else {
      result.correction_reason = `Text found (confidence: ${searchResult.confidence.toFixed(1)})`;
    }
    
    result.start_char_offset = start;
    result.end_char_offset = end;
    result.was_corrected = true;
    result.original_start = originalStart;
    result.original_end = originalEnd;
    
  } else {
    // Fallback: Use original offsets with bounds checking and correction
    console.log(`[TextSpanCorrection] Text not found for "${span.text_snippet.slice(0, 50)}...", using fallback (original: ${span.start_char_offset}-${span.end_char_offset})`);
    let start_char_offset = Math.max(0, Math.min(span.start_char_offset, text.length));
    let end_char_offset = Math.max(start_char_offset, Math.min(span.end_char_offset, text.length));
    
    // Apply boundary corrections
    const spanLength = end_char_offset - start_char_offset;
    if (spanLength < options.minSpanLength || spanLength > options.maxSpanLength) {
      const midPoint = Math.floor((start_char_offset + end_char_offset) / 2);
      
      if (options.alignToSentences) {
        const sentenceBounds = findSentenceBoundaries(text, midPoint, options.maxSearchDistance);
        if (sentenceBounds) {
          const newLength = sentenceBounds.end - sentenceBounds.start;
          if (newLength >= options.minSpanLength && newLength <= options.maxSpanLength) {
            start_char_offset = sentenceBounds.start;
            end_char_offset = sentenceBounds.end;
            result.was_corrected = true;
            result.correction_reason = 'Offset-based with sentence boundary correction';
          }
        }
      }
    }
    
    result.start_char_offset = start_char_offset;
    result.end_char_offset = end_char_offset;
    
    if (!result.was_corrected && searchResult === null) {
      result.correction_reason = 'Text not found, using original offsets (may be incorrect)';
    }
  }
  
  // Update the text snippet to match the corrected offsets
  const correctedText = text.slice(result.start_char_offset, result.end_char_offset);
  
  // Check if the result is whitespace-only
  if (options.removeWhitespaceOnly && correctedText.trim().length === 0) {
    // Mark for removal by returning an invalid span
    result.start_char_offset = -1;
    result.end_char_offset = -1;
    result.text_snippet = '';
    result.was_corrected = true;
    result.correction_reason = 'Removed whitespace-only span';
  } else {
    result.text_snippet = correctedText;
  }
  
  // Store original values if correction was applied
  if (result.was_corrected) {
    result.original_start = originalStart;
    result.original_end = originalEnd;
  }
  
  return result;
}

/**
 * Merge overlapping spans
 */
export function mergeOverlappingSpans(spans: CorrectedTextSpan[]): CorrectedTextSpan[] {
  if (spans.length <= 1) return spans;
  
  // Sort by start position
  const sorted = [...spans].sort((a, b) => a.start_char_offset - b.start_char_offset);
  const merged: CorrectedTextSpan[] = [];
  
  let current = sorted[0];
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    
    // Check for overlap or adjacency
    if (next.start_char_offset <= current.end_char_offset + 10) { // Allow small gaps
      // Merge spans
      current = {
        ...current,
        end_char_offset: Math.max(current.end_char_offset, next.end_char_offset),
        text_snippet: '', // Will be updated later
        was_corrected: true,
        correction_reason: 'Merged overlapping spans',
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  
  merged.push(current);
  return merged;
}

/**
 * Auto-correct multiple text spans with full validation and optimization
 */
export function correctTextSpans(
  text: string,
  spans: TextSpan[],
  options: SpanCorrectionOptions = DEFAULT_CORRECTION_OPTIONS
): CorrectedTextSpan[] {
  if (!text || !spans.length) return [];
  
  // Step 1: Correct individual spans
  let correctedSpans = spans.map(span => correctTextSpan(text, span, options));
  
  // Step 2: Remove invalid spans (marked for removal)
  correctedSpans = correctedSpans.filter(span => 
    span.start_char_offset >= 0 && 
    span.end_char_offset > span.start_char_offset
  );
  
  // Step 3: Merge overlapping spans if requested
  if (options.mergeOverlapping && correctedSpans.length > 1) {
    correctedSpans = mergeOverlappingSpans(correctedSpans);
  }
  
  // Step 4: Update text snippets for merged spans
  correctedSpans.forEach(span => {
    if (span.text_snippet === '' || span.was_corrected) {
      span.text_snippet = text.slice(span.start_char_offset, span.end_char_offset);
    }
  });
  
  // Step 5: Sort by position for consistent output
  correctedSpans.sort((a, b) => a.start_char_offset - b.start_char_offset);
  
  return correctedSpans;
}

/**
 * Analyze span quality and provide recommendations
 */
export function analyzeSpanQuality(
  text: string,
  spans: TextSpan[]
): {
  totalSpans: number;
  averageLength: number;
  overlapCount: number;
  whitespaceOnlyCount: number;
  outOfBoundsCount: number;
  recommendations: string[];
} {
  const analysis = {
    totalSpans: spans.length,
    averageLength: 0,
    overlapCount: 0,
    whitespaceOnlyCount: 0,
    outOfBoundsCount: 0,
    recommendations: [] as string[],
  };
  
  if (spans.length === 0) {
    analysis.recommendations.push('No text spans provided');
    return analysis;
  }
  
  let totalLength = 0;
  const sortedSpans = [...spans].sort((a, b) => a.start_char_offset - b.start_char_offset);
  
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    
    // Check bounds
    if (span.start_char_offset < 0 || span.end_char_offset > text.length || 
        span.start_char_offset >= span.end_char_offset) {
      analysis.outOfBoundsCount++;
    }
    
    // Check whitespace-only
    if (span.text_snippet.trim().length === 0) {
      analysis.whitespaceOnlyCount++;
    }
    
    totalLength += span.end_char_offset - span.start_char_offset;
    
    // Check overlaps
    if (i > 0) {
      const prevSpan = sortedSpans[i - 1];
      if (span.start_char_offset < prevSpan.end_char_offset) {
        analysis.overlapCount++;
      }
    }
  }
  
  analysis.averageLength = totalLength / spans.length;
  
  // Generate recommendations
  if (analysis.overlapCount > 0) {
    analysis.recommendations.push(`${analysis.overlapCount} overlapping spans detected - consider merging`);
  }
  
  if (analysis.whitespaceOnlyCount > 0) {
    analysis.recommendations.push(`${analysis.whitespaceOnlyCount} whitespace-only spans should be removed`);
  }
  
  if (analysis.outOfBoundsCount > 0) {
    analysis.recommendations.push(`${analysis.outOfBoundsCount} spans are out of bounds or invalid`);
  }
  
  if (analysis.averageLength < 20) {
    analysis.recommendations.push('Spans are very short - consider selecting larger, more meaningful text segments');
  }
  
  if (analysis.averageLength > 300) {
    analysis.recommendations.push('Spans are very long - consider breaking them into smaller, more focused segments');
  }
  
  if (spans.length > 10) {
    analysis.recommendations.push('Many spans detected - consider focusing on the most important 3-5 pieces of evidence');
  }
  
  return analysis;
} 