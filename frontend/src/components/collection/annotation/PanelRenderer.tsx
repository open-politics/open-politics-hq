import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, ChevronUp, ChevronDown, Grip, Edit, Check, XCircle, RotateCcw, Maximize2, Minimize2, Copy, Edit2, Settings, GripVertical } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormattedAnnotation, TimeAxisConfig } from '@/lib/annotations/types';
import { AnnotationSchemaRead } from '@/client';
import { FilterSet } from './AnnotationFilterControls';
import AnnotationResultsChart from './AnnotationResultsChart';
import AnnotationResultsPieChart from './AnnotationResultsPieChart';
import AnnotationResultsTable from './AnnotationResultsTable';
import AnnotationResultsMap, { MapPoint } from './AnnotationResultsMap';
import AnnotationResultsGraph from './AnnotationResultsGraph';
import { AnnotationTimeAxisControls } from './AnnotationTimeAxisControls';
import { UnifiedFilterControls } from './AnnotationFilterControls';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { PanelViewConfig, useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { nanoid } from 'nanoid';

import { AnnotationMapControls, MapControlsConfig } from './AnnotationMapControls';
import useGeocode from '@/hooks/useGeocder';
import { useGeocodingCacheStore } from '@/zustand_stores/storeGeocodingCache';
import { extractLocationString, getAnnotationFieldValue } from '@/lib/annotations/utils';
import AssetDetailProvider from '../assets/Views/AssetDetailProvider';
import { checkFilterMatch } from '@/lib/annotations/utils';
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';

// Grid constants
const GRID_COLUMNS = 12;
const MIN_WIDTH = 1;
const MIN_HEIGHT = 1;

interface PanelRendererProps {
  panel: PanelViewConfig;
  allResults: FormattedAnnotation[];
  allSchemas: AnnotationSchemaRead[];
  allSources: any[];
  allAssets: any[];
  onUpdatePanel: (panelId: string, updates: Partial<PanelViewConfig>) => void;
  onRemovePanel: (panelId: string) => void;
  onMapPointClick?: (point: MapPoint) => void;
  activeRunId?: number;
  // NEW: Result interaction callbacks
  onResultSelect?: (result: any) => void;
  onRetrySingleResult?: (resultId: number, customPrompt?: string) => Promise<any>;
  retryingResultId?: number | null;
  // NEW: Field interaction callback for enhanced dialog
  onFieldInteraction?: (result: FormattedAnnotation, fieldKey: string) => void;
}

export const PanelRenderer: React.FC<PanelRendererProps> = ({ 
  panel, 
  allResults, 
  allSchemas,
  allSources,
  allAssets,
  onUpdatePanel,
  onRemovePanel,
  onMapPointClick,
  activeRunId,
  // NEW: Result interaction callbacks
  onResultSelect,
  onRetrySingleResult,
  retryingResultId,
  // NEW: Field interaction callback for enhanced dialog
  onFieldInteraction,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editingName, setEditingName] = useState(panel.name);
  const [editingDescription, setEditingDescription] = useState(panel.description || '');
  const [showLayoutControls, setShowLayoutControls] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPosition, setDragStartPosition] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragOverZone, setDragOverZone] = useState<'left' | 'right' | 'top' | 'bottom' | 'center' | null>(null);
  
  // Geocoding state
  const [geocodedPoints, setGeocodedPoints] = useState<MapPoint[]>([]);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodingError, setGeocodingError] = useState<string | null>(null);
  const { geocodeLocation } = useGeocode();
  const { getCache, setCache } = useGeocodingCacheStore();
  
  // Get run-wide global variable splitting settings from Zustand store
  const { getGlobalVariableSplitting } = useAnnotationRunStore();
  const globalVariableSplitting = getGlobalVariableSplitting();
  
  // Convert to component format if exists - MEMOIZED to prevent constant re-rendering
  const globalVariableSplittingConfig = useMemo(() => {
    if (!globalVariableSplitting) return null;
    
    return {
      enabled: globalVariableSplitting.enabled,
      schemaId: globalVariableSplitting.schemaId,
      fieldKey: globalVariableSplitting.fieldKey,
      visibleSplits: globalVariableSplitting.visibleSplits ? new Set(globalVariableSplitting.visibleSplits) : undefined,
      maxSplits: globalVariableSplitting.maxSplits,
      groupOthers: globalVariableSplitting.groupOthers,
      valueAliases: globalVariableSplitting.valueAliases || {}
    };
  }, [
    globalVariableSplitting?.enabled,
    globalVariableSplitting?.schemaId,
    globalVariableSplitting?.fieldKey,
    globalVariableSplitting?.maxSplits,
    globalVariableSplitting?.groupOthers,
    JSON.stringify(globalVariableSplitting?.visibleSplits), // Use JSON.stringify for array comparison
    JSON.stringify(globalVariableSplitting?.valueAliases)   // Use JSON.stringify for object comparison
  ]);
  

  
  // Get collapsed state from panel config, default to false
  const isCollapsed = panel.collapsed || false;

  const handleToggleCollapse = () => {
    onUpdatePanel(panel.id, { collapsed: !isCollapsed });
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    setDragStartPosition({ 
      x: panel.gridPos.x, 
      y: panel.gridPos.y,
      w: panel.gridPos.w,
      h: panel.gridPos.h
    });
    
    // Store panel information in dataTransfer for access by drop target
    const dragData = {
      panelId: panel.id,
      gridPos: panel.gridPos
    };
    
    e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'move';
    
    // Create a custom drag image
    const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
    dragImage.style.transform = 'rotate(3deg)';
    dragImage.style.opacity = '0.8';
    e.dataTransfer.setDragImage(dragImage, 50, 20);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragStartPosition(null);
    setDragOverZone(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Calculate drag over zone for visual feedback
    const rect = e.currentTarget.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropY = e.clientY - rect.top;
    const relativeX = dropX / rect.width;
    const relativeY = dropY / rect.height;
    
    let zone: 'left' | 'right' | 'top' | 'bottom' | 'center' = 'center';
    
    if (relativeX > 0.6) zone = 'right';
    else if (relativeX < 0.4) zone = 'left';
    else if (relativeY > 0.6) zone = 'bottom';
    else if (relativeY < 0.4) zone = 'top';
    
    setDragOverZone(zone);
  };

  const handleDragLeave = () => {
    setDragOverZone(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dragDataStr = e.dataTransfer.getData('text/plain');
    
    try {
      const dragData = JSON.parse(dragDataStr);
      const draggedPanelId = dragData.panelId;
      const draggedPanelGridPos = dragData.gridPos;
      
      if (draggedPanelId && draggedPanelId !== panel.id && draggedPanelGridPos) {
        const targetPos = { x: panel.gridPos.x, y: panel.gridPos.y };
        
        // Get the bounds of the drop target
        const rect = e.currentTarget.getBoundingClientRect();
        const dropX = e.clientX - rect.left;
        const dropY = e.clientY - rect.top;
        const relativeX = dropX / rect.width;
        const relativeY = dropY / rect.height;
        
        // Determine if we should place side-by-side or swap
        const targetPanel = panel;
        const targetWidth = targetPanel.gridPos.w;
        const targetHeight = targetPanel.gridPos.h;
        
        let newPosition = { x: targetPos.x, y: targetPos.y };
        let shouldSwap = false;
        
        // If dropping on the right half, try to place to the right
        if (relativeX > 0.6 && targetPos.x + targetWidth < 12) {
          const spaceToRight = 12 - (targetPos.x + targetWidth);
          if (spaceToRight >= Math.min(draggedPanelGridPos.w, 3)) { // Use dragged panel's width or minimum
            newPosition = {
              x: targetPos.x + targetWidth,
              y: targetPos.y
            };
          } else {
            shouldSwap = true;
          }
        }
        // If dropping on the left half, try to place to the left  
        else if (relativeX < 0.4 && targetPos.x >= Math.min(draggedPanelGridPos.w, 3)) {
          newPosition = {
            x: Math.max(0, targetPos.x - draggedPanelGridPos.w),
            y: targetPos.y
          };
        }
        // If dropping on the bottom half, try to place below
        else if (relativeY > 0.6) {
          newPosition = {
            x: targetPos.x,
            y: targetPos.y + targetHeight
          };
        }
        // If dropping on the top half, try to place above
        else if (relativeY < 0.4) {
          newPosition = {
            x: targetPos.x,
            y: Math.max(0, targetPos.y - draggedPanelGridPos.h)
          };
        }
        // Otherwise, swap positions (default behavior)
        else {
          shouldSwap = true;
        }
        
        if (shouldSwap) {
          newPosition = targetPos;
          // Move the target panel to where the dragged panel was
          onUpdatePanel(panel.id, {
            gridPos: {
              ...panel.gridPos,
              x: draggedPanelGridPos.x,
              y: draggedPanelGridPos.y,
            }
          });
        }
        
        // Update the dragged panel's position (keep its original size)
        onUpdatePanel(draggedPanelId, {
          gridPos: {
            x: newPosition.x,
            y: newPosition.y,
            w: draggedPanelGridPos.w, // Keep original width
            h: draggedPanelGridPos.h, // Keep original height
          }
        });
      }
    } catch (error) {
      console.warn('Failed to parse drag data:', error);
    }
  };

  // Calculate filtered results based on panel's filter configuration
  const filteredResults = useMemo(() => {
    const filterSet = panel.filters || { logic: 'and', rules: [] };
    const activeRules = filterSet.rules.filter(r => r.isActive);

    if (activeRules.length === 0) return allResults;
    
    const resultsByAssetId = allResults.reduce<Record<number, FormattedAnnotation[]>>((acc, result) => {
        const assetId = result.asset_id;
        if (!acc[assetId]) acc[assetId] = [];
        acc[assetId].push(result);
        return acc;
    }, {});

    const filteredAssetIds = Object.keys(resultsByAssetId)
        .map(Number)
        .filter(assetId => {
          const assetResults = resultsByAssetId[assetId];
          if (filterSet.logic === 'and') {
            return activeRules.every(filter => checkFilterMatch(filter, assetResults, allSchemas));
          } else {
            return activeRules.some(filter => checkFilterMatch(filter, assetResults, allSchemas));
          }
        });

    return allResults.filter(result => filteredAssetIds.includes(result.asset_id));
  }, [allResults, panel.filters, allSchemas]);

  const handleFilterChange = (newFilterSet: FilterSet) => {
    onUpdatePanel(panel.id, { filters: newFilterSet });
  };

  const handleSaveName = () => {
    const trimmedName = editingName.trim();
    if (!trimmedName) {
      toast.error('Panel name cannot be empty');
      setEditingName(panel.name);
      return;
    }
    onUpdatePanel(panel.id, { name: trimmedName });
    setIsEditingName(false);
    toast.success('Panel name updated');
  };

  const handleSaveDescription = () => {
    onUpdatePanel(panel.id, { description: editingDescription.trim() || undefined });
    setIsEditingDescription(false);
    toast.success('Panel description updated');
  };

  const handleCancelNameEdit = () => {
    setEditingName(panel.name);
    setIsEditingName(false);
  };

  const handleCancelDescriptionEdit = () => {
    setEditingDescription(panel.description || '');
    setIsEditingDescription(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelNameEdit();
    }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSaveDescription();
    } else if (e.key === 'Escape') {
      handleCancelDescriptionEdit();
    }
  };

  // Panel resize and positioning handlers with safety checks
  const handleWidthChange = (newWidth: number) => {
    try {
      const clampedWidth = Math.max(MIN_WIDTH, Math.min(GRID_COLUMNS, newWidth));
      const currentGridPos = panel.gridPos || { x: 0, y: 0, w: 6, h: 4 };
      
      onUpdatePanel(panel.id, { 
        gridPos: { 
          ...currentGridPos,
          w: clampedWidth 
        } 
      });
    } catch (error) {
      console.warn('Error updating panel width:', error);
    }
  };

  const handleHeightChange = (newHeight: number) => {
    try {
      const clampedHeight = Math.max(MIN_HEIGHT, newHeight);
      const currentGridPos = panel.gridPos || { x: 0, y: 0, w: 6, h: 4 };
      
      onUpdatePanel(panel.id, { 
        gridPos: { 
          ...currentGridPos,
          h: clampedHeight 
        } 
      });
    } catch (error) {
      console.warn('Error updating panel height:', error);
    }
  };

  const handleQuickSize = (size: 'small' | 'medium' | 'large' | 'full') => {
    const sizeMap = {
      small: { w: 4, h: 3 },
      medium: { w: 6, h: 4 },
      large: { w: 8, h: 5 },
      full: { w: 12, h: 6 }
    };
    
    const newSize = sizeMap[size];
    onUpdatePanel(panel.id, { 
      gridPos: { ...panel.gridPos, ...newSize } 
    });
    toast.success(`Panel resized to ${size}`);
  };

  const handleResetLayout = () => {
    onUpdatePanel(panel.id, { 
      gridPos: { x: 0, y: 0, w: 12, h: 4 } 
    });
    toast.success('Panel layout reset');
  };
  
  const handlePanelSettingsUpdate = useCallback((newSettings: Partial<PanelViewConfig['settings']>) => {
    if (!newSettings || typeof newSettings !== 'object') {
      console.warn('Invalid settings provided to handlePanelSettingsUpdate');
      return;
    }
    
    // Simply update the panel settings - keeping this function for compatibility
    const currentSettings = panel.settings || {};
    const updatedSettings = {
      ...currentSettings,
      ...newSettings
    };
    
    onUpdatePanel(panel.id, {
      settings: updatedSettings
    });
  }, [panel.id, panel.settings, onUpdatePanel]);

  // =============================================================================
  // GEOCODING CACHE SHARING SYSTEM - COMPLETE ROUND-TRIP SUPPORT
  // =============================================================================
  // 
  // This system enables full round-trip sharing of geocoded map points across users:
  //
  // 1. STABLE CACHE KEYS: Uses schema+field-based keys (not panel IDs) for consistency
  // 2. SCHEMA ID REMAPPING: Automatically handles schema ID changes during import
  // 3. FALLBACK MECHANISMS: Multiple cache lookup strategies for maximum compatibility
  // 4. ERROR HANDLING: Graceful handling of geocoding failures with helpful messages
  // 5. SHARED CONFIGURATION: Geocoded points stored in panel settings for sharing
  //
  // TROUBLESHOOTING:
  // - Check console for "[Geocoding]" and "[Geocoding Cache]" logs
  // - Verify annotation results exist for the selected schema
  // - Check that location field contains valid geographic data
  // - Generic locations like "EU" may fail geocoding - use specific cities/countries
  // - Cache misses are normal on first load - points will regenerate
  // =============================================================================

  // Generate cache key for geocoded results (stable across imports)
  const generateGeocodeKey = useCallback(() => {
    const geocodeSource = panel.settings?.geocodeSource;
    if (!geocodeSource) return null;
    
    const relevantResults = filteredResults.filter(r => r.schema_id === geocodeSource.schemaId);
    
    console.log(`[Geocoding Debug] Schema ID: ${geocodeSource.schemaId}, Field: ${geocodeSource.fieldKey}`);
    console.log(`[Geocoding Debug] Relevant results count: ${relevantResults.length}`);
    
    if (relevantResults.length > 0) {
      console.log(`[Geocoding Debug] Sample result values:`, relevantResults.slice(0, 2).map(r => ({
        asset_id: r.asset_id,
        value: r.value,
        valueKeys: Object.keys(r.value || {})
      })));
    }
    
    const locationStrings = relevantResults
      .map(r => {
        const fieldValue = getAnnotationFieldValue(r.value, geocodeSource.fieldKey);
        console.log(`[Geocoding Debug] Asset ${r.asset_id} field value for "${geocodeSource.fieldKey}":`, fieldValue);
        
        const locationString = extractLocationString(fieldValue, geocodeSource.fieldKey);
        console.log(`[Geocoding Debug] Asset ${r.asset_id} extracted location:`, locationString);
        
        return locationString;
      })
      .filter(Boolean)
      .sort();
    
    console.log(`[Geocoding Debug] Final location strings:`, locationStrings);
    
    // Use a stable key based on schema and field, not panel ID (which changes on import)
    return `geocode_${geocodeSource.schemaId}_${geocodeSource.fieldKey}_${JSON.stringify(locationStrings)}`;
  }, [panel.settings?.geocodeSource, filteredResults]);

  // Generate a simpler cache key that doesn't depend on location strings (for fallback)
  const generateSimpleGeocodeKey = useCallback(() => {
    const geocodeSource = panel.settings?.geocodeSource;
    if (!geocodeSource) return null;
    
    return `geocode_${geocodeSource.schemaId}_${geocodeSource.fieldKey}`;
  }, [panel.settings?.geocodeSource]);

  // Load cached geocoded points when panel settings change
  useEffect(() => {
    const cacheKey = generateGeocodeKey();
    
    // Debug schema and geocode source configuration
    const geocodeSource = panel.settings?.geocodeSource;
    if (geocodeSource) {
      console.log(`[Geocoding Debug] Geocode source config:`, geocodeSource);
      console.log(`[Geocoding Debug] Available schemas:`, allSchemas.map(s => ({ id: s.id, name: s.name })));
      console.log(`[Geocoding Debug] Available results schemas:`, [...new Set(filteredResults.map(r => r.schema_id))]);
      
      const targetSchema = allSchemas.find(s => s.id === geocodeSource.schemaId);
      if (!targetSchema) {
        console.log(`[Geocoding Debug] ⚠️ Target schema ${geocodeSource.schemaId} not found in available schemas!`);
        
        // Try to find a schema with the same name
        const schemaByName = allSchemas.find(s => 
          s.name.toLowerCase().includes('speech') || // Assuming this might be the Speech Analyser schema
          s.name.toLowerCase() === geocodeSource.schemaId.toString()
        );
        if (schemaByName) {
          console.log(`[Geocoding Debug] 💡 Found potential matching schema by name: ${schemaByName.name} (ID: ${schemaByName.id})`);
        }
        
        // Auto-remap schema ID if we found a matching schema by name
        if (schemaByName && schemaByName.id !== geocodeSource.schemaId) {
          console.log(`[Geocoding Debug] 🔄 Auto-remapping schema ID ${geocodeSource.schemaId} -> ${schemaByName.id}`);
          
          // Update the panel settings with the correct schema ID
          const updatedGeocodeSource = {
            ...geocodeSource,
            schemaId: schemaByName.id
          };
          
          // Update panel settings (but don't trigger infinite loops)
          queueMicrotask(() => {
            onUpdatePanel(panel.id, {
              settings: {
                ...(panel.settings || {}),
                geocodeSource: updatedGeocodeSource
              }
            });
          });
          
          return; // Exit early, let the effect re-run with correct schema ID
        }
      } else {
        console.log(`[Geocoding Debug] ✓ Found target schema: ${targetSchema.name}`);
      }
    }
    
    if (cacheKey) {
      console.log(`[Geocoding Cache] Looking for cache key: ${cacheKey}`);
      
      // First try to load from panel settings cache
      const panelCache = panel.settings?.geocodedPointsCache;
      
      if (panelCache && panelCache.cacheKey === cacheKey) {
        const cacheAge = Date.now() - panelCache.timestamp;
        const cacheExpiry = 60 * 60 * 1000; // 1 hour
        
        if (cacheAge < cacheExpiry) {
          console.log(`[Geocoding Cache] ✓ Loaded ${panelCache.points.length} geocoded points from shared config`);
          
          // Check if asset IDs need remapping (for shared/imported runs)
          const remappedPoints = remapAssetIdsInGeocodedPoints(panelCache.points, filteredResults, allAssets);
          setGeocodedPoints(remappedPoints);
          setGeocodingError(null);
          return;
        } else {
          console.log(`[Geocoding Cache] Cache expired (${Math.round(cacheAge / 60000)} minutes old)`);
        }
      }
      
      // Fallback to old cache store (for backward compatibility)
      const cachedPoints = getCache(cacheKey);
      
      if (cachedPoints && cachedPoints.length > 0) {
        console.log(`[Geocoding Cache] ✓ Loaded ${cachedPoints.length} geocoded points from local cache`);
        
        // Check if asset IDs need remapping (for shared/imported runs)
        const remappedPoints = remapAssetIdsInGeocodedPoints(cachedPoints, filteredResults, allAssets);
        setGeocodedPoints(remappedPoints);
        setGeocodingError(null);
        
        // Only migrate if we don't already have a matching cache entry
        const currentPanelCache = panel.settings?.geocodedPointsCache;
        if (!currentPanelCache || currentPanelCache.cacheKey !== cacheKey) {
          // Migrate to panel settings (debounced to avoid infinite loops)
          queueMicrotask(() => {
            onUpdatePanel(panel.id, {
              settings: {
                ...panel.settings,
                geocodedPointsCache: {
                  cacheKey,
                  points: remappedPoints,
                  timestamp: Date.now(),
                }
              }
            });
          });
        }
      } else {
        // Try to find cached points with the same field configuration (for shared views)
        const panelCache = panel.settings?.geocodedPointsCache;
        if (panelCache && panelCache.points && panelCache.points.length > 0) {
          const simpleKey = generateSimpleGeocodeKey();
          
          console.log(`[Geocoding Cache] Checking for similar cache configuration...`);
          console.log(`[Geocoding Cache] Panel cache key: ${panelCache.cacheKey}`);
          console.log(`[Geocoding Cache] Simple key pattern: ${simpleKey}`);
          
          // Check if the cache key matches the simple key pattern (schema + field)
          if (panelCache.cacheKey && simpleKey) {
            const cacheKeyParts = panelCache.cacheKey.split('_');
            const simpleKeyParts = simpleKey.split('_');
            
            // Compare schema ID and field key parts
            if (cacheKeyParts.length >= 3 && simpleKeyParts.length >= 3 &&
                cacheKeyParts[1] === simpleKeyParts[1] && // schema ID
                cacheKeyParts[2] === simpleKeyParts[2]) { // field key
              console.log(`[Geocoding Cache] ✓ Using ${panelCache.points.length} cached points from similar configuration`);
              
              // Check if asset IDs need remapping (for shared/imported runs)
              const remappedPoints = remapAssetIdsInGeocodedPoints(panelCache.points, filteredResults, allAssets);
              setGeocodedPoints(remappedPoints);
              setGeocodingError(null);
              return;
            } else {
              console.log(`[Geocoding Cache] Cache key mismatch - schema or field different`);
            }
          }
        }
        
        console.log(`[Geocoding Cache] No cached points found for current configuration`);
        setGeocodedPoints([]);
      }
    } else {
      console.log(`[Geocoding Cache] No geocode source configured`);
      setGeocodedPoints([]);
    }
  }, [generateGeocodeKey, generateSimpleGeocodeKey, getCache, panel.settings?.geocodedPointsCache?.cacheKey, panel.id, onUpdatePanel, filteredResults, allAssets]);

  // Function to remap asset IDs in geocoded points when they don't match current results
  const remapAssetIdsInGeocodedPoints = useCallback((
    cachedPoints: MapPoint[], 
    currentResults: FormattedAnnotation[], 
    currentAssets: any[]
  ): MapPoint[] => {
    if (!cachedPoints.length || !currentResults.length) {
      return cachedPoints;
    }

    // Check if any of the asset IDs in cached points exist in current results
    const currentAssetIds = new Set(currentResults.map(r => r.asset_id));
    const cachedAssetIds = new Set(cachedPoints.flatMap(p => p.documentIds));
    
    const hasMatchingIds = Array.from(cachedAssetIds).some(id => currentAssetIds.has(id));
    
    if (hasMatchingIds) {
      // Asset IDs match, no remapping needed
      console.log(`[Geocoding Cache] Asset IDs match current results, no remapping needed`);
      return cachedPoints;
    }

    console.log(`[Geocoding Cache] Asset IDs don't match current results, attempting to remap...`);
    
    // Create mapping from old assets to new assets based on title and uuid
    const assetMapping = new Map<number, number>();
    
    // Get asset information from current annotations
    const currentAssetsInfo = new Map<number, { title: string; uuid?: string }>();
    currentResults.forEach(result => {
      if (result.asset) {
        currentAssetsInfo.set(result.asset_id, {
          title: result.asset.title || 'Unknown Asset',
          uuid: (result.asset as any).uuid || undefined
        });
      }
    });

    // Try to map cached asset IDs to current asset IDs
    cachedPoints.forEach(point => {
      point.documentIds.forEach(oldId => {
        if (!assetMapping.has(oldId)) {
          // Find a matching asset by looking for one with same location annotation value
          const geocodeSource = panel.settings?.geocodeSource;
          if (geocodeSource) {
            // Find current results with the same location string as this point
            const matchingResults = currentResults.filter(result => {
              if (result.schema_id !== geocodeSource.schemaId) return false;
              
              const fieldValue = getAnnotationFieldValue(result.value, geocodeSource.fieldKey);
              const locationString = extractLocationString(fieldValue, geocodeSource.fieldKey);
              
              return locationString && locationString.trim().toLowerCase() === point.locationString.trim().toLowerCase();
            });
            
            if (matchingResults.length > 0) {
              // Map to the first matching result's asset ID
              assetMapping.set(oldId, matchingResults[0].asset_id);
              console.log(`[Geocoding Cache] Mapped asset ${oldId} -> ${matchingResults[0].asset_id} via location "${point.locationString}"`);
            }
          }
        }
      });
    });

    // Apply the mapping to create new points
    const remappedPoints = cachedPoints.map(point => ({
      ...point,
      documentIds: point.documentIds
        .map(oldId => assetMapping.get(oldId) || oldId)
        .filter(newId => currentAssetIds.has(newId)) // Only keep asset IDs that exist in current results
    })).filter(point => point.documentIds.length > 0); // Remove points with no valid assets

    const originalCount = cachedPoints.reduce((sum, p) => sum + p.documentIds.length, 0);
    const remappedCount = remappedPoints.reduce((sum, p) => sum + p.documentIds.length, 0);
    
    console.log(`[Geocoding Cache] Remapped ${assetMapping.size} assets: ${originalCount} -> ${remappedCount} total references`);
    
    return remappedPoints;
  }, [panel.settings?.geocodeSource]);

  // Geocoding function implementation
  const handleGeocodeRequest = useCallback(async () => {
    const geocodeSource = panel.settings?.geocodeSource;
    if (!geocodeSource) {
      console.log('[Geocoding] No geocode source configured');
      toast.error('Please select a geocoding source first');
      return;
    }

    console.log(`[Geocoding] Starting geocode for schema ${geocodeSource.schemaId}, field "${geocodeSource.fieldKey}"`);
    setIsGeocoding(true);
    setGeocodingError(null);

    try {
      // Filter results for the selected schema
      const relevantResults = filteredResults.filter(r => r.schema_id === geocodeSource.schemaId);
      
      if (relevantResults.length === 0) {
        console.log(`[Geocoding] ✗ No annotation results found for schema ${geocodeSource.schemaId}`);
        toast.warning('No annotation results found for the selected schema');
        setIsGeocoding(false);
        return;
      }

      // Extract unique location strings from annotation results
      const locationMap = new Map<string, number[]>(); // location -> asset IDs
      
      relevantResults.forEach(result => {
        const locationValue = getAnnotationFieldValue(result.value, geocodeSource.fieldKey);
        const locationString = extractLocationString(locationValue, geocodeSource.fieldKey);
        
        if (locationString) {
          const normalizedLocation = locationString.trim().toLowerCase();
          if (!locationMap.has(normalizedLocation)) {
            locationMap.set(normalizedLocation, []);
          }
          locationMap.get(normalizedLocation)!.push(result.asset_id);
        }
      });

      if (locationMap.size === 0) {
        console.log(`[Geocoding] ✗ No location data found in field "${geocodeSource.fieldKey}" across ${relevantResults.length} results`);
        
        // Help users debug by suggesting available fields
        if (relevantResults.length > 0) {
          const sampleResult = relevantResults[0];
          if (sampleResult.value && typeof sampleResult.value === 'object') {
            const availableFields = Object.keys(sampleResult.value);
            
            // Look for fields that might contain location data
            const potentialLocationFields = availableFields.filter(field => 
              field.toLowerCase().includes('location') || 
              field.toLowerCase().includes('address') || 
              field.toLowerCase().includes('place') || 
              field.toLowerCase().includes('city') || 
              field.toLowerCase().includes('country')
            );
            
            if (potentialLocationFields.length > 0) {
              console.log('[Geocoding] Potential location fields found:', potentialLocationFields);
              toast.error(`No location data found in field "${geocodeSource.fieldKey}". Try these fields instead: ${potentialLocationFields.join(', ')}`);
            } else {
              toast.warning(`No valid location strings found in field "${geocodeSource.fieldKey}". Check your schema configuration.`);
            }
          }
        } else {
          toast.warning('No valid location strings found in the annotation results');
        }
        
        setIsGeocoding(false);
        return;
      }
      
      console.log(`[Geocoding] ✓ Found ${locationMap.size} unique locations from ${relevantResults.length} results`);

      // Geocode each unique location
      const newPoints: MapPoint[] = [];
      let successCount = 0;
      let errorCount = 0;
      const failedLocations: string[] = [];

      for (const [locationString, assetIds] of locationMap.entries()) {
        try {
          const geocodeResult = await geocodeLocation(locationString);
          
          if (geocodeResult && geocodeResult.latitude && geocodeResult.longitude) {
            newPoints.push({
              id: `${panel.id}_${locationString}`,
              locationString,
              coordinates: {
                latitude: geocodeResult.latitude,
                longitude: geocodeResult.longitude,
              },
              documentIds: assetIds,
              bbox: geocodeResult.bbox,
              type: geocodeResult.type,
            });
            successCount++;
          } else {
            console.warn(`[Geocoding] ✗ Failed to geocode location: "${locationString}"`);
            failedLocations.push(locationString);
            errorCount++;
          }
        } catch (error) {
          console.error(`[Geocoding] ✗ Error geocoding location "${locationString}":`, error);
          failedLocations.push(locationString);
          errorCount++;
        }
      }

      // Update state and cache
      setGeocodedPoints(newPoints);
      
      // Cache the results in panel settings
      const cacheKey = generateGeocodeKey();
      
      if (cacheKey) {
        // Save to panel settings for sharing
        const cacheEntry = {
          cacheKey,
          points: newPoints,
          timestamp: Date.now(),
        };
        
        onUpdatePanel(panel.id, {
          settings: {
            ...panel.settings,
            geocodedPointsCache: cacheEntry
          }
        });
        
        // Also save to local cache store for backward compatibility
        setCache(cacheKey, newPoints);
        
        console.log(`[Geocoding Cache] ✓ Cached ${newPoints.length} geocoded points for sharing`);
      }

      // Show result toast
      if (successCount > 0) {
        const message = `Successfully geocoded ${successCount} location${successCount === 1 ? '' : 's'}${errorCount > 0 ? ` (${errorCount} failed)` : ''}`;
        toast.success(message);
        console.log(`[Geocoding] ✓ ${message}`);
        
        if (errorCount > 0) {
          console.log(`[Geocoding] Failed locations: ${failedLocations.join(', ')}`);
        }
      } else {
        const message = `Failed to geocode any locations: ${failedLocations.join(', ')}`;
        toast.error(message);
        setGeocodingError(message);
        console.log(`[Geocoding] ✗ ${message}`);
      }

    } catch (error) {
      console.error('Geocoding error:', error);
      setGeocodingError('An error occurred during geocoding');
      toast.error('An error occurred during geocoding');
    } finally {
      setIsGeocoding(false);
    }
  }, [panel.settings?.geocodeSource, filteredResults, geocodeLocation, generateGeocodeKey, setCache, panel.id]);

  // Auto-remap schema IDs in panel settings for imported runs
  useEffect(() => {
    let needsUpdate = false;
    const updatedSettings = { ...panel.settings };

    // Handle pie chart schema remapping
    if (panel.type === 'pie' && panel.settings?.selectedSchemaId) {
      const originalSchemaId = panel.settings.selectedSchemaId;
      const targetSchema = allSchemas.find(s => s.id === originalSchemaId);
      
      if (!targetSchema) {
        console.log(`[Panel Settings] Pie chart panel "${panel.name}" (${panel.id}) references non-existent schema ${originalSchemaId}`);
        
        // Try to find a schema with similar characteristics
        const schemaByName = allSchemas.find(s => {
          // Check if any schema name matches what we might expect
          return s.name.toLowerCase().includes('speech') || 
                 s.name.toLowerCase().includes('location') ||
                 s.name.toLowerCase().includes('sentiment') ||
                 s.name.toLowerCase().includes('analyser') ||
                 allSchemas.length === 1; // If only one schema, use it
        });
        
        if (schemaByName) {
          console.log(`[Panel Settings] Auto-remapping pie chart schema ID ${originalSchemaId} -> ${schemaByName.id} (${schemaByName.name}) for panel ${panel.id}`);
          updatedSettings.selectedSchemaId = schemaByName.id;
          // Reset field selection since schema changed
          updatedSettings.selectedFieldKey = undefined;
          needsUpdate = true;
        } else if (allSchemas.length > 0) {
          console.log(`[Panel Settings] Using fallback schema ${allSchemas[0].id} (${allSchemas[0].name}) for pie chart panel ${panel.id}`);
          updatedSettings.selectedSchemaId = allSchemas[0].id;
          updatedSettings.selectedFieldKey = undefined;
          needsUpdate = true;
        }
      }
    }

    // Handle map panel schema remapping (geocodeSource and labelSource)
    if (panel.type === 'map' && panel.settings) {
      // Check geocodeSource schema ID
      if (panel.settings.geocodeSource?.schemaId) {
        const originalSchemaId = panel.settings.geocodeSource.schemaId;
        const targetSchema = allSchemas.find(s => s.id === originalSchemaId);
        
        if (!targetSchema) {
          console.log(`[Panel Settings] Map panel "${panel.name}" (${panel.id}) geocodeSource references non-existent schema ${originalSchemaId}`);
          
          const schemaByName = allSchemas.find(s => 
            s.name.toLowerCase().includes('speech') || 
            s.name.toLowerCase().includes('location') ||
            allSchemas.length === 1
          );
          
          if (schemaByName) {
            console.log(`[Panel Settings] Auto-remapping map geocodeSource schema ID ${originalSchemaId} -> ${schemaByName.id} for panel ${panel.id}`);
            updatedSettings.geocodeSource = {
              ...panel.settings.geocodeSource,
              schemaId: schemaByName.id
            };
            needsUpdate = true;
          }
        }
      }
      
      // Check labelSource schema ID
      if (panel.settings.labelSource?.schemaId) {
        const originalSchemaId = panel.settings.labelSource.schemaId;
        const targetSchema = allSchemas.find(s => s.id === originalSchemaId);
        
        if (!targetSchema) {
          console.log(`[Panel Settings] Map panel "${panel.name}" (${panel.id}) labelSource references non-existent schema ${originalSchemaId}`);
          
          const schemaByName = allSchemas.find(s => 
            s.name.toLowerCase().includes('speech') || 
            s.name.toLowerCase().includes('location') ||
            allSchemas.length === 1
          );
          
          if (schemaByName) {
            console.log(`[Panel Settings] Auto-remapping map labelSource schema ID ${originalSchemaId} -> ${schemaByName.id} for panel ${panel.id}`);
            updatedSettings.labelSource = {
              ...panel.settings.labelSource,
              schemaId: schemaByName.id
            };
            needsUpdate = true;
          }
        }
      }
    }

    // Apply updates if needed
    if (needsUpdate) {
      console.log(`[Panel Settings] Updating panel ${panel.id} with remapped schema IDs`);
      queueMicrotask(() => {
        onUpdatePanel(panel.id, { settings: updatedSettings });
      });
    }
  }, [panel.type, panel.id, panel.name, panel.settings?.selectedSchemaId, panel.settings?.geocodeSource?.schemaId, panel.settings?.labelSource?.schemaId, allSchemas, onUpdatePanel]);

  const renderPanelContent = () => {
    switch(panel.type) {
      case 'table':
        return (
          <div className="h-full flex flex-col overflow-y-auto">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AssetDetailProvider>
                <AnnotationResultsTable 
                  results={filteredResults as any} 
                  schemas={allSchemas} 
                  sources={allSources} 
                  assets={allAssets} 
                  onResultSelect={onResultSelect} 
                  onRetrySingleResult={onRetrySingleResult}
                  retryingResultId={retryingResultId}
                  excludedRecordIds={new Set()} 
                  onToggleRecordExclusion={() => {}} 
                  initialTableConfig={{
                    ...panel.settings?.tableConfig,
                    selectedFieldsPerScheme: panel.settings?.selectedFieldsPerScheme
                  }}
                  onTableConfigChange={(config) => {
                    // Separate selectedFieldsPerScheme from tableConfig to avoid duplication
                    const { selectedFieldsPerScheme, ...tableConfigOnly } = config;
                    onUpdatePanel(panel.id, {
                      settings: {
                        ...panel.settings,
                        tableConfig: tableConfigOnly,
                        selectedFieldsPerScheme: selectedFieldsPerScheme,
                      }
                    });
                  }}
                  // NEW: Time frame filtering and variable splitting
                  timeAxisConfig={panel.settings?.timeAxisConfig || null}
                  variableSplittingConfig={globalVariableSplittingConfig} // Use global settings
                />
              </AssetDetailProvider>
            </div>
          </div>
        );
      
      case 'chart':
        return (
          <div className="h-full flex flex-col overflow-y-auto">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AssetDetailProvider>
                <AnnotationResultsChart
                  results={filteredResults}
                  schemas={allSchemas}
                  assets={allAssets}
                  sources={allSources}
                  timeAxisConfig={panel.settings?.timeAxisConfig || null}
                  selectedTimeInterval={panel.settings?.selectedTimeInterval as any || "day"}
                  aggregateSourcesDefault={panel.settings?.aggregateSources ?? true}
                  selectedDataSourceIds={panel.settings?.selectedSourceIds || allSources.map(s => s.id)}
                  showControls={!isCollapsed}
                  // NEW: Variable splitting
                  variableSplittingConfig={globalVariableSplittingConfig} // Use global settings
                  // NEW: Fix interval handling
                  onSettingsChange={handlePanelSettingsUpdate}
                  initialSettings={panel.settings}
                  // NEW: Result selection callback
                  onResultSelect={onResultSelect}
                  onFieldInteraction={onFieldInteraction}
                />
              </AssetDetailProvider>
            </div>
          </div>
        );
      
      case 'pie':
        return (
          <div className="h-full flex flex-col space-y-2 overflow-y-auto">
            {!isCollapsed && (
              <div className="flex-shrink-0">
                {/* Removed embedded VariableSplittingControls */}
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AssetDetailProvider>
                <AnnotationResultsPieChart
                results={filteredResults}
                schemas={allSchemas}
                assets={allAssets}
                sources={allSources}
                selectedSourceIds={panel.settings?.selectedSourceIds || allSources.map(s => s.id)}
                aggregateSourcesDefault={panel.settings?.aggregateSources ?? true}
                onSettingsChange={handlePanelSettingsUpdate}
                initialSettings={panel.settings}
                showControls={!isCollapsed}
                // NEW: Time frame filtering and variable splitting
                timeAxisConfig={panel.settings?.timeAxisConfig || null}
                variableSplittingConfig={globalVariableSplittingConfig} // Use global settings
                // NEW: Result selection callback
                onResultSelect={onResultSelect}
                onFieldInteraction={onFieldInteraction}
                />
              </AssetDetailProvider>
            </div>
          </div>
        );
      
      case 'map':
        return (
          <div className="h-full flex flex-col space-y-2 overflow-y-auto">
            {!isCollapsed && (
              <div className="flex-shrink-0 space-y-2">
                <AnnotationMapControls
                  schemas={allSchemas}
                  value={{
                    geocodeSource: panel.settings?.geocodeSource || null,
                    labelSource: panel.settings?.labelSource || null,
                    showLabels: panel.settings?.showLabels ?? false
                  }}
                  onChange={(config) => {
                    handlePanelSettingsUpdate({
                      geocodeSource: config.geocodeSource ?? undefined,
                      labelSource: config.labelSource ?? undefined,
                      showLabels: config.showLabels
                    });
                  }}
                  onGeocodeRequest={handleGeocodeRequest}
                  isLoadingGeocoding={isGeocoding}
                  geocodingError={geocodingError}
                />
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AssetDetailProvider>
                <AnnotationResultsMap
                  points={geocodedPoints}
                  results={filteredResults}
                  schemas={allSchemas}
                  labelConfig={panel.settings?.labelSource ? {
                    schemaId: panel.settings.labelSource.schemaId,
                    fieldKey: panel.settings.labelSource.fieldKey
                  } : undefined}
                  onPointClick={(point) => {
                    // Set the selected map point for the dialog
                    onMapPointClick?.(point);
                  }}
                  assets={allAssets}
                  // NEW: Time frame filtering and variable splitting
                  timeAxisConfig={panel.settings?.timeAxisConfig || null}
                  variableSplittingConfig={globalVariableSplittingConfig} // Use global settings
                  // NEW: Field selection controls
                  selectedFieldsPerScheme={panel.settings?.selectedFieldsPerScheme}
                  onSelectedFieldsChange={(selectedFieldsPerScheme) => {
                    handlePanelSettingsUpdate({
                      selectedFieldsPerScheme: selectedFieldsPerScheme
                    });
                  }}
                  // NEW: Result selection callback
                  onResultSelect={onResultSelect}
                />
              </AssetDetailProvider>
            </div>
          </div>
        );
      
      case 'graph':
        return (
          <div className="h-full flex flex-col space-y-2 overflow-y-auto">
            {!isCollapsed && (
              <div className="flex-shrink-0">
                {/* Removed embedded VariableSplittingControls */}
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AssetDetailProvider>
                <AnnotationResultsGraph
                  results={filteredResults}
                  schemas={allSchemas}
                  assets={allAssets}
                  activeRunId={activeRunId}
                  allSchemas={allSchemas}
                  // NEW: Time frame filtering and variable splitting
                  timeAxisConfig={panel.settings?.timeAxisConfig || null}
                  variableSplittingConfig={globalVariableSplittingConfig} // Use global settings
                  // NEW: Result selection callback
                  onResultSelect={onResultSelect}
                />
              </AssetDetailProvider>
            </div>
          </div>
        );
      
      default:
        return (
          <div className="text-center text-muted-foreground p-8">
            <p>Panel type '{panel.type}' is not yet implemented.</p>
            <p className="text-xs mt-2">Available types: table, chart, pie, graph</p>
          </div>
        );
    }
  };

  return (
    <Card 
      className={cn(
        "flex flex-col relative group transition-all duration-200 h-full w-full overflow-y-auto",
        // Remove min-height constraints - let grid system control height
        isDragging && "opacity-50 scale-95 rotate-1",
        "hover:shadow-md transition-shadow"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop Zone Visual Indicators */}
      {dragOverZone && (
        <>
          {/* Left Drop Zone */}
          {dragOverZone === 'left' && (
            <div className="absolute left-0 top-0 w-1 h-full bg-primary/60 rounded-l-lg z-30 animate-pulse" />
          )}
          
          {/* Right Drop Zone */}
          {dragOverZone === 'right' && (
            <div className="absolute right-0 top-0 w-1 h-full bg-primary/60 rounded-r-lg z-30 animate-pulse" />
          )}
          
          {/* Top Drop Zone */}
          {dragOverZone === 'top' && (
            <div className="absolute top-0 left-0 w-full h-1 bg-primary/60 rounded-t-lg z-30 animate-pulse" />
          )}
          
          {/* Bottom Drop Zone */}
          {dragOverZone === 'bottom' && (
            <div className="absolute bottom-0 left-0 w-full h-1 bg-primary/60 rounded-b-lg z-30 animate-pulse" />
          )}
          
          {/* Center Drop Zone (swap) */}
          {dragOverZone === 'center' && (
            <div className="absolute inset-0 border-2 border-dashed border-primary/60 rounded-lg z-30 bg-primary/10 flex items-center justify-center">
              <div className="bg-primary/80 text-primary-foreground px-3 py-1 rounded text-xs font-medium">
                Swap positions
              </div>
            </div>
          )}
        </>
      )}

      {/* Drag Handle - Top Center */}
      <div 
        className="absolute top-1 left-1/2 transform -translate-x-1/2 w-8 h-4 cursor-move opacity-0 group-hover:opacity-100 transition-opacity z-20 flex items-center justify-center bg-muted/80 rounded-md"
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>

      {/* Resize Handle - Bottom Right (only when not collapsed) */}
      {!isCollapsed && (
        <div 
          className="absolute bottom-1 right-1 w-4 h-4 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation(); // Prevent drag start when resizing
          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth = panel.gridPos.w;
          const startHeight = panel.gridPos.h;
          
          // Get the grid container to calculate actual grid cell size
          const gridContainer = e.currentTarget.closest('[style*="grid"]') as HTMLElement;
          let gridCellWidth = 100; // fallback
          let gridCellHeight = 150; // fallback
          
          if (gridContainer) {
            const containerRect = gridContainer.getBoundingClientRect();
            gridCellWidth = containerRect.width / 12; // 12 columns
            gridCellHeight = 150; // Fixed row height from the CSS
          }
          
          const handleMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            // Calculate new size based on actual grid cell dimensions
            const widthChange = Math.round(deltaX / gridCellWidth);
            const heightChange = Math.round(deltaY / gridCellHeight);
            
            const newWidth = Math.max(MIN_WIDTH, Math.min(GRID_COLUMNS, startWidth + widthChange));
            const newHeight = Math.max(MIN_HEIGHT, startHeight + heightChange);
            
            // Only update if the size actually changed to prevent unnecessary updates
            if (newWidth !== panel.gridPos.w || newHeight !== panel.gridPos.h) {
              handleWidthChange(newWidth);
              handleHeightChange(newHeight);
            }
          };
          
          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };
          
          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      >
          <div className="w-full h-full bg-gray-400 rounded-br-lg opacity-50 hover:opacity-100">
            <div className="w-2 h-2 bg-white rounded-full absolute bottom-0.5 right-0.5"></div>
          </div>
        </div>
      )}

      <CardHeader className="flex flex-row items-start justify-between border-b p-2 sm:p-3 space-y-0 flex-shrink-0">
        <div className="flex-1 space-y-2 min-w-0">
          {/* Editable Name */}
          <div className="flex items-center gap-2 min-w-0">
            {isEditingName ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={handleNameKeyDown}
                  className="text-sm sm:text-base font-semibold h-7 sm:h-8 flex-1 min-w-0"
                  placeholder="Panel name"
                  autoFocus
                />
                <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0" onClick={handleSaveName}>
                  <Check className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0" onClick={handleCancelNameEdit}>
                  <XCircle className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-1 group min-w-0">
                  <CardTitle className="text-sm sm:text-base flex-1 truncate">{panel.name}</CardTitle>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" 
                  onClick={() => setIsEditingName(true)}
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {/* Editable Description */}
          <div className="flex items-start gap-2 min-w-0">
            {isEditingDescription ? (
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <Textarea
                  value={editingDescription}
                  onChange={(e) => setEditingDescription(e.target.value)}
                  onKeyDown={handleDescriptionKeyDown}
                  className="text-xs min-h-[60px] flex-1 min-w-0"
                  placeholder="Panel description (optional)"
                  autoFocus
                />
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSaveDescription}>
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelDescriptionEdit}>
                    <XCircle className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className={cn("flex items-start gap-2 flex-1 group min-w-0", !panel.description && "min-h-[20px]")}>
                {panel.description ? (
                  <CardDescription className="text-xs flex-1 truncate">{panel.description}</CardDescription>
                ) : (
                  <CardDescription className="text-xs flex-1 italic text-muted-foreground/60 truncate">
                    Click to add description
                  </CardDescription>
                )}
                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" 
                  onClick={() => setIsEditingDescription(true)}
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {/* Panel Size Info / Type Info */}
          <div className="text-xs text-muted-foreground">
            {isCollapsed ? (
              <span></span>
            ) : (
              <span>Size: {panel.gridPos.w} × {panel.gridPos.h} grid units</span>
            )}
          </div>
        </div>

        {/* Panel Controls */}
        <div className="flex items-start gap-1 ml-1 sm:ml-2 flex-shrink-0">
          {/* Collapse/Expand Toggle */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-6 w-6 opacity-60 hover:opacity-100" 
            onClick={handleToggleCollapse}
          >
            {isCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </Button>

          {/* Layout Controls */}
          <Popover open={showLayoutControls} onOpenChange={setShowLayoutControls}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-60 hover:opacity-100">
                <Settings className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" align="end" side="bottom">
              <div className="space-y-4">
                <h4 className="font-medium text-sm">Panel Layout</h4>
                
                {/* Quick Size Buttons */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Quick Sizes</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleQuickSize('small')}>
                      Small (4×3)
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleQuickSize('medium')}>
                      Medium (6×4)
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleQuickSize('large')}>
                      Large (8×5)
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleQuickSize('full')}>
                      Full Width (12×6)
                    </Button>
                  </div>
                </div>

                {/* Manual Size Controls */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="panel-width" className="text-xs text-muted-foreground">Width</Label>
                    <Select value={panel.gridPos.w.toString()} onValueChange={(v) => handleWidthChange(parseInt(v))}>
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: GRID_COLUMNS - MIN_WIDTH + 1 }, (_, i) => i + MIN_WIDTH).map(w => (
                          <SelectItem key={w} value={w.toString()}>
                            {w} / {GRID_COLUMNS}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="panel-height" className="text-xs text-muted-foreground">Height</Label>
                    <Select value={panel.gridPos.h.toString()} onValueChange={(v) => handleHeightChange(parseInt(v))}>
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 10 }, (_, i) => i + MIN_HEIGHT).map(h => (
                          <SelectItem key={h} value={h.toString()}>
                            {h} units
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Reset Button */}
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="w-full"
                  onClick={handleResetLayout}
                >
                  <RotateCcw className="h-3 w-3 mr-2" />
                  Reset Layout
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Remove Panel */}
          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-60 hover:opacity-100" onClick={() => onRemovePanel(panel.id)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col gap-2 sm:gap-4 p-2 sm:p-3 min-h-0 overflow-y-auto">
        {/* Unified Filters & Settings Section - Only this collapses */}
        {!isCollapsed && (
          <div className="border-b pb-2 sm:pb-4 flex-shrink-0">
            <UnifiedFilterControls 
              filterSet={panel.filters || { logic: 'and', rules: [] }}
              onFilterSetChange={handleFilterChange}
              timeAxisConfig={panel.settings?.timeAxisConfig || null}
              onTimeAxisConfigChange={(config) => {
                handlePanelSettingsUpdate({ timeAxisConfig: config });
              }}
              showTimeControls={true}
              allSchemas={allSchemas}
            />
          </div>
        )}
        
        {/* Main Content - Always visible with proper overflow handling */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {renderPanelContent()}
        </div>
      </CardContent>
    </Card>
  );
}; 