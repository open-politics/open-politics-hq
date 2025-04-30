'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ClassificationSchemeRead, DataRecordRead, ClassificationResultRead } from '@/client'; // Assuming client models are here
import { FormattedClassificationResult } from '@/lib/classification/types'; // Assuming types are here
import { getTargetKeysForScheme } from '@/lib/classification/utils'; // Assuming utils are here
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Database, FileJson } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type TimeAxisSourceType = 'default' | 'schema' | 'event';

export interface TimeAxisConfig {
  type: TimeAxisSourceType;
  schemeId?: number; // Only used if type is 'schema'
  fieldKey?: string; // Only used if type is 'schema'
}

interface ClassificationTimeAxisControlsProps {
  schemes: ClassificationSchemeRead[];
  // Optional: results/dataRecords can be used to validate if a schema field actually contains parsable dates
  // results?: FormattedClassificationResult[];
  // dataRecords?: DataRecordRead[];
  initialConfig?: TimeAxisConfig | null;
  onTimeAxisConfigChange: (config: TimeAxisConfig | null) => void;
}

export type { ClassificationTimeAxisControlsProps };
export const ClassificationTimeAxisControls: React.FC<ClassificationTimeAxisControlsProps> = ({
  schemes,
  initialConfig = { type: 'default' }, // Default to using DataRecord timestamp
  onTimeAxisConfigChange,
}) => {
  const [sourceType, setSourceType] = useState<TimeAxisSourceType>(initialConfig?.type ?? 'default');
  const [selectedSchemeId, setSelectedSchemeId] = useState<number | null>(initialConfig?.type === 'schema' ? initialConfig.schemeId ?? null : null);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(initialConfig?.type === 'schema' ? initialConfig.fieldKey ?? null : null);

  // --- Memoized Options ---

  const fieldOptions = useMemo(() => {
    if (sourceType !== 'schema' || !selectedSchemeId) return [];
    const scheme = schemes.find(s => s.id === selectedSchemeId);
    if (!scheme) return [];
    // Filter fields: suggest string or int (might be epoch), maybe add hint later
    return scheme.fields
      .filter(f => f.type === 'str' || f.type === 'int') // Basic filter
      .map(field => ({
        value: field.name,
        label: `${field.name} (${field.type})`,
        // Potential future use: Add hint icon if field.is_time_axis_hint
      }));
  }, [sourceType, selectedSchemeId, schemes]);

  // --- Effects ---

  // Reset scheme/field if source type changes to 'default'
  useEffect(() => {
    if (sourceType === 'default') {
      setSelectedSchemeId(null);
      setSelectedFieldKey(null);
    }
  }, [sourceType]);

  // Auto-select first field if scheme changes and no field is selected (or current is invalid)
  useEffect(() => {
    if (sourceType === 'schema' && selectedSchemeId !== null) {
      const currentOptions = fieldOptions; // Uses memoized options based on selectedSchemeId
      const isCurrentFieldValid = currentOptions.some(opt => opt.value === selectedFieldKey);

      if (!isCurrentFieldValid && currentOptions.length > 0) {
        setSelectedFieldKey(currentOptions[0].value);
      } else if (currentOptions.length === 0) {
        // No valid fields for this scheme
        setSelectedFieldKey(null);
      }
      // If current field is valid, do nothing (preserve selection)
    }
  }, [selectedSchemeId, fieldOptions, sourceType, selectedFieldKey]); // Add selectedFieldKey dependency

  // Notify parent when a valid configuration is selected
  useEffect(() => {
    let newConfig: TimeAxisConfig | null = null;
    if (sourceType === 'default') {
      newConfig = { type: 'default' };
    } else if (sourceType === 'schema' && selectedSchemeId !== null && selectedFieldKey !== null) {
      // Validate that the field actually exists for the scheme before notifying
      const scheme = schemes.find(s => s.id === selectedSchemeId);
      const fieldExists = scheme?.fields.some(f => f.name === selectedFieldKey);
      if (fieldExists) {
        newConfig = { type: 'schema', schemeId: selectedSchemeId, fieldKey: selectedFieldKey };
      }
    }
    // Only call if config actually changes
    // Note: Comparing objects directly might not work as expected if they are recreated.
    // A simple JSON stringify comparison is often sufficient for basic config objects.
    if (JSON.stringify(newConfig) !== JSON.stringify(initialConfig)) { // Compare to initial prop to avoid loop on mount
        onTimeAxisConfigChange(newConfig);
    }
  }, [sourceType, selectedSchemeId, selectedFieldKey, schemes, onTimeAxisConfigChange, initialConfig]); // Add initialConfig

  return (
    <Card className="mb-3">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm font-medium flex items-center">
            <Clock className="h-4 w-4 mr-2 text-muted-foreground"/>
            Time Axis Source
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        <RadioGroup
          value={sourceType}
          onValueChange={(value) => setSourceType(value as TimeAxisSourceType)}
          className="text-xs"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="default" id="time-default" />
            <Label htmlFor="time-default" className="font-normal flex items-center">
                <Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground"/>
                Classification Time
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="event" id="time-event" />
            <Label htmlFor="time-event" className="font-normal flex items-center">
                <Database className="h-3.5 w-3.5 mr-1.5 text-muted-foreground"/>
                Original Event Time (from Data Record)
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="schema" id="time-schema" />
            <Label htmlFor="time-schema" className="font-normal flex items-center">
                <FileJson className="h-3.5 w-3.5 mr-1.5 text-muted-foreground"/>
                Classification Scheme Field
            </Label>
          </div>
        </RadioGroup>

        {sourceType === 'schema' && (
          <div className="pl-6 space-y-2 border-l ml-2 pt-2 border-border/60">
            <div className="grid grid-cols-2 gap-2">
                 {/* Scheme Select */}
                <div>
                  <Label htmlFor="time-scheme-select" className="text-xs mb-1 block text-muted-foreground">Scheme</Label>
                  <Select
                    value={selectedSchemeId?.toString() ?? ""}
                    onValueChange={(v) => setSelectedSchemeId(v ? parseInt(v, 10) : null)}
                    disabled={schemes.length === 0}
                  >
                    <SelectTrigger id="time-scheme-select" className="h-8 text-xs w-full" aria-label="Time Axis Scheme">
                      <SelectValue placeholder="Select scheme..." />
                    </SelectTrigger>
                    <SelectContent>
                      <ScrollArea className="max-h-60 w-full">
                        {schemes.map(s => (
                          <SelectItem key={s.id} value={s.id.toString()} className="text-xs">{s.name}</SelectItem>
                        ))}
                        {schemes.length === 0 && <div className="p-2 text-xs text-center italic text-muted-foreground">No schemes available</div>}
                      </ScrollArea>
                    </SelectContent>
                  </Select>
                </div>

                {/* Field Select */}
                <div>
                  <Label htmlFor="time-field-select" className="text-xs mb-1 block text-muted-foreground">Field (Text/Number)</Label>
                  <Select
                    value={selectedFieldKey ?? ""}
                    onValueChange={(v) => setSelectedFieldKey(v || null)}
                    disabled={!selectedSchemeId || fieldOptions.length === 0}
                  >
                    <SelectTrigger id="time-field-select" className="h-8 text-xs w-full" aria-label="Time Axis Field">
                      <SelectValue placeholder="Select field..." />
                    </SelectTrigger>
                    <SelectContent>
                      <ScrollArea className="max-h-60 w-full">
                        {fieldOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                            {/* Optional: Add hint icon here */}
                          </SelectItem>
                        ))}
                        {fieldOptions.length === 0 && selectedSchemeId &&
                          <div className="p-2 text-xs text-center italic text-muted-foreground">No text/number fields</div>}
                        {!selectedSchemeId &&
                         <div className="p-2 text-xs text-center italic text-muted-foreground">Select scheme first</div>}
                      </ScrollArea>
                    </SelectContent>
                  </Select>
                </div>
            </div>
            {selectedSchemeId && fieldOptions.length === 0 && (
                 <p className="text-xs text-muted-foreground italic pt-1">Selected scheme has no text or number fields suitable for time axis.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}; 