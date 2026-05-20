'use client';

import React from 'react';

// =============================================================================
// EdgeFieldsOverlay — bottom-right pill listing the numeric fields available
// on edges (so users know what's pickable in the settings popover's edge-width
// dropdown). Hidden in minimal chrome.
// =============================================================================

interface EdgeFieldsOverlayProps {
  fields: string[];
}

export const EdgeFieldsOverlay: React.FC<EdgeFieldsOverlayProps> = ({ fields }) => {
  if (fields.length === 0) return null;
  return (
    <div className="absolute bottom-2 right-2 bg-background/90 p-2 rounded shadow-md text-xs text-muted-foreground z-20">
      Fields: {fields.join(', ')}
    </div>
  );
};
