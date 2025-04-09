'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import ClassificationSchemeManager from './ClassificationSchemeManager';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';

interface SchemeManagerOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SchemeManagerOverlay({
  isOpen,
  onClose
}: SchemeManagerOverlayProps) {
  const { activeWorkspace } = useWorkspaceStore();
  const { schemes, loadSchemes } = useClassificationSystem({
    autoLoadSchemes: true
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && activeWorkspace) {
      setIsLoading(true);
      loadSchemes()
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [isOpen, activeWorkspace, loadSchemes]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Classification Schemes</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            title="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p>Loading classification schemes...</p>
            </div>
          ) : (
            <ClassificationSchemeManager />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
} 