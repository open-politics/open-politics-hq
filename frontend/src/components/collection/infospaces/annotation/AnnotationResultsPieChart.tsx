'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  TooltipProps
} from 'recharts';
import { AnnotationSchemaRead, AssetRead } from '@/client/models';
import { FormattedAnnotation, TimeAxisConfig } from '@/lib/annotations/types';
import { getTargetKeysForScheme, getAnnotationFieldValue } from '@/lib/annotations/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import AssetLink from '@/components/collection/infospaces/assets/Helper/AssetLink';
import AnnotationResultDisplay from './AnnotationResultDisplay';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { GroupedDataPoint } from './AnnotationResultsChart';
import { VariableSplittingConfig, applySplittingToResults, applyAmbiguityResolution } from './VariableSplittingControls';

// Define a generic SourceRead type to satisfy the linter
type SourceRead = {
  id: number;
  name: string;
  [key: string]: any;
};

const PIE_COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8',
  '#82CA9D', '#A4DE6C', '#D0ED57', '#FFC658', '#FF6B6B',
  '#4BC0C0', '#9966FF', '#FF9F40', '#36A2EB', '#F7786B'
];

const SLICE_OPTIONS = [
  { value: 5, label: 'Top 5' },
  { value: 10, label: 'Top 10' },
  { value: 15, label: 'Top 15' },
  { value: Infinity, label: 'All' },
];

// Time filtering utility function (copied from AnnotationResultsChart.tsx)
const getTimestamp = (result: FormattedAnnotation, assetsMap: Map<number, AssetRead>, timeAxisConfig: TimeAxisConfig | null): Date | null => {
  if (!timeAxisConfig) return null;

  switch (timeAxisConfig.type) {
    case 'default':
      return new Date(result.timestamp);
    case 'schema':
      if (result.schema_id === timeAxisConfig.schemaId && timeAxisConfig.fieldKey) {
        const fieldValue = getAnnotationFieldValue(result.value, timeAxisConfig.fieldKey);
        if (fieldValue && (typeof fieldValue === 'string' || fieldValue instanceof Date)) {
          try {
            return new Date(fieldValue);
          } catch {
            return null;
          }
        }
      }
      return null;
    case 'event':
      const asset = assetsMap.get(result.asset_id);
      if (asset?.event_timestamp) {
        try {
          return new Date(asset.event_timestamp);
        } catch {
          return null;
        }
      }
      return null;
    default:
      return new Date(result.timestamp);
  }
};

interface AnnotationResultsPieChartProps {
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  assets?: AssetRead[];
  sources?: SourceRead[];
  selectedSourceIds?: number[];
  aggregateSourcesDefault?: boolean;
  onDataSourceSelectionChange?: (ids: number[]) => void;
  analysisData?: any[] | null;
  onSettingsChange?: (settings: any) => void;
  initialSettings?: any;
  showControls?: boolean; // Whether to show schema/field selection controls
  // NEW: Time frame filtering
  timeAxisConfig?: TimeAxisConfig | null;
  // NEW: Variable splitting
  variableSplittingConfig?: VariableSplittingConfig | null;
  onVariableSplittingChange?: (config: VariableSplittingConfig | null) => void;
}

interface PieDataPoint {
  name: string;
  value: number;
}

interface SelectedSliceDetails {
  name: string;
  value: number;
  percentage: number;
  documents: FormattedAnnotation[];
  schema: AnnotationSchemaRead;
  fieldKey: string;
  isOtherSlice: boolean;
  groupedCategories?: PieDataPoint[]; 
  pointForDialog: GroupedDataPoint;
}

// Helper function to get field definition from hierarchical schema
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

const DocumentResults: React.FC<{
  selectedPoint: GroupedDataPoint;
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  assets?: AssetRead[];
  sources?: SourceRead[];
  highlightValue?: string | null;
}> = ({ selectedPoint, results, schemas, assets, sources, highlightValue }) => {
  const relevantAssetIds = Array.from(selectedPoint.sourceDocuments.values()).flat();

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-bold">{selectedPoint.schemeName}: "{selectedPoint.valueString}" ({selectedPoint.totalCount} results)</h3>
      {relevantAssetIds.map((assetId: number) => {
        const asset = assets?.find(a => a.id === assetId);
        if (!asset) return null;

        const assetResults = results.filter(r =>
          r.asset_id === assetId && r.schema_id === schemas.find(s => s.name === selectedPoint.schemeName)?.id
        );
        const relevantSchema = schemas.find(s => s.name === selectedPoint.schemeName);
        if (!relevantSchema) return null;

        return (
          <div key={asset.id} className="border-t pt-4">
            <AssetLink assetId={asset.id} className="font-semibold hover:underline">
              {asset.title || `Asset #${asset.id}`}
            </AssetLink>
            <div className="mt-2 pl-4 border-l-2">
              <AnnotationResultDisplay
                result={assetResults}
                schema={[relevantSchema]}
                compact={false}
                useTabs={false}
                highlightValue={highlightValue}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const AnnotationResultsPieChart: React.FC<AnnotationResultsPieChartProps> = ({
  results,
  schemas,
  assets,
  sources,
  selectedSourceIds = [],
  aggregateSourcesDefault = true,
  analysisData = null,
  onSettingsChange,
  initialSettings,
  showControls = true,
  // NEW props
  timeAxisConfig = null,
  variableSplittingConfig = null,
  onVariableSplittingChange,
}) => {
  // Initialize state from panel settings or defaults
  const [selectedSchemaId, setSelectedSchemaId] = useState<number | null>(
    initialSettings?.selectedSchemaId ?? null
  );
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(
    initialSettings?.selectedFieldKey ?? null
  );
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [selectedSliceData, setSelectedSliceData] = useState<SelectedSliceDetails | null>(null);
  const [selectedMaxSlices, setSelectedMaxSlices] = useState<number>(
    initialSettings?.selectedMaxSlices ?? SLICE_OPTIONS[1].value
  );
  const [hoveredSliceName, setHoveredSliceName] = useState<string | null>(null);
  const [aggregateSources, setAggregateSources] = useState<boolean>(
    initialSettings?.aggregateSources ?? aggregateSourcesDefault
  );

  // NEW: Apply time frame filtering
  const assetsMap = useMemo(() => new Map((assets || []).map(asset => [asset.id, asset])), [assets]);
  
  const timeFilteredResults = useMemo(() => {
    if (!timeAxisConfig?.timeFrame?.enabled || !timeAxisConfig.timeFrame.startDate || !timeAxisConfig.timeFrame.endDate) {
      return results;
    }

    const { startDate, endDate } = timeAxisConfig.timeFrame;
    
    return results.filter(result => {
      const timestamp = getTimestamp(result, assetsMap, timeAxisConfig);
      if (!timestamp) return false;
      
      return timestamp >= startDate && timestamp <= endDate;
    });
  }, [results, timeAxisConfig, assetsMap]);

  // NEW: Apply variable splitting
  const processedResults = useMemo(() => {
    if (variableSplittingConfig?.enabled) {
      return applySplittingToResults(timeFilteredResults, variableSplittingConfig);
    }
    return { all: timeFilteredResults };
  }, [timeFilteredResults, variableSplittingConfig]);

  // Update state when initialSettings change (important for shared/restored dashboards)
  useEffect(() => {
    if (initialSettings) {
      if (initialSettings.selectedSchemaId !== undefined) {
        setSelectedSchemaId(initialSettings.selectedSchemaId);
      }
      if (initialSettings.selectedFieldKey !== undefined) {
        setSelectedFieldKey(initialSettings.selectedFieldKey);
      }
      if (initialSettings.selectedMaxSlices !== undefined && initialSettings.selectedMaxSlices !== null) {
        setSelectedMaxSlices(initialSettings.selectedMaxSlices);
      }
      if (initialSettings.aggregateSources !== undefined) {
        setAggregateSources(initialSettings.aggregateSources);
      }
    }
  }, [initialSettings]);

  const schemaOptions = useMemo(() => {
    return schemas.map(schema => ({
      value: schema.id.toString(),
      label: schema.name,
    }));
  }, [schemas]);

  const fieldOptions = useMemo(() => {
    if (!selectedSchemaId) return [];
    const targetKeys = getTargetKeysForScheme(selectedSchemaId, schemas);
    return targetKeys.map(tk => ({
      value: tk.key,
      label: `${tk.name} (${tk.type})`,
    }));
  }, [selectedSchemaId, schemas]);

  const sourceNameMap = useMemo(() => {
    if (!sources) return new Map<number, string>();
    return new Map(sources.map(ds => [ds.id, ds.name || `Source ${ds.id}`]));
  }, [sources]);

  useEffect(() => {
    if (selectedSchemaId && fieldOptions.length > 0 && !selectedFieldKey) {
      setSelectedFieldKey(fieldOptions[0].value);
    } else if (selectedSchemaId && fieldOptions.length > 0 && !fieldOptions.some(f => f.value === selectedFieldKey)) {
        // if the current field is not valid for the new schema, reset it.
        setSelectedFieldKey(fieldOptions[0].value);
    }
  }, [selectedSchemaId, fieldOptions, selectedFieldKey]);

  useEffect(() => {
    if (!aggregateSources && (!selectedSourceIds || selectedSourceIds.length === 0 || !sources || sources.length === 0)) {
      setAggregateSources(true);
    }
    if (selectedSourceIds && selectedSourceIds.length === 1 && !aggregateSources) {
        setAggregateSources(true);
    }
  }, [selectedSourceIds, aggregateSources, sources]);

  // Persist settings when they change (with debouncing to prevent loops)
  useEffect(() => {
    if (onSettingsChange) {
      const timeoutId = setTimeout(() => {
        onSettingsChange({
          selectedSchemaId,
          selectedFieldKey,
          selectedMaxSlices,
          aggregateSources,
          selectedSourceIds,
        });
      }, 100); // Small delay to prevent rapid-fire updates

      return () => clearTimeout(timeoutId);
    }
  }, [selectedSchemaId, selectedFieldKey, selectedMaxSlices, aggregateSources, selectedSourceIds, onSettingsChange]);

  // NEW: Enhanced pie data processing to handle variable splitting
  const { pieDataMap, groupedForOtherSliceMap } = useMemo((): {
    pieDataMap: Record<string | number, PieDataPoint[]>;
    groupedForOtherSliceMap: Record<string | number, PieDataPoint[] | undefined>;
  } => {
    if (analysisData) {
        // If analysisData is provided, use it directly
        const allCategories = analysisData.sort((a, b) => b.value - a.value);
        const maxSlices = selectedMaxSlices ?? SLICE_OPTIONS[1].value;
        if (maxSlices === Infinity || allCategories.length <= maxSlices) {
            const pieDataMap = { 'aggregated': allCategories };
            const groupedForOtherSliceMap = { 'aggregated': undefined };
            return { pieDataMap, groupedForOtherSliceMap };
        } else if (allCategories.length > maxSlices && maxSlices > 0) {
            const topN = allCategories.slice(0, maxSlices - 1);
            const others = allCategories.slice(maxSlices - 1);
            const otherSum = others.reduce((acc, curr) => acc + curr.value, 0);
            const pieDataMap = { 'aggregated': [...topN, { name: 'Other', value: otherSum }] };
            const groupedForOtherSliceMap = { 'aggregated': others };
            return { pieDataMap, groupedForOtherSliceMap };
        } else {
            const pieDataMap = { 'aggregated': allCategories };
            const groupedForOtherSliceMap = { 'aggregated': undefined };
            return { pieDataMap, groupedForOtherSliceMap };
        }
    }

    if (!selectedSchemaId || !selectedFieldKey) return { pieDataMap: {}, groupedForOtherSliceMap: {} };
    const schema = schemas.find(s => s.id === selectedSchemaId);
    if (!schema) return { pieDataMap: {}, groupedForOtherSliceMap: {} };
    
    const fieldDefinition = getFieldDefinitionFromSchema(schema, selectedFieldKey);
    if (!fieldDefinition) return { pieDataMap: {}, groupedForOtherSliceMap: {} };

    const newPieDataMap: Record<string | number, PieDataPoint[]> = {};
    const newGroupedForOtherSliceMap: Record<string | number, PieDataPoint[] | undefined> = {};

    // Helper function to process results for a target group
    const processResultsForTarget = (
      targetResults: FormattedAnnotation[], 
      targetKey: string | number, 
      splitLabel?: string
    ) => {
      const counts: Record<string, number> = {};
      targetResults.forEach(result => {
        if (result.schema_id === selectedSchemaId) {
          const valueForField: any = getAnnotationFieldValue(result.value, selectedFieldKey!);
          
          let categoryName: string;
          if (valueForField === null || valueForField === undefined) {
            categoryName = 'N/A';
          } else if (fieldDefinition.type === 'boolean') {
            categoryName = valueForField ? 'True' : 'False';
          } else if (fieldDefinition.type === 'array' && Array.isArray(valueForField)) {
            if (valueForField.length === 0) {
              counts['N/A (from empty list)'] = (counts['N/A (from empty list)'] || 0) + 1;
            } else {
              valueForField.forEach(label => {
                // NEW: Apply consistent ambiguity resolution
                const resolvedLabel = applyAmbiguityResolution(String(label ?? 'N/A'), variableSplittingConfig?.valueAliases);
                counts[resolvedLabel] = (counts[resolvedLabel] || 0) + 1;
              });
            }
            return;
          } else if (typeof valueForField === 'object') {
            try { categoryName = JSON.stringify(valueForField); }
            catch (e) { categoryName = '[Complex Object]'; }
          } else { 
            categoryName = String(valueForField); 
          }
          
          // NEW: Apply consistent ambiguity resolution
          const resolvedName = applyAmbiguityResolution(categoryName, variableSplittingConfig?.valueAliases);
          counts[resolvedName] = (counts[resolvedName] || 0) + 1;
        }
      });

      const allCategories = Object.entries(counts)
        .map(([name, value]) => ({ 
          name: splitLabel ? `${name}` : name, // Don't double-prefix with split label
          value 
        }))
        .sort((a, b) => b.value - a.value);

      const maxSlices = selectedMaxSlices ?? SLICE_OPTIONS[1].value;
      if (maxSlices === Infinity || allCategories.length <= maxSlices) {
        newPieDataMap[targetKey] = allCategories;
        newGroupedForOtherSliceMap[targetKey] = undefined;
      } else if (allCategories.length > maxSlices && maxSlices > 0) {
        const topN = allCategories.slice(0, maxSlices - 1);
        const others = allCategories.slice(maxSlices - 1);
        const otherSum = others.reduce((acc, curr) => acc + curr.value, 0);
        newPieDataMap[targetKey] = [...topN, { name: 'Other', value: otherSum }];
        newGroupedForOtherSliceMap[targetKey] = others;
      } else {
        newPieDataMap[targetKey] = allCategories;
        newGroupedForOtherSliceMap[targetKey] = undefined;
      }
    };

    // NEW: Handle variable splitting - create separate pie charts for each split group
    if (variableSplittingConfig?.enabled && Object.keys(processedResults).length > 1) {
      // Process each split group separately
      Object.entries(processedResults).forEach(([splitValue, splitResults]) => {
        if (splitResults.length > 0) {
          // Check if this split is visible
          const isVisible = variableSplittingConfig.visibleSplits?.size === 0 || 
                            variableSplittingConfig.visibleSplits?.has(splitValue);
          
          if (!isVisible) {
            return; // Skip invisible splits
          }
          
          if (aggregateSources || !selectedSourceIds || selectedSourceIds.length < 2 || !sources || sources.length === 0) {
            // Create a single pie chart for this split group
            processResultsForTarget(splitResults, `split_${splitValue}`, splitValue);
          } else {
            // Create separate pie charts for each source within this split
            selectedSourceIds.forEach(dsId => {
              const sourceAndSchemeSpecificResults = splitResults.filter(result => {
                if (result.schema_id !== selectedSchemaId) return false;
                const asset = assetsMap.get(result.asset_id);
                return asset && asset.source_id === dsId;
              });

              if (sourceAndSchemeSpecificResults.length > 0) {
                const sourceName = sourceNameMap.get(dsId) || `Source ${dsId}`;
                processResultsForTarget(
                  sourceAndSchemeSpecificResults, 
                  `split_${splitValue}_source_${dsId}`, 
                  `${splitValue} (${sourceName})`
                );
              }
            });
          }
        }
      });
    } else {
      // Standard processing without splitting
      const resultsToUse = processedResults.all || [];
      
      if (aggregateSources || !selectedSourceIds || selectedSourceIds.length < 2 || !sources || sources.length === 0) {
        processResultsForTarget(resultsToUse, 'aggregated');
      } else {
        selectedSourceIds.forEach(dsId => {
          const sourceAndSchemeSpecificResults = resultsToUse.filter(result => {
            if (result.schema_id !== selectedSchemaId) return false;
            const asset = assetsMap.get(result.asset_id);
            return asset && asset.source_id === dsId;
          });

          if (sourceAndSchemeSpecificResults.length > 0) {
            processResultsForTarget(sourceAndSchemeSpecificResults, dsId);
          } else {
            newPieDataMap[dsId] = [];
            newGroupedForOtherSliceMap[dsId] = undefined;
          }
        });
      }
    }
    
    return { pieDataMap: newPieDataMap, groupedForOtherSliceMap: newGroupedForOtherSliceMap };
  }, [processedResults, selectedSchemaId, selectedFieldKey, schemas, selectedMaxSlices, aggregateSources, selectedSourceIds, assetsMap, sources, analysisData, variableSplittingConfig, sourceNameMap]);

  // NEW: Helper function to get display name for pie chart
  const getPieChartDisplayName = (targetKey: string | number): string => {
    if (targetKey === 'aggregated') {
      return 'All Data';
    }
    
    if (typeof targetKey === 'string' && targetKey.startsWith('split_')) {
      const splitValue = targetKey.replace('split_', '');
      
      if (splitValue.includes('_source_')) {
        const parts = splitValue.split('_source_');
        const splitVal = parts[0];
        const sourceId = parseInt(parts[1]);
        const sourceName = sourceNameMap.get(sourceId) || `Source ${sourceId}`;
        return `${splitVal} (${sourceName})`;
      }
      
      return splitValue;
    }
    
    return sourceNameMap.get(targetKey as number) || `Source ${targetKey}`;
  };

  const handlePieSliceClick = useCallback((data: any, index: number, targetKey: string | number) => {
    const currentPieData = pieDataMap[targetKey];
    const currentGroupedForOther = groupedForOtherSliceMap[targetKey];

    if (!selectedSchemaId || !selectedFieldKey || !currentPieData || !currentPieData[index]) return;

    const clickedSliceName = currentPieData[index].name;
    const schema = schemas.find(s => s.id === selectedSchemaId);
    if (!schema) return;
    const fieldDefinition = getFieldDefinitionFromSchema(schema, selectedFieldKey);
    if (!fieldDefinition) return;

    let documentsInSlice: FormattedAnnotation[] = [];
    const isOtherSlice = clickedSliceName === 'Other';
    
    // NEW: Get the correct results source based on whether we're dealing with splits
    const resultsSource = (() => {
      if (typeof targetKey === 'string' && targetKey.startsWith('split_')) {
        const splitValue = targetKey.replace('split_', '');
        
        if (splitValue.includes('_source_')) {
          const parts = splitValue.split('_source_');
          const splitVal = parts[0];
          return processedResults[splitVal] || [];
        }
        
        return processedResults[splitValue] || [];
      }
      
      return processedResults.all || [];
    })();
    
    if (isOtherSlice && currentGroupedForOther) {
      const otherCategoryNames = new Set(currentGroupedForOther.map(item => item.name));
      documentsInSlice = resultsSource.filter(result => {
        const asset = assetsMap.get(result.asset_id);
        
        // For split results, we don't need to check source matching
        if (typeof targetKey === 'string' && targetKey.startsWith('split_')) {
          if (result.schema_id !== selectedSchemaId) return false;
        } else {
          const matchesSource = targetKey === 'aggregated' || (asset && asset.source_id === targetKey);
          if (!matchesSource || result.schema_id !== selectedSchemaId) return false;
        }
        
        const valueForField: any = getAnnotationFieldValue(result.value, selectedFieldKey!);
        
        let categoryName: string;
        if (valueForField === null || valueForField === undefined) {
          categoryName = 'N/A';
        } else if (fieldDefinition.type === 'boolean') {
          categoryName = valueForField ? 'True' : 'False';
        } else if (fieldDefinition.type === 'array' && Array.isArray(valueForField)) {
          if (valueForField.length === 0) return otherCategoryNames.has('N/A (from empty list)');
          return valueForField.some(label => {
            const resolvedLabel = applyAmbiguityResolution(String(label ?? 'N/A'), variableSplittingConfig?.valueAliases);
            return otherCategoryNames.has(resolvedLabel);
          });
        } else if (typeof valueForField === 'object') {
          try { categoryName = JSON.stringify(valueForField); }
          catch (e) { categoryName = '[Complex Object]'; }
        } else { 
          categoryName = String(valueForField); 
        }
        
        const resolvedName = applyAmbiguityResolution(categoryName, variableSplittingConfig?.valueAliases);
        return otherCategoryNames.has(resolvedName);
      });
    } else {
      documentsInSlice = resultsSource.filter(result => {
        const asset = assetsMap.get(result.asset_id);
        
        // For split results, we don't need to check source matching
        if (typeof targetKey === 'string' && targetKey.startsWith('split_')) {
          if (result.schema_id !== selectedSchemaId) return false;
        } else {
          const matchesSource = targetKey === 'aggregated' || (asset && asset.source_id === targetKey);
          if (!matchesSource || result.schema_id !== selectedSchemaId) return false;
        }
        
        const valueForField: any = getAnnotationFieldValue(result.value, selectedFieldKey!);
        
        let categoryName: string;
        if (valueForField === null || valueForField === undefined) {
          categoryName = 'N/A';
        } else if (fieldDefinition.type === 'boolean') {
          categoryName = valueForField ? 'True' : 'False';
        } else if (fieldDefinition.type === 'array' && Array.isArray(valueForField)) {
          if (clickedSliceName === 'N/A (from empty list)') return valueForField.length === 0;
          return valueForField.some(label => {
            const resolvedLabel = applyAmbiguityResolution(String(label ?? 'N/A'), variableSplittingConfig?.valueAliases);
            return resolvedLabel === clickedSliceName;
          });
        } else if (typeof valueForField === 'object') {
          try { categoryName = JSON.stringify(valueForField); }
          catch (e) { categoryName = '[Complex Object]'; }
        } else { 
          categoryName = String(valueForField); 
        }
        
        const resolvedName = applyAmbiguityResolution(categoryName, variableSplittingConfig?.valueAliases);
        return resolvedName === clickedSliceName;
      });
    }

    const totalValues = currentPieData.reduce((sum, item) => sum + item.value, 0);
    const percentage = totalValues > 0 ? (currentPieData[index].value / totalValues) * 100 : 0;

    const sourceDocuments = new Map<number, number[]>();
    documentsInSlice.forEach(docResult => {
        const asset = assetsMap.get(docResult.asset_id);
        if (asset && typeof asset.source_id === 'number') {
            if (!sourceDocuments.has(asset.source_id)) {
                sourceDocuments.set(asset.source_id, []);
            }
            if (!sourceDocuments.get(asset.source_id)!.includes(docResult.asset_id)) {
                 sourceDocuments.get(asset.source_id)!.push(docResult.asset_id);
            }
        }
    });

    const pointForDialog: GroupedDataPoint = {
        valueString: clickedSliceName,
        totalCount: documentsInSlice.length,
        sourceDocuments: sourceDocuments,
        schemeName: schema.name,
        valueKey: clickedSliceName,
    };

    setSelectedSliceData({
      name: clickedSliceName,
      value: currentPieData[index].value,
      percentage: percentage,
      documents: documentsInSlice,
      schema: schema,
      fieldKey: selectedFieldKey,
      isOtherSlice: isOtherSlice,
      groupedCategories: isOtherSlice ? currentGroupedForOther : undefined,
      pointForDialog: pointForDialog,
    });
    setIsDetailDialogOpen(true);
  }, [results, selectedSchemaId, selectedFieldKey, schemas, pieDataMap, groupedForOtherSliceMap, assetsMap, variableSplittingConfig, processedResults]);

  const CustomTooltipContent = ({ active, payload }: TooltipProps<number, string>) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as PieDataPoint;
      const percentage = (payload[0] as any).percent;
      return (
        <div className="bg-card/95 dark:bg-popover p-3 border border-border rounded-lg shadow-xl text-sm text-popover-foreground">
          <p className="font-semibold text-base mb-1">{`${data.name}`}</p>
          <p><span className="font-medium">Count:</span> {data.value}</p>
          {percentage !== undefined && (
            <p><span className="font-medium">Percentage:</span> {(percentage * 100).toFixed(1)}%</p>
          )}
        </div>
      );
    }
    return null;
  };
  
  // OPTIMIZED: Memoize the legend component to prevent excessive re-renders
  const renderCustomLegend = useCallback((props: any) => {
    const { payload } = props;
    const maxLegendLabelLength = 25;

    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-1.5 mt-3 text-xs text-muted-foreground max-w-full overflow-y-auto max-h-24 pb-2 px-2">
        {payload.map((entry: any, index: number) => {
          const { value, color } = entry;
          const truncatedValue = value.length > maxLegendLabelLength 
            ? `${value.substring(0, maxLegendLabelLength)}…` 
            : value;
          const isHovered = hoveredSliceName === value;
          const opacity = hoveredSliceName && !isHovered ? 0.5 : 1;

          return (
            <TooltipProvider key={`item-${index}`} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="flex items-center cursor-default overflow-hidden transition-opacity duration-200" 
                    style={{ opacity: opacity }}
                    onMouseEnter={() => setHoveredSliceName(value)}
                    onMouseLeave={() => setHoveredSliceName(null)}
                  >
                    <span style={{ backgroundColor: color, width: '10px', height: '10px', borderRadius: '50%', marginRight: '5px', flexShrink: 0 }} /> 
                    <span className="truncate">{truncatedValue}</span>
                  </div>
                </TooltipTrigger>
                {value.length > maxLegendLabelLength && (
                  <TooltipContent side="top" className="max-w-xs">
                    <p>{value}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    );
  }, [hoveredSliceName]); // Only re-render when hover state changes

  if (analysisData) {
    // Render only the chart when analysisData is provided, no controls.
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={pieDataMap['aggregated'] || []}
            cx="50%"
            cy="50%"
            labelLine={false}
            outerRadius="80%"
            fill="#8884d8"
            dataKey="value"
            nameKey="name"
            isAnimationActive={false}
          >
            {(pieDataMap['aggregated'] || []).map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={PIE_COLORS[index % PIE_COLORS.length]} 
              />
            ))}
          </Pie>
          <RechartsTooltip content={<CustomTooltipContent />} />
          <Legend content={renderCustomLegend} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (schemas.length === 0) {
    return <div className="p-4 text-center text-muted-foreground">No annotation schemas available to build a chart.</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {showControls && (
        <div className="flex-shrink-0 grid grid-cols-1 p-2 md:grid-cols-3 gap-4 mb-0 items-end rounded-t-md bg-muted/20 backdrop-blur supports-[backdrop-filter]:bg-background/40 border border-border/50">
          <div>
            <Label htmlFor="pie-schema-select" className="text-sm font-medium">Select Schema</Label>
            <Select value={selectedSchemaId?.toString() ?? ""} onValueChange={(v) => setSelectedSchemaId(v ? parseInt(v) : null)}>
              <SelectTrigger id="pie-schema-select" className="mt-1"><SelectValue placeholder="Choose a schema..." /></SelectTrigger>
              <SelectContent>
                {schemaOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pie-field-select" className="text-sm font-medium">Select Field</Label>
            <Select value={selectedFieldKey ?? ""} onValueChange={(v) => setSelectedFieldKey(v || null)} disabled={!selectedSchemaId || fieldOptions.length === 0}>
              <SelectTrigger id="pie-field-select" className="mt-1"><SelectValue placeholder={!selectedSchemaId ? "Select schema first" : "Choose a field..."} /></SelectTrigger>
              <SelectContent>
                {fieldOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                {selectedSchemaId && fieldOptions.length === 0 && <div className="p-2 text-xs text-center text-muted-foreground">No suitable fields for pie chart in this schema.</div>}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pie-max-slices-select" className="text-sm font-medium">Show Slices</Label>
            <Select 
              value={selectedMaxSlices?.toString() ?? SLICE_OPTIONS[1].value.toString()} 
              onValueChange={(v) => setSelectedMaxSlices(v === 'Infinity' ? Infinity : parseInt(v))}
              disabled={!selectedSchemaId || !selectedFieldKey}
            >
              <SelectTrigger id="pie-max-slices-select" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SLICE_OPTIONS.map(option => <SelectItem key={option.label} value={option.value.toString()}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center space-x-2 justify-self-start md:justify-self-end pb-1">
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Switch
                      id="pie-aggregate-sources"
                      checked={aggregateSources}
                      onCheckedChange={setAggregateSources}
                      disabled={!selectedSourceIds || selectedSourceIds.length < 2 || !sources || sources.length === 0}
                    />
                  </span>
                </TooltipTrigger>
                {(!selectedSourceIds || selectedSourceIds.length < 2 || !sources || sources.length === 0) && (
                  <TooltipContent side="top">
                    <p className="text-xs max-w-xs">Select at least two data sources to enable per-source view.</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            <Label htmlFor="pie-aggregate-sources" className="text-sm font-medium cursor-pointer">
              Aggregate Sources
            </Label>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 rounded-b-md bg-muted/20 backdrop-blur supports-[backdrop-filter]:bg-background/40 border border-border/50">
        {selectedSchemaId && selectedFieldKey && variableSplittingConfig?.enabled && Object.keys(pieDataMap).some(key => key.startsWith('split_') && pieDataMap[key]?.length > 0) ? (
          // NEW: Render multiple pie charts for variable splitting
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 h-full p-4 overflow-auto">
            {Object.entries(pieDataMap)
              .filter(([key, data]) => key.startsWith('split_') && data?.length > 0)
              .map(([targetKey, data]) => (
                <Card key={`pie-split-chart-${targetKey}`} className="shadow-md flex flex-col h-full min-h-[300px]">
                  <CardHeader className="pb-2 pt-4 px-4 flex-shrink-0">
                    <CardTitle className="text-base font-medium truncate" title={getPieChartDisplayName(targetKey)}>
                      {getPieChartDisplayName(targetKey)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-2 flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                          nameKey="name"
                          onClick={(data, index) => handlePieSliceClick(data, index, targetKey)}
                          onMouseEnter={(data: any) => setHoveredSliceName(data.name)}
                          onMouseLeave={() => setHoveredSliceName(null)}
                          isAnimationActive={false}
                        >
                          {data.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}-${targetKey}`} 
                              fill={PIE_COLORS[index % PIE_COLORS.length]}
                              style={{ 
                                transition: 'opacity 0.2s ease-in-out', 
                                opacity: hoveredSliceName && hoveredSliceName !== entry.name ? 0.5 : 1
                              }} 
                            />
                          ))}
                        </Pie>
                        <RechartsTooltip content={<CustomTooltipContent />} />
                        <Legend content={renderCustomLegend} wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              ))}
          </div>
        ) : selectedSchemaId && selectedFieldKey && (aggregateSources || (selectedSourceIds && selectedSourceIds.length < 2)) && pieDataMap['aggregated'] && pieDataMap['aggregated'].length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieDataMap['aggregated']}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={120}
                fill="#8884d8"
                dataKey="value"
                nameKey="name"
                onClick={(data, index) => handlePieSliceClick(data, index, 'aggregated')}
                onMouseEnter={(data: any) => setHoveredSliceName(data.name)}
                onMouseLeave={() => setHoveredSliceName(null)}
                isAnimationActive={false}
              >
                {pieDataMap['aggregated'].map((entry, index) => (
                  <Cell 
                    key={`cell-${index}-aggregated`} 
                    fill={PIE_COLORS[index % PIE_COLORS.length]} 
                    style={{ 
                      transition: 'opacity 0.2s ease-in-out', 
                      opacity: hoveredSliceName && hoveredSliceName !== entry.name ? 0.5 : 1 
                    }} 
                  />
                ))}
              </Pie>
              <RechartsTooltip content={<CustomTooltipContent />} />
              <Legend content={renderCustomLegend} />
            </PieChart>
          </ResponsiveContainer>
        ) : !aggregateSources && selectedSourceIds && selectedSourceIds.length >= 2 && Object.keys(pieDataMap).some(key => key !== 'aggregated' && pieDataMap[key]?.length > 0) ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
            {selectedSourceIds.filter(dsId => pieDataMap[dsId] && pieDataMap[dsId].length > 0).map((dsId, chartIndex) => (
              <Card key={`pie-subchart-${dsId}` } className="shadow-md flex flex-col h-full">
                <CardHeader className="pb-2 pt-4 px-4 flex-shrink-0">
                  <CardTitle className="text-base font-medium truncate" title={sourceNameMap.get(dsId) || `Source ${dsId}`}>{sourceNameMap.get(dsId) || `Source ${dsId}`}</CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-2 flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieDataMap[dsId]}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        nameKey="name"
                        onClick={(data, index) => handlePieSliceClick(data, index, dsId)}
                        onMouseEnter={(data: any) => setHoveredSliceName(data.name)}
                        onMouseLeave={() => setHoveredSliceName(null)}
                        isAnimationActive={false}
                      >
                        {pieDataMap[dsId].map((entry, index) => (
                          <Cell 
                            key={`cell-${index}-${dsId}`} 
                            fill={PIE_COLORS[index % PIE_COLORS.length]}
                            style={{ 
                              transition: 'opacity 0.2s ease-in-out', 
                              opacity: hoveredSliceName && hoveredSliceName !== entry.name ? 0.5 : 1
                            }} 
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<CustomTooltipContent />} />
                      <Legend content={renderCustomLegend} wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center border border-dashed rounded-lg p-4">
            <Info className="h-10 w-10 text-muted-foreground mb-3" />
            {!selectedSchemaId || !selectedFieldKey ? <p className="text-muted-foreground">Please select a schema and a field to display the chart.</p>
              : (results.length > 0 && Object.values(pieDataMap).every(data => data.length === 0)) ? <p className="text-muted-foreground">No data available for the selected field in the current results/sources.</p>
              : <p className="text-muted-foreground">No results loaded to display.</p>}
          </div>
        )}
      </div>

      {selectedSliceData && (
        <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Details for: {selectedSliceData.name}</DialogTitle>
              <DialogDescription>
                Schema: {selectedSliceData.schema.name} | Field: {selectedSliceData.fieldKey} <br />
                Count: {selectedSliceData.value} ({selectedSliceData.percentage.toFixed(1)}%)
                {selectedSliceData.isOtherSlice && selectedSliceData.groupedCategories && (
                  <span className="text-xs block mt-1"> (Aggregates {selectedSliceData.groupedCategories.length} smaller categories)</span>
                )}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] p-1">
              <div className="space-y-3 pr-2">
                {selectedSliceData.isOtherSlice && selectedSliceData.groupedCategories && selectedSliceData.groupedCategories.length > 0 && (
                  <div className="mb-4 p-3 border rounded-md bg-muted/20">
                    <h4 className="font-medium text-sm mb-2">Categories in "Other":</h4>
                    <ScrollArea className="max-h-40">
                      <ul className="list-disc pl-5 space-y-1 text-xs">
                        {selectedSliceData.groupedCategories.map(cat => (
                          <li key={cat.name}>{cat.name}: {cat.value}</li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}
                <DocumentResults
                  selectedPoint={selectedSliceData.pointForDialog}
                  results={results}
                  schemas={schemas}
                  assets={assets}
                  sources={sources}
                  highlightValue={selectedSliceData.isOtherSlice ? null : selectedSliceData.name}
                />
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDetailDialogOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default AnnotationResultsPieChart;