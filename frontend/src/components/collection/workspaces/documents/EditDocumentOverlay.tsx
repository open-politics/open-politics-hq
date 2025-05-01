'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DataSource } from '@/lib/classification/types';
import { DataSourceUpdate } from '@/client/models';
import { toast } from 'sonner';


interface EditDocumentOverlayProps {
  open: boolean;
  onClose: () => void;
  dataSource: DataSource;
  onSave: (updateData: DataSourceUpdate) => Promise<void>;
}

export default function EditDocumentOverlay({ 
  open, 
  onClose, 
  dataSource,
  onSave,
}: EditDocumentOverlayProps) {
  const [name, setName] = useState(dataSource.name);

  useEffect(() => {
    setName(dataSource.name);
  }, [dataSource]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const updateData: DataSourceUpdate = {
      name: name,
    };

    try {
      await onSave(updateData);
      toast.success(`Data Source "${name}" updated successfully.`);
      onClose();
    } catch (error) {
      console.error('Error updating data source:', error);
      }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Data Source: {dataSource.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="ds-name">Name</Label>
            <Input id="ds-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Type</Label>
            <Input value={dataSource.type} readOnly disabled className="bg-muted/50 capitalize" />
          </div>
          <div>
            <Label>Status</Label>
            <Input value={dataSource.status} readOnly disabled className="bg-muted/50 capitalize" />
          </div>
          {dataSource.error_message && (
          <div>
              <Label>Last Error</Label>
              <Textarea value={dataSource.error_message} readOnly disabled className="bg-muted/50 text-destructive" rows={2} />
          </div>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save Changes</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}