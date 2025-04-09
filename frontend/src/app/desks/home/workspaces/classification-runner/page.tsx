'use client';

import ClassificationRunner from '@/components/collection/workspaces/classifications/ClassificationRunner';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';

export default function ClassificationRunnerPage() {
  const { activeWorkspace } = useWorkspaceStore();
  
  return (
    <div className="relative flex flex-col items-center mx-auto top-4 min-h-screen overflow-visible bg-primary-950">
      <div className="flex flex-col items-center w-full max-w-8xl p-4 overflow-y-auto">
        <div className="w-full mb-8 space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="col-span-1">
              <ClassificationRunner />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}