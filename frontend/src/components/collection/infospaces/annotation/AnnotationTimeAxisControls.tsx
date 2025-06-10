'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AnnotationSchemaRead, AssetRead, AnnotationRead } from '@/client/models';
import { FormattedAnnotation } from '@/lib/annotations/types';
import { getTargetKeysForScheme } from '@/lib/annotations/utils';
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
  schemaId?: number;
  fieldKey?: string;
}

interface AnnotationTimeAxisControlsProps {
  schemas: AnnotationSchemaRead[];
  initialConfig?: TimeAxisConfig | null;
  onTimeAxisConfigChange: (config: TimeAxisConfig | null) => void;
}

export type { AnnotationTimeAxisControlsProps };
export const AnnotationTimeAxisControls: React.FC<AnnotationTimeAxisControlsProps> = ({
  schemas,
  initialConfig = { type: 'event' },
  onTimeAxisConfigChange,
}) => {
  const [sourceType, setSourceType] = useState<TimeAxisSourceType>(initialConfig?.type ?? 'event');
  const [selectedSchemaId, setSelectedSchemaId] = useState<number | null>(initialConfig?.type === 'schema' ? initialConfig.schemaId ?? null : null);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(initialConfig?.type === 'schema' ? initialConfig.fieldKey ?? null : null);

  const fieldOptions = useMemo(() => {
    if (sourceType !== 'schema' || !selectedSchemaId) return [];
    const schema = schemas.find(s => s.id === selectedSchemaId);
    if (!schema) return [];
    
    const properties = (schema.output_contract as any)?.properties || {};
    return Object.entries(properties)
      .filter(([key, value]: [string, any]) => value.type === 'string' || value.type === 'integer')
      .map(([key, value]: [string, any]) => ({
        value: key,
        label: `${value.title || key} (${value.type})`,
      }));
  }, [sourceType, selectedSchemaId, schemas]);

  useEffect(() => {
    if (sourceType === 'default' || sourceType === 'event') {
      setSelectedSchemaId(null);
      setSelectedFieldKey(null);
    }
  }, [sourceType]);

  useEffect(() => {
    if (sourceType === 'schema' && selectedSchemaId !== null) {
      const currentOptions = fieldOptions;
      const isCurrentFieldValid = currentOptions.some(opt => opt.value === selectedFieldKey);

      if (!isCurrentFieldValid && currentOptions.length > 0) {
        setSelectedFieldKey(currentOptions[0].value);
      } else if (currentOptions.length === 0) {
        setSelectedFieldKey(null);
      }
    }
  }, [selectedSchemaId, fieldOptions, sourceType, selectedFieldKey]);

  useEffect(() => {
    let newConfig: TimeAxisConfig | null = null;
    if (sourceType === 'default') {
      newConfig = { type: 'default' };
    } else if (sourceType === 'event') {
      newConfig = { type: 'event' };
    } else if (sourceType === 'schema' && selectedSchemaId !== null && selectedFieldKey !== null) {
      const schema = schemas.find(s => s.id === selectedSchemaId);
      const properties = (schema?.output_contract as any)?.properties || {};
      if (properties[selectedFieldKey]) {
        newConfig = { type: 'schema', schemaId: selectedSchemaId, fieldKey: selectedFieldKey };
      }
    }
    
    if (JSON.stringify(newConfig) !== JSON.stringify(initialConfig)) {
        onTimeAxisConfigChange(newConfig);
    }
  }, [sourceType, selectedSchemaId, selectedFieldKey, schemas, onTimeAxisConfigChange, initialConfig]);

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

        {sourceType === 'schema' && (
          <div className="pl-6 space-y-2 border-l ml-2 pt-2 border-border/60">
            <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="time-schema-select" className="text-xs mb-1 block text-muted-foreground">Schema</Label>
                  <Select
                    value={selectedSchemaId?.toString() ?? ""}
                    onValueChange={(v) => setSelectedSchemaId(v ? parseInt(v, 10) : null)}
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
                    onValueChange={(v) => setSelectedFieldKey(v || null)}
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
      </CardContent>
    </Card>
  );
}; 