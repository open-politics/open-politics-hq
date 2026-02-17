import { AnnotationSchemaRead } from "@/client";
import { JsonSchemaType, FormattedAnnotation, Asset } from "./types";
import { AnnotationRead as ClientAnnotationRead } from "@/client";
import { ImageIcon, Music, Video } from "lucide-react";

import React from "react";
import { cn } from "@/lib/utils";

// --- START: Types and functions moved from AnnotationResultFilters.tsx ---

// Define field types locally since they're not exported from the main types
type FieldType = 'int' | 'float' | 'str' | 'bool' | 'List[str]' | 'List[Dict[str, any]]';

// Define the filter logic mode type
export type FilterLogicMode = 'and' | 'or';

// The configuration for an entire filter set
export interface FilterSet {
  logic: FilterLogicMode;
  rules: ResultFilter[];
}

// Define the filter interface more formally
export interface ResultFilter {
  id: string; // Add a unique ID for React keys
  schemaId: number;
  fieldKey?: string;
  operator: 'equals' | 'contains' | 'range' | 'greater_than' | 'less_than';
  value: any;
  isActive: boolean;
}

// --- END: Types and functions moved from AnnotationResultFilters.tsx ---

// Helper function to get nested property value using dot notation (kept for internal use)
const getNestedValue = (obj: any, path: string): any => {
    if (!obj || !path) return undefined;
    
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return undefined;
        }
    }
    
    return current;
};

// Helper function to get field definition from hierarchical schema
const getFieldDefinitionFromSchema = (schema: AnnotationSchemaRead, fieldKey: string): any => {
    if (!schema.output_contract) return null;
    
    const properties = (schema.output_contract as any).properties;
    if (!properties) return null;
    
    // Handle hierarchical paths like "document.topics"
    const keys = fieldKey.split('.');
    let currentSchema = properties;
    
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        
        if (currentSchema[key]) {
            if (i === keys.length - 1) {
                // Last key - return the field definition
                return currentSchema[key];
            } else {
                // Navigate deeper
                if (currentSchema[key].type === 'object' && currentSchema[key].properties) {
                    currentSchema = currentSchema[key].properties;
                } else if (currentSchema[key].type === 'array' && 
                          currentSchema[key].items?.type === 'object' && 
                          currentSchema[key].items.properties) {
                    currentSchema = currentSchema[key].items.properties;
                } else {
                    return null;
                }
            }
        } else {
            return null;
        }
    }
    
    return null;
};

// --- getTargetFieldDefinition (from ResultFilters.tsx) ---
export const getTargetFieldDefinition = (
  filter: ResultFilter,
  schemas: AnnotationSchemaRead[]
): {
  type: JsonSchemaType | "bool" | "float" | null;
  definition: any; // Simplified to any for now
} => {
    const schema = schemas.find(s => s.id === filter.schemaId);
    if (!schema || !schema.output_contract || !(schema.output_contract as any).properties) {
        return { type: null, definition: null };
    }
    
    const properties = (schema.output_contract as any).properties;
    const fieldNames = Object.keys(properties);
    const targetKeyName = filter.fieldKey ?? fieldNames[0];

    if (!targetKeyName || targetKeyName === undefined) {
         return { type: null, definition: null };
    }
    
    // Use the new hierarchical field definition lookup
    const fieldDef = getFieldDefinitionFromSchema(schema, targetKeyName);
    if (fieldDef) {
        // Basic type mapping
        const typeMap: Record<string, JsonSchemaType | 'bool' | 'float'> = {
            "integer": "number",
            "number": "number", 
            "string": "string",
            "boolean": "boolean",
            "array": "array", 
            "object": "object"
        };
        const fieldType = typeMap[fieldDef.type] || null;
        return { type: fieldType, definition: fieldDef };
    }

    return { type: null, definition: null };
};

// Helper to detect date/timestamp fields in a schema
export const getDateFieldsForScheme = (schemeId: number, schemes: AnnotationSchemaRead[]): { key: string, name: string, type: string }[] => {
    const scheme = schemes.find(s => s.id === schemeId);
    if (!scheme || !scheme.output_contract || !(scheme.output_contract as any).properties) return [];

    const properties = (scheme.output_contract as any).properties;
    const dateFields: { key: string, name: string, type: string }[] = [];
    
    // Helper function to check if a field is likely a date field
    const isDateField = (fieldName: string, fieldDef: any): boolean => {
        const name = fieldName.toLowerCase();
        const title = (fieldDef.title || '').toLowerCase();
        const format = fieldDef.format || '';
        
        // Check for date formats
        if (format === 'date' || format === 'date-time') return true;
        
        // Check for date-related field names
        const dateKeywords = ['date', 'timestamp', 'time', 'created', 'updated', 'published', 'event'];
        return dateKeywords.some(keyword => name.includes(keyword) || title.includes(keyword));
    };
    
    // Extract date fields from schema
    const extractDateFields = (props: any, prefix: string = '') => {
        if (!props || typeof props !== 'object') return;
        
        Object.entries(props).forEach(([key, value]: [string, any]) => {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            
            // Only string fields can be dates in JSON Schema
            if (value.type === 'string' && isDateField(key, value)) {
                dateFields.push({
                    key: fullKey,
                    name: value.title || key,
                    type: value.format || 'date-string'
                });
            }
            
            // Recursively extract from nested objects
            if (value.type === 'object' && value.properties) {
                extractDateFields(value.properties, fullKey);
            }
            
            // Handle array of objects
            if (value.type === 'array' && value.items?.type === 'object' && value.items.properties) {
                extractDateFields(value.items.properties, fullKey);
            }
        });
    };
    
    // Check if hierarchical
    const isHierarchical = Object.keys(properties).some(key => 
        key === 'document' || key.startsWith('per_')
    );
    
    if (isHierarchical) {
        Object.entries(properties).forEach(([topKey, topValue]: [string, any]) => {
            if (topKey === 'document' && topValue.type === 'object' && topValue.properties) {
                extractDateFields(topValue.properties, 'document');
            } else if (topKey.startsWith('per_') && topValue.type === 'array' && 
                       topValue.items?.type === 'object' && topValue.items.properties) {
                extractDateFields(topValue.items.properties, topKey);
            }
        });
    } else {
        extractDateFields(properties);
    }
    
    return dateFields;
};

export const getTargetKeysForScheme = (
    schemeId: number, 
    schemes: AnnotationSchemaRead[],
    options?: { includeArrayItemFields?: boolean }
): { key: string, name: string, type: string }[] => {
    const scheme = schemes.find(s => s.id === schemeId);
    if (!scheme || !scheme.output_contract || !(scheme.output_contract as any).properties) return [];

    const properties = (scheme.output_contract as any).properties;
    const results: { key: string, name: string, type: string }[] = [];
    
    // Helper function to extract fields from a properties object
    const extractFromProperties = (props: any, prefix: string = '', insideArrayOfObjects: boolean = false) => {
        if (!props || typeof props !== 'object') return;
        
        Object.entries(props).forEach(([key, value]: [string, any]) => {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            
            // Add the field itself if it's a supported type for visualization
            if (value.type === 'string' || value.type === 'integer' || value.type === 'number' || value.type === 'boolean' || 
                (value.type === 'array' && value.items?.type === 'string') ||
                (value.type === 'array' && value.items?.type === 'object') ||  // Array of objects
                value.type === 'object') {  // Objects themselves
                results.push({
                    key: fullKey,
                    name: value.title || key,
                    type: value.type || 'unknown'
                });
            }
            
            // Recursively extract from nested object properties (for backward compatibility and nested field access)
            // BUT: Don't recurse into nested objects if we're already inside an array of objects
            // This prevents creating columns for fields like "document.mails.subject" which don't make sense
            // as standalone columns (they're properties of array items, not top-level fields)
            if (value.type === 'object' && value.properties && !insideArrayOfObjects) {
                extractFromProperties(value.properties, fullKey, false);
            }
            
            // Handle array of objects (per_modality patterns and mail arrays)
            // NEW: Conditionally recurse into array item properties when includeArrayItemFields is true
            if (value.type === 'array' && value.items?.type === 'object' && value.items.properties && !insideArrayOfObjects) {
                // If includeArrayItemFields is enabled, recurse into array item properties
                // This allows fields like "document.mails.date" to be available for time axis selection
                if (options?.includeArrayItemFields) {
                    extractFromProperties(value.items.properties, fullKey, true); // Mark as inside array
                }
                // Otherwise, don't recurse - prevents showing nested fields as columns
            }
        });
    };
    
    // Check if this is a hierarchical schema (has document, per_* fields)
    const isHierarchical = Object.keys(properties).some(key => 
        key === 'document' || key.startsWith('per_')
    );
    
    if (isHierarchical) {
        // Extract from hierarchical structure
        // For example: { document: { properties: { topics: { type: "array", items: { type: "string" } } } } }
        // Will extract: "document.topics" with type "array"
        Object.entries(properties).forEach(([topKey, topValue]: [string, any]) => {
            if (topKey === 'document' && topValue.type === 'object' && topValue.properties) {
                // Extract from document.properties
                extractFromProperties(topValue.properties, 'document');
            } else if (topKey.startsWith('per_') && topValue.type === 'array' && 
                       topValue.items?.type === 'object' && topValue.items.properties) {
                // Extract from per_modality array items
                extractFromProperties(topValue.items.properties, topKey);
            }
        });
    } else {
        // Flat schema - extract from top level
        extractFromProperties(properties);
    }
    
    return results;
};

export const compareValues = (actual: any, filterVal: any, operator: ResultFilter['operator'], fieldType: JsonSchemaType | 'bool' | 'float' | null): boolean => {
    if (actual === null || actual === undefined) {
        if (operator === 'equals' && (filterVal === 'N/A' || filterVal === null || filterVal === undefined || filterVal === '')) return true;
        return false;
    }
     if (filterVal === null || filterVal === undefined || filterVal === '') {
         if (operator === 'equals') return false;
         return false;
     }

    switch (operator) {
        case 'equals':
            if (fieldType === 'boolean') {
                const actualBool = Boolean(actual);
                const filterBool = filterVal === "True";
                return actualBool === filterBool;
            }
            return String(actual).toLowerCase() === String(filterVal).toLowerCase();
        case 'contains':
             if (fieldType === 'array') {
                 return Array.isArray(actual) && actual.some(item => String(item).toLowerCase().includes(String(filterVal).toLowerCase()));
             }
             if (fieldType === 'object') {
                  try {
                     const complexString = JSON.stringify(actual).toLowerCase();
                     return complexString.includes(String(filterVal).toLowerCase());
                  } catch (e) { return false; }
             }
            return String(actual).toLowerCase().includes(String(filterVal).toLowerCase());
        case 'range':
            if ((fieldType === 'number') && Array.isArray(filterVal) && filterVal.length === 2) {
                const numActual = Number(actual);
                if (isNaN(numActual)) return false;
                const [min, max] = filterVal.map(v => v === null || v === '' ? null : Number(v));
                 let match = true;
                 if (min !== null && !isNaN(min)) {
                     match = match && numActual >= min;
                 }
                 if (max !== null && !isNaN(max)) {
                     match = match && numActual <= max;
                 }
                 return match;
            }
            return false;
        case 'greater_than':
             if (fieldType === 'number') {
                 const numActual = Number(actual);
                 const numFilter = Number(filterVal);
                 return !isNaN(numActual) && !isNaN(numFilter) && numActual > numFilter;
             }
             return false;
        case 'less_than':
             if (fieldType === 'number') {
                 const numActual = Number(actual);
                 const numFilter = Number(filterVal);
                 return !isNaN(numActual) && !isNaN(numFilter) && numActual < numFilter;
             }
            return false;
        default:
            return false;
    }
};

export const checkFilterMatch = (
    filter: ResultFilter,
    assetResults: (ClientAnnotationRead | FormattedAnnotation)[],
    allSchemas: AnnotationSchemaRead[]
): boolean => {
    if (!filter.isActive) {
        return true;
    }
    
    // Safety check for invalid filter configuration
    if (!filter.fieldKey || filter.fieldKey === undefined) {
        console.warn("Cannot filter: fieldKey is undefined for filter:", filter);
        return true; // Allow all results through if filter is invalid
    }
    
    const targetSchemaResult = assetResults.find(r => r.schema_id === filter.schemaId);
    if (!targetSchemaResult || targetSchemaResult.value === null || targetSchemaResult.value === undefined) {
        return filter.operator === 'equals' && (filter.value === 'N/A' || filter.value === null || filter.value === undefined || filter.value === '');
    }
    const { type: fieldType, definition: fieldDefinition } = getTargetFieldDefinition(filter, allSchemas);
    if (!fieldType || !fieldDefinition) {
        console.warn("Cannot filter: Could not determine field type or definition for filter:", filter);
        return true; // Allow all results through if filter is invalid
    }

    // Use smart hierarchical value retrieval
    const actualValue = getAnnotationFieldValue(targetSchemaResult.value, filter.fieldKey || '');

    // SPECIAL CASE: If the field path goes through an array of objects,
    // we need to check if ANY item in the array matches the filter
    // Example: document.mails.subject should check subject in each mail item
    const fieldPath = filter.fieldKey.split('.');
    
    // Detect if we're navigating through an array structure by checking schema definition
    // Walk through the path and detect arrays
    let needsArrayTraversal = false;
    let arrayPath = '';
    let remainingPath = '';
    
    if (fieldPath.length >= 2) {
        // Try each possible split point to find where the array is
        for (let i = 1; i < fieldPath.length; i++) {
            const potentialArrayPath = fieldPath.slice(0, i).join('.');
            const potentialRemainingPath = fieldPath.slice(i).join('.');
            const potentialArray = getAnnotationFieldValue(targetSchemaResult.value, potentialArrayPath);
            
            // Check if this is an array of objects
            if (Array.isArray(potentialArray) && potentialArray.length > 0 && 
                typeof potentialArray[0] === 'object' && potentialArray[0] !== null) {
                needsArrayTraversal = true;
                arrayPath = potentialArrayPath;
                remainingPath = potentialRemainingPath;
                break;
            }
        }
    }
    
    if (needsArrayTraversal && arrayPath && remainingPath) {
        // Get the array container
        const arrayContainer = getAnnotationFieldValue(targetSchemaResult.value, arrayPath);
        
        if (Array.isArray(arrayContainer) && arrayContainer.length > 0) {
            // Check if any item in the array has a matching nested field value
            const hasMatch = arrayContainer.some(item => {
                if (typeof item === 'object' && item !== null) {
                    // Navigate through remaining path in the item
                    const itemValue = getNestedValue(item, remainingPath);
                    if (itemValue !== undefined && itemValue !== null) {
                        return compareValues(itemValue, filter.value, filter.operator, fieldType);
                    }
                }
                return false;
            });
            
            return hasMatch;
        }
        
        // If array is empty, fail the filter (nothing to match)
        return false;
    }

    if (filter.operator === 'contains' && typeof actualValue === 'object' && actualValue !== null) {
        try {
            const stringified = JSON.stringify(actualValue);
            return compareValues(stringified, filter.value, filter.operator, 'string');
        } catch (e) {
            return false;
        }
    }
    
    return compareValues(actualValue, filter.value, filter.operator, fieldType);
};

export const extractLocationString = (value: any, fieldKey: string | null): string | null => {
   if (!value) return null;
   if (typeof value === 'string') return value.trim() || null;
   if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
       if (fieldKey && value[fieldKey] && typeof value[fieldKey] === 'string') {
            const strVal = value[fieldKey].trim();
            if (strVal) return strVal;
       }
       const commonKeys = ['location', 'address', 'place', 'city', 'country'];
       for (const key of commonKeys) {
           if (value[key] && typeof value[key] === 'string') {
                const strVal = value[key].trim();
                if (strVal) return strVal;
           }
       }
       for (const key in value) {
          if (typeof value[key] === 'string') {
               const strVal = value[key].trim();
               if (strVal) return strVal;
          }
       }
   }
   if (Array.isArray(value) && value.length > 0) {
        const firstItem = value[0];
        if (typeof firstItem === 'string') return firstItem.trim() || null;
        if (typeof firstItem === 'object' && firstItem !== null) {
             if (fieldKey && firstItem[fieldKey] && typeof firstItem[fieldKey] === 'string') {
                  const strVal = firstItem[fieldKey].trim();
                  if (strVal) return strVal;
             }
             const commonKeys = ['location', 'address', 'place', 'city', 'country'];
              for (const key of commonKeys) {
                  if (firstItem[key] && typeof firstItem[key] === 'string') {
                       const strVal = firstItem[key].trim();
                       if (strVal) return strVal;
                  }
              }
              for (const key in firstItem) {
                   if (typeof firstItem[key] === 'string') {
                        const strVal = firstItem[key].trim();
                        if (strVal) return strVal;
                   }
              }
        }
   }
   return null;
};

export const formatDisplayValue = (value: any, schema: AnnotationSchemaRead): string | number | null => {
  if (value === null || value === undefined) return null;
  
  // This logic is complex because it depends on the schema's `output_contract`.
  // A simple string representation is used as a fallback.
  const mainFieldName = schema.output_contract && (schema.output_contract as any).properties ? Object.keys((schema.output_contract as any).properties)[0] : null;

  if (mainFieldName && typeof value === 'object' && value !== null && mainFieldName in value) {
    const mainValue = value[mainFieldName];
    if (typeof mainValue === 'string' || typeof mainValue === 'number') {
        return mainValue;
    }
  }

  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

// Smart function to get annotation field value - tries multiple access patterns
export const getAnnotationFieldValue = (annotationValue: any, fieldKey: string): any => {
    if (!annotationValue || !fieldKey) return undefined;
    
    // Strategy 0: Direct access to the fieldKey itself (exact match)
    if (fieldKey in annotationValue) {
        return annotationValue[fieldKey];
    }
    
    // Strategy 1: Try flat field access first (handles LLM outputs that don't follow hierarchical structure)
    // Extract the final field name from hierarchical path (e.g., "document.Topics" -> "Topics")
    const flatFieldName = fieldKey.includes('.') ? fieldKey.split('.').pop() : fieldKey;
    if (flatFieldName && flatFieldName in annotationValue) {
        return annotationValue[flatFieldName];
    }
    
    // Strategy 2: Try full hierarchical path access
    const hierarchicalValue = getNestedValue(annotationValue, fieldKey);
    if (hierarchicalValue !== undefined) {
        return hierarchicalValue;
    }
    
    // Strategy 3: For document.* paths, try nested access without "document" prefix
    if (fieldKey.startsWith('document.')) {
        const withoutDocument = fieldKey.substring('document.'.length);
        const nestedValue = getNestedValue(annotationValue, withoutDocument);
        if (nestedValue !== undefined) {
            return nestedValue;
        }
    }
    
    // Strategy 4: For per_modality.* paths (per_image, per_audio, etc.), try nested access without prefix
    const perModalityMatch = fieldKey.match(/^per_(\w+)\.(.*)/);
    if (perModalityMatch) {
        const withoutModality = perModalityMatch[2]; // The part after per_xxx.
        const nestedValue = getNestedValue(annotationValue, withoutModality);
        if (nestedValue !== undefined) {
            return nestedValue;
        }
    }
    
    // Strategy 5: Case-insensitive flat field access (for robustness)
    if (flatFieldName) {
        const keys = Object.keys(annotationValue);
        const matchingKey = keys.find(key => key.toLowerCase() === flatFieldName.toLowerCase());
        if (matchingKey) {
            return annotationValue[matchingKey];
        }
    }
    
    // Strategy 6: Handle space/formatting differences in field names
    if (flatFieldName) {
        const keys = Object.keys(annotationValue);
        // Try removing spaces, hyphens, underscores from both field name and keys
        const normalizedFieldName = flatFieldName.replace(/[\s\-_]/g, '').toLowerCase();
        const matchingKey = keys.find(key => 
            key.replace(/[\s\-_]/g, '').toLowerCase() === normalizedFieldName
        );
        if (matchingKey) {
            return annotationValue[matchingKey];
        }
    }
    
    return undefined;
}; 

// --- START: Functions moved from AnnotationResultFilters.tsx ---

export const getOperatorsForType = (type: JsonSchemaType | 'bool' | 'float' | null): Array<ResultFilter['operator']> => {
    switch (type) {
        case 'number':
            return ['equals', 'range', 'greater_than', 'less_than'];
        case 'string':
        case 'array':
            return ['equals', 'contains'];
        case 'boolean':
            return ['equals'];
        default:
            return ['equals', 'contains'];
    }
};

export const getFilterTooltip = (filter: ResultFilter, schemas: AnnotationSchemaRead[]) => {
    const { type } = getTargetFieldDefinition(filter, schemas);
    const schema = schemas.find(s => s.id === filter.schemaId);
    const fieldName = filter.fieldKey ?? Object.keys((schema?.output_contract as any)?.properties || {})[0] ?? 'field';

    switch (type) {
        case 'number':
            return `Filter numeric values in '${fieldName}'. Use 'equals', range, or comparison operators.`;
        case 'string':
             return `Filter text values in '${fieldName}'. Use 'equals' for exact matches or 'contains'.`;
        case 'array':
            return `Filter lists in '${fieldName}'. Use 'contains' to find items containing your text or 'equals' for exact matches.`;
        case 'boolean':
            return `Filter Yes/No values in '${fieldName}'. Use 'equals' (True/False).`;
        default:
            return `Filter results based on the '${fieldName}' field/key of the '${schema?.name}' schema.`;
    }
};

export const hasLabels = (filter: ResultFilter, schemas: AnnotationSchemaRead[]): boolean => {
    const { definition } = getTargetFieldDefinition(filter, schemas);
    return definition?.enum && Array.isArray(definition.enum) && definition.enum.length > 0;
};

export const getLabelsForField = (filter: ResultFilter, schemas: AnnotationSchemaRead[]): string[] => {
    const { definition } = getTargetFieldDefinition(filter, schemas);
    return definition?.enum || [];
};

export const getFieldTypeDisplay = (filter: ResultFilter, schemas: AnnotationSchemaRead[]): string => {
    const { type } = getTargetFieldDefinition(filter, schemas);
    if (!type) return 'N/A';
    if (type === 'array') return 'List';
    if (type === 'boolean') return 'Yes/No';
    if (type === 'number') return 'Number';
    return 'Text';
};

export const renderValueInput = (
    filter: ResultFilter,
    index: number,
    type: FieldType | 'bool' | 'float' | null,
    hasLabels: boolean,
    labels: string[],
    updateFilter: (index: number, updatedFilterData: Partial<Omit<ResultFilter, 'id'>>) => void
) => {
    // This function returns a ReactNode, so it can't be in a utils file without importing React.
    // It will be moved to the UnifiedFilterControls component.
    return null;
};
// --- END: Functions moved from AnnotationResultFilters.tsx ---

// --- Multimodal Field Display Utilities ---

/**
 * Extract modality type from field name
 */
export const getModalityFromFieldName = (fieldName: string): 'document' | 'image' | 'audio' | 'video' | null => {
  if (fieldName.startsWith('document.')) return 'document';
  if (fieldName.startsWith('per_image.')) return 'image';
  if (fieldName.startsWith('per_audio.')) return 'audio';
  if (fieldName.startsWith('per_video.')) return 'video';
  return null;
};

/**
 * Get modality icon component
 */
export const getModalityIcon = (
  modality: 'image' | 'audio' | 'video', 
  size: 'sm' | 'md' = 'sm',
  className?: string
): React.ReactNode => {
  const sizeClass = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  
  switch (modality) {
    case 'image':
      return React.createElement(ImageIcon, {
        className: cn(sizeClass, "text-purple-600", className),
        'aria-label': "Image field"
      });
    case 'audio':
      return React.createElement(Music, {
        className: cn(sizeClass, "text-teal-600", className),
        'aria-label': "Audio field"
      });
    case 'video':
      return React.createElement(Video, {
        className: cn(sizeClass, "text-orange-600", className),
        'aria-label': "Video field"
      });
  }
};

/**
 * Format field name for display by removing prefixes and returning metadata
 */
export interface FormattedFieldName {
  displayName: string;
  modality: 'document' | 'image' | 'audio' | 'video' | null;
  fullPath: string; // Original field name for reference
}

export const formatFieldNameForDisplay = (fieldName: string): FormattedFieldName => {
  const modality = getModalityFromFieldName(fieldName);
  
  let displayName = fieldName;
  
  // Remove document. prefix
  if (fieldName.startsWith('document.')) {
    displayName = fieldName.substring('document.'.length);
  }
  // Remove per_image. prefix
  else if (fieldName.startsWith('per_image.')) {
    displayName = fieldName.substring('per_image.'.length);
  }
  // Remove per_audio. prefix
  else if (fieldName.startsWith('per_audio.')) {
    displayName = fieldName.substring('per_audio.'.length);
  }
  // Remove per_video. prefix
  else if (fieldName.startsWith('per_video.')) {
    displayName = fieldName.substring('per_video.'.length);
  }
  
  return {
    displayName,
    modality,
    fullPath: fieldName
  };
};

/**
 * Group fields by modality for enhanced display
 */
export interface FieldGroup {
  modality: 'document' | 'image' | 'audio' | 'video' | 'other';
  fields: Array<{ name: string; type: string; description: string; config: any }>;
}

export const groupFieldsByModality = (
  fields: Array<{ name: string; type: string; description: string; config: any }>
): FieldGroup[] => {
  const groups: Record<string, FieldGroup['fields']> = {
    document: [],
    image: [],
    audio: [],
    video: [],
    other: []
  };
  
  fields.forEach(field => {
    const formatted = formatFieldNameForDisplay(field.name);
    
    if (formatted.modality === 'document') {
      groups.document.push({ ...field, name: formatted.displayName });
    } else if (formatted.modality === 'image') {
      groups.image.push({ ...field, name: formatted.displayName });
    } else if (formatted.modality === 'audio') {
      groups.audio.push({ ...field, name: formatted.displayName });
    } else if (formatted.modality === 'video') {
      groups.video.push({ ...field, name: formatted.displayName });
    } else {
      groups.other.push(field);
    }
  });
  
  // Return only non-empty groups
  return (['document', 'image', 'audio', 'video', 'other'] as const)
    .filter(modality => groups[modality].length > 0)
    .map(modality => ({
      modality,
      fields: groups[modality]
    }));
};

// =============================================================================
// KNOWLEDGE GRAPH UTILITIES
// =============================================================================

/**
 * Knowledge Graph entity type
 */
export interface KGEntity {
  id: number;
  name: string;
  type: string;
}

/**
 * Knowledge Graph triplet (relationship) type
 */
export interface KGTriplet {
  source_id: number;
  target_id: number;
  predicate: string;
  description?: string;
}

/**
 * Determines if a field contains Knowledge Graph data
 */
export function isKnowledgeGraphField(fieldKey: string, fieldValue: any): boolean {
  // Check if this is an entities or triplets field with array data
  const isEntitiesField = (fieldKey === 'entities' || fieldKey.endsWith('.entities')) && Array.isArray(fieldValue);
  const isTripletsField = (fieldKey === 'triplets' || fieldKey.endsWith('.triplets')) && Array.isArray(fieldValue);
  
  if (!isEntitiesField && !isTripletsField) return false;
  
  // Validate structure if array has items
  if (isEntitiesField && fieldValue.length > 0) {
    const firstEntity = fieldValue[0];
    return typeof firstEntity === 'object' && 
           'id' in firstEntity && 
           'name' in firstEntity && 
           'type' in firstEntity;
  }
  
  if (isTripletsField && fieldValue.length > 0) {
    const firstTriplet = fieldValue[0];
    return typeof firstTriplet === 'object' && 
           'source_id' in firstTriplet && 
           'target_id' in firstTriplet && 
           'predicate' in firstTriplet;
  }
  
  // Empty arrays are valid KG fields
  return true;
}

/**
 * Extract entities from an annotation value
 */
export function extractEntities(annotationValue: any): KGEntity[] {
  // Try document.entities first (standard location)
  let entities = getAnnotationFieldValue(annotationValue, 'document.entities');
  
  // Fallback to top-level entities
  if (!entities || !Array.isArray(entities)) {
    entities = getAnnotationFieldValue(annotationValue, 'entities');
  }
  
  if (!Array.isArray(entities)) {
    return [];
  }
  
  // Validate and filter entities
  return entities.filter((e: any) => 
    e && typeof e === 'object' && 
    typeof e.id === 'number' && 
    typeof e.name === 'string' && 
    typeof e.type === 'string'
  );
}

/**
 * Extract triplets from an annotation value
 */
export function extractTriplets(annotationValue: any): KGTriplet[] {
  // Try document.triplets first (standard location)
  let triplets = getAnnotationFieldValue(annotationValue, 'document.triplets');
  
  // Fallback to top-level triplets
  if (!triplets || !Array.isArray(triplets)) {
    triplets = getAnnotationFieldValue(annotationValue, 'triplets');
  }
  
  if (!Array.isArray(triplets)) {
    return [];
  }
  
  // Validate and filter triplets
  return triplets.filter((t: any) => 
    t && typeof t === 'object' && 
    typeof t.source_id === 'number' && 
    typeof t.target_id === 'number' && 
    typeof t.predicate === 'string'
  );
}

/**
 * Get entity by ID from an entities array
 */
export function getEntityById(entities: KGEntity[], entityId: number): KGEntity | null {
  return entities.find(e => e.id === entityId) || null;
}

/**
 * Format a triplet as a human-readable string
 * Example: "Apple Inc → founded by → Steve Jobs"
 */
export function formatTriplet(triplet: KGTriplet, entities: KGEntity[]): string {
  const source = getEntityById(entities, triplet.source_id);
  const target = getEntityById(entities, triplet.target_id);
  
  if (!source || !target) {
    return `Invalid triplet (source: ${triplet.source_id}, target: ${triplet.target_id})`;
  }
  
  return `${source.name} → ${triplet.predicate} → ${target.name}`;
}

/**
 * Format a triplet with full details including entity types
 * Example: "Apple Inc (COMPANY) → founded by → Steve Jobs (PERSON)"
 */
export function formatTripletDetailed(triplet: KGTriplet, entities: KGEntity[]): string {
  const source = getEntityById(entities, triplet.source_id);
  const target = getEntityById(entities, triplet.target_id);
  
  if (!source || !target) {
    return formatTriplet(triplet, entities);
  }
  
  return `${source.name} (${source.type}) → ${triplet.predicate} → ${target.name} (${target.type})`;
}

/**
 * Check if an annotation result contains Knowledge Graph data
 */
export function hasKnowledgeGraphData(annotationValue: any): boolean {
  const entities = extractEntities(annotationValue);
  const triplets = extractTriplets(annotationValue);
  
  return entities.length > 0 || triplets.length > 0;
}

/**
 * Get statistics about a Knowledge Graph
 */
export function getKGStats(annotationValue: any): {
  entityCount: number;
  tripletCount: number;
  entityTypes: string[];
  predicates: string[];
} {
  const entities = extractEntities(annotationValue);
  const triplets = extractTriplets(annotationValue);
  
  const entityTypes = [...new Set(entities.map(e => e.type))];
  const predicates = [...new Set(triplets.map(t => t.predicate))];
  
  return {
    entityCount: entities.length,
    tripletCount: triplets.length,
    entityTypes,
    predicates
  };
}

// =============================================================================
// GRAPH EDITING UTILITIES
// =============================================================================

import type { GraphEdits, MergedNode, DeletedNode, DeletedEdge, CustomEdge, NodeLabelOverride } from './types';

/**
 * React-flow compatible node type
 */
export interface ReactFlowNode {
  id: string;
  data: {
    label: string;
    type?: string;
    frequency?: number;
    source_asset_count?: number;
    [key: string]: any;
  };
  position: { x: number; y: number };
}

/**
 * React-flow compatible edge type (flexible to match ReactFlow's Edge type)
 */
export interface ReactFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: any;  // ReactNode in ReactFlow, but we'll keep it flexible
  data?: any;
  style?: any;
  animated?: boolean;
  [key: string]: any;  // Allow other ReactFlow edge properties
}

/**
 * Apply graph edits to raw graph data from the aggregator
 * Returns modified nodes and edges
 */
export function applyGraphEdits(
  nodes: ReactFlowNode[],
  edges: any[],  // Accept any edge type for flexibility
  edits: GraphEdits | null | undefined
): { nodes: ReactFlowNode[]; edges: any[] } {
  if (!edits) {
    return { nodes, edges };
  }
  
  let processedNodes = [...nodes];
  let processedEdges = [...edges];
  
  // 1. Apply node deletions
  const deletedNodeIds = new Set(edits.deletedNodes.map(dn => dn.nodeId));
  processedNodes = processedNodes.filter(node => !deletedNodeIds.has(node.id));
  
  // 2. Apply node merges
  const mergeTargetMap = new Map<string, string>(); // mergedNodeId -> targetNodeId
  edits.mergedNodes.forEach(merge => {
    merge.mergedNodeIds.forEach(mergedId => {
      mergeTargetMap.set(mergedId, merge.targetNodeId);
    });
  });
  
  // Filter out merged nodes and update target node data
  processedNodes = processedNodes.filter(node => !mergeTargetMap.has(node.id));
  
  // Update target nodes to reflect merged data
  edits.mergedNodes.forEach(merge => {
    const targetNode = processedNodes.find(n => n.id === merge.targetNodeId);
    if (targetNode) {
      // Combine frequencies from merged nodes
      const mergedNodes = nodes.filter(n => merge.mergedNodeIds.includes(n.id));
      const additionalFrequency = mergedNodes.reduce((sum, n) => sum + (n.data.frequency || 0), 0);
      const additionalAssetCount = mergedNodes.reduce((sum, n) => sum + (n.data.source_asset_count || 0), 0);
      
      targetNode.data = {
        ...targetNode.data,
        frequency: (targetNode.data.frequency || 0) + additionalFrequency,
        source_asset_count: (targetNode.data.source_asset_count || 0) + additionalAssetCount,
        merged_from: merge.mergedNodeIds, // Track what was merged
      };
    }
  });
  
  // 3. Remap edges for merged nodes
  processedEdges = processedEdges.map(edge => {
    const newSource = mergeTargetMap.get(edge.source) || edge.source;
    const newTarget = mergeTargetMap.get(edge.target) || edge.target;
    
    if (newSource !== edge.source || newTarget !== edge.target) {
      return {
        ...edge,
        id: `${newSource}-${edge.label || 'to'}-${newTarget}`, // Generate new ID
        source: newSource,
        target: newTarget,
      };
    }
    return edge;
  });
  
  // 4. Remove edges connected to deleted nodes
  processedEdges = processedEdges.filter(edge => 
    !deletedNodeIds.has(edge.source) && !deletedNodeIds.has(edge.target)
  );
  
  // 5. Apply edge deletions
  const deletedEdgeIds = new Set(edits.deletedEdges.map(de => de.edgeId));
  processedEdges = processedEdges.filter(edge => !deletedEdgeIds.has(edge.id));
  
  // 6. Add custom edges
  processedEdges = [
    ...processedEdges,
    ...edits.customEdges.map(ce => ({
      id: ce.id,
      source: ce.source,
      target: ce.target,
      label: ce.label,
      data: {
        custom: true,
        description: ce.description,
        createdAt: ce.createdAt
      }
    }))
  ];
  
  // 7. Apply node label overrides
  edits.nodeLabels.forEach(labelOverride => {
    const node = processedNodes.find(n => n.id === labelOverride.nodeId);
    if (node) {
      node.data = {
        ...node.data,
        label: labelOverride.customLabel,
        originalLabel: labelOverride.originalLabel,
        labelOverridden: true
      };
    }
  });
  
  // 8. Deduplicate edges (after merging, we might have duplicates)
  const uniqueEdges = new Map<string, ReactFlowEdge>();
  processedEdges.forEach(edge => {
    const key = `${edge.source}-${edge.label}-${edge.target}`;
    if (!uniqueEdges.has(key)) {
      uniqueEdges.set(key, edge);
    }
  });
  processedEdges = Array.from(uniqueEdges.values());
  
  return { nodes: processedNodes, edges: processedEdges };
}

/**
 * Create an empty graph edits object
 */
export function createEmptyGraphEdits(): GraphEdits {
  return {
    mergedNodes: [],
    deletedNodes: [],
    deletedEdges: [],
    customEdges: [],
    nodeLabels: [],
    version: '1.0'
  };
}

/**
 * Check if graph edits contain any modifications
 */
export function hasGraphEdits(edits: GraphEdits | null | undefined): boolean {
  if (!edits) return false;
  
  return edits.mergedNodes.length > 0 ||
         edits.deletedNodes.length > 0 ||
         edits.deletedEdges.length > 0 ||
         edits.customEdges.length > 0 ||
         edits.nodeLabels.length > 0;
}

/**
 * Get count of all edits
 */
export function getGraphEditsCount(edits: GraphEdits | null | undefined): number {
  if (!edits) return 0;
  
  return edits.mergedNodes.length +
         edits.deletedNodes.length +
         edits.deletedEdges.length +
         edits.customEdges.length +
         edits.nodeLabels.length;
} 