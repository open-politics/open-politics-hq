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
import { getTargetKeysForScheme, getAnnotationFieldValue, getFieldDefinitionFromSchema, formatFieldNameForDisplay as formatFieldNameUtil, getModalityIcon, checkFilterMatch } from '@/lib/annotations/utils';
import TypedCell, { type Density, type FieldRangeCache, smartIsoDisplay, isMissingValue } from './cellRenderers';
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
// Inline graph preview for triplet fields in the detail overlay
import { ForceGraph, tripletsArrayToGraphData, defaultGraphViewConfig } from '@/components/collection/graph';

// =============================================================================
// TripletInlinePreview — extracts the inline 260px graph preview into a
// memoized component. Without this, the parent re-rendering for any unrelated
// reason (theme flip, sibling state, etc) would call ``tripletsArrayToGraphData``
// fresh and force ``ForceGraph`` to re-init its simulation. ``viewMode`` is
// hardcoded to '2d' so the Three.js bundle never loads on detail-view routes.
// =============================================================================

const TRIPLET_PREVIEW_CONFIG = {
  ...defaultGraphViewConfig,
  zoomOnNodeClick: false,
  showEdgeArrows: true,
  labelFontSize: 10,
  // Stronger repulsion + longer links so node labels in the small inline
  // viewer don't visually collide. The S5 size-aware tuning further
  // multiplies these for graphs ≤30 nodes.
  chargeStrength: -360,
  linkDistance: 120,
  warmupTicks: 80,
  autoFitOnLoad: true,
  // Inline preview zooms-to-fit in a 260px box → effective scale often
  // <0.4, which would normally hide labels. Lower the gate so the small
  // graph stays labeled.
  labelMinScale: 0.1,
  viewMode: '2d' as const,
};

const TripletInlinePreview: React.FC<{ triplets: any[] }> = React.memo(({ triplets }) => {
  const { nodes, edges } = useMemo(() => tripletsArrayToGraphData(triplets as any), [triplets]);
  // Edges shallow-clone — same gotcha as panel/curated consumers, in case the
  // inline overlay re-mounts or a parent reads from these arrays later.
  const renderEdges = useMemo(() => edges.map(e => ({ ...e })), [edges]);
  if (nodes.length === 0 || edges.length === 0) return null;
  return (
    <div className="w-full h-[260px] rounded border border-border/50 bg-background/40 overflow-hidden min-w-0">
      <ForceGraph
        nodes={nodes}
        edges={renderEdges}
        chrome="minimal"
        autoResize
        viewMode="2d"
        config={TRIPLET_PREVIEW_CONFIG}
      />
    </div>
  );
});
TripletInlinePreview.displayName = 'TripletInlinePreview';

// Local interface for schema fields
interface SchemaField {
  name: string;
  type: string;
  description: string;
  config: any;
  /** Optional render hint set by callers that want to override the default
   *  type-driven rendering — e.g. forcing the triplets field to show as the
   *  raw mini-table even in detail-overlay contexts where the graph would
   *  otherwise win. */
  renderHint?: 'graph' | 'table';
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
  /** Density tier — 'expanded' preserves legacy rendering; 'comfortable'/'compact' route through TypedCell. */
  density?: Density;
  /** Per-(schema, field) numeric range cache for inferred bars. */
  rangeCache?: FieldRangeCache;
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
  density?: Density;
  rangeCache?: FieldRangeCache;
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
  density?: Density;
  rangeCache?: FieldRangeCache;
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
  filters = [],
  density = 'expanded',
  rangeCache,
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

      if (isMissingValue(valueForField)) {
           // Distinguish "annotation failed" from "field is just missing":
           //  • status==='failure'                       → errored (backend authority)
           //  • value is the canonical {error, details}  → errored (whole-result failure)
           //  • value happens to contain an 'error' key alongside real data → NOT errored
           //    (the field is just missing; some other field carries data)
           const isErrorEnvelope = (() => {
             if (result.status === 'failure') return true;
             if (!rawValueObject || typeof rawValueObject !== 'object') return false;
             if ('error' in rawValueObject && 'details' in rawValueObject) {
               const keys = Object.keys(rawValueObject);
               if (keys.every((k) => k === 'error' || k === 'details' || k.startsWith('_'))) {
                 return true;
               }
             }
             return false;
           })();
           if (isErrorEnvelope) {
             return (
               <span className="text-destructive/70 italic text-xs inline-flex items-center gap-1" title={String((rawValueObject as any)?.error ?? 'Annotation failed')}>
                 <AlertCircle className="h-3 w-3" />
                 errored
               </span>
             );
           }
           // Missing value — muted × in the value column. For numeric / boolean
           // fields, render in the same w-8 right-aligned slot NumberCell uses
           // so × lines up with the number column across rows. For other types,
           // default left alignment.
           const ftype = (field as any).type;
           const isNumericLike = ftype === 'number' || ftype === 'integer' || ftype === 'boolean';
           return isNumericLike ? (
             <span className="text-muted-foreground/50 text-xs font-mono tabular-nums w-8 inline-block text-right" title="No value">×</span>
           ) : (
             <span className="text-muted-foreground/50 text-xs" title="No value">×</span>
           );
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
              <span className="text-xs tabular-nums min-w-0 truncate">{smartIsoDisplay(String(valueForField))}</span>
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

      // Inline graph preview for triplet fields — only in detail-overlay
      // contexts (default / enhanced / dialog), never in the table cell.
      // Triplets in this system are self-contained — each row carries its
      // own subject/object names — so we feed the array straight into the
      // adapter without an entities lookup. Falls through to the typed
      // mini-table when the array doesn't yield any usable edges OR when
      // the caller passes `renderHint: 'table'` (e.g. the panel renders
      // the same field twice — graph at top, raw table at bottom).
      const isTripletsField =
        (field.name || '').split('.').pop()?.toLowerCase() === 'triplets';
      if (isTripletsField && Array.isArray(valueForField) && valueForField.length > 0 && !isTableContext && field.renderHint !== 'table') {
        // Adapter + render are inside TripletInlinePreview so React.memo can
        // stabilize the work across unrelated parent re-renders. The "N
        // entities · M triplets" summary lives next to the field label in
        // the panel header (AnnotationFieldsPanel) — surfaced once, not twice.
        return <TripletInlinePreview triplets={valueForField as any[]} />;
      }

      // All densities route through the schema-typed renderer. The density
      // spec drives clipping / preview / chip vs mini-table — `expanded`
      // means "no limits" rather than "different code path".
      {
        const def = getFieldDefinitionFromSchema(schema, field.name);
        const typed = (
          <TypedCell
            field={{ key: field.name, name: field.name, type: (field as any).type, definition: def }}
            value={valueForField}
            density={density}
            schema={schema}
            searchTerm={searchTerm ?? undefined}
            highlightValue={highlightValue ?? undefined}
            rangeCache={rangeCache}
            onSelect={onResultSelect ? () => onResultSelect(result) : undefined}
            onTimestampClick={onTimestampClick}
            onLocationClick={onLocationClick}
          />
        );

        // Density tiers differ only in truncation/preview limits (handled by
        // density spec inside TypedCell). Layout and visual style are uniform
        // across tiers — justifications stay in the existing tooltip + the
        // detail overlay's evidence pane, not duplicated inline here.
        return wrapWithTooltipIfNeeded(typed, field, justificationValue, showIntegratedTooltip);
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
  const hasActiveFieldJustification = useMemo(() => {
    if (!activeFieldState || !result.value || typeof result.value !== 'object') return false;
    const normalize = (fieldKey: string) => fieldKey.replace(/^document\./, '').replace(/\s+/g, '');
    const normalizedActive = normalize(activeFieldState);
    return Object.keys(result.value as Record<string, unknown>).some((key) => {
      if (!key.endsWith('_justification')) return false;
      const fieldKey = key.replace('_justification', '');
      return normalize(fieldKey) === normalizedActive;
    });
  }, [activeFieldState, result.value]);
  
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
        
        {/* Single column: Evidence pinned at top, fields flow beneath.
            The justification card uses `position: sticky` against the
            outer scroll container (the right pane in AssetDetailOverlay)
            so it stays visible while the user scrolls through the field
            list and clicks rows further down — clicked field's reasoning
            stays in view without needing to scroll back up. */}
        <div className="flex flex-col p-3 min-w-0">
          {/* Evidence / Justifications - sticky to top of the scroll
              container; max-h capped so a tall justification doesn't push
              the fields list below the fold on small viewports. Internal
              overflow keeps long evidence scrollable in place. */}
          {hasActiveFieldJustification && (
            <div className="mx-0 my-1 sticky top-0 z-10 max-h-[45vh] overflow-auto border rounded-md bg-background">
              <div className="m-1">
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
              </div>
          )}

          {/* Annotation fields flow naturally below the sticky panel —
              no inner overflow, the right pane owns the vertical scroll. */}
          <div className="mt-1 bg-background min-w-0">
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
            {(() => {
              const isFoldedTable = renderContext === 'table' && !targetFieldKey;
              const isUnfoldedTable = renderContext === 'table' && compact && targetFieldKey;

              // Build per-field render data once. Captures justification + label JSX
              // so the layout below picks how to arrange them per density/mode.
              const buildFieldRender = (schemaField: SchemaField) => {
                const justificationValue = (() => {
                  if (!result.value || typeof result.value !== 'object') return undefined;
                  const justificationObj = getAnnotationFieldValue(result.value, `${schemaField.name}_justification`);
                  if (justificationObj && typeof justificationObj === 'object') return justificationObj;
                  if (typeof justificationObj === 'string') return justificationObj;
                  return undefined;
                })();

                const formatted = formatFieldNameUtil(schemaField.name);
                const labelInner = formatted.modality && formatted.modality !== 'document' ? (
                  <span className="flex items-center gap-1">
                    {getModalityIcon(formatted.modality, 'sm')}
                    <span className="leading-tight whitespace-nowrap">{formatted.displayName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}:</span>
                  </span>
                ) : (
                  <span className="leading-tight whitespace-nowrap">{formatted.displayName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}:</span>
                );

                const justificationIcon = justificationValue ? (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle
                          className={cn(
                            'cursor-help opacity-60 hover:opacity-100 hover:text-primary transition-colors',
                            renderContext === 'table' ? 'ml-0.5 h-3 w-3' : 'ml-1 h-3.5 w-3.5',
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onFieldInteraction) {
                              onFieldInteraction(schemaField.name, justificationValue);
                              return;
                            }
                            if (onResultSelect) {
                              onResultSelect({ ...result, _selectedField: schemaField.name } as FormattedAnnotation);
                            }
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="max-w-sm z-[1001]">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold">Justification & Evidence</p>
                          {typeof justificationValue === 'object' && justificationValue !== null ? (
                            <div className="space-y-1">
                              {(justificationValue as any).reasoning && (
                                <p className="text-xs">{(justificationValue as any).reasoning}</p>
                              )}
                              {Array.isArray((justificationValue as any).text_spans) && (justificationValue as any).text_spans.length > 0 && (
                                <div className="space-y-2">
                                  <p className="text-xs">📝 {(justificationValue as any).text_spans.length} text span{(justificationValue as any).text_spans.length > 1 ? 's' : ''}</p>
                                  <Separator className="my-2" />
                                  <div className="text-xs">
                                    {(justificationValue as any).text_spans.slice(0, 10).map((span: any, sidx: number) => (
                                      <div key={sidx} className="italic border border-border p-1 rounded text-wrap break-words mb-1">"{span.text_snippet}"</div>
                                    ))}
                                    {(justificationValue as any).text_spans.length > 3 && (
                                      <p className="text-muted-foreground">...and {(justificationValue as any).text_spans.length - 3} more</p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs">{String(justificationValue)}</p>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null;

                return { schemaField, justificationValue, labelInner, justificationIcon };
              };

              // Unfolded column mode (one cell == one field): just the value, no label.
              if (isUnfoldedTable) {
                return fieldsToDisplay.map((schemaField, idx) => {
                  const fr = buildFieldRender(schemaField);
                  return (
                    <div key={idx} className="min-w-0 max-w-full">
                      {formatFieldValueWithTypeIndicator(result.value, schemaField, highlightValue, renderContext, true, fr.justificationValue)}
                    </div>
                  );
                });
              }

              // Folded table mode: 3-section layout — strings | numerics | lists.
              // Each section is its own (label / value) sub-grid so values align in
              // their own column and lists get full horizontal width for chips.
              if (isFoldedTable) {
                type Bucket = 'strings' | 'numerics' | 'lists';
                const buckets: Record<Bucket, SchemaField[]> = { strings: [], numerics: [], lists: [] };
                fieldsToDisplay.forEach((sf) => {
                  const t = (sf as any).type as string;
                  const def = getFieldDefinitionFromSchema(schema, sf.name);
                  const isEnumString = t === 'string' && Array.isArray(def?.enum);
                  // Entity fields (single or array of `x-entityField` objects)
                  // read as protagonist references, not as enum chips — they
                  // belong with the strings/first column where the row's named
                  // actors and free-text live. EntityArrayCell flows them
                  // inline with subtle type swatches, so they pack into the
                  // strings section as text-with-typing rather than competing
                  // with badge strips in the lists section.
                  const isEntityField =
                    def?.['x-entityField'] === true
                    || (t === 'array' && def?.items?.['x-entityField'] === true);
                  // Booleans live with strings (column 1) — they read as flags
                  // attached to the protagonist info, not as numeric quantities,
                  // and pairing them with bars in column 2 felt mismatched.
                  if (t === 'number' || t === 'integer') {
                    buckets.numerics.push(sf);
                  } else if (isEntityField) {
                    buckets.strings.push(sf);
                  } else if (t === 'array' || t === 'object' || isEnumString) {
                    buckets.lists.push(sf);
                  } else {
                    buckets.strings.push(sf);
                  }
                });

                // Comfortable hides noise — empty numerics/lists fields and
                // triplets — to keep rows tight without scrolling. Strings
                // (column 1) is left intact since it carries the protagonist
                // information for each row. Expanded shows everything.
                const filterForComfortable = (key: Bucket, fields: SchemaField[]): SchemaField[] => {
                  if (density !== 'comfortable') return fields;
                  if (key === 'strings') return fields;
                  return fields.filter((sf) => {
                    if (sf.name && sf.name.split('.').pop()?.toLowerCase() === 'triplets') return false;
                    const v = getAnnotationFieldValue(result.value, sf.name);
                    return !isMissingValue(v);
                  });
                };

                const sections = (['strings', 'numerics', 'lists'] as Bucket[])
                  .map((k) => ({ key: k, fields: filterForComfortable(k, buckets[k]) }))
                  .filter((s) => s.fields.length > 0);

                if (sections.length === 0) return null;

                // Each section's label column auto-sizes to its own widest
                // label (via grid `max-content`). We previously enforced a
                // shared min-width across sections so labels lined up when
                // the layout wrapped onto fewer columns at narrow widths,
                // but that padded the lists section's "Schlagworte:" column
                // out to the width of the longest numerics label, pushing
                // badges visibly to the right. Trade-off chosen: keep badge
                // values close to their label; accept that on narrow widths
                // section labels won't share an x.
                const isObjectArrayFieldEarly = (sf: SchemaField) => {
                  const t = (sf as any).type as string;
                  if (t !== 'array') return false;
                  const def = getFieldDefinitionFromSchema(schema, sf.name);
                  return def?.items?.type === 'object';
                };

                const gridGapY = density === 'compact' ? 'gap-y-0.5' : density === 'expanded' ? 'gap-y-2' : 'gap-y-1';
                // Across-row snap: the GRID itself enforces a minimum row
                // height via grid-auto-rows minmax(min, max-content). Rows
                // shorter than min pad out to min (empty space below); rows
                // with naturally taller content (wrapped values, mini-tables)
                // grow as needed. Crucially we apply this at the row level,
                // not the cell level, and we don't add `items-center` on
                // cells — content stays anchored at the top of each cell, so
                // row N's content top in section A and section B both sit at
                // y = N*(rowMin + gap) regardless of whether one row has an
                // icon and another doesn't. This is what fixes the cross-
                // column drift the user observed earlier.
                const gridRowMinPx = density === 'compact' ? 18 : density === 'expanded' ? 26 : 22;
                const gridRowsStyle: React.CSSProperties = { gridAutoRows: `minmax(${gridRowMinPx}px, max-content)` };
                // Per-section min widths used by the flex-wrap layout below.
                // When the cell is wide enough, sections sit side-by-side.
                // When narrow, sections wrap onto their own row so each gets
                // the full width — avoids the case where mini-tables in
                // column 3 get squeezed to a min-width column that the user
                // can't bring fully into view by scrolling.
                const sectionMinWidth = (k: Bucket): string => {
                  if (k === 'numerics') return 'auto';
                  if (k === 'strings') return '220px';
                  return '260px'; // lists
                };

                // Lists ordering rules within column 3, low → high:
                //   0  primitive arrays (badge fields)
                //   1  object arrays (mini-tables)
                //   2  "triplets" arrays — KG payloads whose real value is in
                //      the graph view, kept in the table for completeness only
                // Each field still gets its own grid row so values stay aligned
                // at the same x within the section.
                const isObjectArrayField = (sf: SchemaField) => {
                  const t = (sf as any).type as string;
                  if (t !== 'array') return false;
                  const def = getFieldDefinitionFromSchema(schema, sf.name);
                  return def?.items?.type === 'object';
                };
                const isTripletsField = (sf: SchemaField) => {
                  const last = (sf.name || '').split('.').pop()?.toLowerCase();
                  return last === 'triplets';
                };
                const fieldHasValue = (sf: SchemaField) => {
                  const v = getAnnotationFieldValue(result.value, sf.name);
                  return !isMissingValue(v);
                };
                // Lists section ordering — type-coherent with empty fields
                // grouped within their type so the eye doesn't bounce between
                // badge-list / table / badge-list:
                //   0  badges with values
                //   1  badges without values
                //   2  tables with values
                //   3  triplets table (regardless)
                //   4  tables without values
                const listsOrderRank = (sf: SchemaField): number => {
                  const isObj = isObjectArrayField(sf);
                  const isTrip = isTripletsField(sf);
                  const hasVal = fieldHasValue(sf);
                  if (!isObj) return hasVal ? 0 : 1;
                  if (isTrip) return 3;
                  return hasVal ? 2 : 4;
                };
                const orderedFieldsForSection = (section: { key: Bucket; fields: SchemaField[] }) => {
                  if (section.key !== 'lists') return section.fields;
                  return section.fields.slice().sort((a, b) => listsOrderRank(a) - listsOrderRank(b));
                };

                return (
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-3 min-w-0 max-w-full">
                    {sections.map((section) => {
                      const minW = sectionMinWidth(section.key);
                      // numerics is shrink-0 and natural width; the others
                      // grow with flex-1 above their minimum so they share
                      // remaining space.
                      const sectionWrapClass =
                        section.key === 'numerics'
                          ? 'shrink-0 max-w-full min-w-0'
                          : 'flex-1 min-w-0';
                      const orderedFields = orderedFieldsForSection(section);
                      // Lists section gets a special two-tier layout:
                      //  • Badge fields render in the standard label/value grid
                      //    (values aligned at same x).
                      //  • Object-array fields (mini-tables) get their label
                      //    on its own row with the table beneath it spanning
                      //    the full section width — readability of multi-column
                      //    tables breaks much earlier than badge wrap when the
                      //    column is narrow, so they get the room.
                      if (section.key === 'lists') {
                        const badgeFields = orderedFields.filter((sf) => !isObjectArrayField(sf));
                        const tableFields = orderedFields.filter((sf) => isObjectArrayField(sf));
                        return (
                          <div key={section.key} className={cn(sectionWrapClass, 'space-y-2')} style={{ flexBasis: minW }}>
                            {badgeFields.length > 0 && (
                              <div className={cn('grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 min-w-0', gridGapY)} style={gridRowsStyle}>
                                {badgeFields.map((sf, fidx) => {
                                  const fr = buildFieldRender(sf);
                                  return (
                                    <React.Fragment key={`lists-badge-${fidx}`}>
                                      <div className="text-xs text-muted-foreground self-start flex items-center gap-1 min-w-0">
                                        {fr.labelInner}
                                        {fr.justificationIcon}
                                      </div>
                                      <div className="self-start text-xs leading-snug min-w-0">
                                        {formatFieldValue(result.value, sf, highlightValue, renderContext, fr.justificationValue, false)}
                                      </div>
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                            )}
                            {tableFields.map((sf, fidx) => {
                              const fr = buildFieldRender(sf);
                              return (
                                <div key={`lists-table-${fidx}`} className="min-w-0 max-w-full">
                                  <div className="text-xs text-muted-foreground flex items-center gap-1 min-w-0 mb-0.5">
                                    {fr.labelInner}
                                    {fr.justificationIcon}
                                  </div>
                                  <div className="leading-snug min-w-0">
                                    {formatFieldValue(result.value, sf, highlightValue, renderContext, fr.justificationValue, false)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      }
                      // Strings section gets a two-tier sub-layout:
                      //  • Short string + boolean fields render in the
                      //    standard label/value grid (values aligned at
                      //    same x within the section).
                      //  • Long-text fields (>100 chars in THIS row's value)
                      //    get their label on its own row with the value
                      //    beneath spanning the full section width — same
                      //    pattern the lists section uses for mini-tables.
                      //    Long paragraphs need horizontal room more than
                      //    they need to align with short labels.
                      // Also: a max-width cap so wide screens don't let one
                      // long string section push the other columns far to
                      // the right. On narrow widths the cap doesn't engage,
                      // preserving the existing tight layout.
                      // Summary always wins — even when long it floats above
                      // the short grid. Other long fields stack beneath the
                      // short grid in their schema order.
                      // Numerics keeps the simple grid.
                      const stringsLongCharThreshold = 100;
                      const isSummaryField = (sf: SchemaField) => (sf.name || '').split('.').pop()?.toLowerCase() === 'summary';
                      let stringsShortFields: SchemaField[] = orderedFields;
                      let stringsLongFields: SchemaField[] = [];
                      let stringsLeadField: SchemaField | null = null; // long summary, rendered above short grid
                      if (section.key === 'strings') {
                        stringsShortFields = [];
                        // Sort summary first so it leads the grid when short.
                        const sorted = orderedFields.slice().sort((a, b) => {
                          const aS = isSummaryField(a) ? 0 : 1;
                          const bS = isSummaryField(b) ? 0 : 1;
                          return aS - bS;
                        });
                        for (const sf of sorted) {
                          const t = (sf as any).type as string;
                          if (t === 'boolean') {
                            stringsShortFields.push(sf);
                            continue;
                          }
                          const v = getAnnotationFieldValue(result.value, sf.name);
                          const isLong = typeof v === 'string' && v.length > stringsLongCharThreshold;
                          if (isLong && isSummaryField(sf)) {
                            stringsLeadField = sf;
                          } else if (isLong) {
                            stringsLongFields.push(sf);
                          } else {
                            stringsShortFields.push(sf);
                          }
                        }
                      }
                      const stringsCapClass = section.key === 'strings' ? 'max-w-[44rem]' : '';
                      const renderLongStack = (sf: SchemaField, key: string) => {
                        const fr = buildFieldRender(sf);
                        return (
                          <div key={key} className="min-w-0 max-w-full">
                            <div className="text-xs text-muted-foreground flex items-center gap-1 min-w-0 mb-0.5">
                              {fr.labelInner}
                              {fr.justificationIcon}
                            </div>
                            <div className="leading-snug min-w-0">
                              {formatFieldValue(result.value, sf, highlightValue, renderContext, fr.justificationValue, false)}
                            </div>
                          </div>
                        );
                      };
                      return (
                        <div key={section.key} className={cn(sectionWrapClass, stringsCapClass)} style={{ flexBasis: minW }}>
                          {stringsLeadField && renderLongStack(stringsLeadField, 'strings-lead')}
                          {stringsShortFields.length > 0 && (
                            <div className={cn('grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 min-w-0', gridGapY, stringsLeadField && 'mt-2')} style={gridRowsStyle}>
                              {stringsShortFields.map((sf, fidx) => {
                                const fr = buildFieldRender(sf);
                                return (
                                  <React.Fragment key={`${section.key}-${fidx}`}>
                                    <div className="text-xs text-muted-foreground self-start flex items-center gap-1 min-w-0">
                                      {fr.labelInner}
                                      {fr.justificationIcon}
                                    </div>
                                    {/* No overflow-hidden — bars and chips need to render
                                        fully or wrap. TruncatedText handles long-string
                                        clipping internally. */}
                                    <div className="self-start text-xs leading-snug min-w-0">
                                      {formatFieldValue(result.value, sf, highlightValue, renderContext, fr.justificationValue, false)}
                                    </div>
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          )}
                          {stringsLongFields.length > 0 && (
                            <div className={cn('space-y-2', (stringsShortFields.length > 0 || stringsLeadField) && 'mt-2')}>
                              {stringsLongFields.map((sf, fidx) => renderLongStack(sf, `strings-long-${fidx}`))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // Non-table contexts (dialog/default/enhanced): inline label + value.
              return fieldsToDisplay.map((schemaField, idx) => {
                const fr = buildFieldRender(schemaField);
                return (
                  <div key={idx} className="space-y-1 min-w-0 max-w-full">
                    <div className="flex items-start gap-1 min-w-0 max-w-full">
                      <div className="flex items-center gap-1 flex-shrink-0 text-xs text-muted-foreground font-medium">
                        {fr.labelInner}
                        {fr.justificationIcon}
                      </div>
                      <div className="leading-snug min-w-0 overflow-hidden flex-1">
                        {formatFieldValue(result.value, schemaField, highlightValue, renderContext, fr.justificationValue, false)}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
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
  density?: Density;
  rangeCache?: FieldRangeCache;
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
  filters = [],
  density = 'expanded',
  rangeCache,
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
                        density={density}
                        rangeCache={rangeCache}
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
                        density={density}
                        rangeCache={rangeCache}
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
    filters = [],
    density = 'expanded',
    rangeCache,
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
                  density={density}
                  rangeCache={rangeCache}
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
            density={density}
            rangeCache={rangeCache}
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
    filters = [],
    density = 'expanded',
    rangeCache,
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
          density={density}
          rangeCache={rangeCache}
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
          density={density}
          rangeCache={rangeCache}
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
        density={density}
        rangeCache={rangeCache}
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
          density={density}
          rangeCache={rangeCache}
        />
      );
    }
    return <div className="text-sm text-gray-500 italic">No matching schema found for this result. Schema ID: {result.schema_id}</div>;
  }
  
  return <div className="text-sm text-gray-500 italic">Invalid result or schema configuration provided.</div>;
};

export default AnnotationResultDisplay;
