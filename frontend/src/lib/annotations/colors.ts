/**
 * Shared color system for Knowledge Graph entity types and predicates.
 * Provides consistent defaults across all graph views and allows for
 * schema-level and infospace-level overrides.
 */

// =============================================================================
// DEFAULT COLOR PALETTE
// =============================================================================

export interface EntityColorSet {
  /** Tailwind classes for badge backgrounds */
  bg: string;
  /** Tailwind classes for badge text */
  text: string;
  /** Tailwind classes for badge borders */
  border: string;
  /** Hex color for graph nodes (SVG fill) */
  hex: string;
}

/**
 * Default color palette for common entity types.
 * Used as fallback when no schema or infospace colors are configured.
 */
export const DEFAULT_ENTITY_COLORS: Record<string, EntityColorSet> = {
  PERSON: {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-300 dark:border-blue-700",
    hex: "#3B82F6", // blue-500
  },
  ORGANIZATION: {
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-300 dark:border-emerald-700",
    hex: "#10B981", // emerald-500
  },
  COMPANY: {
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-300 dark:border-emerald-700",
    hex: "#10B981", // emerald-500 (same as ORGANIZATION)
  },
  LOCATION: {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-700",
    hex: "#F59E0B", // amber-500
  },
  EVENT: {
    bg: "bg-violet-100 dark:bg-violet-900/40",
    text: "text-violet-700 dark:text-violet-300",
    border: "border-violet-300 dark:border-violet-700",
    hex: "#8B5CF6", // violet-500
  },
  CONCEPT: {
    bg: "bg-pink-100 dark:bg-pink-900/40",
    text: "text-pink-700 dark:text-pink-300",
    border: "border-pink-300 dark:border-pink-700",
    hex: "#EC4899", // pink-500
  },
  POLICY: {
    bg: "bg-cyan-100 dark:bg-cyan-900/40",
    text: "text-cyan-700 dark:text-cyan-300",
    border: "border-cyan-300 dark:border-cyan-700",
    hex: "#06B6D4", // cyan-500
  },
  DOCUMENT: {
    bg: "bg-orange-100 dark:bg-orange-900/40",
    text: "text-orange-700 dark:text-orange-300",
    border: "border-orange-300 dark:border-orange-700",
    hex: "#F97316", // orange-500
  },
  COUNTRY: {
    bg: "bg-teal-100 dark:bg-teal-900/40",
    text: "text-teal-700 dark:text-teal-300",
    border: "border-teal-300 dark:border-teal-700",
    hex: "#14B8A6", // teal-500
  },
  INSTITUTION: {
    bg: "bg-indigo-100 dark:bg-indigo-900/40",
    text: "text-indigo-700 dark:text-indigo-300",
    border: "border-indigo-300 dark:border-indigo-700",
    hex: "#6366F1", // indigo-500
  },
  LEGISLATION: {
    bg: "bg-rose-100 dark:bg-rose-900/40",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-300 dark:border-rose-700",
    hex: "#F43F5E", // rose-500
  },
  DATE: {
    bg: "bg-yellow-100 dark:bg-yellow-900/40",
    text: "text-yellow-700 dark:text-yellow-300",
    border: "border-yellow-300 dark:border-yellow-700",
    hex: "#EAB308", // yellow-500
  },
  OTHER: {
    bg: "bg-gray-100 dark:bg-gray-800/40",
    text: "text-gray-700 dark:text-gray-300",
    border: "border-gray-300 dark:border-gray-600",
    hex: "#6B7280", // gray-500
  },
};

/**
 * Default colors for predicates/relationships.
 * Typically edges are muted, but can be customized per predicate.
 */
export const DEFAULT_PREDICATE_COLORS: Record<string, string> = {
  // Common predicates get subtle color hints
  works_for: "#6366F1", // indigo
  located_in: "#10B981", // emerald
  part_of: "#8B5CF6", // violet
  related_to: "#EC4899", // pink
  met_with: "#F59E0B", // amber
  belongs_to: "#3B82F6", // blue
  authored_by: "#F97316", // orange
  mentioned_in: "#6B7280", // gray
  governs: "#F43F5E", // rose
  opposes: "#EF4444", // red
  supports: "#10B981", // emerald
  funded_by: "#06B6D4", // cyan
};

// Fallback colors for unknown types (deterministic hash-based)
const FALLBACK_HEX_COLORS = [
  "#8B5CF6", "#EC4899", "#06B6D4", "#F97316", "#14B8A6",
  "#6366F1", "#F43F5E", "#84CC16", "#EF4444", "#A855F7",
];

/**
 * Generate a deterministic color from a string hash.
 * Used as fallback for unknown entity types.
 */
function generateColorFromHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % FALLBACK_HEX_COLORS.length;
  return FALLBACK_HEX_COLORS[index];
}

// =============================================================================
// COLOR RESOLUTION FUNCTIONS
// =============================================================================

export interface ColorOverrides {
  /** Infospace-level color overrides (highest priority) */
  infospaceColors?: Record<string, string>;
  /** Schema-level color overrides (mid priority) */
  schemaColors?: Record<string, string>;
}

/**
 * Resolve entity type color with fallback chain:
 * 1. Infospace-level override (if provided)
 * 2. Schema-level override (if provided)
 * 3. Default palette
 * 4. Hash-based fallback for unknown types
 */
export function resolveEntityColor(
  type: string,
  overrides?: ColorOverrides
): string {
  const normalizedType = type.toUpperCase();
  
  // Priority 1: Infospace-level override
  if (overrides?.infospaceColors?.[normalizedType]) {
    return overrides.infospaceColors[normalizedType];
  }
  
  // Priority 2: Schema-level override
  if (overrides?.schemaColors?.[normalizedType]) {
    return overrides.schemaColors[normalizedType];
  }
  
  // Priority 3: Default palette
  if (DEFAULT_ENTITY_COLORS[normalizedType]) {
    return DEFAULT_ENTITY_COLORS[normalizedType].hex;
  }
  
  // Priority 4: Hash-based fallback
  return generateColorFromHash(normalizedType);
}

/**
 * Get full entity color set (bg, text, border, hex) for badge rendering.
 */
export function getEntityColorSet(
  type: string,
  overrides?: ColorOverrides
): EntityColorSet {
  const normalizedType = type.toUpperCase();
  
  // If there's a schema/infospace hex override, we need to generate Tailwind classes
  // For now, we'll use the default Tailwind classes and only override hex
  const defaultSet = DEFAULT_ENTITY_COLORS[normalizedType] || DEFAULT_ENTITY_COLORS.OTHER;
  
  const hex = resolveEntityColor(type, overrides);
  
  // If hex matches default, return full set
  if (hex === defaultSet.hex) {
    return defaultSet;
  }
  
  // Otherwise, return default Tailwind classes with custom hex
  // (In future, we could generate Tailwind classes from hex, but for now this is fine)
  return {
    ...defaultSet,
    hex,
  };
}

/**
 * Resolve predicate/edge color with fallback chain.
 */
export function resolvePredicateColor(
  predicate: string,
  overrides?: {
    infospaceColors?: Record<string, string>;
    schemaColors?: Record<string, string>;
  }
): string {
  // Priority 1: Infospace-level override
  if (overrides?.infospaceColors?.[predicate]) {
    return overrides.infospaceColors[predicate];
  }
  
  // Priority 2: Schema-level override
  if (overrides?.schemaColors?.[predicate]) {
    return overrides.schemaColors[predicate];
  }
  
  // Priority 3: Default palette
  if (DEFAULT_PREDICATE_COLORS[predicate]) {
    return DEFAULT_PREDICATE_COLORS[predicate];
  }
  
  // Priority 4: Default muted gray for unknown predicates
  return "#9B9B9B";
}

/**
 * Get entity type color for D3 graph nodes (hex only).
 * Legacy function name for backward compatibility.
 */
export function getEntityTypeColor(type: string, overrides?: ColorOverrides): string {
  return resolveEntityColor(type, overrides);
}

/**
 * Get entity badge classes for table display.
 */
export function getEntityBadgeClasses(type: string, overrides?: ColorOverrides): string {
  const colorSet = getEntityColorSet(type, overrides);
  return `${colorSet.bg} ${colorSet.text} ${colorSet.border}`;
}
