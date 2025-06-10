import { AnnotationSchemaRead } from "@/client/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Info, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { FieldType } from "@/lib/annotations/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { FilterLogicMode } from './ClassificationRunner';

// Define the filter interface more formally
export interface ResultFilter {
  schemaId: number;
  fieldKey?: string;
  operator: 'equals' | 'contains' | 'range' | 'greater_than' | 'less_than';
  value: any;
  isActive: boolean;
}

interface AnnotationResultFiltersProps {
  filters: ResultFilter[];
  schemas: AnnotationSchemaRead[];
  onChange: (filters: ResultFilter[]) => void;
  logicMode: FilterLogicMode;
  onLogicModeChange: (mode: FilterLogicMode) => void;
}

// These helpers need to be updated to work with `output_contract`
export const getTargetFieldDefinition = (
  filter: ResultFilter,
  schemas: AnnotationSchemaRead[]
): {
  type: FieldType | "bool" | "float" | null; 
  definition: any | null; 
} => {
    const schema = schemas.find(s => s.id === filter.schemaId);
    if (!schema || !schema.output_contract) {
        return { type: null, definition: null };
    }
    const properties = (schema.output_contract as any).properties;
    if(!properties) return { type: null, definition: null };

    const targetKeyName = filter.fieldKey ?? (Object.keys(properties)[0] || null);
    if (!targetKeyName) {
         return { type: null, definition: null };
    }

    const fieldDef = properties[targetKeyName];
    if (fieldDef) {
        const typeMap: Record<string, FieldType | 'bool' | 'float'> = {
            "integer": "int", "number": "float", "string": "str", "boolean": "bool", "array": "List[str]",
        };
        return { type: typeMap[fieldDef.type] || 'str', definition: fieldDef };
    }

    return { type: null, definition: null };
};

export const getTargetKeysForScheme = (schemaId: number, schemas: AnnotationSchemaRead[]): { key: string, name: string, type: string }[] => {
    const schema = schemas.find(s => s.id === schemaId);
    if (!schema || !schema.output_contract) return [];
    
    const properties = (schema.output_contract as any).properties;
    if (!properties) return [];

    return Object.entries(properties).map(([key, value] : [string, any]) => ({
        key: key,
        name: value.title || key,
        type: value.type || 'unknown',
    }));
};

export const AnnotationResultFilters = ({ filters, schemas, onChange, logicMode, onLogicModeChange }: AnnotationResultFiltersProps) => {
  const activeFilterCount = filters.filter(f => f.isActive).length;

  const addFilter = () => {
    if (schemas.length === 0) return;
    const defaultSchema = schemas[0];
    const targetKeys = getTargetKeysForScheme(defaultSchema.id, schemas);
    const initialFieldKey = targetKeys.length > 0 ? targetKeys[0].key : undefined;
    
    const { type: initialType } = getTargetFieldDefinition({ schemaId: defaultSchema.id, fieldKey: initialFieldKey, operator: 'equals', value: '', isActive: true }, schemas);
    const initialOperators = getOperatorsForType(initialType);
    const initialOperator = initialOperators[0];

    onChange([...filters, {
        schemaId: defaultSchema.id,
        fieldKey: initialFieldKey,
        operator: initialOperator,
        value: initialOperator === 'range' ? [null, null] : initialType === 'bool' ? 'False' : '',
        isActive: true
    }]);
  };

  const updateFilter = (index: number, updatedFilterData: Partial<ResultFilter>) => {
    const newFilters = [...filters];
    const currentFilter = newFilters[index];
    const mergedFilter = { ...currentFilter, ...updatedFilterData };

    if (Object.keys(updatedFilterData).length === 1 && 'isActive' in updatedFilterData) {
        newFilters[index] = mergedFilter;
        onChange(newFilters);
        return;
    }

    let needsValueReset = false;

    if (updatedFilterData.schemaId && updatedFilterData.schemaId !== currentFilter.schemaId) {
        const newSchemaId = updatedFilterData.schemaId;
        const targetKeys = getTargetKeysForScheme(newSchemaId, schemas);
        mergedFilter.fieldKey = targetKeys.length > 0 ? targetKeys[0].key : undefined;
        needsValueReset = true;
    }
    else if ('fieldKey' in updatedFilterData && updatedFilterData.fieldKey !== currentFilter.fieldKey) {
        needsValueReset = true;
    }
    else if (updatedFilterData.operator && updatedFilterData.operator !== currentFilter.operator) {
        needsValueReset = true;
    }

    if (needsValueReset) {
        const { type: newType } = getTargetFieldDefinition(mergedFilter, schemas);
        const newOperators = getOperatorsForType(newType);
        if (!newOperators.includes(mergedFilter.operator)) {
             mergedFilter.operator = newOperators[0];
        }
        mergedFilter.value = mergedFilter.operator === 'range' ? [null, null] : newType === 'bool' ? 'False' : '';
    }

    newFilters[index] = mergedFilter;
    onChange(newFilters);
  };

  const removeFilter = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  const getOperatorsForType = (type: FieldType | 'bool' | 'float' | null): Array<ResultFilter['operator']> => {
    switch (type) {
      case 'int':
      case 'float':
        return ['equals', 'range', 'greater_than', 'less_than'];
      case 'List[str]':
      case 'str':
        return ['equals', 'contains'];
      case 'List[Dict[str, any]]':
         return ['contains', 'equals'];
      case 'bool':
        return ['equals'];
      default:
        return ['equals', 'contains'];
    }
  };
  
  const getFilterTooltip = (filter: ResultFilter) => {
    const { type } = getTargetFieldDefinition(filter, schemas);
    const schema = schemas.find(s => s.id === filter.schemaId);
    const fieldName = filter.fieldKey ?? Object.keys((schema?.output_contract as any)?.properties || {})[0] ?? 'field';

    switch (type) {
      case 'int':
      case 'float':
        return `Filter numeric values in '${fieldName}'. Use 'equals', range, or comparison operators.`;
      case 'List[str]':
        return `Filter text lists in '${fieldName}'. Use 'contains' to find items containing your text or 'equals' for exact matches.`;
      case 'List[Dict[str, any]]':
         return `Filter complex structures by checking the value associated with the key '${fieldName}'. Use 'contains' for text search or 'equals' for exact match.`;
      case 'str':
         return `Filter text values in '${fieldName}'. Use 'equals' for exact matches or 'contains'.`;
      case 'bool':
        return `Filter Yes/No values in '${fieldName}'. Use 'equals' (True/False).`;
      default:
        return `Filter results based on the '${fieldName}' field/key of the '${schema?.name}' schema.`;
    }
  };

  const hasLabels = (filter: ResultFilter): boolean => {
    const { definition } = getTargetFieldDefinition(filter, schemas);
    if (definition && definition.type === 'boolean') return true; // Standard JSON schema bool
    if (definition && definition.enum && Array.isArray(definition.enum)) return true; // JSON schema enum
    return false;
  };

  const getLabelsForField = (filter: ResultFilter): string[] => {
    const { definition } = getTargetFieldDefinition(filter, schemas);
    if (definition && definition.type === 'boolean') return ["True", "False"];
    if (definition && definition.enum && Array.isArray(definition.enum)) return definition.enum.map(String);
    return [];
  };

  const getFieldTypeDisplay = (filter: ResultFilter): string => {
    const { type } = getTargetFieldDefinition(filter, schemas);
    switch (type) {
      case 'int': return "Number";
      case 'float': return "Decimal";
      case 'List[str]': return "Text List";
      case 'List[Dict[str, any]]': return "Complex Structure";
      case 'str': return "Text";
      case 'bool': return "Yes/No";
      default: return "Unknown";
    }
  };

  if (schemas.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No annotation schemas available to filter by.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2 flex-wrap">
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
                        </p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </h3>

        {activeFilterCount > 1 && (
            <div className="flex items-center gap-2">
               <Label className="text-xs text-muted-foreground">Match:</Label>
               <ToggleGroup
                   type="single"
                   size="sm"
                   variant="outline"
                   value={logicMode}
                   onValueChange={(value: FilterLogicMode) => { if (value) onLogicModeChange(value); }}
                   className="gap-0.5"
               >
                   <ToggleGroupItem value="and" aria-label="Match all filters (AND)" title="Match all filters (AND)" className="h-7 px-2 text-xs">
                       All (AND)
                   </ToggleGroupItem>
                   <ToggleGroupItem value="or" aria-label="Match any filter (OR)" title="Match any filter (OR)" className="h-7 px-2 text-xs">
                       Any (OR)
                   </ToggleGroupItem>
               </ToggleGroup>
            </div>
        )}

        <Button variant="outline" size="sm" onClick={addFilter} disabled={schemas.length === 0} className="ml-auto">
          <Plus className="h-3 w-3 mr-1" />
          Add Filter
        </Button>
      </div>

      {filters.map((filter, index) => {
        const { type: fieldType, definition } = getTargetFieldDefinition(filter, schemas);
        const operators = getOperatorsForType(fieldType);
        const targetKeys = getTargetKeysForScheme(filter.schemaId, schemas);
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
                    <Switch
                        checked={filter.isActive}
                        onCheckedChange={(checked) => updateFilter(index, { isActive: checked })}
                        className="h-5 w-9 data-[state=checked]:bg-blue-500 data-[state=unchecked]:bg-gray-300"
                    />

                    <Select
                      value={filter.schemaId.toString()}
                      onValueChange={(value) => updateFilter(index, { schemaId: parseInt(value) })}
                      disabled={!filter.isActive}
                    >
                      <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue placeholder="Select Schema" />
                      </SelectTrigger>
                      <SelectContent>
                        <ScrollArea className="max-h-60 w-full">
                          {schemas.map(schema => (
                            <SelectItem key={schema.id} value={schema.id.toString()} className="text-xs">
                              {schema.name}
                            </SelectItem>
                          ))}
                        </ScrollArea>
                      </SelectContent>
                    </Select>

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

                    {renderValueInput(filter, index, fieldType, hasLabelOptions, labelOptions, updateFilter)}

                    <Badge variant="outline" className="text-xs whitespace-nowrap h-6 px-1.5">
                       {fieldTypeDisplay}
                    </Badge>

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

      {schemas.length === 0 && filters.length === 0 && (
        <div className="text-center text-xs text-muted-foreground italic py-2">
          No annotation schemas found in this run to create filters.
        </div>
      )}
      {schemas.length > 0 && filters.length === 0 && (
         <div className="text-center text-xs text-muted-foreground italic py-2">
            Click 'Add Filter' to start filtering results.
         </div>
      )}
    </div>
  );
};

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
    const options = type === 'bool' ? ["True", "False"] : labels;
    return (
      <Select
        value={filter.value.toString()}
        onValueChange={(value) => updateFilter(index, { value: type === 'bool' ? (value === 'True') : value })}
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