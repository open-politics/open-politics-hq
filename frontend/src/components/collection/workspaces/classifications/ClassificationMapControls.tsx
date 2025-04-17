'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ClassificationSchemeRead } from '@/client';
import { FormattedClassificationResult } from '@/lib/classification/types';
import { getTargetKeysForScheme } from '@/lib/classification/utils';
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, MapPin, AlertCircle, Tag } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  const [activeTab, setActiveTab] = useState<string>(initialShowMapLabels ? "labels" : "source");

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
    if (initialShowMapLabels) {
        setActiveTab("labels");
    }
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
    // Similar logic for label field based on label scheme
    if (mapLabelSchemeId !== initialMapLabelSchemeId || !initialMapLabelFieldKey) {
        setMapLabelFieldKey(mapLabelSchemeId === initialMapLabelSchemeId ? initialMapLabelFieldKey : null);
        // Auto-select first available field if scheme changes *and* there's no initial field for the new scheme
        if(mapLabelSchemeId !== initialMapLabelSchemeId && mapLabelSchemeId !== null && initialMapLabelFieldKey === null) {
            const keys = getTargetKeysForScheme(mapLabelSchemeId, schemes);
            if (keys.length > 0 && !keys.some(k => k.key === mapLabelFieldKey)) {
                setMapLabelFieldKey(keys[0].key);
            }
        }
    } else if (mapLabelSchemeId === null) {
        setMapLabelFieldKey(null); // Clear field if scheme is cleared
    }
  }, [mapLabelSchemeId, schemes, mapLabelFieldKey, initialMapLabelSchemeId, initialMapLabelFieldKey]);

  // --- Effect to notify parent of label config changes ---
  useEffect(() => {
    if (showMapLabels && mapLabelSchemeId !== null && mapLabelFieldKey !== null) {
      onMapLabelConfigChange({ schemeId: mapLabelSchemeId, fieldKey: mapLabelFieldKey });
    } else {
      onMapLabelConfigChange(undefined);
    }
  }, [showMapLabels, mapLabelSchemeId, mapLabelFieldKey, onMapLabelConfigChange]);

  // --- Initial Geocode Trigger ---
  useEffect(() => {
    // If initial props are valid and we are not currently loading, trigger geocode
    if (
      initialSelectedGeocodeSchemeId &&
      initialSelectedGeocodeField &&
      !isLoadingGeocoding &&
      results.length > 0
    ) {
      console.log("[MapControls] Triggering initial geocode with:", initialSelectedGeocodeSchemeId, initialSelectedGeocodeField);
      onGeocodeRequest(initialSelectedGeocodeSchemeId, initialSelectedGeocodeField);
    }
    // Dependencies: Run only when initial props are set/change, or results become available
  }, [initialSelectedGeocodeSchemeId, initialSelectedGeocodeField, onGeocodeRequest, results]); // Removed isLoadingGeocoding to avoid loops

  // --- Handlers ---
  const handleGeocodeClick = useCallback(() => {
    if (selectedGeocodeSchemeId && selectedGeocodeField) {
      onGeocodeRequest(selectedGeocodeSchemeId, selectedGeocodeField);
    }
  }, [selectedGeocodeSchemeId, selectedGeocodeField, onGeocodeRequest]);

  return (
    <div className="mb-2 p-2 rounded-md bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex items-center justify-between mb-2">
          <TabsList className="h-8">
            <TabsTrigger value="source" className="text-xs px-3 py-1">Data Source</TabsTrigger>
            <TabsTrigger value="labels" className="text-xs px-3 py-1">Labels</TabsTrigger>
          </TabsList>
          
          {activeTab === "labels" && (
            <div className="flex items-center gap-2">
              <Switch 
                id="map-label-switch" 
                checked={showMapLabels} 
                onCheckedChange={setShowMapLabels}
                className="h-4 w-7"
              />
              <Label htmlFor="map-label-switch" className="text-xs">Show Labels</Label>
            </div>
          )}
          
          {activeTab === "source" && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleGeocodeClick}
                    disabled={!selectedGeocodeSchemeId || !selectedGeocodeField || isLoadingGeocoding || results.length === 0}
                    size="sm"
                    className="h-8"
                  >
                    {isLoadingGeocoding ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <MapPin className="h-4 w-4 mr-1" />}
                    Geocode
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {results.length === 0 
                    ? "No results available to geocode" 
                    : (!selectedGeocodeSchemeId || !selectedGeocodeField 
                      ? "Select a scheme and field first" 
                      : "Geocode locations from selected field")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <TabsContent value="source" className="mt-0 pt-2 border-t">
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[180px]">
              <Label htmlFor="geocode-scheme-select" className="text-xs mb-1 block">Scheme</Label>
              <Select value={selectedGeocodeSchemeId ?? ""} onValueChange={setSelectedGeocodeSchemeId}>
                <SelectTrigger id="geocode-scheme-select" className="h-8 text-xs">
                  <SelectValue placeholder="Select scheme..." />
                </SelectTrigger>
                <SelectContent>
                  {geocodeSchemeOptions.map(option => (
                    <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>
                  ))}
                  {geocodeSchemeOptions.length === 0 && 
                    <div className="p-2 text-xs text-center italic text-muted-foreground">No schemes in run</div>}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex-1 min-w-[180px]">
              <Label htmlFor="geocode-field-select" className="text-xs mb-1 block">Field</Label>
              <Select 
                value={selectedGeocodeField ?? ""} 
                onValueChange={setSelectedGeocodeField}
                disabled={!selectedGeocodeSchemeId}
              >
                <SelectTrigger id="geocode-field-select" className="h-8 text-xs">
                  <SelectValue placeholder="Select field..." />
                </SelectTrigger>
                <SelectContent>
                  {geocodeFieldOptions.map(option => (
                    <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>
                  ))}
                  {geocodeFieldOptions.length === 0 && 
                    <div className="p-2 text-xs text-center italic text-muted-foreground">No fields in scheme</div>}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {isLoadingGeocoding && (
            <div className="text-xs text-muted-foreground mt-2 flex items-center">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Geocoding locations...
            </div>
          )}
          
          {geocodingError && (
            <p className="text-xs text-red-500 mt-2 flex items-center">
              <AlertCircle className="h-3 w-3 mr-1" /> {geocodingError}
            </p>
          )}
        </TabsContent>

        <TabsContent value="labels" className="mt-0 pt-2 border-t">
          {showMapLabels ? (
            <div className="flex flex-wrap gap-2">
              <div className="flex-1 min-w-[180px]">
                <Label htmlFor="map-label-scheme-select" className="text-xs mb-1 block">Scheme</Label>
                <Select value={mapLabelSchemeId?.toString() ?? ""} onValueChange={(v) => setMapLabelSchemeId(v ? parseInt(v) : null)}>
                  <SelectTrigger id="map-label-scheme-select" className="h-8 text-xs">
                    <SelectValue placeholder="Select scheme..." />
                  </SelectTrigger>
                  <SelectContent>
                    {schemes.map(s => (
                      <SelectItem key={s.id} value={s.id.toString()} className="text-xs">{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {mapLabelSchemeId !== null && currentMapLabelKeys.length > 0 && (
                <div className="flex-1 min-w-[180px]">
                  <Label htmlFor="map-label-key-select" className="text-xs mb-1 block">Field</Label>
                  <Select value={mapLabelFieldKey ?? ""} onValueChange={(v) => setMapLabelFieldKey(v || null)}>
                    <SelectTrigger id="map-label-key-select" className="h-8 text-xs">
                      <SelectValue placeholder="Select field..." />
                    </SelectTrigger>
                    <SelectContent>
                      {currentMapLabelKeys.map(tk => (
                        <SelectItem key={tk.key} value={tk.key} className="text-xs">
                          {tk.name} ({tk.type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-8 text-xs text-muted-foreground">
              <Tag className="h-3 w-3 mr-1" /> Enable labels to configure display options
            </div>
          )}
          
          {showMapLabels && mapLabelSchemeId !== null && currentMapLabelKeys.length === 0 && (
            <div className="text-xs text-muted-foreground italic mt-2">
              Selected scheme has no suitable fields for labels
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};