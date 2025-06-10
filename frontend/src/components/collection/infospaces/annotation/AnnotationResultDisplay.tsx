import React, { useState, useMemo } from 'react';
import { AnnotationRead, AnnotationSchemaRead } from '@/client/models';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from "@/components/ui/scroll-area";
import { SchemeField, FieldType } from "@/lib/annotations/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnnotationService } from '@/lib/annotations/service';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from "@/lib/utils"; // Import cn helper
import { FormattedAnnotation } from '@/lib/annotations/types';
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
interface AnnotationResultDisplayProps {
  /** The annotation result(s) to display. Can be a single result or an array. */
  result: FormattedAnnotation | FormattedAnnotation[];
  /** The annotation schema(s) associated with the result(s). */
  schema: AnnotationSchemaRead | AnnotationSchemaRead[];
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
  /** Optional: A specific value within a field (e.g., a List[str] item) to highlight */
  highlightValue?: string | null;
}

interface SingleAnnotationResultProps {
  result: FormattedAnnotation;
  schema: AnnotationSchemaRead;
  compact?: boolean;
  targetFieldKey?: string | null;
  renderContext?: 'dialog' | 'table' | 'default';
  selectedFieldKeys?: string[] | null;
  maxFieldsToShow?: number;
  highlightValue?: string | null;
}

interface ConsolidatedSchemasViewProps {
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  compact?: boolean;
  targetFieldKey?: string | null;
  useTabs?: boolean;
  renderContext?: 'dialog' | 'table' | 'default';
  selectedFieldKeys?: string[] | null;
  maxFieldsToShow?: number;
  highlightValue?: string | null;
}

// This type is likely not needed if the base AnnotationRead from the client is sufficient.
// Keeping it commented out for now.
// export interface EnhancedAnnotationRead extends AnnotationRead {
//   display_value?: string | number | Record<string, any> | null;
//   run_name?: string | null;
//   run_description?: string | null;
// }


/**
 * Component for displaying a single annotation result based on its schema.
 */
const SingleAnnotationResult: React.FC<SingleAnnotationResultProps> = ({
    result,
    schema,
    compact = false,
    targetFieldKey = null,
    renderContext = 'default',
    selectedFieldKeys = null,
    maxFieldsToShow = 10,
    highlightValue = null
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // This adapter is complex because `output_contract` is a JSON schema, not a simple fields array.
  // This logic will need to be much more robust.
  const adaptContractToSchemeFields = (contract: any): SchemeField[] => {
      const properties = contract?.properties;
      if (!properties) return [];
      return Object.entries(properties).map(([key, value]: [string, any]) => ({
          name: key,
          type: value.type, // This is a simplification
          description: value.description || '',
          config: {} // Placeholder
      }));
  }

  const fieldsToDisplay = useMemo(() => {
    let fields = adaptContractToSchemeFields(schema.output_contract);

    if (selectedFieldKeys && selectedFieldKeys.length > 0) {
      fields = fields.filter(f => selectedFieldKeys.includes(f.name));
    } else if (targetFieldKey) {
      fields = fields.filter(f => f.name === targetFieldKey);
    } else if (compact) {
      fields = fields.slice(0, 1);
    }
    
    return fields;
  }, [schema.output_contract, selectedFieldKeys, targetFieldKey, compact]);

  const isPotentiallyLong = useMemo(() => {
    // This logic needs to be updated based on the `output_contract`
    return fieldsToDisplay.some(f => f.type === 'array');
  }, [fieldsToDisplay]);
  
  const isFailed = result.status === 'failed';

  const formatFieldValue = (rawValueObject: any, field: SchemeField, highlightValue: string | null): React.ReactNode => {
      let valueForField: any;
      if (typeof rawValueObject === 'object' && rawValueObject !== null && !Array.isArray(rawValueObject)) {
          valueForField = rawValueObject[field.name];
      } else {
          valueForField = rawValueObject;
      }

      if (valueForField === null || valueForField === undefined) {
           return <span className="text-gray-400 italic">N/A</span>;
      }

      // This switch logic needs to be updated to handle JSON schema types
      switch (field.type) {
          case 'integer':
              return <Badge variant="outline" className="bg-green-200/40 text-black">{String(valueForField)}</Badge>; 
          case 'string':
              return <span>{String(valueForField)}</span>;
          case 'array':
              if (Array.isArray(valueForField)) {
                  if (valueForField.length === 0) return <span className="text-gray-400 italic"></span>;
                  return (
                      <div className="flex flex-wrap gap-1">
                          {valueForField.map((item, i) => (
                              <Badge 
                                key={i} 
                                variant="secondary" 
                                className={cn(highlightValue === String(item) && "ring-2 ring-offset-2 ring-primary ring-offset-background")}
                              >
                                  {String(item)}
                              </Badge>
                          ))}
                      </div>
                  );
              }
              return <span className="text-red-500 italic">Expected Array, got: {typeof valueForField}</span>;
          default:
              if (typeof valueForField === 'object' && valueForField !== null) {
                  return <pre className="text-xs overflow-auto bg-muted/10 p-1 rounded">{JSON.stringify(valueForField, null, 2)}</pre>;
              }
              return <span>{String(valueForField)}</span>;
      }
  };


  if (!schema || !schema.output_contract) {
      return <div className="text-sm text-red-500 italic">Invalid schema provided.</div>;
  }
  if (result.value === null || result.value === undefined) {
       return <div className="text-sm text-gray-500 italic">No annotation value available.</div>;
  }

  const containerClasses = cn(
    'space-y-2 h-full flex flex-col',
    (renderContext === 'table') 
      ? 'border-2 border-results p-2 rounded-md'
      : (!compact && renderContext !== 'dialog' && 'border-2 border-results p-2 rounded-md')
  );

  return (
      <div className={containerClasses}>
          {(!compact || (renderContext !== 'dialog' && renderContext !== 'table')) && (
             <div className="flex items-center justify-between mb-2">
               <span className="font-medium text-base text-yellow-500">{schema.name}</span>
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
             </div>
          )}
          
          <div
            className={cn(
              'transition-all duration-300 ease-in-out',
              renderContext !== 'table' && !isExpanded && isPotentiallyLong && (compact ? 'max-h-16 overflow-hidden' : renderContext === 'dialog' ? 'max-h-40 overflow-hidden' : 'max-h-24 overflow-hidden'),
              renderContext !== 'table' && isExpanded && isPotentiallyLong && 'max-h-80 overflow-y-auto'
            )}
          >
            <div className={'space-y-3'}>
              {fieldsToDisplay.map((schemaField, idx) => {
                  if (targetFieldKey) {
                      if (schemaField.name !== targetFieldKey) return null;
                  }
                  else if (compact && idx > 0) {
                      return null;
                  }

                  const justificationValue = (typeof result.value === 'object' && result.value !== null) ? result.value[`${schemaField.name}_justification`] : undefined;
                  
                  return (
                      <div key={idx} className={ 'space-y-1 border-b border-dashed border-border/30 pb-3 last:border-b-0 last:pb-0'}>
                          <div>
                            <div className="font-medium text-blue-400 italic inline-flex items-center mr-2">
                              {schemaField.name}
                              {justificationValue && typeof justificationValue === 'string' && (
                                  <TooltipProvider delayDuration={100}>
                                      <Tooltip>
                                          <TooltipTrigger asChild>
                                              <HelpCircle className="h-3.5 w-3.5 ml-1.5 text-muted-foreground cursor-help opacity-70 hover:opacity-100" />
                                          </TooltipTrigger>
                                          <TooltipContent side="top" align="start" className="max-w-xs border-border shadow-lg z-[1000]">
                                              <p className="text-xs font-semibold mb-1 text-indigo-400">Justification:</p>
                                              <p className="text-xs">{justificationValue}</p>
                                          </TooltipContent>
                                      </Tooltip>
                                  </TooltipProvider>
                              )}
                            </div>
                            <div className="inline-block">{formatFieldValue(result.value, schemaField, highlightValue)}</div>
                          </div>
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
 * Component to display multiple annotation results, potentially in tabs or a consolidated list.
 */
const ConsolidatedSchemasView: React.FC<ConsolidatedSchemasViewProps> = ({
    results,
    schemas,
    compact = false,
    targetFieldKey = null,
    useTabs = false,
    renderContext = 'default',
    selectedFieldKeys = null,
    maxFieldsToShow = 10,
    highlightValue = null
}) => {
  const actuallyUseTabs = useTabs && renderContext !== 'dialog';

  if (actuallyUseTabs) {
    return (
      <Tabs defaultValue={schemas[0]?.id?.toString() || "0"} className="w-full">
        <TabsList className="mb-2 overflow-x-auto h-auto justify-start">
          {schemas.map(s => (
            <TabsTrigger key={s.id} value={s.id?.toString() || "0"} className="whitespace-nowrap">
              {s.name}
            </TabsTrigger>
          ))}
        </TabsList>
        
        {schemas.map(s => {
          const schemaResult = results.find(r => r.schema_id === s.id);
          return (
            <TabsContent key={s.id} value={s.id?.toString() || "0"}>
              {schemaResult ? (
                <SingleAnnotationResult
                  result={schemaResult}
                  schema={s}
                  compact={compact}
                  targetFieldKey={targetFieldKey}
                  renderContext={renderContext}
                  selectedFieldKeys={selectedFieldKeys}
                  maxFieldsToShow={maxFieldsToShow}
                  highlightValue={highlightValue}
                />
              ) : (
                <div className="text-sm text-gray-500 italic">No results for this schema</div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    );
  }
  
  return (
    <div className={cn("ml-4", renderContext === 'dialog' ? "space-y-3" : "space-y-6")}>
      {schemas.map(schema => {
        const schemaResult = results.find(r => r.schema_id === schema.id);
        if (!schemaResult) return null;
        
        return (
          <SingleAnnotationResult
            key={schema.id}
            result={schemaResult}
            schema={schema}
            compact={compact}
            targetFieldKey={targetFieldKey}
            renderContext={renderContext}
            selectedFieldKeys={selectedFieldKeys}
            maxFieldsToShow={maxFieldsToShow}
            highlightValue={highlightValue}
          />
        );
      })}
    </div>
  );
};


/**
 * Main component to display one or more annotation results.
 * It handles routing to SingleAnnotationResult or ConsolidatedSchemasView.
 */
const AnnotationResultDisplay: React.FC<AnnotationResultDisplayProps> = ({
    result,
    schema,
    compact = false,
    targetFieldKey = null,
    useTabs = false,
    renderContext = 'default',
    selectedFieldKeys = null,
    maxFieldsToShow,
    highlightValue = null
}) => {
    
  const findSchemaForResult = (res: FormattedAnnotation, sch: AnnotationSchemaRead | AnnotationSchemaRead[]): AnnotationSchemaRead | null => {
    if (!res || !sch) return null;
    if (Array.isArray(sch)) {
      return sch.find(s => s.id === res.schema_id) || null;
    }
    return sch.id === res.schema_id ? sch : null;
  };
  
  if (Array.isArray(result)) {
    const validResultsWithSchemas = result
      .map(r => ({ result: r, schema: findSchemaForResult(r, schema) }))
      .filter((item): item is { result: FormattedAnnotation; schema: AnnotationSchemaRead } => item.schema !== null);
      
    if (validResultsWithSchemas.length === 0) {
      return <div className="text-sm text-gray-500 italic">No valid annotation results with matching schemas found.</div>;
    }

    if (validResultsWithSchemas.length === 1) {
      const { result: singleResult, schema: singleSchema } = validResultsWithSchemas[0];
      return (
        <SingleAnnotationResult
          result={singleResult}
          schema={singleSchema}
          compact={compact}
          targetFieldKey={targetFieldKey}
          renderContext={renderContext}
          selectedFieldKeys={selectedFieldKeys}
          maxFieldsToShow={maxFieldsToShow}
          highlightValue={highlightValue}
        />
      );
    }
    
    return (
      <ConsolidatedSchemasView
        results={validResultsWithSchemas.map(item => item.result)}
        schemas={validResultsWithSchemas.map(item => item.schema)}
        compact={compact}
        targetFieldKey={targetFieldKey}
        useTabs={useTabs}
        renderContext={renderContext}
        selectedFieldKeys={selectedFieldKeys}
        maxFieldsToShow={maxFieldsToShow}
        highlightValue={highlightValue}
      />
    );
  }
  
  if (!Array.isArray(result)) {
    const matchingSchema = findSchemaForResult(result, schema);
    if (matchingSchema) {
      return (
        <SingleAnnotationResult
          result={result}
          schema={matchingSchema}
          compact={compact}
          targetFieldKey={targetFieldKey}
          renderContext={renderContext}
          selectedFieldKeys={selectedFieldKeys}
          maxFieldsToShow={maxFieldsToShow}
          highlightValue={highlightValue}
        />
      );
    }
    return <div className="text-sm text-gray-500 italic">No matching schema found for this result. Schema ID: {result.schema_id}</div>;
  }
  
  return <div className="text-sm text-gray-500 italic">Invalid result or schema configuration provided.</div>;
};

export default AnnotationResultDisplay;