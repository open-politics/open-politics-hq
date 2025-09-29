'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AssetRead, AssetUpdate } from '@/client';
import { toast } from 'sonner';
import { Loader2, Save, X, Calendar, FileText } from 'lucide-react';

interface EditAssetOverlayProps {
  open: boolean;
  onClose: () => void;
  asset: AssetRead;
  onSave: (assetId: number, updateData: AssetUpdate) => Promise<void>;
}

export default function EditAssetOverlay({ 
  open, 
  onClose, 
  asset,
  onSave,
}: EditAssetOverlayProps) {
  const [title, setTitle] = useState(asset.title);
  const [textContent, setTextContent] = useState(asset.text_content || '');
  const [eventTimestamp, setEventTimestamp] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setTitle(asset.title);
    setTextContent(asset.text_content || '');
    if (asset.event_timestamp) {
      try {
        // Format to 'YYYY-MM-DDTHH:mm' which is required by datetime-local input
        const d = new Date(asset.event_timestamp);
        const formatted = d.toISOString().substring(0, 16);
        setEventTimestamp(formatted);
      } catch (e) {
        setEventTimestamp('');
      }
    } else {
      setEventTimestamp('');
    }
  }, [asset]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const updateData: AssetUpdate = {
      title,
      text_content: textContent || undefined,
      event_timestamp: eventTimestamp ? new Date(eventTimestamp).toISOString() : undefined,
    };

    try {
      await onSave(asset.id, updateData);
      toast.success(`Asset "${title}" updated successfully.`);
      onClose();
    } catch (error) {
      console.error('Error updating asset:', error);
      toast.error('Failed to update asset.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Asset Details: {asset.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="asset-title">Title</Label>
            <Input id="asset-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={isSaving}/>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="asset-kind">Kind</Label>
            <Input id="asset-kind" value={asset.kind} readOnly disabled className="bg-muted/50 capitalize" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-event-timestamp" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Event Timestamp
            </Label>
            <Input 
              id="asset-event-timestamp"
              type="datetime-local"
              value={eventTimestamp}
              onChange={(e) => setEventTimestamp(e.target.value)}
              disabled={isSaving}
            />
          </div>

          {(asset.kind === 'text' || asset.text_content) && (
            <div className="space-y-2">
                <Label htmlFor="asset-text-content" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Text Content
                </Label>
                <Textarea 
                  id="asset-text-content"
                  value={textContent} 
                  onChange={(e) => setTextContent(e.target.value)} 
                  rows={8}
                  disabled={isSaving} 
                  placeholder="Enter text content..."
                />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}