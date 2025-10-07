import React, { createContext, useContext, useState, useCallback } from 'react';
import { correctTextSpans, DEFAULT_CORRECTION_OPTIONS, type CorrectedTextSpan, type SpanCorrectionOptions } from '@/lib/annotations/textSpanCorrection';
import { useAssetStore } from '@/zustand_stores/storeAssets';

interface TextSpan {
  start_char_offset: number;
  end_char_offset: number;
  text_snippet: string;
  asset_uuid?: string;
  // Additional fields for tooltip information
  fieldName?: string;
  schemaName?: string;
  justificationReasoning?: string;
}

interface TextSpanHighlight {
  assetId: number;
  assetUuid?: string;
  spans: TextSpan[];
  fieldName?: string;
  justificationSource?: string;
}

interface ColoredTextSpan extends TextSpan {
  highlightClassName?: string;
}

interface TextSpanHighlightContextType {
  activeHighlights: TextSpanHighlight[];
  addHighlight: (highlight: TextSpanHighlight) => void;
  removeHighlight: (assetId: number, fieldName?: string) => void;
  clearAllHighlights: () => void;
  getHighlightsForAsset: (assetId: number, assetUuid?: string) => TextSpan[];
  hasHighlights: (assetId: number, assetUuid?: string) => boolean;
  getColoredHighlightsForAsset: (assetId: number, assetUuid?: string, showAllFields?: boolean) => ColoredTextSpan[];
}

const TextSpanHighlightContext = createContext<TextSpanHighlightContextType | undefined>(undefined);

export const useTextSpanHighlight = () => {
  const context = useContext(TextSpanHighlightContext);
  if (!context) {
    throw new Error('useTextSpanHighlight must be used within a TextSpanHighlightProvider');
  }
  return context;
};

interface TextSpanHighlightProviderProps {
  children: React.ReactNode;
}

export const TextSpanHighlightProvider: React.FC<TextSpanHighlightProviderProps> = ({ children }) => {
  const [activeHighlights, setActiveHighlights] = useState<TextSpanHighlight[]>([]);
  const { getAssetById } = useAssetStore();

  const addHighlight = useCallback((highlight: TextSpanHighlight) => {
    setActiveHighlights(prev => {
      // Check if we already have this exact highlight
      const existingHighlight = prev.find(h => 
        h.assetId === highlight.assetId && 
        h.fieldName === highlight.fieldName &&
        JSON.stringify(h.spans) === JSON.stringify(highlight.spans)
      );
      
      if (existingHighlight) {
        // Don't add duplicate highlights
        return prev;
      }
      
      console.log('[TextSpanHighlightContext] Adding new highlight:', highlight);
      
      // Remove any existing highlights for the same asset and field
      const filtered = prev.filter(h => 
        !(h.assetId === highlight.assetId && h.fieldName === highlight.fieldName)
      );
      const newHighlights = [...filtered, highlight];
      console.log('[TextSpanHighlightContext] Updated highlights count:', newHighlights.length);
      return newHighlights;
    });
  }, []);

  const removeHighlight = useCallback((assetId: number, fieldName?: string) => {
    setActiveHighlights(prev => 
      prev.filter(h => 
        !(h.assetId === assetId && (fieldName === undefined || h.fieldName === fieldName))
      )
    );
  }, []);

  const clearAllHighlights = useCallback(() => {
    setActiveHighlights([]);
  }, []);

  const getHighlightsForAsset = useCallback((assetId: number, assetUuid?: string) => {
    const relevantHighlights = activeHighlights.filter(h => {
      // Match by asset ID first
      if (h.assetId === assetId) return true;
      
      // If we have UUIDs, also match by UUID
      if (assetUuid && h.assetUuid === assetUuid) return true;
      
      // Check if any of the text spans reference this asset UUID
      if (assetUuid && h.spans.some(span => span.asset_uuid === assetUuid)) return true;
      
      return false;
    });

    // Flatten all spans and filter by asset UUID if provided
    const allSpans = relevantHighlights.flatMap(h => h.spans);
    
    if (assetUuid) {
      // Filter spans that either have no asset_uuid (assumed to be for the main asset)
      // or have a matching asset_uuid
      return allSpans.filter(span => !span.asset_uuid || span.asset_uuid === assetUuid);
    }
    
    return allSpans;
  }, [activeHighlights]);

  const hasHighlights = useCallback((assetId: number, assetUuid?: string) => {
    return getHighlightsForAsset(assetId, assetUuid).length > 0;
  }, [getHighlightsForAsset]);

  // Helper function to get field colors
  const getFieldColors = (): Record<string, string> => {
    const colors = [
      'bg-blue-200 dark:bg-blue-800/70', 'bg-green-200 dark:bg-green-800/70', 'bg-purple-200 dark:bg-purple-800/70', 'bg-orange-200 dark:bg-orange-800/70',
      'bg-red-200 dark:bg-red-800/70', 'bg-teal-200 dark:bg-teal-800/70', 'bg-pink-200 dark:bg-pink-800/70', 'bg-indigo-200 dark:bg-indigo-800/70'
    ];
    
    const fieldColors: Record<string, string> = {};
    const uniqueFields = Array.from(new Set(
      activeHighlights.flatMap(h => h.spans.map(s => s.fieldName || '')).filter(Boolean)
    ));
    
    uniqueFields.forEach((fieldName, index) => {
      fieldColors[fieldName] = colors[index % colors.length];
    });
    
    return fieldColors;
  };

  // NEW: Get highlights grouped by field with colors for showing all at once
  const getColoredHighlightsForAsset = useCallback((assetId: number, assetUuid?: string, showAllFields: boolean = false) => {
    const relevantHighlights = activeHighlights.filter(h => {
      // Match by asset ID first
      if (h.assetId === assetId) return true;
      
      // If we have UUIDs, also match by UUID
      if (assetUuid && h.assetUuid === assetUuid) return true;
      
      // Check if any of the text spans reference this asset UUID
      if (assetUuid && h.spans.some(span => span.asset_uuid === assetUuid)) return true;
      
      return false;
    });

    const fieldColors = getFieldColors();
    
    if (showAllFields) {
      // Return all spans with their field colors
      const allSpans = relevantHighlights.flatMap(h => h.spans);
      
      return allSpans
        .filter(span => !assetUuid || !span.asset_uuid || span.asset_uuid === assetUuid)
        .map(span => ({
          ...span,
          highlightClassName: span.fieldName ? fieldColors[span.fieldName] || 'bg-yellow-200 dark:bg-yellow-800/70' : 'bg-yellow-200 dark:bg-yellow-800/70'
        }));
    } else {
      // Return spans for active field only (existing behavior)
      const allSpans = relevantHighlights.flatMap(h => h.spans);
      
      if (assetUuid) {
        return allSpans.filter(span => !span.asset_uuid || span.asset_uuid === assetUuid);
      }
      
      return allSpans;
    }
  }, [activeHighlights]);

  const value: TextSpanHighlightContextType = {
    activeHighlights,
    addHighlight,
    removeHighlight,
    clearAllHighlights,
    getHighlightsForAsset,
    hasHighlights,
    getColoredHighlightsForAsset
  };

  return (
    <TextSpanHighlightContext.Provider value={value}>
      {children}
    </TextSpanHighlightContext.Provider>
  );
};

/**
 * Hook to extract and manage text spans from annotation results
 */
export const useAnnotationTextSpans = () => {
  const { addHighlight, removeHighlight } = useTextSpanHighlight();
  const { getAssetById } = useAssetStore();

  const extractTextSpansFromJustification = useCallback(async (
    justificationValue: any,
    assetId: number,
    assetUuid?: string,
    fieldName?: string,
    schemaName?: string,
    options: SpanCorrectionOptions = DEFAULT_CORRECTION_OPTIONS
  ) => {
    if (!justificationValue || typeof justificationValue !== 'object') return;

    const textSpans = justificationValue.text_spans;
    if (!textSpans || !Array.isArray(textSpans) || textSpans.length === 0) return;

    try {
      // Fetch asset to get text content for correction
      const asset = await getAssetById(assetId);
      const assetText = asset?.text_content;

      let processedSpans: CorrectedTextSpan[];

      if (assetText && assetText.trim().length > 0) {
        // Use intelligent text search correction
        console.log(`[TextSpanCorrection] Processing ${textSpans.length} spans for asset ${assetId} (${assetText.length} chars)`);
        processedSpans = correctTextSpans(assetText, textSpans, options);
        
        const correctedCount = processedSpans.filter(s => s.was_corrected).length;
        console.log(`[TextSpanCorrection] Corrected ${correctedCount}/${processedSpans.length} spans using text search`);
      } else {
        // No text content available, use spans as-is but still enhance them
        console.warn(`[TextSpanCorrection] No text content available for asset ${assetId}, using spans without correction`);
        processedSpans = textSpans.map(span => ({
          ...span,
          was_corrected: false
        }));
      }

      // Enhance spans with tooltip information
      const enhancedSpans = processedSpans.map(span => ({
        ...span,
        fieldName,
        schemaName,
        justificationReasoning: justificationValue.reasoning
      }));

      const highlight: TextSpanHighlight = {
        assetId,
        assetUuid,
        spans: enhancedSpans,
        fieldName,
        justificationSource: 'annotation'
      };

      addHighlight(highlight);
    } catch (error) {
      console.error(`[TextSpanCorrection] Failed to process spans for asset ${assetId}:`, error);
      
      // Fallback: use original spans without correction
      const enhancedSpans = textSpans.map(span => ({
        ...span,
        fieldName,
        schemaName,
        justificationReasoning: justificationValue.reasoning,
        was_corrected: false
      }));

      const highlight: TextSpanHighlight = {
        assetId,
        assetUuid,
        spans: enhancedSpans,
        fieldName,
        justificationSource: 'annotation'
      };

      addHighlight(highlight);
    }
  }, [addHighlight, getAssetById]);

  const extractTextSpansFromAnnotationResult = useCallback(async (
    annotationResult: any,
    assetId: number,
    assetUuid?: string
  ) => {
    if (!annotationResult?.value || typeof annotationResult.value !== 'object') return;

    // Look for justification fields
    const justificationPromises = Object.entries(annotationResult.value)
      .filter(([key, value]) => key.endsWith('_justification') && value && typeof value === 'object')
      .map(([key, value]) => {
        const fieldName = key.replace('_justification', '');
        return extractTextSpansFromJustification(value, assetId, assetUuid, fieldName);
      });

    // Wait for all justification processing to complete
    await Promise.allSettled(justificationPromises);
  }, [extractTextSpansFromJustification]);

  return {
    extractTextSpansFromJustification,
    extractTextSpansFromAnnotationResult,
    removeHighlight
  };
};

export default TextSpanHighlightContext; 