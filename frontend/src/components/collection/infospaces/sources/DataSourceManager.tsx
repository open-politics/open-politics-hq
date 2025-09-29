import React, { useEffect, useState } from 'react';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { Button } from '@/components/ui/button';
import { RadioTower, Repeat, Plus } from 'lucide-react';
import NewSourceConfiguration from '@/components/collection/infospaces/sources/configuration/NewSourceConfiguration';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function DataSourceManager() {
  const { sources, isLoading, error, fetchSources } = useSourceStore();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleSuccess = () => {
    setIsCreateOpen(false);
    fetchSources();
  }

  return (
    <div className="flex flex-col h-full w-full max-w-screen-3xl mx-auto px-1 sm:px-2 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 flex items-center gap-2 rounded-xl bg-blue-50/20 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-800 shadow-sm">
          <RadioTower className="h-6 w-6 text-blue-700 dark:text-pink-400" />
          <Repeat className="h-6 w-6 text-blue-700 dark:text-blue -400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Sources</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              Define your data sources and automate their ingestion
            </p>
          </div>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Source
        </Button>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden p-1 pb-3">
        {isLoading && <p>Loading sources...</p>}
        {error && <p className="text-red-500">{error}</p>}
        {!isLoading && !error && (
          <ul>
            {sources.map(source => (
              <li key={source.id}>{source.name} - {source.kind}</li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Create New Source</DialogTitle>
              </DialogHeader>
              <NewSourceConfiguration onSuccess={handleSuccess} />
          </DialogContent>
      </Dialog>
    </div>
  );
}
