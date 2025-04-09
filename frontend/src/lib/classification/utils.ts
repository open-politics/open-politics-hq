import { ClassificationSchemeRead, DictKeyDefinition as ClientDictKeyDefinition } from "@/client/models";
import { ResultFilter } from "@/components/collection/workspaces/classifications/ClassificationResultFilters"; 
import { FieldType, DictKeyDefinition, FormattedClassificationResult, ClassifiableDocument } from "./types"; 
import { ClassificationResultRead } from "@/client/models";
import { ClassificationService } from "./service";

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
    docResults: (ClassificationResultRead | FormattedClassificationResult)[],
    allSchemes: ClassificationSchemeRead[]
): boolean => {
    // If the filter is not active, it should always match (effectively skipping it)
    if (!filter.isActive) {
        return true;
    }

    const targetSchemeResult = docResults.find(r => r.scheme_id === filter.schemeId);

    // Handle case where document lacks results for the filtered scheme
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
    if ('dict_keys' in fieldDefinition && fieldDefinition.type === 'List[Dict[str, any]]' && filter.fieldKey) {
        // Case 1: Filtering on a specific dict_key within List[Dict]
        if (!Array.isArray(targetSchemeResult.value)) return false; // Value must be an array

        // Check if *any* item in the list matches the filter for the specified key
        return targetSchemeResult.value.some(item => {
            if (typeof item === 'object' && item !== null && filter.fieldKey! in item) {
                 const dictKeyValue = item[filter.fieldKey!];
                 // Use the type derived from the dict_key definition for comparison
                 return compareValues(dictKeyValue, filter.value, filter.operator, fieldType as any);
            }
            return false;
        });
    } else if ('name' in fieldDefinition) {
         // Case 2: Filtering on a top-level field
        const fieldValue = (typeof targetSchemeResult.value === 'object' && targetSchemeResult.value !== null && !Array.isArray(targetSchemeResult.value))
            ? targetSchemeResult.value[fieldDefinition.name] // Extract from object if field name exists
            : targetSchemeResult.value; // Use raw value for simple types or lists (or object if field name not present)

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
 * @param scheme - The corresponding classification scheme.
 * @returns A formatted string or the original value if formatting fails.
 */
export const formatDisplayValue = (value: any, scheme: ClassificationSchemeRead): string | number | null => {
  if (!value) return null;

  try {
    // Create a temporary result structure expected by ClassificationService.getFormattedValue
    // It expects a ClassificationResult-like structure, so we mock it minimally.
    const tempResult = {
        id: 0, // Mock ID
        document_id: 0, // Mock document ID
        scheme_id: scheme.id,
        value: value,
        timestamp: new Date().toISOString(), // Mock timestamp
        run_id: 0, // Mock run ID
    };

    // Adapt the ClassificationSchemeRead to the ClassificationScheme type expected by the service
    // This involves converting nested structures like fields and dict_keys if necessary.
    const adaptedScheme = {
        id: scheme.id,
        name: scheme.name,
        description: scheme.description,
        fields: scheme.fields.map(f => ({
            name: f.name,
            type: f.type as FieldType, // Assert type
            description: f.description,
            config: {
                scale_min: f.scale_min ?? undefined,
                scale_max: f.scale_max ?? undefined,
                is_set_of_labels: f.is_set_of_labels ?? undefined,
                labels: f.labels ?? undefined,
                dict_keys: f.dict_keys ? f.dict_keys.map((dk: any) => ({ name: dk.name, type: dk.type as "str" | "int" | "float" | "bool" })) : undefined
            }
        })),
        model_instructions: scheme.model_instructions ?? undefined,
        validation_rules: scheme.validation_rules ?? undefined,
        created_at: scheme.created_at,
        updated_at: scheme.updated_at,
        classification_count: scheme.classification_count ?? 0,
        document_count: scheme.document_count ?? 0
    };

    // Use the service's formatting function
    return ClassificationService.getFormattedValue(tempResult, adaptedScheme) as string | number | null;

  } catch (error) {
    console.error('Error formatting value:', error);

    // Fallback formatting logic (simplified)
    const field = scheme.fields[0];
    if (!field) return String(value);

    switch (field.type) {
      case 'int':
        const numVal = Number(value);
        if (isNaN(numVal)) return String(value);
        if (field.scale_min === 0 && field.scale_max === 1) {
          return numVal > 0.5 ? 'Positive' : 'Negative'; // Simplified fallback display
        }
        return typeof numVal === 'number' ? Number(numVal.toFixed(2)) : numVal;

      case 'List[str]':
         if (Array.isArray(value)) return value.join(', ');
         return String(value);

      default:
        return String(value); // Basic string conversion as fallback
    }
  }
};