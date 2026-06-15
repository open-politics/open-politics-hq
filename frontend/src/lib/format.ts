/**
 * Neutral text/format helpers shared across domains (chat toolcalls, intake
 * Discover/result viewer). Lives in `lib/` so neither domain depends on the other.
 */

/**
 * Resolve relative URLs in markdown content against a base URL.
 * Converts relative image and link URLs to absolute URLs using the base URL's origin.
 *
 * @example
 * resolveMarkdownUrls('![alt](/image.png)', 'https://example.com/page')
 * // => '![alt](https://example.com/image.png)'
 */
export function resolveMarkdownUrls(markdown: string, baseUrl: string): string {
  if (!markdown || !baseUrl) return markdown;

  try {
    const url = new URL(baseUrl);
    const origin = url.origin;

    // Replace relative image URLs: ![alt](/path) or ![alt](path)
    markdown = markdown.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (match, alt, imgUrl) => {
        if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
          return match; // Already absolute
        }
        const absoluteUrl = imgUrl.startsWith('/')
          ? `${origin}${imgUrl}`
          : `${origin}/${imgUrl}`;
        return `![${alt}](${absoluteUrl})`;
      },
    );

    // Replace relative link URLs: [text](/path) or [text](path)
    markdown = markdown.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (match, text, linkUrl) => {
        // Skip if already absolute, or if it's an anchor, email, etc.
        if (
          linkUrl.startsWith('http://') ||
          linkUrl.startsWith('https://') ||
          linkUrl.startsWith('#') ||
          linkUrl.startsWith('mailto:')
        ) {
          return match;
        }
        const absoluteUrl = linkUrl.startsWith('/')
          ? `${origin}${linkUrl}`
          : `${origin}/${linkUrl}`;
        return `[${text}](${absoluteUrl})`;
      },
    );

    return markdown;
  } catch (e) {
    console.warn('Failed to resolve relative URLs:', e);
    return markdown;
  }
}

/** Format a 0–1 ratio as a whole-number percentage. */
export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
