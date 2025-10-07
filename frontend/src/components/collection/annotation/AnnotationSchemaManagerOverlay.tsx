'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import AnnotationSchemaManager from './AnnotationSchemaManager';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';

interface SchemaManagerOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AnnotationSchemaManagerOverlay({
  isOpen,
  onClose
}: SchemaManagerOverlayProps) {
  const { activeInfospace } = useInfospaceStore();
  const { schemas, isLoadingSchemas, loadSchemas } = useAnnotationSystem();
  
  useEffect(() => {
    if (isOpen && activeInfospace) {
      loadSchemas();
    }
  }, [isOpen, activeInfospace, loadSchemas]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Annotation Schemas</DialogTitle>
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
          {isLoadingSchemas ? (
            <div className="flex items-center justify-center h-full">
              <p>Loading annotation schemas...</p>
            </div>
          ) : (
            <AnnotationSchemaManager />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
} 