import React from 'react';
import { AssetRead } from '@/client';
import { AuthenticatedPDF } from '../Viewers/AuthenticatedPDF';
import { Badge } from '@/components/ui/badge';
import { Layers } from 'lucide-react';

interface PdfAssetContentProps {
  asset: AssetRead;
  renderEditableField: (asset: AssetRead, field: 'title' | 'event_timestamp') => React.ReactNode;
  hasChildren: boolean;
  childAssets: AssetRead[];
  setActiveTab: (tab: 'content' | 'children') => void;
  handleChildAssetClick: (asset: AssetRead) => void;
}

export const PdfAssetContent = React.memo<PdfAssetContentProps>(
  ({ asset, renderEditableField, hasChildren, childAssets, setActiveTab, handleChildAssetClick }) => {
    return (
      <div className="p-4 h-full flex flex-col">
        <div className="mb-4">
          {renderEditableField(asset, 'title')}
        </div>
        <div className="flex-1 bg-muted/20 rounded overflow-hidden">
          {asset.blob_path && (
            <AuthenticatedPDF
              key={asset.blob_path} // Stable key prevents remounts
              blobPath={asset.blob_path}
              title={asset.title || 'PDF Document'}
              className="w-full h-full border-0"
            />
          )}
        </div>
        {hasChildren && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-xs">
                <Layers className="h-3 w-3 mr-1" />
                {childAssets.length} PDF Pages
              </Badge>
              <span className="text-xs text-muted-foreground">
                Click a page preview or use the "PDF Pages" tab to view details
              </span>
            </div>
          </div>
        )}
      </div>
    );
  },
  // Only re-render if asset.blob_path or asset.id changes
  (prevProps, nextProps) => 
    prevProps.asset.blob_path === nextProps.asset.blob_path &&
    prevProps.asset.id === nextProps.asset.id &&
    prevProps.hasChildren === nextProps.hasChildren &&
    prevProps.childAssets.length === nextProps.childAssets.length
);

PdfAssetContent.displayName = 'PdfAssetContent';
