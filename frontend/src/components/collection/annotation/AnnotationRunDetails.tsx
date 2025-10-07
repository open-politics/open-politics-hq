'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

// Temporary type definition until client is regenerated
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'completed_with_errors';

export interface AnnotationRunRead {
  id: number;
  name: string;
  status: RunStatus;
  created_at: string;
  updated_at: string;
  error_message?: string | null;
  // Add other fields from the backend schema as needed
  configuration: Record<string, any>;
}
// End temporary type definition

interface AnnotationRunDetailsProps {
  run: AnnotationRunRead;
  isPolling: boolean;
  onRetry: (runId: number) => void;
  isRetrying: boolean;
}

export function AnnotationRunDetails({ run, isPolling, onRetry, isRetrying }: AnnotationRunDetailsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Run Details: {run.name}</CardTitle>
        <CardDescription>ID: {run.id}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <strong>Status:</strong> <Badge>{run.status}</Badge>
        </div>
        <div>
          <strong>Created:</strong> {new Date(run.created_at).toLocaleString()}
        </div>
        <div>
          <strong>Last Updated:</strong> {new Date(run.updated_at).toLocaleString()}
        </div>
        {run.status === 'failed' && (
          <Button onClick={() => onRetry(run.id)} disabled={isRetrying}>
            {isRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Retry Failed Items
          </Button>
        )}
        {isPolling && <div className="text-sm text-muted-foreground">Polling for updates...</div>}
      </CardContent>
    </Card>
  );
} 