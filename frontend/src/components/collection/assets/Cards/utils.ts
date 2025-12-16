/**
 * Card Utilities
 * ==============
 * 
 * Helper functions for card components.
 */

/**
 * Strip HTML tags and decode HTML entities from text
 * Used for card previews where we want plain text only
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  
  // Remove HTML tags
  let text = html.replace(/<[^>]*>/g, ' ');
  
  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '...')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"');
  
  return text;
}

/**
 * Strip common markdown formatting from text
 * Used for card previews where we want plain text only
 */
export function stripMarkdown(markdown: string): string {
  if (!markdown) return '';
  
  let text = markdown
    // Remove headers (# ## ### etc.)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic (**text**, *text*, __text__, _text_)
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Remove inline code (`code`)
    .replace(/`([^`]+)`/g, '$1')
    // Remove code blocks (```code```)
    .replace(/```[\s\S]*?```/g, '')
    // Remove links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove blockquotes (> text)
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules (---, ***, ___)
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove list markers (-, *, 1., etc.)
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '');
  
  return text;
}

/**
 * Clean text content for card preview display
 * Strips HTML, markdown, and normalizes whitespace
 * 
 * @param text - Raw text content (may contain HTML or markdown)
 * @param maxLength - Optional maximum length (will truncate with ellipsis)
 * @returns Clean plain text suitable for card display
 */
export function cleanTextForPreview(text: string | null | undefined, maxLength?: number): string {
  if (!text) return '';
  
  // First strip HTML, then markdown (in case there's mixed content)
  let clean = stripHtml(text);
  clean = stripMarkdown(clean);
  
  // Normalize whitespace (collapse multiple spaces/newlines)
  clean = clean
    .replace(/\s+/g, ' ')
    .trim();
  
  // Truncate if needed
  if (maxLength && clean.length > maxLength) {
    clean = clean.substring(0, maxLength).trim() + '...';
  }
  
  return clean;
}
