import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Bug, Eye } from 'lucide-react';
import { FormattedAnnotation } from '@/lib/annotations/types';
import { AnnotationSchemaRead } from '@/client/models';
import { getAnnotationFieldValue } from '@/lib/annotations/utils';

interface AnnotationDataInspectorProps {
  result: FormattedAnnotation;
  schema: AnnotationSchemaRead;
  className?: string;
}

interface JustificationAnalysis {
  fieldName: string;
  hasJustification: boolean;
  justificationData?: any;
  textSpansCount: number;
  textSpans?: any[];
  imageRegionsCount: number;
  audioSegmentsCount: number;
}

const AnnotationDataInspector: React.FC<AnnotationDataInspectorProps> = ({
  result,
  schema,
  className
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };

  const analyzeJustifications = (): JustificationAnalysis[] => {
    const analysis: JustificationAnalysis[] = [];
    
    if (!result.value || typeof result.value !== 'object') {
      return analysis;
    }

    // Look for all justification fields in the result
    Object.keys(result.value).forEach(key => {
      if (key.endsWith('_justification')) {
        const fieldName = key.replace('_justification', '');
        const justificationData = result.value[key];
        
        let textSpansCount = 0;
        let textSpans: any[] = [];
        let imageRegionsCount = 0;
        let audioSegmentsCount = 0;

        if (justificationData && typeof justificationData === 'object') {
          if (justificationData.text_spans && Array.isArray(justificationData.text_spans)) {
            textSpansCount = justificationData.text_spans.length;
            textSpans = justificationData.text_spans;
          }
          if (justificationData.image_regions && Array.isArray(justificationData.image_regions)) {
            imageRegionsCount = justificationData.image_regions.length;
          }
          if (justificationData.audio_segments && Array.isArray(justificationData.audio_segments)) {
            audioSegmentsCount = justificationData.audio_segments.length;
          }
        }

        analysis.push({
          fieldName,
          hasJustification: !!justificationData,
          justificationData,
          textSpansCount,
          textSpans,
          imageRegionsCount,
          audioSegmentsCount
        });
      }
    });

    return analysis;
  };

  const justificationAnalysis = analyzeJustifications();
  const totalTextSpans = justificationAnalysis.reduce((sum, item) => sum + item.textSpansCount, 0);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className={`${className} gap-2`}
        >
          <Eye className="h-3 w-3" />
          Details
          {totalTextSpans > 0 && (
            <Badge variant="secondary" className="text-xs">
              {totalTextSpans} spans
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Annotation Data Inspector
            <Badge variant="outline">
              Asset ID: {result.asset_id}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            
            {/* Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <strong>Schema:</strong> {schema.name}
                  </div>
                  <div>
                    <strong>Result ID:</strong> {result.id}
                  </div>
                  <div>
                    <strong>Status:</strong> {result.status}
                  </div>
                  <div>
                    <strong>Total Text Spans:</strong> {totalTextSpans}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Justifications Analysis */}
            {justificationAnalysis.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Justifications Found</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {justificationAnalysis.map((analysis, index) => (
                    <Collapsible key={index}>
                      <CollapsibleTrigger
                        onClick={() => toggleSection(`justification-${index}`)}
                        className="flex items-center justify-between w-full p-2 bg-muted/50 rounded hover:bg-muted/70 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {expandedSections.has(`justification-${index}`) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <span className="font-medium">{analysis.fieldName}_justification</span>
                        </div>
                        <div className="flex gap-2">
                          {analysis.textSpansCount > 0 && (
                            <Badge variant="default" className="text-xs">
                              {analysis.textSpansCount} text spans
                            </Badge>
                          )}
                          {analysis.imageRegionsCount > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              {analysis.imageRegionsCount} images
                            </Badge>
                          )}
                          {analysis.audioSegmentsCount > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              {analysis.audioSegmentsCount} audio
                            </Badge>
                          )}
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <div className="pl-6 space-y-2">
                          {analysis.textSpans && analysis.textSpans.length > 0 && (
                            <div>
                              <h4 className="font-medium text-sm mb-2">Text Spans:</h4>
                              {analysis.textSpans.map((span, spanIndex) => (
                                <div key={spanIndex} className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded border-l-2 border-yellow-400">
                                  <div className="text-xs space-y-1">
                                    <div><strong>Offsets:</strong> {span.start_char_offset} - {span.end_char_offset}</div>
                                    <div><strong>Text:</strong> "{span.text_snippet}"</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </CardContent>
              </Card>
            )}

          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default AnnotationDataInspector; 