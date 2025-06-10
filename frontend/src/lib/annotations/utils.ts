import { AnnotationSchemaRead } from "@/client/models";
import { ResultFilter } from "@/components/collection/infospaces/annotation/ClassificationResultFilters"; 
import { FieldType, DictKeyDefinition, FormattedAnnotation, Asset } from "./types"; 
import { AnnotationRead as ClientAnnotationRead } from "@/client/models";

// --- getTargetFieldDefinition (from ResultFilters.tsx) ---
export const getTargetFieldDefinition = (
  filter: ResultFilter,
  schemas: AnnotationSchemaRead[]
): {
  type: FieldType | "bool" | "float" | null;
  definition: any; // Simplified to any for now
} => {
    const schema = schemas.find(s => s.id === filter.schemeId);
    if (!schema || !schema.output_contract || !(schema.output_contract as any).properties) {
        return { type: null, definition: null };
    }
    
    const properties = (schema.output_contract as any).properties;
    const fieldNames = Object.keys(properties);
    const targetKeyName = filter.fieldKey ?? fieldNames[0];

    if (!targetKeyName) {
         return { type: null, definition: null };
    }
    
    // This logic is complex and depends heavily on the structure of `output_contract`.
    // The original logic for `List[Dict[str, any]]` is simplified here.
    const fieldDef = properties[targetKeyName];
    if (fieldDef) {
        // Basic type mapping
        const typeMap: Record<string, FieldType | 'bool' | 'float'> = {
            "integer": "int",
            "number": "float",
            "string": "str",
            "boolean": "bool",
            "array": "List[str]", // Assumption
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
    return Object.entries(properties).map(([key, value]: [string, any]) => ({
        key: key,
        name: value.title || key,
        type: value.type || 'unknown'
    }));
};

export const compareValues = (actual: any, filterVal: any, operator: ResultFilter['operator'], fieldType: FieldType | 'bool' | 'float' | null): boolean => {
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
            if (fieldType === 'bool') {
                const actualBool = Boolean(actual);
                const filterBool = filterVal === "True";
                return actualBool === filterBool;
            }
            return String(actual).toLowerCase() === String(filterVal).toLowerCase();
        case 'contains':
             if (fieldType === 'List[str]') {
                 return Array.isArray(actual) && actual.some(item => String(item).toLowerCase().includes(String(filterVal).toLowerCase()));
             }
             if (fieldType === 'List[Dict[str, any]]') {
                  try {
                     const complexString = JSON.stringify(actual).toLowerCase();
                     return complexString.includes(String(filterVal).toLowerCase());
                  } catch (e) { return false; }
             }
            return String(actual).toLowerCase().includes(String(filterVal).toLowerCase());
        case 'range':
            if ((fieldType === 'int' || fieldType === 'float') && Array.isArray(filterVal) && filterVal.length === 2) {
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
             if (fieldType === 'int' || fieldType === 'float') {
                 const numActual = Number(actual);
                 const numFilter = Number(filterVal);
                 return !isNaN(numActual) && !isNaN(numFilter) && numActual > numFilter;
             }
             return false;
        case 'less_than':
             if (fieldType === 'int' || fieldType === 'float') {
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
    const targetSchemaResult = assetResults.find(r => r.schema_id === filter.schemeId);
    if (!targetSchemaResult || targetSchemaResult.value === null || targetSchemaResult.value === undefined) {
        return filter.operator === 'equals' && (filter.value === 'N/A' || filter.value === null || filter.value === undefined || filter.value === '');
    }
    const { type: fieldType, definition: fieldDefinition } = getTargetFieldDefinition(filter, allSchemas);
    if (!fieldType || !fieldDefinition) {
        console.warn("Cannot filter: Could not determine field type or definition for filter:", filter);
        return false;
    }

    // This logic is simplified. It assumes the `value` of the annotation is an object
    // where keys are the field names from the schema.
    const actualValue = (targetSchemaResult.value as any)[filter.fieldKey || ''];

    if (filter.operator === 'contains' && typeof actualValue === 'object' && actualValue !== null) {
        try {
            const stringified = JSON.stringify(actualValue);
            return compareValues(stringified, filter.value, filter.operator, 'str');
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