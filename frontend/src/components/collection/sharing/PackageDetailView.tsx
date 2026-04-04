'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { ArrowLeft, Copy, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

import { usePackageStore, type PackageItemRead } from '@/zustand_stores/storePackages';
import { useTreeStore } from '@/zustand_stores/storeTree';
import { TreeView, treeNodeToViewItem, type TreeViewItem } from '@/components/collection/assets/TreeView';
import {
  getResourceConfig, RESOURCE_GROUP_ORDER, DERIVATION_LABELS,
} from '@/components/collection/assets/resourceConfig';
import ResourcePicker from './ResourcePicker';

/** Convert PackageItemRead[] → nested TreeViewItem[] grouped by resource_type */
function buildItemGroups(
  items: PackageItemRead[],
): Map<string, { items: TreeViewItem[]; count: number }> {
  type Node = PackageItemRead & { children: Node[] };
  const nodeMap = new Map<number, Node>();
  const roots: Node[] = [];

  for (const item of items) nodeMap.set(item.id, { ...item, children: [] });
  for (const item of items) {
    const node = nodeMap.get(item.id)!;
    if (item.derived_from_item_id && nodeMap.has(item.derived_from_item_id)) {
      nodeMap.get(item.derived_from_item_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const isFileType = (t: string) => t === 'bundle' || t === 'asset';

  const convert = (node: Node): TreeViewItem => ({
    id: `pkgitem-${node.id}`,
    type: node.resource_type === 'bundle' ? 'folder' : 'asset',
    name: node.resource_name || `${node.resource_type} #${node.resource_id}`,
    // File items: use kind for asset icons, fallback for bundles. Non-file items: no icon (section header provides context).
    icon: isFileType(node.resource_type) ? undefined : null,
    kind: (node.resource_kind ?? undefined) as TreeViewItem['kind'],
    children: node.children.length > 0 ? node.children.map(convert) : undefined,
    isContainer: node.resource_type === 'bundle',
    meta: {
      packageItemId: node.id,
      resourceId: node.resource_id,
      resourceType: node.resource_type,
      derivationType: node.derivation_type,
    },
  });

  // Group roots by type (merge bundle + asset into 'files')
  const grouped = new Map<string, Node[]>();
  for (const node of roots) {
    const key = (node.resource_type === 'bundle' || node.resource_type === 'asset')
      ? 'files' : node.resource_type;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(node);
  }

  // Sort files group: bundles first, then standalone assets
  const files = grouped.get('files');
  if (files) {
    files.sort((a, b) => {
      if (a.resource_type === 'bundle' && b.resource_type !== 'bundle') return -1;
      if (a.resource_type !== 'bundle' && b.resource_type === 'bundle') return 1;
      return 0;
    });
  }

  const result = new Map<string, { items: TreeViewItem[]; count: number }>();
  for (const [type, nodes] of grouped) {
    const countAll = (ns: Node[]): number =>
      ns.reduce((sum, n) => sum + 1 + countAll(n.children), 0);
    result.set(type, { items: nodes.map(convert), count: countAll(nodes) });
  }
  return result;
}

/* ─── Main component ─── */

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
  const items = pkg.items || [];

  // Build all package items into grouped TreeViewItem[]
  const itemGroups = useMemo(() => buildItemGroups(items), [items]);

  const filesGroup = itemGroups.get('files');
  const orderedTypes = useMemo(() => {
    const types = RESOURCE_GROUP_ORDER.filter((t) => t !== 'files' && itemGroups.has(t)) as string[];
    for (const t of itemGroups.keys()) {
      if (t !== 'files' && !types.includes(t)) types.push(t);
    }
    return types;
  }, [itemGroups]);

  // Expand all folders by default
  const defaultExpandedIds = useMemo(() => {
    const ids = new Set<string>();
    const collect = (items: TreeViewItem[]) => {
      for (const item of items) {
        if (item.children?.length) {
          ids.add(item.id);
          collect(item.children);
        }
      }
    };
    for (const group of itemGroups.values()) collect(group.items);
    return ids;
  }, [itemGroups]);

  // Lazy-load bundle contents from the tree API (paginated, 50 per page)
  const { fetchChildren } = useTreeStore();
  const handleLoadChildren = useCallback(async (id: string, offset: number) => {
    // id is "pkgitem-{n}" — resolve to "bundle-{resource_id}" for the tree API
    const item = items.find(i => `pkgitem-${i.id}` === id);
    if (!item || item.resource_type !== 'bundle') return { items: [], hasMore: false };
    const result = await fetchChildren(`bundle-${item.resource_id}`, offset, 50);
    return { items: result.children.map(treeNodeToViewItem), hasMore: result.hasMore };
  }, [items, fetchChildren]);

  const renderBadge = useCallback((item: TreeViewItem) => {
    const derivationType = item.meta?.derivationType as string | undefined;
    if (!derivationType) return null;
    return (
      <span className="text-xs text-muted-foreground shrink-0">
        ({DERIVATION_LABELS[derivationType] || derivationType})
      </span>
    );
  }, []);

  const renderActions = useCallback((item: TreeViewItem) => {
    const packageItemId = item.meta?.packageItemId as number;
    return (
      <Button
        variant="ghost" size="sm"
        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
        onClick={(e) => { e.stopPropagation(); removeItem(pkg.id, packageItemId); }}
        title="Remove from package"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    );
  }, [pkg.id, removeItem]);

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
        <h2 className="text-sm font-semibold">Assets</h2>
        <Button size="sm" variant="ghost" onClick={() => setShowPicker(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      {filesGroup ? (
        <TreeView
          items={filesGroup.items}
          defaultExpandedIds={defaultExpandedIds}
          onLoadChildren={handleLoadChildren}
          renderBadge={renderBadge}
          renderActions={renderActions}
        />
      ) : (
        <p className="text-sm text-muted-foreground py-4">No items yet</p>
      )}

      {orderedTypes.map((type) => {
        const group = itemGroups.get(type)!;
        const config = getResourceConfig(type);
        return (
          <div key={type}>
            <h3 className="text-xs font-medium text-muted-foreground mt-4 mb-1">{config.groupLabel}</h3>
            <TreeView
              items={group.items}
              defaultExpandedIds={defaultExpandedIds}
              renderBadge={renderBadge}
              renderActions={renderActions}
            />
          </div>
        );
      })}

      <ResourcePicker
        open={showPicker}
        onOpenChange={setShowPicker}
        packageId={pkg.id}
      />
    </div>
  );
}
