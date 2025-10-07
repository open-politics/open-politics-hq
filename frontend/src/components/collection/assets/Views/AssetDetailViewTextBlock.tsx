// frontend/src/components/collection/infospaces/documents/AssetDetailViewTextBlock.tsx
import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Type } from 'lucide-react';
import { AssetRead } from '@/client';

// Define placeholder type for asset records
interface AssetRecord {
  id: number;
  title: string;
  text_content: string | null;
  source_metadata?: Record<string, any>;
  event_timestamp?: string;
}

interface AssetDetailViewTextBlockProps {
  asset: AssetRead;
  associatedRecords: AssetRecord[]; // Should contain the single record for the text block
  isLoadingRecords: boolean; // To show loading if needed
  renderEditableField: (record: AssetRecord | null, field: 'title' | 'event_timestamp') => React.ReactNode;
  renderTextDisplay: (text: string | null) => React.ReactNode;
}

const AssetDetailViewTextBlock: React.FC<AssetDetailViewTextBlockProps> = ({
  asset,
  associatedRecords,
  isLoadingRecords,
  renderEditableField,
  renderTextDisplay,
}) => {
  const charCount = asset.source_metadata?.character_count as number | undefined;
  // Use associatedRecords which should be populated for text blocks by the parent
  const textRecord = associatedRecords.length > 0 ? associatedRecords[0] : null;

  return (
    <div className="p-4 bg-muted/30 h-full flex flex-col">
        <h3 className="text-lg font-semibold mb-3 flex items-center">
            <Type className="h-5 w-5 mr-2 text-primary" /> Text Block Content
        </h3>
        <div className="space-y-2 mb-4 text-sm flex-grow">
            {renderEditableField(textRecord, 'title')}
            {charCount !== undefined && <p><strong>Character Count:</strong> {charCount}</p>}
            {renderEditableField(textRecord, 'event_timestamp')}
            <Label className="text-xs font-semibold text-muted-foreground">Content:</Label>
             {isLoadingRecords && !textRecord ? (
                 <p className="text-sm text-muted-foreground italic">Loading content...</p>
             ) : (
                 renderTextDisplay(textRecord?.text_content || asset.text_content || null)
             )}
        </div>
        {/* Add actions if needed, e.g., edit? (Handled by renderEditableField) */}
    </div>
  );
};

export default AssetDetailViewTextBlock;
