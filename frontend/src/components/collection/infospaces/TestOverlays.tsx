'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import DocumentManagerOverlay from './assets/Helper/AssetManagerOverlay';
import SchemeManagerOverlay from './classifications/ClassificationSchemeManagerOverlay';
import { toast } from 'sonner';

export default function TestOverlays() {
  const [isDocumentManagerOpen, setIsDocumentManagerOpen] = useState(false);
  const [isSchemeManagerOpen, setIsSchemeManagerOpen] = useState(false);

  const handleLoadIntoRunner = (runId: number, runName: string) => {
    toast.success(`Loading Run: ${runName} (ID: ${runId})`, {
      description: "The run has been loaded into the Classification Runner",
      duration: 5000,
    });
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-xl font-bold mb-2">Test New Overlays</h2>
        <p className="text-muted-foreground mb-4">
          Click the buttons below to test the new overlay components.
        </p>
      </div>

      <div className="flex gap-4">
        <Button onClick={() => setIsDocumentManagerOpen(true)}>
          Open Document Manager
        </Button>
        <Button onClick={() => setIsSchemeManagerOpen(true)}>
          Open Scheme Manager
        </Button>
      </div>

      <DocumentManagerOverlay
        isOpen={isDocumentManagerOpen}
        onClose={() => setIsDocumentManagerOpen(false)}
        onLoadIntoRunner={handleLoadIntoRunner}
      />

      <SchemeManagerOverlay
        isOpen={isSchemeManagerOpen}
        onClose={() => setIsSchemeManagerOpen(false)}
      />
    </div>
  );
} 