'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ClassificationSchemeRead } from '@/client';
import { FormattedClassificationResult } from '@/lib/classification/types';
import { getTargetKeysForScheme } from '@/lib/classification/utils';
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, MapPin, AlertCircle, Tag, Settings2, Type, Text } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface ClassificationMapControlsProps {
  schemes: ClassificationSchemeRead[];
  results: FormattedClassificationResult[];
  onGeocodeRequest: (schemeId: string, fieldKey: string) => Promise<void>;
  isLoadingGeocoding: boolean;
  geocodingError: string | null;
  onMapLabelConfigChange: (config: { schemeId: number; fieldKey: string } | undefined) => void;
  initialSelectedGeocodeSchemeId?: string | null;
  initialSelectedGeocodeField?: string | null;
  initialMapLabelSchemeId?: number | null;
  initialMapLabelFieldKey?: string | null;
  initialShowMapLabels?: boolean;
}

export const ClassificationMapControls: React.FC<ClassificationMapControlsProps> = ({
  schemes,
  results,
  onGeocodeRequest,
  isLoadingGeocoding,
  geocodingError,
  onMapLabelConfigChange,
  initialSelectedGeocodeSchemeId = null,
  initialSelectedGeocodeField = null,
  initialMapLabelSchemeId = null,
  initialMapLabelFieldKey = null,
  initialShowMapLabels = false,
}) => {
  const [selectedGeocodeSchemeId, setSelectedGeocodeSchemeId] = useState<string | null>(initialSelectedGeocodeSchemeId);
  const [selectedGeocodeField, setSelectedGeocodeField] = useState<string | null>(initialSelectedGeocodeField);
  const [showMapLabels, setShowMapLabels] = useState<boolean>(initialShowMapLabels);
  const [mapLabelSchemeId, setMapLabelSchemeId] = useState<number | null>(initialMapLabelSchemeId);
  const [mapLabelFieldKey, setMapLabelFieldKey] = useState<string | null>(initialMapLabelFieldKey);
  const initialGeocodeAttempted = useRef(false);

  // --- Derive options ---
  const geocodeSchemeOptions = useMemo(() => {
    return schemes.map(scheme => ({
      value: scheme.id.toString(),
      label: scheme.name
    }));
  }, [schemes]);

  const geocodeFieldOptions = useMemo(() => {
    if (!selectedGeocodeSchemeId) return [];
    const scheme = schemes.find(s => s.id === parseInt(selectedGeocodeSchemeId, 10));
    if (!scheme) return [];
    return scheme.fields.map(field => ({
      value: field.name,
      label: `${field.name} (${field.type})`
    }));
  }, [selectedGeocodeSchemeId, schemes]);

  const currentMapLabelKeys = useMemo(() => {
    if (mapLabelSchemeId !== null && schemes.length > 0) {
      return getTargetKeysForScheme(mapLabelSchemeId, schemes);
    }
    return [];
  }, [mapLabelSchemeId, schemes]);

  // --- Effects to sync initial state and reset fields ---
  useEffect(() => {
    setSelectedGeocodeSchemeId(initialSelectedGeocodeSchemeId);
  }, [initialSelectedGeocodeSchemeId]);

  useEffect(() => {
    setSelectedGeocodeField(initialSelectedGeocodeField);
  }, [initialSelectedGeocodeField]);

  useEffect(() => {
    setMapLabelSchemeId(initialMapLabelSchemeId);
  }, [initialMapLabelSchemeId]);

  useEffect(() => {
    setMapLabelFieldKey(initialMapLabelFieldKey);
  }, [initialMapLabelFieldKey]);

  useEffect(() => {
    setShowMapLabels(initialShowMapLabels);
  }, [initialShowMapLabels]);

  // Reset field selection when scheme changes (respecting initial value)
  useEffect(() => {
    // Only reset if the scheme changes *away* from the initial field's scheme
    // Or if the initial field wasn't set
    if (selectedGeocodeSchemeId !== initialSelectedGeocodeSchemeId || !initialSelectedGeocodeField) {
        // If a scheme is selected, but no specific field, don't automatically select one
        // Keep the initial value if the scheme matches, otherwise clear
        setSelectedGeocodeField(selectedGeocodeSchemeId === initialSelectedGeocodeSchemeId ? initialSelectedGeocodeField : null);
    }
  }, [selectedGeocodeSchemeId, initialSelectedGeocodeSchemeId, initialSelectedGeocodeField]);

  useEffect(() => {
    // Goal: When scheme changes, update the field key appropriately.
    // Preserve the field key if it's valid for the new scheme, otherwise reset or auto-select.

    let targetFieldKey: string | null = mapLabelFieldKey; // Start with the current key

    if (mapLabelSchemeId === null) {
      // If scheme is cleared, always clear the field.
      targetFieldKey = null;
    } else {
      // Scheme is selected.
      const currentKeys = getTargetKeysForScheme(mapLabelSchemeId, schemes);
      const isCurrentKeyValid = currentKeys.some(k => k.key === mapLabelFieldKey);

      // If the current key isn't valid for the *new* scheme, OR if the key is currently null...
      if (!isCurrentKeyValid || mapLabelFieldKey === null) {
        // Determine the new target key: the first valid key, or null if none exist.
        targetFieldKey = currentKeys.length > 0 ? currentKeys[0].key : null;
        console.log(`[MapControls] Scheme changed or key invalid/null. Auto-selecting target field key: ${targetFieldKey}`);
      }
      // If the current key *is* valid, targetFieldKey remains unchanged (preserves selection).
    }

    // Only update state if the target key is different from the current key
    // This prevents unnecessary re-renders and potential loops if the key didn't actually need to change.
    if (targetFieldKey !== mapLabelFieldKey) {
       console.log(`[MapControls] Setting mapLabelFieldKey from '${mapLabelFieldKey}' to '${targetFieldKey}'`);
       setMapLabelFieldKey(targetFieldKey);
    }

  // Dependencies: React to changes in scheme selection or the list of schemes itself.
  // We don't need mapLabelFieldKey here because we are *setting* it based on the scheme change.
  // Including it could cause loops if not handled carefully. The logic derives the target key
  // based on the scheme and *current* field key value, then updates if needed.
  }, [mapLabelSchemeId, schemes, getTargetKeysForScheme]); // Removed mapLabelFieldKey, initialMapLabelSchemeId

  // --- Effect to notify parent of label config changes (MODIFIED) ---
  useEffect(() => {
    // This effect depends on showMapLabels, mapLabelSchemeId, mapLabelFieldKey
    // If mapLabelFieldKey is briefly null during the scheme change + auto-select process,
    // this effect might call onMapLabelConfigChange(undefined) before the correct fieldKey is set.
    console.log(`[MapControls] Notifying parent effect triggered. Show: ${showMapLabels}, Scheme: ${mapLabelSchemeId}, Field: ${mapLabelFieldKey}`);

    let configToSend: { schemeId: number; fieldKey: string } | undefined = undefined;

    if (showMapLabels && mapLabelSchemeId !== null && mapLabelFieldKey !== null) {
      // ***VALIDATION STEP***: Ensure the field key is valid for the current scheme ID before notifying
      // Note: We add schemes and getTargetKeysForScheme to dependencies for this validation
      const validKeysForScheme = getTargetKeysForScheme(mapLabelSchemeId, schemes);
      const isFieldValidForScheme = validKeysForScheme.some(k => k.key === mapLabelFieldKey);

      if (isFieldValidForScheme) {
          console.log(`[MapControls] Field '${mapLabelFieldKey}' is valid for scheme ${mapLabelSchemeId}. Notifying parent.`);
          configToSend = { schemeId: mapLabelSchemeId, fieldKey: mapLabelFieldKey };
      } else {
          // This handles the case where this effect runs with the new scheme ID but the old field key.
          console.warn(`[MapControls] Field '${mapLabelFieldKey}' is NOT valid for scheme ${mapLabelSchemeId}. Notifying parent with undefined.`);
          configToSend = undefined; // Explicitly set to undefined
      }
    } else {
        console.log(`[MapControls] Conditions not met for notification (showLabels: ${showMapLabels}, schemeId: ${mapLabelSchemeId}, fieldKey: ${mapLabelFieldKey}). Notifying parent with undefined.`);
        // configToSend remains undefined
    }

    // Call the parent notification function with either the valid config or undefined
    onMapLabelConfigChange(configToSend);

  // Dependencies now include schemes/getTargetKeysForScheme for the validation step
  }, [showMapLabels, mapLabelSchemeId, mapLabelFieldKey, onMapLabelConfigChange, schemes, getTargetKeysForScheme]);

  // --- Initial Geocode Trigger ---
  useEffect(() => {
    // Reset the attempt flag if the core identifiers change
    initialGeocodeAttempted.current = false;
  }, [initialSelectedGeocodeSchemeId, initialSelectedGeocodeField]);

  useEffect(() => {
    const canGeocode =
      initialSelectedGeocodeSchemeId &&
      initialSelectedGeocodeField &&
      results.length > 0 &&
      !isLoadingGeocoding; // Still check loading state here to prevent duplicate requests if one is in flight

    // Trigger only if conditions are met AND the initial attempt hasn't been made for this config
    if (canGeocode && !initialGeocodeAttempted.current) {
      console.log("[MapControls] Triggering initial geocode with:", initialSelectedGeocodeSchemeId, initialSelectedGeocodeField);
      initialGeocodeAttempted.current = true; // Mark as attempted
      onGeocodeRequest(initialSelectedGeocodeSchemeId!, initialSelectedGeocodeField!);
    }
    // Dependencies should capture changes in the core conditions needed to *potentially* run the initial geocode
  }, [
      initialSelectedGeocodeSchemeId,
      initialSelectedGeocodeField,
      results, // Specifically results.length > 0 is the condition, but depending on `results` is safer
      isLoadingGeocoding, // Need to react if loading finishes and conditions are now met
      onGeocodeRequest // Keep the function dependency, assuming it's memoized correctly in parent
  ]);

  // --- Handlers ---
  const handleGeocodeClick = useCallback(() => {
    if (selectedGeocodeSchemeId && selectedGeocodeField) {
      onGeocodeRequest(selectedGeocodeSchemeId, selectedGeocodeField);
    }
  }, [selectedGeocodeSchemeId, selectedGeocodeField, onGeocodeRequest]);

  return (
    <div className="mb-3 p-3 rounded-md bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60 border border-border/50">
      {/* Use Grid layout for sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">

        {/* Geocoding Section */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold flex items-center text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 mr-1.5" />
            Geocoding Source
          </Label>
          <div className="flex items-end gap-2">
            {/* Geocode Scheme Select */}
            <div className="flex-1">
              <Label htmlFor="geocode-scheme-select" className="text-xs mb-1 block sr-only">Scheme</Label>
              <Select value={selectedGeocodeSchemeId ?? ""} onValueChange={setSelectedGeocodeSchemeId}>
                <SelectTrigger id="geocode-scheme-select" className="h-8 text-xs w-full" aria-label="Geocode Source Scheme">
                  <SelectValue placeholder="Select scheme..." />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="max-h-60 w-full">
                    {geocodeSchemeOptions.map(option => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>
                    ))}
                    {geocodeSchemeOptions.length === 0 &&
                      <div className="p-2 text-xs text-center italic text-muted-foreground">No schemes in run</div>}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>

            {/* Geocode Field Select */}
            <div className="flex-1">
               <Label htmlFor="geocode-field-select" className="text-xs mb-1 block sr-only">Field</Label>
               <Select
                  value={selectedGeocodeField ?? ""}
                  onValueChange={setSelectedGeocodeField}
                  disabled={!selectedGeocodeSchemeId}
               >
                  <SelectTrigger id="geocode-field-select" className="h-8 text-xs w-full" aria-label="Geocode Source Field">
                     <SelectValue placeholder="Select field..." />
                  </SelectTrigger>
                  <SelectContent>
                    <ScrollArea className="max-h-60 w-full">
                      {geocodeFieldOptions.map(option => (
                        <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>
                      ))}
                      {geocodeFieldOptions.length === 0 && selectedGeocodeSchemeId &&
                        <div className="p-2 text-xs text-center italic text-muted-foreground">No fields in scheme</div>}
                      {!selectedGeocodeSchemeId &&
                        <div className="p-2 text-xs text-center italic text-muted-foreground">Select a scheme first</div>}
                    </ScrollArea>
                  </SelectContent>
               </Select>
            </div>

             {/* Geocode Button */}
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                   <div className={cn(!selectedGeocodeSchemeId || !selectedGeocodeField || results.length === 0 ? "cursor-not-allowed" : "")}>
                     <Button
                       onClick={handleGeocodeClick}
                       disabled={!selectedGeocodeSchemeId || !selectedGeocodeField || isLoadingGeocoding || results.length === 0}
                       size="icon" // Make it an icon button
                       variant="outline"
                       className="h-8 w-8 flex-shrink-0" // Ensure it doesn't shrink/grow oddly
                       aria-label="Run Geocoding"
                     >
                       {isLoadingGeocoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                     </Button>
                   </div>
                </TooltipTrigger>
                <TooltipContent>
                   {results.length === 0
                    ? "No results available to geocode"
                    : (!selectedGeocodeSchemeId || !selectedGeocodeField
                      ? "Select a scheme and field first"
                      : isLoadingGeocoding ? "Geocoding..." : "Geocode selected locations")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Label Configuration Section */}
        <div className="space-y-1.5">
           <Label className="text-xs font-semibold flex items-center text-muted-foreground">
              <Type className="h-3.5 w-3.5 mr-1.5" /> {/* Or Tag */}
              Map Labels
           </Label>
           <div className="flex items-end gap-2">
              {/* Show Labels Switch */}
              <div className="flex flex-col items-center">
                 {/* <Label htmlFor="map-label-switch" className="text-xxs mb-1 font-medium">Show</Label> */}
                 <TooltipProvider delayDuration={100}>
                   <Tooltip>
                     <TooltipTrigger asChild>
                       <div className="h-8 flex items-center"> {/* Wrapper to align height */}
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

              {/* Label Scheme Select */}
              <div className={cn("flex-1", !showMapLabels && "opacity-50 pointer-events-none transition-opacity")}>
                 <Label htmlFor="map-label-scheme-select" className="text-xs mb-1 block sr-only">Label Scheme</Label>
                 <Select
                   value={mapLabelSchemeId?.toString() ?? ""}
                   onValueChange={(v) => setMapLabelSchemeId(v ? parseInt(v) : null)}
                   disabled={!showMapLabels || schemes.length === 0}
                 >
                   <SelectTrigger id="map-label-scheme-select" className="h-8 text-xs w-full" aria-label="Map Label Scheme">
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

              {/* Label Field Select */}
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
            {/* Helper text for invalid label selection - keep this */}
            {showMapLabels && mapLabelSchemeId !== null && currentMapLabelKeys.length === 0 && (
                <div className="text-xs text-muted-foreground italic pt-1">
                    Selected scheme has no text-based fields for labels.
                </div>
            )}
        </div>

      </div> {/* End Grid */}

      {/* Status Indicators (Remain below grid) */}
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