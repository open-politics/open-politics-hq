import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { AnnotationRead, AnnotationSchemaRead, AssetRead } from '@/client';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from "@/components/ui/scroll-area";
import { AnnotationResultStatus } from "@/lib/annotations/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnnotationService } from '@/lib/annotations/service';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from "@/lib/utils"; // Import cn helper
import { FormattedAnnotation } from '@/lib/annotations/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { HelpCircle, FileText } from 'lucide-react';
import { getTargetKeysForScheme, getAnnotationFieldValue } from '@/lib/annotations/utils';
import { TextSpanSnippets } from '@/components/ui/highlighted-text';
import { useAnnotationTextSpans } from '@/components/collection/contexts/TextSpanHighlightContext';
import { Separator } from '@/components/ui/separator';
// NEW: Enhanced panel components
import AnnotationFieldsPanel from './AnnotationFieldsPanel';
import AssetContentPanel from './AssetContentPanel';
import JustificationSidebar from './JustificationSidebar';
// NEW: Field detection for cross-panel linking
import { 
  isTimestampField, 
  isLocationField, 
  parseTimestampValue, 
  parseLocationValue 
} from '@/lib/annotations/fieldDetection';
import { Calendar, MapPin } from 'lucide-react';

// Local interface for schema fields
interface SchemaField {
  name: string;
  type: string;
  description: string;
  config: any;
}

// Utility function to format field names for display
const formatFieldNameForDisplay = (fieldName: string): string => {
  // Remove "document." prefix if present to make field names cleaner
  if (fieldName.startsWith('document.')) {
    return fieldName.substring('document.'.length);
  }
  return fieldName;
};

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
  renderContext?: 'dialog' | 'table' | 'default' | 'enhanced';
  /** Optional: Array of field keys to specifically display. If null or undefined, displays according to other rules (compact/targetFieldKey). */
  selectedFieldKeys?: string[] | null;
  /** Optional: Maximum number of fields to show when not compact and specific fields aren't selected. */
  maxFieldsToShow?: number;
  /** Optional: A specific value within a field (e.g., a List[str] item) to highlight */
  highlightValue?: string | null;
  /** NEW: Asset data for enhanced view */
  asset?: AssetRead | null;
  /** NEW: Whether to show asset content in enhanced view */
  showAssetContent?: boolean;
  /** NEW: Callback for field interaction in enhanced view */
  onFieldInteraction?: (fieldKey: string, justification: any) => void;
  /** NEW: Active field being highlighted */
  activeField?: string | null;
  /** NEW: Callback when result is selected/clicked */
  onResultSelect?: (result: FormattedAnnotation) => void;
  /** NEW: Force expanded state from parent (for global expand/collapse) */
  forceExpanded?: boolean;
  /** NEW: Callback when a timestamp field is clicked for cross-panel navigation */
  onTimestampClick?: (timestamp: Date, fieldKey: string) => void;
  /** NEW: Callback when a location field is clicked for cross-panel navigation */
  onLocationClick?: (location: string, fieldKey: string) => void;
}

interface SingleAnnotationResultProps {
  result: FormattedAnnotation;
  schema: AnnotationSchemaRead;
  compact?: boolean;
  targetFieldKey?: string | null;
  renderContext?: 'dialog' | 'table' | 'default' | 'enhanced';
  selectedFieldKeys?: string[] | null;
  maxFieldsToShow?: number;
  highlightValue?: string | null;
  asset?: AssetRead | null;
  showAssetContent?: boolean;
  onFieldInteraction?: (fieldKey: string, justification: any) => void;
  activeField?: string | null;
  onResultSelect?: (result: FormattedAnnotation) => void;
  forceExpanded?: boolean;
  onTimestampClick?: (timestamp: Date, fieldKey: string) => void;
  onLocationClick?: (location: string, fieldKey: string) => void;
}

interface ConsolidatedSchemasViewProps {
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  compact?: boolean;
  targetFieldKey?: string | null;
  useTabs?: boolean;
  renderContext?: 'dialog' | 'table' | 'default' | 'enhanced';
  selectedFieldKeys?: string[] | null;
  maxFieldsToShow?: number;
  highlightValue?: string | null;
  asset?: AssetRead | null;
  showAssetContent?: boolean;
  onFieldInteraction?: (fieldKey: string, justification: any) => void;
  activeField?: string | null;
  onResultSelect?: (result: FormattedAnnotation) => void;
  forceExpanded?: boolean;
  onTimestampClick?: (timestamp: Date, fieldKey: string) => void;
  onLocationClick?: (location: string, fieldKey: string) => void;
}

/**
 * Component for displaying a single annotation result based on its schema.
 */
function SingleAnnotationResult({ 
  result, 
  schema, 
  compact = false, 
  targetFieldKey = null, 
  renderContext = 'default',
  selectedFieldKeys = null,
  maxFieldsToShow = undefined,
  highlightValue = null,
  asset = null,
  showAssetContent = false,
  onFieldInteraction,
  activeField = null,
  onResultSelect,
  forceExpanded = false,
  onTimestampClick,
  onLocationClick
}: SingleAnnotationResultProps) {
  const { extractTextSpansFromJustification } = useAnnotationTextSpans();
  const [highlightedSpans, setHighlightedSpans] = useState<Set<string>>(new Set());
  const renderedRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Use forceExpanded prop to override local state
  const effectiveExpanded = forceExpanded || isExpanded;
  
  // Track which justifications we've already processed to prevent infinite loops
  const processedJustificationsRef = useRef<Set<string>>(new Set());

  // Enhanced layout hooks - MUST be called before any early returns
  const [activeFieldState, setActiveFieldState] = useState<string | null>(activeField || null);
  const [selectedSpan, setSelectedSpan] = useState<{ fieldKey: string; spanIndex: number; span: any } | null>(null);
  
  const handleFieldInteraction = useCallback((fieldKey: string, justification: any) => {
    setActiveFieldState(fieldKey);
    // Clear span selection when switching fields
    setSelectedSpan(null);
    if (onFieldInteraction) {
      onFieldInteraction(fieldKey, justification);
    }
  }, [onFieldInteraction]);

  const handleSpanSelect = useCallback((fieldKey: string, spanIndex: number, span: any) => {
    if (spanIndex === -1) {
      // Deselect the span
      setSelectedSpan(null);
    } else {
      setSelectedSpan({ fieldKey, spanIndex, span });
      // Also set the active field if it's not already active
      setActiveFieldState(prev => prev !== fieldKey ? fieldKey : prev);
    }
  }, []);

  const handleSpanClick = useCallback((spanId: string) => {
    setHighlightedSpans(prev => {
      const newSet = new Set(prev);
      if (newSet.has(spanId)) {
        newSet.delete(spanId);
      } else {
        newSet.add(spanId);
      }
      return newSet;
    });
  }, []);

  // Extract justifications from result value to process them
  const justificationsToProcess = useMemo(() => {
    if (!result?.value || typeof result.value !== 'object') return [];
    
    const justifications: Array<{
      justificationObj: any;
      assetId: number;
      assetUuid?: string;
      fieldName: string;
      schemaName: string;
      justificationKey: string;
    }> = [];

    // Use getTargetKeysForScheme directly from utils
    const targetKeys = getTargetKeysForScheme(schema.id, [schema]);
    const fieldsToDisplay = targetKeys.map(tk => ({
        name: tk.key, // This is now the full hierarchical path like "document.topics"
        type: tk.type,
        description: '', // We don't have descriptions from getTargetKeysForScheme
        config: {} // Placeholder
    }));
    
    fieldsToDisplay.forEach((schemaField) => {
      const justificationFieldPath = `${schemaField.name}_justification`;
      const flatJustificationName = justificationFieldPath.includes('.') 
        ? justificationFieldPath.split('.').pop() 
        : justificationFieldPath;
      
      if (flatJustificationName && 
          (flatJustificationName in result.value || 
           Object.keys(result.value).some(key => 
             key.toLowerCase().includes('justification') || 
             key.toLowerCase().includes('reasoning')
           ))) {
        const justificationObj = getAnnotationFieldValue(result.value, justificationFieldPath);
        
        if (justificationObj && typeof justificationObj === 'object' && justificationObj.text_spans?.length > 0) {
          const assetUuid = (result.asset as any)?.uuid;
          const justificationKey = `${result.asset_id}-${schemaField.name}-${schema.id}-${JSON.stringify(justificationObj.text_spans.map(s => ({ start: s.start_char_offset, end: s.end_char_offset, text: s.text_snippet })))}`;
          
          if (!processedJustificationsRef.current.has(justificationKey)) {
            justifications.push({
              justificationObj,
              assetId: result.asset_id,
              assetUuid,
              fieldName: schemaField.name,
              schemaName: schema.name,
              justificationKey
            });
          }
        }
      }
    });

    return justifications;
  }, [result, schema]);

  // Process justifications after render
  useEffect(() => {
    if (justificationsToProcess.length > 0) {
      // Process justifications asynchronously
      const processJustifications = async () => {
        for (const { justificationObj, assetId, assetUuid, fieldName, schemaName, justificationKey } of justificationsToProcess) {
          if (!processedJustificationsRef.current.has(justificationKey)) {
            try {
              await extractTextSpansFromJustification(
                justificationObj,
                assetId,
                assetUuid,
                fieldName,
                schemaName
              );
              
              // Mark this justification as processed
              processedJustificationsRef.current.add(justificationKey);
            } catch (error) {
              console.error('Failed to process justification:', error);
              // Still mark as processed to avoid infinite retries
              processedJustificationsRef.current.add(justificationKey);
            }
          }
        }
      };

      processJustifications();
    }
  }, [justificationsToProcess, extractTextSpansFromJustification]);

  const fieldsToDisplay = useMemo(() => {
    // Use getTargetKeysForScheme directly from utils
    const targetKeys = getTargetKeysForScheme(schema.id, [schema]);
    let fields = targetKeys.map(tk => ({
        name: tk.key, // This is now the full hierarchical path like "document.topics"
        type: tk.type,
        description: '', // We don't have descriptions from getTargetKeysForScheme
        config: {} // Placeholder
    }));

    if (selectedFieldKeys && selectedFieldKeys.length > 0) {
      fields = fields.filter(f => selectedFieldKeys.includes(f.name));
    } else if (targetFieldKey) {
      fields = fields.filter(f => f.name === targetFieldKey);
    } else if (compact) {
      fields = fields.slice(0, 1);
    }
    
    return fields;
  }, [schema.output_contract, schema, selectedFieldKeys, targetFieldKey, compact]);

  const isPotentiallyLong = useMemo(() => {
    // Content is potentially long if:
    // 1. There are array fields, OR
    // 2. There are multiple fields to display (when not in compact mode)
    return fieldsToDisplay.some(f => (f as any).type === "array") || 
           (!compact && fieldsToDisplay.length > 1);
  }, [fieldsToDisplay, compact]);
  
  const isFailed = result.status === "failure";

  // Enhanced version for unfolded columns that passes justification to formatFieldValue
  const formatFieldValueWithTypeIndicator = (rawValueObject: any, field: SchemaField, highlightValue: string | null, context: string = 'default', showTypeIndicator: boolean = false, justificationValue?: any): React.ReactNode => {
    // Pass justification info to formatFieldValue so it can integrate tooltips directly into badges/values
    return formatFieldValue(rawValueObject, field, highlightValue, context, justificationValue, showTypeIndicator);
  };

  // Helper function to wrap any value with tooltip if justification exists
  const wrapWithTooltipIfNeeded = (content: React.ReactNode, field: SchemaField, justificationValue?: any, showIntegratedTooltip: boolean = false): React.ReactNode => {
    if (!showIntegratedTooltip || !justificationValue) {
      return content;
    }

    return (
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className="cursor-help inline-flex items-center gap-1"
              onClick={(e) => {
                e.stopPropagation();
                if (onFieldInteraction) {
                  onFieldInteraction(field.name, justificationValue);
                  return;
                }
                if (onResultSelect) {
                  const resultWithContext = {
                    ...result,
                    _selectedField: field.name
                  };
                  onResultSelect(resultWithContext as FormattedAnnotation);
                }
              }}
            >
              {content}
              {/* Clear justification indicator */}
              <HelpCircle className="h-3 w-3 text-blue-500 opacity-70 hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" className="max-w-sm z-[1001]">
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">Justification:</p>
              </div>
              {(() => {
                if (typeof justificationValue === 'object' && justificationValue !== null) {
                  return (
                    <div className="space-y-1">
                      {justificationValue.reasoning && (
                        <p className="text-xs">{justificationValue.reasoning}</p>
                      )}
                      {justificationValue.text_spans && justificationValue.text_spans.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium">Evidence:</p>
                          {justificationValue.text_spans.map((span: any, i: number) => (
                            <div key={i} className="text-xs bg-muted/50 p-1 rounded border-l-2 border-primary/30">
                              "{span.text_snippet}"
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                return <p className="text-xs">{String(justificationValue)}</p>;
              })()}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const formatFieldValue = (rawValueObject: any, field: SchemaField, highlightValue: string | null, context: string = 'default', justificationValue?: any, showIntegratedTooltip: boolean = false): React.ReactNode => {
      // Use hierarchical field access with the full path (e.g., "document.topics")
      const valueForField = getAnnotationFieldValue(rawValueObject, field.name);

      if (valueForField === null || valueForField === undefined) {
           return <span className="text-muted-foreground italic text-xs">N/A</span>;
      }

      // Check if this is a timestamp field for cross-panel linking
      const isClickableTimestamp = onTimestampClick && isTimestampField(field.name, valueForField);
      const isClickableLocation = onLocationClick && isLocationField(field.name, valueForField);
      
      // Handle timestamp fields with click support
      if (isClickableTimestamp) {
        const timestamp = parseTimestampValue(valueForField);
        if (timestamp) {
          return (
            <div className="flex items-center gap-1.5 max-w-full min-w-0">
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTimestampClick(timestamp, field.name);
                      }}
                      className={cn(
                        "cursor-pointer flex items-center justify-center transition-all flex-shrink-0",
                        "bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900",
                        "border border-blue-200 dark:border-blue-800 rounded-md p-1",
                        "hover:border-blue-400 dark:hover:border-blue-600",
                        "group"
                      )}
                    >
                      <Calendar className="h-3 w-3 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-blue-600 text-white border-blue-700">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3" />
                      <p className="text-xs font-medium">Jump to time in chart</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="text-xs tabular-nums min-w-0 truncate">{String(valueForField)}</span>
            </div>
          );
        }
      }
      
      // Handle location fields with click support
      if (isClickableLocation) {
        const locations = parseLocationValue(valueForField);
        
        if (Array.isArray(valueForField) && locations.length > 0) {
          return (
            <div className="flex flex-wrap gap-2 items-center">
              {locations.map((location, i) => (
                <div key={i} className="inline-flex items-center gap-1.5">
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onLocationClick?.(location, field.name);
                          }}
                          className={cn(
                            "cursor-pointer inline-flex items-center justify-center transition-all",
                            "bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950 dark:hover:bg-emerald-900",
                            "border border-emerald-200 dark:border-emerald-800 rounded-md p-1",
                            "hover:border-emerald-400 dark:hover:border-emerald-600",
                            "group",
                            highlightValue === location && "ring-2 ring-offset-2 ring-emerald-500 ring-offset-background"
                          )}
                        >
                          <MapPin className="h-3 w-3 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="bg-emerald-600 text-white border-emerald-700">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3 w-3" />
                          <p className="text-xs font-medium">Jump to location on map</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Badge 
                    variant="outline" 
                    className={cn(
                      "text-[10px] px-1.5 py-0 whitespace-nowrap font-normal border-border/40",
                      highlightValue === location && "ring-2 ring-offset-2 ring-primary ring-offset-background"
                    )}
                  >
                    {location}
                  </Badge>
                </div>
              ))}
            </div>
          );
        } else if (typeof valueForField === 'string' && locations.length > 0) {
          return (
            <div className="inline-flex items-center gap-1.5">
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onLocationClick?.(locations[0], field.name);
                      }}
                      className={cn(
                        "cursor-pointer inline-flex items-center justify-center transition-all",
                        "bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950 dark:hover:bg-emerald-900",
                        "border border-emerald-200 dark:border-emerald-800 rounded-md p-1",
                        "hover:border-emerald-400 dark:hover:border-emerald-600",
                        "group"
                      )}
                    >
                      <MapPin className="h-3 w-3 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-emerald-600 text-white border-emerald-700">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      <p className="text-xs font-medium">Jump to location on map</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="text-xs">{String(valueForField)}</span>
            </div>
          );
        }
      }

      // Determine if we're in table context for compact rendering
      const isTableContext = context === 'table';
      
      // Clean, consistent value rendering - lighter weight, smaller text with proper overflow handling
      switch ((field as any).type) {
          case "integer":
          case "number":
              const badge = (
                <Badge 
                  variant="secondary" 
                  className={cn(
                    "text-xs tabular-nums font-medium px-2 py-0.5",
                    "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300",
                    "border-blue-200 dark:border-blue-800",
                    "hover:bg-blue-100 dark:hover:bg-blue-900/50",
                    highlightValue === String(valueForField) && "ring-2 ring-offset-2 ring-blue-500 ring-offset-background"
                  )}
                >
                  {String(valueForField)}
                </Badge>
              );
              return wrapWithTooltipIfNeeded(badge, field, justificationValue, showIntegratedTooltip); 
          case "string":
          case "boolean":
              const stringValue = String(valueForField);
              
              let stringContent: React.ReactNode;
              // In table context, break longer strings to new line like arrays for better layout
              if (isTableContext && stringValue.length > 50) {
                stringContent = (
                  <div className="w-full">
                    <div className="text-xs leading-tight break-words max-w-full">
                      {stringValue}
                    </div>
                  </div>
                );
              } else {
                // For shorter strings or non-table context, use inline wrapping
                stringContent = (
                  <div className="text-xs leading-tight max-w-full min-w-0">
                    <span className="break-words">{stringValue}</span>
                  </div>
                );
              }
              return wrapWithTooltipIfNeeded(stringContent, field, justificationValue, showIntegratedTooltip);
          case "array":
              if (Array.isArray(valueForField)) {
                  if (valueForField.length === 0) return <span className="text-muted-foreground italic text-xs">empty</span>;
                  
                  let arrayContent: React.ReactNode;
                  // In table context, break arrays to new line like long strings
                  if (isTableContext) {
                    arrayContent = (
                      <div className="w-full">
                        <div className="flex flex-wrap gap-1 items-center">
                          {valueForField.map((item, i) => {
                            const itemText = typeof item === 'object' ? JSON.stringify(item) : String(item);
                            return (
                              <Badge 
                                key={i} 
                                variant="outline" 
                                className={cn(
                                  "text-[10px] px-1.5 py-0 font-normal border-border/40",
                                  // In table context, allow badges to wrap naturally
                                  "whitespace-nowrap",
                                  highlightValue === String(item) && "ring-2 ring-offset-2 ring-primary ring-offset-background"
                                )}
                                title={itemText.length > 30 ? itemText : undefined}
                              >
                                {itemText}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    );
                  } else {
                    // Non-table context: keep inline
                    arrayContent = (
                        <div className="flex flex-wrap gap-1 items-center max-w-full min-w-0">
                            {valueForField.map((item, i) => {
                              const itemText = typeof item === 'object' ? JSON.stringify(item) : String(item);
                              return (
                                <Badge 
                                  key={i} 
                                  variant="outline" 
                                  className={cn(
                                    "text-[10px] px-1.5 py-0 font-normal border-border/40 max-w-full",
                                    // Handle long badge content
                                    itemText.length > 50 ? "break-all" : "whitespace-nowrap",
                                    highlightValue === String(item) && "ring-2 ring-offset-2 ring-primary ring-offset-background"
                                  )}
                                  title={itemText.length > 50 ? itemText : undefined}
                                >
                                  <span className={cn(
                                    "truncate block",
                                    itemText.length > 50 && "max-w-[200px]"
                                  )}>
                                    {itemText}
                                  </span>
                                </Badge>
                              );
                            })}
                        </div>
                    );
                  }
                  return wrapWithTooltipIfNeeded(arrayContent, field, justificationValue, showIntegratedTooltip);
              }
              return <span className="text-destructive italic text-xs">Expected Array, got: {typeof valueForField}</span>;
          default:
              if (typeof valueForField === 'object' && valueForField !== null) {
                  const jsonString = JSON.stringify(valueForField, null, 2);
                  const objectContent = (
                    <div className="max-w-full min-w-0">
                      <pre className={cn(
                        "text-[10px] bg-muted/30 p-1.5 rounded border border-border/30 max-w-full min-w-0",
                        isTableContext ? "max-h-20 overflow-auto" : "max-h-32 overflow-auto",
                        "whitespace-pre-wrap break-words"
                      )}>
                        {jsonString}
                      </pre>
                    </div>
                  );
                  return wrapWithTooltipIfNeeded(objectContent, field, justificationValue, showIntegratedTooltip);
              }
              const defaultStringValue = String(valueForField);
              
              let defaultContent: React.ReactNode;
              // In table context, break longer strings to new line like arrays
              if (isTableContext && defaultStringValue.length > 50) {
                defaultContent = (
                  <div className="w-full">
                    <div className="text-xs leading-tight break-words max-w-full">
                      {defaultStringValue}
                    </div>
                  </div>
                );
              } else {
                defaultContent = (
                  <div className="text-xs leading-tight max-w-full min-w-0">
                    <span className="break-words">{defaultStringValue}</span>
                  </div>
                );
              }
              return wrapWithTooltipIfNeeded(defaultContent, field, justificationValue, showIntegratedTooltip);
      }
  };

  if (!schema || !schema.output_contract) {
      return <div className="text-sm text-destructive italic">Invalid schema provided.</div>;
  }
  if (result.value === null || result.value === undefined) {
       return <div className="text-sm text-muted-foreground italic">No annotation value available.</div>;
  }



  // NEW: Enhanced layout for unified annotation and asset viewing
  if (renderContext === 'enhanced') {

    return (
      <div className="h-full w-full flex flex-col">
        {/* Three-column layout: Fields | Justifications | Content */}
        <div className="flex-1 min-h-0 grid grid-cols-12 gap-3 p-4">
          {/* Left column: Annotation fields (3 columns) */}
          <div className="col-span-3 border rounded-lg bg-background overflow-hidden flex flex-col">
            <AnnotationFieldsPanel
              result={result}
              schema={schema}
              selectedFieldKeys={selectedFieldKeys}
              activeField={activeFieldState}
              selectedSpan={selectedSpan ? { fieldKey: selectedSpan.fieldKey, spanIndex: selectedSpan.spanIndex } : null}
              onFieldInteraction={handleFieldInteraction}
              highlightValue={highlightValue}
            />
          </div>

          {/* Middle column: Justifications (4 columns) */}
          <div className="col-span-4 border rounded-lg bg-background overflow-hidden">
            <JustificationSidebar
              result={result}
              activeField={activeFieldState}
              onSpanClick={handleSpanClick}
              onSpanSelect={handleSpanSelect}
              selectedSpan={selectedSpan ? { fieldKey: selectedSpan.fieldKey, spanIndex: selectedSpan.spanIndex } : null}
            />
          </div>

          {/* Right column: Asset content (5 columns) */}
          {asset && showAssetContent && (
            <div className="col-span-5 border rounded-lg bg-background overflow-hidden">
              <AssetContentPanel
                asset={asset}
                activeField={activeFieldState}
                selectedSpan={selectedSpan}
              />
            </div>
          )}

          {/* Fallback: Expand justifications if no asset content */}
          {(!asset || !showAssetContent) && (
            <div className="col-span-5 border rounded-lg bg-background overflow-hidden flex items-center justify-center">
              <div className="text-center text-muted-foreground p-8">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 flex items-center justify-center mb-4 mx-auto">
                  <FileText className="h-8 w-8 opacity-60" />
                </div>
                <p className="text-sm font-medium mb-2">No Content Available</p>
                <p className="text-xs opacity-75 max-w-xs">
                  Asset content will appear here when available for enhanced annotation review.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const containerClasses = cn(
    'relative min-w-0',
    (renderContext === 'table') 
      ? 'leading-relaxed'
      : 'flex flex-col',
    (!compact && renderContext !== 'dialog' && renderContext !== 'table') && 'border-2 border-results p-2 rounded-md h-full space-y-0',
    // NEW: Add cursor pointer when clickable
    onResultSelect && (renderContext === 'table' || renderContext === 'default') && 'cursor-pointer'
  );

  const handleResultClick = (e: React.MouseEvent) => {
    // Only handle clicks if onResultSelect is provided and we're in appropriate contexts
    if (onResultSelect && (renderContext === 'table' || renderContext === 'default')) {
      // Don't trigger on button clicks or other interactive elements
      if ((e.target as HTMLElement).closest('button, [role="button"], .cursor-help')) {
        return;
      }
      onResultSelect(result);
    }
  };

  return (
      <div 
        className={containerClasses}
        onClick={handleResultClick}
      >
          <div className="flex items-center justify-between">
            {/* <div className="flex items-center gap-2">
              <span className="font-medium text-base text-yellow-500">{schema.name}</span>
            </div> */}
            {isFailed && (
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertCircle className="h-4 w-4 text-destructive opacity-80 cursor-help ml-2" />
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end" className="z-[70]">
                    <p className="text-xs max-w-xs break-words">
                      Failed: {result.error_message || 'Unknown error'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          
          <div 
            className={cn(
              'transition-all duration-200 ease-in-out min-w-0 max-w-full overflow-hidden',
              renderContext === 'table' ? '' : (
                // Apply height restriction only when NOT expanded in non-table contexts
                !effectiveExpanded && isPotentiallyLong && (
                  compact ? '' : // No max-height for compact mode (used in unfolded columns)
                  renderContext === 'dialog' ? 'max-h-32 overflow-hidden' : 
                  ''
                )
              ),
              // When expanded (either manually or via forceExpanded), allow much larger height with scrolling
              effectiveExpanded && isPotentiallyLong && renderContext !== 'table' && 'max-h-[500px] overflow-y-auto'
            )}
          >
            <div className={cn(renderContext === 'table' ? 'min-w-0 max-w-full' : 'space-y-0 min-w-0 max-w-full')}>
              {fieldsToDisplay.map((schemaField, idx) => {
                  // Note: filtering is already handled in fieldsToDisplay useMemo
                  // No need for additional filtering here

                  const justificationValue = (() => {
                    if (typeof result.value === 'object' && result.value !== null) {
                      // For hierarchical schemas, the field name might be like "document.topics"
                      // So the justification field would be "document.topics_justification"
                      const justificationFieldPath = `${schemaField.name}_justification`;
                      
                      // Quick check if justification field might exist before calling expensive lookup
                      const flatJustificationName = justificationFieldPath.includes('.') 
                        ? justificationFieldPath.split('.').pop() 
                        : justificationFieldPath;
                      
                      // Only attempt lookup if the field potentially exists
                      if (flatJustificationName && 
                          (flatJustificationName in result.value || 
                           Object.keys(result.value).some(key => 
                             key.toLowerCase().includes('justification') || 
                             key.toLowerCase().includes('reasoning')
                           ))) {
                        const justificationObj = getAnnotationFieldValue(result.value, justificationFieldPath);
                        
                        // Handle structured justification objects (JustificationSubModel)
                        if (justificationObj && typeof justificationObj === 'object') {
                          return justificationObj; // Return the full object for rich display
                        }
                        // Handle legacy string justifications
                        else if (typeof justificationObj === 'string') {
                          return justificationObj;
                        }
                      }
                    }
                    return undefined;
                  })();
                  
                  // Check if field is array type for special layout
                  const fieldValue = getAnnotationFieldValue(result.value, schemaField.name);
                  const isArrayField = (schemaField as any).type === 'array' || Array.isArray(fieldValue);
                  
                  return (
                      <div key={idx} className={cn(
                        renderContext === 'table' ? 'mb-1 min-w-0 max-w-full' : 'space-y-1 min-w-0 max-w-full',
                        renderContext !== 'table' && 'border-b border-dashed border-border/30 last:border-b-0'
                      )}>
                          {/* Use flexible layout: allow values to wrap to new line for long content */}
                          {/* In unfolded column mode (table + compact + targetFieldKey), skip field names - headers show them */}
                          {renderContext === 'table' && compact && targetFieldKey ? (
                            // Unfolded column: show value + justification icon if available
                            <div className="min-w-0 max-w-full">
                              {formatFieldValueWithTypeIndicator(result.value, schemaField, highlightValue, renderContext, true, justificationValue)}
                            </div>
                          ) : (
                            // Regular mode: show field name + value
                            <div className={cn(
                              "min-w-0 max-w-full",
                              renderContext === 'table' ? 'flex flex-wrap items-start gap-x-1 gap-y-0.5' : 'flex items-start gap-1'
                            )}>
                              <div className={cn(
                                "flex items-center gap-1 flex-shrink-0",
                                renderContext === 'table' ? 'text-xs text-muted-foreground' : 'text-xs text-muted-foreground font-medium'
                              )}>
                                <span className={cn(renderContext === 'table' && 'leading-tight', "whitespace-nowrap")}>
                                  {formatFieldNameForDisplay(schemaField.name)}:
                                </span>
                              {/* Show justification tooltip - in table context only for compact/column mode */}
                              {justificationValue && (renderContext !== 'table' || compact) && (
                                  <TooltipProvider delayDuration={100}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                          <HelpCircle 
                                            className={cn(
                                              "cursor-help opacity-60 hover:opacity-100 hover:text-primary transition-colors",
                                              renderContext === 'table' ? 'ml-0.5 h-3 w-3' : 'ml-1 h-3.5 w-3.5'
                                            )} 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              // Priority 1: Call onFieldInteraction if available (for enhanced dialog with specific field)
                                              if (onFieldInteraction) {
                                                onFieldInteraction(schemaField.name, justificationValue);
                                                return;
                                              }
                                              // Priority 2: Fall back to onResultSelect with field context
                                              if (onResultSelect) {
                                                const resultWithContext = {
                                                  ...result,
                                                  _selectedField: schemaField.name // Add field context
                                                };
                                                onResultSelect(resultWithContext as FormattedAnnotation);
                                              }
                                            }}
                                          />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" align="start" className="max-w-sm z-[1001]">
                                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                          <div className="flex items-center justify-between">
                                            <p className="text-xs font-semibold">Justification:</p>
                                          </div>
                                          {(() => {
                                            // Handle structured justification objects
                                            if (typeof justificationValue === 'object' && justificationValue !== null) {
                                              return (
                                                <div className="space-y-1">
                                                  {justificationValue.reasoning && (
                                                    <p className="text-xs">{justificationValue.reasoning}</p>
                                                  )}
                                                  {justificationValue.text_spans && justificationValue.text_spans.length > 0 && (
                                                    <div className="space-y-2">
                                                      <p className="text-xs">
                                                        📝 {justificationValue.text_spans.length} text span{justificationValue.text_spans.length > 1 ? 's' : ''}
                                                      </p>
                                                      <Separator className="my-2" />
                                                      <div className="text-xs">
                                                        {justificationValue.text_spans.slice(0, 3).map((span: any, idx: number) => (
                                                          <div key={idx} className="italic border border-border p-1 rounded text-wrap break-words mb-1">
                                                            "{span.text_snippet}"
                                                          </div>
                                                        ))}
                                                        {justificationValue.text_spans.length > 3 && (
                                                          <p className="text-muted-foreground">...and {justificationValue.text_spans.length - 3} more</p>
                                                        )}
                                                      </div>
                                                    </div>
                                                  )}
                                                  {justificationValue.image_regions && justificationValue.image_regions.length > 0 && (
                                                    <p className="text-xs text-muted-foreground">
                                                      🖼️ {justificationValue.image_regions.length} image region{justificationValue.image_regions.length > 1 ? 's' : ''}
                                                    </p>
                                                  )}
                                                  {justificationValue.audio_segments && justificationValue.audio_segments.length > 0 && (
                                                    <p className="text-xs text-muted-foreground">
                                                      🎵 {justificationValue.audio_segments.length} audio segment{justificationValue.audio_segments.length > 1 ? 's' : ''}
                                                    </p>
                                                  )}
                                                </div>
                                              );
                                            }
                                            // Handle string justifications
                                            return <p className="text-xs">{String(justificationValue)}</p>;
                                          })()}
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                              )}
                              </div>
                              {/* Value container - flexible and can wrap to new line for long content */}
                              <div className={cn(
                                "leading-snug min-w-0 overflow-hidden",
                                renderContext === 'table' ? 'flex-1' : 'flex-1'
                              )}>
                                {formatFieldValue(result.value, schemaField, highlightValue, renderContext)}
                              </div>
                            </div>
                          )}
                      </div>
                  );
              })}
            </div>
          </div>
          
          {/* Expand/collapse button for non-table contexts */}
          {isPotentiallyLong && !compact && !forceExpanded && renderContext !== 'table' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="mt-1 text-xs w-full justify-start text-muted-foreground hover:text-foreground"
            >
              {effectiveExpanded ? (
                <><ChevronUp className="h-3 w-3 mr-1" /> Show Less</>
              ) : (
                <><ChevronDown className="h-3 w-3 mr-1" /> Show More</>
              )}
            </Button>
          )}
          {isPotentiallyLong && !compact && forceExpanded && renderContext !== 'table' && (
            <div className="mt-1 text-xs text-muted-foreground italic text-center">
              Global expand active
            </div>
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
    highlightValue = null,
    asset,
    showAssetContent,
    onFieldInteraction,
    activeField,
    onResultSelect,
    forceExpanded = false,
    onTimestampClick,
    onLocationClick
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
                  asset={asset}
                  showAssetContent={showAssetContent}
                  onFieldInteraction={onFieldInteraction}
                  activeField={activeField}
                  onResultSelect={onResultSelect}
                  forceExpanded={forceExpanded}
                  onTimestampClick={onTimestampClick}
                  onLocationClick={onLocationClick}
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
            asset={asset}
            showAssetContent={showAssetContent}
            onFieldInteraction={onFieldInteraction}
            activeField={activeField}
            onResultSelect={onResultSelect}
            forceExpanded={forceExpanded}
            onTimestampClick={onTimestampClick}
            onLocationClick={onLocationClick}
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
    highlightValue = null,
    asset,
    showAssetContent,
    onFieldInteraction,
    activeField,
    onResultSelect,
    forceExpanded = false,
    onTimestampClick,
    onLocationClick
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
          asset={asset}
          showAssetContent={showAssetContent}
          onFieldInteraction={onFieldInteraction}
          activeField={activeField}
          onResultSelect={onResultSelect}
          forceExpanded={forceExpanded}
          onTimestampClick={onTimestampClick}
          onLocationClick={onLocationClick}
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
        asset={asset}
        showAssetContent={showAssetContent}
        onFieldInteraction={onFieldInteraction}
        activeField={activeField}
        onResultSelect={onResultSelect}
        forceExpanded={forceExpanded}
        onTimestampClick={onTimestampClick}
        onLocationClick={onLocationClick}
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
          asset={asset}
          showAssetContent={showAssetContent}
          onFieldInteraction={onFieldInteraction}
          activeField={activeField}
          onResultSelect={onResultSelect}
          forceExpanded={forceExpanded}
          onTimestampClick={onTimestampClick}
          onLocationClick={onLocationClick}
        />
      );
    }
    return <div className="text-sm text-gray-500 italic">No matching schema found for this result. Schema ID: {result.schema_id}</div>;
  }
  
  return <div className="text-sm text-gray-500 italic">Invalid result or schema configuration provided.</div>;
};

export default AnnotationResultDisplay;