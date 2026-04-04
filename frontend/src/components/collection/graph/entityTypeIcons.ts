/**
 * Static SVG path registry for entity type icons.
 * Paths are from Lucide icons, normalized to a 24x24 viewBox.
 * Used by D3ForceGraph to render icons inside node circles.
 */

// Maps entity type names to icon keys
export const DEFAULT_ENTITY_TYPE_ICONS: Record<string, string> = {
  PERSON: 'user',
  ORGANIZATION: 'building',
  COMPANY: 'building',
  LOCATION: 'map-pin',
  EVENT: 'calendar',
  CONCEPT: 'lightbulb',
  POLICY: 'scroll',
  DOCUMENT: 'file-text',
  COUNTRY: 'flag',
  INSTITUTION: 'landmark',
  LEGISLATION: 'scale',
  DATE: 'clock',
  OTHER: 'circle-dot',
};

// SVG path data for each icon key (24x24 viewBox, stroke-based)
// Each entry is an array of path `d` attributes (some icons have multiple paths)
export const ICON_SVG_PATHS: Record<string, string[]> = {
  user: [
    'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2',
    'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  ],
  building: [
    'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z',
    'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2',
    'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2',
    'M10 6h4', 'M10 10h4', 'M10 14h4', 'M10 18h4',
  ],
  'map-pin': [
    'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z',
    'M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  ],
  calendar: [
    'M16 2v4', 'M8 2v4',
    'M3 10h18',
    'M21 8.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z',
  ],
  lightbulb: [
    'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
    'M9 18h6', 'M10 22h4',
  ],
  scroll: [
    'M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4',
    'M19 17V5a2 2 0 0 0-2-2H4',
  ],
  'file-text': [
    'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z',
    'M14 2v6h6',
    'M16 13H8', 'M16 17H8', 'M10 9H8',
  ],
  flag: [
    'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z',
    'M4 22v-7',
  ],
  landmark: [
    'M3 22h18', 'M6 18v-7', 'M10 18v-7', 'M14 18v-7', 'M18 18v-7',
    'M12 2l8 5H4l8-5z',
  ],
  scale: [
    'M12 3v17',
    'M5 12H2', 'M22 12h-3',
    'M6 7l-3 5c0 1.7 1.3 3 3 3s3-1.3 3-3L6 7z',
    'M18 7l-3 5c0 1.7 1.3 3 3 3s3-1.3 3-3l-3-5z',
    'M6 7h12',
  ],
  clock: [
    'M12 12a10 10 0 1 0 0-0.01',
    'M12 6v6l4 2',
  ],
  'circle-dot': [
    'M12 12a10 10 0 1 0 0-0.01',
    'M12 12a1 1 0 1 0 0-0.01',
  ],
};

/**
 * Resolve the icon SVG paths for a given entity type.
 * Returns the path array or null if no icon is available.
 */
export function getEntityIconPaths(
  type: string,
  overrides?: Record<string, string>,
): string[] | null {
  const normalizedType = type.toUpperCase();

  // Check overrides first
  const iconKey = overrides?.[normalizedType] || DEFAULT_ENTITY_TYPE_ICONS[normalizedType];
  if (!iconKey) return null;

  return ICON_SVG_PATHS[iconKey] || null;
}
