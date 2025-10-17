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
    /address/i,
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
      
      // Recurse into nested objects (but not arrays to avoid performance issues)
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        traverse(value, fullKey);
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
      
      // Recurse into nested objects (but not arrays)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        traverse(value, fullKey);
      }
    }
  }
  
  traverse(resultValue);
  return locationFields;
}

