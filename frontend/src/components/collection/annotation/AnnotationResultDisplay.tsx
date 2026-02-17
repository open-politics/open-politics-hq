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
import { HelpCircle, FileText, ImageIcon, PanelLeft, PanelLeftClose } from 'lucide-react';
import { getTargetKeysForScheme, getAnnotationFieldValue, formatFieldNameForDisplay as formatFieldNameUtil, getModalityIcon, checkFilterMatch } from '@/lib/annotations/utils';
import { searchInAnnotationValue } from '@/lib/annotations/search';
import { TextSpanSnippets } from '@/components/ui/highlighted-text';
// Text span extraction is now handled by AnnotationFieldsPanel on field click
import { Separator } from '@/components/ui/separator';
import { useTextSpanHighlight } from '@/components/collection/contexts/TextSpanHighlightContext';
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
import { Calendar, MapPin, Network } from 'lucide-react';
// NEW: Knowledge Graph utilities
import {
  isKnowledgeGraphField,
  extractEntities,
  extractTriplets,
  formatTriplet,
  getEntityById,
  type KGEntity,
  type KGTriplet
} from '@/lib/annotations/utils';
// Color system
import { getEntityBadgeClasses } from '@/lib/annotations/colors';

// Local interface for schema fields
interface SchemaField {
  name: string;
  type: string;
  description: string;
  config: any;
}

// Utility function to format field names for display (now uses shared utility)
const formatFieldNameForDisplay = (fieldName: string): string => {
  return formatFieldNameUtil(fieldName).displayName;
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
  /** NEW: Filter array items to only show matching ones */
  filterArrayItems?: boolean;
  /** NEW: Search term for highlighting/filtering array items */
  searchTerm?: string | null;
  /** NEW: Active filters for matching array items */
  filters?: any[];
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
  filterArrayItems?: boolean;
  searchTerm?: string | null;
  filters?: any[];
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
  filterArrayItems?: boolean;
  searchTerm?: string | null;
  filters?: any[];
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
  onLocationClick,
  filterArrayItems = false,
  searchTerm = null,
  filters = []
}: SingleAnnotationResultProps) {
  const renderedRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const effectiveExpanded = forceExpanded || isExpanded;

  const [activeFieldState, setActiveFieldState] = useState<string | null>(activeField || null);
  const [selectedSpan, setSelectedSpan] = useState<{ fieldKey: string; spanIndex: number; span: any } | null>(null);
  const [showEvidencePanel, setShowEvidencePanel] = useState<boolean>(false);

  const { showSingleSpan, revertToFieldSpans, getFieldSpansForAsset, clearHighlights } = useTextSpanHighlight();
  const assetId = result.asset_id;
  const assetUuid = (result.asset as any)?.uuid;

  // Clear highlights when evidence inspection panel is closed
  useEffect(() => {
    if (!showEvidencePanel) {
      clearHighlights();
    }
  }, [showEvidencePanel, clearHighlights]);

  const handleFieldInteraction = useCallback((fieldKey: string, justification: any) => {
    setActiveFieldState(fieldKey);
    setSelectedSpan(null);
    if (onFieldInteraction) {
      onFieldInteraction(fieldKey, justification);
    }
  }, [onFieldInteraction]);

  const handleSpanSelect = useCallback((fieldKey: string, spanIndex: number, span: any) => {
    if (spanIndex === -1) {
      setSelectedSpan(null);
      revertToFieldSpans();
    } else {
      const fieldSpans = getFieldSpansForAsset(assetId, assetUuid);
      const resolvedSpan = fieldSpans[spanIndex] ?? span;
      setSelectedSpan({ fieldKey, spanIndex, span });
      setActiveFieldState(prev => (prev !== fieldKey ? fieldKey : prev));
      showSingleSpan(assetId, resolvedSpan, assetUuid, fieldSpans);
    }
  }, [assetId, assetUuid, showSingleSpan, revertToFieldSpans, getFieldSpansForAsset]);

  const handleSpanClick = useCallback((_spanId: string) => {
    // No-op: span highlighting is now handled by the context
  }, []);

  // NOTE: Text span extraction is now driven by user interaction only.
  // When a user clicks a field in AnnotationFieldsPanel, handleFieldClick
  // calls extractTextSpansFromJustification for that specific field.
  // This avoids eagerly highlighting all text on mount.

  const fieldsToDisplay = useMemo(() => {
    // Use getTargetKeysForScheme directly from utils
    const targetKeys = getTargetKeysForScheme(schema.id, [schema]);
    let fields = targetKeys.map(tk => ({
        name: tk.key, // This is now the full hierarchical path like "document.topics"
        type: tk.type,
        description: '', // We don't have descriptions from getTargetKeysForScheme
        config: {} // Placeholder
    }));

    // Filter out nested properties of array items (e.g., document.items.position, items.position)
    // These should be displayed within the array, not as separate top-level fields
    fields = fields.filter(f => {
      // Check if this field is a nested property of an array item
      const parts = f.name.split('.');
      if (parts.length >= 2) {
        // Check if any parent part is an array field
        // For hierarchical: document.mails.position_in_conversation (3 parts)
        // For flat: mails.position_in_conversation (2 parts)
        for (let i = 1; i < parts.length; i++) {
          const parentPath = parts.slice(0, i).join('.');
          const parentField = targetKeys.find(tk => tk.key === parentPath);
          if (parentField && parentField.type === 'array') {
            // This is a nested property of an array item - exclude it
            return false;
          }
        }
      }
      return true;
    });

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
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">Justification & Evidence</p>
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
                          {justificationValue.text_spans.map((span: any, i: number) => (
                            <div key={i} className="text-xs bg-muted-foreground/40 p-1 rounded border-l-2 border-primary/30">
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

  // Helper function to highlight all occurrences of search term in text
  // Moved here to be accessible for all field types
  const highlightTextInValue = (text: string, term: string | null): React.ReactNode => {
    if (!term || !text) return text;
    const searchLower = term.toLowerCase();
    const textLower = text.toLowerCase();
    
    // Find all occurrences
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let index = textLower.indexOf(searchLower, lastIndex);
    
    while (index !== -1) {
      // Add text before match
      if (index > lastIndex) {
        parts.push(text.slice(lastIndex, index));
      }
      // Add highlighted match
      parts.push(
        <mark key={index} className="bg-yellow-300 dark:bg-yellow-600 px-0.5 rounded">
          {text.slice(index, index + term.length)}
        </mark>
      );
      lastIndex = index + term.length;
      index = textLower.indexOf(searchLower, lastIndex);
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    
    return parts.length > 0 ? <>{parts}</> : text;
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
              const highlightedString = searchTerm ? highlightTextInValue(stringValue, searchTerm) : stringValue;
              
              let stringContent: React.ReactNode;
              // In table context, break longer strings to new line like arrays for better layout
              if (isTableContext && stringValue.length > 50) {
                stringContent = (
                  <div className="w-full">
                    <div className="text-xs leading-tight break-words max-w-full">
                      {highlightedString}
                    </div>
                  </div>
                );
              } else {
                // For shorter strings or non-table context, use inline wrapping
                stringContent = (
                  <div className="text-xs leading-tight max-w-full min-w-0 ml-1">
                    <span className="break-words">{highlightedString}</span>
                  </div>
                );
              }
              return wrapWithTooltipIfNeeded(stringContent, field, justificationValue, showIntegratedTooltip);
          case "array":
              if (Array.isArray(valueForField)) {
                  if (valueForField.length === 0) return <span className="text-muted-foreground italic text-xs">empty</span>;
                  
                  // NEW: Special handling for Knowledge Graph arrays
                  const fieldName = (field as any).name || '';
                  if (isKnowledgeGraphField(fieldName, valueForField)) {
                    // Check if this is entities or triplets
                    const isEntitiesField = fieldName === 'entities' || fieldName.endsWith('.entities');
                    const isTripletsField = fieldName === 'triplets' || fieldName.endsWith('.triplets');
                    
                    if (isEntitiesField) {
                      // Render entities as colored badges with type
                      // TODO: Extract schema colors from schema.output_contract when available
                      const kgContent = (
                        <div className="w-full">
                          <div className="flex flex-wrap gap-1 items-center">
                            {(valueForField as KGEntity[]).map((entity, i) => {
                              const badgeClasses = getEntityBadgeClasses(entity.type);
                              return (
                                <Badge 
                                  key={i} 
                                  variant="outline"
                                  className={cn(
                                    "text-xs px-2 py-0.5 font-medium whitespace-nowrap",
                                    badgeClasses
                                  )}
                                  title={`${entity.name} (${entity.type}) - ID: ${entity.id}`}
                                >
                                  <Network className="h-3 w-3 mr-1 inline" />
                                  {entity.name}
                                  <span className="ml-1 text-[10px] opacity-70">({entity.type})</span>
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      );
                      return wrapWithTooltipIfNeeded(kgContent, field, justificationValue, showIntegratedTooltip);
                    }
                    
                    if (isTripletsField) {
                      // Extract entities from the annotation for formatting triplets
                      const entities = extractEntities(rawValueObject);
                      
                      const tripletsContent = (
                        <div className="w-full space-y-1">
                          {(valueForField as KGTriplet[]).map((triplet, i) => {
                            const formatted = formatTriplet(triplet, entities);
                            const source = getEntityById(entities, triplet.source_id);
                            const target = getEntityById(entities, triplet.target_id);
                            
                            return (
                              <div 
                                key={i}
                                className={cn(
                                  "flex items-center gap-1.5 text-xs p-1.5 rounded border bg-background/50",
                                  "hover:bg-accent/50 transition-colors"
                                )}
                                title={triplet.description || formatted}
                              >
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium shrink-0">
                                  {source?.name || `ID:${triplet.source_id}`}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground shrink-0">→</span>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal shrink-0">
                                  {triplet.predicate}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground shrink-0">→</span>
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium shrink-0">
                                  {target?.name || `ID:${triplet.target_id}`}
                                </Badge>
                              </div>
                            );
                          })}
                        </div>
                      );
                      return wrapWithTooltipIfNeeded(tripletsContent, field, justificationValue, showIntegratedTooltip);
                    }
                  }
                  
                  // Check if this is an array of objects - render as structured cards
                  if (valueForField.length > 0 && typeof valueForField[0] === 'object') {
                    // Filter array items if filterArrayItems is enabled
                    // NOTE: Cannot use useMemo here as this is inside a nested function (formatFieldValue)
                    // which violates React's Rules of Hooks. Calculate inline instead.
                    const activeFiltersForArray = filters ? filters.filter((f: any) => f.isActive !== false) : [];
                    const hasActiveFiltersForArray = activeFiltersForArray.length > 0;
                    const hasSearchTermForArray = searchTerm && searchTerm.trim().length > 0;
                    
                    let arrayItemsToShow = valueForField;
                    
                    if (filterArrayItems && (hasSearchTermForArray || hasActiveFiltersForArray)) {
                      arrayItemsToShow = valueForField.filter((item: any) => {
                        // Check search term match
                        if (hasSearchTermForArray && searchInAnnotationValue(item, searchTerm)) {
                          return true;
                        }
                        
                        // Check filter matches (only if we have active filters)
                        if (hasActiveFiltersForArray) {
                          // Create a mock annotation result for filter checking
                          const mockResult = { ...result, value: item };
                          return activeFiltersForArray.some((filter: any) => checkFilterMatch(filter, [mockResult], [schema]));
                        }
                        
                        return false;
                      });
                    }
                    
                    const arrayOfObjectsContent = (
                      <div className="w-full space-y-3">
                        <div className="text-[10px] text-muted-foreground mb-1">
                          {filterArrayItems && arrayItemsToShow.length !== valueForField.length
                            ? `${arrayItemsToShow.length} of ${valueForField.length} item${valueForField.length > 1 ? 's' : ''}`
                            : `${valueForField.length} item${valueForField.length > 1 ? 's' : ''}`}
                        </div>
                        {arrayItemsToShow.map((item: any, i: number) => {
                          // Find original index for highlighting and display
                          const originalIndex = valueForField.indexOf(item);
                          const isMatch = searchTerm ? searchInAnnotationValue(item, searchTerm) : false;
                          
                          return (
                          <div 
                            key={originalIndex} 
                            className={cn(
                              "border-2 rounded-md p-3 space-y-1 shadow-sm transition-colors",
                              isMatch 
                                ? "border-yellow-400/60 bg-yellow-50/50 dark:bg-yellow-950/20" 
                                : "border-border/60 bg-muted/25"
                            )}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline" className="text-[10px] border-border/60">
                                Item {originalIndex + 1}
                              </Badge>
                            </div>
                            <div className="text-xs space-y-0 divide-y divide-border/40">
                              {Object.entries(item)
                                .filter(([_, val]) => val !== null && val !== undefined)
                                .map(([key, val]: [string, any], fieldIndex: number, filteredEntries: [string, any][]) => {
                                
                                // Handle arrays
                                if (Array.isArray(val)) {
                                  if (val.length === 0) return null;
                                  return (
                                    <div key={key} className="py-2.5 first:pt-0">
                                      <span className="font-medium text-muted-foreground">{key}:</span>{' '}
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {val.map((v: any, idx: number) => (
                                          <Badge key={idx} variant="outline" className="text-[10px]">
                                            {typeof v === 'string' ? highlightTextInValue(String(v), searchTerm) : String(v)}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                }
                                
                                // Handle objects (nested)
                                if (typeof val === 'object') {
                                  return (
                                    <div key={key} className="py-2.5 first:pt-0 bg-muted/20 -mx-3 px-3">
                                      <div className="text-[10px] text-muted-foreground mb-2 font-medium">{key}:</div>
                                      <div className="max-h-72 overflow-auto text-xs whitespace-pre-wrap break-words bg-background/50 p-2 rounded border border-border/30">
                                        {JSON.stringify(val, null, 2)}
                                      </div>
                                    </div>
                                  );
                                }
                                
                                // Handle strings (especially long ones)
                                if (typeof val === 'string' && val.length > 100) {
                                  return (
                                    <div key={key} className="py-2.5 first:pt-0 bg-muted/20 -mx-3 px-3">
                                      <div className="text-[10px] text-muted-foreground mb-2 font-medium">{key}:</div>
                                      <div className="max-h-72 overflow-auto text-xs whitespace-pre-wrap break-words bg-background/50 p-2 rounded border border-border/30">
                                        {highlightTextInValue(val, searchTerm)}
                                      </div>
                                    </div>
                                  );
                                }
                                
                                // Handle simple values
                                return (
                                  <div key={key} className="py-2.5 first:pt-0">
                                    <span className="font-medium text-muted-foreground">{key}:</span>{' '}
                                    <span className="text-foreground">
                                      {typeof val === 'string' ? highlightTextInValue(val, searchTerm) : String(val)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    );
                    return wrapWithTooltipIfNeeded(arrayOfObjectsContent, field, justificationValue, showIntegratedTooltip);
                  }
                  
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
                  // Check if this is a metadata object (small, structured)
                  const isMetadataObject = Object.keys(valueForField).length <= 10 && 
                                           !Array.isArray(valueForField);
                  
                  if (isMetadataObject) {
                    const metadataContent = (
                      <div className="w-full space-y-1">
                        {Object.entries(valueForField).map(([key, val]) => {
                          const valString = Array.isArray(val) 
                            ? `[${(val as any[]).map(v => String(v)).join(', ')}]`
                            : typeof val === 'object' && val !== null
                            ? JSON.stringify(val)
                            : String(val);
                          const highlightedVal = searchTerm ? highlightTextInValue(valString, searchTerm) : valString;
                          
                          return (
                            <div key={key} className="flex gap-2 text-xs">
                              <span className="font-medium text-muted-foreground">{key}:</span>
                              <span className="flex-1 break-words">
                                {highlightedVal}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                    return wrapWithTooltipIfNeeded(metadataContent, field, justificationValue, showIntegratedTooltip);
                  }
                  
                  // Fallback to JSON for complex objects
                  const jsonString = JSON.stringify(valueForField, null, 2);
                  const highlightedJsonString = searchTerm ? highlightTextInValue(jsonString, searchTerm) : jsonString;
                  const objectContent = (
                    <div className="max-w-full min-w-0">
                      <pre className={cn(
                        "text-[10px] bg-muted/30 p-1.5 rounded border border-border/30 max-w-full min-w-0",
                        isTableContext ? "max-h-20 overflow-auto" : "max-h-32 overflow-auto",
                        "whitespace-pre-wrap break-words"
                      )}>
                        {highlightedJsonString}
                      </pre>
                    </div>
                  );
                  return wrapWithTooltipIfNeeded(objectContent, field, justificationValue, showIntegratedTooltip);
              }
              const defaultStringValue = String(valueForField);
              const highlightedDefaultString = searchTerm ? highlightTextInValue(defaultStringValue, searchTerm) : defaultStringValue;
              
              let defaultContent: React.ReactNode;
              // In table context, break longer strings to new line like arrays
              if (isTableContext && defaultStringValue.length > 50) {
                defaultContent = (
                  <div className="w-full">
                    <div className="text-xs leading-tight break-words max-w-full">
                      {highlightedDefaultString}
                    </div>
                  </div>
                );
              } else {
                defaultContent = (
                  <div className="text-xs leading-tight max-w-full min-w-0 ml-1">
                    <span className="break-words">{highlightedDefaultString}</span>
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
  // Use enhanced layout if explicitly set OR if Justification & Evidence Inspection toggle is on (only in default context)
  const shouldUseEnhanced = renderContext === 'enhanced' || (renderContext === 'default' && showEvidencePanel && !compact);
  
  if (shouldUseEnhanced) {

    return (
      <div className="h-full w-full flex flex-col">
        {/* Header with toggle button */}
        {renderContext === 'default' && showEvidencePanel && (
          <div className="flex-none px-4 pt-3 pb-2 bg-muted/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">Annotation Review</h4>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEvidencePanel(false)}
                className="gap-2"
              >
                <PanelLeftClose className="h-4 w-4" />
                Hide Justification & Evidence Inspection
              </Button>
            </div>
          </div>
        )}
        
        {/* Single column: Evidence at top, fields beneath */}
        <div className="flex-1 min-h-0 flex flex-col gap-3 p-3">
          {/* Evidence / Justifications - at top for immediate visibility */}
          <div className="flex-1 min-h-0 border rounded-lg bg-background overflow-hidden">
            <JustificationSidebar
              result={result}
              activeField={activeFieldState}
              onSpanClick={handleSpanClick}
              onSpanSelect={handleSpanSelect}
              selectedSpan={selectedSpan ? { fieldKey: selectedSpan.fieldKey, spanIndex: selectedSpan.spanIndex } : null}
              searchTerm={searchTerm}
              filters={filters}
            />
          </div>

          {/* Annotation fields - compact view beneath evidence */}
          <div className="flex-none bg-background max-h-[40vh] overflow-y-auto scrollbar-hide">
            <AnnotationFieldsPanel
              result={result}
              schema={schema}
              asset={asset}
              selectedFieldKeys={selectedFieldKeys}
              activeField={activeFieldState}
              selectedSpan={selectedSpan ? { fieldKey: selectedSpan.fieldKey, spanIndex: selectedSpan.spanIndex } : null}
              onFieldInteraction={handleFieldInteraction}
              highlightValue={highlightValue}
              formatFieldValue={(field) => formatFieldValue(result.value, { ...field, description: field.description ?? '', config: field.config ?? {} }, highlightValue, 'default', undefined, false)}
            />
          </div>
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
  
  // Show Justification & Evidence Inspection toggle button in default (non-compact) context
  const canShowEvidencePanelToggle = renderContext === 'default' && !compact && !showEvidencePanel;

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
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              {canShowEvidencePanelToggle && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowEvidencePanel(true);
                  }}
                  className="h-7 px-2 gap-1.5 text-xs"
                >
                  <PanelLeft className="h-3.5 w-3.5" />
                  Justification & Evidence Inspection
                </Button>
              )}
            </div>
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
                        renderContext !== 'table' && ''
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
                                {/* Show modality icon if applicable */}
                                {(() => {
                                  const formatted = formatFieldNameUtil(schemaField.name);
                                  if (formatted.modality && formatted.modality !== 'document') {
                                    return (
                                      <span className="flex items-center gap-1">
                                        {getModalityIcon(formatted.modality, renderContext === 'table' ? 'sm' : 'sm')}
                                        <span className={cn(renderContext === 'table' && 'leading-tight', "whitespace-nowrap")}>
                                          {formatted.displayName}:
                                        </span>
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className={cn(renderContext === 'table' && 'leading-tight', "whitespace-nowrap")}>
                                      {formatted.displayName}:
                                    </span>
                                  );
                                })()}
                              {/* Show justification tooltip */}
                              {justificationValue && (
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
                                        <div className="space-y-2">
                                          <div className="flex items-center justify-between">
                                            <p className="text-xs font-semibold">Justification & Evidence</p>
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
                                                        {justificationValue.text_spans.slice(0, 10).map((span: any, idx: number) => (
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
 * Component to display consolidated results from same schema but different modalities (document + image)
 */
interface ConsolidatedModalityViewProps {
  results: FormattedAnnotation[];
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
  filterArrayItems?: boolean;
  searchTerm?: string | null;
  filters?: any[];
}

const ConsolidatedModalityView: React.FC<ConsolidatedModalityViewProps> = ({
  results,
  schema,
  compact = false,
  targetFieldKey = null,
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
  onLocationClick,
  filterArrayItems = false,
  searchTerm = null,
  filters = []
}) => {
  // Determine which result is document vs image based on asset kind or field structure
  const docResult = results.find(r => {
    // First check asset kind if available
    if (r.asset) {
      const isDocumentAsset = r.asset.kind === 'article' || r.asset.kind === 'web' || r.asset.kind === 'text' || r.asset.kind === 'pdf';
      if (isDocumentAsset) return true;
      const isImageAsset = r.asset.kind === 'image' || r.asset.kind === 'image_region';
      if (isImageAsset) return false;
    }
    // Fallback: check if result has document fields
    const allKeys = getTargetKeysForScheme(schema.id, [schema]);
    return allKeys.some(tk => {
      const isDocField = tk.key.startsWith('document.') || (!tk.key.startsWith('per_image.') && !tk.key.startsWith('per_audio.') && !tk.key.startsWith('per_video.'));
      return isDocField && getAnnotationFieldValue(r.value, tk.key) !== undefined;
    });
  }) || results[0]; // Fallback to first result
  
  const imgResult = results.find(r => {
    // First check asset kind if available
    if (r.asset) {
      const isImageAsset = r.asset.kind === 'image' || r.asset.kind === 'image_region';
      if (isImageAsset) return true;
      const isDocumentAsset = r.asset.kind === 'article' || r.asset.kind === 'web' || r.asset.kind === 'text' || r.asset.kind === 'pdf';
      if (isDocumentAsset) return false;
    }
    // Fallback: check if result has image fields
    const allKeys = getTargetKeysForScheme(schema.id, [schema]);
    return allKeys.some(tk => {
      return tk.key.startsWith('per_image.') && getAnnotationFieldValue(r.value, tk.key) !== undefined;
    });
  }) || (results.length > 1 && results[0] !== docResult ? results.find(r => r !== docResult) : null);

  // Get all target keys for this schema
  const allTargetKeys = getTargetKeysForScheme(schema.id, [schema]);
  const fieldsToDisplay = selectedFieldKeys 
    ? allTargetKeys.filter(tk => selectedFieldKeys.includes(tk.key))
    : allTargetKeys;

  // Group fields by modality
  const docFields: Array<{ key: string; name: string; type: string }> = [];
  const imgFields: Array<{ key: string; name: string; type: string }> = [];
  
  fieldsToDisplay.forEach(field => {
    const formatted = formatFieldNameUtil(field.key);
    const baseName = formatted.displayName;
    
    const isDocField = field.key.startsWith('document.') || (!field.key.startsWith('per_image.') && !field.key.startsWith('per_audio.') && !field.key.startsWith('per_video.'));
    const isImgField = field.key.startsWith('per_image.');
    
    const hasDocValue = docResult && getAnnotationFieldValue(docResult.value, field.key) !== undefined;
    const hasImgValue = imgResult && getAnnotationFieldValue(imgResult.value, field.key) !== undefined;
    
    if (hasDocValue || (isDocField && docResult)) {
      docFields.push({ key: field.key, name: baseName, type: field.type });
    }
    if (hasImgValue || (isImgField && imgResult)) {
      imgFields.push({ key: field.key, name: baseName, type: field.type });
    }
  });

  return (
    <div className={cn("space-y-3", renderContext === 'dialog' && "space-y-2")}>
      {/* Document modality section */}
      {docResult && docFields.length > 0 && (
        <div className="space-y-1.5">
          {/* Modality header */}
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <FileText className="h-4 w-4 text-blue-600" aria-label="Document" />
            <span>Document</span>
          </div>
          {/* Document fields */}
          {docFields.map((field) => {
            const hasValue = getAnnotationFieldValue(docResult.value, field.key) !== undefined;
            return (
              <div key={field.key} className="flex items-start gap-2 text-sm">
                <div className="flex items-center gap-1.5 flex-shrink-0 min-w-[140px]">
                  <span className="text-muted-foreground font-medium">{field.name}:</span>
                </div>
                <div className="flex-1 min-w-0">
                  {hasValue ? (
                    <div>
                      <SingleAnnotationResult
                        result={docResult}
                        schema={schema}
                        compact={true}
                        targetFieldKey={field.key}
                        renderContext={renderContext}
                        selectedFieldKeys={null}
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
                        filterArrayItems={filterArrayItems}
                        searchTerm={searchTerm}
                        filters={filters}
                      />
                    </div>
                  ) : (
                    <div className="text-muted-foreground/50 italic text-xs">N/A</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {/* Separator between modalities */}
      {docResult && docFields.length > 0 && imgResult && imgFields.length > 0 && (
        <Separator className="my-2" />
      )}
      
      {/* Image modality section */}
      {imgResult && imgFields.length > 0 && (
        <div className="space-y-1.5">
          {/* Modality header */}
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <ImageIcon className="h-4 w-4 text-green-600" aria-label="Image" />
            <span>Image</span>
          </div>
          {/* Image fields */}
          {imgFields.map((field) => {
            const hasValue = getAnnotationFieldValue(imgResult.value, field.key) !== undefined;
            return (
              <div key={field.key} className="flex items-start gap-2 text-sm">
                <div className="flex items-center gap-1.5 flex-shrink-0 min-w-[140px]">
                  <span className="text-muted-foreground font-medium">{field.name}:</span>
                </div>
                <div className="flex-1 min-w-0">
                  {hasValue ? (
                    <div>
                      <SingleAnnotationResult
                        result={imgResult}
                        schema={schema}
                        compact={true}
                        targetFieldKey={field.key}
                        renderContext={renderContext}
                        selectedFieldKeys={null}
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
                        filterArrayItems={filterArrayItems}
                        searchTerm={searchTerm}
                        filters={filters}
                      />
                    </div>
                  ) : (
                    <div className="text-muted-foreground/50 italic text-xs">N/A</div>
                  )}
                </div>
              </div>
            );
          })}
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
    onLocationClick,
    filterArrayItems = false,
    searchTerm = null,
    filters = []
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
                  filterArrayItems={filterArrayItems}
                  searchTerm={searchTerm}
                  filters={filters}
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
            filterArrayItems={filterArrayItems}
            searchTerm={searchTerm}
            filters={filters}
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
    onLocationClick,
    filterArrayItems = false,
    searchTerm = null,
    filters = []
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
          filterArrayItems={filterArrayItems}
          searchTerm={searchTerm}
          filters={filters}
        />
      );
    }
    
    // Check if all results have the same schema_id (consolidated modality results)
    const firstSchemaId = validResultsWithSchemas[0].schema.id;
    const allSameSchema = validResultsWithSchemas.every(item => item.schema.id === firstSchemaId);
    
    if (allSameSchema && validResultsWithSchemas.length === 2) {
      // This is likely consolidated modality results (document + image)
      return (
        <ConsolidatedModalityView
          results={validResultsWithSchemas.map(item => item.result)}
          schema={validResultsWithSchemas[0].schema}
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
          filterArrayItems={filterArrayItems}
          searchTerm={searchTerm}
          filters={filters}
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
        filterArrayItems={filterArrayItems}
        searchTerm={searchTerm}
        filters={filters}
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
          filterArrayItems={filterArrayItems}
          searchTerm={searchTerm}
          filters={filters}
        />
      );
    }
    return <div className="text-sm text-gray-500 italic">No matching schema found for this result. Schema ID: {result.schema_id}</div>;
  }
  
  return <div className="text-sm text-gray-500 italic">Invalid result or schema configuration provided.</div>;
};

export default AnnotationResultDisplay;
