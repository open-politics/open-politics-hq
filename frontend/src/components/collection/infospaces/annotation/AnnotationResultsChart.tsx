'use client';

import React, { useMemo, useState, useCallback, useEffect } from 'react';
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
  Area,
} from 'recharts';
import { format, startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { AnnotationRead, AnnotationSchemaRead, AssetRead } from '@/client/models';
import { TimeAxisConfig, FormattedAnnotation } from '@/lib/annotations/types';
import { getTargetKeysForScheme, checkFilterMatch, formatDisplayValue, getAnnotationFieldValue } from '@/lib/annotations/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from '@/components/ui/switch';
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AssetLink from '../assets/Helper/AssetLink';
import AnnotationResultDisplay from './AnnotationResultDisplay';
import { ResultFilter } from './AnnotationResultFilters';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Settings2, ArrowDownUp, SortAsc, SortDesc, Info } from 'lucide-react';
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";


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
const getPlottableValue = (result: FormattedAnnotation, schema: AnnotationSchemaRead): number | string | null => {
  if (!result || !result.value || !schema) {
    return null;
  }

  // Get all available fields for this schema
  const plottableFields = getPlottableFieldsForSchema(schema);
  if (plottableFields.length === 0) return null;

  // Try to find a numeric field first (preferred for plotting)
  const numericField = plottableFields.find(f => f.type === 'integer' || f.type === 'number');
  const fieldToUse = numericField || plottableFields[0];

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

  // Handle numeric fields
  if (fieldToUse.type === 'integer' || fieldToUse.type === 'number') {
    const num = Number(fieldValue);
    return !isNaN(num) ? num : null;
  }

  // Handle string fields - try to convert to number, otherwise return as string
  if (fieldToUse.type === 'string') {
    const num = Number(fieldValue);
    if (!isNaN(num)) return num;
    return String(fieldValue);
  }

  // Handle arrays - return count or null
  if (fieldToUse.type === 'array' && Array.isArray(fieldValue)) {
    return fieldValue.length;
  }

  return null;
};

const safeStringify = (value: any): string => {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); } 
  catch { return 'Complex Data'; }
};

const processGroupedChartData = (
  resultsToProcess: FormattedAnnotation[],
  schemes: AnnotationSchemaRead[],
  assetsMap: Map<number, AssetRead>,
  groupingSchemeId: number | null,
  groupingFieldKey: string | null,
  aggregateSources: boolean
): GroupedDataPoint[] => {
   if (!groupingSchemeId || !groupingFieldKey || resultsToProcess.length === 0) {
     return [];
   }
   
   const selectedScheme = schemes.find(s => s.id === groupingSchemeId);
   if (!selectedScheme) {
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
        
        // Process the field value using the same logic as the pie chart
        if (fieldValue === null || fieldValue === undefined) {
            // Handle null/undefined - count as N/A
            const valueString = 'N/A';
            let entry = valueCountsMap.get(valueString);
            if (!entry) {
                entry = { counts: new Map(), documents: new Map() };
                valueCountsMap.set(valueString, entry);
            }
            const effectiveSourceId = aggregateSources ? 'all' : sourceId;
            entry.counts.set(effectiveSourceId, (entry.counts.get(effectiveSourceId) || 0) + 1);
            let docList = entry.documents.get(effectiveSourceId);
            if (!docList) {
                docList = [];
                entry.documents.set(effectiveSourceId, docList);
            }
            if (!docList.includes(result.asset_id)) docList.push(result.asset_id);
        } else if (Array.isArray(fieldValue)) {
            // Handle array fields - count each item separately
            if (fieldValue.length === 0) {
                const valueString = 'N/A (from empty list)';
                let entry = valueCountsMap.get(valueString);
                if (!entry) {
                    entry = { counts: new Map(), documents: new Map() };
                    valueCountsMap.set(valueString, entry);
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
                fieldValue.forEach(label => {
                    const valueString = String(label ?? 'N/A');
                    let entry = valueCountsMap.get(valueString);
                    if (!entry) {
                        entry = { counts: new Map(), documents: new Map() };
                        valueCountsMap.set(valueString, entry);
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
        } else if (typeof fieldValue === 'object') {
            // Handle object fields
            let valueString: string;
            try { 
                valueString = JSON.stringify(fieldValue); 
            } catch (e) { 
                valueString = '[Complex Object]'; 
            }
            let entry = valueCountsMap.get(valueString);
            if (!entry) {
                entry = { counts: new Map(), documents: new Map() };
                valueCountsMap.set(valueString, entry);
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
            // Handle primitive values (string, number, boolean)
            const valueString = String(fieldValue);
            let entry = valueCountsMap.get(valueString);
            if (!entry) {
                entry = { counts: new Map(), documents: new Map() };
                valueCountsMap.set(valueString, entry);
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
  // Extract plottable fields from schema - look for numeric types
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
      
      if (value.type === 'integer' || value.type === 'number') {
        fields.push({
          key: fullKey,
          name: value.title || key,
          type: value.type
        });
      } else if (value.type === 'string' || (value.type === 'array' && value.items?.type === 'string')) {
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

// --- ENHANCED DATA PROCESSING FUNCTION --- //


// --- NEW: Simplified Line Chart Data Processing (based on old working component) ---
const processLineChartData = (
  results: FormattedAnnotation[],
  schemas: AnnotationSchemaRead[],
  assetsMap: Map<number, AssetRead>,
  timeAxisConfig: TimeAxisConfig | null,
  groupingInterval: 'day' | 'week' | 'month' | 'quarter' | 'year'
): ChartDataPoint[] => {
  
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
  const finalChartData = Object.entries(resultsByDateAndAsset).map(([dateKey, assetResults]) => {
    // Get the first result to extract actual timestamp for formatting
    const firstResult = Object.values(assetResults)[0]?.[0];
    const actualTimestamp = firstResult ? getTimestamp(firstResult, assetsMap, timeAxisConfig) : new Date();
    const validTimestamp = actualTimestamp || new Date();
    
    const chartPoint: ChartDataPoint = {
      dateString: dateKey,
      timestamp: validTimestamp.getTime(),
      count: Object.keys(assetResults).length, // Count of unique assets on this date
      documents: [...new Set(Object.values(assetResults).flatMap(results => results.map(r => r.asset_id)))],
      stats: {},
      categoryFrequency: {}
    };

    // Store asset scheme values for tooltip access
    const assetSchemeValues: Record<string, Record<string, any>> = {};

    // Process each asset's results
    Object.entries(assetResults).forEach(([assetKey, assetSchemaResults]) => {
      const assetId = assetKey.replace('asset-', '');
      assetSchemeValues[assetId] = {};

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
          assetSchemeValues[assetId][schemeName] = result.value;

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
              // Create unique field key for chart
              const fieldChartKey = `${schemeName}_${field.name}`;
              
              let numericValue: number | null = null;
              
              // Handle different field types
              if (field.type === 'integer' || field.type === 'number') {
                const num = Number(fieldValue);
                if (!isNaN(num)) {
                  numericValue = num;
                }
              } else if (field.type === 'array' && Array.isArray(fieldValue)) {
                // For arrays, use the count as the numeric value
                numericValue = fieldValue.length;
              } else if (field.type === 'string') {
                // For strings, try to convert to number, otherwise use string length
                const num = Number(fieldValue);
                if (!isNaN(num)) {
                  numericValue = num;
                } else {
                  numericValue = String(fieldValue).length;
                }
              }

              if (numericValue !== null) {

                // Initialize stats object for this field if needed
                if (!chartPoint.stats![fieldChartKey]) {
                  chartPoint.stats![fieldChartKey] = { min: Infinity, max: -Infinity, avg: 0, count: 0 };
                }

                const stats = chartPoint.stats![fieldChartKey];
                stats.min = Math.min(stats.min, numericValue);
                stats.max = Math.max(stats.max, numericValue);
                stats.count += 1;
                stats.avg = (stats.avg * (stats.count - 1) + numericValue) / stats.count;

                // Store raw value for direct chart access
                if (chartPoint[fieldChartKey] === undefined) {
                  chartPoint[fieldChartKey] = numericValue;
                } else {
                  // Average multiple values on the same date
                  const currentVal = chartPoint[fieldChartKey] as number;
                  chartPoint[fieldChartKey] = (currentVal + numericValue) / 2;
                }
              }
            }
          });
        });
      });
    });

    // Store the asset scheme values for tooltips
    chartPoint.assetSchemeValues = assetSchemeValues;

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

    // Handle categorical data (for non-numeric fields)
    if (chartPoint.categoryFrequency) {
      Object.entries(chartPoint.categoryFrequency).forEach(([schemeName, categories]) => {
        const sortedCategories = Object.entries(categories)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);

        if (sortedCategories.length > 0) {
          chartPoint[`${schemeName}_topCategory`] = sortedCategories[0][0];
          chartPoint[`${schemeName}_topCategoryCount`] = sortedCategories[0][1];
        }
      });
    }

    return chartPoint;
  });

  
  // Debug: Log schema fields in chart data
  finalChartData.forEach((point, index) => {
    const schemaFields = Object.keys(point).filter(key => 
      !['dateString', 'timestamp', 'count', 'documents', 'stats', 'categoryFrequency', 'assetSchemeValues'].includes(key) &&
      !key.endsWith('_min') && !key.endsWith('_max') && !key.endsWith('_avg') && !key.endsWith('_topCategory') && !key.endsWith('_topCategoryCount')
    );
    schemaFields.forEach(field => {
    });
  });
  
  return finalChartData.sort((a, b) => a.timestamp - b.timestamp);
};

// --- MAIN COMPONENT --- //
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
  
  // --- NEW: Statistical visualization controls (simplified) ---
  const [showStatistics, setShowStatistics] = useState(false);
  const [selectedSchemaIds, setSelectedSchemaIds] = useState<number[]>(() => 
    // By default, select all schemas
    schemas.map(s => s.id)
  );

  const assetsMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  const sourceNameMap = useMemo(() => new Map(sources.map(s => [s.id, s.name || `Source ${s.id}`])), [sources]);





  useEffect(() => {
      
      if (groupingSchemeId) {
          const keys = getTargetKeysForScheme(groupingSchemeId, schemas);
          const currentKeyIsValid = keys.some(k => k.key === groupingFieldKey);
          if (!currentKeyIsValid) {
            const newKey = keys.length > 0 ? keys[0].key : null;
            setGroupingFieldKey(newKey);
          }
      } else {
        setGroupingFieldKey(null);
      }
  }, [groupingSchemeId, schemas, groupingFieldKey]);

  // Update selected schemas when schemas change
  useEffect(() => {
    // Make sure selected schemas still exist
    const validSchemaIds = selectedSchemaIds.filter(id => schemas.some(s => s.id === id));
    if (validSchemaIds.length === 0 && schemas.length > 0) {
      // If no valid schemas selected, select all
      setSelectedSchemaIds(schemas.map(s => s.id));
    } else if (validSchemaIds.length !== selectedSchemaIds.length) {
      setSelectedSchemaIds(validSchemaIds);
    }
  }, [schemas, selectedSchemaIds]);

  const resultsForChart = useMemo(() => {
    
    if (!selectedDataSourceIds || selectedDataSourceIds.length === 0) {
      return results;
    }
    
    const assetIdToSourceId = new Map(assets.map(a => [a.id, a.source_id]));
    
    const filtered = results.filter(r => {
      const sourceId = assetIdToSourceId.get(r.asset_id);
      const included = sourceId !== undefined && selectedDataSourceIds.includes(sourceId ?? 0);
      if (!included) {
      }
      return included;
    });
    
    return filtered;
  }, [results, selectedDataSourceIds, assets]);

  const chartData: ChartData | GroupedDataPoint[] = useMemo(() => {
    
    if (analysisData) {
      return analysisData.map(d => ({
        ...d,
        timestamp: new Date(d.timestamp).getTime(),
        dateString: format(new Date(d.timestamp), 'MMM d, yyyy'),
        documents: [] // Add required field
      })).sort((a, b) => a.timestamp - b.timestamp);
    }
    
    if (isGrouped) {
        const grouped = processGroupedChartData(results, schemas, assetsMap, groupingSchemeId, groupingFieldKey, aggregateSources);
        return grouped.sort((a, b) => {
            if (groupedSortOrder === 'count-desc') return b.totalCount - a.totalCount;
            if (groupedSortOrder === 'value-asc') return a.valueString.localeCompare(b.valueString);
            if (groupedSortOrder === 'value-desc') return b.valueString.localeCompare(a.valueString);
            return 0;
        });
    }

    if (!timeAxisConfig) {
      return [];
    }
    
    // Use simplified line chart processing that actually plots values
    const lineData = processLineChartData(
      results, // Use all results, don't filter by sources for annotation schema fields
      schemas, 
      assetsMap, 
      timeAxisConfig, 
      selectedTimeInterval
    );
    return lineData;

  }, [analysisData, isGrouped, results, schemas, assetsMap, timeAxisConfig, selectedTimeInterval, groupingSchemeId, groupingFieldKey, aggregateSources, groupedSortOrder]);

  const handlePointClick = (data: any) => {
      if (data && data.activePayload && data.activePayload.length > 0) {
          const pointData = data.activePayload[0].payload;
          setSelectedPoint(pointData);
          setIsDialogOpen(true);
      }
  };

  const hasValueFields = chartData.length > 0 && 
    schemas.some(schema => chartData.some(point => point[schema.name] !== undefined));

  // Get field keys that have actual data to plot AND are from selected schemas
  const availableFieldKeys = useMemo(() => {
    if (isGrouped || chartData.length === 0) {
      return [];
    }
    
    const fieldKeys: Array<{key: string, schemaName: string, fieldName: string, schema: AnnotationSchemaRead}> = [];
    
    schemas.forEach(schema => {
      const isSelected = selectedSchemaIds.includes(schema.id);
      if (!isSelected) return;
      
      // Find all field keys for this schema that have data
      const schemaFieldKeys = Object.keys(chartData[0] || {}).filter(key => {
        return key.startsWith(`${schema.name}_`) && 
               !key.endsWith('_min') && !key.endsWith('_max') && !key.endsWith('_avg') &&
               !key.endsWith('_topCategory') && !key.endsWith('_topCategoryCount');
      });
      
      schemaFieldKeys.forEach(fieldKey => {
        const hasData = chartData.some(point => point[fieldKey] !== undefined && point[fieldKey] !== null);
        if (hasData) {
          const fieldName = fieldKey.replace(`${schema.name}_`, '');
          fieldKeys.push({
            key: fieldKey,
            schemaName: schema.name,
            fieldName: fieldName,
            schema: schema
          });
        }
      });
    });
    
    return fieldKeys;
  }, [schemas, chartData, isGrouped, selectedSchemaIds]);

  const renderMinMaxArea = useCallback((schema: AnnotationSchemaRead, color: string) => {
    return (
      <React.Fragment key={`area-${schema.id}`}>
        <Area
          yAxisId="left"
          type="monotone"
          dataKey={`${schema.name}_min`}
          stroke="none"
          fillOpacity={0}
          name={`${schema.name} (min)`}
          isAnimationActive={false}
        />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey={`${schema.name}_max`}
          stroke="none"
          fillOpacity={0.2}
          fill={color}
          name={`${schema.name} (range)`}
          isAnimationActive={false}
        />
      </React.Fragment>
    );
  }, []);

  // Always show controls, even with no data
  const hasNoData = chartData.length === 0 && !analysisData;

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 mb-4 p-3 rounded-md border">
        <div className="flex items-center gap-2">
          <Switch id="group-switch" checked={isGrouped} onCheckedChange={setIsGrouped} />
          <Label htmlFor="group-switch">Group by value</Label>
        </div>
        
        {/* --- Statistical Controls (only for time series) --- */}
        {!isGrouped && schemas.length > 0 && (
          <div className="flex items-center gap-2">
            <Switch id="stats-switch" checked={showStatistics} onCheckedChange={setShowStatistics} />
            <Label htmlFor="stats-switch">Show statistics (min/avg/max)</Label>
          </div>
        )}

        {/* --- Schema Selection Controls (only for time series) --- */}
        {!isGrouped && schemas.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-sm font-medium">Schemas:</Label>
            {schemas.map(schema => {
              // Check if any field from this schema has data
              const hasData = chartData.length > 0 && chartData.some(point => 
                Object.keys(point).some(key => 
                  key.startsWith(`${schema.name}_`) && 
                  !key.endsWith('_min') && !key.endsWith('_max') && !key.endsWith('_avg') &&
                  !key.endsWith('_topCategory') && !key.endsWith('_topCategoryCount') &&
                  point[key] !== undefined && point[key] !== null
                )
              );
              const isSelected = selectedSchemaIds.includes(schema.id);
              
              return (
                <Button
                  key={schema.id}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    if (isSelected) {
                      // Don't allow deselecting the last schema
                      if (selectedSchemaIds.length > 1) {
                        setSelectedSchemaIds(selectedSchemaIds.filter(id => id !== schema.id));
                      }
                    } else {
                      setSelectedSchemaIds([...selectedSchemaIds, schema.id]);
                    }
                  }}
                  disabled={!hasData}
                  className="text-xs px-2 py-1 h-auto"
                  title={hasData ? undefined : "No data available for this schema"}
                >
                  {schema.name}
                  {hasData && <span className="ml-1 text-xs opacity-60">✓</span>}
                </Button>
              );
            })}
            
            {/* Quick action buttons */}
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
                      chartData.some(point => 
                        Object.keys(point).some(key => 
                          key.startsWith(`${s.name}_`) && 
                          !key.endsWith('_min') && !key.endsWith('_max') && !key.endsWith('_avg') &&
                          !key.endsWith('_topCategory') && !key.endsWith('_topCategoryCount') &&
                          point[key] !== undefined && point[key] !== null
                        )
                      )
                    );
                    if (firstWithData) {
                      setSelectedSchemaIds([firstWithData.id]);
                    }
                  }}
                  className="text-xs px-2 py-1 h-auto"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        )}
        
        {isGrouped && (
            <>
                <Select value={groupingSchemeId?.toString() ?? ''} onValueChange={v => setGroupingSchemeId(parseInt(v))}>
                    <SelectTrigger className="w-[180px] h-9 text-xs"><SelectValue placeholder="Select Schema..." /></SelectTrigger>
                    <SelectContent>{schemas.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={groupingFieldKey ?? ''} onValueChange={setGroupingFieldKey} disabled={!groupingSchemeId}>
                    <SelectTrigger className="w-[180px] h-9 text-xs"><SelectValue placeholder="Select Field..." /></SelectTrigger>
                    <SelectContent>{(groupingSchemeId ? getTargetKeysForScheme(groupingSchemeId, schemas) : []).map(k => <SelectItem key={k.key} value={k.key}>{k.name}</SelectItem>)}</SelectContent>
                </Select>
                <ToggleGroup type="single" size="sm" variant="outline" value={groupedSortOrder} onValueChange={(v: any) => v && setGroupedSortOrder(v)}>
                    <ToggleGroupItem value="count-desc" title="Sort by Count"><ArrowDownUp className="h-4 w-4" /></ToggleGroupItem>
                    <ToggleGroupItem value="value-asc" title="Sort by Value Asc"><SortAsc className="h-4 w-4" /></ToggleGroupItem>
                    <ToggleGroupItem value="value-desc" title="Sort by Value Desc"><SortDesc className="h-4 w-4" /></ToggleGroupItem>
                </ToggleGroup>
            </>
        )}
      </div>
      
      {hasNoData ? (
        <div className="flex items-center justify-center h-[400px] text-muted-foreground p-4 text-center border border-dashed rounded-lg">
          <div>
            <Info className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No data available for the current selection.</p>
            <p className="text-xs mt-2 opacity-75">
              {isGrouped ? "Try selecting a different schema or field above." : "Load a completed annotation run or adjust filters to see chart data."}
            </p>
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={400}>
          {!isGrouped ? (
            <ComposedChart data={chartData as any} margin={{ top: 5, right: 20, left: 0, bottom: 50 }} onClick={handlePointClick}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis
                dataKey="dateString"
                angle={-45} textAnchor="end" height={70} interval="preserveStartEnd"
                tickFormatter={(label) => {
                  // Find the data point with this dateString to get its actual timestamp
                  const point = (chartData as ChartDataPoint[]).find(p => p.dateString === label);
                  if (point && point.timestamp) {
                    return format(new Date(point.timestamp), 'MMM dd, yyyy');
                  }
                  return String(label);
                }}
                style={{ fontSize: '12px' }}
              />
              <YAxis yAxisId="left" stroke="#82ca9d" style={{ fontSize: '12px' }} allowDecimals={true} />
              <RechartsTooltip 
                labelFormatter={(label) => {
                  // Find the data point with this dateString to get its actual timestamp
                  const point = (chartData as ChartDataPoint[]).find(p => p.dateString === label);
                  if (point && point.timestamp) {
                    return format(new Date(point.timestamp), 'PPP');
                  }
                  return String(label);
                }}
                contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '40px' }} />
              
              {/* Always show annotation count */}
              <Bar yAxisId="left" dataKey="count" fill="#82ca9d" name="Annotation Count" barSize={20} />
              
              {/* Render actual values for each field */}
              {availableFieldKeys.map((field, index) => {
                const fieldColor = PIE_COLORS[index % PIE_COLORS.length];
                
                if (showStatistics) {
                  // Show statistical view with min/max area and average line
                  const hasStats = chartData.some(point => 
                    point[`${field.key}_min`] !== undefined && 
                    point[`${field.key}_max`] !== undefined && 
                    point[`${field.key}_avg`] !== undefined
                  );
                  
                  if (hasStats) {
                    return (
                      <React.Fragment key={`stats-${field.key}`}>
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey={`${field.key}_min`}
                          stroke="none"
                          fillOpacity={0}
                          name={`${field.schemaName}.${field.fieldName} (min)`}
                          isAnimationActive={false}
                        />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey={`${field.key}_max`}
                          stroke="none"
                          fillOpacity={0.2}
                          fill={fieldColor}
                          name={`${field.schemaName}.${field.fieldName} (range)`}
                          isAnimationActive={false}
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey={`${field.key}_avg`}
                          stroke={fieldColor}
                          strokeWidth={3}
                          dot={{ r: 4, fill: fieldColor }}
                          name={`${field.schemaName}.${field.fieldName} (avg)`}
                          isAnimationActive={false}
                          strokeOpacity={0.8}
                        />
                      </React.Fragment>
                    );
                  }
                }
                
                // Default: render individual field values as lines
                return (
                  <Line
                    key={`line-${field.key}`}
                    yAxisId="left"
                    type="monotone"
                    dataKey={field.key}
                    stroke={fieldColor}
                    strokeWidth={3}
                    dot={{ r: 4, fill: fieldColor }}
                    name={`${field.schemaName}.${field.fieldName}`}
                    isAnimationActive={false}
                    strokeOpacity={0.8}
                  />
                );
              })}
            </ComposedChart>
          ) : (
            <ComposedChart data={chartData as any} margin={{ top: 5, right: 20, left: 0, bottom: 50 }} onClick={handlePointClick}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis
                dataKey="valueString"
                angle={-45} textAnchor="end" height={70} interval="preserveStartEnd"
                tickFormatter={(label) => String(label).length > 15 ? `${String(label).substring(0,15)}...` : label}
                style={{ fontSize: '12px' }}
              />
              <YAxis yAxisId="left" stroke="#82ca9d" style={{ fontSize: '12px' }} allowDecimals={false} />
              <RechartsTooltip labelFormatter={(label) => label} contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }} />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '40px' }} />
              
              <Bar yAxisId="left" dataKey="totalCount" fill="#82ca9d" name="Annotation Count" barSize={20}>
                {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
              </Bar>
            </ComposedChart>
          )}
        </ResponsiveContainer>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-3xl">
              <DialogHeader><DialogTitle>Detailed Results</DialogTitle></DialogHeader>
              <ScrollArea className="max-h-[70vh]">
                  {selectedPoint && (
                      <ChartDialogDetails
                          selectedPoint={selectedPoint}
                          results={results}
                          schemas={schemas}
                          assets={assets}
                          timeAxisConfig={timeAxisConfig}
                          selectedTimeInterval={selectedTimeInterval}
                      />
                  )}
              </ScrollArea>
          </DialogContent>
      </Dialog>
    </>
  );
};

interface ChartDialogDetailsProps {
  selectedPoint: GroupedDataPoint | ChartDataPoint;
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  assets?: AssetRead[];
  timeAxisConfig: TimeAxisConfig | null;
  selectedTimeInterval: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

const ChartDialogDetails: React.FC<ChartDialogDetailsProps> = ({ 
    selectedPoint, 
    results, 
    schemas, 
    assets,
    timeAxisConfig,
    selectedTimeInterval
}) => {
    
    if ('valueString' in selectedPoint) {
        const relevantAssetIds = Array.from(selectedPoint.sourceDocuments.values()).flat();
        return (
            <div className="p-4 space-y-4">
                <h3 className="font-bold">{selectedPoint.schemeName}: "{selectedPoint.valueString}" ({selectedPoint.totalCount} results)</h3>
                {relevantAssetIds.map((assetId: number) => {
                    const asset = assets?.find(a => a.id === assetId);
                    const assetResults = results.filter(r => r.asset_id === assetId && r.schema_id === schemas.find(s => s.name === selectedPoint.schemeName)?.id);
                    const relevantSchema = schemas.find(s => s.name === selectedPoint.schemeName);

                    if (!asset || !relevantSchema) return null;

                    return (
                        <div key={assetId} className="border-t pt-4">
                            <AssetLink assetId={assetId} className="font-semibold hover:underline">{asset.title || `Asset #${assetId}`}</AssetLink>
                            <div className="mt-2 pl-4 border-l-2">
                              <AnnotationResultDisplay result={assetResults} schema={[relevantSchema]} compact={false} useTabs={false} />
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    } 
    
    else if ('dateString' in selectedPoint) {
        const assetsMap = new Map(assets?.map(a => [a.id, a]));
        const relevantResults = results.filter(r => {
            const timestamp = getTimestamp(r, assetsMap, timeAxisConfig);
            if (!timestamp) return false;
            
            let dateKey: string;
            switch (selectedTimeInterval) {
                case 'week': dateKey = format(startOfWeek(timestamp), 'yyyy-MM-dd'); break;
                case 'month': dateKey = format(startOfMonth(timestamp), 'yyyy-MM-dd'); break;
                case 'quarter': dateKey = format(startOfQuarter(timestamp), 'yyyy-MM-dd'); break;
                case 'year': dateKey = format(startOfYear(timestamp), 'yyyy-MM-dd'); break;
                default: dateKey = format(startOfDay(timestamp), 'yyyy-MM-dd'); break;
            }
            return dateKey === selectedPoint.dateString;
        });
        
        const relevantAssetIds = Array.from(new Set(relevantResults.map(r => r.asset_id)));

         return (
             <div className="p-4 space-y-4">
                 <h3 className="font-bold">Date: {format(new Date(selectedPoint.timestamp), 'PPP')}</h3>
                 <p className="text-sm text-muted-foreground">{selectedPoint.count} annotation(s) in this time bucket.</p>
                 {relevantAssetIds.map(assetId => {
                    const asset = assets?.find(a => a.id === assetId);
                    if (!asset) return null;

                    const assetResults = relevantResults.filter(r => r.asset_id === assetId);
                    const relevantSchemaIds = Array.from(new Set(assetResults.map(r => r.schema_id)));
                    const relevantSchemas = schemas.filter(s => relevantSchemaIds.includes(s.id));

                    return (
                        <div key={assetId} className="border-t pt-4">
                            <AssetLink assetId={assetId} className="font-semibold hover:underline">{asset.title || `Asset #${assetId}`}</AssetLink>
                            <div className="mt-2 pl-4 border-l-2">
                              <AnnotationResultDisplay result={assetResults} schema={relevantSchemas} compact={false} useTabs={assetResults.length > 1} />
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

