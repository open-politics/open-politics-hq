'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Sparkles, FileText } from 'lucide-react';
import { AnnotationSchemaRead } from '@/client';
import { ResultWithSourceInfo } from './AnnotationResultsTable';

interface GuidedRetryModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: ResultWithSourceInfo | null;
  schema: AnnotationSchemaRead | null;
  onRetry: (resultId: number, customPrompt: string) => Promise<void>;
  isRetrying: boolean;
}

// Helper function to extract field descriptions from schema
const extractFieldDescriptions = (schema: AnnotationSchemaRead): Array<{key: string, description: string, type: string}> => {
  if (!schema?.output_contract) return [];
  
  const fields: Array<{key: string, description: string, type: string}> = [];
  const contract = schema.output_contract as any;
  
  if (contract.properties) {
    // Handle document-level fields
    if (contract.properties.document?.properties) {
      Object.entries(contract.properties.document.properties).forEach(([fieldKey, fieldSchema]: [string, any]) => {
        if (fieldSchema.description) {
          fields.push({
            key: `document.${fieldKey}`,
            description: fieldSchema.description,
            type: fieldSchema.type || 'unknown'
          });
        }
      });
    }
    
    // Handle per-modality fields (per_image, per_audio, etc.)
    Object.entries(contract.properties).forEach(([sectionKey, sectionSchema]: [string, any]) => {
      if (sectionKey.startsWith('per_') && sectionSchema.type === 'array' && sectionSchema.items?.properties) {
        Object.entries(sectionSchema.items.properties).forEach(([fieldKey, fieldSchema]: [string, any]) => {
          if (fieldSchema.description) {
            fields.push({
              key: `${sectionKey}.${fieldKey}`,
              description: fieldSchema.description,
              type: fieldSchema.type || 'unknown'
            });
          }
        });
      }
    });
  }
  
  return fields;
};

const GuidedRetryModal: React.FC<GuidedRetryModalProps> = ({
  isOpen,
  onClose,
  result,
  schema,
  onRetry,
  isRetrying,
}) => {
  const [customGuidance, setCustomGuidance] = useState('');

  const fieldDescriptions = useMemo(() => {
    if (!schema) return [];
    return extractFieldDescriptions(schema);
  }, [schema]);

  const handleRetry = useCallback(async () => {
    if (!result || !customGuidance.trim()) return;
    
    try {
      await onRetry(result.id, customGuidance.trim());
      onClose();
      setCustomGuidance('');
    } catch (error) {
      // Error handling done in parent
    }
  }, [result, customGuidance, onRetry, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
    setCustomGuidance('');
  }, [onClose]);

  if (!isOpen || !result || !schema) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-600" />
            Guided Retry: {schema.name}
          </DialogTitle>
          <DialogDescription>
            Review the current field prompts and add additional guidance for this specific retry.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-4">
          {/* Current Field Prompts */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <h3 className="font-medium">Current Field Prompts</h3>
              <Badge variant="outline" className="text-xs">
                {fieldDescriptions.length} fields
              </Badge>
            </div>
            
            <ScrollArea className="max-h-60 border rounded-lg">
              <div className="p-4 space-y-3">
                {fieldDescriptions.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic">
                    No field descriptions found in this schema.
                  </div>
                ) : (
                  fieldDescriptions.map((field, index) => (
                    <Card key={field.key} className="text-sm">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-medium">{field.key}</CardTitle>
                          <Badge variant="secondary" className="text-xs">
                            {field.type}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-sm text-muted-foreground">{field.description}</p>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Additional Guidance */}
          <div className="space-y-3 p-2">
            <Label htmlFor="custom-guidance" className="text-base font-medium">
              Additional Guidance for this Retry
            </Label>
            <Textarea
              id="custom-guidance"
              value={customGuidance}
              onChange={(e) => setCustomGuidance(e.target.value)}
              placeholder="Add specific instructions or corrections for this retry..."
              rows={4}
              className="resize-none p-2 border-blue-500 border-2"
            />
            <p className="text-xs text-muted-foreground">
              This guidance will be appended to the original field prompts when processing this annotation.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={isRetrying}>
            Cancel
          </Button>
          <Button 
            onClick={handleRetry} 
            disabled={isRetrying || !customGuidance.trim()}
            className="bg-blue-500 text-white hover:bg-blue-700"
          >
            {isRetrying ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Retrying...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Retry with Guidance
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GuidedRetryModal; 