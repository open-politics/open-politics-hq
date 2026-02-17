import React, { createContext, useContext, useState, useCallback } from 'react';

export interface SimpleSpan {
  start_char_offset: number;
  end_char_offset: number;
  text_snippet: string;
  asset_uuid?: string;
  fieldName?: string;
  schemaName?: string;
  justificationReasoning?: string;
  highlightClassName?: string;
}

type HighlightMode =
  | { mode: 'none' }
  | { mode: 'field'; assetId: number; assetUuid?: string; spans: SimpleSpan[] }
  | { mode: 'span'; assetId: number; assetUuid?: string; span: SimpleSpan; fieldSpans: SimpleSpan[] };

interface TextSpanHighlightContextType {
  highlightState: HighlightMode;
  showFieldSpans: (assetId: number, spans: SimpleSpan[], assetUuid?: string) => void;
  showSingleSpan: (assetId: number, span: SimpleSpan, assetUuid?: string, fieldSpans?: SimpleSpan[]) => void;
  revertToFieldSpans: () => void;
  clearHighlights: () => void;
  getSpansForAsset: (assetId: number, assetUuid?: string) => SimpleSpan[];
  /** Returns full field spans (all evidence pieces) when in field or span mode - for switching between spans */
  getFieldSpansForAsset: (assetId: number, assetUuid?: string) => SimpleSpan[];
}

const TextSpanHighlightContext = createContext<TextSpanHighlightContextType | undefined>(undefined);

export const useTextSpanHighlight = () => {
  const context = useContext(TextSpanHighlightContext);
  if (!context) {
    throw new Error('useTextSpanHighlight must be used within a TextSpanHighlightProvider');
  }
  return context;
};

export const useTextSpanHighlightSafe = () => {
  return useContext(TextSpanHighlightContext) ?? null;
};

interface TextSpanHighlightProviderProps {
  children: React.ReactNode;
}

function matchesAsset(state: Exclude<HighlightMode, { mode: 'none' }>, assetId: number, assetUuid?: string): boolean {
  if (state.assetId === assetId) return true;
  if (assetUuid && state.assetUuid === assetUuid) return true;
  return false;
}

export const TextSpanHighlightProvider: React.FC<TextSpanHighlightProviderProps> = ({ children }) => {
  const [highlightState, setHighlightState] = useState<HighlightMode>({ mode: 'none' });

  const showFieldSpans = useCallback((assetId: number, spans: SimpleSpan[], assetUuid?: string) => {
    if (!spans.length) {
      setHighlightState({ mode: 'none' });
      return;
    }
    setHighlightState({ mode: 'field', assetId, assetUuid, spans });
  }, []);

  const showSingleSpan = useCallback((assetId: number, span: SimpleSpan, assetUuid?: string, fieldSpans?: SimpleSpan[]) => {
    setHighlightState({ mode: 'span', assetId, assetUuid, span, fieldSpans: fieldSpans ?? [span] });
  }, []);

  const clearHighlights = useCallback(() => {
    setHighlightState({ mode: 'none' });
  }, []);

  const revertToFieldSpans = useCallback(() => {
    const state = highlightState;
    if (state.mode === 'span' && state.fieldSpans.length > 0) {
      setHighlightState({ mode: 'field', assetId: state.assetId, assetUuid: state.assetUuid, spans: state.fieldSpans });
    }
  }, [highlightState]);

  const getSpansForAsset = useCallback((assetId: number, assetUuid?: string): SimpleSpan[] => {
    const state = highlightState;
    if (state.mode === 'none') return [];
    if (!matchesAsset(state, assetId, assetUuid)) return [];
    if (state.mode === 'span') return [state.span];
    return state.spans;
  }, [highlightState]);

  const getFieldSpansForAsset = useCallback((assetId: number, assetUuid?: string): SimpleSpan[] => {
    const state = highlightState;
    if (state.mode === 'none') return [];
    if (!matchesAsset(state, assetId, assetUuid)) return [];
    if (state.mode === 'span') return state.fieldSpans;
    return state.spans;
  }, [highlightState]);

  const value: TextSpanHighlightContextType = {
    highlightState,
    showFieldSpans,
    showSingleSpan,
    revertToFieldSpans,
    clearHighlights,
    getSpansForAsset,
    getFieldSpansForAsset,
  };

  return (
    <TextSpanHighlightContext.Provider value={value}>
      {children}
    </TextSpanHighlightContext.Provider>
  );
};

export default TextSpanHighlightContext;
