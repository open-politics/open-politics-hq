'use client';

import React, { useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FormattedAnnotation } from '@/lib/annotations/types';
import { AnnotationSchemaRead, AssetRead } from '@/client';
import { getTargetKeysForScheme, getAnnotationFieldValue, formatFieldNameForDisplay as formatFieldNameUtil } from '@/lib/annotations/utils';
import { useTextSpanHighlight } from '@/components/collection/contexts/TextSpanHighlightContext';
import { resolveSpans } from '@/lib/annotations/textSpanCorrection';

interface AnnotationFieldsPanelProps {
  result: FormattedAnnotation;
  schema: AnnotationSchemaRead;
  asset?: AssetRead | null;
  selectedFieldKeys?: string[] | null;
  activeField?: string | null;
  selectedSpan?: { fieldKey: string; spanIndex: number } | null;
  onFieldInteraction?: (fieldKey: string, justification: any) => void;
  highlightValue?: string | null;
  /** Optional: use shared formatFieldValue from parent for badges, arrays, etc. */
  formatFieldValue?: (field: { name: string; type: string; description?: string; config?: any }) => React.ReactNode;
}

const AnnotationFieldsPanel: React.FC<AnnotationFieldsPanelProps> = ({
  result,
  schema,
  asset = null,
  selectedFieldKeys = null,
  activeField = null,
  selectedSpan = null,
  onFieldInteraction,
  highlightValue = null,
  formatFieldValue: formatFieldValueProp
}) => {
  const { showFieldSpans, clearHighlights } = useTextSpanHighlight();

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

  const renderFieldValueFallback = (fieldValue: any) => {
    if (fieldValue === null || fieldValue === undefined) {
      return <span className="text-muted-foreground/60 italic text-xs">N/A</span>;
    }
    if (typeof fieldValue === 'boolean') {
      return <span className="text-xs">{fieldValue ? "Yes" : "No"}</span>;
    }
    if (typeof fieldValue === 'number') {
      return <span className="text-xs tabular-nums">{fieldValue}</span>;
    }
    if (Array.isArray(fieldValue)) {
      if (fieldValue.length === 0) return <span className="text-muted-foreground/60 italic text-xs">empty</span>;
      if (typeof fieldValue[0] === 'object') {
        return <span className="text-xs text-muted-foreground">{fieldValue.length} items</span>;
      }
      return (
        <div className="flex flex-wrap gap-1 items-center">
          {fieldValue.map((item: any, i: number) => (
            <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 font-normal border-border/40">
              {String(item)}
            </Badge>
          ))}
        </div>
      );
    }
    const stringValue = String(fieldValue);
    const display = stringValue.length > 80 ? stringValue.slice(0, 180) + '...' : stringValue;
    return <span className="text-xs break-words">{display}</span>;
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

  const getEvidenceInfo = useCallback((field: any) => {
    return fieldEvidenceCache.get(field.name)?.evidenceInfo || null;
  }, [fieldEvidenceCache]);

  // Define handleFieldClick after cache
  const handleFieldClick = useCallback((fieldKey: string) => {
    if (!onFieldInteraction) return;

    const evidenceInfo = fieldEvidenceCache.get(fieldKey)?.evidenceInfo;
    const justification = evidenceInfo?.justification || null;

    if (justification && typeof justification === 'object' && justification.text_spans?.length > 0) {
      const assetText = asset?.text_content ?? (result.asset as any)?.text_content ?? '';
      const assetUuid = asset?.uuid ?? (result.asset as any)?.uuid;
      const resolved = resolveSpans(assetText, justification.text_spans).map(span => ({
        ...span,
        fieldName: fieldKey,
        schemaName: schema.name,
        justificationReasoning: justification.reasoning,
      }));
      showFieldSpans(result.asset_id, resolved, assetUuid);
    } else {
      clearHighlights();
    }

    onFieldInteraction(fieldKey, justification);
  }, [fieldEvidenceCache, result.asset_id, result.asset, asset, onFieldInteraction, schema.name, showFieldSpans, clearHighlights]);

  // Minimal evidence indicator - just a small dot
  const renderEvidenceDot = (field: any) => {
    const evidenceInfo = getEvidenceInfo(field);
    if (!evidenceInfo) return null;
    const { spanCount } = evidenceInfo;
    if (spanCount === 0) return null;
    return (
      <span className="text-[10px] text-muted-foreground tabular-nums">{spanCount} piece{spanCount > 1 ? 's' : ''} of evidence</span>
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
      <ScrollArea className="flex-1">
        <div className="py-1 px-1 space-y-2">
          {fieldsToDisplay.map((field) => {
            const fieldValue = getAnnotationFieldValue(result.value, field.name);
            const isActive = activeField === field.name;
            const displayName = formatFieldNameUtil(field.name).displayName;

            return (
              <div
                key={field.name}
                className={cn(
                  "rounded-md px-2.5 py-2 cursor-pointer transition-colors",
                  isActive
                    ? "bg-primary/5 ring-1 ring-primary/20"
                    : "bg-muted/30 hover:bg-muted/50"
                )}
                onClick={() => handleFieldClick(field.name)}
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 font-medium truncate max-w-full",
                      isActive
                        ? "bg-primary/10 text-primary border-primary/40"
                        : "bg-background"
                    )}
                  >
                    {displayName}
                  </Badge>
                  {renderEvidenceDot(field)}
                </div>
                <div className="mt-1.5 text-foreground">
                  {formatFieldValueProp
                    ? formatFieldValueProp(field)
                    : renderFieldValueFallback(fieldValue)}
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