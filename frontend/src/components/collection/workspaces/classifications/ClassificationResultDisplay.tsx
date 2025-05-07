import React, { useState, useMemo } from 'react';
import { ClassificationResultRead, ClassificationSchemeRead } from '@/client';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from "@/components/ui/scroll-area";
import { SchemeField, FieldType } from "@/lib/classification/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClassificationService } from '@/lib/classification/service';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from "@/lib/utils"; // Import cn helper
import { FormattedClassificationResult } from '@/lib/classification/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle } from 'lucide-react';
import {
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    Radar,
    ResponsiveContainer,
    Legend
} from 'recharts';
import { HelpCircle } from 'lucide-react';

// Component-level types (if needed, e.g., for props)
interface ClassificationResultDisplayProps {
  /** The classification result(s) to display. Can be a single result or an array. */
  result: FormattedClassificationResult | FormattedClassificationResult[];
  /** The classification scheme(s) associated with the result(s). */
  scheme: ClassificationSchemeRead | ClassificationSchemeRead[];
  /** If true, renders a more compact version suitable for previews. Defaults to false. */
  compact?: boolean;
  /** Optional: Key of the specific field to display, overriding compact view logic for which field. */
  targetFieldKey?: string | null;
  /** If true and multiple results are provided, renders them in tabs (unless overridden by context). Defaults to false. */
  useTabs?: boolean;
  /** Optional context for rendering adjustments */
  renderContext?: 'dialog' | 'table' | 'default';
  /** Optional: Array of field keys to specifically display. If null or undefined, displays according to other rules (compact/targetFieldKey). */
  selectedFieldKeys?: string[] | null;
  /** Optional: Maximum number of fields to show when not compact and specific fields aren't selected. */
  maxFieldsToShow?: number;
}

interface SingleClassificationResultProps {
  result: FormattedClassificationResult;
  scheme: ClassificationSchemeRead;
  compact?: boolean;
  targetFieldKey?: string | null;
  renderContext?: 'dialog' | 'table' | 'default';
  selectedFieldKeys?: string[] | null;
  maxFieldsToShow?: number;
}

interface ConsolidatedSchemesViewProps {
  results: FormattedClassificationResult[];
  schemes: ClassificationSchemeRead[];
  compact?: boolean;
  targetFieldKey?: string | null;
  useTabs?: boolean;
  renderContext?: 'dialog' | 'table' | 'default';
  selectedFieldKeys?: string[] | null;
  maxFieldsToShow?: number;
}

// Add missing EnhancedClassificationResultRead type if not globally defined
export interface EnhancedClassificationResultRead extends ClassificationResultRead {
  display_value?: string | number | Record<string, any> | null;
  // MODIFIED: Add optional run fields to match backend updates
  run_name?: string | null;
  run_description?: string | null;
}


/**
 * Component for displaying a single classification result based on its scheme.
 */
const SingleClassificationResult: React.FC<SingleClassificationResultProps> = ({
    result,
    scheme,
    compact = false,
    targetFieldKey = null,
    renderContext = 'default',
    selectedFieldKeys = null,
    maxFieldsToShow = 10
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  /**
   * Adapts an API field definition (like ClassificationFieldCreate) to the internal SchemeField type.
   * @param apiField - The field definition object from the API.
   * @returns A SchemeField object compatible with internal formatting logic.
   */
  const adaptFieldToSchemeField = (apiField: any): SchemeField => ({
      name: apiField.name,
      type: apiField.type as FieldType, // Cast to the imported FieldType
      description: apiField.description,
      config: {
          scale_min: apiField.scale_min ?? undefined,
          scale_max: apiField.scale_max ?? undefined,
          is_set_of_labels: apiField.is_set_of_labels ?? undefined,
          labels: apiField.labels ?? undefined,
          dict_keys: apiField.dict_keys ? apiField.dict_keys.map((dk: any) => ({ name: dk.name, type: dk.type })) : undefined
      }
  });

  // --- MODIFIED: Determine fields to actually display ---
  const fieldsToDisplay = useMemo(() => {
    let fields = scheme.fields.map(adaptFieldToSchemeField); // Adapt all fields initially

    if (selectedFieldKeys && selectedFieldKeys.length > 0) {
      // Filter by explicitly selected keys
      fields = fields.filter(f => selectedFieldKeys.includes(f.name));
    } else if (targetFieldKey) {
      // Filter by single target key (overrides compact)
      fields = fields.filter(f => f.name === targetFieldKey);
    } else if (compact) {
      // Compact mode: show only the first field
      fields = fields.slice(0, 1);
    }
    // If no specific rules applied, 'fields' remains all adapted fields

    return fields;
  }, [scheme.fields, selectedFieldKeys, targetFieldKey, compact]);

  // Check if *any* of the fields *to be displayed* are potentially long
  const isPotentiallyLong = useMemo(() => {
    return fieldsToDisplay.some(f => f.type === 'List[Dict[str, any]]');
  }, [fieldsToDisplay]);

  // --- ADD: Check status --- 
  const isFailed = result.status === 'failed';
  // --- END ADD --- 

  /**
   * Formats the value of a single classification field for display.
   * Handles different field types (int, str, List[str], List[Dict[str, any]]).
   * @param rawValueObject - The entire 'value' object from the ClassificationResultRead.
   * @param field - The SchemeField definition for the field being formatted.
   * @returns A React node representing the formatted value.
   */
  const formatFieldValue = (rawValueObject: any, field: SchemeField): React.ReactNode => {
      // --- REMOVED Check for 'classification_output' wrapper ---
      let valueForField: any;

      // NEW Logic: Assume rawValueObject is the structured dictionary OR a primitive
      if (typeof rawValueObject === 'object' && rawValueObject !== null && !Array.isArray(rawValueObject)) {
          // If it's an object, try to get the value using the field name
          valueForField = rawValueObject[field.name];
          if (valueForField === undefined && field.type !== 'List[Dict[str, any]]') {
             console.warn(`formatFieldValue: Value for field '${field.name}' was undefined in object. Raw:`, rawValueObject);
             // Keep valueForField as undefined, will be handled below
          }
      } else {
          // If rawValueObject is not an object (e.g., string, number, array), it's the value itself
          // This handles cases where the scheme has only one field and the LLM might return the value directly
          valueForField = rawValueObject;
      }

      // --- Logging ---
      console.log(`formatFieldValue: Field='${field.name}', Type='${field.type}', RawValue=`, rawValueObject, `ExtractedValue=`, valueForField);
      // --- END LOGGING ---

      // Handle null, undefined, or explicit "N/A"
      if (valueForField === null || valueForField === undefined) {
           console.log(`formatFieldValue: Rendering N/A because valueForField is null or undefined.`);
           return <span className="text-gray-400 italic">N/A</span>;
      }
      if (typeof valueForField === 'string' && valueForField.toLowerCase() === 'n/a') {
          console.log(`formatFieldValue: Rendering N/A because valueForField is the string 'N/A'.`);
          return <span className="text-gray-400 italic">N/A</span>;
      }

      switch (field.type) {
          case 'int':
              // Handle integer type, including binary interpretation (0/1 scale)
              const num = Number(valueForField);
              if (!isNaN(num)) {
                  if (field.config?.scale_min === 0 && field.config?.scale_max === 1) {
                      return <Badge variant={num > 0.5 ? "default" : "outline"} className="bg-green-600/75 text-black">{num > 0.5 ? 'True' : 'False'}</Badge>;
                  }
                  // Display integer directly
                  return <Badge variant="outline" className="bg-green-200/40 text-black">{String(num)}</Badge>; 
              }
              // Fallback if conversion to number fails
              return <span>{String(valueForField)}</span>;

          case 'List[str]':
              // Handle list of strings
              if (Array.isArray(valueForField)) {
                  if (valueForField.length === 0) return <span className="text-gray-400 italic"></span>;
                  // Render each string in the list as a badge
                  return (
                      <div className="flex flex-wrap gap-1">
                          {valueForField.map((item, i) => (
                              <Badge key={i} variant="secondary">{String(item)}</Badge>
                          ))}
                      </div>
                  );
              }
              // --- MODIFIED: Handle non-array case for List[str] ---
              else if (typeof valueForField === 'string') {
                  // If we expected a list but got a string, render the string as a single badge
                  console.warn(`formatFieldValue: Expected List[str] for field '${field.name}', but received a string. Rendering as single item.`);
                  return <Badge variant="secondary">{String(valueForField)}</Badge>;
              }
              // --- END MODIFICATION ---
              // Error display if the value is not an array or string
              console.error(`formatFieldValue: Expected List[str] for field '${field.name}', but received type ${typeof valueForField}. Value:`, valueForField);
              return <span className="text-red-500 italic">Expected List[str], got: {typeof valueForField}</span>;

          case 'str':
              // Handle simple string type
              return <span>{String(valueForField)}</span>;

          case 'List[Dict[str, any]]':
              const dataArray = valueForField; 
              if (Array.isArray(dataArray)) {
                  if (dataArray.length === 0) {
                      return <p className="text-sm text-muted-foreground italic">{compact ? 'None' : 'No items found.'}</p>;
                  }
                  
                  // --- MODIFIED: itemsToShow depends on isExpanded --- 
                  const maxItemsInitial = compact ? 2 : 5; // Initial limit when collapsed
                  const itemsToShow = isExpanded ? dataArray : dataArray.slice(0, maxItemsInitial);
                  const isTruncated = !isExpanded && dataArray.length > maxItemsInitial;

                  if (compact) {
                    // Compact mode logic (unchanged, already handles truncation differently)
                    return itemsToShow.map((itemObject, index) => {
                        if (typeof itemObject !== 'object' || itemObject === null) return null; 

                        let previewText = itemObject?.statement || Object.values(itemObject)[0] || 'Item Data';
                        if (typeof previewText !== 'string') previewText = String(previewText);
                        
                        const maxCompactLength = 35; 
                        if (previewText.length > maxCompactLength) {
                          previewText = previewText.substring(0, maxCompactLength) + '...';
                        }

                        return (
                          <Badge 
                            key={index} 
                            variant="outline" 
                            className="text-xs mr-1 mb-1"
                            title={itemObject?.statement || String(Object.values(itemObject)[0] || '')}
                          >
                             {previewText}
                          </Badge>
                        );
                      });
                  } else {
                    // Non-compact mode: Render detailed structure
                    return (
                        <div className="grid grid-cols-1 gap-2">
                            {itemsToShow.map((itemObject, index) => (
                                typeof itemObject === 'object' && itemObject !== null ? (
                                    <div key={index} className="p-1.5 bg-muted/10 rounded border border-metadata grid grid-cols-1 gap-1">
                                        {Object.entries(itemObject).map(([key, itemValue]) => (
                                            <div key={key} className="flex items-start text-xs">
                                                <Badge variant="secondary" className="mr-2 shrink-0">{key}</Badge>
                                                <span className="min-w-0 break-words">{String(itemValue ?? 'N/A')}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div key={index} className="p-1.5 bg-red-100 rounded border border-red-300 text-xs text-red-700">
                                        Invalid item structure: {String(itemObject)}
                                    </div>
                                )
                            ))}
                            {/* --- MODIFIED: Show message only if truncated --- */}
                            {isTruncated && (
                              <p className="text-xs text-muted-foreground italic mt-1">... and {dataArray.length - maxItemsInitial} more items.</p>
                            )}
                        </div>
                    );
                  }
              } else {
                  console.error(`Error in ClassificationResultDisplay: Expected an array for field '${field.name}' of type List[Dict[str, any]], but received:`, valueForField, 'Raw Value Object:', rawValueObject);
                  return <span className="text-sm text-red-500 italic">Error: Expected an array, received {typeof valueForField}. Check console.</span>;
              }

          default:
              // Fallback for unhandled field types
              console.warn(`Warning in ClassificationResultDisplay: Unhandled field type '${field.type}' for field '${field.name}'. Value:`, valueForField);
              // Attempt to render objects as JSON
              if (typeof valueForField === 'object' && valueForField !== null) {
                  return <pre className="text-xs overflow-auto bg-muted/10 p-1 rounded">{JSON.stringify(valueForField, null, 2)}</pre>;
              }
              // Default to string conversion
              return <span>{String(valueForField)}</span>;
      }
  };


  // --- Render the fields defined in the scheme ---
  if (!scheme || !Array.isArray(scheme.fields)) {
      return <div className="text-sm text-red-500 italic">Invalid scheme provided.</div>;
  }
  if (result.value === null || result.value === undefined) {
       return <div className="text-sm text-gray-500 italic">No classification value available.</div>;
  }

  // --- MODIFIED: Conditional styling based on context ---
  const containerClasses = cn(
    'space-y-2 h-full flex flex-col',
    (renderContext === 'table') 
      ? 'border-2 border-results p-2 rounded-md' // Always border in table
      : (!compact && renderContext !== 'dialog' && 'border-2 border-results p-2 rounded-md')
  );

  return (
      <div className={containerClasses}>
          {/* Only show scheme name if not compact OR if context is not dialog OR table (to avoid repetition) */}
          {(!compact || (renderContext !== 'dialog' && renderContext !== 'table')) && (
             <div className="flex items-center justify-between mb-2">
               <span className="font-medium text-base text-yellow-500">{scheme.name}</span>
               {/* --- ADD: Failure Indicator --- */} 
               {isFailed && (
                 <TooltipProvider delayDuration={100}>
                   <Tooltip>
                     <TooltipTrigger asChild>
                       <AlertCircle className="h-4 w-4 text-destructive opacity-80 cursor-help ml-2" />
                     </TooltipTrigger>
                     <TooltipContent side="top" align="end">
                       <p className="text-xs max-w-xs break-words">
                         Failed: {result.error_message || 'Unknown error'}
                       </p>
                     </TooltipContent>
                   </Tooltip>
                 </TooltipProvider>
               )}
               {/* --- END ADD --- */} 
             </div>
          )}
          {/* Add scheme name specifically for dialog if it's the compact view (might be redundant if title already shows) */}
          {/* {compact && renderContext === 'dialog' && (
             <div className="font-medium text-sm mb-1">{scheme.name}</div>
          )} */}

          <div
            className={cn(
              'transition-all duration-300 ease-in-out',
              renderContext !== 'table' && !isExpanded && isPotentiallyLong && (compact ? 'max-h-16 overflow-hidden' : renderContext === 'dialog' ? 'max-h-40 overflow-hidden' : 'max-h-24 overflow-hidden'),
              renderContext !== 'table' && isExpanded && isPotentiallyLong && 'max-h-80 overflow-y-auto'
            )}
          >
            <div className={'space-y-3'}>
              {fieldsToDisplay.map((schemeField, idx) => {
                  // --- MODIFIED: Field Filtering/Selection Logic ---
                  // If a specific targetFieldKey is provided, only render that field
                  if (targetFieldKey) {
                      if (schemeField.name !== targetFieldKey) {
                          return null; // Skip rendering fields that don't match the target key
                      }
                      // Proceed to render the single targeted field below
                  }
                  // Original compact logic: Only show first field if compact AND no targetFieldKey is set
                  else if (compact && idx > 0) {
                      return null; // Skip other fields in compact mode when no specific key is targeted
                  }
                  // --- END MODIFICATION ---

                  const justificationValue = (typeof result.value === 'object' && result.value !== null) ? result.value[`${schemeField.name}_justification`] : undefined;
                  const boxesValue = (typeof result.value === 'object' && result.value !== null) ? result.value[`${schemeField.name}_boxes`] : undefined;
  
                  return (
                      <div key={idx} className={ 'space-y-1 border-b border-dashed border-border/30 pb-3 last:border-b-0 last:pb-0'}>
                          {/* --- Primary Field Value --- */}
                          <div>
                            <div className="font-medium text-blue-400 italic inline-flex items-center mr-2">
                              {schemeField.name}
                              {/* --- ADDED: Tooltip for Justification --- */}
                              {justificationValue && typeof justificationValue === 'string' && (
                                  <TooltipProvider delayDuration={100}>
                                      <Tooltip>
                                          <TooltipTrigger asChild>
                                              {/* Using a subtle icon as the trigger */}
                                              <HelpCircle className="h-3.5 w-3.5 ml-1.5 text-muted-foreground cursor-help opacity-70 hover:opacity-100" />
                                          </TooltipTrigger>
                                          <TooltipContent side="top" align="start" className="max-w-xs border-border shadow-lg z-[1000]">
                                              <p className="text-xs font-semibold mb-1 text-indigo-400">Justification:</p>
                                              <p className="text-xs">{justificationValue}</p>
                                          </TooltipContent>
                                      </Tooltip>
                                  </TooltipProvider>
                              )}
                              {/* --- END ADDED --- */}
                            </div>
                            <div className="inline-block">{formatFieldValue(result.value, schemeField)}</div>
                          </div>
  
                          {/* --- Justification (Removed direct display) --- */}
                          {/* {justificationValue && typeof justificationValue === 'string' && (
                            <div className="pl-4 mt-1 text-xs text-muted-foreground bg-muted/10 p-1.5 rounded border border-dashed border-indigo-300/30">
                                <span className="font-semibold text-indigo-400 mr-1">Justification:</span>
                                {justificationValue}
                            </div>
                          )} */}
  
                          {/* --- Bounding Boxes (Keep as is) --- */}
                          {boxesValue && Array.isArray(boxesValue) && boxesValue.length > 0 && (
                              <div className="mt-1 text-xs text-muted-foreground italic">
                                  {boxesValue.map((box, index) => (
                                      <span key={index} className="text-xs">
                                          {box.toString()}
                                      </span>
                                  ))}
                              </div>
                          )}
                      </div>
                  );
              })}
            </div>
          </div>
          {isPotentiallyLong && !compact && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-1 text-xs w-full justify-start text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? (
                <><ChevronUp className="h-3 w-3 mr-1" /> Show Less</>
              ) : (
                <><ChevronDown className="h-3 w-3 mr-1" /> Show More</>
              )}
            </Button>
          )}
      </div>
  );
};

/**
 * Component to display multiple classification results, potentially in tabs or a consolidated list.
 */
const ConsolidatedSchemesView: React.FC<ConsolidatedSchemesViewProps> = ({
    results,
    schemes,
    compact = false,
    targetFieldKey = null,
    useTabs = false,
    renderContext = 'default',
    selectedFieldKeys = null,
    maxFieldsToShow
}) => {
  // --- MODIFIED: Force useTabs to false if context is dialog ---
  const actuallyUseTabs = useTabs && renderContext !== 'dialog';

  if (actuallyUseTabs) {
    return (
      <Tabs defaultValue={schemes[0]?.id?.toString() || "0"} className="w-full">
        <TabsList className="mb-2 overflow-x-auto h-auto justify-start">
          {schemes.map(s => (
            <TabsTrigger key={s.id} value={s.id?.toString() || "0"} className="whitespace-nowrap">
              {s.name}
            </TabsTrigger>
          ))}
        </TabsList>
        
        {schemes.map(s => {
          const schemeResult = results.find(r => r.scheme_id === s.id);
          return (
            <TabsContent key={s.id} value={s.id?.toString() || "0"}>
              {schemeResult ? (
                <SingleClassificationResult
                  result={schemeResult}
                  scheme={s}
                  compact={compact}
                  targetFieldKey={targetFieldKey}
                  renderContext={renderContext}
                  selectedFieldKeys={selectedFieldKeys}
                  maxFieldsToShow={maxFieldsToShow}
                />
              ) : (
                <div className="text-sm text-gray-500 italic">No results for this scheme</div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    );
  }
  
  // Default: Consolidated view
  return (
    // Reduced spacing for dialog context
    <div className={cn("ml-4", renderContext === 'dialog' ? "space-y-3" : "space-y-6")}>
      {schemes.map(scheme => {
        const schemeResult = results.find(r => r.scheme_id === scheme.id);
        if (!schemeResult) return null; // Skip if no result for this scheme
        
        return (
          <SingleClassificationResult
            key={scheme.id}
            result={schemeResult}
            scheme={scheme}
            compact={compact}
            targetFieldKey={targetFieldKey}
            renderContext={renderContext}
            selectedFieldKeys={selectedFieldKeys}
            maxFieldsToShow={maxFieldsToShow}
          />
        );
      })}
    </div>
  );
};


/**
 * Main component to display one or more classification results.
 * It handles routing to SingleClassificationResult or ConsolidatedSchemesView.
 */
const ClassificationResultDisplay: React.FC<ClassificationResultDisplayProps> = ({
    result,
    scheme,
    compact = false,
    targetFieldKey = null,
    useTabs = false,
    renderContext = 'default',
    selectedFieldKeys = null,
    maxFieldsToShow
}) => {
    
  /**
   * Finds the matching ClassificationSchemeRead object for a given result's scheme_id.
   * @param res - The classification result.
   * @param sch - The scheme or array of schemes to search within.
   * @returns The matching scheme object or null if not found.
   */
  const findSchemeForResult = (res: ClassificationResultRead | EnhancedClassificationResultRead, sch: ClassificationSchemeRead | ClassificationSchemeRead[]): ClassificationSchemeRead | null => {
    if (!res || !sch) return null;
    // If 'sch' is an array, find the scheme by ID
    if (Array.isArray(sch)) {
      return sch.find(s => s.id === res.scheme_id) || null;
    }
    // If 'sch' is a single object, check if its ID matches
    return sch.id === res.scheme_id ? sch : null;
  };

  // --- MODIFIED: Handle array result with stricter type checking --- 
  if (Array.isArray(result)) {
    // Map results to include their schemes, then filter out those without a scheme
    const validResultsWithSchemes = result
      .map(r => ({ result: r, scheme: findSchemeForResult(r, scheme) }))
      .filter((item): item is { result: FormattedClassificationResult; scheme: ClassificationSchemeRead } => item.scheme !== null);
      // This filter explicitly tells TS that item.scheme is non-null in the resulting array

    if (validResultsWithSchemes.length === 0) {
      return <div className="text-sm text-gray-500 italic">No valid classification results with matching schemes found.</div>;
    }

    // If only one valid result, render it directly
    if (validResultsWithSchemes.length === 1) {
      const { result: singleResult, scheme: singleScheme } = validResultsWithSchemes[0];
      // singleScheme is guaranteed non-null here due to the filter
      return (
        <SingleClassificationResult
          result={singleResult}
          scheme={singleScheme}
          compact={compact}
          targetFieldKey={targetFieldKey}
          renderContext={renderContext}
          selectedFieldKeys={selectedFieldKeys}
          maxFieldsToShow={maxFieldsToShow}
        />
      );
    }
    
    // If multiple valid results, use ConsolidatedSchemesView
    // Pass the already filtered schemes (guaranteed non-null)
    return (
      <ConsolidatedSchemesView
        results={validResultsWithSchemes.map(item => item.result)}
        schemes={validResultsWithSchemes.map(item => item.scheme)}
        compact={compact}
        targetFieldKey={targetFieldKey}
        useTabs={useTabs}
        renderContext={renderContext}
        selectedFieldKeys={selectedFieldKeys}
        maxFieldsToShow={maxFieldsToShow}
      />
    );
  }
  
  // Handle case where 'result' is a single object
  if (!Array.isArray(result)) {
    const matchingScheme = findSchemeForResult(result, scheme);
    if (matchingScheme) {
      // matchingScheme is non-null here
      return (
        <SingleClassificationResult
          result={result}
          scheme={matchingScheme}
          compact={compact}
          targetFieldKey={targetFieldKey}
          renderContext={renderContext}
          selectedFieldKeys={selectedFieldKeys}
          maxFieldsToShow={maxFieldsToShow}
        />
      );
    }
    return <div className="text-sm text-gray-500 italic">No matching scheme found for this result. Scheme ID: {result.scheme_id}</div>;
  }
  
  // Fallback message for invalid props configuration
  return <div className="text-sm text-gray-500 italic">Invalid result or scheme configuration provided.</div>;
};

export default ClassificationResultDisplay;