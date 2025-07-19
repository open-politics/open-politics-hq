import React, { createContext, useContext, useState, useCallback } from 'react';

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

interface TextSpanHighlightContextType {
  activeHighlights: TextSpanHighlight[];
  addHighlight: (highlight: TextSpanHighlight) => void;
  removeHighlight: (assetId: number, fieldName?: string) => void;
  clearAllHighlights: () => void;
  getHighlightsForAsset: (assetId: number, assetUuid?: string) => TextSpan[];
  hasHighlights: (assetId: number, assetUuid?: string) => boolean;
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

  const value: TextSpanHighlightContextType = {
    activeHighlights,
    addHighlight,
    removeHighlight,
    clearAllHighlights,
    getHighlightsForAsset,
    hasHighlights
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

  const extractTextSpansFromJustification = useCallback((
    justificationValue: any,
    assetId: number,
    assetUuid?: string,
    fieldName?: string,
    schemaName?: string
  ) => {
    if (!justificationValue || typeof justificationValue !== 'object') return;

    const textSpans = justificationValue.text_spans;
    if (!textSpans || !Array.isArray(textSpans) || textSpans.length === 0) return;

    // Enhance text spans with tooltip information
    const enhancedSpans = textSpans.map(span => ({
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
  }, [addHighlight]);

  const extractTextSpansFromAnnotationResult = useCallback((
    annotationResult: any,
    assetId: number,
    assetUuid?: string
  ) => {
    if (!annotationResult?.value || typeof annotationResult.value !== 'object') return;

    // Look for justification fields
    Object.entries(annotationResult.value).forEach(([key, value]) => {
      if (key.endsWith('_justification') && value && typeof value === 'object') {
        const fieldName = key.replace('_justification', '');
        extractTextSpansFromJustification(value, assetId, assetUuid, fieldName);
      }
    });
  }, [extractTextSpansFromJustification]);

  return {
    extractTextSpansFromJustification,
    extractTextSpansFromAnnotationResult,
    removeHighlight
  };
};

export default TextSpanHighlightContext; 