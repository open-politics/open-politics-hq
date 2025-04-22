import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { FileText, FileSpreadsheet, Link, File } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DataSource } from '@/lib/classification/types';

interface DocumentCardComponentProps {
  items: DataSource[];
  onDataSourceSelect: (dataSource: DataSource) => void;
  selectedDataSourceId: number | null;
}

const getSourceIcon = (type: string) => {
  switch (type) {
    case 'pdf':
    case 'text_block':
      return <FileText className="h-4 w-4 text-primary/80" />;
    case 'csv':
      return <FileSpreadsheet className="h-4 w-4 text-green-600/80" />;
    case 'url_list':
      return <Link className="h-4 w-4 text-blue-600/80" />;
    default:
      return <File className="h-4 w-4 text-muted-foreground" />;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'complete':
      return 'bg-green-500';
    case 'failed':
      return 'bg-red-500';
    case 'processing':
      return 'bg-yellow-500';
    case 'pending':
      return 'bg-blue-500';
    default:
      return 'bg-gray-500';
  }
};

const DocumentCardComponent: React.FC<DocumentCardComponentProps> = React.memo(({ 
  items, 
  onDataSourceSelect, 
  selectedDataSourceId 
}) => {
  return (
    <ScrollArea className="h-full max-w-[100vw]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-2">
        {items.map((item) => (
          <Card
            key={item.id}
            className={cn(
              "flex flex-col items-start rounded-lg p-0 text-left transition-all hover:bg-accent cursor-pointer",
              selectedDataSourceId === item.id && "ring-2 ring-primary ring-offset-1"
            )}
            onClick={() => onDataSourceSelect(item)}
          >
            <CardHeader className="w-full p-3 pb-1">
              <div className="flex items-start gap-2">
                <div className="mt-0.5">{getSourceIcon(item.type)}</div>
                <div className="flex-1 overflow-hidden">
                  <CardTitle className="text-base truncate">{item.name}</CardTitle>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs capitalize font-normal">
                      {item.type.replace('_', ' ')}
                    </Badge>
                    <div className="flex items-center">
                      <div className={`h-2 w-2 rounded-full ${getStatusColor(item.status)} mr-1`}></div>
                      <span className="text-xs text-muted-foreground capitalize">{item.status}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="w-full p-3 pt-1">
              <div className="line-clamp-2 text-xs text-muted-foreground mb-2 h-8">
                {item.source_metadata?.record_count_processed !== undefined
                  ? `Records: ${item.source_metadata.record_count_processed}`
                  : item.origin_details?.filename || 
                    (item.origin_details?.text_content && 
                     `${item.origin_details.text_content.substring(0, 50)}...`) || 
                    'No preview'}
              </div>
              
              <div className="flex flex-wrap gap-1 mt-auto">
                {item.origin_details?.filename && (
                  <Badge variant="outline" className="text-xs">
                    {item.origin_details.filename.length > 25 
                      ? `${item.origin_details.filename.substring(0, 22)}...` 
                      : item.origin_details.filename}
                  </Badge>
                )}
                {item.origin_details?.urls && (
                  <Badge variant="outline" className="text-xs">
                    {item.origin_details.urls.length} URLs
                  </Badge>
                )}
                {(item.source_metadata?.page_count || item.source_metadata?.row_count) && (
                  <Badge variant="secondary" className="text-xs">
                    {item.source_metadata?.page_count ? `${item.source_metadata.page_count} Pages` : ''}
                    {item.source_metadata?.row_count ? `${item.source_metadata.row_count} Rows` : ''}
                  </Badge>
                )}
                {item.created_at && (
                  <div className="text-xs text-muted-foreground ml-auto mt-0.5">
                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
});

DocumentCardComponent.displayName = 'DocumentCardComponent';

export default DocumentCardComponent; 