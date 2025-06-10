'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from "@/lib/utils";

// --- Temporary Types ---
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'completed_with_errors';

export interface AnnotationRunRead {
  id: number;
  name: string;
  status: RunStatus;
  created_at: string;
  updated_at: string;
}
// --- End Temporary Types ---

interface AnnotationRunListProps {
  runs: AnnotationRunRead[];
  selectedRun: AnnotationRunRead | null;
  onSelectRun: (run: AnnotationRunRead | null) => void;
  isLoading: boolean;
  // Kept for signature compatibility, but not used in this simplified version
  onDeleteRun: (runId: number) => void; 
}

export function AnnotationRunList({ runs, selectedRun, onSelectRun, isLoading }: AnnotationRunListProps) {
  
  const handleSelect = (run: AnnotationRunRead) => {
    onSelectRun(run);
  };
  
  return (
    <Card>
      <CardHeader className="pt-4 pb-2">
        <CardTitle className="text-base">Available Runs</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading runs...</p>}
        {!isLoading && runs.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No runs found.</p>
        )}
        <div className="space-y-2">
            {runs.map(run => (
                <div 
                    key={run.id} 
                    onClick={() => handleSelect(run)}
                    className={cn(
                        "p-2 border rounded-md cursor-pointer hover:bg-muted/50", 
                        selectedRun?.id === run.id && "bg-muted border-primary ring-1 ring-primary"
                    )}
                >
                    <div className="font-semibold text-sm truncate">{run.name}</div>
                    <div className="flex items-center justify-between mt-1">
                        <div className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleDateString()}</div>
                        <Badge variant={run.status === 'completed' ? 'default' : 'secondary'} className="text-xs">{run.status}</Badge>
                    </div>
                </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
} 