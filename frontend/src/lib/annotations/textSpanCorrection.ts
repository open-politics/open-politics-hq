/**
 * Text Span Resolution Utilities
 *
 * Resolves text spans to exact positions in document text. Uses text search only;
 * no sentence/word alignment that could inflate spans.
 */

export interface TextSpan {
  start_char_offset: number;
  end_char_offset: number;
  text_snippet: string;
  asset_uuid?: string;
  fieldName?: string;
  schemaName?: string;
  justificationReasoning?: string;
}

export interface ResolvedSpan extends TextSpan {
  start_char_offset: number;
  end_char_offset: number;
  text_snippet: string;
}

/** Remove leading/trailing quotes and whitespace (evidence snippets may be wrapped in quotes) */
function stripSurroundingQuotes(s: string): string {
  return s.replace(/^[\s"'\u201C\u201D\u2018\u2019]+|[\s"'\u201C\u201D\u2018\u2019]+$/g, '').trim();
}

/** Find exact snippet position in text (exact match, quote-stripped, or normalized whitespace) */
function findTextSnippetPosition(
  fullText: string,

  snippet: string
): { start: number; end: number } | null {
  if (!fullText || !snippet) return null;
  const trimmed = snippet.trim();
  if (trimmed.length < 3) return null;

  const searchText = fullText.toLowerCase();
  const stripped = stripSurroundingQuotes(trimmed);
  const variants = [trimmed, ...(stripped !== trimmed && stripped.length >= 3 ? [stripped] : [])];

  for (const variant of variants) {
    const searchSnippet = variant.toLowerCase();

    // Strategy 1: Exact match
    const exactIndex = searchText.indexOf(searchSnippet);
    if (exactIndex !== -1) {
      return { start: exactIndex, end: exactIndex + searchSnippet.length };
    }

    // Strategy 2: Normalized whitespace
    const normalizedSnippet = searchSnippet.replace(/\s+/g, ' ');
    const normalizedText = searchText.replace(/\s+/g, ' ');
    const normalizedIndex = normalizedText.indexOf(normalizedSnippet);
    if (normalizedIndex !== -1) {
      const mapNormToOrig: number[] = [];
      let normPos = 0;
      for (let i = 0; i < fullText.length; i++) {
        mapNormToOrig[normPos] = i;
        if (/\s/.test(fullText[i])) {
          while (i + 1 < fullText.length && /\s/.test(fullText[i + 1])) i++;
          normPos++;
        } else {
          normPos++;
        }
      }
      mapNormToOrig[normPos] = fullText.length;
      const start = mapNormToOrig[normalizedIndex] ?? 0;
      const end = mapNormToOrig[normalizedIndex + normalizedSnippet.length] ?? start + searchSnippet.length;
      return { start, end };
    }
  }

  return null;
}

/**
 * Resolve raw spans to exact positions in the document text.
 * Uses text search only; no sentence/word alignment.
 * If text not found, uses original offsets clamped to bounds.
 */
export function resolveSpans(
  text: string,
  rawSpans: Array<{ start_char_offset?: number; end_char_offset?: number; text_snippet?: string; [key: string]: unknown }>
): ResolvedSpan[] {
  if (!text || !rawSpans?.length) return [];

  const result: ResolvedSpan[] = [];

  for (const raw of rawSpans) {
    const snippet = typeof raw.text_snippet === 'string' ? raw.text_snippet.trim() : '';
    if (!snippet) continue;

    const origStart = typeof raw.start_char_offset === 'number' ? raw.start_char_offset : 0;
    const origEnd = typeof raw.end_char_offset === 'number' ? raw.end_char_offset : origStart + snippet.length;

    const found = findTextSnippetPosition(text, snippet);
    let start: number;
    let end: number;

    if (found) {
      start = found.start;
      end = found.end;
    } else {
      start = Math.max(0, Math.min(origStart, text.length));
      end = Math.max(start, Math.min(origEnd, text.length));
      if (end <= start) end = Math.min(start + snippet.length, text.length);
    }

    const resolvedText = text.slice(start, end);
    if (resolvedText.trim().length === 0) continue;

    result.push({
      ...raw,
      start_char_offset: start,
      end_char_offset: end,
      text_snippet: resolvedText,
    });
  }

  result.sort((a, b) => a.start_char_offset - b.start_char_offset);
  return result;
}
