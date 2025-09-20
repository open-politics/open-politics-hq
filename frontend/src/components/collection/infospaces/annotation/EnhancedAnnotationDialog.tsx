'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, ExternalLink, FileText } from 'lucide-react';
import { cn } from "@/lib/utils";
import { FormattedAnnotation } from '@/lib/annotations/types';
import { AnnotationSchemaRead, AssetRead } from '@/client/models';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import AnnotationResultDisplay from './AnnotationResultDisplay';
import { TextSpanHighlightProvider } from '@/contexts/TextSpanHighlightContext';
import AssetLink from '../assets/Helper/AssetLink';
import AssetDetailProvider from '../assets/Views/AssetDetailProvider';

interface EnhancedAnnotationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  result: FormattedAnnotation | null;
  schema: AnnotationSchemaRead | null;
  selectedFieldKeys?: string[] | null;
}

const EnhancedAnnotationDialog: React.FC<EnhancedAnnotationDialogProps> = ({
  isOpen,
  onClose,
  result,
  schema,
  selectedFieldKeys = null
}) => {
  const [asset, setAsset] = useState<AssetRead | null>(null);
  const [isLoadingAsset, setIsLoadingAsset] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);
  const { getAssetById } = useAssetStore();

  // NEW: Auto-select first field with justification when dialog opens
  useEffect(() => {
    if (!result?.value || !schema || !isOpen) {
      setActiveField(null);
      return;
    }

    // Check if a specific field was selected (from help icon click)
    const resultWithContext = result as FormattedAnnotation & { _selectedField?: string };
    if (resultWithContext._selectedField) {
      console.log('Auto-selecting specified field:', resultWithContext._selectedField);
      setActiveField(resultWithContext._selectedField);
      return;
    }

    // Otherwise, find the first field that has justification data
    const resultValue = result.value as any;
    const justificationKeys = Object.keys(resultValue).filter(key => key.endsWith('_justification'));
    
    if (justificationKeys.length > 0) {
      // Get the field name by removing the _justification suffix
      const firstFieldWithJustification = justificationKeys[0].replace('_justification', '');
      
      // Check if this field has actual justification content
      const justificationObj = resultValue[justificationKeys[0]];
      if (justificationObj && 
          (justificationObj.reasoning || 
           (justificationObj.text_spans && justificationObj.text_spans.length > 0))) {
        console.log('Auto-selecting first field with justification:', firstFieldWithJustification);
        setActiveField(firstFieldWithJustification);
      }
    }
  }, [result, schema, isOpen]);

  // Load asset when result changes
  useEffect(() => {
    if (!result?.asset_id) {
      setAsset(null);
      return;
    }

    const loadAsset = async () => {
      setIsLoadingAsset(true);
      try {
        const assetData = await getAssetById(result.asset_id);
        setAsset(assetData);
      } catch (error) {
        console.error('Failed to load asset:', error);
        setAsset(null);
      } finally {
        setIsLoadingAsset(false);
      }
    };

    loadAsset();
  }, [result?.asset_id, getAssetById]);

  const handleFieldInteraction = (fieldKey: string, justification: any) => {
    setActiveField(fieldKey);
    
    // Force highlighting update if justification has text spans
    if (justification && typeof justification === 'object' && justification['text_spans']?.length > 0) {
      console.log('Field interaction with text spans:', fieldKey, justification['text_spans']);
    }
    
    // Could add additional logic here for cross-panel highlighting
  };

  if (!result || !schema) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-full h-[90vh] flex flex-col p-0">
        <AssetDetailProvider>
          <DialogHeader className="flex-none p-6 pb-4 border-b">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-semibold mb-2">
                  Annotation Results
                </DialogTitle>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{schema.name}</Badge>
                    <span className="text-sm text-muted-foreground">
                      Asset #{result.asset_id}
                    </span>
                  </div>
                  {asset && (
                    <div className="flex items-center gap-2">
                      <AssetLink 
                        assetId={asset.id}
                        className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground h-7 rounded-md px-2"
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        View Asset
                      </AssetLink>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {asset.kind}
                      </Badge>
                    </div>
                  )}
                </div>
                {asset?.title && (
                  <p className="text-sm text-muted-foreground mt-1 truncate">
                    {asset.title}
                  </p>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden">
            <TextSpanHighlightProvider>
              <AnnotationResultDisplay
                result={result}
                schema={schema}
                renderContext="enhanced"
                compact={false}
                selectedFieldKeys={selectedFieldKeys}
                asset={asset}
                showAssetContent={!!asset}
                onFieldInteraction={handleFieldInteraction}
                activeField={activeField}
              />
            </TextSpanHighlightProvider>
          </div>
        </AssetDetailProvider>
      </DialogContent>
    </Dialog>
  );
};

export default EnhancedAnnotationDialog; 