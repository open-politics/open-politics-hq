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
import { ClassificationSchemeRead, DataRecordRead, DataSourceRead } from '@/client';
import { FormattedClassificationResult, FieldType } from '@/lib/classification/types';
import { getTargetKeysForScheme, formatDisplayValue } from '@/lib/classification/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import DocumentLink from '@/components/collection/workspaces/documents/DocumentLink';
import ClassificationResultDisplay from './ClassificationResultDisplay';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { DocumentResults } from '@/components/collection/workspaces/classifications/ClassificationResultsChart';
import type { GroupedDataPoint } from '@/components/collection/workspaces/classifications/ClassificationResultsChart';

// Define a color palette for pie chart slices
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

interface ClassificationResultsPieChartProps {
  results: FormattedClassificationResult[];
  schemes: ClassificationSchemeRead[];
  dataRecords?: DataRecordRead[];
  dataSources?: DataSourceRead[];
  selectedDataSourceIds?: number[];
  aggregateSourcesDefault?: boolean;
  onDataSourceSelectionChange?: (ids: number[]) => void;
}

interface PieDataPoint {
  name: string;
  value: number;
}

interface SelectedSliceDetails {
  name: string;
  value: number;
  percentage: number;
  documents: FormattedClassificationResult[];
  scheme: ClassificationSchemeRead;
  fieldKey: string;
  isOtherSlice: boolean;
  groupedCategories?: PieDataPoint[]; 
  pointForDialog: GroupedDataPoint;
}

const ClassificationResultsPieChart: React.FC<ClassificationResultsPieChartProps> = ({
  results,
  schemes,
  dataRecords,
  dataSources,
  selectedDataSourceIds = [],
  aggregateSourcesDefault = true,
}) => {
  console.log('[PieChart Props] selectedDataSourceIds:', JSON.parse(JSON.stringify(selectedDataSourceIds)));
  console.log('[PieChart Props] dataSources available:', dataSources ? dataSources.length : 'undefined');
  console.log('[PieChart Props] aggregateSourcesDefault:', aggregateSourcesDefault);

  const [selectedSchemeId, setSelectedSchemeId] = useState<number | null>(null);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [selectedSliceData, setSelectedSliceData] = useState<SelectedSliceDetails | null>(null);
  const [selectedMaxSlices, setSelectedMaxSlices] = useState<number>(SLICE_OPTIONS[1].value);
  const [hoveredSliceName, setHoveredSliceName] = useState<string | null>(null);
  const [aggregateSources, setAggregateSources] = useState<boolean>(aggregateSourcesDefault);

  console.log('[PieChart State] aggregateSources (after useState init):', aggregateSources);

  const dataRecordsMap = useMemo(() => {
    if (!dataRecords) return new Map<number, DataRecordRead>();
    return new Map(dataRecords.map(dr => [dr.id, dr]));
  }, [dataRecords]);

  const schemeOptions = useMemo(() => {
    return schemes.map(scheme => ({
      value: scheme.id.toString(),
      label: scheme.name,
    }));
  }, [schemes]);

  const fieldOptions = useMemo(() => {
    if (!selectedSchemeId) return [];
    const scheme = schemes.find(s => s.id === selectedSchemeId);
    if (!scheme) return [];
    return scheme.fields
      .filter(field =>
        field.type === 'str' ||
        field.type === 'int' ||
        field.type === 'List[str]'
      )
      .map(field => ({
        value: field.name,
        label: `${field.name} (${field.type})`,
      }));
  }, [selectedSchemeId, schemes]);

  const dataSourceNameMap = useMemo(() => {
    if (!dataSources) return new Map<number, string>();
    return new Map(dataSources.map(ds => [ds.id, ds.name || `Source ${ds.id}`]));
  }, [dataSources]);

  useEffect(() => {
    if (selectedSchemeId && fieldOptions.length > 0 && !selectedFieldKey) {
      setSelectedFieldKey(fieldOptions[0].value);
    }
  }, [selectedSchemeId, fieldOptions, selectedFieldKey]);

  useEffect(() => {
    console.log('[PieChart Effect] Running effect to potentially force aggregation. Current aggregateSources:', aggregateSources, 'selected IDs:', selectedDataSourceIds?.length, 'dataSources count:', dataSources?.length);
    if (!aggregateSources && (!selectedDataSourceIds || selectedDataSourceIds.length === 0 || !dataSources || dataSources.length === 0)) {
      console.log('[PieChart Effect] Forcing aggregation due to no/empty selected IDs or missing dataSources.');
      setAggregateSources(true);
    }
    if (selectedDataSourceIds && selectedDataSourceIds.length === 1 && !aggregateSources) {
        console.log('[PieChart Effect] Forcing aggregation due to only one source selected.');
        setAggregateSources(true);
    }
  }, [selectedDataSourceIds, aggregateSources, dataSources]);

  const { pieDataMap, groupedForOtherSliceMap } = useMemo((): {
    pieDataMap: Record<string | number, PieDataPoint[]>;
    groupedForOtherSliceMap: Record<string | number, PieDataPoint[] | undefined>;
  } => {
    if (!selectedSchemeId || !selectedFieldKey || results.length === 0) return { pieDataMap: {}, groupedForOtherSliceMap: {} };
    const scheme = schemes.find(s => s.id === selectedSchemeId);
    if (!scheme) return { pieDataMap: {}, groupedForOtherSliceMap: {} };
    const fieldDefinition = scheme.fields.find(f => f.name === selectedFieldKey);
    if (!fieldDefinition) return { pieDataMap: {}, groupedForOtherSliceMap: {} };

    const newPieDataMap: Record<string | number, PieDataPoint[]> = {};
    const newGroupedForOtherSliceMap: Record<string | number, PieDataPoint[] | undefined> = {};

    const processResultsForTarget = (targetResults: FormattedClassificationResult[], targetKey: string | number) => {
      console.log(`[PieChart processResultsForTarget] Key: ${targetKey}, Scheme: ${selectedSchemeId}, Field: ${selectedFieldKey}, Input Results count: ${targetResults.length}`);
      const counts: Record<string, number> = {};
      targetResults.forEach(result => {
        if (result.scheme_id === selectedSchemeId) {
          let valueForField: any;
          if (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)) {
            valueForField = result.value[selectedFieldKey!];
          } else if (scheme.fields.length === 1 && selectedFieldKey === scheme.fields[0].name) {
            valueForField = result.value;
          } else { valueForField = undefined; }

          let categoryName: string;
          if (valueForField === null || valueForField === undefined) {
            categoryName = 'N/A';
          } else if (fieldDefinition.type === 'int' && fieldDefinition.scale_min === 0 && fieldDefinition.scale_max === 1) {
            categoryName = Number(valueForField) > 0.5 ? 'True' : 'False';
          } else if (fieldDefinition.type === 'List[str]' && Array.isArray(valueForField)) {
            if (valueForField.length === 0) {
              counts['N/A (from empty list)'] = (counts['N/A (from empty list)'] || 0) + 1;
            } else {
              valueForField.forEach(label => {
                const labelStr = String(label ?? 'N/A');
                counts[labelStr] = (counts[labelStr] || 0) + 1;
              });
            }
            return;
          } else if (typeof valueForField === 'object') {
            try { categoryName = JSON.stringify(valueForField); }
            catch (e) { categoryName = '[Complex Object]'; }
          } else { categoryName = String(valueForField); }
          counts[categoryName] = (counts[categoryName] || 0) + 1;
        }
      });
      console.log(`[PieChart processResultsForTarget] Key: ${targetKey}, Field: ${selectedFieldKey}, Generated Counts:`, JSON.parse(JSON.stringify(counts)));

      const allCategories = Object.entries(counts)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

      if (selectedMaxSlices === Infinity || allCategories.length <= selectedMaxSlices) {
        newPieDataMap[targetKey] = allCategories;
        newGroupedForOtherSliceMap[targetKey] = undefined;
      } else if (allCategories.length > selectedMaxSlices && selectedMaxSlices > 0) {
        const topN = allCategories.slice(0, selectedMaxSlices - 1);
        const others = allCategories.slice(selectedMaxSlices - 1);
        const otherSum = others.reduce((acc, curr) => acc + curr.value, 0);
        newPieDataMap[targetKey] = [...topN, { name: 'Other', value: otherSum }];
        newGroupedForOtherSliceMap[targetKey] = others;
      } else {
        newPieDataMap[targetKey] = allCategories;
        newGroupedForOtherSliceMap[targetKey] = undefined;
      }
      console.log(`[PieChart processResultsForTarget] Key: ${targetKey}, Field: ${selectedFieldKey}, Final Pie Data for this target:`, JSON.parse(JSON.stringify(newPieDataMap[targetKey] || [])));
    };

    if (aggregateSources || !selectedDataSourceIds || selectedDataSourceIds.length < 2 || !dataSources || dataSources.length === 0) {
      console.log("[PieChart DataMemo] Aggregated mode or insufficient sources for per-source view.");
      const relevantResults = results.filter(result => {
        if (!selectedDataSourceIds || selectedDataSourceIds.length === 0) return true;
        const record = dataRecordsMap.get(result.datarecord_id);
        return record && typeof record.datasource_id === 'number' && selectedDataSourceIds.includes(record.datasource_id);
      });
      processResultsForTarget(relevantResults, 'aggregated');
    } else {
      console.log(`[PieChart DataMemo] Per-source mode. Scheme: ${selectedSchemeId}, Field: ${selectedFieldKey}, Selected DS IDs:`, selectedDataSourceIds);
      selectedDataSourceIds.forEach(dsId => {
        const sourceAndSchemeSpecificResults = results.filter(result => {
          if (result.scheme_id !== selectedSchemeId) return false;
          const record = dataRecordsMap.get(result.datarecord_id);
          return record && record.datasource_id === dsId;
        });
        console.log(`[PieChart DataMemo] For DS ID ${dsId}, scheme ${selectedSchemeId}: Found ${sourceAndSchemeSpecificResults.length} specific results before processing.`);

        if (sourceAndSchemeSpecificResults.length > 0) {
          processResultsForTarget(sourceAndSchemeSpecificResults, dsId);
        } else {
          newPieDataMap[dsId] = [];
          newGroupedForOtherSliceMap[dsId] = undefined;
          console.log(`[PieChart DataMemo] No specific results for DS ID ${dsId} and scheme ${selectedSchemeId}, setting empty pieData.`);
        }
      });
      console.log("[PieChart DataMemo] Final per-source pieDataMap (before returning):", JSON.parse(JSON.stringify(newPieDataMap)));
    }
    return { pieDataMap: newPieDataMap, groupedForOtherSliceMap: newGroupedForOtherSliceMap };
  }, [results, selectedSchemeId, selectedFieldKey, schemes, selectedMaxSlices, aggregateSources, selectedDataSourceIds, dataRecordsMap, dataSources]);

  const handlePieSliceClick = useCallback((data: any, index: number, targetKey: string | number) => {
    const currentPieData = pieDataMap[targetKey];
    const currentGroupedForOther = groupedForOtherSliceMap[targetKey];

    if (!selectedSchemeId || !selectedFieldKey || !currentPieData || !currentPieData[index]) return;

    const clickedSliceName = currentPieData[index].name;
    const scheme = schemes.find(s => s.id === selectedSchemeId);
    const fieldDef = scheme?.fields.find(f => f.name === selectedFieldKey);
    if (!scheme || !fieldDef) return;

    let documentsInSlice: FormattedClassificationResult[] = [];
    const isOtherSlice = clickedSliceName === 'Other';
    
    if (isOtherSlice && currentGroupedForOther) {
      const otherCategoryNames = new Set(currentGroupedForOther.map(item => item.name));
      documentsInSlice = results.filter(result => {
        const record = dataRecordsMap.get(result.datarecord_id);
        const matchesSource = targetKey === 'aggregated' || (record && record.datasource_id === targetKey);
        if (!matchesSource || result.scheme_id !== selectedSchemeId) return false;
        let valueForField: any;
        if (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)) {
          valueForField = result.value[selectedFieldKey!];
        } else if (scheme.fields.length === 1 && selectedFieldKey === scheme.fields[0].name) {
          valueForField = result.value;
        } else { return false; }
        let categoryName: string;
        if (valueForField === null || valueForField === undefined) {
          categoryName = 'N/A';
        } else if (fieldDef.type === 'int' && fieldDef.scale_min === 0 && fieldDef.scale_max === 1) {
          categoryName = Number(valueForField) > 0.5 ? 'True' : 'False';
        } else if (fieldDef.type === 'List[str]' && Array.isArray(valueForField)) {
          if (valueForField.length === 0) return otherCategoryNames.has('N/A (from empty list)');
          return valueForField.some(label => otherCategoryNames.has(String(label ?? 'N/A')));
        } else if (typeof valueForField === 'object') {
          try { categoryName = JSON.stringify(valueForField); }
          catch (e) { categoryName = '[Complex Object]'; }
        } else { categoryName = String(valueForField); }
        return otherCategoryNames.has(categoryName);
      });
    } else if (!isOtherSlice) {
      documentsInSlice = results.filter(result => {
        const record = dataRecordsMap.get(result.datarecord_id);
        const matchesSource = targetKey === 'aggregated' || (record && record.datasource_id === targetKey);
        if (!matchesSource || result.scheme_id !== selectedSchemeId) return false;
        let valueForField: any;
        if (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)) {
          valueForField = result.value[selectedFieldKey!];
        } else if (scheme.fields.length === 1 && selectedFieldKey === scheme.fields[0].name) {
          valueForField = result.value;
        } else { return false; }
        let categoryName: string;
        if (valueForField === null || valueForField === undefined) {
          categoryName = 'N/A';
        } else if (fieldDef.type === 'int' && fieldDef.scale_min === 0 && fieldDef.scale_max === 1) {
          categoryName = Number(valueForField) > 0.5 ? 'True' : 'False';
        } else if (fieldDef.type === 'List[str]' && Array.isArray(valueForField)) {
          if (clickedSliceName === 'N/A (from empty list)') return valueForField.length === 0;
          return valueForField.some(label => String(label ?? 'N/A') === clickedSliceName);
        } else if (typeof valueForField === 'object') {
          try { categoryName = JSON.stringify(valueForField); }
          catch (e) { categoryName = '[Complex Object]'; }
        } else { categoryName = String(valueForField); }
        return categoryName === clickedSliceName;
      });
    }

    const totalValues = currentPieData.reduce((sum, item) => sum + item.value, 0);
    const percentage = totalValues > 0 ? (currentPieData[index].value / totalValues) * 100 : 0;

    const sourceDocuments = new Map<number, number[]>();
    documentsInSlice.forEach(docResult => {
        const record = dataRecordsMap.get(docResult.datarecord_id);
        if (record && typeof record.datasource_id === 'number') {
            if (!sourceDocuments.has(record.datasource_id)) {
                sourceDocuments.set(record.datasource_id, []);
            }
            if (!sourceDocuments.get(record.datasource_id)!.includes(docResult.datarecord_id)) {
                 sourceDocuments.get(record.datasource_id)!.push(docResult.datarecord_id);
            }
        } else if (record) {
            const unknownSourceKey = -1;
            if (!sourceDocuments.has(unknownSourceKey)) {
                sourceDocuments.set(unknownSourceKey, []);
            }
            if (!sourceDocuments.get(unknownSourceKey)!.includes(docResult.datarecord_id)) {
                 sourceDocuments.get(unknownSourceKey)!.push(docResult.datarecord_id);
            }
        }
    });

    const pointForDialog: GroupedDataPoint = {
        valueString: clickedSliceName,
        totalCount: documentsInSlice.length,
        sourceDocuments: sourceDocuments,
        schemeName: scheme.name,
        valueKey: clickedSliceName,
    };

    setSelectedSliceData({
      name: clickedSliceName,
      value: currentPieData[index].value,
      percentage: percentage,
      documents: documentsInSlice,
      scheme: scheme,
      fieldKey: selectedFieldKey,
      isOtherSlice: isOtherSlice,
      groupedCategories: isOtherSlice ? currentGroupedForOther : undefined,
      pointForDialog: pointForDialog,
    });
    setIsDetailDialogOpen(true);
  }, [results, selectedSchemeId, selectedFieldKey, schemes, pieDataMap, groupedForOtherSliceMap, dataRecordsMap]);

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
  
  const renderCustomLegend = (props: any) => {
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
            <TooltipProvider key={`item-${index}`} delayDuration={100}>
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
  };

  if (schemes.length === 0) {
    return <div className="p-4 text-center text-muted-foreground">No classification schemes available to build a chart.</div>;
  }

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-lg">Value Distribution</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 items-end">
            <div>
              <Label htmlFor="pie-scheme-select" className="text-sm font-medium">Select Scheme</Label>
              <Select value={selectedSchemeId?.toString() ?? ""} onValueChange={(v) => setSelectedSchemeId(v ? parseInt(v) : null)}>
                <SelectTrigger id="pie-scheme-select" className="mt-1"><SelectValue placeholder="Choose a scheme..." /></SelectTrigger>
                <SelectContent>
                  {schemeOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pie-field-select" className="text-sm font-medium">Select Field</Label>
              <Select value={selectedFieldKey ?? ""} onValueChange={(v) => setSelectedFieldKey(v || null)} disabled={!selectedSchemeId || fieldOptions.length === 0}>
                <SelectTrigger id="pie-field-select" className="mt-1"><SelectValue placeholder={!selectedSchemeId ? "Select scheme first" : "Choose a field..."} /></SelectTrigger>
                <SelectContent>
                  {fieldOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  {selectedSchemeId && fieldOptions.length === 0 && <div className="p-2 text-xs text-center text-muted-foreground">No suitable fields for pie chart in this scheme.</div>}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pie-max-slices-select" className="text-sm font-medium">Show Slices</Label>
              <Select 
                value={selectedMaxSlices.toString()} 
                onValueChange={(v) => setSelectedMaxSlices(v === 'Infinity' ? Infinity : parseInt(v))}
                disabled={!selectedSchemeId || !selectedFieldKey}
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
                        disabled={!selectedDataSourceIds || selectedDataSourceIds.length < 2 || !dataSources || dataSources.length === 0}
                      />
                    </span>
                  </TooltipTrigger>
                  {(!selectedDataSourceIds || selectedDataSourceIds.length < 2 || !dataSources || dataSources.length === 0) && (
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

          {selectedSchemeId && selectedFieldKey && (aggregateSources || (selectedDataSourceIds && selectedDataSourceIds.length < 2)) && pieDataMap['aggregated'] && pieDataMap['aggregated'].length > 0 ? (
            <ResponsiveContainer width="100%" height={350}>
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
          ) : !aggregateSources && selectedDataSourceIds && selectedDataSourceIds.length >= 2 && Object.keys(pieDataMap).some(key => key !== 'aggregated' && pieDataMap[key]?.length > 0) ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
              {selectedDataSourceIds.filter(dsId => pieDataMap[dsId] && pieDataMap[dsId].length > 0).map((dsId, chartIndex) => (
                <Card key={`pie-subchart-${dsId}` } className="shadow-md">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-base font-medium truncate" title={dataSourceNameMap.get(dsId) || `Source ${dsId}`}>{dataSourceNameMap.get(dsId) || `Source ${dsId}`}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-2">
                    <ResponsiveContainer width="100%" height={280}>
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
            <div className="flex flex-col items-center justify-center h-[350px] text-center border border-dashed rounded-lg p-4">
              <Info className="h-10 w-10 text-muted-foreground mb-3" />
              {!selectedSchemeId || !selectedFieldKey ? <p className="text-muted-foreground">Please select a scheme and a field to display the chart.</p>
                : (results.length > 0 && Object.values(pieDataMap).every(data => data.length === 0)) ? <p className="text-muted-foreground">No data available for the selected field in the current results/sources.</p>
                : <p className="text-muted-foreground">No results loaded to display.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSliceData && (
        <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Details for: {selectedSliceData.name}</DialogTitle>
              <DialogDescription>
                Scheme: {selectedSliceData.scheme.name} | Field: {selectedSliceData.fieldKey} <br />
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
                  schemes={schemes}
                  dataRecords={dataRecords}
                  dataSources={dataSources}
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
    </>
  );
};

export default ClassificationResultsPieChart;