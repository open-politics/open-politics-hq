import { ClassificationSchemeRead } from "@/client/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Info, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { FieldType } from "@/lib/classification/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center">
            Filters
            <TooltipProvider delayDuration={100}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 ml-1.5 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent align="start" className="max-w-xs">
                        <p className="text-xs">
                            Filter results based on specific criteria. Combine multiple filters to narrow down your view.
                            Filters apply across the Chart, Table, and Map tabs.
                        </p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </h3>
        <Button variant="outline" size="sm" onClick={addFilter} disabled={schemes.length === 0}>
          <Plus className="h-3 w-3 mr-1" />
          Add Filter
        </Button>
      </div>

      {filters.map((filter, index) => {
        const { type: fieldType, definition } = getTargetFieldDefinition(filter, schemes);
        const operators = getOperatorsForType(fieldType);
        const targetKeys = getTargetKeysForScheme(filter.schemeId, schemes);
        const hasLabelOptions = hasLabels(filter);
        const labelOptions = hasLabelOptions ? getLabelsForField(filter) : [];
        const fieldTypeDisplay = getFieldTypeDisplay(filter);
        const filterTooltip = getFilterTooltip(filter);

        return (
          <TooltipProvider key={index} delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                  <div className={cn(
                      "flex items-center space-x-2 p-2 rounded-md border",
                      filter.isActive ? "border-border/60 bg-background/30" : "border-dashed border-border/30 bg-muted/20 opacity-60"
                  )}>
                    {/* Active Toggle */}
                     <Switch
                        checked={filter.isActive}
                        onCheckedChange={(checked) => updateFilter(index, { isActive: checked })}
                        className="h-5 w-9 data-[state=checked]:bg-blue-500 data-[state=unchecked]:bg-gray-300"
                    />

                    {/* Scheme Select */}
                    <Select
                      value={filter.schemeId.toString()}
                      onValueChange={(value) => updateFilter(index, { schemeId: parseInt(value) })}
                      disabled={!filter.isActive}
                    >
                      <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue placeholder="Select Scheme" />
                      </SelectTrigger>
                      <SelectContent>
                        <ScrollArea className="max-h-60 w-full">
                          {schemes.map(scheme => (
                            <SelectItem key={scheme.id} value={scheme.id.toString()} className="text-xs">
                              {scheme.name}
                            </SelectItem>
                          ))}
                        </ScrollArea>
                      </SelectContent>
                    </Select>

                    {/* Field/Key Select */}
                    <Select
                      value={filter.fieldKey ?? ""}
                      onValueChange={(value) => updateFilter(index, { fieldKey: value })}
                      disabled={!filter.isActive || targetKeys.length <= 1}
                    >
                       <SelectTrigger className="w-[140px] h-8 text-xs">
                         <SelectValue placeholder="Select Field/Key" />
                       </SelectTrigger>
                      <SelectContent>
                         <ScrollArea className="max-h-60 w-full">
                          {targetKeys.map(tk => (
                            <SelectItem key={tk.key} value={tk.key} className="text-xs flex items-center justify-between">
                              <span className="truncate mr-2">{tk.name}</span>
                              <Badge variant="outline" className="text-xs px-1.5 py-0 shrink-0">{tk.type}</Badge>
                            </SelectItem>
                          ))}
                          {targetKeys.length === 0 && <div className="p-2 text-xs text-center italic text-muted-foreground">No keys</div>}
                         </ScrollArea>
                      </SelectContent>
                    </Select>

                    {/* Operator Select */}
                    <Select
                      value={filter.operator}
                      onValueChange={(value) => updateFilter(index, { operator: value as ResultFilter['operator'] })}
                      disabled={!filter.isActive}
                    >
                      <SelectTrigger className="w-[100px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <ScrollArea className="max-h-60 w-full">
                          {operators.map(op => (
                            <SelectItem key={op} value={op} className="text-xs">
                              {op}
                            </SelectItem>
                          ))}
                        </ScrollArea>
                      </SelectContent>
                    </Select>

                    {/* Value Input */}
                    {renderValueInput(filter, index, fieldType, hasLabelOptions, labelOptions, updateFilter)}

                    {/* Field Type Info */}
                    <Badge variant="outline" className="text-xs whitespace-nowrap h-6 px-1.5">
                       {fieldTypeDisplay}
                    </Badge>

                    {/* Remove Button */}
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => removeFilter(index)} disabled={!filter.isActive}>
                      <X className="h-4 w-4" />
                    </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent align="start" side="bottom" className="max-w-xs">
                  <p className="text-xs">{filterTooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}

      {schemes.length === 0 && filters.length === 0 && (
        <div className="text-center text-xs text-muted-foreground italic py-2">
          No classification schemes found in this run to create filters.
        </div>
      )}
      {schemes.length > 0 && filters.length === 0 && (
         <div className="text-center text-xs text-muted-foreground italic py-2">
            Click 'Add Filter' to start filtering results.
         </div>
      )}
    </div>
  );
};

// Helper function to render the correct input based on type and operator
const renderValueInput = (
  filter: ResultFilter,
  index: number,
  type: FieldType | 'bool' | 'float' | null,
  hasLabels: boolean,
  labels: string[],
  updateFilter: (index: number, updatedFilterData: Partial<ResultFilter>) => void
) => {
  const commonProps = { 
      className: "h-8 text-xs",
      disabled: !filter.isActive 
  };

  if (filter.operator === 'range') {
    return (
      <div className="flex items-center space-x-1 flex-1 min-w-[150px]">
        <Input
          type="number"
          placeholder="Min"
          value={filter.value[0] ?? ''}
          onChange={(e) => updateFilter(index, { value: [e.target.value ? parseFloat(e.target.value) : null, filter.value[1]] })}
          {...commonProps}
          className={cn(commonProps.className, "w-1/2")}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="number"
          placeholder="Max"
          value={filter.value[1] ?? ''}
          onChange={(e) => updateFilter(index, { value: [filter.value[0], e.target.value ? parseFloat(e.target.value) : null] })}
          {...commonProps}
          className={cn(commonProps.className, "w-1/2")}
        />
      </div>
    );
  } else if (type === 'bool' || (hasLabels && filter.operator === 'equals')) {
    // Use Select for boolean or fields with predefined labels when operator is 'equals'
    const options = type === 'bool' ? ["True", "False"] : labels;
    return (
      <Select
        value={filter.value.toString()} // Ensure value is string for Select
        onValueChange={(value) => updateFilter(index, { value: type === 'bool' ? value === 'True' : value })}
        disabled={!filter.isActive}
      >
        <SelectTrigger {...commonProps} className={cn(commonProps.className, "flex-1 min-w-[100px]")}>
          <SelectValue placeholder="Select Value" />
        </SelectTrigger>
        <SelectContent>
          <ScrollArea className="max-h-60 w-full">
            {options.map(opt => (
              <SelectItem key={opt} value={opt} className="text-xs">
                {opt}
              </SelectItem>
            ))}
          </ScrollArea>
        </SelectContent>
      </Select>
    );
  } else if (type === 'int' || type === 'float') {
    // Use Input type="number" for int/float when operator is not 'range'
    return (
      <Input
        type="number"
        value={filter.value ?? ''}
        onChange={(e) => updateFilter(index, { value: e.target.value ? parseFloat(e.target.value) : '' })}
        placeholder="Enter number..."
        {...commonProps}
        className={cn(commonProps.className, "flex-1 min-w-[100px]")}
      />
    );
  }

  // Default to Input type="text" for str, List[str], List[Dict], and others
  return (
    <Input
      type="text"
      value={filter.value ?? ''}
      onChange={(e) => updateFilter(index, { value: e.target.value })}
      placeholder="Enter value..."
      {...commonProps}
      className={cn(commonProps.className, "flex-1 min-w-[100px]")}
    />
  );
}; 