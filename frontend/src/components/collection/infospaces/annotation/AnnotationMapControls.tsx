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

interface AnnotationMapControlsProps {
  schemas: AnnotationSchemaRead[];
  results: FormattedAnnotation[];
  onGeocodeRequest: (schemaId: string, fieldKey: string) => Promise<void>;
  isLoadingGeocoding: boolean;
  geocodingError: string | null;
  onMapLabelConfigChange: (config: { schemaId: number; fieldKey: string } | undefined) => void;
  initialSelectedGeocodeSchemaId?: string | null;
  initialSelectedGeocodeField?: string | null;
  initialMapLabelSchemaId?: number | null;
  initialMapLabelFieldKey?: string | null;
  initialShowMapLabels?: boolean;
}

export const AnnotationMapControls: React.FC<AnnotationMapControlsProps> = ({
  schemas,
  results,
  onGeocodeRequest,
  isLoadingGeocoding,
  geocodingError,
  onMapLabelConfigChange,
  initialSelectedGeocodeSchemaId = null,
  initialSelectedGeocodeField = null,
  initialMapLabelSchemaId = null,
  initialMapLabelFieldKey = null,
  initialShowMapLabels = false,
}) => {
  const [selectedGeocodeSchemaId, setSelectedGeocodeSchemaId] = useState<string | null>(initialSelectedGeocodeSchemaId);
  const [selectedGeocodeField, setSelectedGeocodeField] = useState<string | null>(initialSelectedGeocodeField);
  const [showMapLabels, setShowMapLabels] = useState<boolean>(initialShowMapLabels);
  const [mapLabelSchemaId, setMapLabelSchemaId] = useState<number | null>(initialMapLabelSchemaId);
  const [mapLabelFieldKey, setMapLabelFieldKey] = useState<string | null>(initialMapLabelFieldKey);
  const initialGeocodeAttempted = useRef(false);

  // --- Derive options ---
  const geocodeSchemeOptions = useMemo(() => {
    return schemas.map(schema => ({
      value: schema.id.toString(),
      label: schema.name
    }));
  }, [schemas]);

  const geocodeFieldOptions = useMemo(() => {
    if (!selectedGeocodeSchemaId) return [];
    const schema = schemas.find(s => s.id === parseInt(selectedGeocodeSchemaId, 10));
    if (!schema) return [];
    // This needs to be adapted to the new `output_contract` structure
    // Placeholder logic:
    const properties = (schema.output_contract as any)?.properties;
    if (!properties) return [];
    return Object.keys(properties).map(key => ({
        value: key,
        label: `${key} (${properties[key].type})`
    }));
  }, [selectedGeocodeSchemaId, schemas]);

  const currentMapLabelKeys = useMemo(() => {
    if (mapLabelSchemaId !== null && schemas.length > 0) {
      return getTargetKeysForScheme(mapLabelSchemaId, schemas);
    }
    return [];
  }, [mapLabelSchemaId, schemas]);

  // --- Effects to sync initial state and reset fields ---
  useEffect(() => {
    setSelectedGeocodeSchemaId(initialSelectedGeocodeSchemaId);
  }, [initialSelectedGeocodeSchemaId]);

  useEffect(() => {
    setSelectedGeocodeField(initialSelectedGeocodeField);
  }, [initialSelectedGeocodeField]);

  useEffect(() => {
    setMapLabelSchemaId(initialMapLabelSchemaId);
  }, [initialMapLabelSchemaId]);

  useEffect(() => {
    setMapLabelFieldKey(initialMapLabelFieldKey);
  }, [initialMapLabelFieldKey]);

  useEffect(() => {
    setShowMapLabels(initialShowMapLabels);
  }, [initialShowMapLabels]);

  // Reset field selection when schema changes (respecting initial value)
  useEffect(() => {
    if (selectedGeocodeSchemaId !== initialSelectedGeocodeSchemaId || !initialSelectedGeocodeField) {
        setSelectedGeocodeField(selectedGeocodeSchemaId === initialSelectedGeocodeSchemaId ? initialSelectedGeocodeField : null);
    }
  }, [selectedGeocodeSchemaId, initialSelectedGeocodeSchemaId, initialSelectedGeocodeField]);

  useEffect(() => {
    let targetFieldKey: string | null = mapLabelFieldKey;

    if (mapLabelSchemaId === null) {
      targetFieldKey = null;
    } else {
      const currentKeys = getTargetKeysForScheme(mapLabelSchemaId, schemas);
      const isCurrentKeyValid = currentKeys.some(k => k.key === mapLabelFieldKey);

      if (!isCurrentKeyValid || mapLabelFieldKey === null) {
        targetFieldKey = currentKeys.length > 0 ? currentKeys[0].key : null;
      }
    }

    if (targetFieldKey !== mapLabelFieldKey) {
       setMapLabelFieldKey(targetFieldKey);
    }
  }, [mapLabelSchemaId, schemas]);

  // --- Effect to notify parent of label config changes (MODIFIED) ---
  useEffect(() => {
    let configToSend: { schemaId: number; fieldKey: string } | undefined = undefined;

    if (showMapLabels && mapLabelSchemaId !== null && mapLabelFieldKey !== null) {
      const validKeysForScheme = getTargetKeysForScheme(mapLabelSchemaId, schemas);
      const isFieldValidForScheme = validKeysForScheme.some(k => k.key === mapLabelFieldKey);

      if (isFieldValidForScheme) {
          configToSend = { schemaId: mapLabelSchemaId, fieldKey: mapLabelFieldKey };
      }
    }
    onMapLabelConfigChange(configToSend);
  }, [showMapLabels, mapLabelSchemaId, mapLabelFieldKey, onMapLabelConfigChange, schemas]);

  // --- Initial Geocode Trigger ---
  useEffect(() => {
    initialGeocodeAttempted.current = false;
  }, [initialSelectedGeocodeSchemaId, initialSelectedGeocodeField]);

  useEffect(() => {
    const canGeocode =
      initialSelectedGeocodeSchemaId &&
      initialSelectedGeocodeField &&
      results.length > 0 &&
      !isLoadingGeocoding;

    if (canGeocode && !initialGeocodeAttempted.current) {
      initialGeocodeAttempted.current = true;
      onGeocodeRequest(initialSelectedGeocodeSchemaId!, initialSelectedGeocodeField!);
    }
  }, [
      initialSelectedGeocodeSchemaId,
      initialSelectedGeocodeField,
      results,
      isLoadingGeocoding,
      onGeocodeRequest
  ]);

  // --- Handlers ---
  const handleGeocodeClick = useCallback(() => {
    if (selectedGeocodeSchemaId && selectedGeocodeField) {
      onGeocodeRequest(selectedGeocodeSchemaId, selectedGeocodeField);
    }
  }, [selectedGeocodeSchemaId, selectedGeocodeField, onGeocodeRequest]);

  return (
    <div className="mb-3 p-3 rounded-md bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60 border border-border/50">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold flex items-center text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 mr-1.5" />
            Geocoding Source
          </Label>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="geocode-schema-select" className="text-xs mb-1 block sr-only">Schema</Label>
              <Select value={selectedGeocodeSchemaId ?? ""} onValueChange={setSelectedGeocodeSchemaId}>
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
                  value={selectedGeocodeField ?? ""}
                  onValueChange={setSelectedGeocodeField}
                  disabled={!selectedGeocodeSchemaId}
               >
                  <SelectTrigger id="geocode-field-select" className="h-8 text-xs w-full" aria-label="Geocode Source Field">
                     <SelectValue placeholder="Select field..." />
                  </SelectTrigger>
                  <SelectContent>
                    <ScrollArea className="max-h-60 w-full">
                      {geocodeFieldOptions.map(option => (
                        <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>
                      ))}
                      {geocodeFieldOptions.length === 0 && selectedGeocodeSchemaId &&
                        <div className="p-2 text-xs text-center italic text-muted-foreground">No fields in schema</div>}
                      {!selectedGeocodeSchemaId &&
                        <div className="p-2 text-xs text-center italic text-muted-foreground">Select a schema first</div>}
                    </ScrollArea>
                  </SelectContent>
               </Select>
            </div>
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                   <div className={cn(!selectedGeocodeSchemaId || !selectedGeocodeField || results.length === 0 ? "cursor-not-allowed" : "")}>
                     <Button
                       onClick={handleGeocodeClick}
                       disabled={!selectedGeocodeSchemaId || !selectedGeocodeField || isLoadingGeocoding || results.length === 0}
                       size="icon"
                       variant="outline"
                       className="h-8 w-8 flex-shrink-0"
                       aria-label="Run Geocoding"
                     >
                       {isLoadingGeocoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                     </Button>
                   </div>
                </TooltipTrigger>
                <TooltipContent>
                   {results.length === 0
                    ? "No results available to geocode"
                    : (!selectedGeocodeSchemaId || !selectedGeocodeField
                      ? "Select a schema and field first"
                      : isLoadingGeocoding ? "Geocoding..." : "Geocode selected locations")}
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
                            checked={showMapLabels}
                            onCheckedChange={setShowMapLabels}
                            className="data-[state=checked]:bg-primary"
                            aria-label="Show map labels toggle"
                          />
                       </div>
                     </TooltipTrigger>
                     <TooltipContent><p>{showMapLabels ? 'Hide' : 'Show'} map labels</p></TooltipContent>
                   </Tooltip>
                 </TooltipProvider>
              </div>
              <div className={cn("flex-1", !showMapLabels && "opacity-50 pointer-events-none transition-opacity")}>
                 <Label htmlFor="map-label-schema-select" className="text-xs mb-1 block sr-only">Label Schema</Label>
                 <Select
                   value={mapLabelSchemaId?.toString() ?? ""}
                   onValueChange={(v) => setMapLabelSchemaId(v ? parseInt(v) : null)}
                   disabled={!showMapLabels || schemas.length === 0}
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
              <div className={cn("flex-1", !showMapLabels && "opacity-50 pointer-events-none transition-opacity")}>
                 <Label htmlFor="map-label-key-select" className="text-xs mb-1 block sr-only">Label Field</Label>
                 <Select
                   value={mapLabelFieldKey ?? ""}
                   onValueChange={(v) => setMapLabelFieldKey(v || null)}
                   disabled={!showMapLabels || currentMapLabelKeys.length === 0}
                 >
                   <SelectTrigger id="map-label-key-select" className="h-8 text-xs w-full" aria-label="Map Label Field">
                     <SelectValue placeholder="Select field..." />
                   </SelectTrigger>
                   <SelectContent>
                     <ScrollArea className="max-h-60 w-full">
                       {currentMapLabelKeys.map(tk => (
                         <SelectItem key={tk.key} value={tk.key} className="text-xs flex items-center gap-2">
                           <span className="truncate">{tk.name}</span>
                           <Badge variant="outline" className="text-xs px-1.5 py-0 ml-auto">{tk.type}</Badge>
                         </SelectItem>
                       ))}
                       {currentMapLabelKeys.length === 0 &&
                         <div className="p-2 text-xs text-center italic text-muted-foreground">No text fields</div>}
                     </ScrollArea>
                   </SelectContent>
                 </Select>
              </div>
           </div>
            {showMapLabels && mapLabelSchemaId !== null && currentMapLabelKeys.length === 0 && (
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