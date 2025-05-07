'use client';

import { IconRenderer } from "@/components/collection/workspaces/utilities/icons/icon-picker"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { WorkspaceRead } from '@/client/models';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';

interface WorkspaceInfoProps {
  activeWorkspace: WorkspaceRead | null;
}

const WorkspaceInfo: React.FC = () => {
  const { activeWorkspace } = useWorkspaceStore();
  if (!activeWorkspace) {
    return <p>No workspace information available.</p>;
  }

  return (
    <Card className="bg-primary-900 border-secondary-700">
      <CardHeader>
        <CardTitle className="text-secondary-500 flex items-center">
          {activeWorkspace.icon && (
            <IconRenderer icon={activeWorkspace.icon} className="mr-2 h-5 w-5" />
          )}
          Workspace Information
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p className="text-secondary-400">
            Name: {activeWorkspace.name}
          </p>
          <p className="text-secondary-400">
            Description: {activeWorkspace.description || 'N/A'}
          </p>
          {activeWorkspace.system_prompt && (
             <div>
                <p className="text-secondary-400 font-medium mt-2">System Prompt:</p>
                <p className="text-secondary-400 text-xs font-mono whitespace-pre-wrap bg-black/20 p-2 rounded">
                   {activeWorkspace.system_prompt}
                </p>
             </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default WorkspaceInfo;