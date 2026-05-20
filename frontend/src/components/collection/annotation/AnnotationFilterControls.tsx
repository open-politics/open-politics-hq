'use client';

import React, { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, Clock, Database, FileJson, Calendar, Filter, X, Plus, Info, HelpCircle } from 'lucide-react';
import { TimeAxisConfig } from '@/lib/annotations/types';
import { AnnotationSchemaRead } from '@/client';
import { Separator } from '@/components/ui/separator';
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format, startOfDay, endOfDay } from 'date-fns';
import { walkOutputContract, flattenFieldPaths, type FieldPath, type FieldShape } from '@/lib/annotations/fieldPaths';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { FieldPicker } from './FieldPicker';
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

/**
 * UI operator names. These mirror the thirteen backend operators in
 * ``core/filters.py::Operator`` with user-friendly aliases. The canonical
 * mapping lives in ``FILTER_UI_OP_TO_BACKEND`` below — keep both in sync.
 */
export type FilterUIOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'range'
  | 'greater_than'
  | 'greater_or_equal'
  | 'less_than'
  | 'less_or_equal'
  | 'in'
  | 'not_in'
  | 'exists'
  | 'not_exists';

/** UI operator → backend operator. Serializers MUST route through this map. */
export const FILTER_UI_OP_TO_BACKEND: Record<FilterUIOperator, string> = {
  equals: 'eq',
  not_equals: 'ne',
  contains: 'contains',
  not_contains: 'not_contains',
  range: 'between',
  greater_than: 'gt',
  greater_or_equal: 'ge',
  less_than: 'lt',
  less_or_equal: 'le',
  in: 'in',
  not_in: 'not_in',
  exists: 'exists',
  not_exists: 'not_exists',
};

export interface ResultFilter {
  id: string;
  schemaId: number;
  fieldKey?: string;
  operator: FilterUIOperator;
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
    // Map the structural FieldShape (inferred via walkOutputContract) onto the
    // operator/UI type the filter controls reason about. Array-of-object and
    // triplet shapes get their own bucket so the "complex" operator set surfaces
    // correctly — the previous flat-string map collapsed them onto List[str].
    const SHAPE_TO_FIELD_TYPE: Record<FieldShape, FieldType | 'bool' | 'float' | null> = {
        string: 'str',
        enum_string: 'str',
        date: 'str',
        number: 'float',
        boolean: 'bool',
        array_string: 'List[str]',
        array_string_enum: 'List[str]',
        array_number: 'List[str]',
        object: 'str',
        array_object: 'List[Dict[str, any]]',
        triplet: 'List[Dict[str, any]]',
        // Entity references resolve to {name, type} objects; for filter
        // purposes users match on the name path, so str operators apply.
        // array_entity uses List[str]-style semantics so cooccurs / array
        // operators surface in the picker.
        entity: 'str',
        array_entity: 'List[str]',
        unknown: null,
    };

    const getTargetFieldDefinition = (
        filter: Omit<ResultFilter, 'id'>,
        schemas: AnnotationSchemaRead[],
    ): { type: FieldType | 'bool' | 'float' | null; node: FieldPath | null } => {
        const schema = schemas.find(s => s.id === filter.schemaId);
        if (!schema) return { type: null, node: null };
        const paths = flattenFieldPaths(walkOutputContract(schema));
        const targetKey = filter.fieldKey ?? paths.find(p => p.shape !== 'unknown')?.path ?? null;
        if (!targetKey) return { type: null, node: null };
        // findFieldPath equivalent on the flat list — also tolerates `[*]`-stripped
        // legacy paths so saved filters keep round-tripping.
        const norm = (p: string) => p.replace(/\[\*\]/g, '');
        const target = norm(targetKey);
        const node = paths.find(p => p.path === targetKey)
            ?? paths.find(p => norm(p.path) === target)
            ?? null;
        if (!node) return { type: null, node: null };
        return { type: SHAPE_TO_FIELD_TYPE[node.shape] ?? null, node };
    };

    const firstSelectableFieldPath = (schemaId: number, opts?: { acceptedShapes?: ReadonlyArray<FieldShape> }): string | undefined => {
        const schema = allSchemas.find(s => s.id === schemaId);
        if (!schema) return undefined;
        const paths = flattenFieldPaths(walkOutputContract(schema));
        const accepts = opts?.acceptedShapes;
        const candidates = paths.filter(p => p.shape !== 'unknown' && (!accepts || accepts.includes(p.shape)));
        if (candidates.length === 0) return undefined;
        // Prefer leaves over container nodes so the default isn't an unhelpful
        // top-level `document` / `per_*` parent.
        const leaf = candidates.find(p => p.shape !== 'object' && p.shape !== 'array_object' && p.shape !== 'triplet');
        return (leaf ?? candidates[0]).path;
    };

    const TIME_AXIS_SHAPES: ReadonlyArray<FieldShape> = ['string', 'enum_string', 'date', 'number'];

    // Default value shape per operator. `range` needs [min, max], `in`/`not_in`
    // need an array, `exists`/`not_exists` take no value. All other operators
    // take a scalar (bool field defaults to 'False' for the existing Select UI).
    const defaultValueForOp = (
        op: ResultFilter['operator'],
        type: FieldType | 'bool' | 'float' | null,
    ): any => {
        if (op === 'range') return [null, null];
        if (op === 'in' || op === 'not_in') return [];
        if (op === 'exists' || op === 'not_exists') return null;
        return type === 'bool' ? 'False' : '';
    };

    const addFilter = () => {
        if (allSchemas.length === 0) return;
        const defaultSchema = allSchemas[0];
        const initialFieldKey = firstSelectableFieldPath(defaultSchema.id);
        const { type: initialType } = getTargetFieldDefinition({ schemaId: defaultSchema.id, fieldKey: initialFieldKey, operator: 'equals', value: '', isActive: true }, allSchemas);
        const initialOperators = getOperatorsForType(initialType);
        const initialOperator = initialOperators[0];
        const newRule: ResultFilter = {
            id: `filter_${Date.now()}`,
            schemaId: defaultSchema.id,
            fieldKey: initialFieldKey,
            operator: initialOperator,
            value: defaultValueForOp(initialOperator, initialType),
            isActive: true,
        };
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
            mergedFilter.fieldKey = firstSelectableFieldPath(updatedFilterData.schemaId);
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
            mergedFilter.value = defaultValueForOp(mergedFilter.operator, newType);
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
        // Every type also accepts `exists`/`not_exists` for nullability checks —
        // matches the backend, which evaluates both via ``jsonb ?`` / ``IS NOT NULL``.
        const nullChecks: Array<ResultFilter['operator']> = ['exists', 'not_exists'];
        switch (type) {
            case 'int':
            case 'float':
                return [
                    'equals', 'not_equals', 'range',
                    'greater_than', 'greater_or_equal',
                    'less_than', 'less_or_equal',
                    'in', 'not_in',
                    ...nullChecks,
                ];
            case 'List[str]':
            case 'str':
                return [
                    'equals', 'not_equals',
                    'contains', 'not_contains',
                    'in', 'not_in',
                    ...nullChecks,
                ];
            case 'List[Dict[str, any]]':
                return ['contains', 'not_contains', 'equals', 'not_equals', ...nullChecks];
            case 'bool':
                return ['equals', 'not_equals', ...nullChecks];
            default:
                return ['equals', 'not_equals', 'contains', 'not_contains', ...nullChecks];
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
        // Existence checks carry no value — backend ignores it.
        if (filter.operator === 'exists' || filter.operator === 'not_exists') {
            return <span className="text-[11px] text-muted-foreground italic">no value</span>;
        }
        // List operators take comma-separated values. Stored as Array<string|number>.
        if (filter.operator === 'in' || filter.operator === 'not_in') {
            const asList = Array.isArray(filter.value) ? filter.value : [];
            const displayValue = asList.join(', ');
            return (
                <Input
                    placeholder="value1, value2, …"
                    value={displayValue}
                    onChange={(e) => {
                        const next = e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                        updateFilter(index, { value: next });
                    }}
                    className="h-7 text-xs"
                />
            );
        }
        switch (type) {
            case 'int':
            case 'float':
                if (filter.operator === 'range') {
                    return (
                        <div className="flex items-center gap-1.5">
                            <Input type="number" placeholder="Min" value={filter.value?.[0] ?? ''} onChange={(e) => updateFilter(index, { value: [e.target.value, filter.value?.[1]] })} className="h-7 text-xs"/>
                            <span className="text-muted-foreground text-xs">-</span>
                            <Input type="number" placeholder="Max" value={filter.value?.[1] ?? ''} onChange={(e) => updateFilter(index, { value: [filter.value?.[0], e.target.value] })} className="h-7 text-xs"/>
                        </div>
                    );
                }
                return <Input type="number" value={filter.value ?? ''} onChange={(e) => updateFilter(index, { value: e.target.value })} className="h-7 text-xs"/>;
            case 'bool':
                return (
                    <Select value={filter.value} onValueChange={(v) => updateFilter(index, { value: v })}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="True" className="text-xs">True</SelectItem><SelectItem value="False" className="text-xs">False</SelectItem></SelectContent>
                    </Select>
                );
            default:
                return <Input value={filter.value ?? ''} onChange={(e) => updateFilter(index, { value: e.target.value })} className="h-7 text-xs"/>;
        }
    };
    // --- End of logic from AnnotationResultFilters ---
    
    // --- Start of logic from AnnotationTimeAxisControls ---
    const sourceType = timeAxisConfig?.type ?? 'event';
    const selectedSchemaId = timeAxisConfig?.type === 'schema' ? timeAxisConfig.schemaId ?? null : null;
    const selectedFieldKey = timeAxisConfig?.type === 'schema' ? timeAxisConfig.fieldKey ?? null : null;
    const timeFrame = timeAxisConfig?.timeFrame ?? { enabled: false };

    // Count of selectable time-axis fields in the chosen schema. Drives the
    // "no text/number fields" empty-state hint without re-walking the contract
    // inside the JSX.
    const timeFieldCount = useMemo(() => {
        if (sourceType !== 'schema' || !selectedSchemaId) return 0;
        const schema = allSchemas.find(s => s.id === selectedSchemaId);
        if (!schema) return 0;
        return flattenFieldPaths(walkOutputContract(schema)).filter(p => TIME_AXIS_SHAPES.includes(p.shape)).length;
    }, [sourceType, selectedSchemaId, allSchemas]);

    const handleSourceTypeChange = (newType: TimeAxisSourceType) => {
        if (newType === 'schema') {
            const defaultSchemaId = allSchemas.length > 0 ? allSchemas[0].id : null;
            if (defaultSchemaId) {
                const defaultFieldKey = firstSelectableFieldPath(defaultSchemaId, { acceptedShapes: TIME_AXIS_SHAPES });
                onTimeAxisConfigChange({ ...timeAxisConfig, type: 'schema', schemaId: defaultSchemaId, fieldKey: defaultFieldKey });
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
            const defaultFieldKey = firstSelectableFieldPath(newSchemaId, { acceptedShapes: TIME_AXIS_SHAPES });
            onTimeAxisConfigChange({ ...timeAxisConfig, type: 'schema', schemaId: newSchemaId, fieldKey: defaultFieldKey });
        } else {
            onTimeAxisConfigChange({ ...timeAxisConfig, type: 'schema' });
        }
    };

    const handleFieldChange = (newFieldKey: string | null) => {
        onTimeAxisConfigChange({ ...timeAxisConfig, type: 'schema', schemaId: selectedSchemaId!, fieldKey: newFieldKey ?? undefined });
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

    const hasActiveFilters = activeFilterCount > 0 || timeAxisConfig?.timeFrame?.enabled;
    
    const handleClearAll = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent collapsible toggle
        // Clear all filters
        onFilterSetChange({ logic: 'and', rules: [] });
        // Clear time range filter
        if (timeAxisConfig?.timeFrame?.enabled) {
            onTimeAxisConfigChange({
                ...timeAxisConfig,
                timeFrame: { enabled: false }
            });
        }
    };

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1"
                >
                    <SlidersHorizontal className="h-3 w-3" />
                    <span>&</span>
                    <Clock />
                    {activeFilterCount > 0 && (<span className="text-[10px] bg-primary text-primary-foreground rounded-full h-4 w-4 flex items-center justify-center">{activeFilterCount}</span>)}
                    {timeAxisConfig?.timeFrame?.enabled && (<span className="text-[10px] bg-secondary text-secondary-foreground rounded-md px-1 py-0.5 leading-none">T</span>)}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[420px] max-h-[40vh] overflow-y-auto p-3" align="end" side="bottom">
                <div className="space-y-3">
                <div className="flex items-center justify-between mb-1">
                    <h4 className="font-semibold text-xs">Filters, Time Source, and Range</h4>
               
                    {hasActiveFilters && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] hover:bg-destructive/10 hover:text-destructive"
                            onClick={handleClearAll}
                        >
                            <X className="h-3 w-3 mr-1" />
                            Clear all
                        </Button>
                    )}
                </div>
                {/* --- Start of JSX from AnnotationResultFilters --- */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-medium">Logic</Label>
                            <ToggleGroup type="single" value={logicMode} onValueChange={(value) => { if (value) setLogicMode(value as FilterLogicMode); }} size="sm" className="h-6">
                                <ToggleGroupItem value="and" className="h-6 px-2 text-xs">AND</ToggleGroupItem>
                                <ToggleGroupItem value="or" className="h-6 px-2 text-xs">OR</ToggleGroupItem>
                            </ToggleGroup>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                                    <TooltipContent>
                                        <p className="text-xs">AND: all filters must match.<br />OR: any filter can match.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        <Button onClick={addFilter} size="sm" className="h-6 px-2 text-xs"><Plus className="mr-1 h-3 w-3" /> Add</Button>
                    </div>
                    <ScrollArea className="max-h-60 pr-2">
                        <div className="space-y-2">
                            {filters.map((filter, index) => {
                                const { type } = getTargetFieldDefinition(filter, allSchemas);
                                const operators = getOperatorsForType(type);
                                const filterSchema = allSchemas.find(s => s.id === filter.schemaId) ?? null;
                                return (
                                    <div key={filter.id} className={cn("flex items-start gap-1.5 p-2 rounded-lg border", !filter.isActive && "bg-muted/50")}>
                                        <div className="flex-1 space-y-1.5">
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
                                                <Select value={filter.schemaId.toString()} onValueChange={(v) => updateFilter(index, { schemaId: parseInt(v) })}>
                                                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Schema" /></SelectTrigger>
                                                    <SelectContent>{allSchemas.map(s => <SelectItem key={s.id} value={s.id.toString()} className="text-xs">{s.name}</SelectItem>)}</SelectContent>
                                                </Select>
                                                <FieldPicker
                                                    schema={filterSchema}
                                                    value={filter.fieldKey ?? null}
                                                    onChange={(v) => updateFilter(index, { fieldKey: v ?? undefined })}
                                                    placeholder="Field"
                                                    triggerClassName="w-full"
                                                    disabled={!filterSchema}
                                                />
                                                <Select value={filter.operator} onValueChange={(v) => updateFilter(index, { operator: v as any })}>
                                                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Operator" /></SelectTrigger>
                                                    <SelectContent>{operators.map(op => <SelectItem key={op} value={op} className="text-xs">{op.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                                                </Select>
                                            </div>
                                            <div>{renderValueInput(filter, index, type)}</div>
                                        </div>
                                        <div className="flex flex-col items-center gap-1">
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                                                    <TooltipContent><p className="text-xs">{getFilterTooltip(filter)}</p></TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeFilter(index)}><X className="h-3 w-3" /></Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </ScrollArea>
                    {filters.length === 0 && <p className="text-xs text-center text-muted-foreground py-3">No filters added.</p>}
                </div>
                {/* --- End of JSX from AnnotationResultFilters --- */}
                {showTimeControls && (
                    <>
                        <Separator />
                        {/* --- Start of JSX from AnnotationTimeAxisControls --- */}
                        <div className="space-y-2">
                            <div>
                                <Label className="text-[10px] text-muted-foreground mb-1.5 block font-semibold uppercase tracking-wide">Time Source</Label>
                                <RadioGroup value={sourceType} onValueChange={(v) => handleSourceTypeChange(v as TimeAxisSourceType)} className="text-xs space-y-1">
                                    <div className="flex items-center space-x-1.5"><RadioGroupItem value="default" id="time-default" className="h-3.5 w-3.5" /><Label htmlFor="time-default" className="font-normal flex items-center text-xs"><Clock className="h-3 w-3 mr-1 text-muted-foreground"/>Annotation Time</Label></div>
                                    <div className="flex items-center space-x-1.5"><RadioGroupItem value="event" id="time-event" className="h-3.5 w-3.5" /><Label htmlFor="time-event" className="font-normal flex items-center text-xs"><Database className="h-3 w-3 mr-1 text-muted-foreground"/>Event Time</Label></div>
                                    <div className="flex items-center space-x-1.5"><RadioGroupItem value="schema" id="time-schema" className="h-3.5 w-3.5" /><Label htmlFor="time-schema" className="font-normal flex items-center text-xs"><FileJson className="h-3 w-3 mr-1 text-muted-foreground"/>Schema Field</Label></div>
                                </RadioGroup>
                            </div>
                            {sourceType === 'schema' && (
                                <div className="pl-4 space-y-1.5 border-l ml-2 pt-1.5 border-border/60">
                                    <div className="grid grid-cols-2 gap-1.5">
                                        <div>
                                            <Label htmlFor="time-schema-select" className="text-[10px] mb-1 block text-muted-foreground">Schema</Label>
                                            <Select value={selectedSchemaId?.toString() ?? ""} onValueChange={handleSchemaChange} disabled={allSchemas.length === 0}>
                                                <SelectTrigger id="time-schema-select" className="h-7 text-xs w-full"><SelectValue placeholder="Schema..." /></SelectTrigger>
                                                <SelectContent><ScrollArea className="max-h-60 w-full overflow-y-auto">{allSchemas.map(s => (<SelectItem key={s.id} value={s.id.toString()} className="text-xs">{s.name}</SelectItem>))}{allSchemas.length === 0 && <div className="p-2 text-xs text-center italic text-muted-foreground">No schemas</div>}</ScrollArea></SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <Label htmlFor="time-field-select" className="text-[10px] mb-1 block text-muted-foreground">Field</Label>
                                            <FieldPicker
                                                schema={selectedSchemaId ? allSchemas.find(s => s.id === selectedSchemaId) ?? null : null}
                                                value={selectedFieldKey}
                                                onChange={handleFieldChange}
                                                acceptedShapes={TIME_AXIS_SHAPES}
                                                placeholder={selectedSchemaId ? 'Field...' : 'Select schema first'}
                                                disabled={!selectedSchemaId || timeFieldCount === 0}
                                                triggerClassName="w-full"
                                                emptyMessage="No text or number fields in this schema."
                                            />
                                        </div>
                                    </div>
                                    {selectedSchemaId && timeFieldCount === 0 && (<p className="text-[10px] text-muted-foreground italic pt-1">No text or number fields in schema.</p>)}
                                </div>
                            )}
                            <div className="border-t pt-2">
                                <div className="flex items-center justify-between mb-1.5">
                                    <Label className="text-[10px] text-muted-foreground flex items-center font-semibold uppercase tracking-wide"><Filter className="h-3 w-3 mr-1"/>Time Range</Label>
                                    <Button variant={timeFrame.enabled ? "default" : "outline"} size="sm" onClick={handleTimeFrameToggle} className="h-6 px-2 text-xs">{timeFrame.enabled ? "On" : "Off"}</Button>
                                </div>
                                {timeFrame.enabled && (
                                    <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                                        <div>
                                            <Label className="text-[10px] text-muted-foreground mb-1 block">Start</Label>
                                            <Popover open={startDatePickerOpen} onOpenChange={setStartDatePickerOpen}>
                                                <PopoverTrigger asChild><Button variant="outline" className="w-full h-7 px-2 text-xs justify-start font-normal"><Calendar className="h-3 w-3 mr-1"/>{timeFrame.startDate ? format(timeFrame.startDate, 'MMM dd') : 'Date'}</Button></PopoverTrigger>
                                                <PopoverContent className="w-auto p-0"><CalendarComponent mode="single" selected={timeFrame.startDate} onSelect={handleStartDateChange} initialFocus/></PopoverContent>
                                            </Popover>
                                        </div>
                                        <div>
                                            <Label className="text-[10px] text-muted-foreground mb-1 block">End</Label>
                                            <Popover open={endDatePickerOpen} onOpenChange={setEndDatePickerOpen}>
                                                <PopoverTrigger asChild><Button variant="outline" className="w-full h-7 px-2 text-xs justify-start font-normal"><Calendar className="h-3 w-3 mr-1"/>{timeFrame.endDate ? format(timeFrame.endDate, 'MMM dd') : 'Date'}</Button></PopoverTrigger>
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
                </div>
            </PopoverContent>
        </Popover>
    );
}; 