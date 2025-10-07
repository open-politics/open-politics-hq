import React from 'react';
import { AssetRead } from '@/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Edit2, Globe } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { getArticleSource, getSourceBadgeInfo } from './utils';
import { ArticleMetadata } from './types';
import { cn } from '@/lib/utils';

interface ArticleHeaderProps {
  asset: AssetRead;
  onEdit?: () => void;
  className?: string;
}

export default function ArticleHeader({ asset, onEdit, className }: ArticleHeaderProps) {
  const metadata = asset.source_metadata as ArticleMetadata;
  const source = getArticleSource(asset);
  const badgeInfo = getSourceBadgeInfo(source);
  
  // Get publication date
  const pubDate = metadata?.publication_date || metadata?.rss_published_date;
  const formattedDate = pubDate 
    ? formatDistanceToNow(new Date(pubDate), { addSuffix: true })
    : asset.event_timestamp 
      ? formatDistanceToNow(new Date(asset.event_timestamp), { addSuffix: true })
      : null;
  
  // Get author
  const author = metadata?.author || metadata?.rss_author;
  
  // Get external link
  const externalUrl = asset.source_identifier || metadata?.rss_link;

  return (
    <div className={cn("flex-none px-8 pb-2", className)}>
      {/* Meta Info */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 shrink-0" />
          <Badge variant="outline" className={cn("text-xs", badgeInfo.color)}>
            {badgeInfo.icon} {badgeInfo.label}
          </Badge>
        </div>
        
        {formattedDate && (
          <>
            <span>•</span>
            <span>{formattedDate}</span>
          </>
        )}
        
        {author && (
          <>
            <span>•</span>
            <span>by {author}</span>
          </>
        )}

        {externalUrl && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-3 min-w-[110px] flex items-center justify-center"
            onClick={() => window.open(externalUrl, '_blank')}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            <span>View Original</span>
          </Button>
        )}
      </div>
      
      {/* Title
      <h1 className="text-2xl font-bold leading-tight mb-4 text-foreground break-words">
        {asset.title || 'Untitled Article'}
      </h1> */}
      
      {/* Summary */}
      {metadata?.summary && (
        <p className="text-muted-foreground mb-4 leading-relaxed">
          {metadata.summary}
        </p>
      )}
      
      {/* Tags */}
      {metadata?.rss_tags && metadata.rss_tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {metadata.rss_tags.slice(0, 5).map((tag, idx) => (
            <Badge key={idx} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
      
      {/* Actions */}
      <div className="flex gap-2 mt-4">
        {onEdit && source === 'user' && (
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
          >
            <Edit2 className="h-4 w-4 mr-2" />
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}
