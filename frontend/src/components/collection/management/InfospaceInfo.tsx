'use client';

import { IconRenderer } from "@/components/collection/utilities/icons/icon-picker"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { InfospaceRead } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

interface InfospaceInfoProps {
  activeInfospace: InfospaceRead | null;
}

const InfospaceInfo: React.FC = () => {
  const { activeInfospace } = useInfospaceStore();
  if (!activeInfospace) {
    return <p>No Infospace information available.</p>;
  }

  return (
    <Card className="bg-primary-900 border-secondary-700">
      <CardHeader>
        <CardTitle className="text-secondary-500 flex items-center">
          {activeInfospace.icon && (
            <IconRenderer icon={activeInfospace.icon} className="mr-2 h-5 w-5" />
          )}
          Infospace Information
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p className="text-secondary-400">
            Name: {activeInfospace.name}
          </p>
          <p className="text-secondary-400">
            Description: {activeInfospace.description || 'N/A'}
          </p>
          
        </div>
      </CardContent>
    </Card>
  );
};

export default InfospaceInfo;