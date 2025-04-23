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
} from 'recharts';
import { format } from 'date-fns';
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
import { X } from 'lucide-react';
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
  const { cx, cy, stroke, payload } = props; // Removed onClick and value

  if (!cx || !cy) return null;

  return (
    <Dot
      cx={cx} 
      cy={cy} 
      r={5} 
      fill={stroke} 
      stroke="#fff" 
      strokeWidth={1}
    />
  );
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
  documents: number[];
  docSchemeValues?: Record<string, Record<string, any>>;
  stats?: Record<string, { min: number; max: number; avg: number; count: number }>;
  categoryFrequency?: Record<string, Record<string, number>>;
  [key: string]: string | number | any;
}

type ChartData = ChartDataPoint[];

// Type for data points when grouping by value (Bar Chart)
interface GroupedDataPoint {
  valueString: string; // Label for the X-axis (e.g., "SchemeName: Value")
  count: number;       // Value for the Y-axis (bar height)
  documents: number[]; // List of document IDs in this group
  schemeName: string;  // Original scheme name
  valueKey: string;    // Original value key used for grouping
}

// Helper to get the primary value from a result, prioritizing numerical types for plotting
const getPlottableValue = (result: ClassificationResultRead, scheme: ClassificationSchemeRead): number | string | null => {
  if (!result || !result.value || !scheme || !scheme.fields || scheme.fields.length === 0) {
    return null;
  }

  const field = scheme.fields[0];
  let fieldValue: any;

  // Extract the potential value based on structure
  if (typeof result.value !== 'object' || result.value === null) {
    fieldValue = result.value; // Simple value
  } else if (!Array.isArray(result.value)) {
    // Object: try field name, then scheme name, then first value
    if (result.value[field.name] !== undefined) {
      fieldValue = result.value[field.name];
    } else if (result.value[scheme.name] !== undefined) {
      fieldValue = result.value[scheme.name];
    } else if (Object.keys(result.value).length > 0) {
      fieldValue = Object.values(result.value)[0];
    } else {
      fieldValue = null; // Empty object
    }
  } else {
    // Array: Handle specific types or return null/count for plotting
     if (field.type === 'List[Dict[str, any]]') {
         // Plot the count of items for entity lists
         return fieldValue.length;
     }
     // Cannot plot List[str] directly as a single point. Return null.
     return null;
  }

  // Return early if null/undefined
  if (fieldValue === null || fieldValue === undefined) return null;

  // Try to convert to number if the scheme expects it
  if (field.type === 'int') { // FieldType doesn't include 'float'
    const num = Number(fieldValue);
    return !isNaN(num) ? num : null; // Return number or null if not convertible
  }

  // For 'str' types, try converting to number if possible, otherwise null
  if (field.type === 'str') {
      const num = Number(fieldValue);
      if (!isNaN(num)) return num;
  }

  // Default: return null if not plottable as a number
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
  
  // Get the first field of the scheme
  const field = scheme.fields[0];
  if (!field) return '';
  
  // Extract the value for this field
  let fieldValue: any;
  
  // If the value is a simple type, use it directly
  if (typeof result.value !== 'object' || result.value === null) {
    fieldValue = result.value;
  } 
  // If the value is an object, try to extract the field value
  else if (!Array.isArray(result.value)) {
    // Try field name first
    if (result.value[field.name] !== undefined) {
      fieldValue = result.value[field.name];
    }
    // Try scheme name
    else if (result.value[scheme.name] !== undefined) {
      fieldValue = result.value[scheme.name];
    }
    // If it has a value property, use that
    else if ('value' in result.value) {
      fieldValue = result.value.value;
    }
    // If it has only one property, use that
    else if (Object.keys(result.value).length === 1) {
      fieldValue = Object.values(result.value)[0];
    }
    // Otherwise use the whole object
    else {
      // --- MODIFIED: If no specific key matches, keep the object for later handling
      fieldValue = result.value;
      // --- END MODIFICATION ---
    }
  }
  // If the value is an array, use it directly
  else {
    fieldValue = result.value;
  }
  
  // Format the value based on the field type
  switch (field.type) {
    case 'int':
      const num = Number(fieldValue);
      if (!isNaN(num)) {
        if ((field.scale_min === 0) && (field.scale_max === 1)) {
          return num > 0.5 ? 'True' : 'False';
        }
        return typeof num === 'number' ? Number(num.toFixed(2)) : num;
      }
      return String(fieldValue);
      
    case 'List[str]':
      if (Array.isArray(fieldValue)) {
        const isSetOfLabels = field.is_set_of_labels;
        const labels = field.labels;
        
        if (isSetOfLabels && labels) {
          return fieldValue.filter((v: string) => labels.includes(v)).join(', ');
        }
        return fieldValue.join(', ');
      }
      return String(fieldValue);
      
    case 'str':
      return String(fieldValue);
      
    case 'List[Dict[str, any]]':
      // --- MODIFIED: Ensure fieldValue is processed correctly for complex type ---
      // Note: fieldValue here might be the original object if extraction above failed
      // Or it could be an array if result.value was an array.
      const formattedNodes = ClassificationService.formatEntityStatements(fieldValue, { compact: true, maxItems: 3 });
      
      if (Array.isArray(formattedNodes)) {
        // Map nodes to strings, handling potential objects like { raw: '...' } or { summary: '...' }
        return formattedNodes.map(node => {
          if (typeof node === 'string') return node;
          if (typeof node === 'object' && node !== null) {
            if ('raw' in node) return String(node.raw);
            if ('summary' in node) return String(node.summary);
          }
          // Fallback for unexpected node types
          return ClassificationService.safeStringify(node);
        }).join('; ');
      } else if (typeof formattedNodes === 'object' && formattedNodes !== null) {
        // If formatEntityStatements returned a single object (e.g., { default_field: ... })
        return ClassificationService.safeStringify(formattedNodes);
      } else {
        // If it's not an array or object, just stringify it
        return String(formattedNodes);
      }
      // --- END MODIFICATION ---
      
    default:
      if (typeof fieldValue === 'object') {
        if (Object.keys(fieldValue).length === 0) {
          return 'N/A';
        }
        // --- MODIFIED: Use safeStringify for unhandled objects in default case --- 
        return ClassificationService.safeStringify(fieldValue); 
        // --- END MODIFICATION ---
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
        // Find the corresponding DataRecord
        const record = dataRecordsMap?.get(result.datarecord_id);
        if (record) {
            // Prioritize event_timestamp, then created_at
            const timestampStr = record.event_timestamp || record.created_at;
            if (timestampStr) {
                try {
                    return new Date(timestampStr); // Standard ISO strings should parse
                } catch (e) {
                    console.warn(`Could not parse default timestamp '${timestampStr}' for record ${record.id}:`, e);
                    return null;
                }
            }
        }
        // Fallback to classification result timestamp if record or its timestamps are missing?
        // Or just return null? Let's return null for consistency.
        return null;
    }

    return null; // Fallback case
};

// --- Data Processing Function (Example for Line Chart) ---
// Modify this function (or create a similar one) to use getTimestamp
const processLineChartData = (
  results: FormattedClassificationResult[],
  schemes: ClassificationSchemeRead[],
  dataRecords: DataRecordRead[] | undefined, // Accept dataRecords
  timeAxisConfig: TimeAxisConfig | null, // Accept timeAxisConfig
  groupingInterval: 'day' | 'week' | 'month' // Example grouping
): ChartData => {
    console.log("[Chart] Processing line chart data with config:", timeAxisConfig);
    const groupedData: Record<string, ChartDataPoint> = {};

    // Create a Map for faster DataRecord lookup
    const dataRecordsMap = useMemo(() => dataRecords ? new Map(dataRecords.map(dr => [dr.id, dr])) : undefined, [dataRecords]);

    results.forEach(result => {
        const timestamp = getTimestamp(result, dataRecordsMap, timeAxisConfig);
        if (!timestamp || isNaN(timestamp.getTime())) {
             console.warn(`Skipping result ID ${result.id} due to invalid/missing timestamp.`);
             return; // Skip results without a valid timestamp
        }

        // Format the date based on the grouping interval
        let dateKey: string;
        const year = timestamp.getFullYear();
        const month = timestamp.getMonth() + 1; // 0-indexed
        const day = timestamp.getDate();
        const week = Math.ceil(day / 7); // Simple week calculation

        switch (groupingInterval) {
            case 'day':
                dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                break;
            case 'week':
                // A more robust week calculation might be needed depending on requirements
                dateKey = `${year}-W${String(week).padStart(2, '0')}`;
                break;
            case 'month':
            default:
                dateKey = `${year}-${String(month).padStart(2, '0')}`;
                break;
        }

        if (!groupedData[dateKey]) {
            groupedData[dateKey] = {
                dateString: dateKey,
                timestamp: new Date(dateKey).getTime(), // Use start of period for timestamp
                count: 0,
                documents: [],
                docSchemeValues: {},
                stats: {},
                categoryFrequency: {}
            };
        }

        // --- Aggregation Logic (Keep similar to existing) ---
        const point = groupedData[dateKey];
        point.count++;
        if (!point.documents.includes(result.datarecord_id)) {
            point.documents.push(result.datarecord_id);
        }

        // Add scheme-specific aggregation
        const scheme = schemes.find(s => s.id === result.scheme_id);
        if (scheme) {
             const schemeKey = `scheme_${scheme.id}`;
             point[schemeKey] = (point[schemeKey] || 0) + 1; // Example: count per scheme

             // Store value for tooltip/drilldown
             if (!point.docSchemeValues) point.docSchemeValues = {};
             if (!point.docSchemeValues[result.datarecord_id]) point.docSchemeValues[result.datarecord_id] = {};
             point.docSchemeValues[result.datarecord_id][scheme.id] = result.value;

             // Calculate stats for numeric fields
             const numericValue = getPlottableValue(result, scheme);
             if (typeof numericValue === 'number') {
                 if (!point.stats) point.stats = {};
                 if (!point.stats[schemeKey]) {
                     point.stats[schemeKey] = { min: numericValue, max: numericValue, avg: numericValue, count: 1 };
                 } else {
                     const stats = point.stats[schemeKey];
                     stats.min = Math.min(stats.min, numericValue);
                     stats.max = Math.max(stats.max, numericValue);
                     stats.avg = (stats.avg * stats.count + numericValue) / (stats.count + 1);
                     stats.count++;
                 }
             }

             // Calculate category frequency
            if (scheme.fields[0]?.type === 'List[str]' && (scheme.fields[0] as any)?.config?.is_set_of_labels && Array.isArray(result.value)) {
                if (!point.categoryFrequency) point.categoryFrequency = {};
                if (!point.categoryFrequency[schemeKey]) point.categoryFrequency[schemeKey] = {};
                result.value.forEach(label => {
                     point.categoryFrequency![schemeKey][label] = (point.categoryFrequency![schemeKey][label] || 0) + 1;
                });
            }
        }
    });

    // Convert to array and sort by date
    const chartData = Object.values(groupedData).sort((a, b) => a.timestamp - b.timestamp);
    console.log("[Chart] Processed data count:", chartData.length);
    return chartData;
};

// --- Data Processing for Bar Chart (isGrouped = true) ---
const processGroupedChartData = (
  filteredResults: FormattedClassificationResult[],
  schemes: ClassificationSchemeRead[],
  groupingSchemeId: number | null,
  groupingFieldKey: string | null
): GroupedDataPoint[] => {
   if (!groupingSchemeId || !groupingFieldKey || filteredResults.length === 0) return [];

    const selectedScheme = schemes.find(s => s.id === groupingSchemeId);
    if (!selectedScheme || !selectedScheme.fields) return [];

    console.log(`[Grouped Chart] Grouping by Scheme ${groupingSchemeId}, Key ${groupingFieldKey}`);
    console.log("[Grouped Chart] Filtered Results:", filteredResults.length);

    // Find the specific field or dict_key definition
    let targetDefinition: ClientClassificationField | ClientDictKeyDefinition | null = null;
    let fieldDefinition: ClientClassificationField | null = null;

    // Find the top-level field that contains the groupingFieldKey or *is* the groupingFieldKey
    fieldDefinition = selectedScheme.fields.find(f => {
        if (f.name === groupingFieldKey) return true; // Direct match
        if (f.type === 'List[Dict[str, any]]' && f.dict_keys?.some(dk => dk.name === groupingFieldKey)) return true; // Key is within dict_keys
        return false;
    }) || null;

    if (!fieldDefinition) {
        console.warn("[Grouped Chart] Could not find field definition for grouping key:", groupingFieldKey);
        return [];
    }

    if (fieldDefinition.name === groupingFieldKey) {
        targetDefinition = fieldDefinition; // Grouping by the top-level field itself
    } else if (fieldDefinition.type === 'List[Dict[str, any]]' && fieldDefinition.dict_keys) {
        targetDefinition = fieldDefinition.dict_keys.find(dk => dk.name === groupingFieldKey) || null; // Grouping by a dict_key
    }

    if (!targetDefinition) {
         console.warn("[Grouped Chart] Could not find target definition for grouping key:", groupingFieldKey);
        return [];
    }


    // Map to store counts { "ValueAsString": { count: number, documents: number[] } }
    const valueCountsMap = new Map<string, { count: number; documents: number[]; schemeName: string; valueKey: string }>();

    filteredResults.forEach(result => {
        if (result.scheme_id !== groupingSchemeId) return; // Only consider results for the selected scheme

        const valuesToProcess: any[] = [];

        // Extract the value based on whether we are grouping by a top-level field or a dict_key
        if ('dict_keys' in fieldDefinition && fieldDefinition.dict_keys && targetDefinition && 'type' in targetDefinition) {
            // Grouping by dict_key within List[Dict]
            if (Array.isArray(result.value)) {
                 result.value.forEach(item => {
                    if (typeof item === 'object' && item !== null && groupingFieldKey in item) {
                        valuesToProcess.push(item[groupingFieldKey]);
                    }
                 });
            }
        } else {
             // Grouping by a top-level field
             // Check if result.value is an object containing the field name, or just the value itself
             const fieldValue = (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value) && fieldDefinition.name in result.value)
                ? result.value[fieldDefinition.name]
                : result.value;

             // Handle List[str] - count each item? For now, just stringify the list or take first item? Let's stringify.
             if (fieldDefinition.type === 'List[str]' && Array.isArray(fieldValue)) {
                 // Option 1: Count each label separately (more complex grouping)
                 // fieldValue.forEach(label => valuesToProcess.push(label));
                 // Option 2: Group by the combination of labels (simpler)
                  valuesToProcess.push(safeStringify(fieldValue));
             } else {
                 valuesToProcess.push(fieldValue);
             }
        }


        valuesToProcess.forEach(value => {
             const valueString = safeStringify(value); // Use safe stringify for map key
             const mapKey = valueString; // Key is just the value string

             const currentEntry = valueCountsMap.get(mapKey) || { count: 0, documents: [], schemeName: selectedScheme.name, valueKey: valueString };
             currentEntry.count += 1;
             if (!currentEntry.documents.includes(result.datarecord_id)) { // Use datarecord_id
                 currentEntry.documents.push(result.datarecord_id); // Use datarecord_id
             }
             valueCountsMap.set(mapKey, currentEntry);
        });

    });

    // Convert map to array format suitable for the chart
    const groupedData: GroupedDataPoint[] = Array.from(valueCountsMap.entries()).map(([valueStr, data]) => ({
        valueString: valueStr, // Use the stringified value for the label
        count: data.count,
        documents: data.documents,
        schemeName: data.schemeName,
        valueKey: data.valueKey // Keep the original value key (stringified)
    })).sort((a, b) => b.count - a.count); // Sort by count descending

    console.log("[Grouped Chart] Processed grouped data:", groupedData);
    return groupedData;
};

const ClassificationResultsChart: React.FC<Props> = ({ results, schemes, dataSources, dataRecords, onDataRecordSelect, onDataPointClick, filters, timeAxisConfig }) => {
  const [isGrouped, setIsGrouped] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<ChartDataPoint | GroupedDataPoint | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  // Add state for selected schema fields to plot
  const [selectedSchemaIds, setSelectedSchemaIds] = useState<number[]>(() => 
    // By default, select all schemas
    schemes.map(s => s.id)
  );

  // --- State for Grouping Selection ---
  const [groupingSchemeId, setGroupingSchemeId] = useState<number | null>(schemes[0]?.id ?? null);
  const [groupingFieldKey, setGroupingFieldKey] = useState<string | null>(() => {
      if (schemes.length > 0 && groupingSchemeId !== null) {
        const initialKeys = getTargetKeysForScheme(groupingSchemeId, schemes);
        return initialKeys.length > 0 ? initialKeys[0].key : null;
      }
      return null;
  });

  // Update field key when scheme changes
  useEffect(() => {
    if (groupingSchemeId !== null) {
        const keys = getTargetKeysForScheme(groupingSchemeId, schemes);
        const currentKeyIsValid = keys.some(k => k.key === groupingFieldKey);
        // Reset to the first key if the current one is invalid or null for the new scheme
        if (!currentKeyIsValid) {
            setGroupingFieldKey(keys.length > 0 ? keys[0].key : null);
        }
    } else {
        setGroupingFieldKey(null); // No scheme selected
    }
  }, [groupingSchemeId, schemes, groupingFieldKey]); // Added groupingFieldKey dependency

  // Filter schemes based on selection for plotting
  const filteredSchemes = useMemo(() => 
    schemes.filter(scheme => selectedSchemaIds.includes(scheme.id)),
    [schemes, selectedSchemaIds]
  );

  // Data processing for the chart
  const { chartData, groupedData, maxGroupCount } = useMemo(() => {
    if (!results || results.length === 0) {
      return { chartData: [], groupedData: [], maxGroupCount: 'auto' };
    }
    
    // --- FILTERING STEP ---
    // Group results by document ID first to apply filters document-wise
    const resultsByDocId = results.reduce<Record<number, FormattedClassificationResult[]>>((acc, result) => {
        const docId = result.datarecord_id;
        if (!acc[docId]) acc[docId] = [];
        acc[docId].push(result);
        return acc;
    }, {});

    // Apply all active filters
    const filteredDocIds = Object.keys(resultsByDocId)
        .map(Number)
        .filter(docId => {
            const docResults = resultsByDocId[docId];
            // Document must match ALL filters
            return filters.every(filter => checkFilterMatch(filter, docResults, schemes));
        });

    // Filter the original results array based on the filtered document IDs
    const filteredResults = results.filter(result => filteredDocIds.includes(result.datarecord_id));
    // --- END FILTERING STEP ---

    if (filteredResults.length === 0 && results.length > 0) {
        // If filters removed all results, return empty data
         return { chartData: [], groupedData: [], maxGroupCount: 'auto' };
    }

    // Return processed data based on the isGrouped state
    if (isGrouped) {
      const groupedResult = processGroupedChartData(filteredResults, schemes, groupingSchemeId, groupingFieldKey);
      return { chartData: [], groupedData: groupedResult, maxGroupCount: 'auto' };
    } else {
      // Pass dataRecords to processLineChartData
      const lineData = processLineChartData(filteredResults, schemes, dataRecords, timeAxisConfig, 'day');
      return { chartData: lineData, groupedData: [], maxGroupCount: 'auto' }; // 'auto' for line chart Y-axis
    }
  }, [results, schemes, isGrouped, dataRecords, filters, groupingSchemeId, groupingFieldKey, timeAxisConfig]);

  // Determine which data source to use based on the switch
  const displayData = isGrouped ? groupedData : chartData;

  const handleClick = useCallback((chartEvent: any) => {
    console.log("[ChartClick] handleClick triggered. Event:", chartEvent);
    const point = chartEvent?.activePayload?.[0]?.payload as ChartDataPoint | GroupedDataPoint | undefined;
    console.log("[ChartClick] Extracted point:", point);

    if (!point) {
        console.log("[ChartClick] No point data found in payload.");
        return;
    }

    console.log("[ChartClick] Setting selectedPoint and opening dialog.");
    setSelectedPoint(point);
    setIsDialogOpen(true);

  }, []);

  const renderDot = useCallback((props: CustomizedDotProps & { index?: number }) => {
    const { cx, cy, r, index } = props;
    const key = index !== undefined ? `dot-${index}` : `dot-${cx}-${cy}`;
    return <circle key={key} cx={cx} cy={cy} r={r ? r + 2 : 4} fill="rgba(136, 132, 216, 0.8)" stroke="#fff" strokeWidth={1} />;
  }, []);

  // --- Get target keys for the selected grouping scheme ---
  const currentGroupingKeys = useMemo(() => {
      if (groupingSchemeId !== null) {
          return getTargetKeysForScheme(groupingSchemeId, schemes);
      }
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
        <YAxis yAxisId={0} domain={["auto", "auto"]} />
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

  return (
    <div>
      {/* --- Chart Controls --- */}
      <div className="flex flex-wrap items-center gap-4 mb-4 p-3 rounded-md ">
        {/* Group Toggle */}
        <div className="flex items-center gap-2">
          <Switch
            checked={isGrouped}
            onCheckedChange={setIsGrouped}
            id="group-switch"
          />
          <label htmlFor="group-switch">Group by value</label>
        </div>

        {/* Statistics Toggle (only when not grouped) */}
        {!isGrouped && (
          <div className="flex items-center gap-2">
            <Switch
              checked={showStatistics}
              onCheckedChange={setShowStatistics}
              id="stats-switch"
            />
            <label htmlFor="stats-switch">Show statistics (min/avg/max)</label>
          </div>
        )}

        {/* Schema Selection (only when not in group mode) */}
        {!isGrouped && schemes.length > 1 && (
          <div className="flex items-center gap-2">
            <UiLabel htmlFor="schema-select" className="text-sm">Schemas to plot:</UiLabel>
            <div className="flex flex-wrap gap-1 max-w-[50vw]">
              {schemes.map(scheme => (
                <Button
                  key={scheme.id}
                  variant={selectedSchemaIds.includes(scheme.id) ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    if (selectedSchemaIds.includes(scheme.id)) {
                      // Don't allow deselecting the last schema
                      if (selectedSchemaIds.length > 1) {
                        setSelectedSchemaIds(selectedSchemaIds.filter(id => id !== scheme.id));
                      }
                    } else {
                      setSelectedSchemaIds([...selectedSchemaIds, scheme.id]);
                    }
                  }}
                  className="text-xs px-2 py-1 h-auto"
                >
                  {scheme.name}
                </Button>
              ))}
              {/* Show "Select All" button only if not all schemas are selected */}
              {selectedSchemaIds.length < schemes.length && (
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={() => setSelectedSchemaIds(schemes.map(s => s.id))}
                  className="text-xs px-2 py-1 h-auto"
                >
                  Select All
                </Button>
              )}
              {/* Show "Clear All" button only if more than one schema is selected */}
              {selectedSchemaIds.length > 1 && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    // Always keep at least one schema selected
                    if (schemes.length > 0) {
                      setSelectedSchemaIds([schemes[0].id]);
                    }
                  }}
                  className="text-xs px-2 py-1 h-auto"
                >
                  Clear All
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Scheme Selector (only show when grouping) */}
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
      </div>

      {/* --- Chart Area --- */}
      {(results.length === 0 || (isGrouped && groupedData.length === 0)) ? (
        <div className="flex flex-col items-center justify-center mt-16 p-8 text-center border border-dashed rounded-lg">
          <Info className="h-10 w-10 text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No results to display. Try adjusting your filters.</p>
          {isGrouped && results.length > 0 && <p className="text-xs text-muted-foreground">(Or select a different scheme/field for grouping)</p>}
        </div>
      ) : (
        <div style={{ width: '100%', height: 400 }}>
          <ResponsiveContainer>
            {isGrouped ? (
              // Bar chart for grouped data
              <ComposedChart 
                data={displayData} 
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                onClick={handleClick}
              >
                {/* <CartesianGrid strokeDasharray="0 0" /> */}
                <XAxis dataKey="valueString" />
                <YAxis 
                  domain={[0, maxGroupCount]} 
                  allowDataOverflow={true}
                  label={{ value: "Count", angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }}
                />
                <Tooltip content={<CustomTooltip isGrouped={isGrouped} schemes={schemes} dataSources={dataSources} results={results} showStatistics={showStatistics} />} />
                <Legend payload={[]} />
                <Bar dataKey="count" isAnimationActive={false}>
                  {displayData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={colorPalette[index % colorPalette.length]} />
                  ))}
                </Bar>
              </ComposedChart>
            ) : (
              // Line chart for individual data with optional statistics
              <ComposedChart
                data={displayData}
                margin={{ top: -5, right: 30, left: 20, bottom: 25 }}
                onClick={handleClick}
              >
                {/* <CartesianGrid strokeDasharray="3 3" /> */}
                <XAxis dataKey="dateString" angle={-15} textAnchor="end" height={50} />
                <YAxis
                  domain={[0, 'auto']}
                  allowDataOverflow={false}
                  width={60}
                />
                <Tooltip content={<CustomTooltip isGrouped={isGrouped} schemes={schemes} dataSources={dataSources} results={results} showStatistics={showStatistics} />} />
                <Legend />
                
                {/* Render individual points or statistics based on toggle */}
                {filteredSchemes.map((scheme, index) => {
                  // Check if we have any data for this scheme
                  const hasData = displayData.some(point => {
                    const value = point[scheme.name];
                    return value !== undefined && value !== null;
                  });
                  
                  console.log(`Scheme ${scheme.name} has data: ${hasData}`);
                  
                  if (!hasData) return null;
                  
                  // Get unique color for this scheme
                  const schemeColor = colorPalette[index % colorPalette.length];
                  
                  // If showing statistics and we have min/max data, render area + avg line
                  if (showStatistics) {
                    // --- MODIFIED: Check for stats AND if scheme is numerical ---
                    const isNumericalScheme = scheme.fields[0]?.type === 'int'; // Add float etc. if needed
                    const hasStats = isNumericalScheme && displayData.some(point => {
                      return (
                        point[`${scheme.name}_min`] !== undefined && 
                        point[`${scheme.name}_max`] !== undefined && 
                        point[`${scheme.name}_avg`] !== undefined
                      );
                    });
                    // --- END MODIFICATION ---
                    
                    if (hasStats) {
                      return (
                        <React.Fragment key={`stats-${scheme.id}`}>
                          {/* Create a reference area between min and max */}
                          <Area
                            type="monotone"
                            dataKey={`${scheme.name}_min`}
                            stroke="none"
                            fillOpacity={0}
                            name={`${scheme.name} (min)`}
                            isAnimationActive={false}
                          />
                          <Area
                            type="monotone"
                            dataKey={`${scheme.name}_max`}
                            stroke="none"
                            fillOpacity={0.2}
                            fill={schemeColor}
                            name={`${scheme.name} (range)`}
                            isAnimationActive={false}
                          />
                          
                          {/* Average Line */}
                          <Line
                            type="monotone"
                            dataKey={`${scheme.name}_avg`}
                            stroke={schemeColor}
                            strokeWidth={3}
                            dot={renderDot}
                            name={`${scheme.name} (avg)`}
                            isAnimationActive={false}
                            strokeOpacity={0.8}
                          />
                        </React.Fragment>
                      );
                    }
                  }
                  
                  // Default: render individual points as a line
                  return (
                    <Line
                      key={`line-${scheme.id}`}
                      type="monotone"
                      dataKey={scheme.name}
                      stroke={schemeColor}
                      strokeWidth={3}
                      dot={renderDot}
                      isAnimationActive={false}
                      strokeOpacity={0.8}
                    />
                  );
                })}
                
                {/* --- MODIFIED: Conditionally render ReferenceDot --- */}
                {!isGrouped && selectedPoint && 'dateString' in selectedPoint && (
                   <ReferenceDot
                     x={selectedPoint.dateString} // Safe to access dateString here
                     y={0} // Position at the bottom, adjust if needed
                     ifOverflow="extendDomain"
                     r={5} // Example radius
                     fill="red" // Example color
                     stroke="white"
                     isFront={true}
                   />
                )}
                {/* --- End Modification --- */}
              </ComposedChart>
            )}
          </ResponsiveContainer>
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
                  results={results}
                  schemes={schemes}
                  dataSources={dataSources}
                  dataRecords={dataRecords}
                  onDataRecordSelect={onDataRecordSelect}
                />
              </div>
            ) : (
              <div className="p-4 text-center text-muted-foreground">
                Document details not found.
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
  showStatistics?: boolean;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, isGrouped, schemes, dataSources, results, showStatistics }) => {
  if (!active || !payload || !payload.length) return null;
  
  const dataPoint = payload[0]?.payload as ChartDataPoint | GroupedDataPoint | undefined;
  if (!dataPoint) return null;
  
  const relevantDocIds = ('documents' in dataPoint) ? dataPoint.documents : []; 
  const dataRecordsToShow = relevantDocIds.map(id => ({ id }));

  // Helper type guard to check if it's a ChartDataPoint
  const isChartDataPoint = (point: any): point is ChartDataPoint => {
    return point && typeof point === 'object' && 'dateString' in point && 'stats' in point && 'categoryFrequency' in point;
  };
  
  return (
    <div className="custom-tooltip bg-card/95 p-3 border border-border rounded-lg shadow-lg max-w-md">
      <div className="mb-3 pb-2 border-b border-border">
        <p className="text-sm font-semibold text-foreground">
          {isGrouped && 'valueString' in dataPoint
            ? `Group: ${dataPoint.schemeName} - ${dataPoint.valueString}`
            : `Date: ${label}`}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {dataRecordsToShow.length} record{dataRecordsToShow.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* --- Statistics Section --- */}
      {/* FIX: Use type guard before accessing stats */}
      {!isGrouped && showStatistics && isChartDataPoint(dataPoint) && dataPoint.stats && (
        <div className="mb-3 pb-2 border-b border-border">
          <p className="text-sm font-medium mb-2">Statistics:</p>
          <div className="grid grid-cols-1 gap-2">
            {schemes.map(scheme => {
              const schemeName = scheme.name; 
              const minKey = `${schemeName}_min`;
              const maxKey = `${schemeName}_max`;
              const avgKey = `${schemeName}_avg`;
              const countKey = `${schemeName}_count`;
              
              // Access stats safely now
              if (!(avgKey in dataPoint.stats!)) return null; 
              
              const statsData = {
                min: dataPoint.stats![minKey],
                max: dataPoint.stats![maxKey],
                avg: dataPoint.stats![avgKey],
                count: dataPoint.stats![countKey]
              };
              
              // Ensure properties are numbers before using number methods
              const count = typeof statsData.count === 'number' ? statsData.count : 0;
              const min = typeof statsData.min === 'number' ? statsData.min : NaN;
              const max = typeof statsData.max === 'number' ? statsData.max : NaN;
              const avg = typeof statsData.avg === 'number' ? statsData.avg : NaN;

              if (count === 0) return null;

              return (
                <div key={schemeName} className="px-2 py-1.5 bg-muted/30 rounded-sm">
                  <p className="text-sm font-medium mb-1">{schemeName}:</p>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    <div className="flex flex-col items-center p-1 bg-blue-500/10 rounded">
                      <span className="text-blue-500 font-semibold">Min</span>
                      <span>{!isNaN(min) ? min.toFixed(1) : 'N/A'}</span>
                    </div>
                    <div className="flex flex-col items-center p-1 bg-green-500/10 rounded">
                      <span className="text-green-500 font-semibold">Avg</span>
                      <span>{!isNaN(avg) ? avg.toFixed(1) : 'N/A'}</span>
                    </div>
                    <div className="flex flex-col items-center p-1 bg-red-500/10 rounded">
                      <span className="text-red-500 font-semibold">Max</span>
                      <span>{!isNaN(max) ? max.toFixed(1) : 'N/A'}</span>
                    </div>
                  </div>
                   <p className="text-xs text-muted-foreground mt-1 text-center">
                      {count} data point{count !== 1 ? 's' : ''}
                    </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* --- Top Categories Section --- */}
      {/* FIX: Use type guard before accessing categoryFrequency */}
      {!isGrouped && isChartDataPoint(dataPoint) && dataPoint.categoryFrequency && (
        <div className="mb-3 pb-2 border-b border-border">
          <p className="text-sm font-medium mb-2">Most Frequent Items:</p>
          <div className="grid grid-cols-1 gap-2">
            {schemes.map(scheme => {
              const schemeName = scheme.name;
              // Access categories safely now
              const categories = dataPoint.categoryFrequency?.[schemeName]; 
              
              if (!categories || typeof categories !== 'object' || categories === null || Object.keys(categories).length === 0) return null;
              
              // FIX: Ensure category entries are correctly typed
              const topCategories = Object.entries(categories)
                .filter(([_, count]) => typeof count === 'number') // Ensure count is a number
                .sort(([, countA], [, countB]) => (countB as number) - (countA as number)) // Type assertion for sort
                .slice(0, 3);
              
              if (topCategories.length === 0) return null;
              
              return (
                <div key={schemeName} className="px-2 py-1.5 bg-muted/30 rounded-sm">
                  <p className="text-sm font-medium mb-1">{schemeName}:</p>
                  <div className="space-y-1">
                    {topCategories.map(([category, count], idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs">
                        <span className="font-medium truncate max-w-[70%]" title={category}>
                          {category}
                        </span>
                        <span className="bg-primary/20 px-1.5 py-0.5 rounded-full text-primary-foreground">
                          {/* FIX: Render the numeric count */}
                          {count as number} 
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
       {/* Documents List (unchanged) */}
       {dataRecordsToShow.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Documents:</p>
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {dataRecordsToShow.slice(0, 5).map((rec) => (
              <div key={rec.id} className="flex items-center px-2 py-1 bg-muted/20 rounded-sm">
                <span className="text-xs truncate">
                  <DocumentLink documentId={rec.id}>
                    Record {rec.id}
                  </DocumentLink>
                </span>
              </div>
            ))}
            {dataRecordsToShow.length > 5 && (
              <div className="text-xs text-muted-foreground italic text-center mt-1">
                ...and {dataRecordsToShow.length - 5} more record{dataRecordsToShow.length - 5 !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>
      )}
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
      return results.filter(r =>
        r.datarecord_id === recordId &&
        schemes.some(as => as.id === r.scheme_id)
      );
    } else if ('valueString' in selectedPoint) {
      const pointData = selectedPoint as GroupedDataPoint;
      const relevantSchemeRead = schemes.find(s => s.name === pointData.schemeName);
      if (!relevantSchemeRead) return [];

      // Adapter usage should be correct if imported at the top level
      const adaptedScheme = adaptSchemeReadToScheme(relevantSchemeRead);

      const specificResult = results.find(r =>
        r.datarecord_id === recordId &&
        r.scheme_id === relevantSchemeRead.id &&
        // Use formatDisplayValue from utils
        String(formatDisplayValue(r.value, relevantSchemeRead)) === String(pointData.valueKey)
      );
      return specificResult ? [specificResult] : [];
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
    docIdsToShow = pointData.documents || [];
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

        return (
          <div key={recId} className="pb-2">
            <div className="mb-3">
              <span className="font-medium">Record ID: </span>
              <DocumentLink documentId={recId}>
                {recId}
              </DocumentLink>
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