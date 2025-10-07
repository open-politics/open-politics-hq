'use client';

import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from '@/components/ui/button';
import { FileText, Quote, ChevronRight } from 'lucide-react';
import { cn } from "@/lib/utils";
import { FormattedAnnotation } from '@/lib/annotations/types';
import { TextSpanSnippets } from '@/components/ui/highlighted-text';
import { Separator } from '@/components/ui/separator';

interface JustificationSidebarProps {
  result: FormattedAnnotation;
  activeField?: string | null;
  onSpanClick?: (spanId: string) => void;
  onSpanSelect?: (fieldKey: string, spanIndex: number, span: any) => void;
  selectedSpan?: { fieldKey: string; spanIndex: number } | null;
  className?: string;
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
  className
}) => {
  // Refs for scroll-to functionality
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const justificationRefs = useRef<Record<string, HTMLDivElement | null>>({});
  
  // Track which justifications have expanded spans
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set());

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

  // Filter to show only active field justification if specified
  const activeJustifications = useMemo(() => {
    if (!activeField) {
      return justifications;
    }
    
    // Use normalized field key matching to handle "document.topics" vs "topics" mismatches
    const normalizedActiveField = normalizeFieldKey(activeField);
    return justifications.filter(j => {
      const normalizedJustificationField = normalizeFieldKey(j.fieldKey);
      return normalizedJustificationField === normalizedActiveField;
    });
  }, [justifications, activeField]);

  // Scroll to active field justification when activeField changes
  useEffect(() => {
    if (!activeField) return;

    console.log('Attempting scroll for activeField:', activeField);
    console.log('Available justification refs:', Object.keys(justificationRefs.current));

    // Small delay to ensure elements are rendered
    const timeoutId = setTimeout(() => {
      // Try to find matching justification by normalizing field keys
      let justificationElement = justificationRefs.current[activeField];
      
      // If direct match fails, try normalized matching
      if (!justificationElement) {
        const normalizedActiveField = normalizeFieldKey(activeField);
        console.log('Direct match failed, trying normalized:', normalizedActiveField);
        
        // Find matching ref by comparing normalized keys
        const matchingKey = Object.keys(justificationRefs.current).find(key => {
          const normalizedKey = normalizeFieldKey(key);
          return normalizedKey === normalizedActiveField;
        });
        
        if (matchingKey) {
          justificationElement = justificationRefs.current[matchingKey];
          console.log('Found matching ref with key:', matchingKey);
        } else {
          console.log('No justification found for field:', activeField, '- this field may not have justification data');
        }
      }
      
      if (!justificationElement) {
        console.log('Cannot scroll: No justification element found for field:', activeField);
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
            
            console.log('Scrolling to justification:', activeField, {
              elementTop,
              containerHeight,
              elementHeight,
              scrollPosition
            });
            
            scrollContainer.scrollTo({
              top: scrollPosition,
              behavior: 'smooth'
            });
          } catch (error) {
            console.error('Error scrolling to justification:', error);
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
          console.log('Set ref for justification:', justification.fieldKey, el);
        }
      }}
      className={cn(
        "p-3 rounded-xl border transition-all scroll-mt-4 hover:shadow-md relative",
        isActive 
          ? "border-primary bg-gradient-to-br from-primary/10 to-primary/15 shadow-lg ring-2 ring-primary/30" 
          : "border-border bg-background hover:border-primary/30 hover:bg-muted/20"
      )}
    >
      {/* Active field indicator */}
      {isActive && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full animate-pulse shadow-md">
          <div className="absolute inset-0 bg-primary rounded-full animate-ping opacity-75"></div>
        </div>
      )}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            {/* Field icon - always show if justification exists, with different styles for active/inactive */}
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm flex-shrink-0",
              isActive 
                ? "bg-primary shadow-lg animate-pulse" 
                : justification.textSpans && justification.textSpans.length > 0
                ? "bg-green-500 hover:bg-green-600 transition-colors"
                : justification.reasoning
                ? "bg-blue-500 hover:bg-blue-600 transition-colors"
                : "bg-gray-400"
            )}>
              {isActive ? (
                "🎯"
              ) : justification.textSpans && justification.textSpans.length > 0 ? (
                <FileText className="h-3.5 w-3.5" />
              ) : justification.reasoning ? (
                <Quote className="h-3.5 w-3.5" />
              ) : (
                "📋"
              )}
            </div>
            <h4 className={cn(
              "text-sm font-semibold flex-1",
              isActive ? "text-primary font-bold" : "text-foreground"
            )}>
              {justification.fieldDisplayName}
            </h4>
            {isActive && (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded-full font-medium">
                  ACTIVE
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {justification.textSpans && justification.textSpans.length > 0 && (
              <Badge variant="outline" className={cn("text-xs px-1.5 py-0.5", isActive && "border-primary text-primary")}>
                {justification.textSpans.length} span{justification.textSpans.length !== 1 ? 's' : ''}
              </Badge>
            )}
            {typeof justification.confidence === 'number' && (
              <Badge 
                variant={justification.confidence > 0.8 ? "default" : justification.confidence > 0.6 ? "secondary" : "outline"} 
                className="text-xs px-1.5 py-0.5"
              >
                {Math.round(justification.confidence * 100)}%
              </Badge>
            )}
          </div>
        </div>
      </div>

      {justification.reasoning && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Quote className={cn(
              "h-3.5 w-3.5",
              isActive ? "text-amber-600" : "text-amber-500"
            )} />
            <span className={cn(
              "text-sm font-medium",
              isActive ? "text-foreground font-semibold" : "text-foreground"
            )}>Reasoning</span>
            {isActive && (
              <div className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
            )}
          </div>
          <div className={cn(
            "border rounded-lg p-2.5",
            isActive 
              ? "bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700/50 shadow-md"
              : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/30"
          )}>
            <p className={cn(
              "text-sm leading-relaxed italic",
              isActive ? "text-foreground font-medium" : "text-foreground"
            )}>
              {justification.reasoning}
            </p>
          </div>
        </div>
      )}

      {justification.textSpans && justification.textSpans.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <FileText className={cn(
                "h-3.5 w-3.5",
                isActive ? "text-primary" : "text-primary/70"
              )} />
              <span className={cn(
                "text-sm font-medium",
                isActive ? "text-foreground font-semibold" : "text-foreground"
              )}>
                Evidence
              </span>
              {isActive && (
                <div className="w-1 h-1 rounded-full bg-primary animate-pulse" />
              )}
            </div>
            <Badge 
              variant={isActive ? "default" : "secondary"} 
              className={cn(
                "text-xs px-1.5 py-0.5",
                isActive && "shadow-sm"
              )}
            >
              {justification.textSpans.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {justification.textSpans.map((span, index) => {
              const isSelected = selectedSpan?.fieldKey === justification.fieldKey && selectedSpan?.spanIndex === index;
              const isExpanded = expandedSpans.has(justification.fieldKey);
              const isVisible = index < 2 || isSelected || isExpanded; // Show first 2, selected, or if expanded
              
              if (!isVisible && index >= 2) return null;
              
              return (
                <div 
                  key={index} 
                  className={cn(
                    "rounded-lg p-2.5 border-l-4 transition-all cursor-pointer hover:shadow-sm",
                    isSelected 
                      ? "bg-primary/10 border-primary shadow-md ring-2 ring-primary/30" 
                      : isActive 
                      ? "bg-primary/5 border-primary/60 hover:bg-primary/10 shadow-sm"
                      : "bg-muted/30 border-primary/40 hover:bg-muted/50"
                  )}
                  onClick={() => {
                    // Toggle selection - if this span is already selected, deselect it
                    if (selectedSpan?.fieldKey === justification.fieldKey && selectedSpan?.spanIndex === index) {
                      onSpanSelect?.(justification.fieldKey, -1, null); // Use -1 to indicate deselection
                    } else {
                      onSpanSelect?.(justification.fieldKey, index, span);
                    }
                  }}
                >
                                      <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <span className={cn(
                          "w-3.5 h-3.5 rounded-full text-[10px] flex items-center justify-center font-medium",
                          isSelected 
                            ? "bg-primary text-white shadow-md" 
                            : isActive
                            ? "bg-primary/30 text-primary border border-primary/40"
                            : "bg-primary/20 text-primary"
                        )}>
                          {index + 1}
                        </span>
                        <span className={cn(
                          isSelected && "font-medium text-foreground",
                          isActive && !isSelected && "font-medium text-primary/80"
                        )}>
                          Evidence {index + 1}
                        </span>
                      </div>
                    {isSelected && (
                      <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                        Selected
                      </span>
                    )}
                  </div>
                  <p className={cn(
                    "text-sm italic leading-relaxed",
                    isSelected 
                      ? "text-foreground font-semibold" 
                      : isActive
                      ? "text-foreground font-medium"
                      : "text-foreground"
                  )}>
                    "{span.text_snippet}"
                  </p>
                  {span.start_char_offset !== undefined && span.end_char_offset !== undefined && (
                    <div className="text-xs text-muted-foreground mt-1.5 opacity-75">
                      Pos: {span.start_char_offset}-{span.end_char_offset}
                    </div>
                  )}
                </div>
              );
            })}
            {justification.textSpans.length > 2 && !expandedSpans.has(justification.fieldKey) && (
              <div 
                className="text-xs text-muted-foreground text-center py-1.5 bg-muted/10 rounded cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => {
                  // Expand all spans for this justification
                  setExpandedSpans(prev => new Set(prev).add(justification.fieldKey));
                }}
              >
                + {justification.textSpans.length - 2} more span{justification.textSpans.length - 2 !== 1 ? 's' : ''} (click to show all)
              </div>
            )}
            {justification.textSpans.length > 2 && expandedSpans.has(justification.fieldKey) && (
              <div 
                className="text-xs text-muted-foreground text-center py-1.5 bg-muted/10 rounded cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => {
                  // Collapse spans back to first 2
                  setExpandedSpans(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(justification.fieldKey);
                    return newSet;
                  });
                }}
              >
                Show less
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const hasJustifications = justifications.length > 0;
  const showingActiveOnly = activeField && activeJustifications.length > 0;
  const hasActiveFieldWithNoJustifications = activeField && activeJustifications.length === 0;

  return (
    <div className={cn("h-full flex flex-col bg-background", className)}>
      <div className="flex-none p-3 border-b bg-gradient-to-r from-blue-50/50 to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Quote className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {showingActiveOnly ? 'Active Evidence' : 'Evidence & Justifications'}
              </h3>
              {hasJustifications && (
                <p className="text-xs text-muted-foreground">
                  {showingActiveOnly ? activeJustifications.length : justifications.length} field{(showingActiveOnly ? activeJustifications.length : justifications.length) !== 1 ? 's' : ''} with evidence
                </p>
              )}
            </div>
          </div>
          {hasJustifications && (
            <Badge variant="secondary" className="text-xs font-medium">
              {showingActiveOnly ? activeJustifications.length : justifications.length}
            </Badge>
          )}
        </div>
        {selectedSpan && (
          <div className="bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800/30 rounded-lg p-2">
            <p className="text-xs text-yellow-800 dark:text-yellow-200">
              <span className="font-medium">Selected:</span> Evidence {selectedSpan.spanIndex + 1} from {selectedSpan.fieldKey.replace(/^document\./, '')}
            </p>
          </div>
        )}
        {!selectedSpan && showingActiveOnly && (
          <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/30 rounded-lg p-2">
            <p className="text-xs text-blue-800 dark:text-blue-200">
              <span className="font-medium">Focused on:</span> {activeField?.replace(/^document\./, '')}
            </p>
          </div>
        )}
        {!selectedSpan && !showingActiveOnly && hasJustifications && (
          <div className="bg-gray-100 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700/30 rounded-lg p-2">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              💡 Click annotation fields on the left to focus • Click evidence spans to highlight in text
            </p>
          </div>
        )}
      </div>

      <ScrollArea 
        ref={scrollAreaRef}
        className="flex-1"
      >
        <div className="p-3 pb-4">
          {!hasJustifications ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground p-6">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 flex items-center justify-center mb-4">
                <Quote className="h-8 w-8 opacity-60" />
              </div>
              <p className="text-sm text-center font-medium mb-2">
                No Evidence Available
              </p>
              <p className="text-xs text-center opacity-75 max-w-xs">
                This annotation doesn't include detailed justifications or text evidence. The model provided a direct answer without citing specific sources.
              </p>
            </div>
          ) : hasActiveFieldWithNoJustifications ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground p-6">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-800 dark:to-orange-700 flex items-center justify-center mb-4">
                <Quote className="h-8 w-8 opacity-60" />
              </div>
              <p className="text-sm text-center font-medium mb-2">
                No Evidence for This Field
              </p>
              <p className="text-xs text-center opacity-75 max-w-xs">
                The field "{activeField?.replace(/^document\./, '')}" was annotated without detailed justifications or text evidence. The model provided a direct answer for this field.
              </p>
            </div>
          ) : showingActiveOnly ? (
            <div className="space-y-4">
              {activeJustifications.map(justification => 
                renderJustificationItem(justification, true)
              )}
            </div>
          ) : !activeField ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground p-6">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-800 dark:to-blue-700 flex items-center justify-center mb-4">
                <Quote className="h-8 w-8 opacity-60" />
              </div>
              <p className="text-sm text-center font-medium mb-2">
                Select a Field
              </p>
              <p className="text-xs text-center opacity-75 max-w-xs">
                Click on a field in the left panel to view its evidence and justifications here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {justifications.map(justification => 
                renderJustificationItem(justification, justification.fieldKey === activeField)
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default JustificationSidebar; 