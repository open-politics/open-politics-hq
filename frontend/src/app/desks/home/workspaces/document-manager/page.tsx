'use client';

import DocumentManager from '@/components/collection/workspaces/documents/DocumentManager';
import DatasetManagerWrapper from '@/components/collection/workspaces/datasets/DatasetManager';
export default function DocumentManagerPage() {
  return (
    <div className="flex flex-col w-full flex-1 p-1 w-full max-w-[90vw] mx-auto">
      {/* <DatasetManagerWrapper /> */}
      <DocumentManager />
    </div>
  );
}