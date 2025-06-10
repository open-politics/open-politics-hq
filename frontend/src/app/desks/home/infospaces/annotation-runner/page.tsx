"use client";

import { useAnnotationRunStore } from "@/zustand_stores/useAnnotationRunStore";
import { CreateAnnotationRun } from "@/components/collection/infospaces/annotation/CreateAnnotationRun";
import { AnnotationRunList } from "@/components/collection/infospaces/annotation/AnnotationRunList";
import { AnnotationRunDetails } from "@/components/collection/infospaces/annotation/AnnotationRunDetails";
import { useEffect, useState } from "react";
import { AnnotationRunRead, AnnotationRunCreate } from "@/client/models";
import { toast } from "sonner";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";

export default function AnnotationRunnerPage() {
  const {
    runs,
    isLoading,
    error,
    actions: { fetchAnnotationRuns, addAnnotationRun, deleteAnnotationRun },
  } = useAnnotationRunStore();
  
  const { activeInfospace } = useInfospaceStore();
  const [activeRun, setActiveRun] = useState<AnnotationRunRead | null>(null);

  useEffect(() => {
    if (activeInfospace?.id) {
      fetchAnnotationRuns(activeInfospace.id);
    }
  }, [activeInfospace, fetchAnnotationRuns]);

  const handleCreateRun = async (runData: Omit<AnnotationRunCreate, 'schema_ids' | 'target_asset_ids' | 'target_bundle_id'>) => {
    if (!activeInfospace?.id) {
        toast.error("Cannot create run without an active infospace context.");
        return;
    }
    // This is a placeholder for a more complex run creation logic
    const placeholderRunData: AnnotationRunCreate = {
        ...runData,
        schema_ids: [],
        target_asset_ids: [],
    }
    const newRun = await addAnnotationRun(activeInfospace.id, placeholderRunData);
    if (newRun) {
      setActiveRun(newRun);
    }
  };

  const handleSelectRun = (run: AnnotationRunRead | null) => {
    setActiveRun(run);
  };

  const handleDeleteRun = (runId: number) => {
    if (activeInfospace?.id) {
        deleteAnnotationRun(activeInfospace.id, runId);
        if(activeRun?.id === runId) {
            setActiveRun(null);
        }
    }
  };

  const runsArray: AnnotationRunRead[] = Object.values(runs);

  return (
    <div className="flex h-full">
      <div className="w-1/3 border-r p-4 overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">Annotation Runs</h2>
        <CreateAnnotationRun
          isCreating={isLoading}
          onCreate={handleCreateRun}
        />
        <AnnotationRunList
          runs={runsArray}
          selectedRun={activeRun}
          onSelectRun={handleSelectRun}
          onDeleteRun={handleDeleteRun}
          isLoading={isLoading}
        />
      </div>
      <div className="w-2/3 p-4 overflow-y-auto">
        {activeRun ? (
          <AnnotationRunDetails
            run={{...activeRun, configuration: activeRun.configuration || {}}}
            isPolling={false} // Polling logic needs to be re-implemented if required
            onRetry={() => {console.log("Retry not implemented yet")}}
            isRetrying={false}
          />
        ) : (
          <div className="text-center text-gray-500 mt-8">
            Select a run to view its details
          </div>
        )}
        {error && <p className="text-red-500 mt-4">{error}</p>}
      </div>
    </div>
  );
} 