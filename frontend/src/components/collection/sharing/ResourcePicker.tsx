'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileText, FolderOpen, Microscope, Network, Play } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';

import {
  AnnotationSchemasService, RunsService,
  KnowledgeGraphsService,
} from '@/client';
import { usePackageStore } from '@/zustand_stores/storePackages';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import AssetSelector, { type AssetTreeItem } from '@/components/collection/assets/AssetSelector';

type ResourceEntry = { id: number; name: string; type: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageId: number;
}

export default function ResourcePicker({ open, onOpenChange, packageId }: Props) {
  const { addItem } = usePackageStore();
  const infospaceId = useInfospaceStore((s) => s.activeInfospace?.id);

  const [runs, setRuns] = useState<ResourceEntry[]>([]);
  const [schemas, setSchemas] = useState<ResourceEntry[]>([]);
  const [graphs, setGraphs] = useState<ResourceEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assetSelection, setAssetSelection] = useState<Set<string>>(new Set());
  const [allowDownload, setAllowDownload] = useState<string>('inherit');
  const [allowCopy, setAllowCopy] = useState<string>('inherit');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open || !infospaceId) return;
    setSelected(new Set());
    setAssetSelection(new Set());

    const load = async () => {
      setIsLoading(true);
      try {
        const [runRes, schemaRes, graphRes] = await Promise.allSettled([
          RunsService.listRuns({ infospaceId }),
          AnnotationSchemasService.listAnnotationSchemas({ infospaceId }),
          KnowledgeGraphsService.listKnowledgeGraphs({ infospaceId }),
        ]);

        if (runRes.status === 'fulfilled') {
          const result = runRes.value as any;
          const data = Array.isArray(result) ? result : result.data ?? [];
          setRuns(data.map((r: any) => ({ id: r.id, name: r.name || `Run #${r.id}`, type: 'run' })));
        }
        if (schemaRes.status === 'fulfilled') {
          const result = schemaRes.value as any;
          const data = Array.isArray(result) ? result : result.data ?? [];
          setSchemas(data.map((s: any) => ({ id: s.id, name: s.name, type: 'schema' })));
        }
        if (graphRes.status === 'fulfilled') {
          const data = graphRes.value as any[];
          setGraphs(data.map((g: any) => ({ id: g.id, name: g.name, type: 'graph' })));
        }
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [open, infospaceId]);

  const toggleItem = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalSelected = selected.size + assetSelection.size;

  const handleAdd = async () => {
    // Add resource-tab items (runs, schemas, graphs)
    for (const key of selected) {
      const [type, idStr] = key.split(':');
      const id = parseInt(idStr, 10);
      const itemData: Record<string, any> = {};

      if (type === 'run') itemData.run_id = id;
      else if (type === 'schema') itemData.schema_id = id;
      else if (type === 'graph') itemData.graph_id = id;

      if (allowDownload !== 'inherit') itemData.allow_download = allowDownload === 'yes';
      if (allowCopy !== 'inherit') itemData.allow_copy = allowCopy === 'yes';

      await addItem(packageId, itemData);
    }

    // Add asset-tab items (bundles and individual assets from AssetSelector)
    for (const itemId of assetSelection) {
      const itemData: Record<string, any> = {};

      if (itemId.startsWith('bundle-')) {
        itemData.bundle_id = parseInt(itemId.replace('bundle-', ''), 10);
      } else if (itemId.startsWith('asset-') || itemId.startsWith('child-')) {
        itemData.asset_id = parseInt(itemId.replace(/^(asset-|child-)/, ''), 10);
      } else {
        continue;
      }

      if (allowDownload !== 'inherit') itemData.allow_download = allowDownload === 'yes';
      if (allowCopy !== 'inherit') itemData.allow_copy = allowCopy === 'yes';

      await addItem(packageId, itemData);
    }

    onOpenChange(false);
  };

  const renderList = (items: ResourceEntry[], Icon: React.ElementType) => (
    <ScrollArea className="h-64">
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground p-4 text-center">None available</div>
      ) : (
        <div className="flex flex-col gap-1 p-1">
          {items.map((item) => {
            const key = `${item.type}:${item.id}`;
            return (
              <label
                key={key}
                className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(key)}
                  onCheckedChange={() => toggleItem(key)}
                />
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm truncate">{item.name}</span>
                <span className="text-xs text-muted-foreground ml-auto">#{item.id}</span>
              </label>
            );
          })}
        </div>
      )}
    </ScrollArea>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Add Items to Package</DialogTitle>
          <DialogDescription>Select bundles, assets, or other resources to include.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="text-sm text-muted-foreground p-4 text-center">Loading resources...</div>
        ) : (
          <Tabs defaultValue="assets">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="assets">Assets</TabsTrigger>
              <TabsTrigger value="runs">Runs</TabsTrigger>
              <TabsTrigger value="schemas">Schemas</TabsTrigger>
              <TabsTrigger value="graphs">Graphs</TabsTrigger>
            </TabsList>
            <TabsContent value="assets">
              <div className="h-72">
                <AssetSelector
                  selectedItems={assetSelection}
                  onSelectionChange={setAssetSelection}
                  compact
                />
              </div>
            </TabsContent>
            <TabsContent value="runs">{renderList(runs, Play)}</TabsContent>
            <TabsContent value="schemas">{renderList(schemas, Microscope)}</TabsContent>
            <TabsContent value="graphs">{renderList(graphs, Network)}</TabsContent>
          </Tabs>
        )}

        <div className="flex gap-4 pt-2 border-t">
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Download:</Label>
            <select
              value={allowDownload}
              onChange={(e) => setAllowDownload(e.target.value)}
              className="h-7 text-xs rounded border bg-background px-2"
            >
              <option value="inherit">Inherit</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Copy:</Label>
            <select
              value={allowCopy}
              onChange={(e) => setAllowCopy(e.target.value)}
              className="h-7 text-xs rounded border bg-background px-2"
            >
              <option value="inherit">Inherit</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={totalSelected === 0}>
            Add {totalSelected} item{totalSelected !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
