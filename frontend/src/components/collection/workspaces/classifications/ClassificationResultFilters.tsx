import { ClassificationSchemeRead } from "@/client/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Info, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { FieldType } from "@/lib/classification/types";
import { Switch } from "@/components/ui/switch"; // Import Switch component
import { Label } from "@/components/ui/label";   // Import Label component
import { cn } from "@/lib/utils"; // Import cn utility

// Define the filter interface more formally
export interface ResultFilter {
  schemeId: number;
  fieldKey?: string; // Optional: Name of the field or dict_key to filter on
  operator: 'equals' | 'contains' | 'range' | 'greater_than' | 'less_than'; // Added comparison operators
  value: any; // Can be string, number, boolean, or [number | null, number | null] for range
  isActive: boolean; // Add isActive property
}

interface ResultFiltersProps {
  filters: ResultFilter[];
  schemes: ClassificationSchemeRead[];
  onChange: (filters: ResultFilter[]) => void;
}

// Define an alias for the DictKeyDefinition structure derived from the API model for clarity in the return type
type ClientDictKeyDefinition = NonNullable<ClassificationSchemeRead['fields'][number]['dict_keys']>[number];

// Helper to find the specific field or dict_key definition based on the filter
export const getTargetFieldDefinition = (
  filter: ResultFilter,
  schemes: ClassificationSchemeRead[]
): {
  // Internal type representation (can include derived types like 'bool')
  type: FieldType | "bool" | "float" | null; 
  // Definition uses types derived from the API model ClassificationSchemeRead
  definition: ClassificationSchemeRead['fields'][number] | ClientDictKeyDefinition | null; 
} => {
    const scheme = schemes.find(s => s.id === filter.schemeId);
    if (!scheme || !scheme.fields || scheme.fields.length === 0) {
        return { type: null, definition: null };
    }

    // Target the specific field/key if specified, default to the first field's name
    const targetKeyName = filter.fieldKey ?? scheme.fields[0]?.name;
    if (!targetKeyName) {
         return { type: null, definition: null }; // No field found
    }

    // Check if it's a dict_key within List[Dict]
    // The definition comes from scheme.fields[0].dict_keys (API type)
    if (scheme.fields[0].type === 'List[Dict[str, any]]' && scheme.fields[0].dict_keys) {
        const dictKeyDef = scheme.fields[0].dict_keys.find(dk => dk.name === targetKeyName);
        if (dictKeyDef) {
            // Map API dict_key type to internal filter type
            // Allowed API types: "str", "int", "float", "bool" (assuming based on previous code)
            const validTypes = ["str", "int", "float", "bool"];
            const refinedType = validTypes.includes(dictKeyDef.type)
                ? dictKeyDef.type as "str" | "int" | "float" | "bool"
                : null;
            // dictKeyDef is ClientDictKeyDefinition (derived from API)
            return { type: refinedType, definition: dictKeyDef };
        }
        // If filter.fieldKey was set but not found in dict_keys, it's an invalid filter
        if (filter.fieldKey) return { type: null, definition: null };
    }

    // Check if it's a top-level field
    // The definition comes from scheme.fields (API type)
    const fieldDef = scheme.fields.find(f => f.name === targetKeyName);
    if (fieldDef) {
        // Map API field type to internal filter type
        // Allowed API types: "int", "str", "List[str]", "List[Dict[str, any]]"
        const validFieldTypes: FieldType[] = ["int", "str", "List[str]", "List[Dict[str, any]]"];
        // Special case: Interpret int fields with 0/1 scale as boolean for filtering
        if (fieldDef.type === 'int' && fieldDef.scale_min === 0 && fieldDef.scale_max === 1) {
            // fieldDef is ClassificationSchemeRead['fields'][number] (API type)
            return { type: 'bool', definition: fieldDef };
        }
        // Map API type to internal FieldType
        const refinedType = validFieldTypes.includes(fieldDef.type as FieldType)
            ? fieldDef.type as FieldType
            : null;
         // fieldDef is ClassificationSchemeRead['fields'][number] (API type)
        return { type: refinedType, definition: fieldDef };
    }

    return { type: null, definition: null }; // Fallback if no matching field or key found
};

// Helper to get possible target keys for a scheme
const getTargetKeysForScheme = (schemeId: number, schemes: ClassificationSchemeRead[]): { key: string, name: string, type: string }[] => {
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

export const ResultFilters = ({ filters, schemes, onChange }: ResultFiltersProps) => {
  const addFilter = () => {
    if (schemes.length === 0) return;
    const defaultScheme = schemes[0];
    const targetKeys = getTargetKeysForScheme(defaultScheme.id, schemes);
    const initialFieldKey = targetKeys.length > 0 ? targetKeys[0].key : undefined;
    // Pass the potential initialFieldKey to getTargetFieldDefinition
    const { type: initialType } = getTargetFieldDefinition({ schemeId: defaultScheme.id, fieldKey: initialFieldKey, operator: 'equals', value: '', isActive: true }, schemes);
    const initialOperators = getOperatorsForType(initialType);
    const initialOperator = initialOperators[0];

    onChange([...filters, {
        schemeId: defaultScheme.id,
        fieldKey: initialFieldKey,
        operator: initialOperator,
        value: initialOperator === 'range' ? [null, null] : initialType === 'bool' ? 'False' : '', // Default bool to False or empty string
        isActive: true // Initialize isActive to true
    }]);
  };

  const updateFilter = (index: number, updatedFilterData: Partial<ResultFilter>) => {
    const newFilters = [...filters];
    const currentFilter = newFilters[index];
    const mergedFilter = { ...currentFilter, ...updatedFilterData };

    // If only isActive changed, update and return early
    if (Object.keys(updatedFilterData).length === 1 && 'isActive' in updatedFilterData) {
        newFilters[index] = mergedFilter;
        onChange(newFilters);
        return;
    }

    let needsValueReset = false;

    // If schemeId changed, reset fieldKey, operator, and value
    if (updatedFilterData.schemeId && updatedFilterData.schemeId !== currentFilter.schemeId) {
        const newSchemeId = updatedFilterData.schemeId;
        const targetKeys = getTargetKeysForScheme(newSchemeId, schemes);
        // Always reset fieldKey to the first available key of the new scheme
        mergedFilter.fieldKey = targetKeys.length > 0 ? targetKeys[0].key : undefined;
        needsValueReset = true; // Reset operator and value too
    }
    // If fieldKey changed, reset operator and value
    else if ('fieldKey' in updatedFilterData && updatedFilterData.fieldKey !== currentFilter.fieldKey) {
        needsValueReset = true;
    }
     // If operator changed, reset value
    else if (updatedFilterData.operator && updatedFilterData.operator !== currentFilter.operator) {
        needsValueReset = true;
    }

    // If reset needed, determine new operator and default value
    if (needsValueReset) {
        const { type: newType } = getTargetFieldDefinition(mergedFilter, schemes);
        const newOperators = getOperatorsForType(newType);
        // Only reset operator if the current one isn't valid for the new type
        if (!newOperators.includes(mergedFilter.operator)) {
             mergedFilter.operator = newOperators[0];
        }
        // Reset value based on operator and type
        mergedFilter.value = mergedFilter.operator === 'range' ? [null, null] : newType === 'bool' ? 'False' : '';
    }


    newFilters[index] = mergedFilter;
    onChange(newFilters);
  };

  const removeFilter = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  // Get appropriate operators based on field type
  const getOperatorsForType = (type: FieldType | 'bool' | 'float' | null): Array<ResultFilter['operator']> => {
    switch (type) {
      case 'int':
      case 'float':
        return ['equals', 'range', 'greater_than', 'less_than'];
      case 'List[str]': // For filtering the list itself or items within
      case 'str':
        return ['equals', 'contains'];
      case 'List[Dict[str, any]]': // This type usually implies filtering *within* its dict_keys
                                    // The operators depend on the specific dict_key's type
                                    // Provide a default set, but the filtering logic must handle the key's type
         return ['contains', 'equals'];
      case 'bool':
        return ['equals'];
      default: // Unknown or unhandled type
        return ['equals', 'contains'];
    }
  };

  // Get a helpful tooltip for the filter based on field type
  const getFilterTooltip = (filter: ResultFilter) => {
    const { type } = getTargetFieldDefinition(filter, schemes);
    const scheme = schemes.find(s => s.id === filter.schemeId);
    const fieldName = filter.fieldKey ?? scheme?.fields[0]?.name ?? 'field';

    switch (type) {
      case 'int':
      case 'float':
        return `Filter numeric values in '${fieldName}'. Use 'equals', range, or comparison operators.`;
      case 'List[str]':
        return `Filter text lists in '${fieldName}'. Use 'contains' to find items containing your text or 'equals' for exact matches (case-sensitive).`;
      case 'List[Dict[str, any]]':
         return `Filter complex structures by checking the value associated with the key '${fieldName}'. Use 'contains' for text search or 'equals' for exact match.`;
      case 'str':
         return `Filter text values in '${fieldName}'. Use 'equals' for exact matches (case-sensitive) or 'contains' (case-insensitive).`;
      case 'bool':
        return `Filter Yes/No values in '${fieldName}'. Use 'equals' (True/False).`;
      default:
        return `Filter results based on the '${fieldName}' field/key of the '${scheme?.name}' scheme.`;
    }
  };

  // Check if the target field has predefined labels
  const hasLabels = (filter: ResultFilter): boolean => {
    const { definition } = getTargetFieldDefinition(filter, schemes);
    // Check if it's a ClassificationFieldRead with labels
    if (definition && 'is_set_of_labels' in definition) {
        return (definition.is_set_of_labels ?? false) &&
               Array.isArray(definition.labels) &&
               definition.labels.length > 0;
    }
    // Check if it's a DictKeyDefinition of type bool
    if (definition && 'type' in definition && definition.type === 'bool') {
        return true; // Treat bool as having labels "True" and "False"
    }
    return false;
  };

  // Get labels for a field if available
  const getLabelsForField = (filter: ResultFilter): string[] => {
    const { definition } = getTargetFieldDefinition(filter, schemes);
    // Handle ClassificationFieldRead
    if (definition && 'labels' in definition && definition.labels) {
        return definition.labels;
    }
    // Handle DictKeyDefinition of type bool
    if (definition && 'type' in definition && definition.type === 'bool') {
        return ["True", "False"];
    }
    return [];
  };

  // Get a display name for the field type
  const getFieldTypeDisplay = (filter: ResultFilter): string => {
    const { type } = getTargetFieldDefinition(filter, schemes);
    switch (type) {
      case 'int': return "Number";
      case 'float': return "Decimal";
      case 'List[str]': return "Text List";
      case 'List[Dict[str, any]]': return "Complex Structure"; // This refers to the overall scheme type
      case 'str': return "Text";
      case 'bool': return "Yes/No";
      default: return "Unknown";
    }
  };

  if (schemes.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No classification schemes available to filter by.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Filter Results</h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs">
                Filter results based on specific classification values or fields within complex classifications. Documents will be shown only if they match ALL active filters.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {filters.map((filter, index) => {
        const targetKeys = getTargetKeysForScheme(filter.schemeId, schemes);
        const { type: fieldType, definition: fieldDefinition } = getTargetFieldDefinition(filter, schemes);
        // Get operators based on the *actual* field/key type
        const operators = getOperatorsForType(fieldType);
        const showLabelsDropdown = (fieldType === 'bool' || hasLabels(filter)) && filter.operator === 'equals';
        const labels = getLabelsForField(filter); // Gets labels for bool or List[str] with is_set_of_labels
        const fieldTypeDisplay = getFieldTypeDisplay(filter);
        const filterTooltip = getFilterTooltip(filter);

        // Find the display name for the selected fieldKey
        const selectedKeyInfo = targetKeys.find(tk => tk.key === filter.fieldKey);
        const fieldKeyDisplayName = selectedKeyInfo?.name ?? filter.fieldKey ?? 'Select Field/Key';

        return (
          <div
             key={index}
             className={cn(
               "flex flex-col gap-2 p-3 border rounded-md bg-muted/20 transition-opacity",
               !filter.isActive && "opacity-60" // Dim if inactive
             )}
          >
            {/* Row 1: Activation Switch, Scheme, Field Key (optional), Type, Remove Button */}
            <div className="flex gap-2 items-center w-full">
              {/* Activation Switch */}
              <div className="flex items-center space-x-2 shrink-0 pr-2 border-r mr-2">
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch
                        id={`filter-active-${index}`}
                        checked={filter.isActive}
                        onCheckedChange={(checked) => updateFilter(index, { isActive: checked })}
                        className={filter.isActive ? "bg-green-500" : "bg-red-500"}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Toggle filter activity</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                 {/* Optional Label (uncomment if needed) */}
                 {/* <Label htmlFor={`filter-active-${index}`} className="text-xs text-muted-foreground cursor-pointer">Active</Label> */}
              </div>

              {/* Scheme Selector */}
              <Select
                value={filter.schemeId.toString()}
                onValueChange={value => updateFilter(index, { schemeId: parseInt(value) })}
              >
                <SelectTrigger className="w-[180px] shrink-0">
                  <SelectValue placeholder="Select scheme" />
                </SelectTrigger>
                <SelectContent>
                  {schemes.map(scheme => (
                    <SelectItem key={scheme.id} value={scheme.id.toString()}>
                      {scheme.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Field/Key Selector (Show if > 1 potential key) */}
              {targetKeys.length > 1 && (
                  <Select
                    // Use filter.fieldKey which should store the unique key
                    value={filter.fieldKey || ''}
                    onValueChange={value => updateFilter(index, { fieldKey: value || undefined })} // Set to undefined if empty string
                  >
                    <SelectTrigger className="w-[150px] shrink-0">
                       {/* Display the potentially different 'name' */}
                      <SelectValue placeholder="Select field/key">{fieldKeyDisplayName}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {targetKeys.map(tk => (
                        <SelectItem key={tk.key} value={tk.key}>
                          {tk.name} ({tk.type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
              )}
              {/* Show simplified field name if only one option */}
              {targetKeys.length === 1 && (
                 <Badge variant="secondary" className="text-xs whitespace-nowrap px-3 py-2">
                    {targetKeys[0].name}
                 </Badge>
              )}

              {/* Type Badge */}
              <Badge variant="outline" className="text-xs whitespace-nowrap">
                {fieldTypeDisplay}
              </Badge>

              {/* Tooltip & Remove Button */}
               <TooltipProvider>
                 <Tooltip>
                   <TooltipTrigger asChild>
                     <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help shrink-0" />
                   </TooltipTrigger>
                   <TooltipContent>
                     <p className="max-w-xs">{filterTooltip}</p>
                   </TooltipContent>
                 </Tooltip>
               </TooltipProvider>
               <Button variant="ghost" size="icon" onClick={() => removeFilter(index)} className="ml-auto shrink-0" >
                 <X className="h-4 w-4" />
               </Button>

            </div>

            {/* Row 2: Operator, Value Input */}
            <div className="flex gap-2 items-center w-full pl-10"> {/* Added padding-left to align with inputs after switch */}
              {/* Operator Selector */}
              <Select
                value={filter.operator}
                onValueChange={value => updateFilter(index, { operator: value as ResultFilter['operator'] })}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Operator" />
                </SelectTrigger>
                <SelectContent>
                  {/* Render only valid operators for the current type */}
                  {operators.includes('equals') && <SelectItem value="equals">Equals</SelectItem>}
                  {operators.includes('contains') && <SelectItem value="contains">Contains</SelectItem>}
                  {operators.includes('range') && <SelectItem value="range">Range</SelectItem>}
                  {operators.includes('greater_than') && <SelectItem value="greater_than">&gt;</SelectItem>}
                  {operators.includes('less_than') && <SelectItem value="less_than">&lt;</SelectItem>}
                </SelectContent>
              </Select>

              {/* Value Input (Conditional) */}
              {filter.operator === 'range' && (fieldType === 'int' || fieldType === 'float') ? (
                // Range Input for Numbers
                <div className="flex gap-2 flex-1">
                  <Input
                    type="number"
                    value={Array.isArray(filter.value) ? filter.value[0] ?? '' : ''}
                    onChange={e => updateFilter(index, {
                      value: [e.target.value === '' ? null : parseFloat(e.target.value), Array.isArray(filter.value) ? filter.value[1] : null]
                    })}
                    className="w-full"
                    placeholder="Min"
                    step="any"
                  />
                  <Input
                    type="number"
                    value={Array.isArray(filter.value) ? filter.value[1] ?? '' : ''}
                    onChange={e => updateFilter(index, {
                      value: [Array.isArray(filter.value) ? filter.value[0] : null, e.target.value === '' ? null : parseFloat(e.target.value)]
                    })}
                    className="w-full"
                    placeholder="Max"
                    step="any"
                  />
                </div>
              ) : showLabelsDropdown ? (
                 // Dropdown for Boolean or List[str] with labels
                <Select
                  value={String(filter.value ?? '')} // Handle potential boolean value
                  onValueChange={value => updateFilter(index, {
                     value: fieldType === 'bool' ? (value === "True") : value
                  })}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select value" />
                  </SelectTrigger>
                  <SelectContent>
                    {labels.map((label, i) => (
                      <SelectItem key={i} value={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (fieldType === 'int' || fieldType === 'float') && ['equals', 'greater_than', 'less_than'].includes(filter.operator) ? (
                 // Number Input for specific comparisons
                 <Input
                    type="number"
                    value={filter.value ?? ''}
                    onChange={e => updateFilter(index, {
                        value: e.target.value === '' ? null : parseFloat(e.target.value)
                    })}
                    className="flex-1"
                    placeholder="Value"
                    step="any"
                 />
              ) : (
                // Default Text Input
                <Input
                  value={filter.value ?? ''}
                  onChange={e => updateFilter(index, { value: e.target.value })}
                  className="flex-1"
                  placeholder={filter.operator === 'contains' ? "Search text..." : "Value..."}
                />
              )}
            </div>
          </div>
        );
      })}

      <Button onClick={addFilter} variant="outline" size="sm" className="mt-2">
        <Plus className="h-4 w-4 mr-2" /> Add Filter
      </Button>
    </div>
  );
}; 