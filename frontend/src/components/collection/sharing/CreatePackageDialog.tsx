'use client';

import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

import { usePackageStore } from '@/zustand_stores/storePackages';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreatePackageDialog({ open, onOpenChange }: Props) {
  const { createPackage } = usePackageStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('token');
  const [allowDownload, setAllowDownload] = useState(false);
  const [allowCopy, setAllowCopy] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;

    const pkg = await createPackage({
      name: name.trim(),
      description: description.trim() || undefined,
      visibility,
      default_allow_download: allowDownload,
      default_allow_copy: allowCopy,
    });

    if (pkg) {
      onOpenChange(false);
      setName('');
      setDescription('');
      setVisibility('token');
      setAllowDownload(false);
      setAllowCopy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Package</DialogTitle>
          <DialogDescription>
            A package is a curated selection of items to share. You can add items after creation.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pkg-name">Name</Label>
            <Input
              id="pkg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Energy Policy Briefing"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pkg-desc">Description</Label>
            <Input
              id="pkg-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={setVisibility}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="token">Token (private link)</SelectItem>
                <SelectItem value="internal">Internal (authenticated users)</SelectItem>
                <SelectItem value="public">Public (everyone)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="pkg-download">Allow download by default</Label>
            <Switch id="pkg-download" checked={allowDownload} onCheckedChange={setAllowDownload} />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="pkg-copy">Allow copy/import by default</Label>
            <Switch id="pkg-copy" checked={allowCopy} onCheckedChange={setAllowCopy} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
