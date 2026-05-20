'use client';

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  TooltipProps,
  Cell,
  LegendProps,
  ReferenceLine,
  ReferenceArea,
  Dot,
} from 'recharts';
import { format, startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { AnnotationRead, AnnotationSchemaRead, AssetRead } from '@/client';
import type { AggregateViewConfig as AggregateConfig } from '@/client';
import { TimeAxisConfig, FormattedAnnotation, TimeFrameFilter, PanelConfig, ViewAggregatePhase, AggregateBucket } from '@/lib/annotations/types';
import { getTargetKeysForScheme, formatDisplayValue, getAnnotationFieldValue, getAnnotationFieldValuesExploded, getDateFieldsForScheme } from '@/lib/annotations/utils';
import { VariableSplittingConfig, applySplittingToResults, applyAmbiguityResolution } from './VariableSplittingControls';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import { mergeFiltersAndScopes } from '@/lib/annotations/scopes';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from '@/components/ui/switch';
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import AssetLink from '../assets/Helper/AssetLink';
import AnnotationResultDisplay from './AnnotationResultDisplay';
import { ResultFilter } from './AnnotationFilterControls';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Settings2, ArrowDownUp, SortAsc, SortDesc, Info, Layers, Maximize2, SlidersHorizontal } from 'lucide-react';
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { type RolePickerValue } from './panels/RolePicker';
import { RolePickerPopover } from './panels/RolePickerPopover';
import { PanelHeaderSlot } from './panels/PanelHeaderSlot';
import { PanelFormulaBinder } from './formulas/PanelFormulaBinder';
import { useResolvedProjection } from '@/hooks/useResolvedProjection';
import { EmptyStateCard } from './panels/EmptyStateCard';
import { ValueAliasManager } from './panels/ValueAliasManager';
import { EvidenceDrawer } from './panels/EvidenceDrawer';
import {
  AnalyticsOverlayToolbar,
  type AnalyticsOverlayConfig,
  DEFAULT_ANALYTICS_OVERLAYS,
} from './panels/AnalyticsOverlayToolbar';
import {
  rollingAverage,
  trendLine,
  findPeaks,
  descriptiveStats,
} from './panels/analytics';
import { PANEL_ROLE_SCHEMAS } from '@/lib/annotations/panelRoleSchema';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { effectiveMergeMaps } from '@/lib/annotations/valueAliases';
import { createScopeFromSelection } from '@/lib/annotations/scopes';
import { inferFieldShape } from '@/lib/annotations/fieldPaths';
import type { Scope } from '@/lib/annotations/types';


const PIE_COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8',
  '#82CA9D', '#A4DE6C', '#D0ED57', '#FFC658', '#FF6B6B'
];

// --- DATA STRUCTURES --- //
export interface ChartDataPoint {
  timestamp: number;
  dateString: string;
  count: number;
  documents: number[];
  assetSchemeValues?: Record<string, Record<string, any>>;
  stats?: Record<string, { min: number; max: number; avg: number; count: number }>;
  categoryFrequency?: Record<string, Record<string, number>>;
  // Monitoring mode fields
  annotatedCount?: number;
  pendingCount?: number;
  partialCount?: number;
  totalAssetCount?: number;
  pendingAssetIds?: number[];
  [key: string]: any; 
}

export interface GroupedDataPoint {
    valueString: string;
    totalCount: number;
    sourceDocuments: Map<number | string, number[]>;
    schemeName: string;
    valueKey: string;
    [key: `ds_${number}_count`]: number;
}

type ChartData = ChartDataPoint[];

// --- STATISTICAL AGGREGATION TYPES --- //
interface FieldStatistics {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  categories: Record<string, number>;
}



// --- COMPONENT PROPS --- //
interface Props {
  infospaceId: number;
  runId: number;
  schemas: AnnotationSchemaRead[];
  panelConfig: PanelConfig;
  onUpdatePanel: (updates: Partial<PanelConfig>) => void;
  showControls?: boolean;
  onResultSelect?: (result: FormattedAnnotation) => void;
  onFieldInteraction?: (result: FormattedAnnotation, fieldKey: string) => void;
  highlightedTimestamp?: { timestamp: Date; fieldKey: string } | null;
  onScopeGesture?: (fieldPath: string, value: any, gestureType: 'click' | 'brush' | 'select') => void;
}

// NEW: Interface for group selection in timeline charts
export interface GroupSelectionConfig {
  visibleGroups: Set<string>;
  allGroups: string[];
}

// --- HELPER FUNCTIONS --- //
// Helper to get nested value from object using dot notation
const getNestedValue = (obj: any, path: string): any => {
  return path.split('.').reduce((current, key) => {
    return current && typeof current === 'object' ? current[key] : undefined;
  }, obj);
};

const getTimestamp = (
  result: FormattedAnnotation, 
  assetsMap: Map<number, AssetRead>, 
  timeAxisConfig: TimeAxisConfig | null,
  arrayIndex?: number // NEW: For exploded array items
): Date | null => {
  if (!timeAxisConfig) return null;
  let dateSource: string | number | Date | null = null;
  switch (timeAxisConfig.type) {
    case 'event': dateSource = assetsMap.get(result.asset_id)?.event_timestamp || null; break;
    case 'schema':
      if (timeAxisConfig.schemaId === result.schema_id && timeAxisConfig.fieldKey) {
        dateSource = getAnnotationFieldValue(result.value, timeAxisConfig.fieldKey) || null;
        
        // NEW: If field path goes through an array and we're exploding, extract from specific array item
        if (arrayIndex !== undefined && dateSource === null && timeAxisConfig.fieldKey.includes('.')) {
          const fieldPath = timeAxisConfig.fieldKey.split('.');
          // Find the array path (e.g., "document.mails" from "document.mails.date")
          for (let i = 1; i < fieldPath.length; i++) {
            const potentialArrayPath = fieldPath.slice(0, i).join('.');
            const remainingPath = fieldPath.slice(i).join('.');
            const potentialArray = getAnnotationFieldValue(result.value, potentialArrayPath);
            
            if (Array.isArray(potentialArray) && potentialArray.length > 0 && 
                typeof potentialArray[0] === 'object' && potentialArray[arrayIndex]) {
              // Extract from specific array item
              const arrayItem = potentialArray[arrayIndex];
              if (typeof arrayItem === 'object' && arrayItem !== null) {
                dateSource = getNestedValue(arrayItem, remainingPath) || null;
                break;
              }
            }
          }
        }
        
        // If hierarchical extraction failed, try flat extraction
        if (!dateSource && timeAxisConfig.fieldKey.includes('.')) {
          const flatKey = timeAxisConfig.fieldKey.split('.').pop();
          if (flatKey) {
            dateSource = getAnnotationFieldValue(result.value, flatKey) || null;
          }
        }
      }
      break;
    default: dateSource = result.timestamp; break;
  }
  if (!dateSource) return null;
  try {
    const d = new Date(dateSource);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
};

// NEW: Explode array results for chart visualization
const explodeArrayResults = (
  results: FormattedAnnotation[],
  timeAxisConfig: TimeAxisConfig | null
): Array<FormattedAnnotation & { arrayIndex?: number; arrayItemCount?: number }> => {
  if (!timeAxisConfig?.fieldKey) return results;
  
  const explodedResults: Array<FormattedAnnotation & { arrayIndex?: number; arrayItemCount?: number }> = [];
  
  for (const result of results) {
    // Check if the field path goes through an array
    const fieldPath = timeAxisConfig.fieldKey.split('.');
    let arrayPath = '';
    let isArrayField = false;
    
    // Detect if field path traverses an array (e.g., "document.mails.date")
    for (let i = 1; i < fieldPath.length; i++) {
      const potentialArrayPath = fieldPath.slice(0, i).join('.');
      const potentialArray = getAnnotationFieldValue(result.value, potentialArrayPath);
      
      if (Array.isArray(potentialArray) && potentialArray.length > 0 && 
          typeof potentialArray[0] === 'object' && potentialArray[0] !== null) {
        arrayPath = potentialArrayPath;
        isArrayField = true;
        break;
      }
    }
    
    if (isArrayField && arrayPath) {
      // Explode: Create one result per array item
      const arrayContainer = getAnnotationFieldValue(result.value, arrayPath);
      if (Array.isArray(arrayContainer) && arrayContainer.length > 0) {
        arrayContainer.forEach((item, index) => {
          explodedResults.push({
            ...result,
            arrayIndex: index,
            arrayItemCount: arrayContainer.length,
          });
        });
      } else {
        // Empty array - don't add any points
      }
    } else {
      // No array, use as-is
      explodedResults.push(result);
    }
  }
  
  return explodedResults;
};

// Helper to get the primary plottable value from an annotation result
const getPlottableValue = (result: FormattedAnnotation, schema: AnnotationSchemaRead): number | null => {
  if (!result || !result.value || !schema) {
    return null;
  }

  // Get all available fields for this schema (only integer/number fields)
  const plottableFields = getPlottableFieldsForSchema(schema);
  if (plottableFields.length === 0) return null;

  // Use the first numeric field found
  const fieldToUse = plottableFields[0];

  // Extract the field value
  let fieldValue = getAnnotationFieldValue(result.value, fieldToUse.key);
  
  // If hierarchical extraction failed, try flat extraction
  if ((fieldValue === null || fieldValue === undefined) && fieldToUse.key.includes('.')) {
    const fallbackKey = fieldToUse.key.split('.').pop();
    if (fallbackKey) {
      fieldValue = getAnnotationFieldValue(result.value, fallbackKey);
    }
  }
  
  if (fieldValue === null || fieldValue === undefined) {
    return null;
  }

  // Only handle integer and number fields
  if (fieldToUse.type === 'integer' || fieldToUse.type === 'number') {
    const num = Number(fieldValue);
    return !isNaN(num) ? num : null;
  }

  return null;
};

// NOTE: Using enhanced ambiguity resolution from VariableSplittingControls
// This function is defined there as applyEnhancedAmbiguityResolution

const safeStringify = (value: any): string => {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); }
  catch { return 'Complex Data'; }
};

// Recharts resolves `dataKey` via lodash `get`, which treats `.` as nested
// path. Our aggregate metric keys are dotted field paths (``document.price``),
// which would read as `point.document.price`. Encode to a dot-free slug so
// the literal key we write on the point is the key recharts looks up.
const METRIC_KEY_SEP = '__';
const encodeMetricKey = (path: string): string => path.replace(/\./g, METRIC_KEY_SEP);
const decodeMetricKey = (encoded: string): string =>
  encoded.replace(new RegExp(METRIC_KEY_SEP, 'g'), '.');

// Helper function to normalize timestamps to interval starts to prevent duplicate x-axis points
const getNormalizedTimestampForInterval = (dateKey: string, groupingInterval: 'day' | 'week' | 'month' | 'quarter' | 'year'): number => {
  try {
    switch (groupingInterval) {
      case 'year':
        return startOfYear(new Date(`${dateKey}-01-01`)).getTime();
      case 'quarter': {
        // Parse quarter format like "2013-Q1"
        const quarterMatch = dateKey.match(/^(\d{4})-Q(\d)$/);
        if (quarterMatch) {
          const year = parseInt(quarterMatch[1]);
          const quarter = parseInt(quarterMatch[2]);
          const quarterStartMonth = (quarter - 1) * 3; // Q1=0, Q2=3, Q3=6, Q4=9
          return startOfQuarter(new Date(year, quarterStartMonth, 1)).getTime();
        }
        break;
      }
      case 'month':
        // Parse format like "2013-01"
        return startOfMonth(new Date(`${dateKey}-01`)).getTime();
      case 'week': {
        // Parse week format like "2013-01" (week of year)
        const weekMatch = dateKey.match(/^(\d{4})-(\d{1,2})$/);
        if (weekMatch) {
          const year = parseInt(weekMatch[1]);
          const week = parseInt(weekMatch[2]);
          // Approximate: start of year + (week-1) * 7 days
          const yearStart = startOfYear(new Date(year, 0, 1));
          const weekStart = new Date(yearStart.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
          return startOfWeek(weekStart, { weekStartsOn: 1 }).getTime();
        }
        break;
      }
      case 'day':
      default:
        // Parse format like "2013-01-15"
        return startOfDay(new Date(dateKey)).getTime();
    }
  } catch (error) {
    console.warn('Failed to parse dateKey for normalization:', dateKey, error);
  }
  
  // Fallback: try to parse dateKey directly
  try {
    return new Date(dateKey).getTime();
  } catch {
    return Date.now(); // Last resort fallback
  }
};

// Helper function to get field definition from hierarchical schema (copied from PieChart)
const getFieldDefinitionFromSchema = (schema: AnnotationSchemaRead, fieldKey: string): any => {
    if (!schema.output_contract) return null;
    
    const properties = (schema.output_contract as any).properties;
    if (!properties) return null;
    
    // Handle hierarchical paths like "document.topics"
    const keys = fieldKey.split('.');
    let currentSchema = properties;
    
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        
        if (currentSchema[key]) {
            if (i === keys.length - 1) {
                // Last key - return the field definition
                return currentSchema[key];
            } else {
                // Navigate deeper
                if (currentSchema[key].type === 'object' && currentSchema[key].properties) {
                    currentSchema = currentSchema[key].properties;
                } else if (currentSchema[key].type === 'array' && 
                          currentSchema[key].items?.type === 'object' && 
                          currentSchema[key].items.properties) {
                    currentSchema = currentSchema[key].items.properties;
                } else {
                    return null;
                }
            }
        } else {
            return null;
        }
    }
    
    return null;
};

const processGroupedChartData = (
  resultsToProcess: FormattedAnnotation[],
  schemes: AnnotationSchemaRead[],
  assetsMap: Map<number, AssetRead>,
  groupingSchemeId: number | null,
  groupingFieldKey: string | null,
  aggregateSources: boolean,
  valueAliases: Record<string, string[]> = {} // Many-to-one ambiguity resolution
): GroupedDataPoint[] => {
   if (!groupingSchemeId || !groupingFieldKey || resultsToProcess.length === 0) {
     return [];
   }
   
   const selectedScheme = schemes.find(s => s.id === groupingSchemeId);
   if (!selectedScheme) {
     return [];
   }

   // FIXED: Get field definition like pie chart does
   const fieldDefinition = getFieldDefinitionFromSchema(selectedScheme, groupingFieldKey);
   if (!fieldDefinition) {
     console.warn('Could not find field definition for:', groupingFieldKey, 'in schema:', selectedScheme.name);
     return [];
   }

    const valueCountsMap = new Map<string, { counts: Map<number | string, number>; documents: Map<number | string, number[]>; }>();

    resultsToProcess.forEach(result => {
        if (result.schema_id !== groupingSchemeId) {
            return;
        }
        const asset = assetsMap.get(result.asset_id);
        const sourceId = asset?.source_id || 0; // Use 0 as fallback for assets without sources
        
        // Use the improved getAnnotationFieldValue from utils.ts
        const fieldValue = getAnnotationFieldValue(result.value, groupingFieldKey);
        
        // FIXED: Handle different field types like the pie chart does
        if (fieldValue === null || fieldValue === undefined) {
            // Handle null/undefined values properly
            const canonicalValue = applyAmbiguityResolution('N/A', valueAliases);
            let entry = valueCountsMap.get(canonicalValue);
            if (!entry) {
                entry = { counts: new Map(), documents: new Map() };
                valueCountsMap.set(canonicalValue, entry);
            }
            const effectiveSourceId = aggregateSources ? 'all' : sourceId;
            entry.counts.set(effectiveSourceId, (entry.counts.get(effectiveSourceId) || 0) + 1);
            let docList = entry.documents.get(effectiveSourceId);
            if (!docList) {
                docList = [];
                entry.documents.set(effectiveSourceId, docList);
            }
            if (!docList.includes(result.asset_id)) docList.push(result.asset_id);
        } else if (fieldDefinition.type === 'array' && Array.isArray(fieldValue)) {
            // FIXED: Handle arrays properly like pie chart does
            if (fieldValue.length === 0) {
                const canonicalValue = applyAmbiguityResolution('Empty Array', valueAliases);
                let entry = valueCountsMap.get(canonicalValue);
                if (!entry) {
                    entry = { counts: new Map(), documents: new Map() };
                    valueCountsMap.set(canonicalValue, entry);
                }
                const effectiveSourceId = aggregateSources ? 'all' : sourceId;
                entry.counts.set(effectiveSourceId, (entry.counts.get(effectiveSourceId) || 0) + 1);
                let docList = entry.documents.get(effectiveSourceId);
                if (!docList) {
                    docList = [];
                    entry.documents.set(effectiveSourceId, docList);
                }
                if (!docList.includes(result.asset_id)) docList.push(result.asset_id);
            } else {
                // Process each array element
                fieldValue.forEach(val => {
                    // Handle both primitive and object array elements
                    let displayValue: string;
                    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                        displayValue = String(val);
                    } else if (typeof val === 'object' && val !== null) {
                        // For objects, try to get a meaningful display value
                        if (val.name) displayValue = val.name;
                        else if (val.title) displayValue = val.title;
                        else if (val.value) displayValue = val.value;
                        else displayValue = JSON.stringify(val);
                    } else {
                        displayValue = String(val);
                    }
                    
                    const canonicalValue = applyAmbiguityResolution(displayValue, valueAliases);
                    let entry = valueCountsMap.get(canonicalValue);
                    if (!entry) {
                        entry = { counts: new Map(), documents: new Map() };
                        valueCountsMap.set(canonicalValue, entry);
                    }
                    const effectiveSourceId = aggregateSources ? 'all' : sourceId;
                    entry.counts.set(effectiveSourceId, (entry.counts.get(effectiveSourceId) || 0) + 1);
                    let docList = entry.documents.get(effectiveSourceId);
                    if (!docList) {
                        docList = [];
                        entry.documents.set(effectiveSourceId, docList);
                    }
                    if (!docList.includes(result.asset_id)) docList.push(result.asset_id);
                });
            }
        } else {
            // Handle all other field types (boolean, string, number, object) like pie chart does
            let categoryName: string;
            if (fieldDefinition.type === 'boolean') {
                categoryName = fieldValue ? 'True' : 'False';
            } else if (typeof fieldValue === 'object') {
                try { 
                    categoryName = JSON.stringify(fieldValue); 
                } catch (e) { 
                    categoryName = '[Complex Object]'; 
                }
            } else { 
                categoryName = String(fieldValue); 
            }
            
            // Apply consistent ambiguity resolution
            const canonicalValue = applyAmbiguityResolution(categoryName, valueAliases);
            let entry = valueCountsMap.get(canonicalValue);
            if (!entry) {
                entry = { counts: new Map(), documents: new Map() };
                valueCountsMap.set(canonicalValue, entry);
            }
            const effectiveSourceId = aggregateSources ? 'all' : sourceId;
            entry.counts.set(effectiveSourceId, (entry.counts.get(effectiveSourceId) || 0) + 1);
            let docList = entry.documents.get(effectiveSourceId);
            if (!docList) {
                docList = [];
                entry.documents.set(effectiveSourceId, docList);
            }
            if (!docList.includes(result.asset_id)) docList.push(result.asset_id);
        }
    });

    return Array.from(valueCountsMap.entries()).map(([valueStr, data]) => {
        const point: GroupedDataPoint = {
            valueString: valueStr,
            totalCount: 0,
            sourceDocuments: data.documents,
            schemeName: selectedScheme.name,
            valueKey: valueStr,
        };
        data.counts.forEach((count, sourceKey) => {
            if (!aggregateSources && typeof sourceKey === 'number') {
                point[`ds_${sourceKey}_count`] = count;
            }
            point.totalCount += count;
        });
        return point;
    });
};

// --- STATISTICAL PROCESSING FUNCTIONS --- //

const getPlottableFieldsForSchema = (schema: AnnotationSchemaRead): Array<{key: string, name: string, type: string}> => {
  // Extract plottable fields from schema - ONLY integer and number types for time series
  const fields: Array<{key: string, name: string, type: string}> = [];
  
  if (!schema.output_contract || typeof schema.output_contract !== 'object') {
    return fields;
  }
  
  const properties = (schema.output_contract as any).properties;
  if (!properties) return fields;
  
  // Extract from hierarchical structure
  const extractFields = (props: any, prefix: string = '') => {
    Object.entries(props).forEach(([key, value]: [string, any]) => {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      // Only include actual numeric types - no arrays, no strings
      if (value.type === 'integer' || value.type === 'number') {
        fields.push({
          key: fullKey,
          name: value.title || key,
          type: value.type
        });
      }
      
      // Recurse into nested objects
      if (value.type === 'object' && value.properties) {
        extractFields(value.properties, fullKey);
      }
    });
  };
  
  // Check both hierarchical and flat structures
  if (properties.document && properties.document.type === 'object' && properties.document.properties) {
    extractFields(properties.document.properties, 'document');
  }
  
  // ALSO extract from flat structure in case data doesn't match hierarchical schema
  extractFields(properties);
  
  return fields;
};

// --- Split-Aware Line Chart Data Processing ---
const processLineChartData = (
  results: FormattedAnnotation[],
  schemas: AnnotationSchemaRead[],
  assetsMap: Map<number, AssetRead>,
  timeAxisConfig: TimeAxisConfig | null,
  groupingInterval: 'day' | 'week' | 'month' | 'quarter' | 'year',
  // Variable splitting support
  variableSplittingConfig?: VariableSplittingConfig | null
): ChartDataPoint[] => {
  
  // REMOVED: Internal variable splitting logic - this is now handled externally
  // We now process the results directly without further splitting
  const allDatePoints = new Map<string, ChartDataPoint>();
  
  // Group results by date and asset
  const resultsByDateAndAsset = results.reduce<Record<string, Record<string, FormattedAnnotation[]>>>((acc, result) => {
    // NEW: Pass arrayIndex if result has it (from exploded arrays)
    const arrayIndex = (result as any).arrayIndex;
    const timestamp = getTimestamp(result, assetsMap, timeAxisConfig, arrayIndex);
    if (!timestamp || isNaN(timestamp.getTime())) return acc;

    // Generate date key for grouping
    let dateKey: string;
    switch (groupingInterval) {
      case 'week': 
        dateKey = format(startOfWeek(timestamp, { weekStartsOn: 1 }), 'yyyy-wo'); 
        break;
      case 'month': 
        dateKey = format(startOfMonth(timestamp), 'yyyy-MM'); 
        break;
      case 'quarter': 
        dateKey = `${format(startOfQuarter(timestamp), 'yyyy')}-Q${Math.floor(startOfQuarter(timestamp).getMonth() / 3) + 1}`; 
        break;
      case 'year': 
        dateKey = format(startOfYear(timestamp), 'yyyy'); 
        break;
      default: 
        dateKey = format(timestamp, 'yyyy-MM-dd'); 
        break;
    }

    const assetKey = `asset-${result.asset_id}`;
    
    if (!acc[dateKey]) {
      acc[dateKey] = {};
    }
    
    if (!acc[dateKey][assetKey]) {
      acc[dateKey][assetKey] = [];
    }
    
    acc[dateKey][assetKey].push(result);
    return acc;
  }, {});

  // Transform grouped data into chart format with actual values
  Object.entries(resultsByDateAndAsset).forEach(([dateKey, assetResults]) => {
    // Use normalized timestamp to prevent duplicate x-axis points for same interval
    const normalizedTimestamp = getNormalizedTimestampForInterval(dateKey, groupingInterval);
    
    // Get or create the chart point for this date
    let chartPoint = allDatePoints.get(dateKey);
    if (!chartPoint) {
      chartPoint = {
        dateString: dateKey,
        timestamp: normalizedTimestamp,
        count: 0,
        documents: [],
        stats: {},
        categoryFrequency: {},
        assetSchemeValues: {}
      };
      allDatePoints.set(dateKey, chartPoint);
    }

    // Update documents count
    const newDocuments = [...new Set(Object.values(assetResults).flatMap(results => results.map(r => r.asset_id)))];
    chartPoint.documents = [...new Set([...chartPoint.documents, ...newDocuments])];
    chartPoint.count = chartPoint.documents.length;

    // Process each asset's results
    Object.entries(assetResults).forEach(([assetKey, assetSchemaResults]) => {
      const assetId = assetKey.replace('asset-', '');
      
      if (!chartPoint!.assetSchemeValues![assetId]) {
        chartPoint!.assetSchemeValues![assetId] = {};
      }

      // Group this asset's results by schema
      const schemaGroups = assetSchemaResults.reduce<Record<number, FormattedAnnotation[]>>((acc, result) => {
        if (!acc[result.schema_id]) {
          acc[result.schema_id] = [];
        }
        acc[result.schema_id].push(result);
        return acc;
      }, {});

      // Add scheme-specific data
      Object.entries(schemaGroups).forEach(([schemeIdStr, assetSchemeResults]) => {
        const schemeId = Number(schemeIdStr);
        const schema = schemas.find(s => s.id === schemeId);
        if (!schema) return;

        const schemeName = schema.name;

        // Process results in this schema for this asset
        assetSchemeResults.forEach(result => {
          // Store in asset-specific structure for tooltip access
          chartPoint!.assetSchemeValues![assetId][schemeName] = result.value;

          // Get ALL plottable fields for this schema and process each one
          const plottableFields = getPlottableFieldsForSchema(schema);

          plottableFields.forEach(field => {
            // Extract the field value with improved fallback logic
            let fieldValue = getAnnotationFieldValue(result.value, field.key);
            
            // If hierarchical extraction failed, try flat extraction
            if ((fieldValue === null || fieldValue === undefined) && field.key.includes('.')) {
              const fieldFallbackKey = field.key.split('.').pop();
              if (fieldFallbackKey) {
                fieldValue = getAnnotationFieldValue(result.value, fieldFallbackKey);
              }
            }

            if (fieldValue !== null && fieldValue !== undefined) {
              // FIXED: Always use standard field key format since splitting is handled externally
              const fieldChartKey = `${schemeName}_${field.name}`;
              
              let numericValue: number | null = null;
              
              // Only process integer and number fields for time series
              if (field.type === 'integer' || field.type === 'number') {
                const num = Number(fieldValue);
                if (!isNaN(num)) {
                  numericValue = num;
                }
              }

              if (numericValue !== null) {
                // Initialize stats object for this field if needed
                if (!chartPoint!.stats![fieldChartKey]) {
                  chartPoint!.stats![fieldChartKey] = { min: Infinity, max: -Infinity, avg: 0, count: 0 };
                }

                const stats = chartPoint!.stats![fieldChartKey];
                stats.min = Math.min(stats.min, numericValue);
                stats.max = Math.max(stats.max, numericValue);
                stats.count += 1;
                stats.avg = (stats.avg * (stats.count - 1) + numericValue) / stats.count;

                // Store raw value for direct chart access
                if (chartPoint![fieldChartKey] === undefined) {
                  chartPoint![fieldChartKey] = numericValue;
                } else {
                  // Average multiple values on the same date
                  const currentVal = chartPoint![fieldChartKey] as number;
                  chartPoint![fieldChartKey] = (currentVal + numericValue) / 2;
                }
              }
            }
          });
        });
      });
    });
  });

  // Convert map to array and set final aggregate fields
  const finalChartData = Array.from(allDatePoints.values()).map(chartPoint => {
    // Set min/max/avg keys for direct chart access
    if (chartPoint.stats) {
      Object.entries(chartPoint.stats).forEach(([fieldKey, stats]) => {
        const finalMin = stats.min !== Infinity ? stats.min : null;
        const finalMax = stats.max !== -Infinity ? stats.max : null;
        const finalAvg = stats.count > 0 ? stats.avg : null;

        chartPoint[`${fieldKey}_min`] = finalMin;
        chartPoint[`${fieldKey}_max`] = finalMax;
        chartPoint[`${fieldKey}_avg`] = finalAvg;
      });
    }

    return chartPoint;
  });
  
  return finalChartData.sort((a, b) => a.timestamp - b.timestamp);
};

// --- Monitoring-Aware Line Chart Data Processing ---
const processMonitoringLineChartData = (
  results: FormattedAnnotation[],
  allAssets: AssetRead[],
  schemas: AnnotationSchemaRead[],
  assetsMap: Map<number, AssetRead>,
  timeAxisConfig: TimeAxisConfig | null,
  groupingInterval: 'day' | 'week' | 'month' | 'quarter' | 'year',
  expectedSchemaIds: number[],
  showPendingAssets: boolean
): ChartDataPoint[] => {
  
  const allDatePoints = new Map<string, ChartDataPoint>();
  
  // Create annotation map: asset_id -> schema_id -> annotation
  const annotationMap = new Map<number, Map<number, FormattedAnnotation>>();
  results.forEach(ann => {
    if (!annotationMap.has(ann.asset_id)) {
      annotationMap.set(ann.asset_id, new Map());
    }
    annotationMap.get(ann.asset_id)!.set(ann.schema_id, ann);
  });
  
  const expectedSchemaSet = new Set(expectedSchemaIds);
  
  // Helper to get asset timestamp for grouping
  const getAssetTimestamp = (asset: AssetRead): Date | null => {
    if (!timeAxisConfig) {
      return new Date(asset.created_at);
    }
    
    switch (timeAxisConfig.type) {
      case 'event':
        return asset.event_timestamp ? new Date(asset.event_timestamp) : new Date(asset.created_at);
      case 'default':
        return new Date(asset.created_at);
      case 'schema':
        // For schema-based time, we need to find an annotation for this asset
        const assetAnnotations = annotationMap.get(asset.id);
        if (assetAnnotations) {
          const ann = Array.from(assetAnnotations.values()).find(a => 
            a.schema_id === timeAxisConfig.schemaId
          );
          if (ann && timeAxisConfig.fieldKey) {
            const dateValue = getAnnotationFieldValue(ann.value, timeAxisConfig.fieldKey);
            if (dateValue) {
              try {
                const d = new Date(dateValue);
                return isNaN(d.getTime()) ? new Date(asset.created_at) : d;
              } catch {
                return new Date(asset.created_at);
              }
            }
          }
        }
        return new Date(asset.created_at);
      default:
        return new Date(asset.created_at);
    }
  };
  
  // Process all assets (not just annotated ones)
  const assetsToProcess = showPendingAssets ? allAssets : allAssets.filter(asset => {
    const assetAnnotations = annotationMap.get(asset.id);
    return assetAnnotations && assetAnnotations.size > 0;
  });
  
  // Group assets by date
  const assetsByDate = new Map<string, AssetRead[]>();
  
  assetsToProcess.forEach(asset => {
    const timestamp = getAssetTimestamp(asset);
    if (!timestamp || isNaN(timestamp.getTime())) return;
    
    // Generate date key for grouping
    let dateKey: string;
    switch (groupingInterval) {
      case 'week': 
        dateKey = format(startOfWeek(timestamp, { weekStartsOn: 1 }), 'yyyy-wo'); 
        break;
      case 'month': 
        dateKey = format(startOfMonth(timestamp), 'yyyy-MM'); 
        break;
      case 'quarter': 
        dateKey = `${format(startOfQuarter(timestamp), 'yyyy')}-Q${Math.floor(startOfQuarter(timestamp).getMonth() / 3) + 1}`; 
        break;
      case 'year': 
        dateKey = format(startOfYear(timestamp), 'yyyy'); 
        break;
      default: 
        dateKey = format(timestamp, 'yyyy-MM-dd'); 
        break;
    }
    
    if (!assetsByDate.has(dateKey)) {
      assetsByDate.set(dateKey, []);
    }
    assetsByDate.get(dateKey)!.push(asset);
  });
  
  // Process each date bucket
  assetsByDate.forEach((assets, dateKey) => {
    const normalizedTimestamp = getNormalizedTimestampForInterval(dateKey, groupingInterval);
    
    let chartPoint = allDatePoints.get(dateKey);
    if (!chartPoint) {
      chartPoint = {
        dateString: dateKey,
        timestamp: normalizedTimestamp,
        count: 0,
        documents: [],
        stats: {},
        categoryFrequency: {},
        assetSchemeValues: {},
        annotatedCount: 0,
        pendingCount: 0,
        partialCount: 0,
        totalAssetCount: 0,
        pendingAssetIds: []
      };
      allDatePoints.set(dateKey, chartPoint);
    }
    
    // Categorize assets by annotation status
    let annotatedCount = 0;
    let pendingCount = 0;
    let partialCount = 0;
    const pendingAssetIds: number[] = [];
    const annotatedAssetIds: number[] = [];
    
    assets.forEach(asset => {
      const assetAnnotations = annotationMap.get(asset.id) || new Map();
      const completedSchemaIds = new Set(assetAnnotations.keys());
      
      // Check completion status
      const hasAllSchemas = expectedSchemaSet.size > 0 
        ? Array.from(expectedSchemaSet).every(id => completedSchemaIds.has(id))
        : completedSchemaIds.size === schemas.length;
      
      const hasSomeSchemas = completedSchemaIds.size > 0;
      const hasFailures = Array.from(assetAnnotations.values()).some(
        ann => ann.status === 'failure'
      );
      
      if (hasFailures) {
        // Failed assets don't count as annotated
        pendingCount++;
        pendingAssetIds.push(asset.id);
      } else if (hasAllSchemas && hasSomeSchemas) {
        annotatedCount++;
        annotatedAssetIds.push(asset.id);
      } else if (hasSomeSchemas) {
        partialCount++;
      } else {
        pendingCount++;
        pendingAssetIds.push(asset.id);
      }
      
      chartPoint!.documents.push(asset.id);
      
      // Process annotations for value lines (same as regular processing)
      if (hasSomeSchemas) {
        const assetId = asset.id.toString();
        if (!chartPoint!.assetSchemeValues![assetId]) {
          chartPoint!.assetSchemeValues![assetId] = {};
        }
        
        assetAnnotations.forEach((ann, schemaId) => {
          const schema = schemas.find(s => s.id === schemaId);
          if (!schema) return;
          
          const schemeName = schema.name;
          chartPoint!.assetSchemeValues![assetId][schemeName] = ann.value;
          
          const plottableFields = getPlottableFieldsForSchema(schema);
          plottableFields.forEach(field => {
            let fieldValue = getAnnotationFieldValue(ann.value, field.key);
            
            if ((fieldValue === null || fieldValue === undefined) && field.key.includes('.')) {
              const fieldFallbackKey = field.key.split('.').pop();
              if (fieldFallbackKey) {
                fieldValue = getAnnotationFieldValue(ann.value, fieldFallbackKey);
              }
            }
            
            if (fieldValue !== null && fieldValue !== undefined) {
              const fieldChartKey = `${schemeName}_${field.name}`;
              
              if (field.type === 'integer' || field.type === 'number') {
                const num = Number(fieldValue);
                if (!isNaN(num)) {
                  if (!chartPoint!.stats![fieldChartKey]) {
                    chartPoint!.stats![fieldChartKey] = { min: Infinity, max: -Infinity, avg: 0, count: 0 };
                  }
                  
                  const stats = chartPoint!.stats![fieldChartKey];
                  stats.min = Math.min(stats.min, num);
                  stats.max = Math.max(stats.max, num);
                  stats.count += 1;
                  stats.avg = (stats.avg * (stats.count - 1) + num) / stats.count;
                  
                  if (chartPoint![fieldChartKey] === undefined) {
                    chartPoint![fieldChartKey] = num;
                  } else {
                    const currentVal = chartPoint![fieldChartKey] as number;
                    chartPoint![fieldChartKey] = (currentVal + num) / 2;
                  }
                }
              }
            }
          });
        });
      }
    });
    
    chartPoint!.totalAssetCount = assets.length;
    chartPoint!.annotatedCount = annotatedCount;
    chartPoint!.pendingCount = pendingCount;
    chartPoint!.partialCount = partialCount;
    chartPoint!.pendingAssetIds = pendingAssetIds;
    chartPoint!.count = annotatedCount; // Use annotated count for backward compatibility
    chartPoint!.documents = [...new Set(chartPoint!.documents)];
  });
  
  // Set final aggregate fields
  const finalChartData = Array.from(allDatePoints.values()).map(chartPoint => {
    if (chartPoint.stats) {
      Object.entries(chartPoint.stats).forEach(([fieldKey, stats]) => {
        const finalMin = stats.min !== Infinity ? stats.min : null;
        const finalMax = stats.max !== -Infinity ? stats.max : null;
        const finalAvg = stats.count > 0 ? stats.avg : null;
        
        chartPoint[`${fieldKey}_min`] = finalMin;
        chartPoint[`${fieldKey}_max`] = finalMax;
        chartPoint[`${fieldKey}_avg`] = finalAvg;
      });
    }
    
    return chartPoint;
  });
  
  return finalChartData.sort((a, b) => a.timestamp - b.timestamp);
};

interface CustomTooltipProps extends TooltipProps<number, string> {
  keyToSplitValueMap: Map<string, string>;
  coordinate?: { x: number; y: number };
  viewBox?: { width: number; height: number; x: number; y: number };
}

// State to keep tooltip locked when user is interacting with it
let isTooltipLocked = false;
let lockedPayload: any = null;

const CustomTooltipContent = ({ active, payload, label, keyToSplitValueMap, coordinate, viewBox }: CustomTooltipProps) => {
  const [viewMode, setViewMode] = React.useState<'chart' | 'list'>('chart');
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = React.useState(false);
  
  // Calculate if we're near the right edge of the chart
  const isNearRightEdge = React.useMemo(() => {
    if (!coordinate || !viewBox) return false;
    const chartWidth = viewBox.width || 0;
    const cursorX = coordinate.x || 0;
    // Consider "near right edge" if we're in the last 25% of the chart
    return cursorX > (chartWidth * 0.75);
  }, [coordinate, viewBox]);
  
  // Store payload when we have it
  React.useEffect(() => {
    if (active && payload && payload.length > 0) {
      lockedPayload = payload;
    }
  }, [active, payload]);
  
  // Prevent tooltip from closing when interacting with it
  const handleMouseEnter = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsHovering(true);
    isTooltipLocked = true;
  }, []);
  
  const handleMouseLeave = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsHovering(false);
    // Small delay before unlocking to prevent flickering
    setTimeout(() => {
      isTooltipLocked = false;
    }, 100);
  }, []);
  
  // Keep tooltip open when clicking inside
  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);
  
  // Use locked payload if we're hovering over the tooltip
  const displayPayload = (isHovering && lockedPayload) || payload;
  
  if (!active && !isHovering) return null;
  if (!displayPayload || displayPayload.length === 0) return null;
    
  const pointData = displayPayload[0].payload;
  const tsDate = new Date(pointData.timestamp);
  const formattedDate = isNaN(tsDate.getTime()) ? String(pointData.timestamp ?? '') : format(tsDate, 'yyyy-MM-dd');
  const groups = new Map<string, any[]>();

  // Filter out annotation count and min/max statistical lines for cleaner display
  const filteredPayload = displayPayload.filter(pld => 
    pld.dataKey !== 'count' && 
    !String(pld.dataKey).endsWith('_min') && 
    !String(pld.dataKey).endsWith('_max')
  );

  filteredPayload.forEach(pld => {
      const splitValue = (pld.dataKey && keyToSplitValueMap.get(String(pld.dataKey))) || 'General';
      
      if (!groups.has(splitValue)) {
          groups.set(splitValue, []);
      }
      
      const cleanName = pld.name?.replace(`${splitValue} (`, '(').replace(')', '') || 'N/A';
      
      groups.get(splitValue)!.push({
          color: pld.color,
          name: cleanName,
          value: pld.value,
          dataKey: pld.dataKey
      });
  });

  // Calculate max value for bar chart scaling
  const allValues = Array.from(groups.values()).flat().map(item => Number(item.value) || 0);
  const maxValue = Math.max(...allValues, 1);

  return (
    <div 
      ref={tooltipRef}
      className="bg-card/95 bg-background/90 dark:bg-popover p-3 max-h-full overflow-y-auto overflow-x-hidden border-2 border-primary/20 rounded-lg shadow-xl text-sm text-popover-foreground pointer-events-auto "
      style={{ 
        position: 'relative',
        zIndex: 9999,
        // Shift left for most points, but shift right for rightmost points to prevent cutoff
        marginLeft: isNearRightEdge ? '-220px' : '-80px',
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
    >
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="flex gap-1 flex-shrink-0">
          <button
            onMouseDown={(e) => { 
              e.preventDefault();
              e.stopPropagation(); 
            }}
            onClick={(e) => { 
              e.preventDefault();
              e.stopPropagation(); 
              setViewMode('chart'); 
            }}
            className={cn(
              "px-2 py-0.5 text-[10px] rounded transition-colors cursor-pointer",
              viewMode === 'chart' 
                ? "bg-primary text-primary-foreground" 
                : "bg-muted hover:bg-muted/80"
            )}
            title="Bar chart view"
          >
            Chart
          </button>
          <button
            onMouseDown={(e) => { 
              e.preventDefault();
              e.stopPropagation(); 
            }}
            onClick={(e) => { 
              e.preventDefault();
              e.stopPropagation(); 
              setViewMode('list'); 
            }}
            className={cn(
              "px-2 py-0.5 text-[10px] rounded transition-colors cursor-pointer",
              viewMode === 'list' 
                ? "bg-primary text-primary-foreground" 
                : "bg-muted hover:bg-muted/80"
            )}
            title="List view"
          >
            List
          </button>
        </div>
        <p className="font-bold text-base flex-1 text-right">{formattedDate}</p>
      </div>
      
      {viewMode === 'chart' ? (
        // Bar chart visualization
        <div className="space-y-3">
          {Array.from(groups.entries()).map(([groupName, items]) => (
            <div key={groupName} className="space-y-1">
              {groups.size > 1 && <p className="font-semibold text-xs text-foreground mb-1">{groupName}</p>}
              {items.map((item, index) => {
                const percentage = maxValue > 0 ? (Number(item.value) / maxValue) * 100 : 0;
                return (
                  <div key={`bar-${index}`} className="space-y-0.5">
                    <div className="flex items-baseline justify-between text-xs">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <div 
                          style={{width: 8, height: 8, backgroundColor: item.color, flexShrink: 0}} 
                          className="rounded-sm"
                        />
                        <span className="truncate text-muted-foreground text-[11px]" title={item.name}>
                          {item.name}
                        </span>
                      </div>
                      <span className="font-bold ml-2 flex-shrink-0">{item.value}</span>
                    </div>
                    <div className="w-full bg-muted/30 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.max(percentage, 2)}%`,
                          backgroundColor: item.color
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        // Traditional list view
        <div className="space-y-2">
          {Array.from(groups.entries()).map(([groupName, items]) => (
            <div key={groupName} className="mb-2 last:mb-0">
              {groups.size > 1 && <p className="font-semibold text-sm text-foreground">{groupName}</p>}
              <div className="pl-2 mt-1 space-y-1">
                {items.map((item, index) => (
                  <div key={`tooltip-item-${index}`} className="flex items-center space-x-2">
                    <div style={{width: 8, height: 8, backgroundColor: item.color, borderRadius: '50%', flexShrink: 0}} />
                    <span className="flex-1 truncate text-muted-foreground text-xs" title={item.name}>{item.name}</span>
                    <span className="font-bold text-xs">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {pointData.documents && pointData.documents.length > 0 && (
        <p className="mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
          Based on {pointData.documents.length} document{pointData.documents.length > 1 ? 's' : ''} in this period.
        </p>
      )}
    </div>
  );
};

// === CUSTOM LEGEND COMPONENT ===
// Elegant legend that groups statistical variants (min/max/avg) with their base field

interface CustomLegendProps {
  payload?: any[];
  showStatistics: boolean;
}

const CustomLegend: React.FC<CustomLegendProps> = ({ payload, showStatistics }) => {
  if (!payload || payload.length === 0) return null;

  // Group fields by their base name (without _min/_max/_avg suffix)
  const fieldGroups = new Map<string, { 
    base: any; 
    stats: { min?: any; max?: any; avg?: any } 
  }>();

  payload.forEach(item => {
    const dataKey = String(item.dataKey || '');
    
    // Skip annotation count
    if (dataKey === 'count') return;
    
    // Check if this is a statistical variant
    const minMatch = dataKey.match(/^(.+)_min$/);
    const maxMatch = dataKey.match(/^(.+)_max$/);
    const avgMatch = dataKey.match(/^(.+)_avg$/);
    
    if (showStatistics && minMatch) {
      const baseKey = minMatch[1];
      if (!fieldGroups.has(baseKey)) {
        fieldGroups.set(baseKey, { base: null, stats: {} });
      }
      fieldGroups.get(baseKey)!.stats.min = item;
    } else if (showStatistics && maxMatch) {
      const baseKey = maxMatch[1];
      if (!fieldGroups.has(baseKey)) {
        fieldGroups.set(baseKey, { base: null, stats: {} });
      }
      fieldGroups.get(baseKey)!.stats.max = item;
    } else if (showStatistics && avgMatch) {
      const baseKey = avgMatch[1];
      if (!fieldGroups.has(baseKey)) {
        fieldGroups.set(baseKey, { base: null, stats: {} });
      }
      fieldGroups.get(baseKey)!.stats.avg = item;
    } else {
      // Base field
      if (!fieldGroups.has(dataKey)) {
        fieldGroups.set(dataKey, { base: item, stats: {} });
      } else {
        fieldGroups.get(dataKey)!.base = item;
      }
    }
  });

  return (
    <div className="flex flex-wrap justify-center gap-x-6 gap-y-3 px-4 py-3">
      {Array.from(fieldGroups.entries()).map(([baseKey, group]) => {
        if (!group.base) return null;
        
        const hasStats = showStatistics && (group.stats.min || group.stats.max || group.stats.avg);
        const displayName = group.base.value?.length > 35 
          ? group.base.value.substring(0, 32) + '...' 
          : group.base.value;

        return (
          <div key={baseKey} className="flex items-center gap-2">
            {/* Main field indicator */}
            <div className="flex items-center gap-1.5">
              <div
                className="w-4 h-[3px] rounded-sm"
                style={{ backgroundColor: group.base.color }}
              />
              <span className="text-xs font-medium leading-tight">{displayName}</span>
            </div>
            
            {/* Statistical variants indicator - elegant grouped display */}
            {hasStats && (
              <div className="flex items-center gap-1 ml-0.5 pl-2 border-l border-border/50">
                <div className="flex flex-col gap-[2px] items-center">
                  {/* Visual bars for min/avg/max */}
                  <div className="flex items-end gap-[3px] h-4">
                    {group.stats.min && (
                      <div 
                        className="w-[4px] h-[8px] rounded-sm"
                        style={{ backgroundColor: group.base.color, opacity: 0.45 }}
                        title="Minimum value line"
                      />
                    )}
                    {group.stats.avg && (
                      <div 
                        className="w-[4px] h-[14px] rounded-sm"
                        style={{ backgroundColor: group.base.color, opacity: 0.75 }}
                        title="Average value line"
                      />
                    )}
                    {group.stats.max && (
                      <div 
                        className="w-[4px] h-[8px] rounded-sm"
                        style={{ backgroundColor: group.base.color, opacity: 0.45 }}
                        title="Maximum value line"
                      />
                    )}
                  </div>
                  {/* Connecting line */}
                  <div 
                    className="w-full h-[1.5px] opacity-35"
                    style={{ backgroundColor: group.base.color }}
                  />
                </div>
                <span className="text-[9px] text-muted-foreground ml-0.5 leading-none font-medium">range</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// === ENHANCED VARIABLE SPLITTING SYSTEM ===
// Single-pass data processing with unified field detection

// Enhanced data structures for cleaner processing
interface ProcessedFieldData {
  key: string;          // The full field key used in chart data
  groupName?: string;   // Group name for splitting (undefined for non-splitting)  
  schemaName: string;   // Schema name
  fieldName: string;    // Field name
  displayName: string;  // Human-readable name for legend
  type: string;         // Field type
  hasData: boolean;     // Whether this field has any data
}

interface ProcessedChartData {
  type: 'splitting' | 'no-splitting' | 'grouped' | 'grouped-splitting';
  chartData: ChartDataPoint[] | GroupedDataPoint[] | Record<string, GroupedDataPoint[]>;
  fields: ProcessedFieldData[];
  groups: string[];     // Available group names (empty for non-splitting)
  debugInfo: {
    processedGroups: string[];
    totalDataPoints: number;
    fieldsPerGroup: Record<string, number>;
  };
}

// === MAIN COMPONENT === //
const AnnotationResultsChart: React.FC<Props> = ({
  infospaceId,
  runId,
  schemas,
  panelConfig,
  onUpdatePanel,
  showControls = true,
  onResultSelect,
  onFieldInteraction,
  highlightedTimestamp = null,
  onScopeGesture,
}) => {
  // Derive aggregation config from panel
  const aggregation = panelConfig.aggregation;

  // Server-side data fetching
  const mergedFilters = useMemo(
    () => mergeFiltersAndScopes(panelConfig.local_filters, panelConfig.incoming_scopes),
    [panelConfig.local_filters, panelConfig.incoming_scopes],
  );

  // The schema we infer field shapes against. Matches the resolution used by
  // the RolePicker (settings.selectedSchemaId, falling back to the sole schema).
  const selectedSchemaForRoles = useMemo(() => {
    const id = panelConfig.settings?.selectedSchemaId as number | undefined;
    if (id != null) return schemas.find((s) => s.id === id) ?? null;
    return schemas.length === 1 ? schemas[0] : null;
  }, [panelConfig.settings?.selectedSchemaId, schemas]);

  // All Y paths. Each numeric entry becomes its own measure → one parallel
  // /view fetch → one Line on the chart. Non-numeric entries route to
  // ``split_by`` (single value only; the backend split_by is 1-D today).
  const yPaths = useMemo<string[]>(() => {
    const ym = panelConfig.projection?.field_mappings?.['y'];
    if (Array.isArray(ym)) return ym.map(String).filter(Boolean);
    if (typeof ym === 'string' && ym.length > 0) return [ym];
    return [];
  }, [panelConfig.projection]);

  const yFirstPath = yPaths[0];

  const yShape = useMemo(
    () => (yFirstPath ? inferFieldShape(selectedSchemaForRoles, yFirstPath) : null),
    [yFirstPath, selectedSchemaForRoles],
  );
  const yIsNumeric = yShape === 'number';

  // Numeric Y paths become measures (one fetch per path). Non-numeric Y
  // falls through to split_by below. Mixed types get the numeric entries as
  // measures and the first non-numeric as split_by.
  const yNumericPaths = useMemo<string[]>(() => {
    return yPaths.filter((p) => inferFieldShape(selectedSchemaForRoles, p) === 'number');
  }, [yPaths, selectedSchemaForRoles]);

  // split_by: explicit `group_by` role wins (Split by); else the first
  // non-numeric Y auto-routes here so picking Y=stance produces multi-series
  // instead of a single useless count. Numeric Ys become value_fields below.
  const splitByField = useMemo<string | undefined>(() => {
    const groupByRole = panelConfig.projection?.field_mappings?.['group_by'] as string | undefined;
    if (groupByRole) return groupByRole;
    const firstNonNumeric = yPaths.find(
      (p) => inferFieldShape(selectedSchemaForRoles, p) !== 'number',
    );
    if (firstNonNumeric) return firstNonNumeric;
    return undefined;
  }, [panelConfig.projection, yPaths, selectedSchemaForRoles]);

  // --- UI state (must be declared before useAnnotationView which reads them) ---
  const initialSettings = panelConfig.settings;
  const [isGrouped, setIsGrouped] = useState(initialSettings?.isGrouped ?? false);
  const [selectedTimeInterval, setSelectedTimeInterval] = useState<'day' | 'week' | 'month' | 'quarter' | 'year'>(
    (aggregation.interval as any) || initialSettings?.selectedTimeInterval || 'month'
  );
  const [groupingSchemeId, setGroupingSchemeId] = useState<number | null>(
    initialSettings?.groupingSchemeId ?? (schemas.length > 0 ? schemas[0].id : null)
  );
  const [groupingFieldKey, setGroupingFieldKey] = useState<string | null>(() => {
    if (initialSettings?.groupingFieldKey) return initialSettings.groupingFieldKey;
    if (schemas.length > 0) {
      const availableFields = getTargetKeysForScheme(schemas[0].id, schemas);
      return availableFields.length > 0 ? availableFields[0].key : null;
    }
    return null;
  });
  const [groupedSortOrder, setGroupedSortOrder] = useState<'count-desc' | 'value-asc' | 'value-desc'>(
    initialSettings?.groupedSortOrder || 'count-desc'
  );

  // Single source of truth for what we ask the backend to compute. We derive
  // this from current state — picker selections, isGrouped toggle, grouping
  // controls, selectedTimeInterval — instead of reading a saved aggregation
  // blob, so toggling Grouped or changing X never collides with stale state
  // written by a different code path. `aggregation` from panelConfig is read
  // only for hints (function preference, value_field carryover).
  const aggregateConfig = useMemo((): AggregateConfig | undefined => {
    // Grouped (categorical) mode: count rows per category. Picker x is
    // ignored — the categorical field is chosen via the Grouped controls.
    if (isGrouped) {
      if (!groupingFieldKey) return undefined;
      // If the chosen field is array-typed, append ``[*]`` so the backend
      // explodes array elements into individual rows. Without this, each
      // distinct stringified array becomes its own bucket (count=1 each).
      // The shape lookup matches whichever schema actually owns the path —
      // grouped mode doesn't constrain to `selectedSchemaForRoles`.
      let groupByPath = groupingFieldKey;
      if (!groupByPath.includes('[*]')) {
        const owningSchema = schemas.find((s) =>
          s.id === groupingSchemeId,
        ) ?? selectedSchemaForRoles ?? null;
        const shape = inferFieldShape(owningSchema, groupingFieldKey);
        if (shape === 'array_string' || shape === 'array_string_enum' ||
            shape === 'array_number' || shape === 'array_object') {
          groupByPath = `${groupingFieldKey}[*]`;
        }
      }
      return {
        group_by: groupByPath,
        interval: null,
        function: 'count',
        value_field: null,
        top_n: aggregation.top_n || null,
        split_by: null,
      };
    }

    // Timeline mode: picker x drives bucketing. Date X auto-applies the
    // selected interval; non-date X buckets by raw value. One numeric Y
    // becomes the sole measure (single fetch); multi-numeric Y routes
    // through ``aggregateConfigs`` below (one fetch per measure, merged).
    const xPath = panelConfig.projection?.field_mappings?.['x'] as string | undefined;
    if (!xPath) return undefined;
    if (yNumericPaths.length > 1) return undefined;  // multi-measure path
    const xShape = inferFieldShape(selectedSchemaForRoles, xPath);
    const xIsDate = xShape === 'date';
    const fn = yIsNumeric
      ? (aggregation.function && aggregation.function !== 'count' ? aggregation.function : 'sum')
      : 'count';
    const valueField = yIsNumeric ? (yFirstPath ?? null) : (aggregation.value_field || null);
    // Only apply a bucketing interval when X is a declared date OR the user
    // explicitly picked one (covers the case where schema forgot
    // ``format: date-time`` on a string that actually holds ISO timestamps).
    // Never default to ``day`` on a string/number X — would crash
    // ``date_trunc`` on non-parseable values (e.g. ``subject_name = "Bundesländer"``).
    const explicitInterval = (aggregation.interval as any) || undefined;
    const interval = explicitInterval ?? (xIsDate ? 'day' : null);
    return {
      group_by: xPath,
      interval,
      function: fn,
      value_field: valueField,
      top_n: aggregation.top_n || null,
      split_by: splitByField || null,
    };
  }, [
    isGrouped,
    groupingFieldKey,
    groupingSchemeId,
    schemas,
    panelConfig.projection,
    selectedSchemaForRoles,
    selectedTimeInterval,
    yIsNumeric,
    yFirstPath,
    yNumericPaths,
    splitByField,
    aggregation.interval,
    aggregation.function,
    aggregation.value_field,
    aggregation.top_n,
  ]);

  // Multi-measure mode: one AggregateConfig per numeric Y path. Fires
  // parallel ``/view`` fetches in ``useAnnotationView``; returned buckets are
  // merged by key so every bucket carries all measures' stats.
  const aggregateConfigs = useMemo<AggregateConfig[] | undefined>(() => {
    if (isGrouped) return undefined;
    if (yNumericPaths.length <= 1) return undefined;
    const xPath = panelConfig.projection?.field_mappings?.['x'] as string | undefined;
    if (!xPath) return undefined;
    const xShape = inferFieldShape(selectedSchemaForRoles, xPath);
    const xIsDate = xShape === 'date';
    const fn = aggregation.function && aggregation.function !== 'count'
      ? aggregation.function : 'sum';
    // Same guard as the singular path — never apply an interval to a
    // non-date X unless the user explicitly picked one.
    const explicitInterval = (aggregation.interval as any) || undefined;
    const interval = explicitInterval ?? (xIsDate ? 'day' : null);
    return yNumericPaths.map((path) => ({
      group_by: xPath,
      interval,
      function: fn,
      value_field: path,
      top_n: aggregation.top_n || null,
      split_by: null,
    }));
  }, [
    isGrouped,
    yNumericPaths,
    panelConfig.projection,
    selectedSchemaForRoles,
    selectedTimeInterval,
    aggregation.interval,
    aggregation.function,
    aggregation.top_n,
  ]);

  // Value-alias store readers — must come before any memo that reads
  // `runWideAliasesByField` (TDZ otherwise on first render).
  const [aliasManagerOpen, setAliasManagerOpen] = useState(false);
  const getGlobalVariableSplitting = useAnnotationRunStore(s => s.getGlobalVariableSplitting);
  const setGlobalVariableSplitting = useAnnotationRunStore(s => s.setGlobalVariableSplitting);
  const gvs = getGlobalVariableSplitting();
  const runWideAliasesByField = gvs?.valueAliasesByField ?? {};
  const aliasTargetField = (
    (panelConfig.projection?.field_mappings?.['group_by'] as string | undefined) ??
    (panelConfig.projection?.field_mappings?.['x'] as string | undefined)
  ) ?? null;
  const aliasesForField = aliasTargetField ? runWideAliasesByField[aliasTargetField] ?? {} : {};

  const effectiveMergeMapsForView = useMemo(
    () => effectiveMergeMaps(panelConfig.merge_maps, runWideAliasesByField),
    [panelConfig.merge_maps, runWideAliasesByField],
  );

  const { data: viewData, isLoading: isViewLoading } = useAnnotationView({
    infospaceId,
    runId,
    aggregate: aggregateConfigs ? undefined : aggregateConfig,
    aggregates: aggregateConfigs,
    filters: mergedFilters,
    merge_maps: effectiveMergeMapsForView,
    schema_ids: isGrouped && groupingSchemeId ? [groupingSchemeId] : undefined,
    enabled:
      !!runId && !!infospaceId && (!!aggregateConfig || (aggregateConfigs?.length ?? 0) > 0),
  });

  // Parallel rows fetch — lets us show the legacy ``ChartDialogDetails``
  // panel on bucket click with real annotations + assets (the dialog reads
  // ``results``/``assets`` which were permanent empty stubs in the
  // server-aggregate rewrite). Compact limit: one dialog renders ≤ a few
  // dozen docs; 500 rows is a generous cap for a typical run.
  const { data: rowsViewData } = useAnnotationView({
    infospaceId,
    runId,
    rows: { limit: 500 },
    filters: mergedFilters,
    merge_maps: effectiveMergeMapsForView,
    schema_ids: isGrouped && groupingSchemeId ? [groupingSchemeId] : undefined,
    enabled: !!runId && !!infospaceId,
  });

  // Map server buckets to chart data format.
  //
  // When the backend carries a `split_field_path`, rows arrive as pairs of
  // (date, split_value) → count. We pivot so each date has one ChartDataPoint
  // with keys `grp:<value>` per distinct split value, plus `count` = total.

  // For each fetched result, figure out which bucket key it belongs to so
  // clicking a bucket in the chart can surface the real annotations
  // (``selectedPoint.documents``). We recompute the interval-normalized
  // bucket start in JS to mirror PostgreSQL's ``date_trunc`` — that's what
  // the backend key is. (Built from ``rowsViewData`` directly rather than
  // closing over ``results`` to avoid TDZ — ``results`` is declared below.)
  const bucketAssetsByKey = useMemo(() => {
    const map = new Map<string, Set<number>>();
    const rawItems = rowsViewData?.rows?.items;
    if (!rawItems || rawItems.length === 0) return map;
    const xPath = panelConfig.projection?.field_mappings?.['x'] as string | undefined;
    const interval = (panelConfig.aggregation?.interval as string | undefined)
      ?? (selectedTimeInterval as string | undefined);

    const normalizeDate = (raw: any): string | null => {
      const d = new Date(raw as any);
      if (isNaN(d.getTime())) return null;
      if (!interval) return String(raw);
      let start: Date;
      switch (interval) {
        case 'year':    start = startOfYear(d); break;
        case 'quarter': start = startOfQuarter(d); break;
        case 'month':   start = startOfMonth(d); break;
        case 'week':    start = startOfWeek(d, { weekStartsOn: 1 }); break;
        case 'day':
        default:        start = startOfDay(d); break;
      }
      return String(start.getTime());
    };

    const xKeysForRow = (value: any, timestamp: string | undefined): string[] => {
      if (isGrouped) {
        if (!groupingFieldKey) return [];
        const vs = getAnnotationFieldValuesExploded(value, groupingFieldKey);
        return vs.map((v) => String(v));
      }
      if (!xPath) return [];
      const rawValues = getAnnotationFieldValuesExploded(value, xPath);
      const source = rawValues.length > 0 ? rawValues : (timestamp != null ? [timestamp] : []);
      const out: string[] = [];
      for (const raw of source) {
        const k = normalizeDate(raw);
        if (k != null) out.push(k);
      }
      return out;
    };

    for (const r of rawItems) {
      const keys = xKeysForRow(r.value, r.timestamp);
      for (const k of keys) {
        let bucket = map.get(k);
        if (!bucket) { bucket = new Set<number>(); map.set(k, bucket); }
        bucket.add(r.asset_id);
      }
    }
    return map;
  }, [
    rowsViewData?.rows?.items, isGrouped, groupingFieldKey,
    panelConfig.projection, panelConfig.aggregation?.interval, selectedTimeInterval,
  ]);

  const bucketLookupKey = useCallback((bucket: { key: string }): string => {
    if (isGrouped) return bucket.key;
    const d = new Date(bucket.key);
    if (isNaN(d.getTime())) return bucket.key;
    return String(d.getTime());
  }, [isGrouped]);

  const { serverChartData, groupValues } = useMemo((): {
    serverChartData: ChartDataPoint[];
    groupValues: string[];
  } => {
    // While a fetch is in flight, viewData still holds the previous query's
    // buckets — rendering them against the new mode (e.g. toggled Grouped)
    // produces a transient wrong view. Treat loading as no-data here; the
    // empty-state / fallback paths take over until the new fetch lands.
    if (isViewLoading) return { serverChartData: [], groupValues: [] };
    const buckets = viewData?.aggregate?.buckets;
    if (!buckets || buckets.length === 0) return { serverChartData: [], groupValues: [] };

    // Drop buckets whose key isn't a parseable date — backend bucket keys for a
    // date axis are ISO strings; anything else (empty key from NULL field, a
    // categorical string keyed onto a date axis by mistake) would silently
    // collapse to epoch 0 and stack as a phantom 1970 bar.
    const isSplit = !!viewData?.aggregate?.split_field_path;
    if (!isSplit) {
      const points: ChartDataPoint[] = [];
      for (const bucket of buckets) {
        const ts = new Date(bucket.key).getTime();
        if (Number.isNaN(ts)) continue;
        // Flatten stats: backend returns {fieldPath: {fnName: value}} for the
        // value_field. Hoist the metric to a top-level key so chart Lines /
        // Bars can render it via dataKey. Recharts resolves dataKey via
        // lodash `get`, which treats dots as nested-path lookup — so a
        // dotted fieldPath like ``document.price`` written as a literal key
        // is invisible to it. Encode dots as ``__`` before use.
        const flatMetrics: Record<string, number> = {};
        if (bucket.stats) {
          for (const [k, v] of Object.entries(bucket.stats)) {
            const safeKey = encodeMetricKey(k);
            for (const fnVal of Object.values(v as any)) {
              if (typeof fnVal === 'number') { flatMetrics[safeKey] = fnVal; break; }
            }
          }
        }
        const docs = Array.from(bucketAssetsByKey.get(bucketLookupKey(bucket)) ?? []);
        points.push({
          timestamp: ts,
          dateString: bucket.key,
          count: bucket.count,
          documents: docs,
          ...flatMetrics,
          stats: bucket.stats ? Object.fromEntries(
            Object.entries(bucket.stats).map(([k, v]) => [k, { min: 0, max: 0, avg: 0, count: bucket.count, ...(v as any) }])
          ) : undefined,
        });
      }
      return { serverChartData: points, groupValues: [] };
    }

    // Pivot: { dateString: { 'grp:<value>': count, count: total } }
    const byDate = new Map<string, ChartDataPoint>();
    const groups = new Set<string>();
    for (const bucket of buckets) {
      const ts = new Date(bucket.key).getTime();
      if (Number.isNaN(ts)) continue;
      const splitVal = bucket.split_value ?? '(none)';
      groups.add(splitVal);
      let point = byDate.get(bucket.key);
      if (!point) {
        point = {
          timestamp: ts,
          dateString: bucket.key,
          count: 0,
          documents: [],
        };
        byDate.set(bucket.key, point);
      }
      point[`grp:${splitVal}`] = bucket.count;
      point.count += bucket.count;
    }
    const sorted = Array.from(byDate.values()).sort((a, b) => a.timestamp - b.timestamp);
    // Sort group values by total count desc for stable legend order.
    const groupTotals = new Map<string, number>();
    for (const bucket of buckets) {
      const sv = bucket.split_value ?? '(none)';
      groupTotals.set(sv, (groupTotals.get(sv) ?? 0) + bucket.count);
    }
    const rankedGroups = Array.from(groups).sort(
      (a, b) => (groupTotals.get(b) ?? 0) - (groupTotals.get(a) ?? 0),
    );
    return { serverChartData: sorted, groupValues: rankedGroups };
  }, [viewData?.aggregate?.buckets, viewData?.aggregate?.split_field_path, isViewLoading]);

  // High-cardinality guard: many groups produce unreadable charts. Past 20,
  // show a warning and truncate to the top-N (backend already returns all;
  // we slice in the renderer so the user can lift the cap if needed).
  const HIGH_CARDINALITY_THRESHOLD = 20;
  const hasHighCardinality = groupValues.length > HIGH_CARDINALITY_THRESHOLD;
  const maxGroupsToRender = (panelConfig.settings?.maxGroupsToRender as number | undefined) ?? HIGH_CARDINALITY_THRESHOLD;
  const renderedGroupValues = hasHighCardinality
    ? groupValues.slice(0, maxGroupsToRender)
    : groupValues;

  // Legend visibility — default all groups visible.
  const [hiddenGroupValues, setHiddenGroupValues] = useState<Set<string>>(new Set());
  const toggleGroupVisibility = useCallback((value: string) => {
    setHiddenGroupValues(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  // Auto-detect date field for timeline mode
  const autoDateField = useMemo(() => {
    for (const schema of schemas) {
      const dateFields = getDateFieldsForScheme(schema.id, schemas);
      if (dateFields.length > 0) return { schemaId: schema.id, fieldKey: dateFields[0].key };
    }
    return null;
  }, [schemas]);

  // Stable ref for panelConfig (used by handlers to persist UI changes)
  const chartPanelConfigRef = useRef(panelConfig);
  chartPanelConfigRef.current = panelConfig;

  // Persist UI → panelConfig on user interaction (no auto-sync effects).
  // Settings only — `aggregateConfig` is now derived from settings + picker
  // every render, so writing aggregation here would just race with itself
  // and clobber whatever the picker set.
  const persistChartState = useCallback((localUpdates: {
    isGrouped?: boolean;
    selectedTimeInterval?: 'day' | 'week' | 'month' | 'quarter' | 'year';
    groupingSchemeId?: number | null;
    groupingFieldKey?: string | null;
    groupedSortOrder?: 'count-desc' | 'value-asc' | 'value-desc';
  }) => {
    const pc = chartPanelConfigRef.current;
    const newSettings = {
      ...(pc.settings || {}),
      ...(localUpdates.isGrouped !== undefined ? { isGrouped: localUpdates.isGrouped } : {}),
      ...(localUpdates.selectedTimeInterval !== undefined ? { selectedTimeInterval: localUpdates.selectedTimeInterval } : {}),
      ...(localUpdates.groupingSchemeId !== undefined ? { groupingSchemeId: localUpdates.groupingSchemeId ?? undefined } : {}),
      ...(localUpdates.groupingFieldKey !== undefined ? { groupingFieldKey: localUpdates.groupingFieldKey ?? undefined } : {}),
      ...(localUpdates.groupedSortOrder !== undefined ? { groupedSortOrder: localUpdates.groupedSortOrder } : {}),
    };
    onUpdatePanel({ settings: newSettings });
  }, [onUpdatePanel]);

  // Compatibility shims for rendering code that still references these
  const results = useMemo<FormattedAnnotation[]>(() => {
    if (!rowsViewData?.rows?.items) return [];
    return rowsViewData.rows.items.map((row) => ({
      id: row.annotation_id,
      asset_id: row.asset_id,
      schema_id: row.schema_id,
      run_id: row.run_id,
      value: row.value,
      timestamp: row.timestamp,
      status: row.status as any,
    }));
  }, [rowsViewData?.rows?.items]);
  const assets = useMemo<AssetRead[]>(() => {
    if (!rowsViewData?.rows?.assets) return [];
    return Object.values(rowsViewData.rows.assets).map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      parent_asset_id: s.parent_asset_id,
    } as AssetRead));
  }, [rowsViewData?.rows?.assets]);
  const sources = useMemo<{ id: number; name: string }[]>(() => [], []);
  const [analysisData] = useState<any[] | null>(null);
  const [timeAxisConfig] = useState<TimeAxisConfig | null>(null);
  const aggregateSourcesDefault = true;
  const selectedDataSourceIds: number[] = [];
  const [variableSplittingConfig] = useState<VariableSplittingConfig | null>(null);
  const onVariableSplittingChange: ((config: VariableSplittingConfig | null) => void) | undefined = undefined;
  const chartSettingsRef = useRef(panelConfig.settings);
  chartSettingsRef.current = panelConfig.settings;
  const onSettingsChange = useCallback((settings: any) => {
    onUpdatePanel({ settings: { ...chartSettingsRef.current, ...settings } });
  }, [onUpdatePanel]);
  const monitoringMode = false;
  const allAssets = useMemo<AssetRead[]>(() => [], []);
  const expectedSchemaIds: number[] = [];
  const showPendingAssetsProp: boolean | undefined = undefined;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let onShowPendingChange: ((show: boolean) => void) | undefined;
  const arrayHandling: 'aggregate' | 'explode' = 'aggregate';
  const [aggregateSources, setAggregateSources] = useState(aggregateSourcesDefault);
  const [arrayHandlingState, setArrayHandlingState] = useState<'aggregate' | 'explode'>(arrayHandling);
  const [selectedPoint, setSelectedPoint] = useState<ChartDataPoint | GroupedDataPoint | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  // --- Statistical visualization controls ---
  const [showStatistics, setShowStatistics] = useState(false);
  const [showAnnotationBars, setShowAnnotationBars] = useState(true);
  const [selectedSchemaIds, setSelectedSchemaIds] = useState<number[]>(() => 
    schemas.map(s => s.id)
  );
  
  // --- SIMPLIFIED STATE: Only individual field visibility ---
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());

  // --- RolePicker wiring -------------------------------------------------
  // The RolePicker is the canonical surface for configuring the chart.
  // Its value is derived from `projection.field_mappings` + `aggregation` +
  // `settings.selectedSchemaId`; onChange writes back through `onUpdatePanel`
  // so every control in the panel agrees on one source of truth.
  const rolePickerValue = useMemo<RolePickerValue>(() => {
    const fieldsByRole: Record<string, string[]> = {};
    const mapping = panelConfig.projection?.field_mappings ?? {};
    for (const [key, val] of Object.entries(mapping)) {
      if (Array.isArray(val)) fieldsByRole[key] = val.map(String);
      else if (typeof val === 'string' && val.length > 0) fieldsByRole[key] = [val];
    }
    const explosionPath = panelConfig.projection?.explosion ?? null;
    const explosionByRole: Record<string, string | null> = {};
    if (explosionPath) {
      // The explosion belongs to whichever role references a path containing it.
      for (const [key, paths] of Object.entries(fieldsByRole)) {
        if (paths.some((p) => p.startsWith(explosionPath.replace(/\[\*\]$/, '')))) {
          explosionByRole[key] = explosionPath;
          break;
        }
      }
    }
    return {
      schemaId:
        (panelConfig.settings?.selectedSchemaId as number | undefined) ??
        (schemas.length === 1 ? schemas[0].id : null),
      fieldsByRole,
      explosionByRole,
      aggregation: panelConfig.aggregation ?? {},
    };
  }, [panelConfig.projection, panelConfig.aggregation, panelConfig.settings?.selectedSchemaId, schemas]);

  // Value-alias wiring: declared above (TDZ guard). The manager targets
  // whichever field is the primary categorical axis (x for bar, group_by
  // when grouping; the x date field is not a useful alias target → guarded).

  const handleRolePickerChange = useCallback((next: RolePickerValue) => {
    // Fold role → field_mappings, pick the first non-empty explosion as the
    // projection.explosion, then derive the aggregation contract from role
    // semantics. Y stays in projection — splitByField / aggregateConfig below
    // resolve it based on shape (numeric → value_field, enum → split_by).
    const field_mappings: Record<string, string | string[]> = {};
    for (const [role, paths] of Object.entries(next.fieldsByRole)) {
      if (paths.length === 0) continue;
      field_mappings[role] = paths.length > 1 ? paths : paths[0];
    }
    const firstExplosion = Object.values(next.explosionByRole).find((e) => !!e) ?? null;
    const projection = { field_mappings, explosion: firstExplosion };

    const xPath = next.fieldsByRole['x']?.[0] ?? null;
    const groupByPath = next.fieldsByRole['group_by']?.[0] ?? null;

    // Resolve X shape — used only to seed a sensible default interval for
    // date-typed X. Schema author may forget `format: date-time` on a string
    // field that actually holds dates (e.g. our `document.timestamp` is just
    // `type: string`); shape detection is heuristic, so we always honor an
    // explicit picker `interval` even when xIsDate is false. Backend will
    // surface a cast error if the values aren't parseable.
    const selectedSchema = next.schemaId
      ? schemas.find((s) => s.id === next.schemaId) ?? null
      : (schemas.length === 1 ? schemas[0] : null);
    const xIsDate = xPath ? inferFieldShape(selectedSchema, xPath) === 'date' : false;

    const explicitInterval = next.aggregation?.interval ?? panelConfig.aggregation?.interval;
    // Default interval only when X IS a date; never invent one for a string
    // / number / enum X — the aggregate SQL would date_trunc on the raw
    // value and crash. If the user explicitly picked an interval we honor
    // it regardless (schema may have missed ``format: date-time``).
    const aggregation = {
      ...(panelConfig.aggregation ?? {}),
      ...(next.aggregation ?? {}),
      group_by: xPath ?? groupByPath ?? next.aggregation?.group_by ?? undefined,
      interval: explicitInterval
        ?? (panelConfig.settings?.selectedTimeInterval as any)
        ?? (xIsDate ? 'day' : undefined),
      function: next.aggregation?.function ?? panelConfig.aggregation?.function ?? 'count',
    };

    onUpdatePanel({
      projection,
      aggregation,
      settings: {
        ...(panelConfig.settings ?? {}),
        selectedSchemaId: next.schemaId ?? undefined,
        selectedTimeInterval:
          (aggregation.interval as 'day' | 'week' | 'month' | 'quarter' | 'year' | undefined) ??
          (panelConfig.settings?.selectedTimeInterval as any),
      },
    });
  }, [onUpdatePanel, panelConfig.aggregation, panelConfig.settings, schemas]);

  // --- Monitoring mode state ---
  const [showPendingAssets, setShowPendingAssets] = useState(showPendingAssetsProp ?? true);
  
  // Update local state when prop changes
  useEffect(() => {
    if (showPendingAssetsProp !== undefined) {
      setShowPendingAssets(showPendingAssetsProp);
    }
  }, [showPendingAssetsProp]);
  
  const handleShowPendingChange = (show: boolean) => {
    setShowPendingAssets(show);
    if (onShowPendingChange) {
      onShowPendingChange(show);
    }
  };
  
  // --- Line continuity: Always connect nulls for better timeline visualization ---

  const assetsMap = useMemo(() => {
    const map = new Map(assets.map(asset => [asset.id, asset]));
    // In monitoring mode, also include allAssets
    if (monitoringMode && allAssets.length > 0) {
      allAssets.forEach(asset => {
        if (!map.has(asset.id)) {
          map.set(asset.id, asset);
        }
      });
    }
    return map;
  }, [assets, monitoringMode, allAssets]);
  const sourceNameMap = useMemo(() => new Map(sources.map(s => [s.id, s.name || `Source ${s.id}`])), [sources]);
  
  // Auto-select first field when grouping schema changes
  useEffect(() => {
    if (groupingSchemeId) {
      const availableFields = getTargetKeysForScheme(groupingSchemeId, schemas);
      // Only update if current field is not valid for this schema
      if (!groupingFieldKey || !availableFields.some(f => f.key === groupingFieldKey)) {
        setGroupingFieldKey(availableFields.length > 0 ? availableFields[0].key : null);
      }
    }
  }, [groupingSchemeId, schemas]);
  
  // Smart date field detection: If using 'default' timestamp but schemas have date fields, auto-switch
  useEffect(() => {
    if (!timeAxisConfig || timeAxisConfig.type !== 'default' || schemas.length === 0) return;
    
    // Try to find a date field in any schema
    for (const schema of schemas) {
      const dateFields = getDateFieldsForScheme(schema.id, schemas);
      if (dateFields.length > 0) {
        // Found a date field - update timeAxisConfig to use it
        const firstDateField = dateFields[0];
        if (onSettingsChange) {
          console.log(`[Chart] Auto-detected date field: ${firstDateField.name} (${firstDateField.key}) in schema ${schema.name}`);
          onSettingsChange({
            timeAxisConfig: {
              type: 'schema' as const,
              schemaId: schema.id,
              fieldKey: firstDateField.key,
              timeFrame: timeAxisConfig.timeFrame || { enabled: false }
            }
          });
        }
        break; // Use first schema with date fields
      }
    }
  }, [timeAxisConfig?.type, schemas, onSettingsChange]);

  const resultsForChart = useMemo(() => {
    let filteredResults = results;
    
    // Apply source filtering
    if (selectedDataSourceIds && selectedDataSourceIds.length > 0) {
      const assetIdToSourceId = new Map(assets.map(a => [a.id, a.source_id]));
      filteredResults = filteredResults.filter(r => {
        const sourceId = assetIdToSourceId.get(r.asset_id);
        return sourceId !== undefined && selectedDataSourceIds.includes(sourceId ?? 0);
      });
    }
    
    // Apply time frame filtering if configured
    if (timeAxisConfig?.timeFrame?.enabled && timeAxisConfig.timeFrame.startDate && timeAxisConfig.timeFrame.endDate) {
      const { startDate, endDate } = timeAxisConfig.timeFrame;
      
      // Ensure startDate and endDate are Date objects
      const startDateObj = startDate instanceof Date ? startDate : new Date(startDate);
      const endDateObj = endDate instanceof Date ? endDate : new Date(endDate);
      
      // Validate that the dates are valid
      if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
        console.warn('Invalid date range in timeAxisConfig:', { startDate, endDate });
        return filteredResults; // Skip time filtering if dates are invalid
      }
      
      const assetIdToAsset = new Map(assets.map(a => [a.id, a]));
      
      filteredResults = filteredResults.filter(result => {
        const timestamp = getTimestamp(result, assetIdToAsset, timeAxisConfig);
        if (!timestamp) return false;
        
        return timestamp >= startDateObj && timestamp <= endDateObj;
      });
    }
    
    // NEW: Explode arrays if configured
    if (arrayHandlingState === 'explode' && timeAxisConfig?.fieldKey) {
      filteredResults = explodeArrayResults(filteredResults, timeAxisConfig);
    }
    
    return filteredResults;
  }, [
    results, 
    selectedDataSourceIds, 
    assets, 
    timeAxisConfig?.timeFrame?.enabled,
    // Safe handling of date dependencies - convert to timestamps or use string representation
    timeAxisConfig?.timeFrame?.startDate instanceof Date ? timeAxisConfig.timeFrame.startDate.getTime() : String(timeAxisConfig?.timeFrame?.startDate || ''),
    timeAxisConfig?.timeFrame?.endDate instanceof Date ? timeAxisConfig.timeFrame.endDate.getTime() : String(timeAxisConfig?.timeFrame?.endDate || ''),
    timeAxisConfig?.type,
    timeAxisConfig?.schemaId,
    timeAxisConfig?.fieldKey,
    arrayHandlingState // NEW: Include arrayHandlingState in dependencies
  ]);

  // === UNIFIED DATA PROCESSING: Prefer server aggregate data, fall back to client-side ===
  const processedData = useMemo((): ProcessedChartData => {
    // While a fetch is in flight, `viewData` still holds the previous query's
    // buckets. Rendering them against the current mode (e.g. after toggling
    // Grouped) paints the wrong chart for the debounce + server-roundtrip
    // window — e.g. timeline buckets showing up as categorical bars with ISO
    // timestamp labels. Treat loading as no-data; the empty-state / fallback
    // paths take over until the new fetch lands.
    if (isViewLoading) {
      return {
        type: 'no-splitting',
        chartData: [],
        fields: [],
        groups: [],
        debugInfo: { processedGroups: [], totalDataPoints: 0, fieldsPerGroup: {} },
      };
    }
    // Server data path — use aggregate response when available
    const serverBuckets = viewData?.aggregate?.buckets;
    if (serverBuckets && serverBuckets.length > 0) {
      if (isGrouped) {
        // Map server buckets to GroupedDataPoint format (categorical bar chart)
        const groupedData: GroupedDataPoint[] = serverBuckets.map(b => {
          const key = b.key || 'N/A';
          const assetIds = Array.from(bucketAssetsByKey.get(key) ?? []);
          // sourceDocuments is a Map<sourceKey, assetId[]>; with no per-source
          // breakdown in the server path we use "all" as a single bucket.
          const sourceDocuments = new Map<number | string, number[]>();
          if (assetIds.length > 0) sourceDocuments.set('all', assetIds);
          return {
            valueString: key,
            totalCount: b.count,
            sourceDocuments,
            schemeName: schemas.find(s => s.id === groupingSchemeId)?.name || '',
            valueKey: key,
          };
        });
        groupedData.sort((a, b) => {
          if (groupedSortOrder === 'value-asc') return a.valueString.localeCompare(b.valueString);
          if (groupedSortOrder === 'value-desc') return b.valueString.localeCompare(a.valueString);
          return b.totalCount - a.totalCount;
        });
        return {
          type: 'grouped',
          chartData: groupedData,
          fields: [],
          groups: [],
          debugInfo: { processedGroups: [], totalDataPoints: groupedData.length, fieldsPerGroup: {} },
        };
      }

      // Timeline mode — map buckets to chart data points. When the aggregate
      // carries a value_field metric (sum/avg/min/max), surface it as the
      // primary renderable field so Lines/Bars plot the metric instead of
      // just the row count.
      const metricKeys = new Set<string>();
      for (const p of serverChartData) {
        if (p && typeof p === 'object') {
          for (const k of Object.keys(p)) {
            if (k === 'timestamp' || k === 'dateString' || k === 'count' || k === 'documents' || k === 'stats') continue;
            if (k.startsWith('grp:')) continue;
            if (typeof (p as any)[k] === 'number') metricKeys.add(k);
          }
        }
      }
      const metricFields = Array.from(metricKeys).map(k => {
        // k is the encoded key (dots replaced with __). Recover the original
        // dotted field path for display; the leaf (after last dot) reads best.
        const original = decodeMetricKey(k);
        const leaf = original.includes('.') ? original.split('.').pop()! : original;
        return {
          key: k,                // what Lines consume as dataKey
          schemaName: '',
          fieldName: original,   // full dotted path for tooltips / debugging
          displayName: leaf,     // legend label
          type: 'number' as any,
          hasData: true,
        };
      });
      const fields = serverChartData.length > 0
        ? (metricFields.length > 0 ? metricFields : [{
            key: 'count',
            schemaName: '',
            fieldName: 'Count',
            displayName: 'Count',
            type: 'integer',
            hasData: true,
          }])
        : [];
      return {
        type: 'no-splitting',
        chartData: serverChartData,
        fields,
        groups: [],
        debugInfo: { processedGroups: [], totalDataPoints: serverChartData.length, fieldsPerGroup: {} },
      };
    }

    // --- Legacy client-side path (fallback for when server data is empty) ---
    // Create assetsMap locally to avoid dependency instability
    const localAssetsMap = new Map(assets.map(asset => [asset.id, asset]));
    // In monitoring mode, include allAssets
    if (monitoringMode && allAssets.length > 0) {
      allAssets.forEach(asset => {
        if (!localAssetsMap.has(asset.id)) {
          localAssetsMap.set(asset.id, asset);
        }
      });
    }

    if (analysisData) {
      return {
        type: 'no-splitting',
        chartData: analysisData.map(d => ({
          ...d,
          timestamp: new Date(d.timestamp).getTime(),
          dateString: format(new Date(d.timestamp), 'yyyy-MM-dd'),
        })),
        fields: [],
        groups: [],
        debugInfo: { processedGroups: [], totalDataPoints: analysisData.length, fieldsPerGroup: {} }
      };
    }

    if (isGrouped) {
      // FIXED: Use UI-selected grouping field for what to count within each chart
      // Don't override with splitting config - that's only for how to split into separate charts
      const actualGroupingSchemeId = groupingSchemeId;   // From UI controls
      const actualGroupingFieldKey = groupingFieldKey;   // From UI controls  
      const valueAliases: Record<string, string[]> = variableSplittingConfig?.valueAliases || {};

      // NEW: Handle variable splitting for grouped charts - create multiple datasets
      if (variableSplittingConfig?.enabled) {
        const splitGroups = applySplittingToResults(resultsForChart, variableSplittingConfig);
        const allGroups = Object.keys(splitGroups).filter(g => g !== 'all');
        
        // Determine which groups to process based on config.visibleSplits
        const visibleSplits = variableSplittingConfig.visibleSplits || new Set();
        const groupsToProcess = visibleSplits.size > 0 
          ? allGroups.filter(g => visibleSplits.has(g))
          : allGroups; // If no visibility restrictions, process all
        
        const groupedDataMap: Record<string, GroupedDataPoint[]> = {};
        
        groupsToProcess.forEach(groupName => {
          const groupResults = splitGroups[groupName];
          if (groupResults && groupResults.length > 0) {
            // FIXED: Use UI-selected grouping field, not the splitting field!
            // actualGroupingSchemeId/actualGroupingFieldKey come from UI controls and determine what we're counting
            // variableSplittingConfig determines how we split the data into separate charts
            const groupData = processGroupedChartData(
              groupResults,
              schemas,
              localAssetsMap,
              actualGroupingSchemeId,  // UI-selected schema (e.g., Migration schema)
              actualGroupingFieldKey,  // UI-selected field (e.g., Migration vs. Sicherheit)
              aggregateSources,
              valueAliases
            ).sort((a, b) => {
              if (groupedSortOrder === 'value-asc') {
                return a.valueString.localeCompare(b.valueString);
              } else if (groupedSortOrder === 'value-desc') {
                return b.valueString.localeCompare(a.valueString);
              }
              return b.totalCount - a.totalCount;
            });
            
            if (groupData.length > 0) {
              groupedDataMap[`split_${groupName}`] = groupData;
            }
          }
        });
        
        return {
          type: 'grouped-splitting',
          chartData: groupedDataMap,
          fields: [],
          groups: groupsToProcess,
          debugInfo: { 
            processedGroups: groupsToProcess, 
            totalDataPoints: Object.values(groupedDataMap).reduce((sum, arr) => sum + arr.length, 0), 
            fieldsPerGroup: Object.fromEntries(Object.entries(groupedDataMap).map(([k, v]) => [k, v.length]))
          }
        };
      }

      // Standard grouped processing without splitting
      return {
        type: 'grouped', // Grouped charts use different data structure
        chartData: processGroupedChartData(
          resultsForChart,
          schemas,
          localAssetsMap,
          actualGroupingSchemeId,
          actualGroupingFieldKey,
          aggregateSources,
          valueAliases
        ).sort((a, b) => {
          if (groupedSortOrder === 'value-asc') {
            return a.valueString.localeCompare(b.valueString);
          } else if (groupedSortOrder === 'value-desc') {
            return b.valueString.localeCompare(a.valueString);
          }
          return b.totalCount - a.totalCount;
        }),
        fields: [],
        groups: [],
        debugInfo: { processedGroups: [], totalDataPoints: 0, fieldsPerGroup: {} }
      };
    }

    if (!timeAxisConfig) {
      return {
        type: 'no-splitting',
        chartData: [],
        fields: [],
        groups: [],
        debugInfo: { processedGroups: [], totalDataPoints: 0, fieldsPerGroup: {} }
      };
    }

    // === VARIABLE SPLITTING LOGIC ===
    if (variableSplittingConfig?.enabled) {
      // Single call to applySplittingToResults
      const splitGroups = applySplittingToResults(resultsForChart, variableSplittingConfig);
      const allGroups = Object.keys(splitGroups).filter(g => g !== 'all');
      
      // Determine which groups to process based on config.visibleSplits
      const visibleSplits = variableSplittingConfig.visibleSplits || new Set();
      const groupsToProcess = visibleSplits.size > 0 
        ? allGroups.filter(g => visibleSplits.has(g))
        : allGroups; // If no visibility restrictions, process all
      
      const timelineMap = new Map<number, ChartDataPoint>();
      const fields: ProcessedFieldData[] = [];
      const fieldsPerGroup: Record<string, number> = {};
      
      groupsToProcess.forEach(groupName => {
        const groupData = processLineChartData(
          splitGroups[groupName], 
          schemas, 
          localAssetsMap, 
          timeAxisConfig, 
          selectedTimeInterval, 
          null
        );
        
        let groupFieldCount = 0;
        
        groupData.forEach(dataPoint => {
          let timelinePoint = timelineMap.get(dataPoint.timestamp);
          if (!timelinePoint) {
            timelinePoint = {
              timestamp: dataPoint.timestamp,
              dateString: dataPoint.dateString,
              count: 0,
              documents: [],
              stats: {},
              categoryFrequency: {},
              assetSchemeValues: {}
            } as ChartDataPoint;
            timelineMap.set(dataPoint.timestamp, timelinePoint);
          }
          
          // Merge document lists
          timelinePoint.documents = [...new Set([...timelinePoint.documents, ...dataPoint.documents])];
          timelinePoint.count = timelinePoint.documents.length;
          
          // Merge asset scheme values
          if (dataPoint.assetSchemeValues) {
            timelinePoint.assetSchemeValues = { ...timelinePoint.assetSchemeValues, ...dataPoint.assetSchemeValues };
          }
          
          // Add group's fields with prefix
          Object.keys(dataPoint).forEach(key => {
            if (!['timestamp', 'dateString', 'count', 'documents', 'assetSchemeValues', 'stats', 'categoryFrequency'].includes(key)) {
              const fieldKey = `${groupName}_${key}`;
              timelinePoint![fieldKey] = dataPoint[key];
              
              // Track field metadata (avoid duplicates)
              if (!fields.find(f => f.key === fieldKey)) {
                // Parse schema and field name from the original key
                const schemaFieldMatch = key.match(/^(.+)_(.+?)(?:_(?:min|max|avg|topCategory|topCategoryCount))?$/);
                if (schemaFieldMatch && !key.endsWith('_min') && !key.endsWith('_max') && !key.endsWith('_avg') && 
                    !key.endsWith('_topCategory') && !key.endsWith('_topCategoryCount')) {
                  const [, schemaName, fieldName] = schemaFieldMatch;
                  fields.push({
                    key: fieldKey,
                    groupName,
                    schemaName,
                    fieldName,
                    displayName: fieldName, // Show just the field name, schema/group context is implicit
                    type: 'number', // TODO: Could extract from schema if needed
                    hasData: true
                  });
                  groupFieldCount++;
                }
              }
              
              // Also handle statistics fields
              if (key.endsWith('_min') || key.endsWith('_max') || key.endsWith('_avg')) {
                const baseKey = key.replace(/_(?:min|max|avg)$/, '');
                const baseFieldKey = `${groupName}_${baseKey}`;
                const statFieldKey = `${groupName}_${key}`;
                timelinePoint![statFieldKey] = dataPoint[key];
              }
            }
          });
        });
        
        fieldsPerGroup[groupName] = groupFieldCount;
      });
      
      const finalChartData = Array.from(timelineMap.values()).sort((a, b) => a.timestamp - b.timestamp);
      
      return {
        type: 'splitting',
        chartData: finalChartData,
        fields,
        groups: allGroups,
        debugInfo: {
          processedGroups: groupsToProcess,
          totalDataPoints: finalChartData.length,
          fieldsPerGroup
        }
      };
    }

    // === NO SPLITTING LOGIC ===
    // Use monitoring processing if monitoring mode is enabled
    const chartData = monitoringMode && allAssets.length > 0 && expectedSchemaIds.length > 0
      ? processMonitoringLineChartData(
          resultsForChart,
          allAssets,
          schemas,
          localAssetsMap,
          timeAxisConfig,
          selectedTimeInterval,
          expectedSchemaIds,
          showPendingAssets
        )
      : processLineChartData(
          resultsForChart,
          schemas,
          localAssetsMap,
          timeAxisConfig,
          selectedTimeInterval,
          null
        );
    
    // Extract fields from non-splitting data
    const fields: ProcessedFieldData[] = [];
    
    if (chartData.length > 0) {
      // Look through all data points to find all possible field keys
      const allKeys = new Set<string>();
      chartData.forEach(point => {
        Object.keys(point).forEach(key => allKeys.add(key));
      });
      
      schemas.forEach(schema => {
        const isSelected = selectedSchemaIds.includes(schema.id);
        if (!isSelected) return;
        
        Array.from(allKeys).forEach(key => {
          if (key.startsWith(`${schema.name}_`) && 
              !key.endsWith('_min') && !key.endsWith('_max') && !key.endsWith('_avg') &&
              !key.endsWith('_topCategory') && !key.endsWith('_topCategoryCount')) {
            
            const hasData = chartData.some(point => point[key] !== undefined && point[key] !== null);
            if (hasData) {
              const fieldName = key.replace(`${schema.name}_`, '');
              fields.push({
                key,
                schemaName: schema.name,
                fieldName,
                displayName: fieldName, // Show just the field name, schema context is implicit
                type: 'number',
                hasData: true
              });
            }
          }
        });
      });
    }
    
    return {
      type: 'no-splitting',
      chartData,
      fields,
      groups: [],
      debugInfo: {
        processedGroups: [],
        totalDataPoints: chartData.length,
        fieldsPerGroup: {}
      }
    };
  }, [
    analysisData,
    isGrouped,
    variableSplittingConfig?.enabled,
    variableSplittingConfig?.schemaId,
    variableSplittingConfig?.fieldKey,
    variableSplittingConfig?.visibleSplits ? Array.from(variableSplittingConfig.visibleSplits).sort().join(',') : '',
    variableSplittingConfig?.valueAliases ? JSON.stringify(variableSplittingConfig.valueAliases) : '',
    // Server data (primary)
    viewData?.aggregate?.buckets,
    isViewLoading,
    serverChartData,
    // Client-side fallback deps
    resultsForChart,
    schemas.map(s => s.id).sort().join(','),
    assets.map(a => a.id).sort().join(','),
    timeAxisConfig?.type,
    timeAxisConfig?.schemaId,
    timeAxisConfig?.fieldKey,
    selectedTimeInterval,
    groupingSchemeId,
    groupingFieldKey,
    aggregateSources,
    groupedSortOrder,
    selectedSchemaIds.sort().join(','),
    monitoringMode,
    allAssets.map(a => a.id).sort().join(','),
    expectedSchemaIds.sort().join(','),
    showPendingAssets
  ]);

  // === SIMPLIFIED FIELD VISIBILITY: Single effect that initializes from processed data ===
  useEffect(() => {
    if (processedData.fields.length > 0) {
      setVisibleFields(new Set(processedData.fields.map(f => f.key)));
    } else {
      setVisibleFields(new Set());
    }
  }, [processedData.fields.map(f => f.key).sort().join(',')]); // FIXED: Use stable field key representation

  // Evidence drawer state — double-click to drill into the annotations that
  // contributed to the clicked bar/point.
  const [evidenceScope, setEvidenceScope] = useState<Scope | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const chartLastClickRef = useRef<{ key: string; at: number } | null>(null);

  // Analytics overlays — client-side derived series over the rendered data.
  const analyticsConfig: AnalyticsOverlayConfig = {
    ...DEFAULT_ANALYTICS_OVERLAYS,
    ...(panelConfig.settings?.analyticsOverlays as Partial<AnalyticsOverlayConfig> | undefined),
  };
  const setAnalyticsConfig = (next: AnalyticsOverlayConfig) => {
    onUpdatePanel({
      settings: { ...(panelConfig.settings ?? {}), analyticsOverlays: next },
    });
  };

  // Rolling avg + trend + peak computations. Only runs on the ungrouped
  // timeline path — the grouped-series case would need per-series folds that
  // would overcrowd the visualization; leave that for a follow-up.
  //
  // The computed values are folded BACK onto each point in `serverChartData`
  // via a mutation inside this memo — recharts reads them as plain fields on
  // the data rows. Mutation is safe here because `serverChartData` itself is
  // a fresh memoized array (we own the lifetime).
  const overlayData = useMemo(() => {
    if (isGrouped || !serverChartData || serverChartData.length === 0) return null;
    if (renderedGroupValues.length > 0) return null; // grouped timeline, skip
    // Clear any prior overlay fields so toggles disappear cleanly.
    for (const p of serverChartData) {
      delete (p as any).rollingAvg;
      delete (p as any).trendLine;
    }
    const points = serverChartData.map((p) => ({
      timestamp: p.timestamp,
      count: p.count,
    }));
    const rolling = analyticsConfig.rollingAvg
      ? rollingAverage(points, analyticsConfig.rollingAvgWindow)
      : null;
    const trend = analyticsConfig.trendLine ? trendLine(points) : null;
    const peaks = analyticsConfig.peakMarkers ? findPeaks(points, 'max') : null;
    const stats = analyticsConfig.statsBands ? descriptiveStats(points) : null;
    serverChartData.forEach((p, i) => {
      if (rolling) (p as any).rollingAvg = rolling[i];
      if (trend) (p as any).trendLine = trend[i];
    });
    return { peaks: peaks ?? [], stats };
  }, [
    isGrouped,
    renderedGroupValues.length,
    serverChartData,
    analyticsConfig.rollingAvg,
    analyticsConfig.rollingAvgWindow,
    analyticsConfig.trendLine,
    analyticsConfig.peakMarkers,
    analyticsConfig.statsBands,
  ]);

  const openEvidenceForPoint = useCallback((pointData: any) => {
    // eslint-disable-next-line no-console
    console.log('[chart] openEvidenceForPoint', {
      isGrouped, groupingFieldKey,
      groupBy: panelConfig.aggregation?.group_by,
      interval: panelConfig.aggregation?.interval,
      pointData,
    });
    // Grouped (categorical) → equality on the grouping field.
    // Timeline (date bucket) → range on [bucket_start, bucket_end] because
    // the bucket key is the start of an interval (e.g. "2008-06-01" for a
    // monthly bucket) but each annotation's timestamp is an exact datetime
    // inside that interval. Equality would match nothing — we need
    // ``>= start AND < next_start``.
    const fieldPath =
      isGrouped && groupingFieldKey
        ? groupingFieldKey
        : panelConfig.aggregation?.group_by ?? null;
    if (!fieldPath) return;

    let scope;
    if (isGrouped) {
      const value = pointData.valueString;
      if (value == null) return;
      scope = createScopeFromSelection(
        panelConfig.id,
        { type: 'click', fieldPath, data: value },
        panelConfig,
        'push',
      );
    } else {
      const bucketKey = pointData.dateString;
      if (bucketKey == null) return;
      const start = new Date(bucketKey);
      if (isNaN(start.getTime())) return;
      const interval = (panelConfig.aggregation?.interval as string | undefined)
        || selectedTimeInterval
        || 'day';
      const end = new Date(start);
      switch (interval) {
        case 'year':    end.setUTCFullYear(end.getUTCFullYear() + 1); break;
        case 'quarter': end.setUTCMonth(end.getUTCMonth() + 3); break;
        case 'month':   end.setUTCMonth(end.getUTCMonth() + 1); break;
        case 'week':    end.setUTCDate(end.getUTCDate() + 7); break;
        case 'day':
        default:        end.setUTCDate(end.getUTCDate() + 1); break;
      }
      scope = createScopeFromSelection(
        panelConfig.id,
        {
          type: 'brush',
          fieldPath,
          data: [start.toISOString(), end.toISOString()],
        },
        panelConfig,
        'push',
      );
    }
    setEvidenceScope(scope);
    setEvidenceOpen(true);
  }, [isGrouped, groupingFieldKey, panelConfig, selectedTimeInterval]);

  const handlePointClick = (data: any) => {
      if (data && data.activePayload && data.activePayload.length > 0) {
          const pointData = data.activePayload[0].payload;
          // Drill-down: open the EvidenceDrawer for the clicked bucket. The
          // drawer lists the underlying annotations (with real asset titles,
          // kinds, timestamps) and each row opens the shared AssetDetailOverlay
          // — same affordance as the table/pie/graph panels. Replaces the old
          // in-dialog ``ChartDialogDetails`` which showed bare "Asset #123"
          // headings that weren't clickable.
          openEvidenceForPoint(pointData);

          // Emit scope gesture for cross-panel filtering
          if (onScopeGesture && isGrouped && groupingFieldKey && pointData.valueString) {
            onScopeGesture(groupingFieldKey, pointData.valueString, 'click');
          } else if (onScopeGesture && !isGrouped && pointData.dateString) {
            const dateField = panelConfig.aggregation.group_by;
            if (dateField) onScopeGesture(dateField, pointData.dateString, 'click');
          }
      }
  };

     const hasValueFields = (() => {
       if (Array.isArray(processedData.chartData)) {
         return processedData.chartData.length > 0 && 
                schemas.some(schema => (processedData.chartData as any[]).some((point: any) => point[schema.name] !== undefined));
       } else if (typeof processedData.chartData === 'object') {
         return Object.values(processedData.chartData).some(chartArray => Array.isArray(chartArray) && chartArray.length > 0);
       }
       return false;
     })();


  // === SIMPLIFIED FIELD VISIBILITY CONTROLS ===
  const handleFieldVisibilityToggle = (fieldKey: string) => {
    const newVisibleFields = new Set(visibleFields);
    if (newVisibleFields.has(fieldKey)) {
      newVisibleFields.delete(fieldKey);
    } else {
      newVisibleFields.add(fieldKey);
    }
    setVisibleFields(newVisibleFields);
  };

  const handleToggleAllFields = (visible: boolean) => {
    if (visible) {
      setVisibleFields(new Set(processedData.fields.map(field => field.key)));
    } else {
      setVisibleFields(new Set());
    }
  };

  // === FIELD RENDERING: Simplified logic ===
  const fieldsToRender = useMemo(() => {
    const visibleFieldsList = processedData.fields.filter(field => 
      visibleFields.has(field.key)
    );
    
    // Sort by group when variable splitting is enabled
    if (processedData.type === 'splitting' && variableSplittingConfig?.enabled) {
      return visibleFieldsList.sort((a, b) => {
        // Primary sort: by group name
        const groupA = a.groupName || '';
        const groupB = b.groupName || '';
        if (groupA !== groupB) {
          return groupA.localeCompare(groupB);
        }
        // Secondary sort: by field name within group
        return a.fieldName.localeCompare(b.fieldName);
      });
    }
    
    // Default sorting for non-splitting mode
    return visibleFieldsList.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [processedData.fields, visibleFields, processedData.type, variableSplittingConfig]);

  // NEW: Helper function to get display name for split groups
  const getSplitGroupDisplayName = (targetKey: string): string => {
    if (typeof targetKey === 'string' && targetKey.startsWith('split_')) {
      return targetKey.replace('split_', '');
    }
    return targetKey;
  };

  // Timeline click — same drill-down as handlePointClick: open the
  // EvidenceDrawer for the clicked time bucket. openEvidenceForPoint
  // constructs a range scope (>= bucket_start AND < next_bucket_start)
  // so all annotations inside the interval are fetched.
  const handleTimelinePointClick = (data: any, event: any) => {
    if (data && data.activePayload && data.activePayload.length > 0) {
      const pointData = data.activePayload[0].payload;
      openEvidenceForPoint(pointData);
    }
  };

     // === STATISTICS RENDERING ===
   const renderMinMaxLines = useCallback((fieldKey: string, color: string) => {
     const minKey = `${fieldKey}_min`;
     const maxKey = `${fieldKey}_max`;
     
     // Only render for timeline charts (not grouped charts)
     if (processedData.type === 'grouped') return null;
     
     // Check if this field has statistics data
     const timelineData = processedData.chartData as ChartDataPoint[];
     const hasStats = timelineData.some(point => 
       point[minKey] !== undefined && point[maxKey] !== undefined
     );
     
     if (!hasStats) return null;
     
     return (
       <React.Fragment key={`stats-${fieldKey}`}>
         <Line
           yAxisId="left"
           type="monotone"
           dataKey={minKey}
           stroke={color}
           strokeDasharray="0 0"
           strokeWidth={1}
           dot={false}
           name={`${fieldKey} (min)`}
           connectNulls={true}
           isAnimationActive={false}
         />
         <Line
           yAxisId="left"
           type="monotone"
           dataKey={maxKey}
           stroke={color}
           strokeDasharray="0 0"
           strokeWidth={1}
           dot={false}
           name={`${fieldKey} (max)`}
           connectNulls={true}
           isAnimationActive={false}
         />
       </React.Fragment>
     );
   }, [processedData]);

     // Always show controls, even with no data
   const hasNoData = (() => {
     if (Array.isArray(processedData.chartData)) {
       return processedData.chartData.length === 0 && !analysisData;
     } else if (typeof processedData.chartData === 'object') {
       return Object.keys(processedData.chartData).length === 0 && !analysisData;
     }
     return true;
   })();

  // Empty-state detection for the RolePicker-driven timeline.
  const needsSchemaPick = !rolePickerValue.schemaId && schemas.length > 1;
  const needsXPick = !isGrouped && (rolePickerValue.fieldsByRole['x']?.length ?? 0) === 0;
  const showPickerEmptyState = !isGrouped && (needsSchemaPick || needsXPick);

  return (
    <div className="h-full flex flex-col space-y-3">
      {/* Picker button lives in the PanelRenderer header via a portal so
          every panel type surfaces it in the same place. */}
      <PanelHeaderSlot>
          <PanelFormulaBinder
            formulaId={(panelConfig as any).formula_id ?? (panelConfig as any).observation_id ?? null}
            onBind={(id) => onUpdatePanel({ formula_id: id, observation_id: undefined } as any)}
          />
          <RolePickerPopover
          schema={PANEL_ROLE_SCHEMAS.chart}
          availableSchemas={schemas}
          value={rolePickerValue}
          onChange={handleRolePickerChange}
          onOpenValueAliases={
            aliasTargetField ? () => setAliasManagerOpen(true) : undefined
          }
        />
      </PanelHeaderSlot>
      {showControls && (
        <div className="flex flex-col gap-1.5 px-2 py-1.5 border-b bg-muted/20 flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Chart Type Toggle */}
            <ToggleGroup
              type="single"
              value={isGrouped ? 'grouped' : 'timeline'}
              onValueChange={(value) => {
                const next = value === 'grouped';
                setIsGrouped(next);
                persistChartState({ isGrouped: next });
              }}
              size="sm"
              className="h-6"
            >
              <ToggleGroupItem value="timeline" className="h-6 px-2 text-[11px]">
                Timeline
              </ToggleGroupItem>
              <ToggleGroupItem value="grouped" className="h-6 px-2 text-[11px]">
                Grouped
              </ToggleGroupItem>
            </ToggleGroup>

          {/* Grouped controls */}
          {isGrouped && (
            <>
              <Select
                value={groupingSchemeId?.toString() ?? ""}
                onValueChange={(v) => {
                  const next = v ? parseInt(v) : null;
                  setGroupingSchemeId(next);
                  persistChartState({ groupingSchemeId: next });
                }}
              >
                <SelectTrigger className="w-28 h-6 text-[11px]">
                  <SelectValue placeholder="Schema..." />
                </SelectTrigger>
                <SelectContent>
                  {schemas.map(s => (
                    <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={groupingFieldKey ?? ""}
                onValueChange={(v) => {
                  const next = v || null;
                  setGroupingFieldKey(next);
                  persistChartState({ groupingFieldKey: next });
                }}
                disabled={!groupingSchemeId}
              >
                <SelectTrigger className="w-28 h-6 text-[11px]">
                  <SelectValue placeholder="Field..." />
                </SelectTrigger>
                <SelectContent>
                  {groupingSchemeId && getTargetKeysForScheme(groupingSchemeId, schemas).map(tk => (
                    <SelectItem key={tk.key} value={tk.key}>{tk.name} ({tk.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={groupedSortOrder}
                onValueChange={(v) => {
                  const next = v as 'count-desc' | 'value-asc' | 'value-desc';
                  setGroupedSortOrder(next);
                  persistChartState({ groupedSortOrder: next });
                }}
              >
                <SelectTrigger className="w-24 h-6 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="count-desc">Count desc</SelectItem>
                  <SelectItem value="value-asc">A → Z</SelectItem>
                  <SelectItem value="value-desc">Z → A</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Schemas (timeline, multi-schema) */}
          {!isGrouped && schemas.length > 1 && (
            <ToggleGroup
              type="multiple"
              value={selectedSchemaIds.map(String)}
              onValueChange={(values) => setSelectedSchemaIds(values.map(Number))}
              size="sm"
              variant="outline"
              className="h-6"
            >
              {schemas.map(schema => {
                const hasData = processedData.fields.some(field => field.schemaName === schema.name);
                return (
                  <ToggleGroupItem
                    key={schema.id}
                    value={schema.id.toString()}
                    disabled={!hasData}
                    className={cn("h-6 px-2 text-[11px]", !hasData && "opacity-50")}
                  >
                    {schema.name}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          )}

          {/* Fields (popover — unbounded list) */}
          {!isGrouped && processedData.fields.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]">
                  Fields ({visibleFields.size}/{processedData.fields.length})
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 max-h-[50vh] overflow-y-auto p-3" align="end" side="bottom">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium">Fields</Label>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleToggleAllFields(true)} disabled={visibleFields.size === processedData.fields.length} className="text-[10px] px-1.5 h-5">All</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleToggleAllFields(false)} disabled={visibleFields.size === 0} className="text-[10px] px-1.5 h-5">None</Button>
                    </div>
                  </div>
                  {processedData.type === 'splitting' ? (
                    (() => {
                      const fieldsByGroup = processedData.fields.reduce((acc, field) => {
                        const group = field.groupName || 'Other';
                        if (!acc[group]) acc[group] = [];
                        acc[group].push(field);
                        return acc;
                      }, {} as Record<string, typeof processedData.fields>);
                      return Object.entries(fieldsByGroup).map(([groupName, groupFields]) => (
                        <div key={groupName} className="mb-2">
                          <div className="text-[10px] font-medium text-muted-foreground mb-1 border-b pb-0.5">{groupName} ({groupFields.length})</div>
                          <div className="flex flex-wrap gap-1.5 pl-1">
                            {groupFields.map(field => (
                              <div key={field.key} className="flex items-center space-x-1.5">
                                <Checkbox id={`field-${field.key}`} checked={visibleFields.has(field.key)} onCheckedChange={() => handleFieldVisibilityToggle(field.key)} />
                                <Label htmlFor={`field-${field.key}`} className="text-[11px]">{field.fieldName}</Label>
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {processedData.fields.map(field => (
                        <div key={field.key} className="flex items-center space-x-1.5">
                          <Checkbox id={`field-${field.key}`} checked={visibleFields.has(field.key)} onCheckedChange={() => handleFieldVisibilityToggle(field.key)} />
                          <Label htmlFor={`field-${field.key}`} className="text-[11px]">{field.displayName}</Label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Display toggles */}
          {!isGrouped && (
            <ToggleGroup
              type="multiple"
              value={[
                ...(showStatistics ? ['stats'] : []),
                ...(showAnnotationBars ? ['bars'] : []),
                ...(showPendingAssets ? ['pending'] : []),
              ]}
              onValueChange={(values) => {
                setShowStatistics(values.includes('stats'));
                setShowAnnotationBars(values.includes('bars'));
                if (monitoringMode) handleShowPendingChange(values.includes('pending'));
              }}
              size="sm"
              variant="outline"
              className="h-6"
            >
              <ToggleGroupItem value="stats" className="h-6 px-2 text-[11px]">Stats</ToggleGroupItem>
              <ToggleGroupItem value="bars" className="h-6 px-2 text-[11px]">Bars</ToggleGroupItem>
              {monitoringMode && (
                <ToggleGroupItem value="pending" className="h-6 px-2 text-[11px]">Pending</ToggleGroupItem>
              )}
            </ToggleGroup>
          )}
          {!isGrouped && renderedGroupValues.length === 0 && (
            <AnalyticsOverlayToolbar
              value={analyticsConfig}
              onChange={setAnalyticsConfig}
              disabled={serverChartData.length < 2}
            />
          )}
          </div>

          {/* Grouped-timeline legend + high-cardinality warning */}
          {renderedGroupValues.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] font-medium text-muted-foreground">
                Split by {viewData?.aggregate?.split_field_path}:
              </span>
              {renderedGroupValues.map((value, idx) => {
                const hidden = hiddenGroupValues.has(value);
                const color = PIE_COLORS[idx % PIE_COLORS.length];
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleGroupVisibility(value)}
                    className={cn(
                      'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 border rounded',
                      hidden && 'opacity-40',
                    )}
                    title={hidden ? 'Show' : 'Hide'}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-sm"
                      style={{ backgroundColor: color }}
                    />
                    {value}
                  </button>
                );
              })}
              {hasHighCardinality && (
                <span className="text-[10px] text-amber-700 dark:text-amber-400 ml-2">
                  {groupValues.length} distinct values — showing top {maxGroupsToRender}.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chart Display */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {showPickerEmptyState ? (
          <EmptyStateCard
            reason={
              needsSchemaPick
                ? { kind: 'no_schema' }
                : { kind: 'role_unfilled', roleLabel: 'X axis' }
            }
            className="h-full"
          />
        ) : hasNoData ? (
          <EmptyStateCard
            reason={{
              kind: 'no_data',
              filtersActive:
                (panelConfig.local_filters?.conditions?.length ?? 0) > 0 ||
                (panelConfig.incoming_scopes?.length ?? 0) > 0,
            }}
            className="h-full"
          />
        ) : processedData.type === 'grouped-splitting' ? (
          // NEW: Render multiple bar charts for variable splitting
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 h-full p-4 overflow-auto">
            {Object.entries(processedData.chartData as Record<string, GroupedDataPoint[]>)
              .filter(([key, data]) => key.startsWith('split_') && data?.length > 0)
              .map(([targetKey, data]) => (
                <Card key={`grouped-split-chart-${targetKey}`} className="shadow-md flex flex-col h-full min-h-[300px]">
                  <CardHeader className="pb-2 pt-4 px-4 flex-shrink-0">
                    <CardTitle className="text-base font-medium truncate" title={getSplitGroupDisplayName(targetKey)}>
                      {getSplitGroupDisplayName(targetKey)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-2 flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={data}
                        margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                      >
                        <XAxis 
                          dataKey="valueString" 
                          tick={{ fontSize: 12 }}
                          angle={-25}
                          textAnchor="end"
                          height={60}
                        />
                        <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                        <RechartsTooltip 
                          cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }}
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length > 0) {
                              return (
                                <div className="bg-card/95 border border-border p-3 rounded-lg shadow-md">
                                  <p className="font-medium">{label}</p>
                                  <p className="text-sm">Count: {payload[0].value}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar
                          yAxisId="left"
                          dataKey="totalCount"
                          fill="#8884d8"
                          name="Count"
                          onClick={handlePointClick}
                          cursor="pointer"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              ))}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {processedData.type === 'grouped' ? (
              <ComposedChart
                data={processedData.chartData as GroupedDataPoint[]}
                margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
              >
                <XAxis 
                  dataKey="valueString" 
                  tick={{ fontSize: 12 }}
                  angle={-25}
                  textAnchor="end"
                  height={60}
                />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                <RechartsTooltip 
                  cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }}
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length > 0) {
                      return (
                        <div className="bg-card/95 border border-border p-3 rounded-lg shadow-md">
                          <p className="font-medium">{label}</p>
                          <p className="text-sm">Count: {payload[0].value}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar
                  yAxisId="left"
                  dataKey="totalCount"
                  fill="#8884d8"
                  name="Count"
                  onClick={handlePointClick}
                  cursor="pointer"
                />
              </ComposedChart>
            ) : (
              <ComposedChart
                data={processedData.chartData as ChartDataPoint[]}
                margin={{ top: 8, right: 4, left: 4, bottom: 0 }}
                onClick={handleTimelinePointClick}
              >
                <XAxis
                  dataKey="dateString"
                  tick={{ fontSize: 12 }}
                  angle={-25}
                  textAnchor="end"
                  height={60}
                  tickFormatter={(value: string) => {
                    // Backend returns postgres-rendered timestamps like
                    // ``2005-06-01 00:00:00+00:00``. Strip the time part and
                    // format by the active interval so axes stay legible.
                    const d = new Date(value);
                    if (isNaN(d.getTime())) return String(value);
                    const iv = (panelConfig.aggregation?.interval as any) || selectedTimeInterval;
                    switch (iv) {
                      case 'year':    return format(d, 'yyyy');
                      case 'quarter': return format(d, "'Q'Q yyyy");
                      case 'month':   return format(d, 'MMM yyyy');
                      case 'week':    return format(d, "MMM d");
                      case 'day':
                      default:        return format(d, 'MMM d, yyyy');
                    }
                  }}
                />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                <RechartsTooltip 
                  cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }}
                  content={<CustomTooltipContent keyToSplitValueMap={new Map()} />}
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ pointerEvents: 'auto', zIndex: 9999, outline: 'none' }}
                  isAnimationActive={false}
                  position={{ y: 10 }}
                  offset={15}
                  shared={false}
                />
                
                {/* Timestamp highlighting from cross-panel navigation.
                    The previous matcher compared ``point.dateString`` against
                    a formatted display string — but ``dateString`` is the raw
                    postgres timestamp (e.g. ``2005-06-01 00:00:00+00:00``),
                    so the equality never fired and the highlight never drew.
                    Parse both sides and compare at the interval's start. */}
                {highlightedTimestamp && (() => {
                  const chartData = processedData.chartData as ChartDataPoint[];
                  const highlightedDate = highlightedTimestamp.timestamp;
                  const intervalStart = (d: Date): number => {
                    switch (selectedTimeInterval) {
                      case 'year':    return startOfYear(d).getTime();
                      case 'quarter': return startOfQuarter(d).getTime();
                      case 'month':   return startOfMonth(d).getTime();
                      case 'week':    return startOfWeek(d).getTime();
                      case 'day':
                      default:        return startOfDay(d).getTime();
                    }
                  };
                  const targetBucket = intervalStart(highlightedDate);
                  const matchingPoint = chartData.find((point) => {
                    const pointDate = new Date(point.timestamp || point.dateString);
                    if (isNaN(pointDate.getTime())) return false;
                    return intervalStart(pointDate) === targetBucket;
                  });
                  console.log('[Chart] highlight attempt', {
                    interval: selectedTimeInterval,
                    targetIso: new Date(targetBucket).toISOString(),
                    bucketsCount: chartData.length,
                    firstBucket: chartData[0]?.dateString,
                    lastBucket: chartData[chartData.length - 1]?.dateString,
                    matched: !!matchingPoint,
                    matchedDateString: matchingPoint?.dateString,
                  });
                  
                  if (matchingPoint) {
                    console.log('[Chart] Found matching point, rendering highlight:', matchingPoint.dateString);
                    return (
                      <>
                        {/* Subtle background highlight area */}
                        <ReferenceArea
                          yAxisId="left"
                          x1={matchingPoint.dateString}
                          x2={matchingPoint.dateString}
                          strokeOpacity={0.3}
                          fill="#3b82f6"
                          fillOpacity={0.1}
                        />
                        {/* Vertical reference line at the highlighted timestamp */}
                        <ReferenceLine
                          yAxisId="left"
                          x={matchingPoint.dateString}
                          stroke="#3b82f6"
                          strokeWidth={2}
                          strokeDasharray="3 3"
                          label={{
                            value: '📅',
                            position: 'top',
                            fontSize: 16,
                            fill: '#3b82f6',
                          }}
                        />
                      </>
                    );
                  }
                  return null;
                })()}
                
                {/* Custom legend component that elegantly groups statistical variants */}
                {fieldsToRender.length > 0 && (
                  <Legend 
                    content={<CustomLegend showStatistics={showStatistics} />}
                    verticalAlign="bottom" 
                    align="center"
                    wrapperStyle={{ 
                      paddingTop: '0px',
                      paddingBottom: 'px',
                    }}
                  />
                )}
                
                {/* Monitoring mode: Stacked status bars */}
                {monitoringMode && showAnnotationBars && (
                  <>
                    <Bar
                      yAxisId="right"
                      dataKey="annotatedCount"
                      stackId="status"
                      fill="#22c55e"
                      name="Annotated"
                      isAnimationActive={false}
                      barSize={20}
                      maxBarSize={30}
                    />
                    <Bar
                      yAxisId="right"
                      dataKey="partialCount"
                      stackId="status"
                      fill="#f59e0b"
                      name="Partial"
                      isAnimationActive={false}
                      barSize={20}
                      maxBarSize={30}
                    />
                    <Bar
                      yAxisId="right"
                      dataKey="pendingCount"
                      stackId="status"
                      fill="#94a3b8"
                      name="Pending"
                      isAnimationActive={false}
                      barSize={20}
                      maxBarSize={30}
                    />
                  </>
                )}
                
                {/* Standard annotation count bars (non-monitoring mode) */}
                {!monitoringMode && showAnnotationBars && (
                  <Bar
                    yAxisId="right"
                    dataKey="count"
                    fill="#e0e7ff"
                    fillOpacity={0.3}
                    stroke="#6366f1"
                    strokeWidth={1}
                    name="Annotation Count"
                    isAnimationActive={false}
                    barSize={20}
                    maxBarSize={30}
                  />
                )}
                
                {/* Monitoring mode: Pending count line */}
                {monitoringMode && showPendingAssets && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="pendingCount"
                    stroke="#94a3b8"
                    strokeDasharray="5 5"
                    strokeWidth={2}
                    dot={{ fill: '#94a3b8', r: 3 }}
                    name="Pending Assets"
                    connectNulls={true}
                    isAnimationActive={false}
                  />
                )}
                
                {/* Render statistical lines if enabled */}
                {showStatistics && fieldsToRender
                  .map((field, index) => {
                    const color = PIE_COLORS[index % PIE_COLORS.length];
                    return renderMinMaxLines(field.key, color);
                  })
                }
                
                                 {/* Render lines for each visible field */}
                 {fieldsToRender.map((field, index) => {
                   const fieldColor = PIE_COLORS[index % PIE_COLORS.length];

                   return (
                     <Line
                       key={field.key}
                       yAxisId="left"
                       type="monotone"
                       dataKey={field.key}
                       stroke={fieldColor}
                       strokeWidth={2}
                       dot={{ fill: fieldColor, strokeWidth: 0, r: 4 }}
                       activeDot={{
                         r: 8,
                         strokeWidth: 0,
                         fill: fieldColor,
                         style: { cursor: 'pointer' }
                       }}
                       name={field.displayName}
                       connectNulls={true}
                       isAnimationActive={false}
                       onClick={handleTimelinePointClick}
                     />
                   );
                 })}

                {/* Analytics overlays — client-side derived series. */}
                {overlayData && analyticsConfig.rollingAvg && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="rollingAvg"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    dot={false}
                    name={`Rolling avg (${analyticsConfig.rollingAvgWindow})`}
                    connectNulls={true}
                    isAnimationActive={false}
                  />
                )}
                {overlayData && analyticsConfig.trendLine && (
                  <Line
                    yAxisId="left"
                    type="linear"
                    dataKey="trendLine"
                    stroke="#f97316"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    dot={false}
                    name="Trend"
                    connectNulls={true}
                    isAnimationActive={false}
                  />
                )}
                {overlayData && analyticsConfig.statsBands && overlayData.stats && (
                  <>
                    <ReferenceLine
                      yAxisId="left"
                      y={overlayData.stats.mean}
                      stroke="#6366f1"
                      strokeDasharray="2 2"
                      label={{ value: 'mean', fontSize: 9, fill: '#6366f1', position: 'right' }}
                    />
                    <ReferenceLine
                      yAxisId="left"
                      y={overlayData.stats.max}
                      stroke="#10b981"
                      strokeDasharray="1 3"
                      label={{ value: 'max', fontSize: 9, fill: '#10b981', position: 'right' }}
                    />
                    <ReferenceLine
                      yAxisId="left"
                      y={overlayData.stats.min}
                      stroke="#ef4444"
                      strokeDasharray="1 3"
                      label={{ value: 'min', fontSize: 9, fill: '#ef4444', position: 'right' }}
                    />
                  </>
                )}
                {overlayData && analyticsConfig.peakMarkers && overlayData.peaks.map((idx) => {
                  const point = serverChartData[idx];
                  if (!point) return null;
                  return (
                    <ReferenceLine
                      key={`peak-${idx}`}
                      yAxisId="left"
                      x={point.dateString}
                      stroke="#a855f7"
                      strokeWidth={1}
                      label={{ value: '▲', fontSize: 10, fill: '#a855f7', position: 'top' }}
                    />
                  );
                })}

                {/* Grouped-timeline: one line per distinct split_value. The
                    dataKey matches the pivoted column we added in the
                    (bucket, split_value) → ChartDataPoint mapping above. */}
                {renderedGroupValues
                  .filter(g => !hiddenGroupValues.has(g))
                  .map((groupValue, idx) => {
                    const color = PIE_COLORS[idx % PIE_COLORS.length];
                    return (
                      <Line
                        key={`grp-${groupValue}`}
                        yAxisId="left"
                        type="monotone"
                        dataKey={`grp:${groupValue}`}
                        stroke={color}
                        strokeWidth={2}
                        dot={{ fill: color, strokeWidth: 0, r: 3 }}
                        activeDot={{ r: 6, strokeWidth: 0, fill: color }}
                        name={groupValue}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    );
                  })}
              </ComposedChart>
            )}
          </ResponsiveContainer>
        )}
      </div>

      <EvidenceDrawer
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        infospaceId={infospaceId}
        runId={runId}
        scope={evidenceScope}
        baseFilters={panelConfig.local_filters}
        mergeMaps={effectiveMergeMapsForView}
        schemas={schemas}
      />

      {/* Value Alias Manager — edits run-wide aliases for the panel's
          primary categorical axis. */}
      {aliasTargetField && (
        <ValueAliasManager
          open={aliasManagerOpen}
          onOpenChange={setAliasManagerOpen}
          infospaceId={infospaceId}
          runId={runId}
          fieldPath={aliasTargetField}
          aliases={aliasesForField}
          schemaIds={rolePickerValue.schemaId ? [rolePickerValue.schemaId] : undefined}
          filters={mergedFilters}
          onSave={(nextAliases) => {
            const current = getGlobalVariableSplitting() ?? { enabled: true };
            setGlobalVariableSplitting({
              ...current,
              enabled: true,
              valueAliasesByField: {
                ...(current.valueAliasesByField ?? {}),
                [aliasTargetField]: nextAliases,
              },
            });
          }}
        />
      )}

      {/* Details Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chart Point Details</DialogTitle>
            <DialogDescription>
              {selectedPoint && 'valueString' in selectedPoint ? 
                `Grouped data for: ${selectedPoint.valueString}` :
                `Timeline data for: ${selectedPoint?.dateString}`
              }
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 p-4">
            {selectedPoint && (
              <ChartDialogDetails 
                selectedPoint={selectedPoint}
                results={resultsForChart}
                schemas={schemas}
                assets={assets}
                timeAxisConfig={timeAxisConfig}
                selectedTimeInterval={selectedTimeInterval}
                onResultSelect={onResultSelect}
                onFieldInteraction={onFieldInteraction}
              />
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface ChartDialogDetailsProps {
  selectedPoint: GroupedDataPoint | ChartDataPoint;
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  assets?: AssetRead[];
  timeAxisConfig: TimeAxisConfig | null;
  selectedTimeInterval: 'day' | 'week' | 'month' | 'quarter' | 'year';
  onResultSelect?: (result: FormattedAnnotation) => void;
  onFieldInteraction?: (result: FormattedAnnotation, fieldKey: string) => void;
}

const ChartDialogDetails: React.FC<ChartDialogDetailsProps> = ({ 
    selectedPoint, 
    results, 
    schemas, 
    assets,
    timeAxisConfig,
    selectedTimeInterval,
    onResultSelect,
    onFieldInteraction,
}) => {
    // Field selection state for controlling what fields to show
    const [selectedFieldsPerScheme, setSelectedFieldsPerScheme] = useState<Record<number, string[]>>(() => {
        const initialState: Record<number, string[]> = {};
        schemas.forEach(schema => {
            const targetKeys = getTargetKeysForScheme(schema.id, schemas);
            // Show all fields by default for better overview
            initialState[schema.id] = targetKeys.map(tk => tk.key);
        });
        return initialState;
    });

    // Update field selection when schemas change
    useEffect(() => {
        setSelectedFieldsPerScheme(prev => {
            const newState: Record<number, string[]> = {};
            schemas.forEach(schema => {
                const targetKeys = getTargetKeysForScheme(schema.id, schemas);
                const keys = targetKeys.map(tk => tk.key);
                newState[schema.id] = prev[schema.id] ?? keys; // Keep existing selection or use all
            });
            return newState;
        });
    }, [schemas]);

    const handleFieldToggle = (schemaId: number, fieldKey: string) => {
        setSelectedFieldsPerScheme(prev => {
            const currentSelected = prev[schemaId] || [];
            const isSelected = currentSelected.includes(fieldKey);
            const newSelected = isSelected 
                ? currentSelected.filter(key => key !== fieldKey) 
                : [...currentSelected, fieldKey];
            
            // Allow zero fields to hide schema completely if desired
            return { ...prev, [schemaId]: newSelected };
        });
    };
    
    if ('valueString' in selectedPoint) {
        // For grouped data, get the results that match this value
        const relevantAssetIds = Array.from(selectedPoint.sourceDocuments.values()).flat();
        const relevantSchema = schemas.find(s => s.name === selectedPoint.schemeName);
        
        if (!relevantSchema) {
            return (
                <div className="p-4">
                    <p className="text-red-500">Schema not found: {selectedPoint.schemeName}</p>
                    <p className="text-sm text-muted-foreground mt-2">
                        Available schemas: {schemas.map(s => s.name).join(', ')}
                    </p>
                </div>
            );
        }

        // Filter results to only include those for this schema and these assets
        const relevantResults = results.filter(r => 
            r.schema_id === relevantSchema.id && 
            relevantAssetIds.includes(r.asset_id)
        );
        
        const availableFields = getTargetKeysForScheme(relevantSchema.id, schemas);
        const selectedFields = selectedFieldsPerScheme[relevantSchema.id] || [];

        return (
            <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold">{selectedPoint.schemeName}: "{selectedPoint.valueString}" ({selectedPoint.totalCount} results)</h3>
                    
                    {/* Field Selection Controls */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm">
                                <Settings2 className="h-4 w-4 mr-2" />
                                Fields ({selectedFields.length})
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-0" align="end">
                            <div className="p-3 border-b">
                                <h4 className="font-medium text-sm">Show Fields for {relevantSchema.name}</h4>
                            </div>
                            <ScrollArea className="max-h-60 p-2">
                                {availableFields.map(field => (
                                    <div key={field.key} className="flex items-center space-x-2 px-2 py-1.5 text-sm">
                                        <Checkbox
                                            id={`chart-field-${relevantSchema.id}-${field.key}`}
                                            checked={selectedFields.includes(field.key)}
                                            onCheckedChange={() => handleFieldToggle(relevantSchema.id, field.key)}
                                        />
                                        <Label
                                            htmlFor={`chart-field-${relevantSchema.id}-${field.key}`}
                                            className="font-normal cursor-pointer truncate flex-1"
                                        >
                                            {field.name} ({field.type})
                                        </Label>
                                    </div>
                                ))}
                            </ScrollArea>
                        </PopoverContent>
                    </Popover>
                </div>
                
                <p className="text-sm text-muted-foreground">Found {relevantResults.length} matching results for {relevantAssetIds.length} assets.</p>
                {relevantAssetIds.map((assetId: number) => {
                    const asset = assets?.find(a => a.id === assetId);
                    const assetResults = relevantResults.filter(r => r.asset_id === assetId);

                    if (!asset || assetResults.length === 0) return null;

                    return (
                        <div key={assetId} className="border-t pt-4">
                            <AssetLink assetId={assetId} className="font-semibold hover:underline">{asset.title || `Asset #${assetId}`}</AssetLink>
                            <div className="mt-2 pl-4 border-l-2">
                              <AnnotationResultDisplay 
                                result={assetResults} 
                                schema={[relevantSchema]} 
                                compact={false} 
                                useTabs={false}
                                selectedFieldKeys={selectedFields.length > 0 ? selectedFields : undefined}
                                maxFieldsToShow={undefined}
                                renderContext="dialog"
                                onResultSelect={onResultSelect}
                                onFieldInteraction={(fieldKey, justification) => {
                                  // Handle field interaction by calling the parent callback with the first result
                                  const firstResult = assetResults[0];
                                  if (firstResult && onFieldInteraction) {
                                    onFieldInteraction(firstResult, fieldKey);
                                  }
                                }}
                              />
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    } 
    
    else if ('dateString' in selectedPoint) {
        const assetsMap = new Map(assets?.map(a => [a.id, a]));
        
        // FIXED: Use the documents array directly instead of trying to recompute time filtering
        // This is more reliable since the chart data already computed which documents belong to this time bucket
        const relevantAssetIds = selectedPoint.documents || [];
        const relevantResults = results.filter(r => relevantAssetIds.includes(r.asset_id));
        
        return (
             <div className="p-4 space-y-4">
                 <div className="flex items-center justify-between">
                     <h3 className="font-bold">Date: {format(new Date(selectedPoint.timestamp), 'PPP')}</h3>
                     
                     {/* Multi-Schema Field Selection Controls */}
                     <Popover>
                         <PopoverTrigger asChild>
                             <Button variant="outline" size="sm">
                                 <Settings2 className="h-4 w-4 mr-2" />
                                 Field Settings
                             </Button>
                         </PopoverTrigger>
                         <PopoverContent className="w-80 p-0" align="end">
                             <div className="p-3 border-b">
                                 <h4 className="font-medium text-sm">Show Fields by Schema</h4>
                             </div>
                             <ScrollArea className="max-h-80 p-2">
                                 {schemas.map(schema => {
                                     const availableFields = getTargetKeysForScheme(schema.id, schemas);
                                     const selectedFields = selectedFieldsPerScheme[schema.id] || [];
                                     
                                     return (
                                         <div key={schema.id} className="mb-4 last:mb-0">
                                             <div className="font-medium text-sm mb-2 px-2">{schema.name}</div>
                                             {availableFields.map(field => (
                                                 <div key={field.key} className="flex items-center space-x-2 px-4 py-1.5 text-sm">
                                                     <Checkbox
                                                         id={`timeline-field-${schema.id}-${field.key}`}
                                                         checked={selectedFields.includes(field.key)}
                                                         onCheckedChange={() => handleFieldToggle(schema.id, field.key)}
                                                     />
                                                     <Label
                                                         htmlFor={`timeline-field-${schema.id}-${field.key}`}
                                                         className="font-normal cursor-pointer truncate flex-1"
                                                     >
                                                         {field.name} ({field.type})
                                                     </Label>
                                                 </div>
                                             ))}
                                         </div>
                                     );
                                 })}
                             </ScrollArea>
                         </PopoverContent>
                     </Popover>
                 </div>
                 
                 <p className="text-sm text-muted-foreground">{selectedPoint.documents?.length || 0} document(s) in this time bucket, {relevantResults.length} total annotation results.</p>
                 {relevantAssetIds.map(assetId => {
                    const asset = assets?.find(a => a.id === assetId);
                    if (!asset) return null;

                    const assetResults = relevantResults.filter(r => r.asset_id === assetId);
                    const relevantSchemaIds = Array.from(new Set(assetResults.map(r => r.schema_id)));
                    const relevantSchemas = schemas.filter(s => relevantSchemaIds.includes(s.id));

                    if (assetResults.length === 0) return null;

                    return (
                        <div key={assetId} className="border-t pt-4">
                            <AssetLink assetId={assetId} className="font-semibold hover:underline">{asset.title || `Asset #${assetId}`}</AssetLink>
                            <div className="mt-2 pl-4 border-l-2">
                              <AnnotationResultDisplay 
                                result={assetResults} 
                                schema={relevantSchemas} 
                                compact={false} 
                                useTabs={assetResults.length > 1}
                                selectedFieldKeys={(() => {
                                    // Combine selected fields from all relevant schemas
                                    const allSelectedFields: string[] = [];
                                    relevantSchemas.forEach(schema => {
                                        const schemaFields = selectedFieldsPerScheme[schema.id] || [];
                                        allSelectedFields.push(...schemaFields);
                                    });
                                    return allSelectedFields.length > 0 ? allSelectedFields : undefined;
                                })()}
                                maxFieldsToShow={undefined}
                                renderContext="dialog"
                                onResultSelect={onResultSelect}
                                onFieldInteraction={(fieldKey, justification) => {
                                  // Handle field interaction by calling the parent callback with the first result
                                  const firstResult = assetResults[0];
                                  if (firstResult && onFieldInteraction) {
                                    onFieldInteraction(firstResult, fieldKey);
                                  }
                                }}
                              />
                            </div>
                        </div>
                    );
                })}
             </div>
         )
    }

    return null;
};


export default AnnotationResultsChart;

