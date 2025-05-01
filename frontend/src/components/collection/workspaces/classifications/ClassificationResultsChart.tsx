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
import { Settings2 } from 'lucide-react';
import { cn } from "@/lib/utils";

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

export type { ChartDataPoint, GroupedDataPoint };

// Helper to get the primary value from a result, prioritizing numerical types for plotting
const getPlottableValue = (result: ClassificationResultRead, scheme: ClassificationSchemeRead): number | null => {
  console.log(`[getPlottableValue] Checking Result ID: ${result.id}, Scheme: ${scheme.name} (ID: ${scheme.id})`);

  if (!result || !result.value || !scheme || !scheme.fields || scheme.fields.length === 0) {
    console.log(`[getPlottableValue] Returning null due to missing result/value/scheme/fields.`);
    return null;
  }

  // --- MODIFICATION: Iterate through fields to find the first plottable one --- 
  for (const field of scheme.fields) {
      let fieldValue: any;
      console.log(`[getPlottableValue] Trying field: ${field.name} (${field.type})`);

      // Extract value based on field name from the result object
      if (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)) {
          fieldValue = result.value[field.name];
      } else if (scheme.fields.length === 1) {
          // If only one field exists, the value might be directly the primitive/array
          fieldValue = result.value;
      } else {
          // Cannot determine value for this field in a multi-field scheme if result.value is not an object
          fieldValue = undefined; 
      }
      console.log(`[getPlottableValue] Extracted fieldValue for ${field.name}:`, fieldValue);

      // Skip if value is null/undefined for this specific field
      if (fieldValue === null || fieldValue === undefined) {
          console.log(`[getPlottableValue] Field ${field.name} has null/undefined value. Skipping.`);
          continue; 
      }

      // Check if this field is plottable (currently only supporting 'int')
      if (field.type === 'int') {
          const num = Number(fieldValue);
          if (!isNaN(num)) {
              console.log(`[getPlottableValue] Found plottable INT field '${field.name}'. Returning value: ${num}`);
              return num; // Return the first valid number found
          } else {
              console.log(`[getPlottableValue] Field ${field.name} is INT but value '${fieldValue}' is not a number. Skipping.`);
          }
      }
      
      // Add checks for other plottable types here if needed (e.g., numeric strings)
      // if (field.type === 'str') { ... }

      console.log(`[getPlottableValue] Field ${field.name} (${field.type}) is not the target plottable type.`);
  }
  // --- END MODIFICATION ---

  // If no plottable field was found after checking all fields
  console.log(`[getPlottableValue] No plottable field found in scheme ${scheme.name}. Returning null.`);
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
            console.log(`[getTimestamp/event] Found record ID ${record.id}: event_timestamp='${record.event_timestamp}', created_at='${record.created_at}'`);
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
                console.warn(`[getTimestamp/event] No timestamp string found (event_timestamp or created_at) for record ${record.id}`);
            }
        } else {
             console.warn(`[getTimestamp/event] DataRecord not found in map for ID: ${result.datarecord_id}`);
        }
        // Fallback if record or its timestamps are missing
        return null;
    }

    return null; // Fallback case
};

// --- Data Processing Function (Example for Line Chart) ---
// Modify this function (or create a similar one) to use getTimestamp
const processLineChartData = (
  results: FormattedClassificationResult[],
  schemes: ClassificationSchemeRead[],
  dataRecordsMap: Map<number, DataRecordRead> | undefined, // Accept pre-computed Map
  timeAxisConfig: TimeAxisConfig | null, // Accept timeAxisConfig
  groupingInterval: 'day' | 'week' | 'month' // Example grouping
): ChartData => {
    console.log("[Chart] Processing line chart data with config:", timeAxisConfig);
    const groupedData: Record<string, ChartDataPoint> = {};

    results.forEach(result => {
        const timestamp = getTimestamp(result, dataRecordsMap, timeAxisConfig);
        if (!timestamp || isNaN(timestamp.getTime())) {
             // console.warn(`Skipping result ID ${result.id} due to invalid/missing timestamp.`); // Reduce noise now that we know map is populated
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
                stats: {}, // Keep internal stats object if needed elsewhere
                categoryFrequency: {}
                // Initialize stat keys directly on the point
                // ... (will be added dynamically below)
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
            // --- MODIFICATION: Iterate through all fields in the scheme ---
            for (const field of scheme.fields) {
                const fieldName = field.name;
                const fieldType = field.type;

                // Construct the combined data key for this specific field
                const dataKey = `${scheme.name}_${fieldName}`;

                // Attempt to extract the value for this specific field from the result object
                let fieldValue: any = undefined;
                if (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)) {
                    fieldValue = result.value[fieldName];
                } else if (scheme.fields.length === 1 && fieldName === scheme.fields[0].name) {
                    // Handle case where result.value might be the primitive value directly if only one field
                    fieldValue = result.value;
                }

                // --- Process only if the field is 'int' and value is valid ---
                if (fieldType === 'int' && fieldValue !== null && fieldValue !== undefined) {
                    const numericValue = Number(fieldValue);

                    if (!isNaN(numericValue)) {
                        // Store the direct numeric value using the combined key
                        // We'll calculate the average at the end if needed, but store individual points first
                        // To handle multiple results for the same field on the same date, we might need to average or store an array.
                        // For simplicity now, let's average if multiple values exist for the same dataKey on the same point.
                        
                        const currentFieldCountKey = `${dataKey}_countForAvg`;
                        const currentFieldSumKey = `${dataKey}_sumForAvg`;
                        point[currentFieldCountKey] = (point[currentFieldCountKey] || 0) + 1;
                        point[currentFieldSumKey] = (point[currentFieldSumKey] || 0) + numericValue;
                        point[dataKey] = point[currentFieldSumKey] / point[currentFieldCountKey]; // Store the running average

                        // --- Calculate and store stats using combined keys ---
                        const minKey = `${dataKey}_min`;
                        const maxKey = `${dataKey}_max`;
                        const avgKey = `${dataKey}_avg`; // Stats avg can differ from primary plot avg if needed
                        const countKey = `${dataKey}_count`; // Key for the count contributing to these stats

                        if (point[minKey] === undefined || numericValue < point[minKey]) point[minKey] = numericValue;
                        if (point[maxKey] === undefined || numericValue > point[maxKey]) point[maxKey] = numericValue;

                        // Sum and Count for calculating Avg stat
                        const sumKey = `${dataKey}_sum`; // Key for the sum contributing to these stats
                        point[countKey] = (point[countKey] || 0) + 1;
                        point[sumKey] = (point[sumKey] || 0) + numericValue;
                        point[avgKey] = point[sumKey] / point[countKey]; // Calculate average for stats
                    } 
                    // else: value for int field was not a number, skip plotting/stats for this field instance
                }
                 // --- Handle Categorical Frequency (can remain for non-int fields or all fields if desired) ---
                 // This part is independent of numeric plotting but useful for tooltips
                 if (fieldValue !== null && fieldValue !== undefined) { // Check fieldValue, not result.value directly
                    if (!point.categoryFrequency) point.categoryFrequency = {};
                    // Use a scheme-field specific key for categories too
                    const categorySchemeKey = `${scheme.name}_${fieldName}`;
                    if (!point.categoryFrequency[categorySchemeKey]) point.categoryFrequency[categorySchemeKey] = {};

                    const displayValue = formatDisplayValue(fieldValue, scheme);
                    const categoryKey = String(displayValue ?? 'N/A');

                    point.categoryFrequency![categorySchemeKey][categoryKey] =
                      (point.categoryFrequency![categorySchemeKey][categoryKey] || 0) + 1;
                }
            } // --- End of field loop ---
        }
    });

    // Convert to array and sort by date
    const chartData = Object.values(groupedData).sort((a, b) => a.timestamp - b.timestamp);

    // --- ADD LOGGING --- 
    console.log("[Chart] Final Processed Chart Data:", chartData);
    // --- END LOGGING ---

    // --- Post-processing (Optional): Clean up temporary keys if needed --- 
    chartData.forEach(point => {
        schemes.forEach(scheme => {
             // Clean up keys used for calculating the primary line average
             // --- MODIFIED: Clean up keys for each field --- 
             scheme.fields.forEach(field => {
                 if (field.type === 'int') {
                     const cleanupKey = `${scheme.name}_${field.name}`;
                     delete point[`${cleanupKey}_countForAvg`];
                     delete point[`${cleanupKey}_sumForAvg`];
                     delete point[`${cleanupKey}_sum`]; // Also cleanup stat helpers
                 }
             });
             // --- END MODIFICATION ---
        });
    });
    // --- End Post-processing ---

    console.log("[Chart] Processed data count:", chartData.length);
    // console.log("[Chart] Sample processed point:", chartData[0]); // Uncomment for debugging
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
                 // Option 1: Count each label separately
                 fieldValue.forEach(label => valuesToProcess.push(label));
                 // Option 2: Group by the combination of labels (simpler)
                 // valuesToProcess.push(safeStringify(fieldValue));
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

const ClassificationResultsChart: React.FC<Props> = ({ results, schemes, dataSources, dataRecords, onDataRecordSelect, onDataPointClick, filters, timeAxisConfig }) => {
  const [isGrouped, setIsGrouped] = useState(false);
  const [showStatistics, setShowStatistics] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<ChartDataPoint | GroupedDataPoint | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  // Add state for selected schema fields to plot
  const [selectedSchemaIds, setSelectedSchemaIds] = useState<number[]>(() => 
    // By default, select all schemas
    schemes.map(s => s.id)
  );

  // --- State for Grouping Selection ---
  const [groupingSchemeId, setGroupingSchemeId] = useState<number | null>(null);
  const [groupingFieldKey, setGroupingFieldKey] = useState<string | null>(null);

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

  // --- NEW: Generate list of plottable field keys --- 
  const plottableFieldKeys = useMemo(() => {
      const keys: { key: string; name: string; color: string }[] = [];
      let colorIndex = 0;
      filteredSchemes.forEach(scheme => {
          scheme.fields.forEach(field => {
              if (field.type === 'int') {
                  keys.push({
                      key: `${scheme.name}_${field.name}`,
                      name: `${scheme.name}: ${field.name}`, // Name for legend/tooltip
                      color: colorPalette[colorIndex % colorPalette.length]
                  });
                  colorIndex++;
              }
          });
      });
      return keys;
  }, [filteredSchemes]);
  // --- END NEW --- 

  // Memoize the DataRecord map here
  const dataRecordsMap = useMemo(() => dataRecords ? new Map(dataRecords.map(dr => [dr.id, dr])) : undefined, [dataRecords]);

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
      const lineData = processLineChartData(filteredResults, schemes, dataRecordsMap, timeAxisConfig, 'day');
      return { chartData: lineData, groupedData: [], maxGroupCount: 'auto' }; // 'auto' for line chart Y-axis
    }
  }, [results, schemes, isGrouped, dataRecordsMap, filters, groupingSchemeId, groupingFieldKey, timeAxisConfig]);

  // Determine which data source to use based on the switch
  const displayData = isGrouped ? groupedData : chartData;

  // Handle click events on data points
  const handleClick = (event: any) => {
    console.log('[ChartClick] handleClick triggered. Event:', event);
    // --- MODIFIED: More robust payload extraction ---
    let point = undefined;
    if (event && Array.isArray(event.activePayload) && event.activePayload.length > 0) {
      // Try standard payload location
      point = event.activePayload[0].payload;
      console.log('[ChartClick] Extracted point from activePayload[0].payload:', point);

      // Fallback: Sometimes the payload might be nested differently
      if (!point && event.activePayload[0].props?.payload) {
        point = event.activePayload[0].props.payload;
        console.log('[ChartClick] Extracted point from activePayload[0].props.payload:', point);
      }
    }
    // --- END MODIFICATION ---

    if (point) {
      setSelectedPoint(point);
      setIsDialogOpen(true);
      if (onDataPointClick) {
        onDataPointClick(point);
      }
    } else {
      console.warn('[ChartClick] No point data found in payload.', event?.activePayload);
      setSelectedPoint(null); // Clear selection if no point found
      // Optionally call onDataPointClick with null if needed
      // if (onDataPointClick) {
      //   onDataPointClick(null);
      // }
    }
  };

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
  const [isTooltipHovered, setIsTooltipHovered] = useState(false);

  return (
    <div>
      {/* Inject the style */}
      <style>{tooltipStyle}</style> 

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

        {/* --- MODIFIED: Consolidated Plot Configuration Popover --- */}
        {!isGrouped && schemes.length > 0 && ( 
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs">
                <Settings2 className="h-3.5 w-3.5" />
                Configure Plotted Data ({selectedPlotKeys.length} fields)
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
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
                            checked={schemeIsSelected && someFieldsInSchemeSelected} // Checked if scheme active and at least one field shown
                            // Indeterminate state might be complex to implement here, stick to simple checked/unchecked
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
                                {fieldInfo && (
                                    <div className="h-3 w-3 rounded-full shrink-0 ml-auto" style={{ backgroundColor: fieldInfo.color }}></div>
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
        {/* --- END MODIFIED --- */}

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
                <Tooltip
                   active={!isTooltipHovered} // Recharts tooltip inactive when custom one is hovered
                   cursor={{ fill: 'transparent' }} // Make default cursor invisible
                   wrapperStyle={{ zIndex: 100, pointerEvents: 'none' }} // Prevent Recharts wrapper from interfering
                   content={<CustomTooltip isGrouped={isGrouped} schemes={schemes} dataSources={dataSources} results={results} showStatistics={showStatistics} dataRecordsMap={dataRecordsMap} setIsTooltipHovered={setIsTooltipHovered} />}
                   isAnimationActive={false} // Prevent animation delays
                />
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
                  domain={[0, (dataMax: number) => Math.max(dataMax || 0, 10)]} // Ensure y-axis goes at least to 10
                  allowDataOverflow={true}
                  width={60}
                />
                <Tooltip
                  active={!isTooltipHovered} // Recharts tooltip inactive when custom one is hovered
                  cursor={{ fill: 'transparent' }} // Make default cursor invisible
                  wrapperStyle={{ zIndex: 100, pointerEvents: 'none' }} // Prevent Recharts wrapper from interfering
                  content={<CustomTooltip isGrouped={isGrouped} schemes={schemes} dataSources={dataSources} results={results} showStatistics={showStatistics} dataRecordsMap={dataRecordsMap} setIsTooltipHovered={setIsTooltipHovered} />}
                  isAnimationActive={false} // Prevent animation delays
                />
                <Legend />
                
                {/* Render individual points or statistics based on toggle */}
                {plottableFieldKeys
                  .filter(fieldInfo => selectedPlotKeys.includes(fieldInfo.key)) // Filter based on state
                  .map((fieldInfo) => {
                    const dataKey = fieldInfo.key;
                    const legendName = fieldInfo.name;
                    const lineColor = fieldInfo.color;

                    // Check if we have any data for this specific field key
                    const hasData = displayData.some(point => {
                      const value = point[dataKey];
                      return value !== undefined && value !== null && !isNaN(Number(value)); // Check if it's a plottable number
                    });
                    
                    console.log(`Field Key ${dataKey} has data: ${hasData}`); // Log per field
                    
                    if (!hasData) return null;
                    
                    // If showing statistics and we have min/max data for this field key
                    if (showStatistics) {
                      const hasStats = displayData.some(point => {
                        return (
                          point[`${dataKey}_min`] !== undefined && 
                          point[`${dataKey}_max`] !== undefined && 
                          point[`${dataKey}_avg`] !== undefined
                        );
                      });
                      
                      if (hasStats) {
                        return (
                          <React.Fragment key={`stats-${dataKey}`}>
                            {/* Min value area (invisible line essentially) */}
                            <Area
                              type="monotone"
                              dataKey={`${dataKey}_min`}
                              stroke="none"
                              fillOpacity={0} // Make it invisible
                              name={`${legendName} (min)`} // Use combined name
                              isAnimationActive={false}
                            />
                            {/* Area between min and max */}
                            <Area
                              type="monotone"
                              dataKey={`${dataKey}_max`} // Upper bound is max
                              stroke="none"
                              fillOpacity={0.2}
                              fill={lineColor} // Use specific color
                              name={`${legendName} (range)`} // Use combined name
                              isAnimationActive={false}
                            />
                            
                            {/* Average Line */}
                            <Line
                              type="monotone"
                              dataKey={`${dataKey}_avg`}
                              stroke={lineColor} // Use specific color
                              strokeWidth={3}
                              dot={renderDot}
                              name={`${legendName} (avg)`} // Use combined name
                              isAnimationActive={false}
                              strokeOpacity={0.8}
                            />
                          </React.Fragment>
                        );
                      }
                    }
                    
                    // Default: render individual points as a line for the field
                    return (
                      <Line
                        key={`line-${dataKey}`}
                        type="monotone"
                        dataKey={dataKey} // Use the specific field data key
                        name={legendName} // Use combined name for legend
                        stroke={lineColor} // Use specific color
                        strokeWidth={3}
                        dot={renderDot}
                        activeDot={{ r: 6 }} // Add active dot styling
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
  dataRecordsMap?: Map<number, DataRecordRead>;
  // --- NEW: Prop to receive the state setter ---
  setIsTooltipHovered: TooltipHoverSetter;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, isGrouped, schemes, dataSources, results, showStatistics, dataRecordsMap, setIsTooltipHovered }) => {
  // --- MODIFIED: Use Recharts 'active' prop to decide rendering, but control hover state independently ---
  if (!active || !payload || !payload.length) {
    // If Recharts thinks it's inactive, ensure our hover state is also false
    // Use effect to avoid direct state update during render
    React.useEffect(() => {
      setIsTooltipHovered(false);
    }, [active, setIsTooltipHovered]);
    return null;
  }
  // --- END MODIFICATION ---

  const dataPoint = payload[0]?.payload as ChartDataPoint | GroupedDataPoint | undefined;
  if (!dataPoint) return null;
  
  const relevantDocIds = ('documents' in dataPoint) ? dataPoint.documents : []; 
  const dataRecordsToShow = relevantDocIds
    .map(id => dataRecordsMap?.get(id))
    .filter((rec): rec is DataRecordRead => !!rec);
  
  const isChartDataPoint = (point: any): point is ChartDataPoint => {
    return point && typeof point === 'object' && 'dateString' in point;
  };
  
  return (
    <div 
      className={cn(
        "max-h-72 overflow-y-auto bg-card/95 p-3 border border-border rounded-lg shadow-lg max-w-md",
        "overscroll-behavior-contain pointer-events-auto z-50" // Added overscroll, pointer-events, and z-index
      )}
      // Stop scroll events from bubbling up *within* the tooltip
      onWheel={(e) => e.stopPropagation()}
      // --- END MODIFICATION ---
    >
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

      <div className="space-y-3">
        {/* --- Statistics Section --- */}
        {!isGrouped && showStatistics && isChartDataPoint(dataPoint) && (
          <div className="pb-2 border-b border-border last:border-b-0">
            <p className="text-sm font-medium mb-2">Statistics:</p>
            <div className="grid grid-cols-1 gap-2">
              {schemes
                .flatMap(scheme => // Flatten fields with their schemes
                   scheme.fields.map(field => ({ scheme, field }))
                )
                .filter(({ scheme, field }) => {
                  // Check if stats keys exist for this scheme-field combination
                  const avgKey = `${scheme.name}_${field.name}_avg`;
                  const minKey = `${scheme.name}_${field.name}_min`;
                  const maxKey = `${scheme.name}_${field.name}_max`;
                  // Check if *all* stats keys are defined and numeric
                  return dataPoint[avgKey] !== undefined && !isNaN(Number(dataPoint[avgKey])) &&
                         dataPoint[minKey] !== undefined && !isNaN(Number(dataPoint[minKey])) &&
                         dataPoint[maxKey] !== undefined && !isNaN(Number(dataPoint[maxKey]));
                })
                .map(({ scheme, field }) => {
                  const schemeName = scheme.name;
                  const fieldName = field.name;
                  const baseKey = `${schemeName}_${fieldName}`;
                  const minKey = `${baseKey}_min`;
                  const maxKey = `${baseKey}_max`;
                  const avgKey = `${baseKey}_avg`;
                  const countKey = `${baseKey}_count`;
                  const min = dataPoint[minKey] as number | null;
                  const max = dataPoint[maxKey] as number | null;
                  const avg = dataPoint[avgKey] as number | null;
                  const count = dataPoint[countKey] as number | null;
                  return (
                    <div key={baseKey} className="px-2 py-1.5 bg-muted/30 rounded-sm">
                       <p className="text-sm font-medium mb-1 truncate" title={`${schemeName}: ${fieldName}`}>{schemeName}: {fieldName}</p>
                       <div className="grid grid-cols-3 gap-1 text-xs">
                         <div className="flex flex-col items-center p-1 bg-blue-500/10 rounded"><span className="text-blue-500 font-semibold">Min</span><span>{(min !== null && !isNaN(min)) ? min.toFixed(1) : 'N/A'}</span></div>
                         <div className="flex flex-col items-center p-1 bg-green-500/10 rounded"><span className="text-green-500 font-semibold">Avg</span><span>{(avg !== null && !isNaN(avg)) ? avg.toFixed(1) : 'N/A'}</span></div>
                         <div className="flex flex-col items-center p-1 bg-red-500/10 rounded"><span className="text-red-500 font-semibold">Max</span><span>{(max !== null && !isNaN(max)) ? max.toFixed(1) : 'N/A'}</span></div>
                       </div>
                       {(count !== null && !isNaN(count)) && (<p className="text-xs text-muted-foreground mt-1 text-center">({count} value{count !== 1 ? 's' : ''})</p>)}
                    </div>
                  );
              })}
            </div>
          </div>
        )}

        {/* --- Top Categories Section --- */}
        {!isGrouped && isChartDataPoint(dataPoint) && dataPoint.categoryFrequency && Object.keys(dataPoint.categoryFrequency).length > 0 && (
          <div className="pb-2 border-b border-border last:border-b-0">
            <p className="text-sm font-medium mb-2">Most Frequent Items:</p>
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(dataPoint.categoryFrequency)
                 .filter(([_, categories]) => typeof categories === 'object' && categories !== null && Object.keys(categories).length > 0)
                 .map(([schemeFieldKey, categories]) => {
                     const [schemeName, fieldName] = schemeFieldKey.split('_');
                     if (!schemeName || !fieldName) return null;
                     const topCategories = Object.entries(categories)
                         .filter(([_, count]) => typeof count === 'number')
                         .sort(([, countA], [, countB]) => (countB as number) - (countA as number))
                         .slice(0, 3);
                     if (topCategories.length === 0) return null;
                     const originalScheme = schemes.find(s => s.name === schemeName);
                     return (
                         <div key={schemeFieldKey} className="px-2 py-1.5 bg-muted/30 rounded-sm">
                             <p className="text-sm font-medium mb-1 truncate" title={`${originalScheme?.name ?? schemeName}: ${fieldName}`}>{originalScheme?.name ?? schemeName}: {fieldName}</p>
                             <div className="space-y-1">
                                 {topCategories.map(([category, count], idx) => (
                                     <div key={idx} className="flex justify-between items-center text-xs">
                                         <span className="font-medium truncate max-w-[70%]" title={category === '[object Object]' ? JSON.stringify(category) : category}>{category === '[object Object]' ? 'Complex Value' : category}</span>
                                         <span className="bg-primary/20 px-1.5 py-0.5 rounded-full">{count as number}</span>
                                     </div>
                                 ))}
                             </div>
                         </div>
                     );
                 })}
            </div>
          </div>
        )}

        {/* Documents List */}
        {dataRecordsToShow.length > 0 && (
          <div className="pb-1">
            <p className="text-sm font-medium mb-2">Documents:</p>
            <div className="space-y-1 pr-1">
              {dataRecordsToShow.slice(0, 5).map((rec) => (
                <div key={rec.id} className="flex items-center px-2 py-1 bg-muted/20 rounded-sm">
                  <span className="text-xs truncate">
                    <DocumentLink documentId={rec.id}>{rec.title ? rec.title : `ID: ${rec.id}`}</DocumentLink>
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
              {dataRecords?.find(dr => dr.id === recId)?.title}
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