'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Copy, Trash2, Globe, Lock, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { usePackageStore, type PackageRead, type PackagePublicRead } from '@/zustand_stores/storePackages';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { TreeView, type TreeViewItem } from '@/components/collection/assets/TreeView';
import { getResourceIcon } from '@/components/collection/assets/resourceConfig';
import CreatePackageDialog from './CreatePackageDialog';
import PackageDetailView from './PackageDetailView';

/* ─── Helpers ─── */

function visibilityBadge(v: string) {
  switch (v) {
    case 'public': return <Badge variant="default" className="gap-1 text-[10px] px-1.5 py-0"><Globe className="h-2.5 w-2.5" />Public</Badge>;
    case 'internal': return <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0"><Users className="h-2.5 w-2.5" />Internal</Badge>;
    default: return <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0"><Lock className="h-2.5 w-2.5" />Token</Badge>;
  }
}

function statusBadge(pkg: PackageRead) {
  if (!pkg.is_active) return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Inactive</Badge>;
  if (pkg.expires_at) {
    const expired = new Date(pkg.expires_at as string) < new Date();
    if (expired) return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Expired</Badge>;
  }
  return null; // Active is the default — no badge needed
}

/* ─── Component ─── */

export default function PackageManager() {
  const {
    packages, discoveredPackages, selectedPackage,
    isLoading, isLoadingDiscovery,
    fetchPackages, deletePackage, selectPackage, clearSelection,
    discoverPackages,
  } = usePackageStore();

  const [showCreate, setShowCreate] = useState(false);
  const activeInfospace = useInfospaceStore((s) => s.activeInfospace);

  useEffect(() => {
    if (activeInfospace?.id) {
      fetchPackages();
    }
  }, [activeInfospace?.id, fetchPackages]);

  // Convert packages to TreeViewItems
  const packageItems = useMemo((): TreeViewItem[] =>
    packages.map((pkg) => ({
      id: `pkg-${pkg.id}`,
      type: 'asset' as const,
      name: pkg.name,
      icon: getResourceIcon('package'),
      meta: { pkg },
    })),
    [packages],
  );

  const renderBadge = useCallback((item: TreeViewItem) => {
    const pkg = item.meta?.pkg as PackageRead;
    if (!pkg) return null;
    return (
      <>
        {visibilityBadge(pkg.visibility)}
        {statusBadge(pkg)}
        <span className="text-xs text-muted-foreground">{pkg.items?.length ?? 0} items</span>
      </>
    );
  }, []);

  const copyToken = useCallback((token: string) => {
    const url = `${window.location.origin}/p/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Package link copied');
  }, []);

  const renderActions = useCallback((item: TreeViewItem) => {
    const pkg = item.meta?.pkg as PackageRead;
    if (!pkg) return null;
    return (
      <>
        <Button
          variant="ghost" size="sm" className="h-6 w-6 p-0"
          title="Copy link"
          onClick={(e) => { e.stopPropagation(); copyToken(pkg.token); }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
          title="Delete"
          onClick={(e) => { e.stopPropagation(); deletePackage(pkg.id); }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </>
    );
  }, [copyToken, deletePackage]);

  const handleItemClick = useCallback((item: TreeViewItem) => {
    const pkg = item.meta?.pkg as PackageRead;
    if (pkg) selectPackage(pkg.id);
  }, [selectPackage]);

  if (selectedPackage) {
    return <PackageDetailView onBack={clearSelection} />;
  }

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Shared Packages</h1>
      
      </div>

      <Tabs defaultValue="my-packages" className="">
        <TabsList >
          <TabsTrigger value="my-packages">My Packages</TabsTrigger>
          <TabsTrigger value="discover" onClick={() => discoverPackages('public')}>
            Discover on this instance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my-packages" className="flex-1 flex flex-col gap-3">
          
        <div className="flex justify-center">
            <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
              <Plus className="" /> Create Package
            </Button>
          </div>


          {isLoading ? (
            <p className="text-sm text-muted-foreground p-4">Loading...</p>
          ) : packages.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">
              No packages yet. Create one to start sharing curated data.
            </p>
          ) : (
            <TreeView
              items={packageItems}
              renderBadge={renderBadge}
              renderActions={renderActions}
              onItemClick={handleItemClick}
            />
          )}
        </TabsContent>

        <TabsContent value="discover" className="flex-1 flex flex-col gap-3">
          {isLoadingDiscovery ? (
            <p className="text-sm text-muted-foreground p-4">Discovering...</p>
          ) : discoveredPackages.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">
              No public packages found on this instance.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {discoveredPackages.map((pkg) => (
                <div key={pkg.uuid} className="border rounded-lg p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">{pkg.name}</span>
                    {visibilityBadge(pkg.visibility)}
                  </div>
                  {pkg.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{pkg.description}</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-auto">
                    <span>{pkg.item_count} items</span>
                    <span>{new Date(pkg.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CreatePackageDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
