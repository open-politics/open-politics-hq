'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Copy, Trash2, Eye, Globe, Lock, Users, Package as PackageIcon, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

import { usePackageStore, type PackageRead, type PackagePublicRead } from '@/zustand_stores/storePackages';
import CreatePackageDialog from './CreatePackageDialog';
import PackageDetailView from './PackageDetailView';

function visibilityBadge(v: string) {
  switch (v) {
    case 'public': return <Badge variant="default" className="gap-1"><Globe className="h-3 w-3" />Public</Badge>;
    case 'internal': return <Badge variant="secondary" className="gap-1"><Users className="h-3 w-3" />Internal</Badge>;
    default: return <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />Token</Badge>;
  }
}

function statusBadge(pkg: PackageRead) {
  if (!pkg.is_active) return <Badge variant="destructive">Inactive</Badge>;
  if (pkg.expires_at) {
    const expired = new Date(pkg.expires_at as string) < new Date();
    if (expired) return <Badge variant="destructive">Expired</Badge>;
  }
  return <Badge variant="default" className="bg-green-600">Active</Badge>;
}

export default function PackageManager() {
  const {
    packages, discoveredPackages, selectedPackage,
    isLoading, isLoadingDiscovery,
    fetchPackages, deletePackage, selectPackage, clearSelection,
    discoverPackages,
  } = usePackageStore();

  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  if (selectedPackage) {
    return <PackageDetailView onBack={clearSelection} />;
  }

  const copyToken = (token: string) => {
    const url = `${window.location.origin}/p/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Package link copied to clipboard');
  };

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageIcon className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Packages</h1>
        </div>
      </div>

      <Tabs defaultValue="my-packages" className="flex-1 flex flex-col">
        <TabsList>
          <TabsTrigger value="my-packages">My Packages</TabsTrigger>
          <TabsTrigger value="discover" onClick={() => discoverPackages('public')}>
            Discover
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my-packages" className="flex-1 flex flex-col gap-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" /> Create Package
            </Button>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground p-4">Loading...</div>
          ) : packages.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center">
              No packages yet. Create one to start sharing curated data.
            </div>
          ) : (
            <div className="border rounded-md overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Visibility</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {packages.map((pkg) => (
                    <TableRow
                      key={pkg.id}
                      className="cursor-pointer"
                      onClick={() => selectPackage(pkg.id)}
                    >
                      <TableCell className="font-medium">{pkg.name}</TableCell>
                      <TableCell>{visibilityBadge(pkg.visibility)}</TableCell>
                      <TableCell>{pkg.items?.length ?? 0}</TableCell>
                      <TableCell>{statusBadge(pkg)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(pkg.created_at as string).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Copy link"
                            onClick={() => copyToken(pkg.token)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            onClick={() => deletePackage(pkg.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="discover" className="flex-1 flex flex-col gap-3">
          {isLoadingDiscovery ? (
            <div className="text-sm text-muted-foreground p-4">Discovering...</div>
          ) : discoveredPackages.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center">
              No public packages found on this instance.
            </div>
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
