import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Info, RefreshCw } from 'lucide-react';
import { analyzeSpanQuality, correctTextSpans, DEFAULT_CORRECTION_OPTIONS, type TextSpan, type CorrectedTextSpan } from '@/lib/annotations/textSpanCorrection';
import { cn } from '@/lib/utils';

interface TextSpanQualityInspectorProps {
  textContent: string;
  spans: TextSpan[];
  title?: string;
  onApplyCorrections?: (correctedSpans: CorrectedTextSpan[]) => void;
  className?: string;
}

const TextSpanQualityInspector: React.FC<TextSpanQualityInspectorProps> = ({
  textContent,
  spans,
  title = "Text Span Quality Analysis",
  onApplyCorrections,
  className
}) => {
  // Analyze current span quality
  const qualityAnalysis = useMemo(() => {
    return analyzeSpanQuality(textContent, spans);
  }, [textContent, spans]);

  // Generate corrected spans
  const correctedSpans = useMemo(() => {
    if (!textContent || spans.length === 0) return [];
    return correctTextSpans(textContent, spans, DEFAULT_CORRECTION_OPTIONS);
  }, [textContent, spans]);

  // Calculate improvement statistics
  const improvements = useMemo(() => {
    const correctedCount = correctedSpans.filter(span => span.was_corrected).length;
    const removedCount = spans.length - correctedSpans.length;
    const mergedCount = correctedSpans.filter(span => span.correction_reason?.includes('Merged')).length;
    
    return {
      correctedCount,
      removedCount,
      mergedCount,
      improvementRate: spans.length > 0 ? (correctedCount / spans.length) * 100 : 0
    };
  }, [spans, correctedSpans]);

  const getQualityBadgeVariant = (recommendations: string[]) => {
    if (recommendations.length === 0) return "default";
    if (recommendations.length <= 2) return "secondary";
    return "destructive";
  };

  const getQualityLabel = (recommendations: string[]) => {
    if (recommendations.length === 0) return "Excellent";
    if (recommendations.length <= 2) return "Good";
    if (recommendations.length <= 4) return "Fair";
    return "Poor";
  };

  return (
    <TooltipProvider>
      <Card className={cn("w-full", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {title}
              <Badge variant={getQualityBadgeVariant(qualityAnalysis.recommendations)}>
                {getQualityLabel(qualityAnalysis.recommendations)}
              </Badge>
            </span>
            {onApplyCorrections && improvements.correctedCount > 0 && (
              <Button
                size="sm"
                onClick={() => onApplyCorrections(correctedSpans)}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Apply Corrections ({improvements.correctedCount})
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Summary Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="space-y-1">
              <div className="text-muted-foreground">Total Spans</div>
              <div className="font-semibold">{qualityAnalysis.totalSpans}</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Avg Length</div>
              <div className="font-semibold">{Math.round(qualityAnalysis.averageLength)} chars</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Issues Found</div>
              <div className="font-semibold text-orange-600">{qualityAnalysis.recommendations.length}</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Can Improve</div>
              <div className="font-semibold text-green-600">{improvements.correctedCount}</div>
            </div>
          </div>

          {/* Quality Issues */}
          {qualityAnalysis.recommendations.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Quality Recommendations
              </h4>
              <div className="space-y-1">
                {qualityAnalysis.recommendations.map((recommendation, index) => (
                  <div key={index} className="text-sm text-muted-foreground bg-orange-50 dark:bg-orange-950/30 p-2 rounded border-l-2 border-orange-500">
                    {recommendation}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Improvement Preview */}
          {improvements.correctedCount > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Proposed Improvements
              </h4>
              <div className="grid grid-cols-3 gap-4 text-sm">
                {improvements.correctedCount > 0 && (
                  <div className="text-center p-2 bg-blue-50 dark:bg-blue-950/30 rounded">
                    <div className="font-semibold text-blue-600">{improvements.correctedCount}</div>
                    <div className="text-xs text-muted-foreground">Corrected Spans</div>
                  </div>
                )}
                {improvements.removedCount > 0 && (
                  <div className="text-center p-2 bg-red-50 dark:bg-red-950/30 rounded">
                    <div className="font-semibold text-red-600">{improvements.removedCount}</div>
                    <div className="text-xs text-muted-foreground">Removed (Invalid)</div>
                  </div>
                )}
                {improvements.mergedCount > 0 && (
                  <div className="text-center p-2 bg-green-50 dark:bg-green-950/30 rounded">
                    <div className="font-semibold text-green-600">{improvements.mergedCount}</div>
                    <div className="text-xs text-muted-foreground">Merged Overlaps</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Detailed Span Analysis */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between p-2 h-auto">
                <span className="font-medium text-sm">Detailed Span Analysis ({spans.length} spans)</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="max-h-96 mt-2">
                <div className="space-y-2">
                  {spans.map((span, index) => {
                    const correctedSpan = correctedSpans.find(cs => 
                      Math.abs(cs.start_char_offset - span.start_char_offset) < 10 ||
                      cs.text_snippet.includes(span.text_snippet.slice(0, 20))
                    );
                    
                    const isValid = span.start_char_offset >= 0 && 
                                  span.end_char_offset <= textContent.length && 
                                  span.start_char_offset < span.end_char_offset;
                                  
                    const isWhitespaceOnly = span.text_snippet.trim().length === 0;
                    const spanLength = span.end_char_offset - span.start_char_offset;

                    return (
                      <div key={index} className={cn(
                        "p-3 rounded border text-sm",
                        correctedSpan?.was_corrected ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200" : "bg-background",
                        !isValid && "bg-red-50 dark:bg-red-950/30 border-red-200"
                      )}>
                        <div className="flex items-start justify-between mb-2">
                          <span className="font-medium">Span {index + 1}</span>
                          <div className="flex gap-1">
                            {!isValid && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="destructive" className="text-xs">Invalid</Badge>
                                </TooltipTrigger>
                                <TooltipContent>Character offsets are out of bounds or invalid</TooltipContent>
                              </Tooltip>
                            )}
                            {isWhitespaceOnly && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="outline" className="text-xs">Whitespace</Badge>
                                </TooltipTrigger>
                                <TooltipContent>Contains only whitespace characters</TooltipContent>
                              </Tooltip>
                            )}
                            {correctedSpan?.was_corrected && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="secondary" className="text-xs">Corrected</Badge>
                                </TooltipTrigger>
                                <TooltipContent>{correctedSpan.correction_reason}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                        
                        <div className="space-y-1 text-xs">
                          <div>
                            <strong>Range:</strong> {span.start_char_offset} - {span.end_char_offset} ({spanLength} chars)
                            {correctedSpan?.was_corrected && correctedSpan.original_start !== undefined && (
                              <span className="text-blue-600 ml-2">
                                → {correctedSpan.start_char_offset} - {correctedSpan.end_char_offset}
                              </span>
                            )}
                          </div>
                          <div>
                            <strong>Text:</strong> "{span.text_snippet}"
                            {correctedSpan?.was_corrected && correctedSpan.text_snippet !== span.text_snippet && (
                              <div className="text-blue-600 mt-1">
                                <strong>Corrected:</strong> "{correctedSpan.text_snippet}"
                              </div>
                            )}
                          </div>
                          {correctedSpan?.correction_reason && (
                            <div className="text-blue-600">
                              <strong>Correction:</strong> {correctedSpan.correction_reason}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>

          {/* Additional Information */}
          {qualityAnalysis.recommendations.length === 0 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/30 rounded border-l-4 border-green-500">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div className="text-sm">
                <div className="font-medium">Excellent span quality!</div>
                <div className="text-muted-foreground">All text spans are properly aligned and formatted.</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};

export default TextSpanQualityInspector; 