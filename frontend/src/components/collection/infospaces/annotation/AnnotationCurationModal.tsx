'use client';

import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from 'lucide-react';

interface AnnotationCurationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  fragmentCount: number;
  assetCount: number;
}

const AnnotationCurationModal: React.FC<AnnotationCurationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  fragmentCount,
  assetCount,
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Curation</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to curate <strong>{fragmentCount}</strong> fragment(s)
            for <strong>{assetCount}</strong> asset(s). This action may overwrite
            existing fragments with the same keys.
            <br />
            <br />
            Are you sure you want to proceed?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={isLoading}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Curating...
              </>
            ) : (
              'Confirm & Curate'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default AnnotationCurationModal;
