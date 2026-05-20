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

/**
 * Preferred top-of-panel ordering. Matches against the field's last path
 * segment (case-insensitive). Trailing `*` is a prefix match, so `'source*'`
 * catches `source`, `source_name`, `source_url`, etc. Anything not in this
 * list keeps its natural order after the matched ones. `duplicateAtEnd` lists
 * fields that should also render again at the bottom — useful for triplets
 * where the top instance is a graph and the bottom instance is the raw table
 * (granular but redundant; kept observable on demand).
 */
export interface FieldOrderConfig {
  preferred: string[];
  duplicateAtEnd?: string[];
}

export const DEFAULT_FIELD_ORDER: FieldOrderConfig = {
  preferred: ['triplets', 'summary', 'keywords', 'source*', 'timestamp', 'date', 'datetime', 'location'],
  duplicateAtEnd: ['triplets'],
};

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
  formatFieldValue?: (field: { name: string; type: string; description?: string; config?: any; renderHint?: 'graph' | 'table' }) => React.ReactNode;
  /** Override the default top/bottom field ordering. Pass `null` to disable
   *  reordering entirely (natural schema order). */
  fieldOrder?: FieldOrderConfig | null;
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
  formatFieldValue: formatFieldValueProp,
  fieldOrder = DEFAULT_FIELD_ORDER,
}) => {
  const { showFieldSpans, clearHighlights } = useTextSpanHighlight();

  type DisplayField = {
    name: string;
    type: string;
    description: string;
    config: any;
    renderHint?: 'graph' | 'table';
    /** Stable key — the same field can appear twice (e.g. triplets at top as
     *  graph, at bottom as table), so we can't key by name alone. */
    rowKey: string;
  };

  const fieldsToDisplay = useMemo<DisplayField[]>(() => {
    const targetKeys = getTargetKeysForScheme(schema.id, [schema]);
    let fields: DisplayField[] = targetKeys.map(tk => ({
        name: tk.key,
        type: tk.type,
        description: '',
        config: {},
        rowKey: tk.key,
    }));

    if (selectedFieldKeys && selectedFieldKeys.length > 0) {
      fields = fields.filter(f => selectedFieldKeys.includes(f.name));
    }

    // No reordering when caller opts out.
    if (!fieldOrder) return fields;

    // Match a field's last path segment against an entry from the preferred
    // list. `name*` is a prefix match; otherwise exact (case-insensitive).
    // Returns the entry's index in the preferred list, or -1 if no match.
    const lastSegment = (n: string) => (n || '').split('.').pop()?.toLowerCase() ?? '';
    const matchIndex = (fieldName: string): number => {
      const seg = lastSegment(fieldName);
      for (let i = 0; i < fieldOrder.preferred.length; i++) {
        const pat = fieldOrder.preferred[i].toLowerCase();
        if (pat.endsWith('*')) {
          if (seg.startsWith(pat.slice(0, -1))) return i;
        } else if (seg === pat) {
          return i;
        }
      }
      return -1;
    };

    // Stable sort: matched fields first in preferred-list order, then the
    // rest in original schema order.
    const indexed = fields.map((f, originalIdx) => ({ f, originalIdx, prefIdx: matchIndex(f.name) }));
    indexed.sort((a, b) => {
      if (a.prefIdx === -1 && b.prefIdx === -1) return a.originalIdx - b.originalIdx;
      if (a.prefIdx === -1) return 1;
      if (b.prefIdx === -1) return -1;
      if (a.prefIdx !== b.prefIdx) return a.prefIdx - b.prefIdx;
      return a.originalIdx - b.originalIdx;
    });
    let ordered = indexed.map(x => x.f);

    // Duplicate selected fields at the end with a `'table'` render hint —
    // used for triplets where the top instance renders as a graph and the
    // bottom instance renders as the raw mini-table for granular inspection.
    if (fieldOrder.duplicateAtEnd && fieldOrder.duplicateAtEnd.length > 0) {
      const dupPatterns = fieldOrder.duplicateAtEnd.map(p => p.toLowerCase());
      const matchesDup = (n: string) => {
        const seg = lastSegment(n);
        return dupPatterns.some(p => p.endsWith('*') ? seg.startsWith(p.slice(0, -1)) : seg === p);
      };
      const duplicates: DisplayField[] = ordered
        .filter(f => matchesDup(f.name))
        .map(f => ({ ...f, renderHint: 'table' as const, rowKey: `${f.name}::table` }));
      ordered = [...ordered, ...duplicates];
    }

    return ordered;
  }, [schema, selectedFieldKeys, fieldOrder]);

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

  // Evidence indicator — single phrase ("explanation provided") for any
  // justification, with an optional span counter appended when text spans
  // are available. Reasoning alone is enough to surface the indicator;
  // span-only is unusual but handled symmetrically. Returns null only when
  // no justification of any kind exists for the field.
  const renderEvidenceDot = (field: any) => {
    const evidenceInfo = getEvidenceInfo(field);
    if (!evidenceInfo) return null;
    const { spanCount, hasReasoning } = evidenceInfo;
    if (!hasReasoning && spanCount === 0) return null;
    return (
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        explanation provided
        {spanCount > 0 && (
          <span className="ml-1 tabular-nums">· {spanCount} {spanCount === 1 ? 'piece' : 'pieces'} of evidence</span>
        )}
      </span>
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
    <div className="h-full flex flex-col min-w-0">
      {/* Plain overflow-auto rather than radix ScrollArea — radix Viewport
          uses display:table and grows to content width, which gets clipped
          by ScrollArea root's overflow:hidden when something inside (e.g. a
          mini-table) is wider than the available pane. Native overflow-auto
          gives both axes a real scrollbar at the field-list level when the
          inner content forces it. */}
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="py-1 px-1 space-y-2 min-w-0">
          {fieldsToDisplay.map((field) => {
            const fieldValue = getAnnotationFieldValue(result.value, field.name);
            const isActive = activeField === field.name;
            const isTripletsLastSeg = (field.name || '').split('.').pop()?.toLowerCase() === 'triplets';
            // Append a subtle suffix when this is the duplicated table copy
            // so the user can distinguish the two triplet rows visually.
            const displayName = field.renderHint === 'table'
              ? `${formatFieldNameUtil(field.name).displayName} (table)`
              : formatFieldNameUtil(field.name).displayName;
            // Only the primary (non-duplicate) row carries the evidence
            // indicator — duplicating it on the table copy would be noise.
            const showEvidence = field.renderHint !== 'table';

            // Inline summary for the triplets graph row: "N entities · M
            // triplets" lives next to the label instead of consuming a full
            // row above the graph. Cheap to compute (small arrays).
            let inlineSummary: React.ReactNode = null;
            if (isTripletsLastSeg && field.renderHint !== 'table' && Array.isArray(fieldValue) && fieldValue.length > 0) {
              const labels = new Set<string>();
              for (const t of fieldValue as any[]) {
                const s = (t?.subject_name ?? t?.subject ?? '').toString().trim().toLowerCase();
                const o = (t?.object_name ?? t?.object ?? '').toString().trim().toLowerCase();
                if (s) labels.add(s);
                if (o) labels.add(o);
              }
              const entityCount = labels.size;
              const tripletCount = fieldValue.length;
              if (entityCount > 0 && tripletCount > 0) {
                inlineSummary = (
                  <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                    {entityCount} {entityCount === 1 ? 'entity' : 'entities'} · {tripletCount} {tripletCount === 1 ? 'triplet' : 'triplets'}
                  </span>
                );
              }
            }

            return (
              <div
                key={field.rowKey}
                className={cn(
                  "rounded-md px-2.5 py-2 cursor-pointer transition-colors",
                  isActive
                    ? "bg-primary/5 ring-1 ring-primary/20"
                    : "bg-muted/30 hover:bg-muted/50"
                )}
                onClick={() => handleFieldClick(field.name)}
              >
                {/* Field label as inline section header — uppercase tracking-
                    wide muted text reads as a label rather than a tag. The
                    optional inline summary (triplets counts) sits next to it
                    instead of taking its own row. */}
                <div className="flex items-baseline justify-between gap-3 min-w-0">
                  <div className="flex items-baseline gap-2 min-w-0 flex-1">
                    <span
                      className={cn(
                        "text-[11px] font-semibold tracking-tight truncate",
                        isActive ? "text-primary" : "text-foreground/85",
                      )}
                    >
                      {displayName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                    {inlineSummary}
                  </div>
                  {showEvidence && renderEvidenceDot(field)}
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
      </div>
    </div>
  );
};

export default AnnotationFieldsPanel; 