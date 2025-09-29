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
} from 'recharts';
import { format, startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { AnnotationRead, AnnotationSchemaRead, AssetRead } from '@/client';
import { TimeAxisConfig, FormattedAnnotation, TimeFrameFilter } from '@/lib/annotations/types';
import { getTargetKeysForScheme, checkFilterMatch, formatDisplayValue, getAnnotationFieldValue } from '@/lib/annotations/utils';
import { VariableSplittingConfig, applySplittingToResults, applyAmbiguityResolution } from './VariableSplittingControls';
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
import { Settings2, ArrowDownUp, SortAsc, SortDesc, Info } from 'lucide-react';
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";


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
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  assets?: AssetRead[];
  sources?: { id: number; name: string }[];
  analysisData?: any[] | null;
  timeAxisConfig: TimeAxisConfig | null;
  selectedTimeInterval: 'day' | 'week' | 'month' | 'quarter' | 'year';
  aggregateSourcesDefault?: boolean;
  selectedDataSourceIds?: number[];
  showControls?: boolean;
  // Variable splitting configuration
  variableSplittingConfig?: VariableSplittingConfig | null;
  onVariableSplittingChange?: (config: VariableSplittingConfig | null) => void;
  // Settings callback for persistence
  onSettingsChange?: (settings: any) => void;
  initialSettings?: any;
  // NEW: Result selection callback
  onResultSelect?: (result: FormattedAnnotation) => void;
  // NEW: Field interaction callback for opening enhanced dialog
  onFieldInteraction?: (result: FormattedAnnotation, fieldKey: string) => void;
}

// NEW: Interface for group selection in timeline charts
export interface GroupSelectionConfig {
  visibleGroups: Set<string>;
  allGroups: string[];
}

// --- HELPER FUNCTIONS --- //
const getTimestamp = (result: FormattedAnnotation, assetsMap: Map<number, AssetRead>, timeAxisConfig: TimeAxisConfig | null): Date | null => {
  if (!timeAxisConfig) return null;
  let dateSource: string | number | Date | null = null;
  switch (timeAxisConfig.type) {
    case 'event': dateSource = assetsMap.get(result.asset_id)?.event_timestamp || null; break;
    case 'schema':
      if (timeAxisConfig.schemaId === result.schema_id && timeAxisConfig.fieldKey) {
        dateSource = getAnnotationFieldValue(result.value, timeAxisConfig.fieldKey) || null;
        
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
    const timestamp = getTimestamp(result, assetsMap, timeAxisConfig);
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

interface CustomTooltipProps extends TooltipProps<number, string> {
  keyToSplitValueMap: Map<string, string>;
}

const CustomTooltipContent = ({ active, payload, label, keyToSplitValueMap }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
    
  const pointData = payload[0].payload;
  const formattedDate = format(new Date(pointData.timestamp), 'yyyy-MM-dd');
  const groups = new Map<string, any[]>();

  payload.forEach(pld => {
      const splitValue = (pld.dataKey && keyToSplitValueMap.get(String(pld.dataKey))) || 'General';
      
      if (!groups.has(splitValue)) {
          groups.set(splitValue, []);
      }
      
      const cleanName = pld.name?.replace(`${splitValue} (`, '(').replace(')', '') || 'N/A';
      
      groups.get(splitValue)!.push({
          color: pld.color,
          name: cleanName,
          value: pld.value
      });
  });

  return (
    <div className="bg-card/90 dark:bg-popover p-3 border border-border rounded-lg shadow-xl text-sm text-popover-foreground backdrop-blur-sm">
      <p className="font-bold text-base mb-2">{formattedDate}</p>
      
      {Array.from(groups.entries()).map(([groupName, items]) => (
        <div key={groupName} className="mb-2 last:mb-0">
          <p className="font-semibold text-sm text-foreground">{groupName}</p>
          <div className="pl-2 mt-1 space-y-1">
            {items.map((item, index) => (
              <div key={`tooltip-item-${index}`} className="flex items-center space-x-2">
                <div style={{width: 8, height: 8, backgroundColor: item.color, borderRadius: '50%', flexShrink: 0}} />
                <span className="flex-1 truncate text-muted-foreground" title={item.name}>{item.name}</span>
                <span className="font-bold">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {pointData.documents && pointData.documents.length > 0 && (
        <p className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
          Based on {pointData.documents.length} document{pointData.documents.length > 1 ? 's' : ''} in this period.
        </p>
      )}
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
  results,
  schemas,
  assets = [],
  sources = [],
  analysisData = null,
  timeAxisConfig,
  selectedTimeInterval,
  aggregateSourcesDefault = true,
  selectedDataSourceIds = [],
  showControls = true,
  variableSplittingConfig = null,
  onVariableSplittingChange,
  onSettingsChange,
  initialSettings,
  // NEW: Result selection callback
  onResultSelect,
  // NEW: Field interaction callback for opening enhanced dialog
  onFieldInteraction,
}) => {
  const [isGrouped, setIsGrouped] = useState(false);
  const [aggregateSources, setAggregateSources] = useState(aggregateSourcesDefault);
  const [groupingSchemeId, setGroupingSchemeId] = useState<number | null>(() => {
    const initialId = schemas.length > 0 ? schemas[0].id : null;
    return initialId;
  });
  const [groupingFieldKey, setGroupingFieldKey] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<ChartDataPoint | GroupedDataPoint | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [groupedSortOrder, setGroupedSortOrder] = useState<'count-desc' | 'value-asc' | 'value-desc'>('count-desc');
  
  // --- Statistical visualization controls ---
  const [showStatistics, setShowStatistics] = useState(false);
  const [showAnnotationBars, setShowAnnotationBars] = useState(true);
  const [selectedSchemaIds, setSelectedSchemaIds] = useState<number[]>(() => 
    schemas.map(s => s.id)
  );
  
  // --- SIMPLIFIED STATE: Only individual field visibility ---
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  
  // --- Line continuity: Always connect nulls for better timeline visualization ---

  const assetsMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  const sourceNameMap = useMemo(() => new Map(sources.map(s => [s.id, s.name || `Source ${s.id}`])), [sources]);

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
    timeAxisConfig?.fieldKey
  ]);

  // === UNIFIED DATA PROCESSING: Single pass that handles both splitting and field detection ===
  const processedData = useMemo((): ProcessedChartData => {
    // Create assetsMap locally to avoid dependency instability
    const localAssetsMap = new Map(assets.map(asset => [asset.id, asset]));
    
    if (analysisData) {
      return {
        type: 'no-splitting',
        chartData: analysisData.map(d => ({
          ...d,
          timestamp: new Date(d.timestamp).getTime(),
          dateString: format(new Date(d.timestamp), 'yyyy-MM-dd'),
        })),
        fields: [], // Analysis data doesn't have structured fields
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
                    displayName: `${groupName} (${fieldName})`,
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
    const chartData = processLineChartData(
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
                displayName: `${schema.name}.${fieldName}`,
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
    resultsForChart,
    schemas.map(s => s.id).sort().join(','), // FIXED: Use stable schema IDs
    assets.map(a => a.id).sort().join(','), // FIXED: Use stable asset IDs instead of assetsMap
    timeAxisConfig?.type,
    timeAxisConfig?.schemaId,
    timeAxisConfig?.fieldKey,
    selectedTimeInterval,
    groupingSchemeId,      
    groupingFieldKey,       
    aggregateSources,
    groupedSortOrder,
    selectedSchemaIds.sort().join(',')
  ]);

  // === SIMPLIFIED FIELD VISIBILITY: Single effect that initializes from processed data ===
  useEffect(() => {
    if (processedData.fields.length > 0) {
      setVisibleFields(new Set(processedData.fields.map(f => f.key)));
    } else {
      setVisibleFields(new Set());
    }
  }, [processedData.fields.map(f => f.key).sort().join(',')]); // FIXED: Use stable field key representation

   const handlePointClick = (data: any) => {
      if (data && data.activePayload && data.activePayload.length > 0) {
          const pointData = data.activePayload[0].payload;
          setSelectedPoint(pointData);
          setIsDialogOpen(true);
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

  // NEW: Enhanced click handler for timeline charts
  const handleTimelinePointClick = (data: any, event: any) => {
    if (data && data.activePayload && data.activePayload.length > 0) {
      const pointData = data.activePayload[0].payload;
      setSelectedPoint(pointData);
      setIsDialogOpen(true);
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

  return (
    <div className="h-full flex flex-col space-y-3">
      {showControls && (
        <div className="flex-shrink-0 space-y-3">
          {/* Chart Type Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Label className="text-sm font-medium">Chart Type:</Label>
              <ToggleGroup
                type="single"
                value={isGrouped ? 'grouped' : 'timeline'}
                onValueChange={(value) => setIsGrouped(value === 'grouped')}
                size="sm"
              >
                <ToggleGroupItem value="timeline" disabled={!timeAxisConfig}>
                  Timeline
                </ToggleGroupItem>
                <ToggleGroupItem value="grouped">
                  Grouped
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            
            {!isGrouped && timeAxisConfig && (
              <div className="flex items-center space-x-2">
                <Label className="text-sm font-medium">Interval:</Label>
                <Select
                  value={selectedTimeInterval}
                  onValueChange={(value) => {
                    if (onSettingsChange) {
                      onSettingsChange({ selectedTimeInterval: value });
                    }
                  }}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Day</SelectItem>
                    <SelectItem value="week">Week</SelectItem>
                    <SelectItem value="month">Month</SelectItem>
                    <SelectItem value="quarter">Quarter</SelectItem>
                    <SelectItem value="year">Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Grouped Chart Controls */}
          {isGrouped && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-muted/20 rounded-lg">
              <div>
                <Label className="text-sm font-medium mb-1 block">Group By Schema</Label>
                <Select
                  value={groupingSchemeId?.toString() ?? ""}
                  onValueChange={(v) => setGroupingSchemeId(v ? parseInt(v) : null)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select schema..." />
                  </SelectTrigger>
                  <SelectContent>
                    {schemas.map(s => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-medium mb-1 block">Group By Field</Label>
                <Select
                  value={groupingFieldKey ?? ""}
                  onValueChange={(v) => setGroupingFieldKey(v || null)}
                  disabled={!groupingSchemeId}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select field..." />
                  </SelectTrigger>
                  <SelectContent>
                    {groupingSchemeId && getTargetKeysForScheme(groupingSchemeId, schemas).map(tk => (
                      <SelectItem key={tk.key} value={tk.key}>{tk.name} ({tk.type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-medium mb-1 block">Sort Order</Label>
                <Select
                  value={groupedSortOrder}
                  onValueChange={(v) => setGroupedSortOrder(v as any)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count-desc">Count (High to Low)</SelectItem>
                    <SelectItem value="value-asc">Value (A to Z)</SelectItem>
                    <SelectItem value="value-desc">Value (Z to A)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Timeline Chart Controls */}
          {!isGrouped && schemas.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-sm font-medium">Schemas:</Label>
              {schemas.map(schema => {
                // Check if any field from this schema has data in processed data
                const hasData = processedData.fields.some(field => field.schemaName === schema.name);
                const isSelected = selectedSchemaIds.includes(schema.id);
                return (
                  <div key={schema.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`schema-${schema.id}`}
                      checked={isSelected}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedSchemaIds([...selectedSchemaIds, schema.id]);
                        } else {
                          setSelectedSchemaIds(selectedSchemaIds.filter(id => id !== schema.id));
                        }
                      }}
                      disabled={!hasData}
                    />
                    <Label htmlFor={`schema-${schema.id}`} className={cn("text-sm", !hasData && "opacity-50")}>
                      {schema.name}
                    </Label>
                  </div>
                );
              })}
              
              <div className="flex gap-1 ml-2">
                {selectedSchemaIds.length < schemas.length && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setSelectedSchemaIds(schemas.map(s => s.id))}
                    className="text-xs px-2 py-1 h-auto"
                  >
                    All
                  </Button>
                )}
                {selectedSchemaIds.length > 1 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                      // Keep only the first schema with data
                      const firstWithData = schemas.find(s => 
                        processedData.fields.some(field => field.schemaName === s.name)
                      );
                      if (firstWithData) {
                        setSelectedSchemaIds([firstWithData.id]);
                      }
                    }}
                    className="text-xs px-2 py-1 h-auto"
                  >
                    One
                  </Button>
                )}
              </div>
            </div>
          )}



          {/* Individual Field Visibility Controls */}
          {!isGrouped && processedData.fields.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Fields:</Label>
                <div className="flex gap-1">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleToggleAllFields(true)}
                    disabled={visibleFields.size === processedData.fields.length}
                    className="text-xs px-2 py-1 h-auto"
                  >
                    All
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleToggleAllFields(false)}
                    disabled={visibleFields.size === 0}
                    className="text-xs px-2 py-1 h-auto"
                  >
                    None
                  </Button>
                </div>
              </div>
              
              <div className="max-h-32 overflow-y-auto">
                {processedData.type === 'splitting' ? (
                  // Group fields by group for variable splitting
                  (() => {
                    const fieldsByGroup = processedData.fields.reduce((acc, field) => {
                      const group = field.groupName || 'Other';
                      if (!acc[group]) acc[group] = [];
                      acc[group].push(field);
                      return acc;
                    }, {} as Record<string, typeof processedData.fields>);
                    
                    return Object.entries(fieldsByGroup).map(([groupName, groupFields]) => (
                      <div key={groupName} className="mb-3">
                        <div className="text-xs font-medium text-muted-foreground mb-1 border-b pb-1">
                          {groupName} ({groupFields.length} fields)
                        </div>
                        <div className="flex flex-wrap gap-2 pl-2">
                          {groupFields.map(field => (
                            <div key={field.key} className="flex items-center space-x-2">
                              <Checkbox
                                id={`field-${field.key}`}
                                checked={visibleFields.has(field.key)}
                                onCheckedChange={() => handleFieldVisibilityToggle(field.key)}
                              />
                              <Label htmlFor={`field-${field.key}`} className="text-xs">
                                {field.fieldName}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()
                ) : (
                  // Flat display for non-splitting
                  <div className="flex flex-wrap gap-2">
                    {processedData.fields.map(field => (
                      <div key={field.key} className="flex items-center space-x-2">
                        <Checkbox
                          id={`field-${field.key}`}
                          checked={visibleFields.has(field.key)}
                          onCheckedChange={() => handleFieldVisibilityToggle(field.key)}
                        />
                        <Label htmlFor={`field-${field.key}`} className="text-xs">
                          {field.displayName}
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              

            </div>
          )}

          {/* Statistical Analysis Toggle */}
          {!isGrouped && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-statistics"
                  checked={showStatistics}
                  onCheckedChange={setShowStatistics}
                />
                <Label htmlFor="show-statistics" className="text-sm font-medium">
                  Show Min/Max/Avg Statistics
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-annotation-bars"
                  checked={showAnnotationBars}
                  onCheckedChange={setShowAnnotationBars}
                />
                <Label htmlFor="show-annotation-bars" className="text-sm font-medium">
                  Show Annotation Count Bars
                </Label>
              </div>

            </div>
          )}
        </div>
      )}

      {/* Chart Display */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {hasNoData ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Info className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">No Chart Data Available</p>
              <p className="text-sm mt-2">
                {!timeAxisConfig && !isGrouped ? 
                  "Configure time axis settings to display timeline charts." :
                  "No data matches the current filters and settings."
                }
              </p>
            </div>
          </div>
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
                        margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                      >
                        <XAxis 
                          dataKey="valueString" 
                          tick={{ fontSize: 12 }}
                          angle={-45}
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
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <XAxis 
                  dataKey="valueString" 
                  tick={{ fontSize: 12 }}
                  angle={-45}
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
                margin={{ top: 20, right: 60, left: 20, bottom: 5 }}
                onClick={handleTimelinePointClick}
              >
                <XAxis 
                  dataKey="dateString" 
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                <RechartsTooltip 
                  cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }}
                  content={<CustomTooltipContent keyToSplitValueMap={new Map()} />} 
                />
                
                {/* Add Legend component for timeline charts */}
                {fieldsToRender.length > 0 && (
                  <Legend 
                    verticalAlign="top" 
                    height={Math.min(120, Math.ceil(fieldsToRender.length / 4) * 18)} // Dynamic height based on items
                    wrapperStyle={{ 
                      paddingBottom: '10px',
                      maxHeight: '120px',
                      overflowY: 'auto',
                      overflowX: 'hidden'
                    }}
                  />
                )}
                
                {/* Annotation count bars */}
                {showAnnotationBars && (
                  <Bar
                    yAxisId="right"
                    dataKey="count"
                    fill="#e0e7ff"
                    fillOpacity={0.3}
                    stroke="#6366f1"
                    strokeWidth={1}
                    name="Annotation Count"
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
                       name={field.displayName}
                       connectNulls={true}
                       isAnimationActive={false}
                       onClick={handleTimelinePointClick}
                     />
                   );
                 })}
              </ComposedChart>
            )}
          </ResponsiveContainer>
        )}
      </div>

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

