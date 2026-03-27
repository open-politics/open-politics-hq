'use client';

import React, { useState } from 'react';
import {
  ArrowLeft, Copy, Plus, Trash2, Download, FileText, FolderOpen,
  Microscope, Network, Play, Globe, Lock, Users, Tag,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

import { usePackageStore, type PackageItemRead } from '@/zustand_stores/storePackages';
import ResourcePicker from './ResourcePicker';

const RESOURCE_ICONS: Record<string, React.ElementType> = {
  bundle: FolderOpen,
  asset: FileText,
  run: Play,
  schema: Microscope,
  graph: Network,
  entity: Tag,
};

interface Props {
  onBack: () => void;
}

export default function PackageDetailView({ onBack }: Props) {
  const { selectedPackage, updatePackage, removeItem } = usePackageStore();
  const [showPicker, setShowPicker] = useState(false);
  const [editName, setEditName] = useState(false);
  const [nameValue, setNameValue] = useState(selectedPackage?.name ?? '');

  if (!selectedPackage) return null;

  const pkg = selectedPackage;
  const packageUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/p/${pkg.token}`;

  const copyLink = () => {
    navigator.clipboard.writeText(packageUrl);
    toast.success('Package link copied');
  };

  const saveName = async () => {
    if (nameValue.trim() && nameValue !== pkg.name) {
      await updatePackage(pkg.id, { name: nameValue.trim() });
    }
    setEditName(false);
  };

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {editName ? (
          <Input
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
            autoFocus
            className="text-lg font-semibold h-8 w-64"
          />
        ) : (
          <h1
            className="text-lg font-semibold cursor-pointer hover:underline"
            onClick={() => { setNameValue(pkg.name); setEditName(true); }}
          >
            {pkg.name}
          </h1>
        )}
      </div>

      {pkg.description && (
        <p className="text-sm text-muted-foreground ml-10">{pkg.description}</p>
      )}

      <Separator />

      {/* Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Visibility</Label>
            <Select
              value={pkg.visibility}
              onValueChange={(v) => updatePackage(pkg.id, { visibility: v })}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="token">Token (private link)</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between max-w-xs">
            <Label>Active</Label>
            <Switch
              checked={pkg.is_active}
              onCheckedChange={(v) => updatePackage(pkg.id, { is_active: v })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between max-w-xs">
            <Label>Default allow download</Label>
            <Switch
              checked={pkg.default_allow_download}
              onCheckedChange={(v) => updatePackage(pkg.id, { default_allow_download: v })}
            />
          </div>

          <div className="flex items-center justify-between max-w-xs">
            <Label>Default allow copy</Label>
            <Switch
              checked={pkg.default_allow_copy}
              onCheckedChange={(v) => updatePackage(pkg.id, { default_allow_copy: v })}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Token */}
      <div className="flex flex-col gap-1.5">
        <Label>Share link</Label>
        <div className="flex items-center gap-2">
          <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
            {packageUrl}
          </code>
          <Button variant="outline" size="sm" onClick={copyLink}>
            <Copy className="h-3 w-3 mr-1" /> Copy
          </Button>
        </div>
      </div>

      <Separator />

      {/* Items */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Items ({pkg.items?.length ?? 0})</h2>
        <Button size="sm" variant="outline" onClick={() => setShowPicker(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Item
        </Button>
      </div>

      {(!pkg.items || pkg.items.length === 0) ? (
        <div className="text-sm text-muted-foreground p-4 text-center border rounded-md">
          No items yet. Add bundles, runs, schemas, or other resources to this package.
        </div>
      ) : (
        <div className="border rounded-md overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Resource ID</TableHead>
                <TableHead>Download</TableHead>
                <TableHead>Copy</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pkg.items.map((item) => {
                const Icon = RESOURCE_ICONS[item.resource_type] ?? FileText;
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="capitalize text-sm">{item.resource_type}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{item.resource_id}</TableCell>
                    <TableCell>
                      <Badge variant={
                        (item.allow_download ?? pkg.default_allow_download) ? 'default' : 'outline'
                      }>
                        {(item.allow_download ?? pkg.default_allow_download) ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        (item.allow_copy ?? pkg.default_allow_copy) ? 'default' : 'outline'
                      }>
                        {(item.allow_copy ?? pkg.default_allow_copy) ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(pkg.id, item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ResourcePicker
        open={showPicker}
        onOpenChange={setShowPicker}
        packageId={pkg.id}
      />
    </div>
  );
}
