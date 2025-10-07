import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Folder, FileText, Link as LinkIcon, Image as ImageIcon, Video, Music, File as FileIcon, Download } from 'lucide-react';
import { BundlePreview, AssetPreview } from '@/zustand_stores/storeShareables';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';

interface BundlePublicViewProps {
  bundle: BundlePreview;
  token: string;
  onAssetClick: (asset: AssetPreview) => void;
}

const getIconForKind = (kind: string) => {
    switch (kind) {
      case 'text':
      case 'pdf':
      case 'pdf_page':
      case 'text_chunk':
        return <FileText className="h-4 w-4 text-blue-500" />;
      case 'web':
      case 'article':
        return <LinkIcon className="h-4 w-4 text-green-500" />;
      case 'image':
      case 'image_region':
          return <ImageIcon className="h-4 w-4 text-purple-500" />;
      case 'video':
      case 'video_scene':
          return <Video className="h-4 w-4 text-red-500" />;
      case 'audio':
      case 'audio_segment':
          return <Music className="h-4 w-4 text-orange-500" />;
      default:
        return <FileIcon className="h-4 w-4 text-gray-500" />;
    }
  };

const BundlePublicView: React.FC<BundlePublicViewProps> = ({ bundle, token, onAssetClick }) => {
  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <div className="flex items-start gap-4">
            <div className="flex-shrink-0 mt-1">
                <Folder className="h-6 w-6 text-yellow-500" />
            </div>
            <div className="flex-grow">
                <CardTitle className="text-2xl font-bold">{bundle.name}</CardTitle>
                <CardDescription>
                    Folder &middot; {bundle.assets.length} item(s) &middot; Last updated {formatDistanceToNow(new Date(bundle.updated_at))} ago
                </CardDescription>
                {bundle.description && <p className="text-sm text-muted-foreground mt-2">{bundle.description}</p>}
            </div>
            <Button onClick={() => window.open(`/api/v1/shareables/download-bundle/${token}`, '_blank')}>
                <Download className="mr-2 h-4 w-4" />
                Download Bundle
            </Button>
        </div>
      </CardHeader>
      <CardContent>
        <h3 className="text-lg font-semibold mb-2">Contents</h3>
        <ScrollArea className="h-96 w-full rounded-md border p-2">
            <div className="flex flex-col gap-1">
            {bundle.assets.length > 0 ? (
                bundle.assets.map((asset) => (
                <div key={asset.id} className="group flex items-center p-2 rounded-md hover:bg-muted/50 cursor-pointer" onClick={() => onAssetClick(asset)}>
                    <div className="flex-shrink-0 mr-3">
                        {getIconForKind(asset.kind)}
                    </div>
                    <div className="flex-grow">
                        <p className="font-medium text-sm">{asset.title}</p>
                        <p className="text-xs text-muted-foreground">{asset.kind.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="ml-auto pl-2">
                        {asset.blob_path && (
                            <a href={`/api/v1/shareables/download/${token}/${asset.id}`} target="_blank" rel="noopener noreferrer" className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <Download className="h-4 w-4 text-muted-foreground hover:text-primary" />
                            </a>
                        )}
                    </div>
                </div>
                ))
            ) : (
                <div className="text-center p-8">
                    <p className="text-muted-foreground">This folder is empty.</p>
                </div>
            )}
            </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default BundlePublicView; 