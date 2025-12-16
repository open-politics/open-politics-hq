import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AssetPreview } from '@/zustand_stores/storeShareables';
import { formatDistanceToNowStrict } from 'date-fns';
import { getAssetIcon, formatAssetKind, getAssetBadgeClass } from '@/components/collection/assets/AssetSelector';
import { ChevronRight, ChevronDown, Download, FileText, Layers, Table as TableIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PublicAuthenticatedPDF } from '../PublicViewers/PublicAuthenticatedPDF';

interface AssetPublicViewProps {
  asset: AssetPreview;
  token: string;
}

const AssetItem: React.FC<{ asset: AssetPreview; level: number; token: string }> = ({ asset, level, token }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = asset.children && asset.children.length > 0;

  const handleDownload = () => {
    window.open(`/api/v1/shareables/download/${token}/${asset.id}`, '_blank');
  };

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'group flex items-center gap-2.5 py-1.5 px-3 hover:bg-muted/50 transition-colors rounded-md',
          level > 0 && 'border-t border-dashed border-gray-200 dark:border-gray-700'
        )}
        style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
      >
        <div className="w-4 h-4 flex items-center justify-center">
          {hasChildren && (
            <Button
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </Button>
          )}
        </div>
        <div className="w-4 h-4 flex items-center justify-center">{getAssetIcon(asset.kind)}</div>
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={cn('text-xs flex-shrink-0', getAssetBadgeClass(asset.kind))}>
              {formatAssetKind(asset.kind)}
            </Badge>
            <span className="text-sm font-medium truncate">{asset.title}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 ml-auto pl-4">
          {asset.blob_path && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={handleDownload}
            >
              <Download className="h-3 w-3 mr-1" />
              Download
            </Button>
          )}
          <div className="text-xs text-muted-foreground truncate hidden md:block">
            {formatDistanceToNowStrict(new Date(asset.updated_at), { addSuffix: true })}
          </div>
        </div>
      </div>
      {isExpanded && hasChildren && (
        <div className="pl-4 border-l-2 border-slate-200 dark:border-slate-700">
          {asset.children?.map((child) => (
            <AssetItem key={child.id} asset={child} level={level + 1} token={token} />
          ))}
        </div>
      )}
    </div>
  );
};

const AssetPublicView: React.FC<AssetPublicViewProps> = ({ asset, token }) => {
  const hasChildren = asset.children && asset.children.length > 0;
  const originalFileName = asset.source_metadata?.filename;
  const [activeTab, setActiveTab] = useState<'content' | 'children'>('content');

  const renderContent = () => {
    switch (asset.kind) {
      case 'pdf':
        return asset.blob_path ? (
          <PublicAuthenticatedPDF token={token} assetId={asset.id} title={asset.title} className="w-full h-full border-0" />
        ) : (
          <div className="text-center p-8 text-muted-foreground">This PDF asset has no file to display.</div>
        );
      case 'text':
      case 'text_chunk':
      default:
        return asset.text_content ? (
          <div className="mt-4 p-4 border rounded-md bg-muted/50 max-h-96 overflow-y-auto">
            <h3 className="font-semibold text-lg mb-2 flex items-center">
              <FileText className="h-5 w-5 mr-2" /> Text Content
            </h3>
            <pre className="text-sm whitespace-pre-wrap font-sans">{asset.text_content}</pre>
          </div>
        ) : (
          <div className="text-center p-8 text-muted-foreground">No preview available for this asset type.</div>
        );
    }
  };

  return (
    <Card className="w-full max-w-5xl mx-auto">
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 mt-1">{getAssetIcon(asset.kind, 'h-6 w-6')}</div>
          <div className="flex-grow">
            <CardTitle className="text-2xl font-bold">{asset.title}</CardTitle>
            <CardDescription>
              {formatAssetKind(asset.kind)}
              {originalFileName && ` · ${originalFileName}`}
              {' · '}Last updated {formatDistanceToNowStrict(new Date(asset.updated_at))} ago
            </CardDescription>
          </div>
          {asset.blob_path && (
            <Button onClick={() => window.open(`/api/v1/shareables/download/${token}/${asset.id}`, '_blank')}>
              <Download className="mr-2 h-4 w-4" /> Download
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'content' | 'children')} className="w-full">
          <TabsList className={cn("grid w-full", hasChildren ? "grid-cols-2" : "grid-cols-1")}>
            <TabsTrigger value="content">
              {asset.kind === 'pdf' ? 'PDF Viewer' : 'Content'}
            </TabsTrigger>
            {hasChildren && (
              <TabsTrigger value="children" className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Child Assets ({asset.children?.length})
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="content" className="mt-4">
            {renderContent()}
          </TabsContent>
          {hasChildren && (
            <TabsContent value="children" className="mt-4">
              <div className="border rounded-md">
                <ScrollArea className="h-[450px]">
                  {asset.children?.map((child) => (
                    <AssetItem key={child.id} asset={child} level={0} token={token} />
                  ))}
                </ScrollArea>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default AssetPublicView; 