import { FragmentData } from './types';

/**
 * Extract annotation run ID from source_ref
 * @param sourceRef - Source reference string like "annotation_run:123"
 * @returns Run ID or null
 */
export function extractRunIdFromSourceRef(sourceRef?: string): string | null {
  if (!sourceRef) return null;
  
  const match = sourceRef.match(/^annotation_run:(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Extract field description from schema output_contract
 * @param schema - The annotation schema
 * @param fragmentKey - The fragment key (e.g., "document.field_name" or "document.parent.child")
 * @returns Field description or null
 */
export function getFieldDescriptionFromSchema(
  schema: any,
  fragmentKey: string
): string | null {
  if (!schema?.output_contract) return null;
  
  // Remove "document." prefix if present
  const fieldPath = fragmentKey.replace(/^document\./, '');
  const pathParts = fieldPath.split('.');
  
  // Navigate through the schema to find the field
  let currentSchema = schema.output_contract;
  
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    
    // Check if we're in properties
    if (currentSchema.properties && currentSchema.properties[part]) {
      const fieldDef = currentSchema.properties[part];
      
      // If this is the last part, return its description
      if (i === pathParts.length - 1) {
        return fieldDef.description || null;
      }
      
      // Continue navigating
      currentSchema = fieldDef;
    } else if (currentSchema.items?.properties && currentSchema.items.properties[part]) {
      // Handle arrays of objects
      const fieldDef = currentSchema.items.properties[part];
      
      if (i === pathParts.length - 1) {
        return fieldDef.description || null;
      }
      
      currentSchema = fieldDef;
    } else {
      // Path not found
      return null;
    }
  }
  
  return null;
}

/**
 * Check if fragment is from an annotation run
 */
export function isFromAnnotationRun(fragment: FragmentData): boolean {
  return !!fragment.source_ref && fragment.source_ref.startsWith('annotation_run:');
}

/**
 * Get display-friendly fragment key (remove common prefixes)
 */
export function getDisplayFragmentKey(key: string): string {
  return key.replace(/^document\./, '').replace(/^fragment\./, '');
}

/**
 * Format fragment value for display
 */
export function formatFragmentValue(value: any, maxLength?: number): string {
  if (value === null || value === undefined) return '';
  
  const str = String(value);
  
  if (maxLength && str.length > maxLength) {
    return str.substring(0, maxLength) + '...';
  }
  
  return str;
}

/**
 * Get color scheme for fragment based on source
 */
export function getFragmentColorScheme(fragment: FragmentData): {
  bg: string;
  border: string;
  text: string;
  badgeBg: string;
  badgeText: string;
} {
  if (isFromAnnotationRun(fragment)) {
    return {
      bg: 'bg-blue-50/50 dark:bg-blue-950/20',
      border: 'border-blue-300 dark:border-blue-700',
      text: 'text-blue-700 dark:text-blue-300',
      badgeBg: 'bg-blue-100 dark:bg-blue-900',
      badgeText: 'text-blue-700 dark:text-blue-300',
    };
  }
  
  // Manual curation or other sources
  return {
    bg: 'bg-purple-50/50 dark:bg-purple-950/20',
    border: 'border-purple-300 dark:border-purple-700',
    text: 'text-purple-700 dark:text-purple-300',
    badgeBg: 'bg-purple-100 dark:bg-purple-900',
    badgeText: 'text-purple-700 dark:text-purple-300',
  };
}
