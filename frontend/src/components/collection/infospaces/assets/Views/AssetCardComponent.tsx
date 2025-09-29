import React from 'react';
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { 
  FileText, 
  FileSpreadsheet, 
  Image as ImageIcon, 
  Video, 
  Music, 
  Mail, 
  Globe, 
  Type, 
  File, 
  Eye,
  Calendar,
  Hash,
  Folder,
  FolderOpen
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AssetRead } from '@/client';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AssetTreeItem } from '../AssetManager';
import { AssetPreview } from './AssetPreviewComponents';


interface AssetCardComponentProps {
  items: AssetTreeItem[];
  onItemSelect: (item: AssetTreeItem, multiSelect: boolean) => void;
  onItemDoubleClick: (item: AssetTreeItem) => void;
  onItemView?: (item: AssetTreeItem) => void;
  selectedItemIds: Set<string>;
}

const getAssetIcon = (kind: string, className?: string) => {
  const iconClass = cn("h-5 w-5", className);
  switch (kind) {
    case 'folder':
      return <Folder className={cn(iconClass, "text-blue-500")} />;
    case 'pdf':
      return <FileText className={cn(iconClass, "text-red-500")} />;
    case 'csv':
      return <FileSpreadsheet className={cn(iconClass, "text-green-500")} />;
    case 'image':
      return <ImageIcon className={cn(iconClass, "text-purple-500")} />;
    case 'video':
      return <Video className={cn(iconClass, "text-orange-500")} />;
    case 'audio':
      return <Music className={cn(iconClass, "text-teal-500")} />;
    case 'mbox':
    case 'email':
      return <Mail className={cn(iconClass, "text-blue-500")} />;
    case 'web':
    case 'article':
      return <Globe className={cn(iconClass, "text-sky-500")} />;
    case 'text':
    case 'text_chunk':
      return <Type className={cn(iconClass, "text-indigo-500")} />;
    default:
      return <File className={cn(iconClass, "text-muted-foreground")} />;
  }
};

const getAssetMetadata = (asset: AssetRead) => {
  const metadata: { icon: React.ReactNode, value: string }[] = [];
  
  if (asset.source_metadata?.filename) {
    metadata.push({ icon: <File className="h-3 w-3" />, value: asset.source_metadata.filename as string});
  }
  if (asset.kind === 'pdf' && asset.source_metadata?.page_count) {
    metadata.push({ icon: <FileText className="h-3 w-3" />, value: `${asset.source_metadata.page_count} pages`});
  }
  if (asset.kind === 'csv' && asset.source_metadata?.row_count) {
    metadata.push({ icon: <Hash className="h-3 w-3" />, value: `${asset.source_metadata.row_count} rows`});
  }
  
  return metadata;
};

const AssetCardComponent: React.FC<AssetCardComponentProps> = React.memo(({ 
  items, 
  onItemSelect,
  onItemDoubleClick,
  onItemView,
  selectedItemIds
}) => {

  const handleFolderClick = (item: AssetTreeItem, e: React.MouseEvent) => {
    // Default behavior: navigate deeper into folder
    onItemDoubleClick(item);
  };

  const handleAssetClick = (item: AssetTreeItem, e: React.MouseEvent) => {
    // For assets: view the asset (like list view)
    if (onItemView) {
      onItemView(item);
    }
  };

  const handleBundleDetailsClick = (item: AssetTreeItem, e: React.MouseEvent) => {
    e.stopPropagation();
    // View bundle details
    if (onItemView) {
      onItemView(item);
    }
  };

  const handleCheckboxClick = (item: AssetTreeItem, e: React.MouseEvent) => {
    e.stopPropagation();
    // Toggle selection
    onItemSelect(item, true);
  };

  const handleCheckboxChange = (item: AssetTreeItem) => {
    // Toggle selection (no event to stop propagation needed here)
    onItemSelect(item, true);
  };

  return (
    <ScrollArea className="h-full max-w-[70vw]">
      <div className="grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-4 p-4">
        {items.map((item) => {
          const isSelected = selectedItemIds.has(item.id);
          
          if (item.type === 'folder' && item.bundle) {
            const bundle = item.bundle;
            const childCount = item.children?.length || 0;

            const kindCounts = (item.children || []).reduce((acc, currentItem) => {
              let kind: string | undefined;
              if (currentItem.type === 'asset' && currentItem.asset) {
                  kind = currentItem.asset.kind;
              } else if (currentItem.type === 'folder') {
                  kind = 'folder';
              }
              
              if (kind) {
                  acc[kind] = (acc[kind] || 0) + 1;
              }
              return acc;
            }, {} as Record<string, number>);

            const contentSummary = Object.entries(kindCounts)
              .map(([kind, count]) => ({ kind, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 4);

            return (
              <Card
                key={item.id}
                className={cn(
                  "group overflow-hidden transition-all duration-200 cursor-pointer flex flex-col",
                  "rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-md",
                  isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                )}
                onDoubleClick={() => onItemDoubleClick(item)}
              >
                <div 
                  className="p-2 border-b flex items-center justify-between bg-card"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => handleCheckboxChange(item)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-5 w-5 bg-card/60 border-2 border-white/20 shadow-sm rounded-md"
                    />
                    <div className="min-w-0">
                      <div 
                        className="font-medium text-sm text-card-foreground leading-tight truncate group-hover:text-primary transition-colors"
                        title={item.name}
                      >
                        {item.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {bundle.description || `${childCount} item${childCount !== 1 ? 's' : ''}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3" />
                      <span>{formatDistanceToNow(new Date(bundle.updated_at), { addSuffix: true })}</span>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => handleBundleDetailsClick(item, e)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>View Details</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </div>

                <div 
                  onClick={(e) => handleFolderClick(item, e)}
                  className="aspect-video w-full bg-muted/30 group-hover:bg-muted/40 transition-colors flex items-center justify-center p-4"
                >
                  {contentSummary.length > 0 ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full">
                      {contentSummary.map(({ kind, count }) => (
                        <div key={kind} className="flex items-center gap-2 text-sm text-muted-foreground truncate">
                            {getAssetIcon(kind, "h-5 w-5 flex-shrink-0")}
                            <span className="font-medium">{count}</span>
                            <span className="capitalize truncate">{kind.replace('_', ' ')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    item.isExpanded 
                      ? <FolderOpen className="w-1/3 h-1/3 text-muted-foreground/30 transition-transform group-hover:scale-105" />
                      : <Folder className="w-1/3 h-1/3 text-muted-foreground/30 transition-transform group-hover:scale-105" />
                  )}
                </div>
              </Card>
            );
          }

          if (item.type === 'asset' && item.asset) {
            const asset = item.asset;
            const metadata = getAssetMetadata(asset);

            return (
              <Card
                key={item.id}
                className={cn(
                  "group overflow-hidden transition-all duration-200 cursor-pointer flex flex-col",
                  "rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-md",
                  isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                )}
                onDoubleClick={() => onItemDoubleClick(item)}
              >
                <div className="p-2 border-b flex items-center justify-between bg-card">
                  <div className="flex items-center gap-3 min-w-0">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => handleCheckboxChange(item)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-5 w-5 bg-card/60 border-2 border-white/20 shadow-sm rounded-md"
                    />
                    <div className="min-w-0">
                      <div 
                        className="font-medium text-sm text-card-foreground leading-tight truncate group-hover:text-primary transition-colors"
                        title={item.name}
                      >
                        {item.name}
                      </div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {asset.kind.replace('_', ' ')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3" />
                      <span>{formatDistanceToNow(new Date(asset.updated_at), { addSuffix: true })}</span>
                    </div>
                    <div className="w-8 h-8" />
                  </div>
                </div>

                <div onClick={(e) => handleAssetClick(item, e)} className="flex flex-col flex-grow min-h-0">
                  <CardContent className="p-0 flex-grow bg-muted/30">
                    <AssetPreview asset={asset} />
                  </CardContent>
                  
                  {metadata.length > 0 && (
                    <div className="p-3 border-t">
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                          {metadata.map((meta, index) => (
                            <div key={index} className="flex items-center gap-1.5 truncate">
                              {React.cloneElement(meta.icon as React.ReactElement, { className: "h-3 w-3 flex-shrink-0" })}
                              <span className="truncate">{meta.value}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          }
          
          return null;
        })}
      </div>
      
      {items.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center h-full text-muted-foreground">
          <Folder className="h-16 w-16 mb-4 text-muted-foreground/30" />
          <h3 className="text-xl font-medium mb-2">This folder is empty</h3>
          <p className="text-sm text-muted-foreground">Add some assets or folders to get started.</p>
        </div>
      )}
    </ScrollArea>
  );
});

AssetCardComponent.displayName = 'AssetCardComponent';

export default AssetCardComponent; 