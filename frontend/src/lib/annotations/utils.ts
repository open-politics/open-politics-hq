import { AnnotationSchemaRead } from "@/client/models";
import { ResultFilter } from "@/components/collection/infospaces/annotation/AnnotationResultFilters"; 
import { JsonSchemaType, FormattedAnnotation, Asset } from "./types"; 
import { AnnotationRead as ClientAnnotationRead } from "@/client/models";

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

    if (!targetKeyName) {
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

export const getTargetKeysForScheme = (schemeId: number, schemes: AnnotationSchemaRead[]): { key: string, name: string, type: string }[] => {
    const scheme = schemes.find(s => s.id === schemeId);
    if (!scheme || !scheme.output_contract || !(scheme.output_contract as any).properties) return [];

    const properties = (scheme.output_contract as any).properties;
    const results: { key: string, name: string, type: string }[] = [];
    
    // Helper function to extract fields from a properties object
    const extractFromProperties = (props: any, prefix: string = '') => {
        if (!props || typeof props !== 'object') return;
        
        Object.entries(props).forEach(([key, value]: [string, any]) => {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            
            // Add the field itself if it's a supported type for visualization
            if (value.type === 'string' || value.type === 'integer' || value.type === 'number' || value.type === 'boolean' || 
                (value.type === 'array' && value.items?.type === 'string')) {
                results.push({
                    key: fullKey,
                    name: value.title || key,
                    type: value.type || 'unknown'
                });
            }
            
            // Recursively extract from nested object properties
            if (value.type === 'object' && value.properties) {
                extractFromProperties(value.properties, fullKey);
            }
            
            // Handle array of objects (per_modality patterns)
            if (value.type === 'array' && value.items?.type === 'object' && value.items.properties) {
                extractFromProperties(value.items.properties, fullKey);
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
    const targetSchemaResult = assetResults.find(r => r.schema_id === filter.schemaId);
    if (!targetSchemaResult || targetSchemaResult.value === null || targetSchemaResult.value === undefined) {
        return filter.operator === 'equals' && (filter.value === 'N/A' || filter.value === null || filter.value === undefined || filter.value === '');
    }
    const { type: fieldType, definition: fieldDefinition } = getTargetFieldDefinition(filter, allSchemas);
    if (!fieldType || !fieldDefinition) {
        console.warn("Cannot filter: Could not determine field type or definition for filter:", filter);
        return false;
    }

    // Use smart hierarchical value retrieval
    const actualValue = getAnnotationFieldValue(targetSchemaResult.value, filter.fieldKey || '');

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
    
    console.log(`[getAnnotationFieldValue] Attempting to extract '${fieldKey}' from:`, annotationValue);
    
    // Strategy 1: Try flat field access first (handles LLM outputs that don't follow hierarchical structure)
    // Extract the final field name from hierarchical path (e.g., "document.Topics" -> "Topics")
    const flatFieldName = fieldKey.includes('.') ? fieldKey.split('.').pop() : fieldKey;
    if (flatFieldName && flatFieldName in annotationValue) {
        console.log(`[getAnnotationFieldValue] ✓ Found via flat access: ${flatFieldName} =`, annotationValue[flatFieldName]);
        return annotationValue[flatFieldName];
    }
    
    // Strategy 2: Try full hierarchical path access
    const hierarchicalValue = getNestedValue(annotationValue, fieldKey);
    if (hierarchicalValue !== undefined) {
        console.log(`[getAnnotationFieldValue] ✓ Found via hierarchical access: ${fieldKey} =`, hierarchicalValue);
        return hierarchicalValue;
    }
    
    // Strategy 3: For document.* paths, try direct access without "document" prefix
    if (fieldKey.startsWith('document.')) {
        const withoutDocument = fieldKey.substring('document.'.length);
        if (withoutDocument in annotationValue) {
            console.log(`[getAnnotationFieldValue] ✓ Found via document prefix removal: ${withoutDocument} =`, annotationValue[withoutDocument]);
            return annotationValue[withoutDocument];
        }
    }
    
    // Strategy 4: Case-insensitive flat field access (for robustness)
    if (flatFieldName) {
        const keys = Object.keys(annotationValue);
        const matchingKey = keys.find(key => key.toLowerCase() === flatFieldName.toLowerCase());
        if (matchingKey) {
            console.log(`[getAnnotationFieldValue] ✓ Found via case-insensitive access: ${matchingKey} =`, annotationValue[matchingKey]);
            return annotationValue[matchingKey];
        }
    }
    
    console.log(`[getAnnotationFieldValue] ✗ Field '${fieldKey}' not found in annotation value`);
    return undefined;
}; 