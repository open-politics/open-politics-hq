'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

import { OpenAPI, TreeNavigationService } from '@/client';
import { TreeView, type TreeViewItem, treeNodeToViewItem } from '@/components/collection/assets/TreeView';
import {
  getResourceConfig, RESOURCE_GROUP_ORDER, DERIVATION_LABELS,
} from '@/components/collection/assets/resourceConfig';

/* ─── Types ─── */

interface PackageTokenItem {
  id: number;
  resource_type: string;
  resource_id: number;
  resource_name: string | null;
  resource_kind: string | null;
  allow_download: boolean;
  allow_copy: boolean;
  derived_from_item_id: number | null;
  derivation_type: string | null;
}

interface PackageTokenResponse {
  uuid: string;
  name: string;
  description: string | null;
  infospace_id: number;
  infospace_name: string | null;
  items: PackageTokenItem[];
}

/* ─── Build all items into grouped TreeViewItem[] ─── */

function buildItemGroups(
  items: PackageTokenItem[],
): Map<string, { items: TreeViewItem[]; count: number }> {
  type Node = PackageTokenItem & { children: Node[] };
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
    id: `pkg-${node.id}`,
    type: node.resource_type === 'bundle' ? 'folder' : 'asset',
    name: node.resource_name || `${node.resource_type} #${node.resource_id}`,
    icon: isFileType(node.resource_type) ? undefined : null,
    kind: (node.resource_kind ?? undefined) as TreeViewItem['kind'],
    children: node.children.length > 0 ? node.children.map(convert) : undefined,
    isContainer: node.resource_type === 'bundle',
    meta: {
      allowDownload: node.allow_download,
      allowCopy: node.allow_copy,
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
  token: string;
}

export default function PackageConsumerView({ token }: Props) {
  const [pkg, setPkg] = useState<PackageTokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPackage = async () => {
      setIsLoading(true);
      try {
        const baseUrl = OpenAPI.BASE || '';
        const res = await fetch(`${baseUrl}/api/v1/p/${token}`);
        if (res.status === 410) {
          setError('This package has expired.');
          return;
        }
        if (!res.ok) {
          setError('Package not found.');
          return;
        }
        const data = await res.json();
        setPkg(data);
      } catch (e) {
        setError('Failed to load package.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchPackage();
  }, [token]);

  // All hooks before conditional returns
  const itemGroups = useMemo(
    () => pkg ? buildItemGroups(pkg.items) : new Map(),
    [pkg],
  );

  const orderedTypes = useMemo(() => {
    const types = RESOURCE_GROUP_ORDER.filter((t) => itemGroups.has(t)) as string[];
    for (const t of itemGroups.keys()) {
      if (!types.includes(t)) types.push(t);
    }
    return types;
  }, [itemGroups]);

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

  const downloadUrl = useCallback((assetId: number) =>
    `${OpenAPI.BASE || ''}/api/v1/p/${token}/assets/${assetId}/download`, [token]);

  // Lazy-load bundle contents via tree API with package token scope (paginated, 50 per page)
  const handleLoadChildren = useCallback(async (id: string, offset: number) => {
    if (!pkg) return { items: [], hasMore: false };
    const pkgItemId = parseInt(id.replace('pkg-', ''), 10);
    const item = pkg.items.find(i => i.id === pkgItemId);
    if (!item || item.resource_type !== 'bundle') return { items: [], hasMore: false };
    const tree = await TreeNavigationService.getTreeChildren({
      infospaceId: pkg.infospace_id,
      parentId: `bundle-${item.resource_id}`,
      packageToken: token,
      skip: offset,
      limit: 20,
    });
    return {
      items: (tree.section.items ?? []).map(treeNodeToViewItem),
      hasMore: tree.section.has_more ?? false,
    };
  }, [pkg, token]);

  const renderBadge = useCallback((item: TreeViewItem) => {
    const meta = item.meta ?? {};
    const badges: React.ReactNode[] = [];
    if (meta.derivationType) {
      badges.push(
        <span key="deriv" className="text-xs text-muted-foreground shrink-0">
          ({DERIVATION_LABELS[meta.derivationType as string] || (meta.derivationType as string)})
        </span>
      );
    }
    if (meta.allowDownload) {
      badges.push(<Badge key="dl" variant="secondary" className="text-[10px] px-1.5 py-0">download</Badge>);
    }
    if (meta.allowCopy) {
      badges.push(<Badge key="cp" variant="secondary" className="text-[10px] px-1.5 py-0">copy</Badge>);
    }
    return badges.length > 0 ? <>{badges}</> : null;
  }, []);

  const renderActions = useCallback((item: TreeViewItem) => {
    const meta = item.meta ?? {};
    if (meta.allowDownload && meta.resourceType === 'asset') {
      return (
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" asChild>
          <a href={downloadUrl(meta.resourceId as number)} download>
            <Download className="h-3.5 w-3.5" />
          </a>
        </Button>
      );
    }
    return null;
  }, [downloadUrl]);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground p-8 text-center">Loading package...</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!pkg) return null;

  const exportUrl = `${OpenAPI.BASE || ''}/api/v1/p/${token}/export`;
  const hasDownloadableItems = pkg.items.some(
    (i) => i.allow_download && (i.resource_type === 'asset' || i.resource_type === 'bundle')
  );

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{pkg.name}</h1>
        {pkg.description && (
          <p className="text-muted-foreground mt-1">{pkg.description}</p>
        )}
        {pkg.infospace_name && (
          <p className="text-xs text-muted-foreground mt-2">
            From: {pkg.infospace_name}
          </p>
        )}
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{pkg.items.length} items</h2>
        {hasDownloadableItems && (
          <Button size="sm" variant="ghost" asChild>
            <a href={exportUrl} download>
              <Download className="h-4 w-4 mr-1" /> Export All
            </a>
          </Button>
        )}
      </div>

      {orderedTypes.map((type) => {
        const group = itemGroups.get(type)!;
        const label = type === 'files' ? 'Assets' : getResourceConfig(type).groupLabel;
        return (
          <div key={type}>
            <h3 className="text-xs font-medium text-muted-foreground mt-4 mb-1">{label}</h3>
            <TreeView
              items={group.items}
              defaultExpandedIds={defaultExpandedIds}
              onLoadChildren={handleLoadChildren}
              renderBadge={renderBadge}
              renderActions={renderActions}
            />
          </div>
        );
      })}
    </div>
  );
}
