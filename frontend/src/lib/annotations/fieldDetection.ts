// Utilities for detecting special field types that can trigger cross-panel navigation

/**
 * Determines if a field is likely a timestamp field based on its name and value
 */
export function isTimestampField(fieldKey: string, fieldValue: any): boolean {
  if (!fieldValue) return false;
  
  // Check field name patterns
  const namePatterns = [
    /timestamp/i,
    /time/i,
    /date/i,
    /datetime/i,
    /created_at/i,
    /updated_at/i,
    /published_at/i,
  ];
  
  const hasTimestampName = namePatterns.some(pattern => pattern.test(fieldKey));
  
  // Check if value looks like ISO timestamp
  const isISOString = typeof fieldValue === 'string' && 
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(fieldValue);
  
  // Check if it's a Date object
  const isDateObject = fieldValue instanceof Date;
  
  // Check if it's a valid date string that can be parsed
  const canParseAsDate = typeof fieldValue === 'string' && !isNaN(Date.parse(fieldValue));
  
  return hasTimestampName && (isISOString || isDateObject || canParseAsDate);
}

/**
 * Determines if a field is likely a location field based on its name
 */
export function isLocationField(fieldKey: string, fieldValue: any): boolean {
  if (!fieldValue) return false;
  
  // Check field name patterns
  const namePatterns = [
    /location/i,
    /place/i,
    /city/i,
    /country/i,
    /region/i,
    /geo/i,
    /coordinates?/i,
  ];
  
  const hasLocationName = namePatterns.some(pattern => pattern.test(fieldKey));
  
  // Check if value is a non-empty string or array of strings
  const isValidLocationValue = 
    (typeof fieldValue === 'string' && fieldValue.trim().length > 0) ||
    (Array.isArray(fieldValue) && fieldValue.length > 0 && fieldValue.every(v => typeof v === 'string'));
  
  return hasLocationName && isValidLocationValue;
}

/**
 * Extracts a Date object from a timestamp field value
 */
export function parseTimestampValue(fieldValue: any): Date | null {
  if (!fieldValue) return null;
  
  if (fieldValue instanceof Date) {
    return fieldValue;
  }
  
  if (typeof fieldValue === 'string') {
    const parsed = new Date(fieldValue);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  
  return null;
}

/**
 * Extracts location string(s) from a location field value
 */
export function parseLocationValue(fieldValue: any): string[] {
  if (!fieldValue) return [];
  
  if (typeof fieldValue === 'string') {
    return [fieldValue.trim()];
  }
  
  if (Array.isArray(fieldValue)) {
    return fieldValue
      .filter(v => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.trim());
  }
  
  return [];
}

/**
 * Get all timestamp fields from an annotation result
 */
export function getTimestampFields(resultValue: any): Array<{ fieldKey: string; value: any; date: Date }> {
  if (!resultValue || typeof resultValue !== 'object') return [];
  
  const timestampFields: Array<{ fieldKey: string; value: any; date: Date }> = [];
  
  function traverse(obj: any, prefix: string = '') {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (isTimestampField(fullKey, value)) {
        const date = parseTimestampValue(value);
        if (date) {
          timestampFields.push({ fieldKey: fullKey, value, date });
        }
      }
      
      // Recurse into nested objects
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        traverse(value, fullKey);
      }
      
      // NEW: Recurse into arrays of objects to find timestamp fields within array items
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (item && typeof item === 'object' && !(item instanceof Date)) {
            // Traverse into array item without adding index to path (we want field names like "document.mails.date")
            traverse(item, fullKey);
          }
        });
      }
    }
  }
  
  traverse(resultValue);
  return timestampFields;
}

/**
 * Get all location fields from an annotation result
 */
export function getLocationFields(resultValue: any): Array<{ fieldKey: string; value: any; locations: string[] }> {
  if (!resultValue || typeof resultValue !== 'object') return [];
  
  const locationFields: Array<{ fieldKey: string; value: any; locations: string[] }> = [];
  
  function traverse(obj: any, prefix: string = '') {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (isLocationField(fullKey, value)) {
        const locations = parseLocationValue(value);
        if (locations.length > 0) {
          locationFields.push({ fieldKey: fullKey, value, locations });
        }
      }
      
      // Recurse into nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        traverse(value, fullKey);
      }
      
      // NEW: Recurse into arrays of objects to find location fields within array items
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (item && typeof item === 'object') {
            // Traverse into array item without adding index to path (we want field names like "document.mails.location")
            traverse(item, fullKey);
          }
        });
      }
    }
  }
  
  traverse(resultValue);
  return locationFields;
}

/**
 * Determines if an array contains node-like objects (structure-based detection)
 * Nodes must have: id, name, type
 */
export function isNodeArray(fieldValue: any): boolean {
  if (!Array.isArray(fieldValue) || fieldValue.length === 0) return false;
  
  const first = fieldValue[0];
  if (!first || typeof first !== 'object') return false;
  
  // Check for required node fields: id, name, type
  return 'id' in first && 'name' in first && 'type' in first;
}

/**
 * Determines if an array contains edge-like objects (structure-based detection)
 * Edges must have: source_id (or source), target_id (or target), predicate
 */
export function isEdgeArray(fieldValue: any): boolean {
  if (!Array.isArray(fieldValue) || fieldValue.length === 0) return false;
  
  const first = fieldValue[0];
  if (!first || typeof first !== 'object') return false;
  
  // Check for required edge fields: source_id/source, target_id/target, predicate
  const hasSource = ('source_id' in first) || ('source' in first);
  const hasTarget = ('target_id' in first) || ('target' in first);
  const hasPredicate = 'predicate' in first;
  
  return hasSource && hasTarget && hasPredicate;
}

/**
 * Determines if a field contains Knowledge Graph data (structure-based detection)
 * No name pattern matching - purely structure-based
 */
export function isKnowledgeGraphField(fieldKey: string, fieldValue: any): boolean {
  if (!fieldValue) return false;
  
  // Check if it's a node array or edge array
  return isNodeArray(fieldValue) || isEdgeArray(fieldValue);
}

/**
 * Get all graph fields (nodes and edges) from an annotation result
 * Uses structure-based detection, not name patterns
 */
export function getGraphFields(
  resultValue: any
): Array<{ fieldKey: string; value: any; type: 'nodes' | 'edges' }> {
  if (!resultValue || typeof resultValue !== 'object') return [];
  
  const graphFields: Array<{ fieldKey: string; value: any; type: 'nodes' | 'edges' }> = [];
  
  function traverse(obj: any, prefix: string = '') {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      // Check if this is a node array
      if (isNodeArray(value)) {
        graphFields.push({ fieldKey: fullKey, value, type: 'nodes' });
      }
      // Check if this is an edge array
      else if (isEdgeArray(value)) {
        graphFields.push({ fieldKey: fullKey, value, type: 'edges' });
      }
      
      // Recurse into nested objects (but not arrays to avoid performance issues)
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        traverse(value, fullKey);
      }
    }
  }
  
  traverse(resultValue);
  return graphFields;
}