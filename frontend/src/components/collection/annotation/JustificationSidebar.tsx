'use client';

import React, { useMemo, useRef, useEffect } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FormattedAnnotation } from '@/lib/annotations/types';

interface JustificationSidebarProps {
  result: FormattedAnnotation;
  activeField?: string | null;
  onSpanClick?: (spanId: string) => void;
  onSpanSelect?: (fieldKey: string, spanIndex: number, span: any) => void;
  selectedSpan?: { fieldKey: string; spanIndex: number } | null;
  className?: string;
  searchTerm?: string | null;
  filters?: any[];
}

interface JustificationData {
  fieldKey: string;
  fieldDisplayName: string;
  reasoning?: string;
  textSpans?: any[];
  confidence?: number;
}

const JustificationSidebar: React.FC<JustificationSidebarProps> = ({
  result,
  activeField = null,
  onSpanClick,
  onSpanSelect,
  selectedSpan = null,
  className,
  searchTerm = null,
  filters = []
}) => {
  // Refs for scroll-to functionality
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const justificationRefs = useRef<Record<string, HTMLDivElement | null>>({});
  
  // Removed expand/collapse state - show all evidence by default

  // Extract justifications from the result
  const justifications = useMemo<JustificationData[]>(() => {
    if (!result.value || typeof result.value !== 'object') {
      return [];
    }

    const justificationData: JustificationData[] = [];
    const resultValue = result.value as any;

    // Look for justification fields in the result
    Object.keys(resultValue).forEach(key => {
      if (key.endsWith('_justification')) {
        const fieldKey = key.replace('_justification', '');
        const justificationObj = resultValue[key];
        
        if (justificationObj && typeof justificationObj === 'object') {
          justificationData.push({
            fieldKey,
            fieldDisplayName: fieldKey.replace(/^document\./, ''), // Clean field name
            reasoning: justificationObj.reasoning,
            textSpans: justificationObj.text_spans || [],
            confidence: justificationObj.confidence
          });
        }
      }
    });

    return justificationData;
  }, [result.value]);

  // Helper function to normalize field keys for matching
  const normalizeFieldKey = (fieldKey: string): string => {
    // Remove "document." prefix and normalize spacing/casing
    return fieldKey.replace(/^document\./, '').replace(/\s+/g, '');
  };

  // Filter justifications based on activeField, searchTerm, and filters
  const activeJustifications = useMemo(() => {
    let filtered = justifications;
    
    // Filter by activeField if specified
    if (activeField) {
      const normalizedActiveField = normalizeFieldKey(activeField);
      filtered = filtered.filter(j => {
        const normalizedJustificationField = normalizeFieldKey(j.fieldKey);
        return normalizedJustificationField === normalizedActiveField;
      });
    }
    
    // Filter by searchTerm if provided
    if (searchTerm && searchTerm.trim().length > 0) {
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(j => {
        // Search in field name
        if (j.fieldDisplayName.toLowerCase().includes(searchLower)) {
          return true;
        }
        // Search in reasoning
        if (j.reasoning && j.reasoning.toLowerCase().includes(searchLower)) {
          return true;
        }
        // Search in text spans
        if (j.textSpans && j.textSpans.some(span => {
          const snippet = span.text_snippet || span.text || '';
          return snippet.toLowerCase().includes(searchLower);
        })) {
          return true;
        }
        return false;
      });
    }
    
    // Filter by active filters if provided
    if (filters && filters.length > 0) {
      const activeFilters = filters.filter((f: any) => f.isActive !== false);
      if (activeFilters.length > 0) {
        // Apply filter logic (simplified - can be enhanced based on filter structure)
        filtered = filtered.filter(j => {
          // For now, we'll just check if any filter matches the field name or reasoning
          // This can be expanded based on your filter structure
          return activeFilters.some((filter: any) => {
            const filterValue = String(filter.value || '').toLowerCase();
            if (j.fieldDisplayName.toLowerCase().includes(filterValue)) {
              return true;
            }
            if (j.reasoning && j.reasoning.toLowerCase().includes(filterValue)) {
              return true;
            }
            return false;
          });
        });
      }
    }
    
    return filtered;
  }, [justifications, activeField, searchTerm, filters]);

  // Scroll to active field justification when activeField changes
  useEffect(() => {
    if (!activeField) return;

    // Small delay to ensure elements are rendered
    const timeoutId = setTimeout(() => {
      // Try to find matching justification by normalizing field keys
      let justificationElement = justificationRefs.current[activeField];
      
      // If direct match fails, try normalized matching
      if (!justificationElement) {
        const normalizedActiveField = normalizeFieldKey(activeField);
        
        // Find matching ref by comparing normalized keys
        const matchingKey = Object.keys(justificationRefs.current).find(key => {
          const normalizedKey = normalizeFieldKey(key);
          return normalizedKey === normalizedActiveField;
        });
        
        if (matchingKey) {
          justificationElement = justificationRefs.current[matchingKey];
        }
      }
      
      if (!justificationElement) {
        return;
      }
      
      if (justificationElement && scrollAreaRef.current) {
        // Try multiple selectors to find the scrollable viewport
        let scrollContainer = 
          scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') ||
          scrollAreaRef.current.querySelector('.h-full.w-full') ||
          scrollAreaRef.current.querySelector('[style*="overflow"]') ||
          scrollAreaRef.current.firstElementChild;
        
        // Fallback: if no specific container found, use the ScrollArea itself
        if (!scrollContainer) {
          scrollContainer = scrollAreaRef.current;
        }
        
        if (scrollContainer && typeof scrollContainer.scrollTo === 'function') {
          try {
            // Calculate the position to scroll to
            const elementTop = justificationElement.offsetTop;
            const containerHeight = scrollContainer.clientHeight;
            const elementHeight = justificationElement.clientHeight;
            
            // Center the element in the view, with some padding
            const scrollPosition = Math.max(0, elementTop - (containerHeight / 2) + (elementHeight / 2));
            
            scrollContainer.scrollTo({
              top: scrollPosition,
              behavior: 'smooth'
            });
          } catch {
            // Fallback: simple scrollIntoView
            justificationElement.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
              inline: 'nearest'
            });
          }
        } else {
          // Final fallback: use native scrollIntoView
          justificationElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          });
        }
      }
    }, 100); // Small delay to ensure DOM is ready

    return () => clearTimeout(timeoutId);
  }, [activeField]);

  const renderJustificationItem = (justification: JustificationData, isActive: boolean) => (
    <div
      key={justification.fieldKey}
      ref={(el) => {
        if (el) {
          justificationRefs.current[justification.fieldKey] = el;
        }
      }}
      className={cn(
        "rounded-md px-2.5 py-2 space-y-1.5 scroll-mt-4",
        isActive
          ? "bg-primary/5 ring-1 ring-primary/20"
          : "bg-muted/30"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0 font-medium",
            isActive
              ? "bg-primary/10 text-primary border-primary/40"
              : "bg-background"
          )}
        >
          {justification.fieldDisplayName}
        </Badge>
        {justification.textSpans && justification.textSpans.length > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {justification.textSpans.length} span{justification.textSpans.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {justification.reasoning && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {justification.reasoning}
        </p>
      )}

      {justification.textSpans && justification.textSpans.length > 0 && (
        <div className="space-y-1 pt-0.5">
          {[...justification.textSpans]
            .sort((a, b) => (a.start_char_offset ?? 0) - (b.start_char_offset ?? 0))
            .map((span, index) => {
            const isSelected = selectedSpan?.fieldKey === justification.fieldKey && selectedSpan?.spanIndex === index;

            return (
              <div
                key={index}
                className={cn(
                  "rounded px-2 py-1 cursor-pointer text-xs transition-colors",
                  isSelected
                    ? "bg-primary/10 ring-1 ring-primary/30"
                    : "bg-background/60 hover:bg-background"
                )}
                onClick={() => {
                  if (selectedSpan?.fieldKey === justification.fieldKey && selectedSpan?.spanIndex === index) {
                    onSpanSelect?.(justification.fieldKey, -1, null);
                  } else {
                    onSpanSelect?.(justification.fieldKey, index, span);
                  }
                }}
              >
                <span className="text-foreground/80 italic">"{span.text_snippet}"</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const hasJustifications = justifications.length > 0;
  const hasFilteredJustifications = activeJustifications.length > 0;
  const showingActiveOnly = activeField && hasFilteredJustifications;
  const hasActiveFieldWithNoJustifications = activeField && !hasFilteredJustifications;
  const hasSearchOrFilters = (searchTerm && searchTerm.trim().length > 0) || (filters && filters.length > 0 && filters.some((f: any) => f.isActive !== false));

  // When no search/filters: active evidence first, rest beneath
  const orderedJustifications = useMemo(() => {
    if (!activeField) return justifications;
    const normalizedActive = normalizeFieldKey(activeField);
    const active = justifications.find(j => normalizeFieldKey(j.fieldKey) === normalizedActive);
    const rest = justifications.filter(j => normalizeFieldKey(j.fieldKey) !== normalizedActive);
    return active ? [active, ...rest] : justifications;
  }, [justifications, activeField]);

  const orderedActiveJustifications = useMemo(() => {
    if (!activeField) return activeJustifications;
    const normalizedActive = normalizeFieldKey(activeField);
    const active = activeJustifications.find(j => normalizeFieldKey(j.fieldKey) === normalizedActive);
    const rest = activeJustifications.filter(j => normalizeFieldKey(j.fieldKey) !== normalizedActive);
    return active ? [active, ...rest] : activeJustifications;
  }, [activeJustifications, activeField]);

  return (
    <div className={cn("h-full flex flex-col bg-background", className)}>
      <ScrollArea 
        ref={scrollAreaRef}
        className="flex-1"
      >
        <div className="p-2 space-y-2">
          {!hasJustifications ? (
            <p className="text-xs text-muted-foreground/60 text-center py-6">
              No evidence available
            </p>
          ) : hasActiveFieldWithNoJustifications ? (
            <p className="text-xs text-muted-foreground/60 text-center py-6">
              No evidence for this field
            </p>
          ) : showingActiveOnly || hasSearchOrFilters ? (
            <>
              {orderedActiveJustifications.map(justification =>
                renderJustificationItem(justification, normalizeFieldKey(justification.fieldKey) === normalizeFieldKey(activeField || ''))
              )}
            </>
          ) : !activeField ? (
            <p className="text-xs text-muted-foreground/60 text-center py-6">
              Select a field to see evidence
            </p>
          ) : (
            <>
              {orderedJustifications.map(justification =>
                renderJustificationItem(justification, normalizeFieldKey(justification.fieldKey) === normalizeFieldKey(activeField))
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default JustificationSidebar; 