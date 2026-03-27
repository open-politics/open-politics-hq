'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { AnnotationsService } from '@/client';

interface CurationControlsProps {
  annotationId: number;
  infospaceId: number;
  fragmentPaths: string[];
  onCurationComplete?: () => void;
}

export function CurationControls({
  annotationId,
  infospaceId,
  fragmentPaths,
  onCurationComplete,
}: CurationControlsProps) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [isCurating, setIsCurating] = useState(false);

  const togglePath = (path: string) => {
    const newSelected = new Set(selectedPaths);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      newSelected.add(path);
    }
    setSelectedPaths(newSelected);
  };

  const curateSelected = async () => {
    if (selectedPaths.size === 0) {
      toast.error('Please select at least one triplet to curate');
      return;
    }

    setIsCurating(true);
    try {
      await AnnotationsService.curateFragments({
        infospaceId,
        annotationId,
        requestBody: {
          fragment_paths: Array.from(selectedPaths),
          status: 'curated',
        },
      });

      toast.success(`Successfully curated ${selectedPaths.size} triplet(s)`);
      setSelectedPaths(new Set());
      onCurationComplete?.();
    } catch (error: any) {
      toast.error(error.message || 'Failed to curate triplets');
    } finally {
      setIsCurating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Select triplets to curate:</span>
        <Button
          size="sm"
          onClick={curateSelected}
          disabled={selectedPaths.size === 0 || isCurating}
        >
          {isCurating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Curating...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Curate Selected ({selectedPaths.size})
            </>
          )}
        </Button>
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {fragmentPaths.map((path) => (
          <div key={path} className="flex items-center space-x-2">
            <Checkbox
              checked={selectedPaths.has(path)}
              onCheckedChange={() => togglePath(path)}
            />
            <label className="text-sm cursor-pointer" onClick={() => togglePath(path)}>
              {path}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
