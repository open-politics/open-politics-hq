import React, { useMemo, useState, useCallback, useEffect, useRef, MouseEvent } from 'react';
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  TooltipProps,
  DotProps,
  ComposedChart,
  Bar,
  BarProps,
  Cell,
  ReferenceDot,
  Area,
  ReferenceLine,
  Dot,
  Label,
  LabelList,
  LineProps,
} from 'recharts'; // Ensure types are handled carefully
import { format, startOfWeek, startOfMonth, startOfQuarter, startOfYear, getISOWeek, getQuarter } from 'date-fns'; // Import date-fns functions
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { ClassificationResultRead, ClassificationSchemeRead, EnhancedClassificationResultRead, DataSourceRead, DataRecordRead as DataRecord, ClassificationFieldCreate as ClientClassificationField, DictKeyDefinition as ClientDictKeyDefinition, FieldType, DataRecordRead } from '@/client';
import ClassificationResultDisplay from './ClassificationResultDisplay';
import { FormattedClassificationResult, ClassificationScheme, DictKeyDefinition, SchemeField } from '@/lib/classification/types';
import { adaptEnhancedResultReadToFormattedResult, adaptSchemeReadToScheme } from '@/lib/classification/adapters';
import DocumentLink from '../documents/DocumentLink';
import { ClassificationService } from '@/lib/classification/service';
import { Info } from 'lucide-react';
import { getTargetFieldDefinition, getTargetKeysForScheme, checkFilterMatch, compareValues, formatDisplayValue } from '@/lib/classification/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label as UiLabel } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { X, PaintBucket } from 'lucide-react';
import { ResultFilter } from '@/components/collection/workspaces/classifications/ClassificationResultFilters';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useReactTable,
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel
} from "@tanstack/react-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Eye, ExternalLink, Trash2 } from "lucide-react";
import { ArrowUpDown } from "lucide-react";
import { TimeAxisConfig } from './ClassificationTimeAxisControls';
import { Settings2, ArrowDownUp, SortAsc, SortDesc } from 'lucide-react';
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Calendar as CalendarIcon } from "lucide-react";
import { format as formatDate } from "date-fns";
import { Calendar } from "@/components/ui/calendar";

// Define gradient colors for bars
const gradientColors = [
  ['#0088FE', '#0044AA'],
  ['#00C49F', '#007C64'],
  ['#FFBB28', '#CC8800'],
  ['#FF8042', '#CC5500'],
  ['#8884d8', '#5551A8'],
  ['#82ca9d', '#4D9A6C'],
  ['#a4de6c', '#6DAB39'],
  ['#d0ed57', '#A6C229'],
  ['#ffc658', '#D19C29'],
];

// Define base colors for the chart
export const colorPalette = [
  '#0088FE',
  '#00C49F',
  '#FFBB28',
  '#FF8042',
  '#8884d8',
  '#82ca9d',
  '#a4de6c',
  '#d0ed57',
  '#ffc658',
];

// Custom bar component with gradient
const GradientBar = (props: any) => {
  const { fill, x, y, width, height } = props;
  const gradientId = `gradient-${Math.floor(Math.random() * gradientColors.length)}`;

  return (
    <g>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={gradientColors[Math.floor(Math.random() * gradientColors.length)][0]} stopOpacity={0.8} />
          <stop offset="100%" stopColor={gradientColors[Math.floor(Math.random() * gradientColors.length)][1]} stopOpacity={0.6} />
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={width} height={height} fill={`url(#${gradientId})`} rx={4} ry={4} />
    </g>
  );
};

// --- Event type for dot click ---
interface CustomizedCurveEvent {
  payload?: ChartDataPoint; // Keep payload if useful
  // Add other data you might need from the click event
}

// --- Props for CustomizedDot ---
interface CustomizedDotProps extends Omit<DotProps, 'onClick'> {
  payload?: any; // Keep payload if useful
  // Correct onClick type that doesn't conflict with DotProps
  onClick?: (event: React.MouseEvent<SVGElement>, data: CustomizedCurveEvent) => void;
}

const CustomizedDot: React.FC<CustomizedDotProps> = (props) => {
  const { cx, cy, stroke } = props;
  if (!cx || !cy || typeof cx !== 'number' || typeof cy !== 'number' || isNaN(cx) || isNaN(cy)) {
      return null;
  }
  return <Dot cx={cx} cy={cy} r={5} fill={stroke} stroke="#fff" strokeWidth={1} />;
};

interface Scheme {
  id: number;
  name: string;
}

interface DataPoint {
  publicationDate: number;
  publicationDateString: string;
  classificationTimestamp: number;
  classificationDateString: string;
  [key: string]: any;
}

interface ChartDataPoint {
  dateString: string;
  timestamp: number;
  count: number;
  documents: number[]; // Holds ALL unique document IDs for this time interval
  // Nested structure for stats and categories per scheme/field AND per source/aggregate
  // Example: point['SchemeName_FieldName']['_aggregated_'] or point['SchemeName_FieldName'][dataSourceId]
  [schemeFieldKey: string]: any; // Holds the nested maps { [targetKey: string | number]: { count, sum, min, max, avg, categories } }
}

type ChartData = ChartDataPoint[];

// Type for data points when grouping by value (Bar Chart)
interface GroupedDataPoint {
  valueString: string; // Label for the X-axis (e.g., "SchemeName: Value")
  totalCount: number; // Total count across selected sources
  sourceDocuments: Map<number, number[]>; // Map<DataSourceId, DocumentId[]> - ALWAYS populated
  schemeName: string;  // Original scheme name
  valueKey: string;    // Original value key used for grouping
  [key: `ds_${number}_count`]: number; // Dynamic properties for source counts (only if !aggregateSources)
}

export type { ChartDataPoint, GroupedDataPoint };

// Helper to get the primary value from a result, prioritizing numerical types for plotting
const getPlottableValue = (result: ClassificationResultRead, scheme: ClassificationSchemeRead): number | null => {
  // console.log(`[getPlottableValue] Checking Result ID: ${result.id}, Scheme: ${scheme.name} (ID: ${scheme.id})`); // Reduce logging

  if (!result || !result.value || !scheme || !scheme.fields || scheme.fields.length === 0) {
    // console.log(`[getPlottableValue] Returning null due to missing result/value/scheme/fields.`); // Reduce logging
    return null;
  }

  for (const field of scheme.fields) {
      let fieldValue: any;
      // console.log(`[getPlottableValue] Trying field: ${field.name} (${field.type})`); // Reduce logging

      // Extract value based on field name from the result object
      if (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)) {
          fieldValue = result.value[field.name];
      } else if (scheme.fields.length === 1) {
          // If only one field exists, the value might be directly the primitive/array
          fieldValue = result.value;
      } else {
          fieldValue = undefined;
      }
      // console.log(`[getPlottableValue] Extracted fieldValue for ${field.name}:`, fieldValue); // Reduce logging

      if (fieldValue === null || fieldValue === undefined) {
          // console.log(`[getPlottableValue] Field ${field.name} has null/undefined value. Skipping.`); // Reduce logging
          continue;
      }

      if (field.type === 'int') {
          const num = Number(fieldValue);
          if (!isNaN(num)) {
              // console.log(`[getPlottableValue] Found plottable INT field '${field.name}'. Returning value: ${num}`); // Reduce logging
              return num;
          } else {
              // console.log(`[getPlottableValue] Field ${field.name} is INT but value '${fieldValue}' is not a number. Skipping.`); // Reduce logging
          }
      }
      // console.log(`[getPlottableValue] Field ${field.name} (${field.type}) is not the target plottable type.`); // Reduce logging
  }

  // console.log(`[getPlottableValue] No plottable field found in scheme ${scheme.name}. Returning null.`); // Reduce logging
  return null;
};

interface Props {
  results: FormattedClassificationResult[];
  schemes: ClassificationSchemeRead[];
  dataSources?: DataSourceRead[];
  dataRecords?: DataRecordRead[];
  onDataRecordSelect?: (datarecordId: number) => void;
  onDataPointClick?: (point: ChartDataPoint | GroupedDataPoint) => void;
  filters: ResultFilter[];
  timeAxisConfig: TimeAxisConfig | null;
  selectedDataSourceIds: number[];
  onDataSourceSelectionChange: (ids: number[]) => void;
  selectedTimeInterval: 'day' | 'week' | 'month' | 'quarter' | 'year';
  onTimeIntervalChange: (interval: 'day' | 'week' | 'month' | 'quarter' | 'year') => void;
  aggregateSourcesDefault?: boolean;
}

interface SchemeData {
  scheme: ClassificationSchemeRead;
  values: number[];
  counts: Map<string, number>;
}

interface ResultGroup {
  date: string;
  schemes: Record<number, SchemeData>;
}

// Helper function to safely stringify any value
const safeStringify = (value: any): string => {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    // @ts-ignore - TypeScript doesn't like this but it's safe
    return JSON.stringify(value);
  } catch (e) {
    return 'Complex Data';
  }
};

// Helper function to format classification values
const getFormattedClassificationValue = (result: any, scheme: any): any => {
  if (!result.value) return '';
  const field = scheme.fields[0];
  if (!field) return '';
  let fieldValue: any;
  if (typeof result.value !== 'object' || result.value === null) {
    fieldValue = result.value;
  } else if (!Array.isArray(result.value)) {
    if (result.value[field.name] !== undefined) fieldValue = result.value[field.name];
    else if (result.value[scheme.name] !== undefined) fieldValue = result.value[scheme.name];
    else if ('value' in result.value) fieldValue = result.value.value;
    else if (Object.keys(result.value).length === 1) fieldValue = Object.values(result.value)[0];
    else fieldValue = result.value;
  } else {
    fieldValue = result.value;
  }
  switch (field.type) {
    case 'int':
      const num = Number(fieldValue);
      if (!isNaN(num)) {
        if ((field.scale_min === 0) && (field.scale_max === 1)) return num > 0.5 ? 'True' : 'False';
        return typeof num === 'number' ? Number(num.toFixed(2)) : num;
      }
      return String(fieldValue);
    case 'List[str]':
      if (Array.isArray(fieldValue)) {
        const isSetOfLabels = field.is_set_of_labels;
        const labels = field.labels;
        if (isSetOfLabels && labels) return fieldValue.filter((v: string) => labels.includes(v)).join(', ');
        return fieldValue.join(', ');
      }
      return String(fieldValue);
    case 'str': return String(fieldValue);
    case 'List[Dict[str, any]]':
      const formattedNodes = ClassificationService.formatEntityStatements(fieldValue, { compact: true, maxItems: 3 });
      if (Array.isArray(formattedNodes)) {
        return formattedNodes.map(node => {
          if (typeof node === 'string') return node;
          if (typeof node === 'object' && node !== null) {
            if ('raw' in node) return String(node.raw);
            if ('summary' in node) return String(node.summary);
          }
          return ClassificationService.safeStringify(node);
        }).join('; ');
      } else if (typeof formattedNodes === 'object' && formattedNodes !== null) {
        return ClassificationService.safeStringify(formattedNodes);
      } else {
        return String(formattedNodes);
      }
    default:
      if (typeof fieldValue === 'object') {
        if (Object.keys(fieldValue).length === 0) return 'N/A';
        return ClassificationService.safeStringify(fieldValue);
      }
      return String(fieldValue);
  }
};

// --- Helper function to get timestamp based on config ---
const getTimestamp = (
    result: FormattedClassificationResult,
    dataRecordsMap: Map<number, DataRecordRead> | undefined, // Use a Map for efficient lookup
    timeAxisConfig: TimeAxisConfig | null
): Date | null => {
    if (!timeAxisConfig) return null; // Default to null if no config

    if (timeAxisConfig.type === 'schema' && timeAxisConfig.schemeId && timeAxisConfig.fieldKey) {
        // Find the value for the specified scheme and field
        // Note: Assumes result.value structure matches the scheme fields
        let rawValue: any = null;
        if (result.scheme_id === timeAxisConfig.schemeId && result.value) {
            // Simplistic access - might need getNestedValue if fieldKey is nested like 'details.date'
            rawValue = result.value[timeAxisConfig.fieldKey];
        }

        if (rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '') {
            try {
                // Use standard Date constructor (less flexible than dateutil)
                const parsedDate = new Date(String(rawValue));
                // Check if the parsing resulted in a valid date
                if (isNaN(parsedDate.getTime())) {
                    throw new Error('Invalid Date');
                }
                return parsedDate; // Returns a Date object
            } catch (e) {
                console.warn(`Could not parse date from schema field '${timeAxisConfig.fieldKey}' value '${rawValue}':`, e);
                return null; // Return null if parsing fails
            }
        }
        return null; // Return null if value is missing or empty

    } else if (timeAxisConfig.type === 'default') {
        // Default uses classification timestamp
        if (result.timestamp) {
            try {
                return new Date(result.timestamp);
            } catch (e) {
                 console.warn(`Could not parse default timestamp \'${result.timestamp}\' for result ${result.id}:`, e);
                 return null;
            }
        }
        return null; // No timestamp on result

    } else if (timeAxisConfig.type === 'event') {
        // Event timestamp uses the DataRecord's event_timestamp or created_at
        const record = dataRecordsMap?.get(result.datarecord_id);
        if (record) {
            // Prioritize event_timestamp, then created_at
            // console.log(`[getTimestamp/event] Found record ID ${record.id}: event_timestamp='${record.event_timestamp}', created_at='${record.created_at}'`); // Reduce logging
            const timestampStr = record.event_timestamp || record.created_at;
            if (timestampStr) {
                try {
                    const parsedDate = new Date(timestampStr);
                    if (isNaN(parsedDate.getTime())) throw new Error('Invalid Date');
                    return parsedDate;
                } catch (e) {
                    console.warn(`[getTimestamp/event] Could not parse event timestamp '${timestampStr}' for record ${record.id}:`, e);
                    return null;
                }
            } else {
                // console.warn(`[getTimestamp/event] No timestamp string found (event_timestamp or created_at) for record ${record.id}`); // Reduce logging
            }
        } else {
             // console.warn(`[getTimestamp/event] DataRecord not found in map for ID: ${result.datarecord_id}`); // Reduce logging
        }
        // Fallback if record or its timestamps are missing
        return null;
    }

    return null; // Fallback case
};

// --- Data Processing Function (Time Series) ---
const processLineChartData = (
  resultsToProcess: FormattedClassificationResult[],
  schemes: ClassificationSchemeRead[],
  dataRecordsMap: Map<number, DataRecordRead> | undefined,
  timeAxisConfig: TimeAxisConfig | null,
  groupingInterval: 'day' | 'week' | 'month' | 'quarter' | 'year',
  selectedDataSourceIds: number[],
  allDataSources: DataSourceRead[],
  aggregateSources: boolean
): ChartData => {
    console.log(`[Chart] Processing line chart data. Interval: ${groupingInterval}, Sources: ${selectedDataSourceIds.join(',')}, Aggregate: ${aggregateSources}`);
    const groupedData: Record<string, ChartDataPoint> = {};

    resultsToProcess.forEach(result => {
      const timestamp = getTimestamp(result, dataRecordsMap, timeAxisConfig);
      if (!timestamp || isNaN(timestamp.getTime())) return;

      const record = dataRecordsMap?.get(result.datarecord_id);
      const dataSourceId = record?.datasource_id;
      if (typeof dataSourceId !== 'number' || !selectedDataSourceIds.includes(dataSourceId)) return;

      let dateKey: string;
      let pointTimestamp: Date;
      switch (groupingInterval) {
            case 'week': pointTimestamp = startOfWeek(timestamp, { weekStartsOn: 1 }); dateKey = format(pointTimestamp, 'yyyy-wo'); break;
            case 'month': pointTimestamp = startOfMonth(timestamp); dateKey = format(pointTimestamp, 'yyyy-MM'); break;
            case 'quarter': pointTimestamp = startOfQuarter(timestamp); const quarter = getQuarter(timestamp); dateKey = `${format(pointTimestamp, 'yyyy')}-Q${quarter}`; break;
            case 'year': pointTimestamp = startOfYear(timestamp); dateKey = format(pointTimestamp, 'yyyy'); break;
            case 'day': default: pointTimestamp = new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate()); dateKey = format(pointTimestamp, 'yyyy-MM-dd'); break;
       }

      if (!groupedData[dateKey]) {
        groupedData[dateKey] = { dateString: dateKey, timestamp: pointTimestamp.getTime(), count: 0, documents: [], };
      }
      const point = groupedData[dateKey];
      point.count++;
      if (!point.documents.includes(result.datarecord_id)) point.documents.push(result.datarecord_id);

      const scheme = schemes.find(s => s.id === result.scheme_id);
      if (scheme) {
        for (const field of scheme.fields) {
          const fieldName = field.name;
          const fieldType = field.type;
          const schemeFieldKey = `${scheme.name}_${field.name}`;

          let fieldValue: any = undefined;
          if (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)) fieldValue = result.value[fieldName];
          else if (scheme.fields.length === 1 && fieldName === scheme.fields[0].name) fieldValue = result.value;

          // *** FIX: Correctly use targetKey for accessing the stats object ***
          const targetKey = aggregateSources ? '_aggregated_' : dataSourceId;

          if (!point[schemeFieldKey]) point[schemeFieldKey] = {};
          if (!point[schemeFieldKey][targetKey]) {
            point[schemeFieldKey][targetKey] = { count: 0, sum: 0, min: undefined, max: undefined, avg: undefined, categories: {} };
          }

          const targetStats = point[schemeFieldKey][targetKey]; // Use targetKey here

          if (fieldType === 'int' && fieldValue !== null && fieldValue !== undefined) {
            const numericValue = Number(fieldValue);
            if (!isNaN(numericValue)) {
              targetStats.count++;
              targetStats.sum += numericValue;
              targetStats.avg = targetStats.sum / targetStats.count;
              if (targetStats.min === undefined || numericValue < targetStats.min) targetStats.min = numericValue;
              if (targetStats.max === undefined || numericValue > targetStats.max) targetStats.max = numericValue;
            }
          }

          if (fieldValue !== null && fieldValue !== undefined) {
            const displayValue = formatDisplayValue(fieldValue, scheme);
            const categoryKey = String(displayValue ?? 'N/A');
            targetStats.categories[categoryKey] = (targetStats.categories[categoryKey] || 0) + 1;
          }
        }
      }
    });

    const chartData = Object.values(groupedData).sort((a, b) => a.timestamp - b.timestamp);
    console.log("[Chart] Final Processed Line Chart Data (Aggregate=", aggregateSources, "):", JSON.stringify(chartData, null, 2)); // Log processed data structure
    return chartData;
};

// --- Data Processing for Bar Chart (isGrouped = true) ---
const processGroupedChartData = (
  resultsToProcess: FormattedClassificationResult[],
  schemes: ClassificationSchemeRead[],
  groupingSchemeId: number | null,
  groupingFieldKey: string | null,
  selectedDataSourceIds: number[],
  allDataSources: DataSourceRead[],
  dataRecordsMap: Map<number, DataRecordRead> | undefined,
  aggregateSources: boolean
): GroupedDataPoint[] => {
   if (!groupingSchemeId || !groupingFieldKey || resultsToProcess.length === 0) return [];

    const selectedScheme = schemes.find(s => s.id === groupingSchemeId);
    if (!selectedScheme || !selectedScheme.fields) return [];

    console.log(`[Grouped Chart] Grouping by Scheme ${groupingSchemeId}, Key ${groupingFieldKey}. Sources: ${selectedDataSourceIds.join(',')}, Aggregate: ${aggregateSources}`);

    // Find the specific field or dict_key definition
    let targetDefinition: ClientClassificationField | ClientDictKeyDefinition | null = null;
    let fieldDefinition: ClientClassificationField | null = null;
    fieldDefinition = selectedScheme.fields.find(f => f.name === groupingFieldKey || (f.type === 'List[Dict[str, any]]' && f.dict_keys?.some(dk => dk.name === groupingFieldKey))) || null;
    if (!fieldDefinition) return [];
    if (fieldDefinition.name === groupingFieldKey) targetDefinition = fieldDefinition;
    else if (fieldDefinition.type === 'List[Dict[str, any]]' && fieldDefinition.dict_keys) targetDefinition = fieldDefinition.dict_keys.find(dk => dk.name === groupingFieldKey) || null;
    if (!targetDefinition) return [];

    // Intermediate map to aggregate counts and doc IDs per source for each value string
    const valueCountsMap = new Map<string, { counts: Map<number, number>; documents: Map<number, number[]>; schemeName: string; valueKey: string; }>();

    resultsToProcess.forEach(result => {
        if (result.scheme_id !== groupingSchemeId) return;
        const record = dataRecordsMap?.get(result.datarecord_id);
        const dataSourceId = record?.datasource_id;
        if (typeof dataSourceId !== 'number' || !selectedDataSourceIds.includes(dataSourceId)) return;

        // Value extraction
        const valuesToProcess: any[] = [];
        if ('dict_keys' in fieldDefinition && fieldDefinition.dict_keys && targetDefinition && 'type' in targetDefinition) {
             if (Array.isArray(result.value)) result.value.forEach(item => { if (typeof item === 'object' && item !== null && groupingFieldKey in item) valuesToProcess.push(item[groupingFieldKey]); });
        } else {
             const fieldValue = (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value) && fieldDefinition.name in result.value) ? result.value[fieldDefinition.name] : result.value;
             if (fieldDefinition.type === 'List[str]' && Array.isArray(fieldValue)) fieldValue.forEach(label => valuesToProcess.push(label));
             else valuesToProcess.push(fieldValue);
        }

        // Update map
        valuesToProcess.forEach(value => {
             const valueString = safeStringify(value);
             let currentEntry = valueCountsMap.get(valueString);
             if (!currentEntry) {
                 currentEntry = { counts: new Map(), documents: new Map(), schemeName: selectedScheme.name, valueKey: valueString };
                 valueCountsMap.set(valueString, currentEntry);
             }
             currentEntry.counts.set(dataSourceId, (currentEntry.counts.get(dataSourceId) || 0) + 1);
             let docList = currentEntry.documents.get(dataSourceId);
             if (!docList) { docList = []; currentEntry.documents.set(dataSourceId, docList); }
             if (!docList.includes(result.datarecord_id)) docList.push(result.datarecord_id);
        });
    });

    // Convert map to final array format
    const groupedData: GroupedDataPoint[] = Array.from(valueCountsMap.entries()).map(([valueStr, data]) => {
        const point: GroupedDataPoint = {
            valueString: valueStr,
            totalCount: 0,
            sourceDocuments: data.documents, // Assign the fully populated map
            schemeName: data.schemeName,
            valueKey: data.valueKey
        };
        selectedDataSourceIds.forEach(dsId => {
            const count = data.counts.get(dsId) || 0;
            if (!aggregateSources) point[`ds_${dsId}_count`] = count;
            point.totalCount += count;
        });
        // Log after creation to confirm map presence
        // console.log(`[Grouped Proc Final] Point "${point.valueString}" Docs Map Size: ${point.sourceDocuments.size}`);
        return point;
    });

    console.log(`[Grouped Chart] Final Processed Grouped Data (Aggregate=${aggregateSources}):`, groupedData.length, "points");
    return groupedData;
};

const tooltipStyle = `
  .recharts-tooltip-wrapper {
    max-height: 18rem; /* Corresponds to max-h-72 */
    overflow-y: auto !important; /* Force overflow */
    /* Add some scrollbar styling if desired */
    scrollbar-width: thin; /* Firefox */
    scrollbar-color: hsl(var(--muted)) hsl(var(--background)); /* Firefox */
  }
  .recharts-tooltip-wrapper::-webkit-scrollbar {
    width: 6px;
  }
  .recharts-tooltip-wrapper::-webkit-scrollbar-track {
    background: hsl(var(--background));
    border-radius: 3px;
  }
  .recharts-tooltip-wrapper::-webkit-scrollbar-thumb {
    background-color: hsl(var(--muted));
    border-radius: 3px;
    border: 1px solid hsl(var(--background));
  }
`;

// --- Add state for tooltip hover tracking ---
type TooltipHoverSetter = (isHovered: boolean) => void;

const ClassificationResultsChart: React.FC<Props> = ({
  results, schemes, dataSources, dataRecords, onDataRecordSelect, onDataPointClick,
  filters, timeAxisConfig, selectedDataSourceIds, onDataSourceSelectionChange,
  selectedTimeInterval, onTimeIntervalChange, aggregateSourcesDefault = false,
}) => {
  const [isGrouped, setIsGrouped] = useState(false);
  const [aggregateSources, setAggregateSources] = useState(aggregateSourcesDefault);
  const [showStatistics, setShowStatistics] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<ChartDataPoint | GroupedDataPoint | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isChartHovered, setIsChartHovered] = useState(false);
  const [isTooltipHovered, setIsTooltipHovered] = useState(false);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const hideTooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null); // For global chart/tooltip hover
  const TOOLTIP_DELAY = 200;

  // --- NEW: State for legend hover ---
  const [hoveredLegendKey, setHoveredLegendKey] = useState<string | null>(null);
  // --- END NEW ---

  // --- NEW: States and Ref for Sub-Chart specific hover ---
  const [hoveredSubChartId, setHoveredSubChartId] = useState<number | null>(null);
  const [hoveredSubChartTooltipOwnerId, setHoveredSubChartTooltipOwnerId] = useState<number | null>(null);
  // --- MODIFIED: Simplified timeout refs for sub-chart leave events ---
  const subChartLeaveTimeoutIdRef = useRef<NodeJS.Timeout | null>(null);
  const subChartLeaveDsIdRef = useRef<number | null>(null);
  const subChartLeaveTypeRef = useRef<'card' | 'tooltip' | null>(null);
  // --- END MODIFIED ---

  // Use simple date objects for range
  const [dateRangeFrom, setDateRangeFrom] = useState<Date | null>(null);
  const [dateRangeTo, setDateRangeTo] = useState<Date | null>(null);

  const [selectedSchemaIds, setSelectedSchemaIds] = useState<number[]>(() => schemes.map(s => s.id));
  const [groupingSchemeId, setGroupingSchemeId] = useState<number | null>(() => schemes.length > 0 ? schemes[0].id : null); // Default to first scheme if available
  const [groupingFieldKey, setGroupingFieldKey] = useState<string | null>(null); // Will be set by useEffect
  type GroupedSortOrder = 'count-desc' | 'value-asc' | 'value-desc';
  const [groupedSortOrder, setGroupedSortOrder] = useState<GroupedSortOrder>('count-desc');
  const [isGroupedDataInteger, setIsGroupedDataInteger] = useState<boolean>(false);

  // --- State for custom series colors ---
  const [customSeriesColors, setCustomSeriesColors] = useState<Record<string, string>>({});

  // Update groupingFieldKey when groupingSchemeId changes
  useEffect(() => {
    if (groupingSchemeId !== null) {
        const keys = getTargetKeysForScheme(groupingSchemeId, schemes);
        // Always set the first available key when scheme changes or initially
        setGroupingFieldKey(keys.length > 0 ? keys[0].key : null);
    } else {
        setGroupingFieldKey(null);
    }
  }, [groupingSchemeId, schemes]); // Trigger only when scheme ID or schemes change

  // Filter schemes based on selection for plotting
  const filteredSchemes = useMemo(() => schemes.filter(scheme => selectedSchemaIds.includes(scheme.id)), [schemes, selectedSchemaIds]);

  // --- NEW: Effect to set default series colors only when schemes change ---
  useEffect(() => {
    // Generate default colors for all potential plottable fields
    const fieldsToProcess: { key: string; index: number }[] = [];
    let colorIndex = 0;
    
    filteredSchemes.forEach(scheme => {
      scheme.fields.forEach(field => {
        if (field.type === 'int') {
          const fieldKey = `${scheme.name}_${field.name}`;
          fieldsToProcess.push({ key: fieldKey, index: colorIndex });
          colorIndex++;
        }
      });
    });
    
    // Only set default colors for fields that don't already have a custom color
    setCustomSeriesColors(prev => {
      const newColors = { ...prev };
      fieldsToProcess.forEach(({ key, index }) => {
        // Only set if not already customized by user
        if (!prev[key]) {
          newColors[key] = colorPalette[index % colorPalette.length];
        }
      });
      return newColors;
    });
  }, [filteredSchemes]); // Only depend on schemes, not on plottableFieldKeys
  // --- END NEW ---

  // --- NEW: Generate list of plottable field keys --- 
  const plottableFieldKeys = useMemo(() => {
      const keys: { key: string; name: string; color: string }[] = [];
      let colorIndex = 0;
      filteredSchemes.forEach(scheme => {
          scheme.fields.forEach(field => {
              if (field.type === 'int') {
                  const fieldKey = `${scheme.name}_${field.name}`;
                  keys.push({
                      key: fieldKey,
                      name: `${scheme.name}: ${field.name}`, // Name for legend/tooltip
                      color: customSeriesColors[fieldKey] || colorPalette[colorIndex % colorPalette.length]
                  });
                  colorIndex++;
              }
          });
      });
      return keys;
  }, [filteredSchemes, customSeriesColors]);
  // --- END NEW --- 

  // Memoize the DataRecord map here
  const dataRecordsMap = useMemo(() => dataRecords ? new Map(dataRecords.map(dr => [dr.id, dr])) : undefined, [dataRecords]);
  const dataSourceNameMap = useMemo(() => dataSources ? new Map(dataSources.map(ds => [ds.id, ds.name || `Source ${ds.id}`])) : new Map<number, string>(), [dataSources]);

  // --- NEW: Memoize sourceFilteredResults separately ---
  const sourceFilteredResults = useMemo(() => {
    // console.log(`[Memo] Recalculating sourceFilteredResults. Sources: ${selectedDataSourceIds.join(',')}`); // Reduce logging
    if (!dataSources || !dataRecordsMap || selectedDataSourceIds.length === 0) {
        // console.log("[Memo] No sources selected or maps not ready, returning empty results."); // Reduce logging
        return [];
    }
    const resultsByDocId = results.reduce<Record<number, FormattedClassificationResult[]>>((acc, result) => { (acc[result.datarecord_id] = acc[result.datarecord_id] || []).push(result); return acc; }, {});
    const filteredDocIds = Object.keys(resultsByDocId).map(Number).filter(docId => schemes && filters.every(filter => checkFilterMatch(filter, resultsByDocId[docId], schemes)));
    const propFilteredResults = results.filter(result => filteredDocIds.includes(result.datarecord_id));
    // console.log(`[Memo] After prop filters: ${propFilteredResults.length} results.`); // Reduce logging
    const finalFiltered = propFilteredResults.filter(result => { const record = dataRecordsMap.get(result.datarecord_id); return typeof record?.datasource_id === 'number' && selectedDataSourceIds.includes(record.datasource_id); });
    // console.log(`[Memo] After source filters: ${finalFiltered.length} results.`); // Reduce logging
     return finalFiltered;
  }, [results, filters, schemes, dataRecordsMap, selectedDataSourceIds, dataSources]);
  // --- END NEW ---

  // Add a function to filter data by date range
  const filterDataByDateRange = useCallback((data: ChartData): ChartData => {
    if (!dateRangeFrom) return data;
    
    // Create date objects for comparison without modifying originals
    const startDate = new Date(dateRangeFrom);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = dateRangeTo ? new Date(dateRangeTo) : new Date(dateRangeFrom);
    endDate.setHours(23, 59, 59, 999);
    
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    
    return data.filter(point => 
      point.timestamp >= startTime && point.timestamp <= endTime
    );
  }, [dateRangeFrom, dateRangeTo]);

  // Modify the useMemo for chart data to include date filtering
  const { chartData, groupedData, maxGroupCount, dateExtents }: { 
    chartData: ChartData; 
    groupedData: GroupedDataPoint[]; 
    maxGroupCount: number | 'auto';
    dateExtents: { min: Date | null; max: Date | null };
  } = useMemo(() => {
    console.log(`[Chart Memo] Processing data. Filtered results: ${sourceFilteredResults.length}, Grouped: ${isGrouped}, Aggregate: ${aggregateSources}`);

    if (sourceFilteredResults.length === 0 || !dataSources) {
         return { 
           chartData: [], 
           groupedData: [], 
           maxGroupCount: 'auto',
           dateExtents: { min: null, max: null }
         };
    }

    // Calculate date extents for all data
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    if (isGrouped) {
        // Only process if grouping scheme and key are selected
        if (groupingSchemeId === null || groupingFieldKey === null) {
             console.log("[Chart Memo] Grouped view selected, but no scheme/key chosen.");
             return { 
               chartData: [], 
               groupedData: [], 
               maxGroupCount: 'auto',
               dateExtents: { min: null, max: null }
             };
        }

        const processedGroupedData = processGroupedChartData( sourceFilteredResults, schemes, groupingSchemeId, groupingFieldKey, selectedDataSourceIds, dataSources, dataRecordsMap, aggregateSources );
        const isInteger = processedGroupedData.length > 0 && processedGroupedData.every(point => point.valueString === 'N/A' || !isNaN(parseInt(point.valueString, 10)));
        setIsGroupedDataInteger(isInteger);

        // Apply Sorting for AGGREGATED data or if not integer sortable by value
        const finalGroupedData = [...processedGroupedData];
        if (aggregateSources || !isInteger || (groupedSortOrder !== 'value-asc' && groupedSortOrder !== 'value-desc')) {
            finalGroupedData.sort((a, b) => {
                // For aggregated view, or if not sorting by integer value, primarily sort by totalCount descending.
                // Value sorting for aggregated or non-integer data can be refined if needed.
                if (groupedSortOrder === 'value-asc' && !isInteger) return a.valueString.localeCompare(b.valueString);
                if (groupedSortOrder === 'value-desc' && !isInteger) return b.valueString.localeCompare(a.valueString);
                // Default to count-desc for aggregated, or if value sort isn't applicable for integers
                return b.totalCount - a.totalCount; 
            });
        }
        // If !aggregateSources and isInteger and sorting by value, the sorting will be handled per-subchart.
        // Otherwise, the above sort is used.

        // Calculate max count for Y-axis domain for aggregated chart
        let calculatedMaxGroupCount = 'auto' as number | 'auto';
        if (aggregateSources) {
            const maxVal = finalGroupedData.reduce((max, point) => Math.max(max, point.totalCount || 0), 0);
            calculatedMaxGroupCount = maxVal > 0 ? maxVal + Math.ceil(maxVal * 0.1) : 10;
        }

        return { 
          chartData: [], 
          groupedData: finalGroupedData, // This data might be sorted if aggregateSources is true
          maxGroupCount: calculatedMaxGroupCount,
          dateExtents: { min: null, max: null }
        };

    } else { // Time Series
        setIsGroupedDataInteger(false);
        const lineData = processLineChartData(
          sourceFilteredResults, schemes, dataRecordsMap, timeAxisConfig, 
          selectedTimeInterval, selectedDataSourceIds, dataSources, aggregateSources
        );
        
        // Calculate date extents from the data
        if (lineData.length > 0) {
          lineData.forEach(point => {
            const pointDate = new Date(point.timestamp);
            if (!minDate || pointDate < minDate) minDate = pointDate;
            if (!maxDate || pointDate > maxDate) maxDate = pointDate;
          });
        }
        
        // Apply date range filter
        const filteredLineData = filterDataByDateRange(lineData);
        
        return { 
          chartData: filteredLineData, 
          groupedData: [], 
          maxGroupCount: 'auto',
          dateExtents: { min: minDate, max: maxDate }
        };
    }
  }, [
    sourceFilteredResults, 
    schemes, 
    isGrouped, 
    aggregateSources, 
    dataRecordsMap, 
    groupingSchemeId, 
    groupingFieldKey, 
    timeAxisConfig, 
    selectedDataSourceIds, 
    selectedTimeInterval, 
    dataSources, 
    groupedSortOrder,
    filterDataByDateRange
  ]);

  // Initialize date range from extents when they change and dateRange isn't set
  useEffect(() => {
    if (!dateRangeFrom && !dateRangeTo && dateExtents.min && dateExtents.max) {
      // Only set if we have valid date bounds and no current selection
      setDateRangeFrom(dateExtents.min);
      setDateRangeTo(dateExtents.max);
    }
  }, [dateExtents, dateRangeFrom, dateRangeTo]);

  // Determine which data source to use based on the switch
  const displayData = isGrouped ? groupedData : chartData;

  // Handle click events on data points
  const handleClick = (event: any, clickedDsId?: number) => {
    console.log('[ChartClick] Event received:', event); // Log the raw event

    let pointToUse: ChartDataPoint | GroupedDataPoint | null = null;

    if (isGrouped) {
        // **FIX:** Use index from event to get correct data point from state
        if (event && typeof event.activeTooltipIndex === 'number' && event.activeTooltipIndex >= 0) {
            const index = event.activeTooltipIndex;
             // Ensure displayData is the groupedData array and index is valid
            if (Array.isArray(displayData) && index < displayData.length) {
                pointToUse = displayData[index] as GroupedDataPoint; // Get point directly from state array
                console.log(`[ChartClick - Grouped] Using index ${index} to get point from state:`, JSON.stringify(pointToUse));
             } else {
                 console.warn(`[ChartClick - Grouped] Invalid index (${index}) or displayData is not the expected array.`);
             }
        } else {
             console.warn('[ChartClick - Grouped] Click event missing activeTooltipIndex.');
             // Fallback to payload (might be unreliable)
             if (event && Array.isArray(event.activePayload) && event.activePayload.length > 0) {
                 pointToUse = event.activePayload[0].payload ?? event.activePayload[0].props?.payload;
                  console.log('[ChartClick - Grouped] Fallback to payload point:', JSON.stringify(pointToUse));
             }
        }
    } else { // Time Series click
        if (event && Array.isArray(event.activePayload) && event.activePayload.length > 0) {
            pointToUse = event.activePayload[0].payload ?? event.activePayload[0].props?.payload;
            console.log(`[ChartClick - TimeSeries] Using payload point:`, JSON.stringify(pointToUse));
        } else {
             console.warn('[ChartClick - TimeSeries] Click event missing activePayload.');
        }
    }


    if (pointToUse && typeof pointToUse === 'object' && pointToUse !== null) {
         // Verify sourceDocuments for grouped points retrieved from state
         if (isGrouped && (!('sourceDocuments' in pointToUse) || !(pointToUse.sourceDocuments instanceof Map))) {
             console.error('[ChartClick] Error: Point retrieved from state is missing or has invalid sourceDocuments map!', pointToUse);
             setSelectedPoint(null);
             setIsDialogOpen(false);
             return; // Exit if crucial data is missing even from state
         }

        setSelectedPoint(pointToUse);
        setIsDialogOpen(true);
        if (onDataPointClick) {
            onDataPointClick(pointToUse);
        }
        console.log('[ChartClick] Set selected point and opened dialog.');
    } else {
        console.warn('[ChartClick] No valid point data could be determined.');
        setSelectedPoint(null);
    }
};

  const renderDot = useCallback((props: CustomizedDotProps & { index?: number }) => {
    const { cx, cy, r, index } = props;
    const key = index !== undefined ? `dot-${index}` : `dot-${cx}-${cy}`;
    if (typeof cx !== 'number' || typeof cy !== 'number' || isNaN(cx) || isNaN(cy)) {
        // Return an empty SVG group instead of null to satisfy TypeScript
        return <g key={key} />;
    }
    return <circle key={key} cx={cx} cy={cy} r={r ? r + 2 : 4} fill="rgba(136, 132, 216, 0.8)" stroke="#fff" strokeWidth={1} />;
  }, []);

  // --- Get target keys for the selected grouping scheme ---
  const currentGroupingKeys = useMemo(() => {
      if (groupingSchemeId !== null) return getTargetKeysForScheme(groupingSchemeId, schemes);
      return [];
  }, [groupingSchemeId, schemes]);

  // renderArea function to create a proper area between min and max values
  const renderMinMaxArea = useCallback((scheme: ClassificationSchemeRead, color: string) => {
    const schemeColor = color;
    
    return (
      <Area
        key={`area-${scheme.id}`}
        type="monotone"
        dataKey={`${scheme.name}_min`}
        stroke="none"
        fill={schemeColor}
        fillOpacity={0.2}
        activeDot={false}
        name={`${scheme.name} (min/max range)`}
        isAnimationActive={false}
      >
        <YAxis yAxisId={0} domain={[0, (dataMax: number) => Math.max(dataMax || 0, 10)]} />
        {/* Using the _max value for the upper bound of the area */}
        <YAxis yAxisId={1} orientation="right" domain={[0, 10]} />
      </Area>
    );
  }, []);

  // Handle schema selection change
  const handleSchemaSelectionChange = useCallback((value: string[]) => {
    const schemaIds = value.map(v => parseInt(v));
    setSelectedSchemaIds(schemaIds);
  }, []);

  // State for selected fields per scheme (for Table/Display) - KEEP THIS
  const [selectedFieldsPerScheme, setSelectedFieldsPerScheme] = useState<Record<number, string[]>>(() => {
    const initialState: Record<number, string[]> = {};
    schemes.forEach(scheme => {
      initialState[scheme.id] = scheme.fields.map(f => f.name);
    });
    return initialState;
  });

  // --- NEW: State for selected keys to PLOT on the line chart ---
  // Initialize with all plottable keys from initially selected schemes
  const [selectedPlotKeys, setSelectedPlotKeys] = useState<string[]>(() => {
      const initialKeys: string[] = [];
      schemes
        .filter(scheme => selectedSchemaIds.includes(scheme.id)) // Use initially selected schemes
        .forEach(scheme => {
          scheme.fields.forEach(field => {
              if (field.type === 'int') {
                  initialKeys.push(`${scheme.name}_${field.name}`);
              }
          });
      });
      // Ensure at least one key is selected initially if possible
      return initialKeys.length > 0 ? initialKeys : [];
  });
  // --- END NEW ---

  // --- NEW: Effect to sync selectedPlotKeys with available plottableFieldKeys ---
  useEffect(() => {
      const availableKeysSet = new Set(plottableFieldKeys.map(k => k.key));
      const currentlySelected = selectedPlotKeys;
      let newSelectedKeys = currentlySelected.filter(key => availableKeysSet.has(key));

      // If no valid keys remain selected OR if no keys were selected initially,
      // try to select the first available key.
      if ((newSelectedKeys.length === 0 || currentlySelected.length === 0) && plottableFieldKeys.length > 0) {
          newSelectedKeys = [plottableFieldKeys[0].key];
      }

      // Only update state if the selection actually changed
      if (JSON.stringify(newSelectedKeys) !== JSON.stringify(currentlySelected)) {
          setSelectedPlotKeys(newSelectedKeys);
      }
  }, [plottableFieldKeys, selectedPlotKeys]); // Rerun when available keys or current selection changes
  // --- END NEW ---

  // --- NEW: State to track if the mouse is over the custom tooltip ---
  // const [isTooltipHovered, setIsTooltipHovered] = useState(false); // Moved up

  // --- Effect to set default sort order ---
  useEffect(() => {
      if (isGrouped && isGroupedDataInteger) {
          // Only set to value-asc if it's currently count-desc (prevents overriding user selection)
          // This ensures user's choice (e.g., count-desc) persists even if data remains integer
          if (groupedSortOrder === 'count-desc') {
             setGroupedSortOrder('value-asc');
          }
      } else {
          // Always reset to count-desc if not grouped or not integer
          setGroupedSortOrder('count-desc');
      }
  // Only trigger when grouping status or integer status changes, NOT on sort order change itself
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGrouped, isGroupedDataInteger]);
  // --- End Effect ---

  // --- NEW: Clear timeout on unmount --- 
  useEffect(() => {
      return () => {
          if (hideTooltipTimeoutRef.current) {
              clearTimeout(hideTooltipTimeoutRef.current);
          }
          // --- MODIFIED: Cleanup for single sub-chart leave timeout ---
          if (subChartLeaveTimeoutIdRef.current) {
            clearTimeout(subChartLeaveTimeoutIdRef.current);
          }
          // --- END MODIFIED ---
      };
  }, []);
  // --- END NEW ---

  // --- NEW: Debounced handlers for tooltip visibility ---
  const handleChartMouseEnter = () => {
      if (hideTooltipTimeoutRef.current) clearTimeout(hideTooltipTimeoutRef.current);
      setIsChartHovered(true);
  };
  const handleChartMouseLeave = () => {
      hideTooltipTimeoutRef.current = setTimeout(() => {
          setIsChartHovered(false);
      }, TOOLTIP_DELAY);
  };
  const handleTooltipMouseEnter = () => {
      if (hideTooltipTimeoutRef.current) clearTimeout(hideTooltipTimeoutRef.current);
      setIsTooltipHovered(true);
  };
  const handleTooltipMouseLeave = () => {
      hideTooltipTimeoutRef.current = setTimeout(() => {
          setIsTooltipHovered(false);
      }, TOOLTIP_DELAY);
  };
  // --- END NEW ---

  // --- NEW: Handlers for Sub-Chart specific hover ---
  const handleSubChartCardEnter = (dsId: number) => {
    if (subChartLeaveTimeoutIdRef.current) {
      clearTimeout(subChartLeaveTimeoutIdRef.current);
      subChartLeaveTimeoutIdRef.current = null;
      subChartLeaveDsIdRef.current = null;
      subChartLeaveTypeRef.current = null;
    }
    setHoveredSubChartId(dsId);
    setHoveredSubChartTooltipOwnerId(null); 
  };

  const handleSubChartCardLeave = (dsId: number) => {
    if (subChartLeaveTimeoutIdRef.current) { // Clear any existing pending leave, from card or tooltip
      clearTimeout(subChartLeaveTimeoutIdRef.current);
    }
    subChartLeaveDsIdRef.current = dsId;
    subChartLeaveTypeRef.current = 'card';
    subChartLeaveTimeoutIdRef.current = setTimeout(() => {
      // Only nullify if this timeout is still the active one for this dsId and type
      if (subChartLeaveDsIdRef.current === dsId && subChartLeaveTypeRef.current === 'card') {
        setHoveredSubChartId(null);
        subChartLeaveTimeoutIdRef.current = null;
        subChartLeaveDsIdRef.current = null;
        subChartLeaveTypeRef.current = null;
      }
    }, TOOLTIP_DELAY);
  };

  const handleSubChartTooltipEnter = (dsId: number) => {
    if (subChartLeaveTimeoutIdRef.current) {
      clearTimeout(subChartLeaveTimeoutIdRef.current);
      subChartLeaveTimeoutIdRef.current = null;
      subChartLeaveDsIdRef.current = null;
      subChartLeaveTypeRef.current = null;
    }
    setHoveredSubChartTooltipOwnerId(dsId);
    // Keep hoveredSubChartId active as the tooltip belongs to it
  };

  const handleSubChartTooltipLeave = (dsId: number) => {
    if (subChartLeaveTimeoutIdRef.current) { // Clear any existing pending leave
      clearTimeout(subChartLeaveTimeoutIdRef.current);
    }
    subChartLeaveDsIdRef.current = dsId;
    subChartLeaveTypeRef.current = 'tooltip';
    subChartLeaveTimeoutIdRef.current = setTimeout(() => {
      // Only nullify if this timeout is still the active one for this dsId and type
      if (subChartLeaveDsIdRef.current === dsId && subChartLeaveTypeRef.current === 'tooltip') {
        setHoveredSubChartTooltipOwnerId(null);
        subChartLeaveTimeoutIdRef.current = null;
        subChartLeaveDsIdRef.current = null;
        subChartLeaveTypeRef.current = null;
      }
    }, TOOLTIP_DELAY);
  };
  // --- END NEW ---

  // Add a helper function to generate source-specific colors (near the top with other constants)
  const generateSourceColor = (baseColor: string, sourceIndex: number, totalSources: number): string => {
    // Convert base color to HSL for better manipulation
    const hexToRgb = (hex: string): { r: number, g: number, b: number } => {
      // Remove # if present
      const cleanHex = hex.charAt(0) === '#' ? hex.substring(1) : hex;
      
      // Parse hex values
      const r = parseInt(cleanHex.substring(0, 2), 16);
      const g = parseInt(cleanHex.substring(2, 4), 16);
      const b = parseInt(cleanHex.substring(4, 6), 16);
      
      return { r, g, b };
    };
    
    // RGB to HSL conversion
    const rgbToHsl = (r: number, g: number, b: number): { h: number, s: number, l: number } => {
      r /= 255;
      g /= 255;
      b /= 255;
      
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h = 0, s = 0
      const l = (max + min) / 2;
      
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else if (max === b) h = (r - g) / d + 4;
        
        h /= 6;
      }
      
      return { h: h * 360, s: s * 100, l: l * 100 };
    };
    
    // HSL to hex
    const hslToHex = (h: number, s: number, l: number): string => {
      l /= 100;
      const a = s * Math.min(l, 1 - l) / 100;
      
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
      };
      
      return `#${f(0)}${f(8)}${f(4)}`;
    };
    
    // Convert base color to HSL
    const rgb = hexToRgb(baseColor);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    
    // Adjust hue based on source index
    // Spread the colors evenly across the hue spectrum based on source count
    const hueShift = (sourceIndex * (360 / (totalSources * 2))) % 360; 
    const newHue = (hsl.h + hueShift) % 360;
    
    // Keep saturation high for distinction, adjust lightness slightly
    const newSat = Math.min(hsl.s + 10, 100);  
    const newLight = Math.max(Math.min(hsl.l + (sourceIndex % 2 === 0 ? 10 : -10), 70), 30);
    
    return hslToHex(newHue, newSat, newLight);
  };

  // Modify the chart rendering function
  const renderTimeSeriesChart = () => {
    return (
      <ComposedChart
        data={displayData as ChartData}
        margin={{ top: 5, right: 30, left: 20, bottom: 25 }}
        onClick={handleClick}
      >
        <XAxis dataKey="dateString" angle={-15} textAnchor="end" height={50} interval="preserveStartEnd" />
        <YAxis
          domain={[0, (dataMax: number) => Math.max(dataMax || 0, 10)]}
          allowDataOverflow={true}
          width={60}
        />
        <Tooltip
          active={(isChartHovered || isTooltipHovered) && hoveredLegendKey === null}
          cursor={{ fill: 'transparent' }}
          wrapperStyle={{ zIndex: 100, pointerEvents: 'auto' }}
          position={{ y: -20 }}
          allowEscapeViewBox={{ x: false, y: true }}
          content={
            <CustomTooltip
              isGrouped={isGrouped}
              schemes={schemes}
              dataSources={dataSources}
              results={results}
              showStatistics={showStatistics && !aggregateSources}
              dataRecordsMap={dataRecordsMap}
              setIsTooltipHovered={setIsTooltipHovered}
              selectedDataSourceIds={selectedDataSourceIds}
              aggregateSources={aggregateSources}
              selectedPlotKeys={selectedPlotKeys}
            />
          }
          isAnimationActive={false}
        />
        <Legend
          onMouseEnter={(e: any) => setHoveredLegendKey(e.value)} // Use e.value which is the legend item's name
          onMouseLeave={() => setHoveredLegendKey(null)}
        />
        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(128, 128, 128, 0.3)" />

        {/* Render Lines/Areas with better source and scheme distinction */}
        {plottableFieldKeys
          .filter(fieldInfo => selectedPlotKeys.includes(fieldInfo.key))
          .flatMap((fieldInfo) => {
            const { key: schemeFieldKey, name: baseLegendName, color: baseColor } = fieldInfo;

            if (aggregateSources) {
              const targetKeyAgg = '_aggregated_'; // Define targetKey for aggregate case
              const seriesNameInLegend = `${baseLegendName} (all sources)`;
              const isCurrentlyHovered = hoveredLegendKey === seriesNameInLegend;
              const seriesOpacityAgg = hoveredLegendKey && !isCurrentlyHovered ? 0.2 : 1;

              const hasSeriesDataAgg = (displayData as ChartDataPoint[]).some(p => p && p[schemeFieldKey]?.[targetKeyAgg]?.avg !== undefined && !isNaN(Number(p[schemeFieldKey]?.[targetKeyAgg]?.avg)));
              if (!hasSeriesDataAgg) return null;
              
              return (
                <Line 
                  key={`${schemeFieldKey}-agg`} 
                  dataKey={(p: ChartDataPoint) => p ? p[schemeFieldKey]?.[targetKeyAgg]?.avg ?? null : null} 
                  name={seriesNameInLegend} // This name is used by the legend
                  stroke={baseColor} 
                  strokeWidth={2} 
                  strokeOpacity={seriesOpacityAgg}
                  dot={renderDot} 
                  activeDot={{ r: 6 }} 
                  isAnimationActive={false} 
                  connectNulls={true} 
                />
              );
            } else {
              // Enhanced visual distinction for source-specific series
              return selectedDataSourceIds.map((dsId, sourceIndex) => {
                const targetKeyDs = dsId; // Define targetKey for per-dataSource case
                const sourceName = dataSourceNameMap.get(dsId) || `Source ${dsId}`;
                const seriesNameInLegend = `${sourceName} (${schemeFieldKey.replace('_', ': ')})`;

                const isCurrentlyHovered = hoveredLegendKey === seriesNameInLegend;
                const seriesOpacityDs = hoveredLegendKey && !isCurrentlyHovered ? 0.2 : 1;
                const areaFillOpacity = hoveredLegendKey && !isCurrentlyHovered ? 0.02 : 0.08;

                const hasSeriesDataDs = (displayData as ChartDataPoint[]).some(p => p && p[schemeFieldKey]?.[targetKeyDs]?.avg !== undefined && !isNaN(Number(p[schemeFieldKey]?.[targetKeyDs]?.avg)));
                if (!hasSeriesDataDs) return null;
                
                const sourceColorShade = generateSourceColor(baseColor, sourceIndex, selectedDataSourceIds.length);
                const strokeWidth = 2; 
                
                if (showStatistics) {
                  const hasStats = (displayData as ChartDataPoint[]).some(p => { 
                    if (!p) return false;
                    const sd = p[schemeFieldKey]?.[targetKeyDs]; 
                    return sd && typeof sd.min === 'number' && typeof sd.max === 'number' && typeof sd.avg === 'number'; 
                  });
                  
                  if (hasStats) {
                    return (
                      <React.Fragment key={`stats-${schemeFieldKey}-${dsId}`}>
                        <Area 
                          type="monotone" 
                          dataKey={(p: ChartDataPoint) => p ? p[schemeFieldKey]?.[targetKeyDs]?.min ?? null : null} 
                          stroke="none" 
                          fillOpacity={0} // Min area is not directly filled, max area creates the fill range
                          name={`${seriesNameInLegend} (min)`} // Name for tooltip, not legend item itself
                          isAnimationActive={false} 
                          legendType="none" 
                          connectNulls={true} 
                        />
                        <Area 
                          type="monotone" 
                          dataKey={(p: ChartDataPoint) => p ? p[schemeFieldKey]?.[targetKeyDs]?.max ?? null : null} 
                          stroke="none" 
                          fillOpacity={areaFillOpacity} // Use calculated opacity
                          fill={sourceColorShade} 
                          name={`${seriesNameInLegend} (range)`} // Name for tooltip
                          isAnimationActive={false} 
                          legendType="none" 
                          connectNulls={true} 
                        />
                        <Line 
                          type="monotone" 
                          dataKey={(p: ChartDataPoint) => p ? p[schemeFieldKey]?.[targetKeyDs]?.avg ?? null : null} 
                          stroke={sourceColorShade} 
                          strokeOpacity={seriesOpacityDs} // Use calculated opacity
                          strokeWidth={strokeWidth} 
                          dot={false} 
                          name={seriesNameInLegend} // This name is used by the legend
                          isAnimationActive={false} 
                          connectNulls={true} 
                          id={`line-${schemeFieldKey}-${dsId}`} // Keep id if used elsewhere
                        />
                      </React.Fragment>
                    );
                  }
                }
                
                return (
                  <Line 
                    key={`line-${schemeFieldKey}-${dsId}`} 
                    dataKey={(p: ChartDataPoint) => p ? p[schemeFieldKey]?.[targetKeyDs]?.avg ?? null : null} 
                    name={seriesNameInLegend} // This name is used by the legend
                    stroke={sourceColorShade} 
                    strokeOpacity={seriesOpacityDs} // Use calculated opacity
                    strokeWidth={strokeWidth} 
                    dot={renderDot} 
                    activeDot={{ r: 6 }} 
                    isAnimationActive={false} 
                    connectNulls={true}
                    id={`line-${schemeFieldKey}-${dsId}`} // Keep id
                  />
                );
              }).filter(Boolean);
            }
          })
        }

        {/* ReferenceDot for selected point */}
        {!isGrouped && selectedPoint && 'dateString' in selectedPoint && (
          <ReferenceDot x={selectedPoint.dateString} y={0} ifOverflow="extendDomain" r={5} fill="red" stroke="white" isFront={true} />
        )}
      </ComposedChart>
    );
  };

  return (
    <div>
      {/* Inject the style */}
      <style>{tooltipStyle}</style> 

      {/* --- Chart Controls --- */}
      <div className="flex flex-wrap items-center gap-4 mb-4 p-3 rounded-md border">
        {/* Group Toggle */}
        <div className="flex items-center gap-2">
          <Switch
            checked={isGrouped}
            onCheckedChange={setIsGrouped}
            id="group-switch"
          />
          <label htmlFor="group-switch">Group by value</label>
        </div>

        {/* Aggregate Sources Toggle */}
        <div className="flex items-center gap-2">
          <Switch
            checked={aggregateSources}
            onCheckedChange={setAggregateSources}
            id="aggregate-switch"
            disabled={selectedDataSourceIds.length <= 1}
          />
          <UiLabel
            htmlFor="aggregate-switch"
            className={cn("cursor-pointer", selectedDataSourceIds.length <= 1 && "text-muted-foreground cursor-not-allowed")}
          >
            Aggregate sources
          </UiLabel>
        </div>

        {/* Statistics Toggle (only when not grouped AND not aggregated) */}
        {!isGrouped && !aggregateSources && (
          <div className="flex items-center gap-2">
            <Switch checked={showStatistics} onCheckedChange={setShowStatistics} id="stats-switch" />
            <UiLabel htmlFor="stats-switch" className="cursor-pointer">Show statistics (min/avg/max)</UiLabel>
          </div>
        )}

        {/* Date Range Picker (only for time series) */}
        {!isGrouped && dateExtents.min && dateExtents.max && (
          <div className="flex items-center gap-2 ml-auto">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "justify-start text-left font-normal",
                    !dateRangeFrom && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRangeFrom ? (
                    dateRangeTo ? (
                      <>
                        {formatDate(dateRangeFrom, "LLL dd, y")} -{" "}
                        {formatDate(dateRangeTo, "LLL dd, y")}
                      </>
                    ) : (
                      formatDate(dateRangeFrom, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRangeFrom || undefined}
                  selected={{
                    from: dateRangeFrom || undefined,
                    to: dateRangeTo || undefined
                  }}
                  onSelect={(range) => {
                    if (range?.from) setDateRangeFrom(range.from);
                    else setDateRangeFrom(null);
                    
                    if (range?.to) setDateRangeTo(range.to);
                    else setDateRangeTo(null);
                  }}
                  numberOfMonths={2}
                />
                <div className="flex justify-end gap-2 p-3 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Reset to full date range
                      if (dateExtents.min && dateExtents.max) {
                        setDateRangeFrom(dateExtents.min);
                        setDateRangeTo(dateExtents.max);
                      }
                    }}
                  >
                    Reset
                  </Button>
                  <Button 
                    size="sm"
                    onClick={() => {
                      // Find overlapping time periods between sources
                      // This is a simplified version - would need more complex logic for real overlap detection
                      setDateRangeFrom(dateExtents.min);
                      setDateRangeTo(dateExtents.max);
                    }}
                  >
                    Show All
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Plot Configuration Popover */}
        {!isGrouped && schemes.length > 0 && ( 
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs">
                <Settings2 className="h-3.5 w-3.5" />
                Configure Plotted Data ({aggregateSources ? selectedPlotKeys.length : selectedPlotKeys.length * selectedDataSourceIds.length} series)
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <div className="p-2 font-semibold text-sm border-b">Configure Plotted Data</div>
              <ScrollArea className="max-h-[400px]">
                <div className="p-3 space-y-3">
                  {schemes.map((scheme) => {
                    const schemeIsSelected = selectedSchemaIds.includes(scheme.id);
                    const fieldsInScheme = scheme.fields.filter(f => f.type === 'int');
                    const plottableKeysInScheme = fieldsInScheme.map(f => `${scheme.name}_${f.name}`);
                    const allFieldsInSchemeSelected = plottableKeysInScheme.every(key => selectedPlotKeys.includes(key));
                    const someFieldsInSchemeSelected = plottableKeysInScheme.some(key => selectedPlotKeys.includes(key));

                    if (fieldsInScheme.length === 0) return null; // Don't show schemes with no int fields

                    return (
                      <div key={scheme.id} className="border rounded-md p-2 space-y-1.5 bg-muted/30">
                        {/* Scheme Toggle Header */}
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`scheme-toggle-${scheme.id}`}
                            checked={schemeIsSelected && someFieldsInSchemeSelected}
                            onCheckedChange={(checked) => {
                              const currentSchemeKeys = scheme.fields
                                .filter(f => f.type === 'int')
                                .map(f => `${scheme.name}_${f.name}`);
                              
                              let newSelectedPlotKeys = [...selectedPlotKeys];
                              let newSelectedSchemeIds = [...selectedSchemaIds];

                              if (checked) {
                                // Add all keys for this scheme & ensure scheme ID is selected
                                newSelectedPlotKeys = [...new Set([...newSelectedPlotKeys, ...currentSchemeKeys])];
                                newSelectedSchemeIds = [...new Set([...newSelectedSchemeIds, scheme.id])];
                              } else {
                                // Remove all keys for this scheme & potentially remove scheme ID
                                newSelectedPlotKeys = newSelectedPlotKeys.filter(key => !currentSchemeKeys.includes(key));
                                // Ensure at least one key remains globally selected if possible
                                const totalAvailableKeys = plottableFieldKeys.map(k => k.key);
                                if (newSelectedPlotKeys.length === 0 && totalAvailableKeys.length > 0) {
                                    // Find the first key not in the scheme being deselected
                                    const fallbackKey = totalAvailableKeys.find(k => !currentSchemeKeys.includes(k));
                                    if(fallbackKey) newSelectedPlotKeys = [fallbackKey];
                                    // If no other keys exist, keep the first key of the current scheme
                                    else if (currentSchemeKeys.length > 0) newSelectedPlotKeys = [currentSchemeKeys[0]];
                                }
                                
                                // Update scheme selection based on remaining plot keys
                                const remainingSchemeIds = new Set(newSelectedPlotKeys.map(k => k.split('_')[0])); 
                                newSelectedSchemeIds = schemes.filter(s => remainingSchemeIds.has(s.name)).map(s => s.id);
                              }
                              setSelectedPlotKeys(newSelectedPlotKeys);
                              setSelectedSchemaIds(newSelectedSchemeIds);
                            }}
                          />
                          <UiLabel htmlFor={`scheme-toggle-${scheme.id}`} className="text-sm font-medium flex-1 truncate cursor-pointer">
                            {scheme.name}
                          </UiLabel>
                        </div>

                        {/* Field Toggles within Scheme */}
                        <div className="pl-6 space-y-1">
                          {fieldsInScheme.map((field) => {
                            const fieldKey = `${scheme.name}_${field.name}`;
                            const fieldInfo = plottableFieldKeys.find(k => k.key === fieldKey);
                            const isSelected = selectedPlotKeys.includes(fieldKey);
                            return (
                              <div key={fieldKey} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`plot-key-toggle-${fieldKey}`}
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                      let newSelection = [...selectedPlotKeys];
                                      if (checked && !isSelected) {
                                          newSelection.push(fieldKey);
                                      } else if (!checked && isSelected) {
                                          // Prevent deselecting the last one globally
                                          if (selectedPlotKeys.length > 1) {
                                              newSelection = newSelection.filter(k => k !== fieldKey);
                                          }
                                      }
                                      setSelectedPlotKeys(newSelection);
                                      // Also ensure parent scheme is selected if any field is
                                      if (checked && !selectedSchemaIds.includes(scheme.id)) {
                                          setSelectedSchemaIds([...selectedSchemaIds, scheme.id]);
                                      }
                                  }}
                                  disabled={selectedPlotKeys.length === 1 && isSelected}
                                />
                                <UiLabel
                                  htmlFor={`plot-key-toggle-${fieldKey}`}
                                  className="text-xs font-normal flex-1 truncate cursor-pointer"
                                  title={field.name}
                                >
                                  {field.name}
                                </UiLabel>
                                
                                {/* Color Selector */}
                                {fieldInfo && (
                                  <div className="flex items-center space-x-1">
                                    <input
                                      type="color"
                                      value={fieldInfo.color}
                                      className="h-5 w-5 cursor-pointer rounded border-0"
                                      title="Change series color"
                                      onChange={(e) => {
                                        setCustomSeriesColors(prev => ({
                                          ...prev,
                                          [fieldKey]: e.target.value
                                        }));
                                      }}
                                    />
                                    <div 
                                      className="h-3 w-3 rounded-full shrink-0" 
                                      style={{ backgroundColor: fieldInfo.color }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        )}

        {/* Grouping Scheme Selector (when grouping) */}
        {isGrouped && (
          <div className="flex items-center gap-2">
            <UiLabel htmlFor="group-scheme-select" className="text-sm">Scheme:</UiLabel>
            <Select
              value={groupingSchemeId?.toString() ?? ''}
              onValueChange={(value) => setGroupingSchemeId(value ? parseInt(value) : null)}
              disabled={!isGrouped}
            >
              <SelectTrigger id="group-scheme-select" className="w-[200px]">
                <SelectValue placeholder="Select scheme to group by" />
              </SelectTrigger>
              <SelectContent>
                {schemes.map(scheme => (
                  <SelectItem key={scheme.id} value={scheme.id.toString()}>
                    {scheme.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Field/Key Selector (only show when grouping AND multiple keys exist) */}
        {isGrouped && groupingSchemeId !== null && currentGroupingKeys.length > 1 && (
           <div className="flex items-center gap-2">
               <UiLabel htmlFor="group-key-select" className="text-sm">Field/Key:</UiLabel>
               <Select
                 value={groupingFieldKey ?? ''}
                 onValueChange={(value) => setGroupingFieldKey(value || null)}
                 disabled={!isGrouped || groupingSchemeId === null}
               >
                 <SelectTrigger id="group-key-select" className="w-[180px]">
                   <SelectValue placeholder="Select field/key" />
                 </SelectTrigger>
                 <SelectContent>
                   {currentGroupingKeys.map(tk => (
                     <SelectItem key={tk.key} value={tk.key}>
                       {tk.name} ({tk.type})
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
            </div>
        )}
        {/* Show single field name if only one option */}
        {isGrouped && groupingSchemeId !== null && currentGroupingKeys.length === 1 && (
            <div className="flex items-center gap-2">
                <UiLabel className="text-sm">Field/Key:</UiLabel>
                <span className="text-sm px-3 py-1.5 bg-muted rounded">{currentGroupingKeys[0].name}</span>
            </div>
        )}

        {/* --- MOVE Grouped Sort Toggle Here --- */}
        {isGrouped && groupedData.length > 0 && (
           <div className="flex items-center gap-2 ml-auto"> {/* Use ml-auto to push right if needed */}
               <UiLabel className="text-xs text-muted-foreground mr-1">Sort by:</UiLabel>
               <ToggleGroup
                   type="single"
                   size="sm"
                   variant="outline"
                   value={groupedSortOrder}
                   onValueChange={(value: GroupedSortOrder) => {
                       if (value) setGroupedSortOrder(value);
                   }}
                   className="gap-0.5"
                   // Disable value sort if data isn't integer-like
                   disabled={!isGroupedDataInteger && (groupedSortOrder === 'value-asc' || groupedSortOrder === 'value-desc')}
               >
                   <ToggleGroupItem value="count-desc" aria-label="Sort by count descending" title="Sort by Count (Highest First)">
                       <ArrowDownUp className="h-3.5 w-3.5 mr-1" /> Count
                   </ToggleGroupItem>
                   <ToggleGroupItem
                       value="value-asc"
                       aria-label="Sort by value ascending"
                       title="Sort by Value (Ascending)"
                       disabled={!isGroupedDataInteger} // Explicitly disable if not integer
                   >
                       <SortAsc className="h-3.5 w-3.5 mr-1" /> Value
                   </ToggleGroupItem>
                   <ToggleGroupItem
                       value="value-desc"
                       aria-label="Sort by value descending"
                       title="Sort by Value (Descending)"
                       disabled={!isGroupedDataInteger} // Explicitly disable if not integer
                   >
                       <SortDesc className="h-3.5 w-3.5 mr-1" /> Value
                   </ToggleGroupItem>
               </ToggleGroup>
           </div>
        )}
        {/* --- End Grouped Sort Toggle --- */}
      </div>

      {/* --- Chart Area --- */}
      {(selectedDataSourceIds.length === 0 || (results.length > 0 && sourceFilteredResults.length === 0) || (isGrouped && groupedData.length === 0)) ? (
        <div className="flex flex-col items-center justify-center h-[400px] p-8 text-center border border-dashed rounded-lg">
          <Info className="h-10 w-10 text-muted-foreground mb-2" />
           {selectedDataSourceIds.length === 0 ? (
               <p className="text-muted-foreground">Please select at least one data source.</p>
           ) : (results.length > 0 && sourceFilteredResults.length === 0) ? (
                <p className="text-muted-foreground">No results match the current filters for the selected sources.</p>
           ) : (
               <>
                 <p className="text-muted-foreground">No data to display for the current selection.</p>
                 {isGrouped && <p className="text-xs text-muted-foreground">(Try adjusting filters or selecting a different scheme/field)</p>}
               </>
           )}
        </div>
      ) : (
        <div
          ref={chartContainerRef}
          style={{ width: '100%', height: isGrouped ? 'auto' : 400 }}
          onMouseEnter={handleChartMouseEnter}
          onMouseLeave={handleChartMouseLeave}
          className="border rounded-lg p-3"
        >
          <ResponsiveContainer width="100%" height={isGrouped ? undefined : 400}>
            {isGrouped ? (
               aggregateSources ? (
                 // --- Render SINGLE Aggregated Bar Chart ---
                 <Card key="chart-aggregated">
                    <CardHeader>
                      <CardTitle className="text-base">Aggregated Results</CardTitle>
                      <p className="text-xs text-muted-foreground">Grouped by: {groupedData[0]?.schemeName} - {groupingFieldKey ?? 'N/A'}</p>
                      {/* Sorting controls are now outside */}
                    </CardHeader>
                    <CardContent>
                      <div style={{ width: '100%', height: 300 }}> {/* Fixed height for aggregated chart */}
                        <ResponsiveContainer>
                           <ComposedChart
                                data={displayData as GroupedDataPoint[]} // Use the potentially sorted groupedData
                                margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                                onClick={(e) => handleClick(e)} // Click passes aggregated data
                           >
                               <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(128, 128, 128, 0.3)" />
                               <XAxis dataKey="valueString" fontSize={10} interval="preserveStartEnd"/>
                               <YAxis fontSize={10} domain={[0, maxGroupCount]} allowDataOverflow={true}/>
                               <Tooltip
                                   active={(isChartHovered || isTooltipHovered) && hoveredLegendKey === null}
                                   cursor={{ fill: 'transparent' }}
                                   wrapperStyle={{ zIndex: 100, pointerEvents: 'auto' }}
                                   position={{ y: -20 }}
                                   allowEscapeViewBox={{ x: true, y: true }}
                                   // Pass necessary info for the AGGREGATED tooltip
                                   content={<CustomTooltip 
                                      isGrouped={true} 
                                      schemes={schemes} 
                                      dataSources={dataSources} 
                                      results={results} 
                                      showStatistics={false} 
                                      dataRecordsMap={dataRecordsMap} 
                                      // For aggregated chart, use global setIsTooltipHovered
                                      setIsTooltipHovered={setIsTooltipHovered} 
                                      selectedDataSourceIds={selectedDataSourceIds} 
                                      aggregateSources={true} 
                                      selectedPlotKeys={selectedPlotKeys} 
                                    />} 
                                   isAnimationActive={false}
                               />
                               <Legend 
                                 onMouseEnter={(e: any) => setHoveredLegendKey(e.value)} // Use e.value
                                 onMouseLeave={() => setHoveredLegendKey(null)}
                               />
                               <Bar 
                                dataKey="totalCount" 
                                fill={colorPalette[0]} 
                                isAnimationActive={false} 
                                barSize={20} 
                                opacity={hoveredLegendKey && hoveredLegendKey !== "totalCount" ? 0.2 : 1}
                               />
                           </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                 </Card>
               ) : (
                 // --- Render Sub-Charts per Source (existing logic) ---
                 <div className="space-y-6">
                   {selectedDataSourceIds.length > 0 ? (
                     selectedDataSourceIds.map((dsId, index) => {
                       const sourceName = dataSourceNameMap.get(dsId) || `Source ${dsId}`;
                       const barDataKey = `ds_${dsId}_count`;
                       const barColor = colorPalette[index % colorPalette.length];

                       const sourceSpecificDataUnsorted = (displayData as GroupedDataPoint[]).filter(point => (point[barDataKey] ?? 0) > 0);

                       // --- NEW: Sort data specifically for this sub-chart ---
                       const sortedSourceSpecificData = [...sourceSpecificDataUnsorted].sort((a, b) => {
                        const countA = a[barDataKey] || 0;
                        const countB = b[barDataKey] || 0;

                        if (groupedSortOrder === 'value-asc' || groupedSortOrder === 'value-desc') {
                            if (isGroupedDataInteger) {
                                const valA = parseInt(a.valueString, 10);
                                const valB = parseInt(b.valueString, 10);
                                const multiplier = groupedSortOrder === 'value-asc' ? 1 : -1;
                                if (isNaN(valA) && isNaN(valB)) return 0;
                                if (isNaN(valA)) return 1 * multiplier;
                                if (isNaN(valB)) return -1 * multiplier;
                                return (valA - valB) * multiplier;
                            } else {
                                const multiplier = groupedSortOrder === 'value-asc' ? 1 : -1;
                                return a.valueString.localeCompare(b.valueString) * multiplier;
                            }
                        } else { // count-desc (default)
                            return countB - countA;
                        }
                       });
                       // --- END NEW --- 

                       if (sortedSourceSpecificData.length === 0) {
                            return (
                                <Card key={`chart-ds-${dsId}`} className="opacity-50">
                                    <CardHeader><CardTitle className="text-sm font-medium">Source: {sourceName}</CardTitle></CardHeader>
                                    <CardContent><p className="text-xs text-muted-foreground italic text-center py-4">No data for this source.</p></CardContent>
                                </Card>
                            )
                       }

                       const subChartMaxY = Math.max(...sortedSourceSpecificData.map(p => p[barDataKey] || 0), 0);
                       const yDomainMax = subChartMaxY > 0 ? subChartMaxY + Math.ceil(subChartMaxY * 0.1) : 10;

                       return (
                         <Card 
                           key={`chart-ds-${dsId}`}
                           onMouseEnter={() => handleSubChartCardEnter(dsId)}
                           onMouseLeave={() => handleSubChartCardLeave(dsId)}
                         >
                           <CardHeader>
                             <CardTitle className="text-base">{sourceName}</CardTitle>
                             <p className="text-xs text-muted-foreground">Grouped by: {groupedData[0]?.schemeName} - {groupingFieldKey ?? 'N/A'}</p>
                              {/* --- Sorting Controls REMOVED from here --- */}
                           </CardHeader>
                           <CardContent>
                             <div style={{ width: '100%', height: 250 }}>
                               <ResponsiveContainer>
                                 <ComposedChart
                                   data={sortedSourceSpecificData}
                                   margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                                   onClick={(e) => handleClick(e, dsId)}
                                 >
                                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128, 128, 128, 0.3)" />
                                   <XAxis dataKey="valueString" fontSize={10} interval="preserveStartEnd"/>
                                   <YAxis fontSize={10} domain={[0, yDomainMax]} allowDataOverflow={true}/>
                                   <Tooltip
                                     active={(hoveredSubChartId === dsId || hoveredSubChartTooltipOwnerId === dsId) && hoveredLegendKey === null}
                                     cursor={{ fill: 'transparent' }}
                                     wrapperStyle={{ zIndex: 100, pointerEvents: 'auto' }}
                                     position={{ y: -20 }}
                                     allowEscapeViewBox={{ x: true, y: true }}
                                     content={<CustomTooltip 
                                        isGrouped={true} 
                                        schemes={schemes} 
                                        dataSources={dataSources} 
                                        results={results} 
                                        showStatistics={false} 
                                        dataRecordsMap={dataRecordsMap} 
                                        highlightedSourceId={dsId} 
                                        // For sub-charts, use specific handlers
                                        onOwnMouseEnter={() => handleSubChartTooltipEnter(dsId)} 
                                        onOwnMouseLeave={() => handleSubChartTooltipLeave(dsId)} 
                                        selectedDataSourceIds={selectedDataSourceIds} 
                                        aggregateSources={false} 
                                        selectedPlotKeys={selectedPlotKeys} 
                                      />} 
                                     isAnimationActive={false}
                                 />
                                 <Legend 
                                   onMouseEnter={(e: any) => setHoveredLegendKey(e.value)} // Use e.value
                                   onMouseLeave={() => setHoveredLegendKey(null)}
                                 />
                                 <Bar 
                                  dataKey={barDataKey} 
                                  fill={barColor} 
                                  isAnimationActive={false} 
                                  barSize={20} 
                                  opacity={hoveredLegendKey && hoveredLegendKey !== barDataKey ? 0.2 : 1}
                                 />
                               </ComposedChart>
                             </ResponsiveContainer>
                           </div>
                         </CardContent>
                       </Card>
                     );
                   })
                   ) : (
                     <div className="text-center text-muted-foreground italic py-10">Please select source(s).</div>
                   )}
                 </div>
               )
            ) : (
              // --- Time Series Chart with improved rendering ---
              renderTimeSeriesChart()
            )}
          </ResponsiveContainer>

          {/* Date range info text */}
          {!isGrouped && dateRangeFrom && dateRangeTo && 
            dateRangeFrom.getTime() !== dateExtents.min?.getTime() && 
            dateRangeTo.getTime() !== dateExtents.max?.getTime() && (
              <div className="mt-2 flex justify-center text-xs text-muted-foreground">
                <p>
                  Showing data from {formatDate(dateRangeFrom, "LLL dd, y")} to {formatDate(dateRangeTo, "LLL dd, y")}
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="h-auto p-0 ml-2"
                    onClick={() => {
                      if (dateExtents.min && dateExtents.max) {
                        setDateRangeFrom(dateExtents.min);
                        setDateRangeTo(dateExtents.max);
                       }
                    }}
                  >
                    Reset
                  </Button>
                </p>
              </div>
            )}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Classification Details
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh]">
            {selectedPoint ? (
              <div className="p-4">
                <DocumentResults
                  selectedPoint={selectedPoint}
                  results={results} // Pass all results
                  schemes={schemes}
                  dataSources={dataSources}
                  dataRecords={dataRecords}
                  onDataRecordSelect={onDataRecordSelect}
                  // Pass aggregation state if needed by DocumentResults, but it shouldn't need it
                  // aggregateSources={aggregateSources}
                />
              </div>
            ) : (
              <div className="p-4 text-center text-muted-foreground">
                Select a point on the chart to see details.
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface CustomTooltipProps extends TooltipProps<number, string> {
  isGrouped: boolean;
  schemes: ClassificationSchemeRead[];
  dataSources?: DataSourceRead[];
  results: FormattedClassificationResult[];
  showStatistics?: boolean; // Keep for time series
  dataRecordsMap?: Map<number, DataRecordRead>;
  setIsTooltipHovered?: (isHovered: boolean) => void; // For general charts
  onOwnMouseEnter?: () => void; // For specific hover control e.g. subcharts
  onOwnMouseLeave?: () => void; // For specific hover control e.g. subcharts
  highlightedSourceId?: number; // For grouped chart sub-charts
  selectedDataSourceIds: number[]; // <-- ADD THIS PROP
  aggregateSources: boolean; // <-- ADD PROP
  selectedPlotKeys: string[]; // <-- ADD PROP for selected series keys
}

// Add this interface to define the stats object structure
interface StatsData {
  count?: number;
  sum?: number;
  min?: number;
  max?: number;
  avg?: number;
  categories?: Record<string, number>;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
  isGrouped,
  schemes,
  dataSources,
  results,
  showStatistics,
  dataRecordsMap,
  setIsTooltipHovered,
  highlightedSourceId,
  selectedDataSourceIds,
  aggregateSources,
  selectedPlotKeys,
  onOwnMouseEnter, // <-- Destructure new prop
  onOwnMouseLeave  // <-- Destructure new prop
}) => {

  // --- Create dataSourceNameMap at the top level --- 
  const dataSourceNameMap = useMemo(() => dataSources ? new Map(dataSources.map(ds => [ds.id, ds.name || `Source ${ds.id}`])) : new Map<number, string>(), [dataSources]);
  
  React.useEffect(() => {
    // Return a cleanup function
    return () => {
      // This runs when the component unmounts or before the effect runs again.
      // If the tooltip becomes inactive (due to `active` prop becoming false),
      // this cleanup ensures the hover state in the parent is reset.
      // setIsTooltipHovered(false); // Consider if this is needed or if parent handles it well
    };
  }, []);

  // The 'active' prop now reflects (isChartHovered || isTooltipHovered) from parent
  // If it's false, it means mouse is neither on chart nor on tooltip -> hide.
  if (!active || !payload || !payload.length) {
    return null;
  }

  const dataPoint = payload[0]?.payload as ChartDataPoint | GroupedDataPoint | undefined;
  if (!dataPoint) return null;

  // --- Get relevant doc IDs and counts --- 
  let relevantDocIds: number[] = [];
  let totalRecordCount = 0; // Total docs involved in the point (all sources)
  let sourceSpecificRecordCount = 0; // Docs for the specific source (non-agg) or total (agg)

  if (isGrouped && 'sourceDocuments' in dataPoint && dataPoint.sourceDocuments instanceof Map) {
    relevantDocIds = Array.from(dataPoint.sourceDocuments.values()).flat(); // All docs for the group
    totalRecordCount = relevantDocIds.length;
    if (aggregateSources) { // Aggregated Bar
      sourceSpecificRecordCount = dataPoint.totalCount; // Use totalCount for aggregated bar
    } else if (highlightedSourceId !== undefined) { // Non-aggregated Bar (sub-chart)
      sourceSpecificRecordCount = dataPoint[`ds_${highlightedSourceId}_count`] || 0; 
      // Keep relevantDocIds specific to the source for potential filtering later if needed
      relevantDocIds = dataPoint.sourceDocuments.get(highlightedSourceId) || [];
    }
  } else if (!isGrouped && 'documents' in dataPoint) { // Time Series
    relevantDocIds = dataPoint.documents;
    totalRecordCount = relevantDocIds.length; // For time-series, total count in the interval
    sourceSpecificRecordCount = totalRecordCount; // Display the interval total
  }
  // --- End Get relevant doc IDs --- 

  const dataRecordsToShow = relevantDocIds
    .map(id => dataRecordsMap?.get(id))
    .filter((rec): rec is DataRecordRead => !!rec);

  const isChartDataPoint = (point: any): point is ChartDataPoint => {
    return point && typeof point === 'object' && 'dateString' in point;
  };

  return (
    <div
      className={cn("max-h-72 overflow-y-auto bg-card/95 p-3 border border-border rounded-lg shadow-lg max-w-md overscroll-behavior-contain pointer-events-auto")} 
      style={{ zIndex: 101 }}
      onMouseEnter={() => {
        if (onOwnMouseEnter) onOwnMouseEnter();
        else if (setIsTooltipHovered) setIsTooltipHovered(true);
      }}
      onMouseLeave={() => {
        if (onOwnMouseLeave) onOwnMouseLeave();
        else if (setIsTooltipHovered) setIsTooltipHovered(false);
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* --- Header --- */}
      <div className="mb-3 pb-2 border-b border-border">
        <p className="text-sm font-semibold text-foreground">
          {isGrouped && 'valueString' in dataPoint 
            ? `${dataPoint.schemeName}: ${dataPoint.valueString}`
            : `Date: ${label}`}
        </p>
        {/* Show Source or "Aggregated" only when relevant */}
        {(isGrouped || (!isGrouped && !aggregateSources && selectedDataSourceIds.length > 1)) && (
          <p className="text-xs font-medium text-muted-foreground">
            {isGrouped 
              ? `Source: ${aggregateSources ? 'Aggregated' : (highlightedSourceId !== undefined ? (dataSourceNameMap.get(highlightedSourceId) ?? `ID ${highlightedSourceId}`) : 'Unknown')}`
              : aggregateSources ? '' : '' /* Don't show source line for aggregated time series */
            }
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
           {/* Display the calculated sourceSpecificRecordCount */}
          {sourceSpecificRecordCount} record{sourceSpecificRecordCount !== 1 ? 's' : ''} involved
        </p>
      </div>

      <div className="space-y-3">
        {/* --- Grouped Bar Chart Details --- */}
        {isGrouped && 'totalCount' in dataPoint && (
           <div className="pb-2 border-b border-border last:border-b-0">
              {/* Display the correct count based on aggregation state */}
              <p className="text-sm font-medium mb-1">{aggregateSources ? 'Total Count (Aggregated):' : 'Count for this source:'}</p>
              <p className="text-2xl font-bold">{sourceSpecificRecordCount}</p>
              {/* Optionally show total across selected sources even for non-aggregated? Maybe not. */}
              {/* { !aggregateSources && <p className="text-xs text-muted-foreground">Total for group: {dataPoint.totalCount}</p> } */}
           </div>
        )}

        {/* --- Time Series Statistics/Values Section --- */}
        {!isGrouped && isChartDataPoint(dataPoint) && payload && payload.length > 0 && (
          <div className="pb-2 border-b border-border last:border-b-0">
            <p className="text-sm font-medium mb-2">
              {aggregateSources ? "Aggregated Statistics:" : (showStatistics ? "Statistics:" : "Values:")}
            </p>
            <div className="space-y-2">
              {Object.entries(dataPoint)
                // Find scheme_field keys (like 'SchemeA_FieldB') that have appropriate data
                .filter(([key, targetMap]) => 
                  key.includes('_') && 
                  typeof targetMap === 'object' && 
                  targetMap !== null && 
                  // Handle both aggregated and non-aggregated cases
                  (aggregateSources 
                    ? '_aggregated_' in targetMap 
                    : Object.keys(targetMap).some(dsId => selectedDataSourceIds.includes(parseInt(dsId))))
                )
                .map(([schemeFieldKey, targetMap]) => {
                  const [schemeName, fieldName] = schemeFieldKey.split('_');
                  if (!schemeName || !fieldName) return null;
                  
                  if (aggregateSources) {
                    // --- AGGREGATED display --- 
                    const targetData = targetMap['_aggregated_'] as StatsData; 
                    if (!targetData || targetData.avg === undefined || targetData.avg === null || isNaN(Number(targetData.avg))) {
                      return null;
                    }
                    
                    const { min, max, avg, count } = targetData;
                    
                    // Format values for display with 1 decimal place
                    const minFormatted = (min !== null && min !== undefined && !isNaN(min)) 
                      ? Number(min).toFixed(1) 
                      : 'N/A';
                    const avgFormatted = Number(avg).toFixed(1);
                    const maxFormatted = (max !== null && max !== undefined && !isNaN(max)) 
                      ? Number(max).toFixed(1) 
                      : 'N/A';
                    
                    return (
                      <div key={`${schemeFieldKey}-agg`} className="px-2 py-1.5 bg-muted/30 rounded-sm">
                        <p className="text-sm font-medium mb-1 truncate" title={`${schemeName}: ${fieldName} (Aggregated)`}>
                          {schemeName}: {fieldName} <span className="text-muted-foreground text-xs">(Aggregated)</span>
                        </p>
                        <div className="grid grid-cols-3 gap-1 text-xs">
                          <div className="flex flex-col items-center p-1 bg-blue-500/10 rounded">
                            <span className="text-blue-500 font-semibold">Min</span>
                            <span>{minFormatted}</span>
                          </div>
                          <div className="flex flex-col items-center p-1 bg-green-500/10 rounded">
                            <span className="text-green-500 font-semibold">Avg</span>
                            <span>{avgFormatted}</span>
                          </div>
                          <div className="flex flex-col items-center p-1 bg-red-500/10 rounded">
                            <span className="text-red-500 font-semibold">Max</span>
                            <span>{maxFormatted}</span>
                          </div>
                        </div>
                        {count !== undefined && !isNaN(count) && (
                          <p className="text-xs text-muted-foreground mt-1 text-center">
                            ({count} value{count !== 1 ? 's' : ''})
                          </p>
                        )}
                      </div>
                    );
                  } else {
                    // --- NON-AGGREGATED display (per source) --- 
                    return Object.entries(targetMap)
                      .filter(([dsIdStr, sourceData]) => {
                        const parsedId = parseInt(dsIdStr);
                        const typedSourceData = sourceData as StatsData;
                        return (
                          selectedDataSourceIds.includes(parsedId) && 
                          typedSourceData && 
                          (typedSourceData.avg !== undefined || !showStatistics)
                        );
                      })
                      .map(([dsIdStr, sourceData]) => {
                        const dsId = parseInt(dsIdStr);
                        const sourceName = dataSourceNameMap.get(dsId) || `Source ${dsId}`;
                        const typedSourceData = sourceData as StatsData;
                        
                        if (showStatistics) {
                          // Show stats block with min/avg/max
                          const { min, max, avg, count } = typedSourceData;
                          if (avg === undefined || avg === null || isNaN(Number(avg))) {
                            // If avg is not plottable, but we want to show other stats if available
                            if ((min === undefined || min === null || isNaN(Number(min))) && 
                                (max === undefined || max === null || isNaN(Number(max)))) {
                              return null; // No valid numeric data to show for stats
                            }
                          }
                          
                          // Format values for display with 1 decimal place
                          const minFormatted = (min !== null && min !== undefined && !isNaN(Number(min))) 
                            ? Number(min).toFixed(1) 
                            : 'N/A';
                          const avgFormatted = Number(avg).toFixed(1);
                          const maxFormatted = (max !== null && max !== undefined && !isNaN(Number(max))) 
                            ? Number(max).toFixed(1) 
                            : 'N/A';
                          
                          return (
                            <div key={`${schemeFieldKey}-${dsId}`} className="px-2 py-1.5 bg-muted/30 rounded-sm">
                              <p className="text-sm font-medium mb-1 truncate" title={`${schemeName}: ${fieldName} (${sourceName})`}>
                                {schemeName}: {fieldName} <span className="text-muted-foreground text-xs">({sourceName})</span>
                              </p>
                              <div className="grid grid-cols-3 gap-1 text-xs">
                                <div className="flex flex-col items-center p-1 bg-blue-500/10 rounded">
                                  <span className="text-blue-500 font-semibold">Min</span>
                                  <span>{minFormatted}</span>
                                </div>
                                <div className="flex flex-col items-center p-1 bg-green-500/10 rounded">
                                  <span className="text-green-500 font-semibold">Avg</span>
                                  <span>{avgFormatted}</span>
                                </div>
                                <div className="flex flex-col items-center p-1 bg-red-500/10 rounded">
                                  <span className="text-red-500 font-semibold">Max</span>
                                  <span>{maxFormatted}</span>
                                </div>
                              </div>
                              {count !== undefined && !isNaN(Number(count)) && (
                                <p className="text-xs text-muted-foreground mt-1 text-center">
                                  ({count} value{count !== 1 ? 's' : ''})
                                </p>
                              )}
                            </div>
                          );
                        } else {
                          // Show simple value line or top category when statistics are disabled
                          const currentScheme = schemes.find(s => s.name === schemeName);
                          const currentField = currentScheme?.fields.find(f => f.name === fieldName);

                          if (currentField?.type === 'int') {
                              // --- Integer field: Show Average Value ---
                              const value = typedSourceData?.avg;
                              const valueFormatted = (value !== null && value !== undefined && !isNaN(Number(value)))
                                ? Number(value).toFixed(1)
                                : 'N/A';

                              return (
                                <div key={`${schemeFieldKey}-${dsId}-val`} className="flex justify-between items-center text-xs px-2 py-0.5">
                                  <span className="font-medium truncate max-w-[70%]" title={`${schemeName}: ${fieldName} (${sourceName})`}>
                                    {schemeName}: {fieldName} <span className="text-muted-foreground">({sourceName})</span>
                                  </span>
                                  <span className="font-semibold">{valueFormatted}</span>
                                </div>
                              );
                          } else {
                              // --- Non-integer field: Show Most Frequent Category ---
                              const categories = typedSourceData?.categories;
                              const fallbackTopCategoryDisplay = 'N/A';
                              let topCategory: string | null = null;
                              let topCount: number | null = null;

                              if (categories && typeof categories === 'object' && Object.keys(categories).length > 0) {
                                  // Find the category with the highest count
                                  [topCategory, topCount] = Object.entries(categories).reduce(
                                      (top, [category, count]) => {
                                          if (typeof count === 'number' && count > (top[1] ?? -1)) {
                                              return [category, count];
                                          }
                                          return top;
                                      },
                                      [null as string | null, null as number | null] // Ensure types are consistent
                                  );
                              }

                              if (topCategory !== null && topCount !== null) {
                                  const categoryLabel = topCategory === '[object Object]' ? 'Complex Value' : topCategory;
                                  return (
                                      <div key={`${schemeFieldKey}-${dsId}-cat`} className="flex justify-between items-center text-xs px-2 py-0.5">
                                          <span className="font-medium truncate max-w-[70%]" title={`${schemeName}: ${fieldName} (${sourceName}) - ${categoryLabel}`}>
                                              {schemeName}: {fieldName} <span className="text-muted-foreground">({sourceName})</span>
                                          </span>
                                          <span className="font-semibold truncate" title={categoryLabel}>
                                              {categoryLabel} <span className="bg-primary/20 px-1.5 py-0.5 rounded-full text-xs ml-1">{topCount}</span>
                                          </span>
                                      </div>
                                  );
                              } else {
                                  // Fallback if no categories found
                                   return (
                                      <div key={`${schemeFieldKey}-${dsId}-cat-na`} className="flex justify-between items-center text-xs px-2 py-0.5">
                                          <span className="font-medium truncate max-w-[70%]" title={`${schemeName}: ${fieldName} (${sourceName})`}>
                                              {schemeName}: {fieldName} <span className="text-muted-foreground">({sourceName})</span>
                                          </span>
                                          <span className="font-semibold text-muted-foreground">{fallbackTopCategoryDisplay}</span>
                                      </div>
                                  );
                              }
                          }
                        }
                      }).filter(Boolean);
                  }
                }).flat().filter(Boolean)}
            </div>
          </div>
        )}

        {/* --- Top Categories Section --- */}
        {!isGrouped && isChartDataPoint(dataPoint) && (
          <div className="pb-2 border-b border-border last:border-b-0">
            <p className="text-sm font-medium mb-2">Most Frequent Items:</p>
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(dataPoint) // Iterate through all keys in the data point
                .filter(([key, sourceOrAggMap]) => 
                  key.includes('_') && 
                  typeof sourceOrAggMap === 'object' && 
                  sourceOrAggMap !== null) // Find scheme_field keys
                .flatMap(([schemeFieldKey, sourceOrAggMap]) =>
                  Object.entries(sourceOrAggMap) // Iterate through sources OR _aggregated_ within that field
                    .map(([targetKeyStr, targetData]) => ({ 
                      schemeFieldKey,
                      targetKey: aggregateSources ? targetKeyStr : parseInt(targetKeyStr), // Keep '_aggregated_' or parse dsId
                      categories: (targetData as StatsData)?.categories as Record<string, number> | undefined
                    }))
                )
                .filter(({ targetKey, categories }) => 
                  // Only show if categories exist 
                  categories && 
                  typeof categories === 'object' && 
                  Object.keys(categories).length > 0 &&
                  // And if EITHER aggregated OR targetKey (dsId) is in selected sources 
                  (aggregateSources 
                    ? targetKey === '_aggregated_' 
                    : selectedDataSourceIds.includes(targetKey as number))
                )
                .map(({ schemeFieldKey, targetKey, categories }) => {
                  const [schemeName, fieldName] = schemeFieldKey.split('_');
                  if (!schemeName || !fieldName || !categories) return null;
                  
                  // Determine display name (Source name or "Aggregated")
                  const displayName = aggregateSources 
                    ? "Aggregated" 
                    : (dataSourceNameMap.get(targetKey as number) || `Source ${targetKey}`);

                  const topCategories = Object.entries(categories)
                    .filter(([_, count]) => typeof count === 'number')
                    .sort(([, countA], [, countB]) => (countB as number) - (countA as number))
                    .slice(0, 3);

                  if (topCategories.length === 0) return null;

                  return (
                    <div key={`${schemeFieldKey}-${targetKey}`} className="px-2 py-1.5 bg-muted/30 rounded-sm">
                      <p className="text-sm font-medium mb-1 truncate" title={`${schemeName}: ${fieldName} (${displayName})`}>
                        {schemeName}: {fieldName} <span className="text-muted-foreground text-xs">({displayName})</span>
                      </p>
                      <div className="space-y-1">
                        {topCategories.map(([category, count], idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs">
                            <span className="font-medium truncate max-w-[70%]" 
                                  title={category === '[object Object]' ? JSON.stringify(category) : category}>
                              {category === '[object Object]' ? 'Complex Value' : category}
                            </span>
                            <span className="bg-primary/20 px-1.5 py-0.5 rounded-full">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }).filter(Boolean)}
            </div>
          </div>
        )}

        {/* Documents List (Keep as is, shows all relevant docs) */}
        {dataRecordsToShow.length > 0 && (
          <div className="pb-1">
            <p className="text-sm font-medium mb-2">Documents:</p>
            <div className="space-y-1 pr-1">
              {dataRecordsToShow.slice(0, 5).map((rec) => {
                const recordTitle = rec.title ? rec.title : `ID: ${rec.id}`; // Get title or use ID
                return (
                  <div key={rec.id} className="flex items-center px-2 py-1 bg-muted/20 rounded-sm">
                    <span className="text-xs truncate" title={recordTitle}> {/* Add title attribute for full display on hover */}
                      <DocumentLink documentId={rec.id}>{recordTitle}</DocumentLink> {/* Display title */}
                    </span>
                  </div>
                );
              })}
              {dataRecordsToShow.length > 5 && (
                <div className="text-xs text-muted-foreground italic text-center mt-1">
                  ...and {dataRecordsToShow.length - 5} more record{dataRecordsToShow.length - 5 !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Component to render document results
const DocumentResults: React.FC<{
  selectedPoint: ChartDataPoint | GroupedDataPoint;
  results: FormattedClassificationResult[];
  schemes: ClassificationSchemeRead[];
  dataSources?: DataSourceRead[];
  dataRecords?: DataRecordRead[];
  onDataRecordSelect?: (datarecordId: number) => void;
}> = ({ selectedPoint, results, schemes, dataSources, dataRecords, onDataRecordSelect }) => {
  console.log("[DialogContent] DocumentResults rendering. Selected Point:", selectedPoint);

  // Helper to get results for a specific doc ID relevant to the selected point/group
  const getRelevantResultsForRecord = (recordId: number): FormattedClassificationResult[] => {
    if ('dateString' in selectedPoint) {
      // Logic for line chart (by date) - unchanged
      return results.filter(r =>
        r.datarecord_id === recordId &&
        schemes.some(as => as.id === r.scheme_id) // Show all relevant schemes for the date
      );
    } else if ('valueString' in selectedPoint) {
      // Logic for bar chart (grouped by value)
      const pointData = selectedPoint as GroupedDataPoint;
      const relevantSchemeRead = schemes.find(s => s.name === pointData.schemeName);
      if (!relevantSchemeRead) return [];

      // --- MODIFIED ---
      // Simply find all results for the document ID that match the grouping scheme ID.
      // We trust that this document was part of the group already.
      const allResultsForDocAndScheme = results.filter(r =>
        r.datarecord_id === recordId &&
        r.scheme_id === relevantSchemeRead.id
      );
      // --- END MODIFICATION ---

      return allResultsForDocAndScheme; // Return all results for this doc+scheme
    }
    return [];
  };

  // Determine the document IDs to display based on the point type
  let docIdsToShow: number[] = [];
  let contextTitle: React.ReactNode = null;

  if ('dateString' in selectedPoint) {
    const pointData = selectedPoint as ChartDataPoint;
    docIdsToShow = pointData.documents || [];
    contextTitle = <p className="mb-4 text-sm text-muted-foreground">Results for date: <span className='font-medium text-foreground'>{pointData.dateString}</span></p>;
  } else if ('valueString' in selectedPoint) {
    const pointData = selectedPoint as GroupedDataPoint;
    // Aggregate docs from all sources for the dialog
    docIdsToShow = Array.from(pointData.sourceDocuments.values()).flat();
    contextTitle = (
      <div className="mb-4 p-2 bg-muted/20 rounded text-sm">
        <p>Scheme: <span className="font-medium text-primary">{pointData.schemeName}</span></p>
        <p>Value: <span className="font-medium text-primary">{pointData.valueKey}</span></p>
        <p className="text-xs text-muted-foreground">({docIdsToShow.length} documents)</p>
      </div>
    );
  }

  if (docIdsToShow.length === 0) {
    return <div className="text-sm text-gray-500">No documents found for this selection.</div>;
  }

  return (
    <div className="space-y-6">
      {contextTitle}
      {docIdsToShow.map(recId => {
        const docResults = getRelevantResultsForRecord(recId);

        // Find relevant SchemeRead objects based on the results found
        const schemesForResultsRead = schemes.filter(s =>
          docResults.some(dr => dr.scheme_id === s.id)
        );

         if (docResults.length === 0) {
            // Return document header even if no results match active schemes/filters
           return (
             <div key={recId} className="pb-2">
               <div className="mb-3">
                 <span className="font-medium">Record ID: </span>
                 <DocumentLink documentId={recId}>
                   {recId}
                 </DocumentLink>
                 <p className="text-xs text-muted-foreground italic">(No classification results matching active schemes/filters for this item in the selected date/group)</p>
               </div>
             </div>
           );
         }
         
        const record = dataRecords?.find(dr => dr.id === recId);
        const source = dataSources?.find(ds => ds.id === record?.datasource_id);

        return (
          <div key={recId} className="pb-2 border-b last:border-b-0 mb-4">
            <div className="mb-3 p-2 bg-muted/30 rounded">
               <h4 className="font-medium text-base mb-1">
                  <DocumentLink documentId={recId}>{record?.title || `Record ID: ${recId}`}</DocumentLink>
               </h4>
               <p className="text-xs text-muted-foreground">
                 {source ? `Source: ${source.name}` : 'Unknown Source'} {record && `(ID: ${record.id})`}
               </p>
                {record?.text_content && typeof record.text_content === 'string' && (
                   <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                     Text content:{record.text_content.split('\n').filter(line => line.trim() !== '').slice(0, 2).join(' ')}...
                   </p>
                )}
            </div>
            {/* Pass the SchemeRead objects; ClassificationResultDisplay should handle adaptation internally */}
            <ClassificationResultDisplay
              result={docResults}
              scheme={schemesForResultsRead}
              useTabs={false}
              compact={false}
              renderContext="table"
            />
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(ClassificationResultsChart);

