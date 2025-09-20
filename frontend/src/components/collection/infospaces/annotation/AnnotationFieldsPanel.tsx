'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, HelpCircle, FileText, MessageCircle, Zap, Eye } from 'lucide-react';
import { cn } from "@/lib/utils";
import { FormattedAnnotation } from '@/lib/annotations/types';
import { AnnotationSchemaRead } from '@/client/models';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getTargetKeysForScheme, getAnnotationFieldValue } from '@/lib/annotations/utils';
import { TextSpanSnippets } from '@/components/ui/highlighted-text';
import { useAnnotationTextSpans } from '@/contexts/TextSpanHighlightContext';

interface AnnotationFieldsPanelProps {
  result: FormattedAnnotation;
  schema: AnnotationSchemaRead;
  selectedFieldKeys?: string[] | null;
  activeField?: string | null;
  selectedSpan?: { fieldKey: string; spanIndex: number } | null;
  onFieldInteraction?: (fieldKey: string, justification: any) => void;
  highlightValue?: string | null;
}

// Utility function to format field names for display
const formatFieldNameForDisplay = (fieldName: string): string => {
  // Remove "document." prefix if present to make field names cleaner
  if (fieldName.startsWith('document.')) {
    return fieldName.substring('document.'.length);
  }
  return fieldName;
};

const AnnotationFieldsPanel: React.FC<AnnotationFieldsPanelProps> = ({
  result,
  schema,
  selectedFieldKeys = null,
  activeField = null,
  selectedSpan = null,
  onFieldInteraction,
  highlightValue = null
}) => {
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const { extractTextSpansFromJustification } = useAnnotationTextSpans();

  const fieldsToDisplay = useMemo(() => {
    const targetKeys = getTargetKeysForScheme(schema.id, [schema]);
    let fields = targetKeys.map(tk => ({
        name: tk.key,
        type: tk.type,
        description: '',
        config: {}
    }));

    if (selectedFieldKeys && selectedFieldKeys.length > 0) {
      fields = fields.filter(f => selectedFieldKeys.includes(f.name));
    }
    
    return fields;
  }, [schema, selectedFieldKeys]);





  const toggleFieldExpansion = useCallback((fieldKey: string) => {
    setExpandedFields(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fieldKey)) {
        newSet.delete(fieldKey);
      } else {
        newSet.add(fieldKey);
      }
      return newSet;
    });
  }, []);

  const renderFieldValue = (field: any, fieldValue: any, isActive: boolean) => {
    if (fieldValue === null || fieldValue === undefined) {
      return <span className="text-muted-foreground italic">N/A</span>;
    }
    
    // Handle different value types
    if (typeof fieldValue === 'boolean') {
      return (
        <Badge variant={fieldValue ? "default" : "secondary"} className={cn(
          "transition-colors",
          isActive && "ring-2 ring-primary ring-opacity-50"
        )}>
          {fieldValue ? "Yes" : "No"}
        </Badge>
      );
    }

    if (typeof fieldValue === 'number') {
      return (
        <span className={cn(
          "font-medium",
          isActive && "bg-primary/10 px-1 rounded"
        )}>
          {fieldValue}
        </span>
      );
    }

    if (Array.isArray(fieldValue)) {
      return (
        <div className={cn(
          "space-y-1",
          isActive && "bg-primary/5 p-2 rounded border border-primary/20"
        )}>
          {fieldValue.map((item: any, index: number) => (
            <Badge 
              key={index} 
              variant="outline" 
              className={cn(
                "mr-1 mb-1 transition-colors",
                highlightValue && String(item) === highlightValue && "bg-yellow-100 border-yellow-400",
                isActive && "border-primary/50"
              )}
            >
              {String(item)}
            </Badge>
          ))}
        </div>
      );
    }

    // Handle string values - always show full content
    const stringValue = String(fieldValue);
    return (
      <div className={cn(
        "space-y-1 max-w-full",
        isActive && "bg-primary/5 p-2 rounded border border-primary/20"
      )}>
        <div className={cn(
          "whitespace-pre-wrap break-words text-sm leading-relaxed",
          isActive && "font-medium"
        )}>
          {stringValue}
        </div>
      </div>
    );
  };

  // Memoized field evidence cache to avoid repeated computations
  const fieldEvidenceCache = useMemo(() => {
    if (!result.value || typeof result.value !== 'object') return new Map();
    
    const cache = new Map<string, {
      hasJustification: boolean;
      evidenceInfo: {
        hasEvidence: boolean;
        hasReasoning: boolean;
        spanCount: number;
        justification: any;
      } | null;
    }>();

    fieldsToDisplay.forEach(field => {
      // Use multiple strategies to find justification, similar to getAnnotationFieldValue
      const possibleKeys = [
        // Strategy 1: Direct field name + _justification
        `${field.name}_justification`,
        
        // Strategy 2: Without "document." prefix if present
        ...(field.name.startsWith('document.') ? [
          `${field.name.replace('document.', '')}_justification`
        ] : []),
        
        // Strategy 3: Just the flat field name (last part of hierarchical path)
        ...(field.name.includes('.') ? [
          `${field.name.split('.').pop()}_justification`
        ] : []),
        
        // Strategy 4: Normalized field name (remove spaces, case insensitive)
        `${field.name.replace(/^document\./, '').replace(/[\s\-_]/g, '').toLowerCase()}_justification`,
      ];
      
      let justification: any = null;
      let hasJustification = false;
      
      // Try each possible key
      for (const key of possibleKeys) {
        if ((result.value as any)[key]) {
          justification = (result.value as any)[key];
          hasJustification = true;
          break;
        }
      }
      
      // Strategy 5: Case-insensitive search through all keys ending with _justification
      if (!justification) {
        const allKeys = Object.keys(result.value);
        const justificationKeys = allKeys.filter(key => key.endsWith('_justification'));
        
        for (const justKey of justificationKeys) {
          const fieldPart = justKey.replace('_justification', '');
          const normalizedFieldPart = fieldPart.replace(/[\s\-_]/g, '').toLowerCase();
          const normalizedFieldName = field.name.replace(/^document\./, '').replace(/[\s\-_]/g, '').toLowerCase();
          
          if (normalizedFieldPart === normalizedFieldName) {
            justification = (result.value as any)[justKey];
            hasJustification = true;
            break;
          }
        }
      }

             // Build evidence info
       let evidenceInfo: {
         hasEvidence: boolean;
         hasReasoning: boolean;
         spanCount: number;
         justification: any;
       } | null = null;
       
       if (justification && typeof justification === 'object') {
         const hasTextSpans = justification.text_spans && Array.isArray(justification.text_spans) && justification.text_spans.length > 0;
         const hasReasoning = justification.reasoning && typeof justification.reasoning === 'string';
         const spanCount = (justification.text_spans && Array.isArray(justification.text_spans)) ? justification.text_spans.length : 0;

         evidenceInfo = {
           hasEvidence: hasTextSpans,
           hasReasoning,
           spanCount,
           justification
         };
       }

      cache.set(field.name, {
        hasJustification,
        evidenceInfo
      });
    });

    return cache;
  }, [result.value, fieldsToDisplay]);

  // Stable helper functions using the cache
  const hasJustification = useCallback((field: any): boolean => {
    return fieldEvidenceCache.get(field.name)?.hasJustification || false;
  }, [fieldEvidenceCache]);

  const getEvidenceInfo = useCallback((field: any) => {
    return fieldEvidenceCache.get(field.name)?.evidenceInfo || null;
  }, [fieldEvidenceCache]);

  // Define handleFieldClick after cache
  const handleFieldClick = useCallback((fieldKey: string) => {
    if (!onFieldInteraction) return;

    // Get justification from the cache
    const evidenceInfo = fieldEvidenceCache.get(fieldKey)?.evidenceInfo;
    const justification = evidenceInfo?.justification || null;

    // Extract and process text spans from justification if available
    if (justification && typeof justification === 'object' && justification['text_spans']?.length > 0) {
      // Process text spans for highlighting asynchronously
      const assetUuid = (result.asset as any)?.uuid;
      extractTextSpansFromJustification(
        justification,
        result.asset_id,
        assetUuid,
        fieldKey,
        schema.name
      ).catch(error => {
        console.error('Failed to process text spans for field interaction:', error);
      });
    }

    onFieldInteraction(fieldKey, justification);
  }, [fieldEvidenceCache, result.asset_id, result.asset, onFieldInteraction, extractTextSpansFromJustification, schema.name]);

  // Render professional evidence status indicator
  const renderEvidenceStatus = (field: any, isActive: boolean, hasSelectedSpan: boolean) => {
    const evidenceInfo = getEvidenceInfo(field);
    
    if (!evidenceInfo) return null;

    const { hasEvidence, hasReasoning, spanCount, justification } = evidenceInfo;

    return (
      <div className="flex items-center gap-2">
        {/* Evidence type indicator - show multiple badges when multiple types exist */}
        {isActive ? (
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
            "bg-primary text-primary-foreground shadow-sm"
          )}>
            <Eye className="h-3 w-3" />
            Active
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {hasEvidence && (
              <div className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                hasSelectedSpan
                  ? "bg-yellow-100 text-yellow-800 border border-yellow-200"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              )}>
                <FileText className="h-3 w-3" />
                {spanCount} Evidence{spanCount !== 1 && 's'}
              </div>
            )}
            {hasReasoning && (
              <div className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                hasSelectedSpan
                  ? "bg-yellow-100 text-yellow-800 border border-yellow-200"
                  : "bg-blue-50 text-blue-700 border border-blue-200"
              )}>
                <MessageCircle className="h-3 w-3" />
                Reasoning
              </div>
            )}
            {!hasEvidence && !hasReasoning && hasJustification(field) && (
              <div className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                "bg-gray-50 text-gray-600 border border-gray-200"
              )}>
                <Zap className="h-3 w-3" />
                Basic
              </div>
            )}
          </div>
        )}

        {/* Tooltip with details */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <HelpCircle className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm" align="start">
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                <h4 className="font-medium text-sm">Field Evidence</h4>
                {justification && typeof justification === 'object' && typeof justification.reasoning === 'string' && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Reasoning</p>
                    <p className="text-xs leading-relaxed">{justification.reasoning}</p>
                  </div>
                )}
                {justification && typeof justification === 'object' && Array.isArray(justification.text_spans) && justification.text_spans.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Text Evidence ({justification.text_spans.length} span{justification.text_spans.length !== 1 ? 's' : ''})
                    </p>
                    <div className="text-xs space-y-1">
                      {justification.text_spans.slice(0, 3).map((span: any, idx: number) => (
                        <div key={idx} className="italic bg-muted/20 p-1.5 rounded text-wrap break-words border-l-2 border-emerald-200">
                          "{span.text_snippet || span.text}"
                        </div>
                      ))}
                      {justification.text_spans.length > 3 && (
                        <p className="text-muted-foreground font-medium">
                          ...and {justification.text_spans.length - 3} more span{justification.text_spans.length - 3 !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  };

  const isFailed = result.status === "failure";

  if (isFailed) {
    return (
      <div className="p-4 border-l-4 border-destructive bg-destructive/5">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="destructive">Failed</Badge>
          <span className="text-sm font-medium">Annotation Failed</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {(result as any).error_message || 'Unknown error occurred during annotation.'}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-none p-3 border-b bg-muted/10">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold truncate">{schema.name}</h3>
          <Badge variant="outline" className="text-xs">
            {fieldsToDisplay.length}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Click fields to view evidence and justifications
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {fieldsToDisplay.map((field, fieldIndex) => {
            const fieldValue = getAnnotationFieldValue(result.value, field.name);
            const isActive = activeField === field.name;
            const hasSelectedSpan = selectedSpan?.fieldKey === field.name;
            
            return (
              <div
                key={field.name}
                className={cn(
                  "rounded-lg border p-2.5 transition-all cursor-pointer hover:shadow-sm",
                  isActive 
                    ? "border-primary bg-primary/5 shadow-sm" 
                    : hasSelectedSpan
                    ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 shadow-sm"
                    : "border-border bg-background hover:border-primary/30"
                )}
                onClick={() => handleFieldClick(field.name)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <h4 className={cn(
                          "text-sm font-medium transition-colors flex-1 min-w-0",
                          isActive ? "text-primary font-semibold" : "text-foreground"
                        )}>
                          {formatFieldNameForDisplay(field.name)}
                        </h4>
                      </div>
                      {hasSelectedSpan && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-xs px-2 py-1 rounded-md bg-yellow-100 text-yellow-800 border border-yellow-200 font-medium">
                            Span {selectedSpan!.spanIndex + 1}
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      {field.type}
                    </p>
                    {/* Professional evidence status */}
                    {hasJustification(field) && renderEvidenceStatus(field, isActive, hasSelectedSpan)}
                  </div>
                </div>
                <div className="mt-2">
                  {renderFieldValue(field, fieldValue, isActive)}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};

export default AnnotationFieldsPanel; 