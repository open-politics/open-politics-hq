'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { AnnotationRunCreate } from '@/client/models';
// import { useAssetStore } from '@/zustand_stores/storeAssets';
// import { useAnnotationSchemaStore } from '@/zustand_stores/storeAnnotationSchemas';

interface CreateAnnotationRunProps {
  isCreating: boolean;
  onCreate: (params: Omit<AnnotationRunCreate, 'schema_ids' | 'target_asset_ids' | 'target_bundle_id'>) => Promise<void>;
}

export function CreateAnnotationRun({ isCreating, onCreate }: CreateAnnotationRunProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [selectedSchemaIds, setSelectedSchemaIds] = useState<number[]>([]);
  
  // TODO: Replace with actual data from stores
  const { assets } = { assets: [{id: 1, title: "Sample Asset 1"}, {id: 2, title: "Sample Asset 2"}] };
  const { schemas } = { schemas: [{id: 1, name: "Sample Schema 1"}, {id: 2, name: "Sample Schema 2"}] };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || selectedAssetIds.length === 0 || selectedSchemaIds.length === 0) {
      console.error("Name, assets, and schemas are required.");
      return;
    }
    const runData = {
      name,
      description,
      target_asset_ids: selectedAssetIds,
      schema_ids: selectedSchemaIds,
    };
    // The parent component will handle the final creation logic
    // For now, let's just pass the core data. The parent's `handleCreateRun` needs to adapt.
    onCreate(runData as any);
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Create New Annotation Run</CardTitle>
        <CardDescription>Configure and start a new annotation run.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="run-name">Run Name</label>
            <Input
              id="run-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., 'Q2 2024 Sentiment Analysis'"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="run-description">Description (Optional)</label>
            <Textarea
              id="run-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of this run's purpose."
            />
          </div>

          {/* TODO: Implement proper multi-select components */}
          <div className="space-y-1">
              <label>Assets</label>
              <div className="text-xs text-muted-foreground p-2 border rounded-md">Placeholder for asset multi-select. Selected: {selectedAssetIds.join(', ')}</div>
          </div>
           <div className="space-y-1">
              <label>Schemas</label>
              <div className="text-xs text-muted-foreground p-2 border rounded-md">Placeholder for schema multi-select. Selected: {selectedSchemaIds.join(', ')}</div>
          </div>

          <Button type="submit" disabled={isCreating} className="w-full">
            {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isCreating ? 'Starting Run...' : 'Start Annotation Run'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
} 