import { ClassificationSchemeRead, DictKeyDefinition as ClientDictKeyDefinition } from "@/client/models";
import { ResultFilter } from "@/components/collection/workspaces/classifications/ClassificationResultFilters"; 
import { FieldType, DictKeyDefinition, FormattedClassificationResult, DataRecord } from "./types"; 
import { ClassificationResultRead } from "@/client/models";

// --- getTargetFieldDefinition (from ResultFilters.tsx) ---
export const getTargetFieldDefinition = (
  filter: ResultFilter,
  schemes: ClassificationSchemeRead[]
): {
  type: FieldType | "bool" | "float" | null;
  definition: ClassificationSchemeRead['fields'][number] | ClientDictKeyDefinition | null;
} => {
    const scheme = schemes.find(s => s.id === filter.schemeId);
    if (!scheme || !scheme.fields || scheme.fields.length === 0) {
        return { type: null, definition: null };
    }

    // Target the specific field/key if specified
    const targetKeyName = filter.fieldKey ?? scheme.fields[0]?.name;
    if (!targetKeyName) {
         return { type: null, definition: null }; // No field found
    }

    // Check if it's a dict_key within List[Dict]
    if (scheme.fields[0].type === 'List[Dict[str, any]]' && scheme.fields[0].dict_keys) {
        const dictKeyDef = scheme.fields[0].dict_keys.find(dk => dk.name === targetKeyName);
        if (dictKeyDef) {
            const validTypes = ["str", "int", "float", "bool"];
            const refinedType = validTypes.includes(dictKeyDef.type)
                ? dictKeyDef.type as "str" | "int" | "float" | "bool"
                : null;
            return { type: refinedType, definition: dictKeyDef };
        }
        // If filter.fieldKey was set but not found in dict_keys, it's an invalid filter for this type
        if (filter.fieldKey) return { type: null, definition: null };
    }

    // Check if it's one of potentially multiple top-level fields
    const fieldDef = scheme.fields.find(f => f.name === targetKeyName);
    if (fieldDef) {
        const validFieldTypes: FieldType[] = ["int", "str", "List[str]", "List[Dict[str, any]]"];
        // Special case: Interpret int fields with 0/1 scale as boolean for filtering
        if (fieldDef.type === 'int' && fieldDef.scale_min === 0 && fieldDef.scale_max === 1) {
            return { type: 'bool', definition: fieldDef };
        }
        const refinedType = validFieldTypes.includes(fieldDef.type as FieldType)
            ? fieldDef.type as FieldType
            : null;
        return { type: refinedType, definition: fieldDef };
    }

    return { type: null, definition: null }; // Fallback
};

// Helper to get possible target keys for a scheme (Moved from ClassificationResultFilters)
export const getTargetKeysForScheme = (schemeId: number, schemes: ClassificationSchemeRead[]): { key: string, name: string, type: string }[] => {
    const scheme = schemes.find(s => s.id === schemeId);
    if (!scheme || !scheme.fields || scheme.fields.length === 0) return [];

    // Case 1: List[Dict] with dict_keys defined
    if (scheme.fields[0].type === 'List[Dict[str, any]]' && scheme.fields[0].dict_keys && scheme.fields[0].dict_keys.length > 0) {
        const mapType = (clientType: string): string => {
            const validTypes = ["str", "int", "float", "bool"];
            return validTypes.includes(clientType) ? clientType : "unknown";
        };
        // Use field name as the key for selection, but display name might differ
        return scheme.fields[0].dict_keys.map(dk => ({ key: dk.name, name: dk.name, type: mapType(dk.type) }));
    }

    // Case 2: Multiple fields per scheme or single field
    // Use field name as the key
    return scheme.fields.map(f => ({ key: f.name, name: f.name, type: f.type }));
};

// --- compareValues (from ClassificationResultsChart.tsx / ClassificationRunner.tsx) ---
export const compareValues = (actual: any, filterVal: any, operator: ResultFilter['operator'], fieldType: FieldType | 'bool' | 'float' | null): boolean => {
    // Handle nulls/undefined gracefully
    if (actual === null || actual === undefined) {
        if (operator === 'equals' && (filterVal === 'N/A' || filterVal === null || filterVal === undefined || filterVal === '')) return true;
        return false;
    }
     if (filterVal === null || filterVal === undefined || filterVal === '') {
         if (operator === 'equals') return false; // Already handled actual = null above
         // contains, range, gt, lt with null/empty filter value generally don't match non-null actual value
         return false;
     }

    switch (operator) {
        case 'equals':
            if (fieldType === 'bool') {
                const actualBool = Boolean(actual);
                const filterBool = filterVal === "True";
                return actualBool === filterBool;
            }
            // Case-insensitive string comparison seems appropriate for general 'equals'
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

// --- checkFilterMatch (from ClassificationResultsChart.tsx / ClassificationRunner.tsx) ---
// Needs ClassificationResultRead type, might need to import or define locally if not shared

export const checkFilterMatch = (
    filter: ResultFilter,
    // Results for a SINGLE datarecord (previously document)
    datarecordResults: (ClassificationResultRead | FormattedClassificationResult)[],
    allSchemes: ClassificationSchemeRead[]
): boolean => {
    // If the filter is not active, it should always match (effectively skipping it)
    if (!filter.isActive) {
        return true;
    }

    // Find the result within this datarecord's results that matches the filter's scheme
    const targetSchemeResult = datarecordResults.find(r => r.scheme_id === filter.schemeId);

    // Handle case where datarecord lacks results for the filtered scheme
    if (!targetSchemeResult || targetSchemeResult.value === null || targetSchemeResult.value === undefined) {
        // Match only if filter is 'equals' N/A or null/empty
        return filter.operator === 'equals' && (filter.value === 'N/A' || filter.value === null || filter.value === undefined || filter.value === '');
    }

    const { type: fieldType, definition: fieldDefinition } = getTargetFieldDefinition(filter, allSchemes);

    // If we couldn't identify the field type, we can't reliably filter
    if (!fieldType || !fieldDefinition) {
        console.warn("Cannot filter: Could not determine field type or definition for filter:", filter);
        return false; // Treat as non-match if definition is unclear
    }

    let actualValue: any;

    // Value Extraction Logic
    // Check if fieldDefinition is a dict key definition (has 'name' and 'type', but not other Field props)
    const isDictKeyDef = fieldDefinition && 'name' in fieldDefinition && 'type' in fieldDefinition && !('scale_min' in fieldDefinition);

    if (isDictKeyDef && filter.fieldKey) {
        // Case 1: Filtering on a specific dict_key within List[Dict]
        // This assumes the result value corresponding to the scheme is an array of dicts
        if (!Array.isArray(targetSchemeResult.value)) return false; // Value must be an array for List[Dict]

        // Check if *any* item in the list matches the filter for the specified key
        return targetSchemeResult.value.some(item => {
            if (typeof item === 'object' && item !== null && filter.fieldKey! in item) {
                 const dictKeyValue = item[filter.fieldKey!];
                 // Use the type derived from the dict_key definition for comparison
                 return compareValues(dictKeyValue, filter.value, filter.operator, fieldType as any); // Type assertion needed here
            }
            return false;
        });
    } else if (fieldDefinition && 'name' in fieldDefinition && !isDictKeyDef) {
         // Case 2: Filtering on a top-level field (fieldDefinition is a ClassificationField)
        const topLevelFieldName = fieldDefinition.name;
        // Check if the result value itself is the value (simple types, lists) or if it's an object containing the field name
        const fieldValue = (typeof targetSchemeResult.value === 'object' && targetSchemeResult.value !== null && !Array.isArray(targetSchemeResult.value) && topLevelFieldName in targetSchemeResult.value)
            ? targetSchemeResult.value[topLevelFieldName] // Extract from object if field name exists
            : targetSchemeResult.value; // Use raw value for simple types or lists, or if value is object but doesn't contain the key

        actualValue = fieldValue;

        // Edge case: If field definition is top-level, but value is still an object (e.g. LLM didn't nest properly)
        // And we are filtering for 'contains', try stringifying the object value
        if(filter.operator === 'contains' && typeof actualValue === 'object' && actualValue !== null){
             try {
                 actualValue = JSON.stringify(actualValue);
             } catch (e) { /* ignore stringify error */ }
        }

         // Use the type from the field definition for comparison
         return compareValues(actualValue, filter.value, filter.operator, fieldType);
    } else {
        console.warn("Cannot filter: Could not determine value extraction logic for filter:", filter, fieldDefinition);
        return false; // Fallback if extraction logic is unclear
    }
};

/**
 * Extracts a potential location string from a classification result value.
 * @param value - The classification result value (can be string, object, array).
 * @param fieldKey - Optional: A specific key to prioritize if the value is an object.
 * @returns A string representing the location, or null if not found.
 */
export const extractLocationString = (value: any, fieldKey: string | null): string | null => {
   if (!value) return null;

   // Handle simple string value
   if (typeof value === 'string') return value.trim() || null; // Return null if empty string

   // Handle object value
   if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
       // Prioritize the specified fieldKey
       if (fieldKey && value[fieldKey] && typeof value[fieldKey] === 'string') {
            const strVal = value[fieldKey].trim();
            if (strVal) return strVal;
       }
       // Fallback: Look for common location-related keys
       const commonKeys = ['location', 'address', 'place', 'city', 'country'];
       for (const key of commonKeys) {
           if (value[key] && typeof value[key] === 'string') {
                const strVal = value[key].trim();
                if (strVal) return strVal;
           }
       }
       // Fallback: Stringify the first string value found
       for (const key in value) {
          if (typeof value[key] === 'string') {
               const strVal = value[key].trim();
               if (strVal) return strVal;
          }
       }
   }

   // Handle array value (e.g., List[Dict]) - Extract from the first item?
   if (Array.isArray(value) && value.length > 0) {
        const firstItem = value[0];
        if (typeof firstItem === 'string') return firstItem.trim() || null;
        if (typeof firstItem === 'object' && firstItem !== null) {
             // Try extracting from the first object using the same logic as above
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

   return null; // Return null if no suitable string found
};

/**
 * Formats a classification value based on its scheme for display purposes.
 * @param value - The raw classification value.
 * @param scheme - The corresponding **client** classification scheme.
 * @returns A formatted string or the original value if formatting fails.
 */
export const formatDisplayValue = (value: any, scheme: ClassificationSchemeRead): string | number | null => {
  if (value === null || value === undefined) return null;

  const field = scheme.fields?.[0];
  if (!field) {
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
  }

  try {
    switch (field.type as FieldType) { 
      case 'int':
        const numVal = Number(value);
        if (isNaN(numVal)) return String(value); 
        if (field.scale_min === 0 && field.scale_max === 1) {
          return numVal > 0.5 ? 'True' : 'False'; 
        }
        return typeof numVal === 'number' ? Number(numVal.toFixed(2)) : numVal;

      case 'str':
        return String(value);

      case 'List[str]':
        if (Array.isArray(value)) {
          return value.filter(item => typeof item === 'string').join(', ');
        }
        return String(value); 

      case 'List[Dict[str, any]]':
        if (Array.isArray(value)) {
          return value.length > 0 ? `${value.length} item(s)` : 'Empty list';
        }
        if (typeof value === 'object' && value !== null) {
           return Object.keys(value).length > 0 ? 'Complex Object' : 'Empty object';
        }
        return 'Complex Data'; 

      default:
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }
  } catch (error) {
    console.error('Error formatting display value:', error);
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
};