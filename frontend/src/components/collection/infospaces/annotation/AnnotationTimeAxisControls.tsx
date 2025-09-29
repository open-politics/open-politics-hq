'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AnnotationSchemaRead } from '@/client';
import { getTargetKeysForScheme } from '@/lib/annotations/utils';
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Database, FileJson, Calendar, Filter } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format, startOfDay, endOfDay } from 'date-fns';

export type TimeAxisSourceType = 'default' | 'schema' | 'event';

export interface TimeFrameFilter {
  enabled: boolean;
  startDate?: Date;
  endDate?: Date;
}

export interface TimeAxisConfig {
  type: TimeAxisSourceType;
  schemaId?: number;
  fieldKey?: string;
  // NEW: Time range filtering
  timeFrame?: TimeFrameFilter;
}

interface AnnotationTimeAxisControlsProps {
  schemas: AnnotationSchemaRead[];
  value: TimeAxisConfig | null;
  onChange: (config: TimeAxisConfig | null) => void;
  // NEW: Option to show/hide advanced controls
  showAdvancedControls?: boolean;
}

export const AnnotationTimeAxisControls: React.FC<AnnotationTimeAxisControlsProps> = ({
  schemas,
  value,
  onChange,
  showAdvancedControls = true,
}) => {
  const sourceType = value?.type ?? 'event';
  const selectedSchemaId = value?.type === 'schema' ? value.schemaId ?? null : null;
  const selectedFieldKey = value?.type === 'schema' ? value.fieldKey ?? null : null;
  const timeFrame = value?.timeFrame ?? { enabled: false };

  const [startDatePickerOpen, setStartDatePickerOpen] = useState(false);
  const [endDatePickerOpen, setEndDatePickerOpen] = useState(false);

  const fieldOptions = useMemo(() => {
    if (sourceType !== 'schema' || !selectedSchemaId) return [];
    
    const targetKeys = getTargetKeysForScheme(selectedSchemaId, schemas);
    
    return targetKeys
      .filter(tk => tk.type === 'string' || tk.type === 'integer' || tk.type === 'number')
      .map(tk => ({
        value: tk.key,
        label: `${tk.name} (${tk.type})`,
      }));
  }, [sourceType, selectedSchemaId, schemas]);

  const handleSourceTypeChange = (newType: TimeAxisSourceType) => {
    if (newType === 'schema') {
      const defaultSchemaId = schemas.length > 0 ? schemas[0].id : null;
      if (defaultSchemaId) {
        const defaultFields = getTargetKeysForScheme(defaultSchemaId, schemas)
          .filter(tk => tk.type === 'string' || tk.type === 'integer' || tk.type === 'number');
        const defaultFieldKey = defaultFields.length > 0 ? defaultFields[0].key : null;
        onChange({ 
          ...value,
          type: 'schema', 
          schemaId: defaultSchemaId, 
          fieldKey: defaultFieldKey || undefined 
        });
      } else {
        onChange({ ...value, type: 'schema' });
      }
    } else {
      onChange({ ...value, type: newType });
    }
  };

  const handleSchemaChange = (schemaIdStr: string) => {
    const newSchemaId = schemaIdStr ? parseInt(schemaIdStr, 10) : null;
    if (newSchemaId) {
       const defaultFields = getTargetKeysForScheme(newSchemaId, schemas)
         .filter(tk => tk.type === 'string' || tk.type === 'integer' || tk.type === 'number');
       const defaultFieldKey = defaultFields.length > 0 ? defaultFields[0].key : null;
       onChange({ 
         ...value,
         type: 'schema', 
         schemaId: newSchemaId, 
         fieldKey: defaultFieldKey || undefined 
       });
    } else {
       onChange({ ...value, type: 'schema' });
    }
  };

  const handleFieldChange = (newFieldKey: string) => {
    onChange({ 
      ...value,
      type: 'schema', 
      schemaId: selectedSchemaId!, 
      fieldKey: newFieldKey || undefined 
    });
  };

  const handleTimeFrameToggle = () => {
    const newTimeFrame = {
      ...timeFrame,
      enabled: !timeFrame.enabled
    };
    
    // If enabling for first time, set to last 30 days
    if (newTimeFrame.enabled && !timeFrame.startDate && !timeFrame.endDate) {
      const now = new Date();
      newTimeFrame.endDate = endOfDay(now);
      newTimeFrame.startDate = startOfDay(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    }
    
    onChange({
      type: value?.type || 'event', // Ensure type is always defined
      schemaId: value?.schemaId,
      fieldKey: value?.fieldKey,
      timeFrame: newTimeFrame
    });
  };

  const handleStartDateChange = (date: Date | undefined) => {
    if (date) {
      onChange({
        type: value?.type || 'event', // Ensure type is always defined
        schemaId: value?.schemaId,
        fieldKey: value?.fieldKey,
        timeFrame: {
          ...timeFrame,
          startDate: startOfDay(date)
        }
      });
    }
    setStartDatePickerOpen(false);
  };

  const handleEndDateChange = (date: Date | undefined) => {
    if (date) {
      onChange({
        type: value?.type || 'event', // Ensure type is always defined
        schemaId: value?.schemaId,
        fieldKey: value?.fieldKey,
        timeFrame: {
          ...timeFrame,
          endDate: endOfDay(date)
        }
      });
    }
    setEndDatePickerOpen(false);
  };



  return (
    <Card className="mb-3">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm font-medium flex items-center">
            <Clock className="h-4 w-4 mr-2 text-muted-foreground"/>
            Time Axis Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        {/* Time Source Selection */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Time Source</Label>
          <RadioGroup
            value={sourceType}
            onValueChange={(v) => handleSourceTypeChange(v as TimeAxisSourceType)}
            className="text-xs"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="default" id="time-default" />
              <Label htmlFor="time-default" className="font-normal flex items-center">
                  <Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground"/>
                  Annotation Time
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="event" id="time-event" />
              <Label htmlFor="time-event" className="font-normal flex items-center">
                  <Database className="h-3.5 w-3.5 mr-1.5 text-muted-foreground"/>
                  Original Event Time (from Asset)
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="schema" id="time-schema" />
              <Label htmlFor="time-schema" className="font-normal flex items-center">
                  <FileJson className="h-3.5 w-3.5 mr-1.5 text-muted-foreground"/>
                  Annotation Schema Field
              </Label>
            </div>
          </RadioGroup>
        </div>

        {sourceType === 'schema' && (
          <div className="pl-6 space-y-2 border-l ml-2 pt-2 border-border/60">
            <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="time-schema-select" className="text-xs mb-1 block text-muted-foreground">Schema</Label>
                  <Select
                    value={selectedSchemaId?.toString() ?? ""}
                    onValueChange={handleSchemaChange}
                    disabled={schemas.length === 0}
                  >
                    <SelectTrigger id="time-schema-select" className="h-8 text-xs w-full" aria-label="Time Axis Schema">
                      <SelectValue placeholder="Select schema..." />
                    </SelectTrigger>
                    <SelectContent>
                      <ScrollArea className="max-h-60 w-full">
                        {schemas.map(s => (
                          <SelectItem key={s.id} value={s.id.toString()} className="text-xs">{s.name}</SelectItem>
                        ))}
                        {schemas.length === 0 && <div className="p-2 text-xs text-center italic text-muted-foreground">No schemas available</div>}
                      </ScrollArea>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="time-field-select" className="text-xs mb-1 block text-muted-foreground">Field (Text/Number)</Label>
                  <Select
                    value={selectedFieldKey ?? ""}
                    onValueChange={handleFieldChange}
                    disabled={!selectedSchemaId || fieldOptions.length === 0}
                  >
                    <SelectTrigger id="time-field-select" className="h-8 text-xs w-full" aria-label="Time Axis Field">
                      <SelectValue placeholder="Select field..." />
                    </SelectTrigger>
                    <SelectContent>
                      <ScrollArea className="max-h-60 w-full">
                        {fieldOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                        {fieldOptions.length === 0 && selectedSchemaId &&
                          <div className="p-2 text-xs text-center italic text-muted-foreground">No text/number fields</div>}
                        {!selectedSchemaId &&
                         <div className="p-2 text-xs text-center italic text-muted-foreground">Select schema first</div>}
                      </ScrollArea>
                    </SelectContent>
                  </Select>
                </div>
            </div>
            {selectedSchemaId && fieldOptions.length === 0 && (
                 <p className="text-xs text-muted-foreground italic pt-1">Selected schema has no text or number fields suitable for time axis.</p>
            )}
          </div>
        )}

        {/* Time Range Filter */}
        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-muted-foreground flex items-center">
              <Filter className="h-3.5 w-3.5 mr-1.5"/>
              Time Range Filter
            </Label>
            <Button
              variant={timeFrame.enabled ? "default" : "outline"}
              size="sm"
              onClick={handleTimeFrameToggle}
              className="h-6 px-2 text-xs"
            >
              {timeFrame.enabled ? "Enabled" : "Disabled"}
            </Button>
          </div>
          
          {timeFrame.enabled && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Start Date</Label>
                <Popover open={startDatePickerOpen} onOpenChange={setStartDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full h-8 px-2 text-xs justify-start font-normal"
                    >
                      <Calendar className="h-3.5 w-3.5 mr-1.5"/>
                      {timeFrame.startDate ? format(timeFrame.startDate, 'MMM dd, yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={timeFrame.startDate}
                      onSelect={handleStartDateChange}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">End Date</Label>
                <Popover open={endDatePickerOpen} onOpenChange={setEndDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full h-8 px-2 text-xs justify-start font-normal"
                    >
                      <Calendar className="h-3.5 w-3.5 mr-1.5"/>
                      {timeFrame.endDate ? format(timeFrame.endDate, 'MMM dd, yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={timeFrame.endDate}
                      onSelect={handleEndDateChange}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
        </div>


      </CardContent>
    </Card>
  );
}; 