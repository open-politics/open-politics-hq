import React, { useMemo, useState, useCallback, useEffect } from 'react';
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
} from 'recharts';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { ClassificationResultRead, ClassificationSchemeRead, DocumentRead } from '@/client';
import ClassificationResultDisplay from './ClassificationResultDisplay';
import { FormattedClassificationResult } from '@/lib/classification/types';
import { resultToResultRead } from '@/lib/classification/adapters';
import DocumentLink from '../documents/DocumentLink';
import { ClassificationService } from '@/lib/classification/service';
import { Info } from 'lucide-react';
import { ClassificationScheme, SchemeField, DictKeyDefinition, FieldType } from '@/lib/classification/types';
import { ResultFilter } from './ClassificationResultFilters';
import { getTargetFieldDefinition, getTargetKeysForScheme, formatDisplayValue, checkFilterMatch, compareValues } from '@/lib/classification/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

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
  const { fill, x, y, width, height, index } = props;
  const gradientId = `gradient-${index % gradientColors.length}`;
  
  return (
    <g>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={gradientColors[index % gradientColors.length][0]} stopOpacity={0.8} />
          <stop offset="100%" stopColor={gradientColors[index % gradientColors.length][1]} stopOpacity={0.6} />
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={width} height={height} fill={`url(#${gradientId})`} rx={4} ry={4} />
    </g>
  );
};

const CustomizedDot: React.FC<CustomizedDotProps> = (props) => {
  const { cx, cy, payload } = props;
  
  if (!cx || !cy) return null;

  return (
    <circle 
      cx={cx} 
      cy={cy} 
      r={4} 
      fill={props.stroke || '#8884d8'} 
      fillOpacity={0.8}
      style={{ cursor: 'pointer' }}
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
  if (field.type === 'int') {
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

interface CustomizedCurveEvent {
  payload?: ChartDataPoint;
  value?: any;
}

interface CustomizedDotProps extends DotProps {
  payload?: any;
}

interface Props {
  results: FormattedClassificationResult[];
  schemes: ClassificationSchemeRead[];
  documents?: DocumentRead[];
  onDocumentSelect?: (documentId: number) => void;
  onDataPointClick?: (point: any) => void;
  filters: ResultFilter[];
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

// --- ADD Adapter function ---
const adaptSchemeReadToScheme = (schemeRead: ClassificationSchemeRead): ClassificationScheme => {
  // Helper to convert API DictKeyDefinition to our type
  const convertDictKey = (apiDictKey: any): DictKeyDefinition => ({
    name: apiDictKey.name,
    type: apiDictKey.type as "str" | "int" | "float" | "bool" // Cast type
  });

  return {
    id: schemeRead.id,
    name: schemeRead.name,
    description: schemeRead.description,
    fields: schemeRead.fields.map(field => ({
      name: field.name,
      type: field.type as FieldType, // Cast type
      description: field.description,
      config: {
        scale_min: field.scale_min ?? undefined,
        scale_max: field.scale_max ?? undefined,
        is_set_of_labels: field.is_set_of_labels ?? undefined,
        labels: field.labels ?? undefined,
        dict_keys: field.dict_keys ? field.dict_keys.map(convertDictKey) : undefined
      }
    })),
    model_instructions: schemeRead.model_instructions ?? undefined,
    validation_rules: schemeRead.validation_rules ?? undefined,
    created_at: schemeRead.created_at,
    updated_at: schemeRead.updated_at,
    classification_count: schemeRead.classification_count ?? 0,
    document_count: schemeRead.document_count ?? 0
  };
};

// --- Data Processing for Line Chart (isGrouped = false) ---
const processLineChartData = (
  results: FormattedClassificationResult[],
  schemes: ClassificationSchemeRead[],
  documents?: DocumentRead[]
) => {
  console.log('[Line Chart] Processing filtered results:', results.length, 'Documents:', documents?.length);
  const resultsByDateAndDoc = results.reduce<Record<string, Record<string, ClassificationResultRead[]>>>((acc, result) => {
    // Find the corresponding document
    const doc = documents?.find(d => d.id === result.document_id);
    
    // Determine the date key: Prioritize publication_date, fallback to insertion_date, then result.timestamp
    let dateToUse: string | Date | null | undefined = null;
    let dateSource = 'unknown'; // Variable to track the source of the date
    if (doc) {
      // @ts-ignore - Check if publication_date exists and is valid, even if not strictly in DocumentRead type
      if (doc.publication_date && !isNaN(new Date(doc.publication_date).getTime())) {
        // @ts-ignore
        dateToUse = doc.publication_date;
        dateSource = 'publication_date';
      } else if (doc.insertion_date && !isNaN(new Date(doc.insertion_date).getTime())) {
        dateToUse = doc.insertion_date;
        dateSource = 'insertion_date';
      }
    }
    
    // Final fallback to result timestamp if no valid document date found
    if (!dateToUse) {
      dateToUse = result.timestamp;
      dateSource = 'result_timestamp';
    }

    // Format the date key
    let dateKey: string;
    try {
      // Ensure dateToUse is valid before formatting
      const validDate = dateToUse ? new Date(dateToUse) : null;
      if (validDate && !isNaN(validDate.getTime())) {
        dateKey = format(validDate, 'yyyy-MM-dd');
      } else {
        throw new Error('Invalid date object');
      }
    } catch (e) {
      console.warn(`Could not format date: ${dateToUse} for result ${result.id}. Using fallback.`);
      dateKey = 'Unknown Date'; // Fallback for invalid dates
    }

    // Log the chosen date source for debugging
    console.log(`[Line Chart] Result ${result.id}, Doc ${result.document_id}: Using ${dateSource} (${dateKey}) for X-axis.`);

    const docKey = `doc-${result.document_id}`;
    
    if (!acc[dateKey]) {
      acc[dateKey] = {};
    }
    
    if (!acc[dateKey][docKey]) {
      acc[dateKey][docKey] = [];
    }
    
    // Push the result, ensuring type compatibility using the adapter
    acc[dateKey][docKey].push(resultToResultRead(result));
    return acc;
  }, {});
  
  console.log('[Line Chart] Results grouped by date and document:', Object.keys(resultsByDateAndDoc).length);
  
  // Transform grouped data into chart format with statistical aggregations
  const finalChartData = Object.entries(resultsByDateAndDoc).map(([date, docResults]) => {
    // Initialize chart point with base properties
    const chartPoint: ChartDataPoint = {
      dateString: date,
      timestamp: new Date(date).getTime(),
      count: Object.keys(docResults).length, // Count of unique documents on this date
      documents: [...new Set(Object.values(docResults).flatMap(results => results.map(r => r.document_id)))],
      // New statistical properties to be calculated
      stats: {},
      categoryFrequency: {}
    };
    
    // For consolidated view, we'll create a map of documents to their scheme results
    const docSchemeValues: Record<string, Record<string, any>> = {};
    
    // Process each document's results
    Object.entries(docResults).forEach(([docKey, docSchemeResults]) => {
      const documentId = docKey.replace('doc-', '');
      docSchemeValues[documentId] = {};
      
      // Group this document's results by scheme
      const schemeGroups = docSchemeResults.reduce<Record<number, ClassificationResultRead[]>>((acc, result) => {
        if (!acc[result.scheme_id]) {
          acc[result.scheme_id] = [];
        }
        acc[result.scheme_id].push(result);
        return acc;
      }, {});
      
      // Add scheme-specific data
      Object.entries(schemeGroups).forEach(([schemeIdStr, docSchemeResults]) => {
        const schemeId = Number(schemeIdStr);
        const scheme = schemes.find(s => s.id === schemeId);
        if (!scheme) {
          console.log(`Scheme ${schemeId} not found`);
          return;
        }
        
        const schemeName = scheme.name;
        console.log(`Processing scheme ${schemeName} with ${docSchemeResults.length} results`);
        
        // Process results in this scheme for this document
        docSchemeResults.forEach(result => {
          // Extract the plottable value (numeric or null)
          const plottableValue = getPlottableValue(result, scheme);
          
          // Store in document-specific structure for tooltip access
          docSchemeValues[documentId][schemeName] = result.value;
          
          // Process numeric values for statistics
          if (typeof plottableValue === 'number') {
            // Initialize stats object for this scheme if needed
            if (!chartPoint.stats || !chartPoint.stats[schemeName]) {
              chartPoint.stats = chartPoint.stats || {};
              chartPoint.stats[schemeName] = { min: Infinity, max: -Infinity, avg: 0, count: 0 };
            }
            
            if (chartPoint.stats && chartPoint.stats[schemeName]) {
              const stats = chartPoint.stats[schemeName];
              stats.min = Math.min(stats.min, plottableValue);
              stats.max = Math.max(stats.max, plottableValue);
              stats.count += 1;
              // Running sum for average calculation
              stats.avg = (stats.avg * (stats.count - 1) + plottableValue) / stats.count;
            }

            // Also store raw value for backwards compatibility
            chartPoint[schemeName] = plottableValue;
          } 
          // Process categorical values (non-numeric)
          else if (result.value !== null && result.value !== undefined) {
            // Handle categorical data by tracking frequency
            // Initialize category frequency tracker for this scheme
            if (!chartPoint.categoryFrequency || !chartPoint.categoryFrequency[schemeName]) {
              chartPoint.categoryFrequency = chartPoint.categoryFrequency || {};
              chartPoint.categoryFrequency[schemeName] = {};
            }
            
            // --- MODIFIED: Use formatDisplayValue from utils for consistent key generation ---
            const displayValue = formatDisplayValue(result.value, scheme); // Pass the original scheme (ClassificationSchemeRead)
            let categoryKey = String(displayValue ?? 'N/A'); // Convert result to string key
            // --- END MODIFICATION ---
            
            // Limit key length for display sanity
            const MAX_KEY_LENGTH = 75;
            if (categoryKey.length > MAX_KEY_LENGTH) {
              categoryKey = categoryKey.substring(0, MAX_KEY_LENGTH) + '...';
            }
            // console.log('Generated Category Key:', categoryKey); // Keep commented unless debugging
            
            // Increment count for this categorical value using the generated key
            if (chartPoint.categoryFrequency && chartPoint.categoryFrequency[schemeName]) {
              chartPoint.categoryFrequency[schemeName][categoryKey] = 
                (chartPoint.categoryFrequency[schemeName][categoryKey] || 0) + 1;
            }
          }
          // Log if value couldn't be processed
          else if (result.value !== null && !(Array.isArray(result.value) && (result.value as any[]).length === 0)) {
            console.log(`Value for scheme '${schemeName}' not processed (type: ${scheme.fields[0]?.type}, value:`, result.value, ")");
          }
        });
      });
    });
    
    // Store the document scheme values for use in tooltips
    chartPoint.docSchemeValues = docSchemeValues;
    
    // Set actual min/max/avg keys for direct chart access
    if (chartPoint.stats) {
      Object.entries(chartPoint.stats).forEach(([schemeName, stats]) => {
        const finalMin = stats.min !== Infinity ? stats.min : null;
        const finalMax = stats.max !== -Infinity ? stats.max : null;
        // Ensure avg is null if count is 0 to prevent NaN division or incorrect avg
        const finalAvg = stats.count > 0 ? stats.avg : null; 

        chartPoint[`${schemeName}_min`] = finalMin;
        chartPoint[`${schemeName}_max`] = finalMax;
        chartPoint[`${schemeName}_avg`] = finalAvg;

        if (chartPoint.categoryFrequency && chartPoint.categoryFrequency[schemeName]) {
          const categories = Object.entries(chartPoint.categoryFrequency[schemeName])
            .sort((a, b) => b[1] - a[1]) // Sort by frequency descending
            .slice(0, 3); // Take top 3
          
          // Store the most frequent category and its count
          if (categories.length > 0) {
            chartPoint[`${schemeName}_topCategory`] = categories[0][0];
            chartPoint[`${schemeName}_topCategoryCount`] = categories[0][1];
          }
        }
      });
    }
    
    return chartPoint;
  });
  
  console.log('[Line Chart] Final chart data:', finalChartData);
  return finalChartData.sort((a, b) => a.timestamp - b.timestamp); // Sort by date
};

// --- Data Processing for Bar Chart (isGrouped = true) ---
const processGroupedChartData = (
  filteredResults: FormattedClassificationResult[],
  schemes: ClassificationSchemeRead[],
  groupingSchemeId: number | null,
  groupingFieldKey: string | null
) => {
  console.log('[Grouped Chart] Processing filtered results:', filteredResults.length, 'Group By:', groupingSchemeId, groupingFieldKey);
  const valueCountsMap = new Map<string, { count: number; documents: number[]; schemeName: string; valueKey: string }>();
  let calculatedMaxCount = 0;

  // Filter results based on selected grouping scheme
  const resultsForGroupingScheme = groupingSchemeId ? filteredResults.filter(r => r.scheme_id === groupingSchemeId) : [];
  if (resultsForGroupingScheme.length === 0 || groupingSchemeId === null) {
      console.log('[Grouped Chart] No results for selected scheme or no scheme selected.');
      return { data: [], maxCount: 0 };
  }

  const selectedScheme = schemes.find(s => s.id === groupingSchemeId);
  if (!selectedScheme) {
     console.error('[Grouped Chart] Selected scheme not found.');
     return { data: [], maxCount: 0 };
  }

  resultsForGroupingScheme.forEach(result => {
    try {
      let actualValue: any;
      // --- MODIFIED: Extract value based on groupingFieldKey ---
      const mockFilter: ResultFilter = {
         schemeId: groupingSchemeId,
         // Use nullish coalescing to provide undefined if groupingFieldKey is null
         fieldKey: groupingFieldKey ?? undefined,
         operator: 'equals', // Operator doesn't matter for extraction
         value: '', // Value doesn't matter for extraction
         isActive: true
      };
      const { definition: targetDefinition } = getTargetFieldDefinition(mockFilter, schemes);

      if (!targetDefinition) {
         console.warn("Could not find definition for grouping key:", groupingFieldKey, "in scheme:", selectedScheme.name);
         actualValue = 'Error: Field Not Found';
      } else {
          // Logic to extract the specific value based on the targetDefinition and groupingFieldKey
          if ('dict_keys' in targetDefinition && targetDefinition.type === 'List[Dict[str, any]]' && groupingFieldKey) {
              // List[Dict] - need to decide *how* to group. Group by presence? Count? First value?
              // Let's group by the *values* found for the specified key across all dicts in the list.
              // This might create many bars. For now, let's just say "Complex Data" as a placeholder.
              // A more robust approach would be needed here based on desired behavior.
              if (Array.isArray(result.value)) {
                 // Collect all unique values for the key from the list of dicts
                 const valuesInList = result.value
                     .map(item => (typeof item === 'object' && item !== null && groupingFieldKey in item) ? item[groupingFieldKey] : undefined)
                     .filter(v => v !== undefined);
                 // Use the *first* value found for simplicity, or a summary string
                 actualValue = valuesInList.length > 0 ? valuesInList[0] : 'N/A'; // Simplified: use first value
                 // TODO: Or maybe count occurrences of the key? Needs clearer spec.
              } else {
                  actualValue = 'Invalid Data Structure';
              }
          } else if ('name' in targetDefinition) {
               // Top-level field or simple type
               const fieldValue = (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value))
                  ? result.value[targetDefinition.name]
                  : result.value;
               actualValue = fieldValue;
          } else {
               actualValue = 'Unknown Field Structure';
          }
      }
      // --- End MODIFIED value extraction ---

      // Format the extracted value for consistent key generation
      // Use the formatDisplayValue helper for consistency, converting result to string for map key
      const formattedValue = formatDisplayValue(actualValue, selectedScheme);
      const valueKey = String(formattedValue ?? 'N/A'); // Ensure valueKey is a string

      // Use selectedScheme.name which is guaranteed to exist here
      const mapKey = `${selectedScheme.name}_${valueKey}`;

      const currentEntry = valueCountsMap.get(mapKey) || { count: 0, documents: [], schemeName: selectedScheme.name, valueKey: valueKey };
      currentEntry.count += 1;
      if (!currentEntry.documents.includes(result.document_id)) {
        currentEntry.documents.push(result.document_id);
      }
      valueCountsMap.set(mapKey, currentEntry);
      
      // Update max count
      if (currentEntry.count > calculatedMaxCount) {
        calculatedMaxCount = currentEntry.count;
      }
      
    } catch (error) {
      console.error('[Grouped Chart] Error processing result for grouping:', error, result);
    }
  });

  // Convert map to array format suitable for recharts bar chart
  // X-axis = valueString (now simplified to just the valueKey), Y-axis = count
  const finalGroupedData = Array.from(valueCountsMap.values()).map(entry => ({
    valueString: entry.valueKey, // Simplified X-axis label
    count: entry.count,
    documents: entry.documents,
    schemeName: entry.schemeName,
    valueKey: entry.valueKey
  }));

  console.log('[Grouped Chart] Final grouped data:', finalGroupedData, 'Max Count:', calculatedMaxCount);
  // Sort grouped data alphabetically by valueString for consistent bar order
  finalGroupedData.sort((a, b) => a.valueString.localeCompare(b.valueString));
  return { data: finalGroupedData, maxCount: calculatedMaxCount };
};

const ClassificationResultsChart: React.FC<Props> = ({ results, schemes, documents, onDocumentSelect, onDataPointClick, filters }) => {
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
        const docId = result.document_id;
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
    const filteredResults = results.filter(result => filteredDocIds.includes(result.document_id));
    // --- END FILTERING STEP ---

    if (filteredResults.length === 0 && results.length > 0) {
        // If filters removed all results, return empty data
         return { chartData: [], groupedData: [], maxGroupCount: 'auto' };
    }

    // Return processed data based on the isGrouped state
    if (isGrouped) {
      const groupedResult = processGroupedChartData(filteredResults, schemes, groupingSchemeId, groupingFieldKey);
      return { chartData: [], groupedData: groupedResult.data, maxGroupCount: groupedResult.maxCount };
    } else {
      const lineData = processLineChartData(filteredResults, schemes, documents);
      return { chartData: lineData, groupedData: [], maxGroupCount: 'auto' }; // 'auto' for line chart Y-axis
    }
  }, [results, schemes, isGrouped, documents, filters, groupingSchemeId, groupingFieldKey]);

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
            <Label htmlFor="schema-select" className="text-sm">Schemas to plot:</Label>
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
            <Label htmlFor="group-scheme-select" className="text-sm">Scheme:</Label>
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
               <Label htmlFor="group-key-select" className="text-sm">Field/Key:</Label>
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
                <Label className="text-sm">Field/Key:</Label>
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
                <Tooltip content={<CustomTooltip isGrouped={isGrouped} schemes={schemes} documents={documents} results={results} showStatistics={showStatistics} />} />
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
                <Tooltip content={<CustomTooltip isGrouped={isGrouped} schemes={schemes} documents={documents} results={results} showStatistics={showStatistics} />} />
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
                  documents={documents}
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
  documents?: DocumentRead[];
  results: FormattedClassificationResult[];
  showStatistics?: boolean;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, isGrouped, schemes, documents, results, showStatistics }) => {
  if (!active || !payload || !payload.length) return null;
  
  // Get the data point from the payload
  const dataPoint = payload[0]?.payload as ChartDataPoint | GroupedDataPoint | undefined;
  if (!dataPoint) return null;
  
  // --- Find documents and their values using dataPoint --- START
  // Get the list of document IDs associated with this specific data point (date or value group)
  const relevantDocIds = ('documents' in dataPoint) ? dataPoint.documents : []; // Ensure documents property exists
  // Find the full DocumentRead objects corresponding to the IDs
  const docsToShow = relevantDocIds
    .map(docId => documents?.find(d => d.id === docId))
    .filter((doc): doc is DocumentRead => !!doc); // Filter out undefined documents
  // --- Find documents and their values using dataPoint --- END
  
  return (
    <div className="custom-tooltip bg-card/95 p-3 border border-border rounded-lg shadow-lg max-w-md">
      {/* --- Date or Group Info --- */}
      <div className="mb-3 pb-2 border-b border-border">
        <p className="text-sm font-semibold text-foreground">
          {isGrouped && 'valueString' in dataPoint
            ? `Group: ${dataPoint.schemeName} - ${dataPoint.valueString}`
            : `Date: ${label}`}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {docsToShow.length} document{docsToShow.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* --- Statistics Section (when not grouped and statistics mode is active) --- */}
      {!isGrouped && showStatistics && 'stats' in dataPoint && dataPoint.stats && (
        <div className="mb-3 pb-2 border-b border-border">
          <p className="text-sm font-medium mb-2">Statistics:</p>
          <div className="grid grid-cols-1 gap-2">
            {Object.entries(dataPoint.stats)
              .filter(([_, stats]) => stats.count > 0)
              .map(([schemeName, stats]) => (
                <div key={schemeName} className="px-2 py-1.5 bg-muted/30 rounded-sm">
                  <p className="text-sm font-medium mb-1">{schemeName}:</p>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    <div className="flex flex-col items-center p-1 bg-blue-500/10 rounded">
                      <span className="text-blue-500 font-semibold">Min</span>
                      <span>{stats.min.toFixed(1)}</span>
                    </div>
                    <div className="flex flex-col items-center p-1 bg-green-500/10 rounded">
                      <span className="text-green-500 font-semibold">Avg</span>
                      <span>{stats.avg.toFixed(1)}</span>
                    </div>
                    <div className="flex flex-col items-center p-1 bg-red-500/10 rounded">
                      <span className="text-red-500 font-semibold">Max</span>
                      <span>{stats.max.toFixed(1)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 text-center">
                    {stats.count} data point{stats.count !== 1 ? 's' : ''}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* --- Top Categories Section --- */}
      {!isGrouped && 'categoryFrequency' in dataPoint && dataPoint.categoryFrequency && (
        <div className="mb-3 pb-2 border-b border-border">
          <p className="text-sm font-medium mb-2">Most Frequent Items:</p>
          <div className="grid grid-cols-1 gap-2">
            {Object.entries(dataPoint.categoryFrequency)
              .filter(([_, categories]) => Object.keys(categories).length > 0)
              .map(([schemeName, categories]) => {
                // Get top categories
                const topCategories = Object.entries(categories)
                  .sort((a, b) => b[1] - a[1])
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
                            {count}
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

      {/* --- Documents List --- */}
      {docsToShow.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Documents:</p>
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {docsToShow.slice(0, 5).map((doc) => (
              <div key={doc.id} className="flex items-center px-2 py-1 bg-muted/20 rounded-sm">
                <span className="text-xs truncate">
                  <DocumentLink documentId={doc.id}>
                    {doc.title || `Document ${doc.id}`}
                  </DocumentLink>
                </span>
              </div>
            ))}
            {docsToShow.length > 5 && (
              <div className="text-xs text-muted-foreground italic text-center mt-1">
                ...and {docsToShow.length - 5} more document{docsToShow.length - 5 !== 1 ? 's' : ''}
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
  documents?: DocumentRead[];
}> = ({ selectedPoint, results, schemes, documents }) => {
  console.log("[DialogContent] DocumentResults rendering. Selected Point:", selectedPoint);

  // Helper to get results for a specific doc ID relevant to the selected point/group
  const getRelevantResultsForDoc = (docId: number): FormattedClassificationResult[] => {
    if ('dateString' in selectedPoint) {
      return results.filter(r =>
        r.document_id === docId &&
        schemes.some(as => as.id === r.scheme_id)
      );
    } else if ('valueString' in selectedPoint) {
      const pointData = selectedPoint as GroupedDataPoint;
      const relevantSchemeRead = schemes.find(s => s.name === pointData.schemeName);
      if (!relevantSchemeRead) return [];

      // --- ADAPT SchemeRead before using in service ---
      const adaptedScheme = adaptSchemeReadToScheme(relevantSchemeRead);

      const specificResult = results.find(r =>
        r.document_id === docId &&
        r.scheme_id === relevantSchemeRead.id &&
        // --- Use adapted scheme here ---
        String(ClassificationService.getFormattedValue(r, adaptedScheme)) === String(pointData.valueKey)
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
      {docIdsToShow.map(docId => {
        const document = documents?.find(d => d.id === docId);
        const docResults = getRelevantResultsForDoc(docId);

        // Find relevant SchemeRead objects based on the results found
        const schemesForResultsRead = schemes.filter(s =>
          docResults.some(dr => dr.scheme_id === s.id)
        );

         if (docResults.length === 0) {
            // Return document header even if no results match active schemes/filters
           return (
             <div key={docId} className="pb-2">
               {document && (
                 <div className="mb-3">
                   <span className="font-medium">Document: </span>
                   <DocumentLink documentId={document.id}>
                     {document.title || `Document ${document.id}`}
                   </DocumentLink>
                   <p className="text-xs text-muted-foreground italic">(No results matching active schemes/filters for this date/group)</p>
                 </div>
               )}
             </div>
           );
         }

        return (
          <div key={docId} className="pb-2">
            {document && (
              <div className="mb-3">
                <span className="font-medium">Document: </span>
                <DocumentLink documentId={document.id}>
                  {document.title || `Document ${document.id}`}
                </DocumentLink>
              </div>
            )}
            {/* Pass the SchemeRead objects; ClassificationResultDisplay should handle adaptation internally */}
            <ClassificationResultDisplay
              result={docResults.map(r => resultToResultRead(r))}
              scheme={schemesForResultsRead} // Pass SchemeRead[]
              useTabs={false}
              compact={false}
              renderContext="dialog"
            />
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(ClassificationResultsChart);