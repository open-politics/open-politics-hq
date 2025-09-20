'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  FileText, 
  FileSpreadsheet, 
  Image as ImageIcon, 
  Video, 
  Music, 
  Globe, 
  Type, 
  File, 
  ExternalLink,
  Download,
  Eye,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssetRead, AssetKind } from '@/client/models';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { AssetPreview } from '../Views/AssetPreviewComponents';
import { formatDistanceToNow } from 'date-fns';

interface AssetEmbedProps {
  assetId: number;
  mode: 'inline' | 'card' | 'reference' | 'attachment';
  size: 'small' | 'medium' | 'large' | 'full';
  caption?: string;
  className?: string;
  interactive?: boolean;
  onAssetClick?: (asset: AssetRead) => void;
}

const getAssetIcon = (kind: AssetKind, className?: string) => {
  const iconClass = cn("h-4 w-4", className);
  switch (kind) {
    case 'pdf': return <FileText className={cn(iconClass, "text-red-600")} />;
    case 'csv': return <FileSpreadsheet className={cn(iconClass, "text-green-600")} />;
    case 'image': return <ImageIcon className={cn(iconClass, "text-purple-600")} />;
    case 'video': return <Video className={cn(iconClass, "text-orange-600")} />;
    case 'audio': return <Music className={cn(iconClass, "text-teal-600")} />;
    case 'web': return <Globe className={cn(iconClass, "text-sky-600")} />;
    case 'text':
    case 'text_chunk': return <Type className={cn(iconClass, "text-indigo-600")} />;
    default: return <File className={cn(iconClass, "text-muted-foreground")} />;
  }
};

const getSizeClasses = (size: AssetEmbedProps['size']) => {
  switch (size) {
    case 'small': return 'max-w-xs';
    case 'medium': return 'max-w-md';
    case 'large': return 'max-w-2xl';
    case 'full': return 'w-full';
    default: return 'max-w-md';
  }
};

export default function AssetEmbed({ 
  assetId, 
  mode, 
  size, 
  caption, 
  className, 
  interactive = true,
  onAssetClick 
}: AssetEmbedProps) {
  const [asset, setAsset] = useState<AssetRead | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { getAssetById } = useAssetStore();

  useEffect(() => {
    const loadAsset = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const fetchedAsset = await getAssetById(assetId);
        if (fetchedAsset) {
          setAsset(fetchedAsset);
        } else {
          setError('Asset not found');
        }
      } catch (err) {
        console.error('Error loading asset for embed:', err);
        setError('Failed to load asset');
      } finally {
        setIsLoading(false);
      }
    };

    loadAsset();
  }, [assetId, getAssetById]);

  const handleAssetClick = () => {
    if (asset && onAssetClick && interactive) {
      onAssetClick(asset);
    }
  };

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center p-4 border rounded-lg bg-muted/20", className)}>
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm text-muted-foreground">Loading asset...</span>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className={cn("flex items-center justify-center p-4 border border-dashed border-red-300 rounded-lg bg-red-50", className)}>
        <File className="h-4 w-4 text-red-600 mr-2" />
        <span className="text-sm text-red-600">{error || 'Asset not found'}</span>
      </div>
    );
  }

  // Reference mode - just a link
  if (mode === 'reference') {
    return (
      <button
        onClick={handleAssetClick}
        className={cn(
          "inline-flex items-center gap-1 text-primary hover:underline cursor-pointer",
          !interactive && "cursor-default hover:no-underline",
          className
        )}
        disabled={!interactive}
      >
        {getAssetIcon(asset.kind, "h-3 w-3")}
        <span className="text-sm">{caption || asset.title}</span>
        {interactive && <ExternalLink className="h-3 w-3" />}
      </button>
    );
  }

  // Attachment mode - download link style
  if (mode === 'attachment') {
    return (
      <div className={cn("flex items-center gap-3 p-3 border rounded-lg bg-muted/10", className)}>
        <div className="flex items-center gap-2">
          {getAssetIcon(asset.kind)}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{asset.title}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-xs capitalize">{asset.kind}</Badge>
              <span>{formatDistanceToNow(new Date(asset.updated_at), { addSuffix: true })}</span>
            </div>
          </div>
        </div>
        {interactive && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleAssetClick}>
              <Eye className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Inline mode - minimal display
  if (mode === 'inline') {
    return (
      <span 
        className={cn(
          "inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-md text-sm",
          interactive && "cursor-pointer hover:bg-primary/20",
          className
        )}
        onClick={handleAssetClick}
      >
        {getAssetIcon(asset.kind, "h-3 w-3")}
        <span className="font-medium">{caption || asset.title}</span>
      </span>
    );
  }

  // Card mode - full preview card
  return (
    <Card 
      className={cn(
        "my-4 transition-all",
        getSizeClasses(size),
        interactive && "cursor-pointer hover:shadow-md hover:border-primary/50",
        className
      )}
      onClick={handleAssetClick}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {getAssetIcon(asset.kind)}
          <span className="truncate">{caption || asset.title}</span>
          <Badge variant="outline" className="text-xs capitalize ml-auto">{asset.kind}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Asset Preview */}
        <div className="mb-3">
          <AssetPreview 
            asset={asset} 
            className={cn(
              "w-full rounded border",
              size === 'small' && "h-24",
              size === 'medium' && "h-32", 
              size === 'large' && "h-48",
              size === 'full' && "h-64"
            )} 
          />
        </div>

        {/* Asset Metadata */}
        <div className="space-y-2 text-sm">
          {asset.source_identifier && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Source:</span>
              <a 
                href={asset.source_identifier} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline text-xs truncate flex-1"
                onClick={(e) => e.stopPropagation()}
              >
                {asset.source_identifier}
              </a>
            </div>
          )}
          
          {asset.text_content && mode === 'card' && (
            <div>
              <span className="text-muted-foreground">Preview:</span>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {asset.text_content.substring(0, 150)}...
              </p>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>ID: {asset.id}</span>
            <span>{formatDistanceToNow(new Date(asset.updated_at), { addSuffix: true })}</span>
          </div>
        </div>

        {/* Interactive Actions */}
        {interactive && (
          <div className="flex gap-2 mt-3 pt-3 border-t">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); handleAssetClick(); }}>
              <Eye className="h-3 w-3 mr-1" />
              View Details
            </Button>
            {asset.source_identifier && (
              <Button variant="outline" size="sm" className="h-7 text-xs" asChild onClick={(e) => e.stopPropagation()}>
                <a href={asset.source_identifier} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Open Source
                </a>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
