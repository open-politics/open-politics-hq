'use client';

import React, { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, ChevronDown, ChevronUp, Clock, Database, FileJson, Calendar, Filter, X, Plus, Info, HelpCircle } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TimeAxisConfig } from '@/lib/annotations/types';
import { AnnotationSchemaRead } from '@/client';
import { Separator } from '@/components/ui/separator';
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format, startOfDay, endOfDay } from 'date-fns';
import { getTargetKeysForScheme } from '@/lib/annotations/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// --- Types from AnnotationResultFilters ---
type FieldType = 'int' | 'float' | 'str' | 'bool' | 'List[str]' | 'List[Dict[str, any]]';
export type FilterLogicMode = 'and' | 'or';
export interface FilterSet {
  logic: FilterLogicMode;
  rules: ResultFilter[];
}
export interface ResultFilter {
  id: string;
  schemaId: number;
  fieldKey?: string;
  operator: 'equals' | 'contains' | 'range' | 'greater_than' | 'less_than';
  value: any;
  isActive: boolean;
}

// --- Type from AnnotationTimeAxisControls ---
type TimeAxisSourceType = 'default' | 'schema' | 'event';


interface UnifiedFilterControlsProps {
    allSchemas: AnnotationSchemaRead[];
    filterSet: FilterSet;
    onFilterSetChange: (newFilterSet: FilterSet) => void;
    timeAxisConfig: TimeAxisConfig | null;
    onTimeAxisConfigChange: (newConfig: TimeAxisConfig | null) => void;
    showTimeControls: boolean;
}

export const UnifiedFilterControls: React.FC<UnifiedFilterControlsProps> = ({
    allSchemas,
    filterSet,
    onFilterSetChange,
    timeAxisConfig,
    onTimeAxisConfigChange,
    showTimeControls
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [startDatePickerOpen, setStartDatePickerOpen] = useState(false);
    const [endDatePickerOpen, setEndDatePickerOpen] = useState(false);

    const { rules: filters, logic: logicMode } = filterSet;
    const activeFilterCount = filters.filter(f => f.isActive).length;

    // --- Start of logic from AnnotationResultFilters ---
    const getTargetFieldDefinition = (filter: Omit<ResultFilter, 'id'>, schemas: AnnotationSchemaRead[]): { type: FieldType | "bool" | "float" | null; definition: any | null; } => {
        const schema = schemas.find(s => s.id === filter.schemaId);
        if (!schema || !schema.output_contract) return { type: null, definition: null };
        const properties = (schema.output_contract as any).properties;
        if(!properties) return { type: null, definition: null };
        const targetKeyName = filter.fieldKey ?? (Object.keys(properties)[0] || null);
        if (!targetKeyName) return { type: null, definition: null };
        
        const getFieldDefinitionFromSchema = (schema: AnnotationSchemaRead, fieldKey: string): any => {
            if (!schema.output_contract) return null;
            const properties = (schema.output_contract as any).properties;
            if (!properties) return null;
            const keys = fieldKey.split('.');
            let currentSchema = properties;
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                if (currentSchema[key]) {
                    if (i === keys.length - 1) return currentSchema[key];
                    else {
                        if (currentSchema[key].type === 'object' && currentSchema[key].properties) currentSchema = currentSchema[key].properties;
                        else if (currentSchema[key].type === 'array' && currentSchema[key].items?.type === 'object' && currentSchema[key].items.properties) currentSchema = currentSchema[key].items.properties;
                        else return null;
                    }
                } else return null;
            }
            return null;
        };

        const fieldDef = getFieldDefinitionFromSchema(schema, targetKeyName);
        if (fieldDef) {
            const typeMap: Record<string, FieldType | 'bool' | 'float'> = { "integer": "int", "number": "float", "string": "str", "boolean": "bool", "array": "List[str]", };
            return { type: typeMap[fieldDef.type] || 'str', definition: fieldDef };
        }
        return { type: null, definition: null };
    };

    const addFilter = () => {
        if (allSchemas.length === 0) return;
        const defaultSchema = allSchemas[0];
        const targetKeys = getTargetKeysForScheme(defaultSchema.id, allSchemas);
        const initialFieldKey = targetKeys.length > 0 ? targetKeys[0].key : undefined;
        const { type: initialType } = getTargetFieldDefinition({ schemaId: defaultSchema.id, fieldKey: initialFieldKey, operator: 'equals', value: '', isActive: true }, allSchemas);
        const initialOperators = getOperatorsForType(initialType);
        const initialOperator = initialOperators[0];
        const newRule: ResultFilter = { id: `filter_${Date.now()}`, schemaId: defaultSchema.id, fieldKey: initialFieldKey, operator: initialOperator, value: initialOperator === 'range' ? [null, null] : initialType === 'bool' ? 'False' : '', isActive: true };
        onFilterSetChange({ ...filterSet, rules: [...filters, newRule] });
    };

    const updateFilter = (index: number, updatedFilterData: Partial<Omit<ResultFilter, 'id'>>) => {
        const newFilters = [...filters];
        const currentFilter = newFilters[index];
        const mergedFilter = { ...currentFilter, ...updatedFilterData };
        if (Object.keys(updatedFilterData).length === 1 && 'isActive' in updatedFilterData) {
            newFilters[index] = mergedFilter;
            onFilterSetChange({ ...filterSet, rules: newFilters });
            return;
        }
        let needsValueReset = false;
        if (updatedFilterData.schemaId && updatedFilterData.schemaId !== currentFilter.schemaId) {
            const newSchemaId = updatedFilterData.schemaId;
            const targetKeys = getTargetKeysForScheme(newSchemaId, allSchemas);
            mergedFilter.fieldKey = targetKeys.length > 0 ? targetKeys[0].key : undefined;
            needsValueReset = true;
        } else if ('fieldKey' in updatedFilterData && updatedFilterData.fieldKey !== currentFilter.fieldKey) {
            needsValueReset = true;
        } else if (updatedFilterData.operator && updatedFilterData.operator !== currentFilter.operator) {
            needsValueReset = true;
        }
        if (needsValueReset) {
            const { type: newType } = getTargetFieldDefinition(mergedFilter, allSchemas);
            const newOperators = getOperatorsForType(newType);
            if (!newOperators.includes(mergedFilter.operator)) mergedFilter.operator = newOperators[0];
            mergedFilter.value = mergedFilter.operator === 'range' ? [null, null] : newType === 'bool' ? 'False' : '';
        }
        newFilters[index] = mergedFilter;
        onFilterSetChange({ ...filterSet, rules: newFilters });
    };

    const removeFilter = (index: number) => {
        onFilterSetChange({ ...filterSet, rules: filters.filter((_, i) => i !== index) });
    };

    const setLogicMode = (mode: FilterLogicMode) => {
        onFilterSetChange({ ...filterSet, logic: mode });
    };

    const getOperatorsForType = (type: FieldType | 'bool' | 'float' | null): Array<ResultFilter['operator']> => {
        switch (type) {
            case 'int': case 'float': return ['equals', 'range', 'greater_than', 'less_than'];
            case 'List[str]': case 'str': return ['equals', 'contains'];
            case 'List[Dict[str, any]]': return ['contains', 'equals'];
            case 'bool': return ['equals'];
            default: return ['equals', 'contains'];
        }
    };
    
    const getFilterTooltip = (filter: Omit<ResultFilter, 'id'>) => {
        const { type } = getTargetFieldDefinition(filter, allSchemas);
        const schema = allSchemas.find(s => s.id === filter.schemaId);
        const fieldName = filter.fieldKey ?? Object.keys((schema?.output_contract as any)?.properties || {})[0] ?? 'field';
        switch (type) {
            case 'int': case 'float': return `Filter numeric values in '${fieldName}'.`;
            case 'List[str]': return `Filter text lists in '${fieldName}'.`;
            case 'List[Dict[str, any]]': return `Filter complex structures in '${fieldName}'.`;
            case 'str': return `Filter text values in '${fieldName}'.`;
            case 'bool': return `Filter Yes/No values in '${fieldName}'.`;
            default: return `Filter results based on the '${fieldName}' field.`;
        }
    };

    const renderValueInput = (filter: ResultFilter, index: number, type: FieldType | 'bool' | 'float' | null) => {
        switch (type) {
            case 'int':
            case 'float':
                if (filter.operator === 'range') {
                    return (
                        <div className="flex items-center gap-2">
                            <Input type="number" placeholder="Min" value={filter.value[0] ?? ''} onChange={(e) => updateFilter(index, { value: [e.target.value, filter.value[1]] })} className="h-8"/>
                            <span className="text-muted-foreground">-</span>
                            <Input type="number" placeholder="Max" value={filter.value[1] ?? ''} onChange={(e) => updateFilter(index, { value: [filter.value[0], e.target.value] })} className="h-8"/>
                        </div>
                    );
                }
                return <Input type="number" value={filter.value} onChange={(e) => updateFilter(index, { value: e.target.value })} className="h-8"/>;
            case 'bool':
                return (
                    <Select value={filter.value} onValueChange={(v) => updateFilter(index, { value: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="True">True</SelectItem><SelectItem value="False">False</SelectItem></SelectContent>
                    </Select>
                );
            default:
                return <Input value={filter.value} onChange={(e) => updateFilter(index, { value: e.target.value })} className="h-8"/>;
        }
    };
    // --- End of logic from AnnotationResultFilters ---
    
    // --- Start of logic from AnnotationTimeAxisControls ---
    const sourceType = timeAxisConfig?.type ?? 'event';
    const selectedSchemaId = timeAxisConfig?.type === 'schema' ? timeAxisConfig.schemaId ?? null : null;
    const selectedFieldKey = timeAxisConfig?.type === 'schema' ? timeAxisConfig.fieldKey ?? null : null;
    const timeFrame = timeAxisConfig?.timeFrame ?? { enabled: false };

    const fieldOptions = useMemo(() => {
        if (sourceType !== 'schema' || !selectedSchemaId) return [];
        const targetKeys = getTargetKeysForScheme(selectedSchemaId, allSchemas);
        return targetKeys
            .filter(tk => tk.type === 'string' || tk.type === 'integer' || tk.type === 'number')
            .map(tk => ({ value: tk.key, label: `${tk.name} (${tk.type})` }));
    }, [sourceType, selectedSchemaId, allSchemas]);

    const handleSourceTypeChange = (newType: TimeAxisSourceType) => {
        if (newType === 'schema') {
            const defaultSchemaId = allSchemas.length > 0 ? allSchemas[0].id : null;
            if (defaultSchemaId) {
                const defaultFields = getTargetKeysForScheme(defaultSchemaId, allSchemas).filter(tk => tk.type === 'string' || tk.type === 'integer' || tk.type === 'number');
                const defaultFieldKey = defaultFields.length > 0 ? defaultFields[0].key : null;
                onTimeAxisConfigChange({ ...timeAxisConfig, type: 'schema', schemaId: defaultSchemaId, fieldKey: defaultFieldKey || undefined });
            } else {
                onTimeAxisConfigChange({ ...timeAxisConfig, type: 'schema' });
            }
        } else {
            onTimeAxisConfigChange({ ...timeAxisConfig, type: newType });
        }
    };

    const handleSchemaChange = (schemaIdStr: string) => {
        const newSchemaId = schemaIdStr ? parseInt(schemaIdStr, 10) : null;
        if (newSchemaId) {
            const defaultFields = getTargetKeysForScheme(newSchemaId, allSchemas).filter(tk => tk.type === 'string' || tk.type === 'integer' || tk.type === 'number');
            const defaultFieldKey = defaultFields.length > 0 ? defaultFields[0].key : null;
            onTimeAxisConfigChange({ ...timeAxisConfig, type: 'schema', schemaId: newSchemaId, fieldKey: defaultFieldKey || undefined });
        } else {
            onTimeAxisConfigChange({ ...timeAxisConfig, type: 'schema' });
        }
    };

    const handleFieldChange = (newFieldKey: string) => {
        onTimeAxisConfigChange({ ...timeAxisConfig, type: 'schema', schemaId: selectedSchemaId!, fieldKey: newFieldKey || undefined });
    };

    const handleTimeFrameToggle = () => {
        const newTimeFrame = { ...timeFrame, enabled: !timeFrame.enabled };
        if (newTimeFrame.enabled && !timeFrame.startDate && !timeFrame.endDate) {
            const now = new Date();
            newTimeFrame.endDate = endOfDay(now);
            newTimeFrame.startDate = startOfDay(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
        }
        onTimeAxisConfigChange({ type: timeAxisConfig?.type || 'event', schemaId: timeAxisConfig?.schemaId, fieldKey: timeAxisConfig?.fieldKey, timeFrame: newTimeFrame });
    };

    const handleStartDateChange = (date: Date | undefined) => {
        if (date) {
            onTimeAxisConfigChange({ type: timeAxisConfig?.type || 'event', schemaId: timeAxisConfig?.schemaId, fieldKey: timeAxisConfig?.fieldKey, timeFrame: { ...timeFrame, startDate: startOfDay(date) } });
        }
        setStartDatePickerOpen(false);
    };

    const handleEndDateChange = (date: Date | undefined) => {
        if (date) {
            onTimeAxisConfigChange({ type: timeAxisConfig?.type || 'event', schemaId: timeAxisConfig?.schemaId, fieldKey: timeAxisConfig?.fieldKey, timeFrame: { ...timeFrame, endDate: endOfDay(date) } });
        }
        setEndDatePickerOpen(false);
    };
    // --- End of logic from AnnotationTimeAxisControls ---

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="rounded-lg border">
            <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-2 cursor-pointer bg-muted/30 hover:bg-muted/60">
                    <div className="flex items-center gap-2">
                        <SlidersHorizontal className="h-4 w-4" />
                        <span className="font-medium text-sm">Filters</span>
                        {activeFilterCount > 0 && (<span className="text-xs bg-primary text-primary-foreground rounded-full h-5 w-5 flex items-center justify-center">{activeFilterCount}</span>)}
                        {timeAxisConfig?.timeFrame?.enabled && (<span className="text-xs bg-secondary text-secondary-foreground rounded-md px-2 py-0.5">Time Range</span>)}
                    </div>
                    <Button variant="ghost" size="sm" className="w-9 p-0">{isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}<span className="sr-only">Toggle Filters</span></Button>
                </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="p-4 space-y-4">
                {/* --- Start of JSX from AnnotationResultFilters --- */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <Label className="text-sm font-medium">Filter Logic</Label>
                            <ToggleGroup type="single" value={logicMode} onValueChange={(value) => { if (value) setLogicMode(value as FilterLogicMode); }} size="sm">
                                <ToggleGroupItem value="and">AND</ToggleGroupItem>
                                <ToggleGroupItem value="or">OR</ToggleGroupItem>
                            </ToggleGroup>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger><HelpCircle className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
                                    <TooltipContent>
                                        <p>AND: all filters must match.<br />OR: any filter can match.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        <Button onClick={addFilter} size="sm"><Plus className="mr-2 h-4 w-4" /> Add Filter</Button>
                    </div>
                    <ScrollArea className="max-h-60 pr-3">
                        <div className="space-y-3">
                            {filters.map((filter, index) => {
                                const { type, definition } = getTargetFieldDefinition(filter, allSchemas);
                                const operators = getOperatorsForType(type);
                                const targetKeys = getTargetKeysForScheme(filter.schemaId, allSchemas);
                                return (
                                    <div key={filter.id} className={cn("flex items-start gap-2 p-3 rounded-lg border", !filter.isActive && "bg-muted/50")}>
                                        <div className="flex-1 space-y-2">
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                <Select value={filter.schemaId.toString()} onValueChange={(v) => updateFilter(index, { schemaId: parseInt(v) })}>
                                                    <SelectTrigger><SelectValue placeholder="Select Schema" /></SelectTrigger>
                                                    <SelectContent>{allSchemas.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}</SelectContent>
                                                </Select>
                                                <Select value={filter.fieldKey} onValueChange={(v) => updateFilter(index, { fieldKey: v })} disabled={targetKeys.length === 0}>
                                                    <SelectTrigger><SelectValue placeholder="Select Field" /></SelectTrigger>
                                                    <SelectContent>{targetKeys.map(tk => <SelectItem key={tk.key} value={tk.key}>{tk.name} ({tk.type})</SelectItem>)}</SelectContent>
                                                </Select>
                                                <Select value={filter.operator} onValueChange={(v) => updateFilter(index, { operator: v as any })}>
                                                    <SelectTrigger><SelectValue placeholder="Select Operator" /></SelectTrigger>
                                                    <SelectContent>{operators.map(op => <SelectItem key={op} value={op}>{op.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                                                </Select>
                                            </div>
                                            <div>{renderValueInput(filter, index, type)}</div>
                                        </div>
                                        <div className="flex flex-col items-center gap-2">
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger><Info className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
                                                    <TooltipContent><p>{getFilterTooltip(filter)}</p></TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFilter(index)}><X className="h-4 w-4" /></Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </ScrollArea>
                    {filters.length === 0 && <p className="text-sm text-center text-muted-foreground py-4">No filters added.</p>}
                </div>
                {/* --- End of JSX from AnnotationResultFilters --- */}
                {showTimeControls && (
                    <>
                        <Separator />
                        {/* --- Start of JSX from AnnotationTimeAxisControls --- */}
                        <div className="space-y-3">
                            <div>
                                <Label className="text-xs text-muted-foreground mb-2 block">Time Source</Label>
                                <RadioGroup value={sourceType} onValueChange={(v) => handleSourceTypeChange(v as TimeAxisSourceType)} className="text-xs">
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="default" id="time-default" /><Label htmlFor="time-default" className="font-normal flex items-center"><Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground"/>Annotation Time</Label></div>
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="event" id="time-event" /><Label htmlFor="time-event" className="font-normal flex items-center"><Database className="h-3.5 w-3.5 mr-1.5 text-muted-foreground"/>Original Event Time (from Asset)</Label></div>
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="schema" id="time-schema" /><Label htmlFor="time-schema" className="font-normal flex items-center"><FileJson className="h-3.5 w-3.5 mr-1.5 text-muted-foreground"/>Annotation Schema Field</Label></div>
                                </RadioGroup>
                            </div>
                            {sourceType === 'schema' && (
                                <div className="pl-6 space-y-2 border-l ml-2 pt-2 border-border/60">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <Label htmlFor="time-schema-select" className="text-xs mb-1 block text-muted-foreground">Schema</Label>
                                            <Select value={selectedSchemaId?.toString() ?? ""} onValueChange={handleSchemaChange} disabled={allSchemas.length === 0}>
                                                <SelectTrigger id="time-schema-select" className="h-8 text-xs w-full"><SelectValue placeholder="Select schema..." /></SelectTrigger>
                                                <SelectContent><ScrollArea className="max-h-60 w-full">{allSchemas.map(s => (<SelectItem key={s.id} value={s.id.toString()} className="text-xs">{s.name}</SelectItem>))}{allSchemas.length === 0 && <div className="p-2 text-xs text-center italic text-muted-foreground">No schemas</div>}</ScrollArea></SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <Label htmlFor="time-field-select" className="text-xs mb-1 block text-muted-foreground">Field</Label>
                                            <Select value={selectedFieldKey ?? ""} onValueChange={handleFieldChange} disabled={!selectedSchemaId || fieldOptions.length === 0}>
                                                <SelectTrigger id="time-field-select" className="h-8 text-xs w-full"><SelectValue placeholder="Select field..." /></SelectTrigger>
                                                <SelectContent><ScrollArea className="max-h-60 w-full">{fieldOptions.map(opt => (<SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>))}{fieldOptions.length === 0 && selectedSchemaId && <div className="p-2 text-xs text-center italic">No text/number fields</div>}{!selectedSchemaId && <div className="p-2 text-xs text-center italic">Select schema first</div>}</ScrollArea></SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    {selectedSchemaId && fieldOptions.length === 0 && (<p className="text-xs text-muted-foreground italic pt-1">No text or number fields in schema.</p>)}
                                </div>
                            )}
                            <div className="border-t pt-3">
                                <div className="flex items-center justify-between mb-2">
                                    <Label className="text-xs text-muted-foreground flex items-center"><Filter className="h-3.5 w-3.5 mr-1.5"/>Time Range Filter</Label>
                                    <Button variant={timeFrame.enabled ? "default" : "outline"} size="sm" onClick={handleTimeFrameToggle} className="h-6 px-2 text-xs">{timeFrame.enabled ? "Enabled" : "Disabled"}</Button>
                                </div>
                                {timeFrame.enabled && (
                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                        <div>
                                            <Label className="text-xs text-muted-foreground mb-1 block">Start Date</Label>
                                            <Popover open={startDatePickerOpen} onOpenChange={setStartDatePickerOpen}>
                                                <PopoverTrigger asChild><Button variant="outline" className="w-full h-8 px-2 text-xs justify-start font-normal"><Calendar className="h-3.5 w-3.5 mr-1.5"/>{timeFrame.startDate ? format(timeFrame.startDate, 'MMM dd, yyyy') : 'Select date'}</Button></PopoverTrigger>
                                                <PopoverContent className="w-auto p-0"><CalendarComponent mode="single" selected={timeFrame.startDate} onSelect={handleStartDateChange} initialFocus/></PopoverContent>
                                            </Popover>
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground mb-1 block">End Date</Label>
                                            <Popover open={endDatePickerOpen} onOpenChange={setEndDatePickerOpen}>
                                                <PopoverTrigger asChild><Button variant="outline" className="w-full h-8 px-2 text-xs justify-start font-normal"><Calendar className="h-3.5 w-3.5 mr-1.5"/>{timeFrame.endDate ? format(timeFrame.endDate, 'MMM dd, yyyy') : 'Select date'}</Button></PopoverTrigger>
                                                <PopoverContent className="w-auto p-0"><CalendarComponent mode="single" selected={timeFrame.endDate} onSelect={handleEndDateChange} initialFocus/></PopoverContent>
                                            </Popover>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* --- End of JSX from AnnotationTimeAxisControls --- */}
                    </>
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}; 