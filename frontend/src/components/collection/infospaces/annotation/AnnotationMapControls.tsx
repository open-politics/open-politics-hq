'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AnnotationSchemaRead } from '@/client/models';
import { FormattedAnnotation } from '@/lib/annotations/types';
import { getTargetKeysForScheme } from '@/lib/annotations/utils';
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, MapPin, AlertCircle, Tag, Settings2, Type, Text } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface MapControlsConfig {
  geocodeSource: { schemaId: number; fieldKey: string } | null;
  labelSource: { schemaId: number; fieldKey: string } | null;
  showLabels: boolean;
}

interface AnnotationMapControlsProps {
  schemas: AnnotationSchemaRead[];
  value: MapControlsConfig;
  onChange: (newConfig: MapControlsConfig) => void;
  onGeocodeRequest: () => void;
  isLoadingGeocoding: boolean;
  geocodingError: string | null;
}

export const AnnotationMapControls: React.FC<AnnotationMapControlsProps> = ({
  schemas,
  value,
  onChange,
  onGeocodeRequest,
  isLoadingGeocoding,
  geocodingError,
}) => {
  const { geocodeSource, labelSource, showLabels } = value;

  // Local state to track current selections for better responsiveness
  const [localGeocodeSource, setLocalGeocodeSource] = useState(geocodeSource);
  const [localLabelSource, setLocalLabelSource] = useState(labelSource);
  const [localShowLabels, setLocalShowLabels] = useState(showLabels);

  // Update local state when value prop changes (important for shared/restored dashboards)
  useEffect(() => {
    setLocalGeocodeSource(geocodeSource);
  }, [geocodeSource]);

  useEffect(() => {
    setLocalLabelSource(labelSource);
  }, [labelSource]);

  useEffect(() => {
    setLocalShowLabels(showLabels);
  }, [showLabels]);

  const geocodeSchemeOptions = useMemo(() => {
    return schemas.map(schema => ({
      value: schema.id.toString(),
      label: schema.name
    }));
  }, [schemas]);

  const geocodeFieldOptions = useMemo(() => {
    if (!localGeocodeSource?.schemaId) return [];
    const targetKeys = getTargetKeysForScheme(localGeocodeSource.schemaId, schemas);
    return targetKeys
      .filter(tk => tk.type === 'string' || (tk.type === 'array' && tk.key.toLowerCase().includes('location')))
      .map(tk => ({ value: tk.key, label: `${tk.name} (${tk.type})` }));
  }, [localGeocodeSource?.schemaId, schemas]);

  const labelFieldOptions = useMemo(() => {
    if (!localLabelSource?.schemaId) return [];
    return getTargetKeysForScheme(localLabelSource.schemaId, schemas);
  }, [localLabelSource?.schemaId, schemas]);

  const handleGeocodeSchemaChange = (schemaIdStr: string) => {
    const newSchemaId = schemaIdStr ? parseInt(schemaIdStr, 10) : null;
    if (newSchemaId) {
      const targetKeys = getTargetKeysForScheme(newSchemaId, schemas);
      const newFieldKey = targetKeys.length > 0 ? targetKeys[0].key : null;
      const newConfig = { schemaId: newSchemaId, fieldKey: newFieldKey! };
      setLocalGeocodeSource(newConfig);
      onChange({ ...value, geocodeSource: newConfig });
    } else {
      setLocalGeocodeSource(null);
      onChange({ ...value, geocodeSource: null });
    }
  };
  
  const handleGeocodeFieldChange = (fieldKey: string) => {
    if (localGeocodeSource) {
      const newConfig = { ...localGeocodeSource, fieldKey };
      setLocalGeocodeSource(newConfig);
      onChange({ ...value, geocodeSource: newConfig });
    }
  };

  const handleLabelSchemaChange = (schemaIdStr: string) => {
    const newSchemaId = schemaIdStr ? parseInt(schemaIdStr, 10) : null;
    if (newSchemaId) {
      const targetKeys = getTargetKeysForScheme(newSchemaId, schemas);
      const newFieldKey = targetKeys.length > 0 ? targetKeys[0].key : null;
      const newConfig = { schemaId: newSchemaId, fieldKey: newFieldKey! };
      setLocalLabelSource(newConfig);
      onChange({ ...value, labelSource: newConfig });
    } else {
      setLocalLabelSource(null);
      onChange({ ...value, labelSource: null });
    }
  };

  const handleLabelFieldChange = (fieldKey: string) => {
    if (localLabelSource) {
      const newConfig = { ...localLabelSource, fieldKey };
      setLocalLabelSource(newConfig);
      onChange({ ...value, labelSource: newConfig });
    }
  };

  const handleShowLabelsChange = (checked: boolean) => {
    setLocalShowLabels(checked);
    onChange({ ...value, showLabels: checked });
  };
  
  return (
    <div className="mb-0 p-3 rounded-t-md bg-muted/20 backdrop-blur supports-[backdrop-filter]:bg-background/40 border border-border/50">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold flex items-center text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 mr-1.5" />
            Geocoding Source
          </Label>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="geocode-schema-select" className="text-xs mb-1 block sr-only">Schema</Label>
              <Select value={localGeocodeSource?.schemaId?.toString() ?? ""} onValueChange={handleGeocodeSchemaChange}>
                <SelectTrigger id="geocode-schema-select" className="h-8 text-xs w-full" aria-label="Geocode Source Schema">
                  <SelectValue placeholder="Select schema..." />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="max-h-60 w-full">
                    {geocodeSchemeOptions.map(option => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>
                    ))}
                    {geocodeSchemeOptions.length === 0 &&
                      <div className="p-2 text-xs text-center italic text-muted-foreground">No schemas in run</div>}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
               <Label htmlFor="geocode-field-select" className="text-xs mb-1 block sr-only">Field</Label>
               <Select
                  value={localGeocodeSource?.fieldKey ?? ""}
                  onValueChange={handleGeocodeFieldChange}
                  disabled={!localGeocodeSource?.schemaId}
               >
                  <SelectTrigger id="geocode-field-select" className="h-8 text-xs w-full" aria-label="Geocode Source Field">
                     <SelectValue placeholder="Select field..." />
                  </SelectTrigger>
                  <SelectContent>
                    <ScrollArea className="max-h-60 w-full">
                      {geocodeFieldOptions.map(option => (
                        <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>
                      ))}
                      {geocodeFieldOptions.length === 0 && localGeocodeSource?.schemaId &&
                        <div className="p-2 text-xs text-center italic text-muted-foreground">No fields in schema</div>}
                      {!localGeocodeSource?.schemaId &&
                        <div className="p-2 text-xs text-center italic text-muted-foreground">Select a schema first</div>}
                    </ScrollArea>
                  </SelectContent>
               </Select>
            </div>
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                   <div className={cn(!localGeocodeSource?.schemaId || !localGeocodeSource?.fieldKey ? "cursor-not-allowed" : "")}>
                     <Button
                       onClick={onGeocodeRequest}
                       disabled={!localGeocodeSource?.schemaId || !localGeocodeSource?.fieldKey || isLoadingGeocoding}
                       size="icon"
                       variant="outline"
                       className="h-8 w-8 flex-shrink-0 bg-red-400"
                       aria-label="Run Geocoding"ˇ
                     >
                       {isLoadingGeocoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                       <span className="sr-only">Geocode</span>
                     </Button>
                   </div>
                </TooltipTrigger>
                <TooltipContent>
                   {!localGeocodeSource?.schemaId || !localGeocodeSource?.fieldKey
                      ? "Select a schema and field first"
                      : isLoadingGeocoding ? "Geocoding..." : "Geocode selected locations"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Label Configuration Section */}
        <div className="space-y-1.5">
           <Label className="text-xs font-semibold flex items-center text-muted-foreground">
              <Type className="h-3.5 w-3.5 mr-1.5" />
              Map Labels
           </Label>
           <div className="flex items-end gap-2">
              <div className="flex flex-col items-center">
                 <TooltipProvider delayDuration={100}>
                   <Tooltip>
                     <TooltipTrigger asChild>
                       <div className="h-8 flex items-center">
                          <Switch
                            id="map-label-switch"
                            checked={localShowLabels}
                            onCheckedChange={handleShowLabelsChange}
                            className="data-[state=checked]:bg-primary"
                            aria-label="Show map labels toggle"
                          />
                       </div>
                     </TooltipTrigger>
                     <TooltipContent><p>{showLabels ? 'Hide' : 'Show'} map labels</p></TooltipContent>
                   </Tooltip>
                 </TooltipProvider>
              </div>
              <div className={cn("flex-1", !localShowLabels && "opacity-50 pointer-events-none transition-opacity")}>
                 <Label htmlFor="map-label-schema-select" className="text-xs mb-1 block sr-only">Label Schema</Label>
                 <Select
                   value={localLabelSource?.schemaId?.toString() ?? ""}
                   onValueChange={handleLabelSchemaChange}
                   disabled={!localShowLabels || schemas.length === 0}
                 >
                   <SelectTrigger id="map-label-schema-select" className="h-8 text-xs w-full" aria-label="Map Label Schema">
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
              <div className={cn("flex-1", !localShowLabels && "opacity-50 pointer-events-none transition-opacity")}>
                 <Label htmlFor="map-label-key-select" className="text-xs mb-1 block sr-only">Label Field</Label>
                 <Select
                   value={localLabelSource?.fieldKey ?? ""}
                   onValueChange={handleLabelFieldChange}
                   disabled={!localShowLabels || labelFieldOptions.length === 0}
                 >
                   <SelectTrigger id="map-label-key-select" className="h-8 text-xs w-full" aria-label="Map Label Field">
                     <SelectValue placeholder="Select field..." />
                   </SelectTrigger>
                   <SelectContent>
                     <ScrollArea className="max-h-60 w-full">
                       {labelFieldOptions.map(tk => (
                         <SelectItem key={tk.key} value={tk.key} className="text-xs flex items-center gap-2">
                           <span className="truncate">{tk.name}</span>
                           <Badge variant="outline" className="text-xs px-1.5 py-0 ml-auto">{tk.type}</Badge>
                         </SelectItem>
                       ))}
                       {labelFieldOptions.length === 0 &&
                         <div className="p-2 text-xs text-center italic text-muted-foreground">No text fields</div>}
                     </ScrollArea>
                   </SelectContent>
                 </Select>
              </div>
           </div>
            {localShowLabels && localLabelSource?.schemaId !== null && labelFieldOptions.length === 0 && (
                <div className="text-xs text-muted-foreground italic pt-1">
                    Selected schema has no text-based fields for labels.
                </div>
            )}
        </div>

      </div>

      {(isLoadingGeocoding || geocodingError) && (
        <div className="pt-2 mt-2 border-t border-border/50">
          {isLoadingGeocoding && (
              <div className="text-xs text-muted-foreground flex items-center">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Geocoding locations...
              </div>
          )}
          {geocodingError && !isLoadingGeocoding && (
              <p className="text-xs text-red-500 flex items-center">
                  <AlertCircle className="h-3 w-3 mr-1" /> {geocodingError}
              </p>
          )}
        </div>
      )}
    </div>
  );
};