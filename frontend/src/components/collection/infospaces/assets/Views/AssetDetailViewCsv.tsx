// frontend/src/components/collection/infospaces/documents/AssetDetailViewCsv.tsx
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, ArrowUp, ArrowDown, FileSpreadsheet, Table as TableIcon, List, X, Copy, Download, Share2, Eye, ExternalLink, HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from "@/lib/utils";
import { AssetRead } from '@/client/models';
import { formatDistanceToNow, format } from 'date-fns';
import { Separator } from "@/components/ui/separator";
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface AssetDetailViewCsvProps {
  asset: AssetRead;
  childAssets: AssetRead[];
  isLoadingChildren: boolean;
  childrenError: string | null;
  onChildAssetSelect?: (childAsset: AssetRead) => void;
  selectedChildAsset?: AssetRead | null;
  highlightedAssetId?: number | null;
}

const AssetDetailViewCsv: React.FC<AssetDetailViewCsvProps> = ({
  asset,
  childAssets = [],
  isLoadingChildren,
  childrenError,
  onChildAssetSelect,
  selectedChildAsset,
  highlightedAssetId,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<string>('part_index');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Filter and sort child assets
  const filteredAndSortedAssets = useMemo(() => {
    let filtered = childAssets;

    // Filter by search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = childAssets.filter(child => 
        child.title?.toLowerCase().includes(term) ||
        child.text_content?.toLowerCase().includes(term) ||
        child.id.toString().includes(term) ||
        JSON.stringify(child.source_metadata || {}).toLowerCase().includes(term)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let aValue: any, bValue: any;

      switch (sortField) {
        case 'part_index':
          aValue = a.part_index ?? 999999;
          bValue = b.part_index ?? 999999;
          break;
        case 'title':
          aValue = a.title || '';
          bValue = b.title || '';
          break;
        case 'created_at':
          aValue = new Date(a.created_at);
          bValue = new Date(b.created_at);
          break;
        default:
          aValue = a.id;
          bValue = b.id;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [childAssets, searchTerm, sortField, sortDirection]);


  const selectedIndex = useMemo(() => {
    if (!selectedChildAsset) return -1;
    return filteredAndSortedAssets.findIndex(asset => asset.id === selectedChildAsset.id);
  }, [selectedChildAsset, filteredAndSortedAssets]);

  const canGoToPrevious = selectedIndex > 0;
  const canGoToNext = selectedIndex !== -1 && selectedIndex < filteredAndSortedAssets.length - 1;

  const handleGoToPrevious = () => {
    if (canGoToPrevious) {
      onChildAssetSelect?.(filteredAndSortedAssets[selectedIndex - 1]);
    }
  };

  const handleGoToNext = () => {
    if (canGoToNext) {
      onChildAssetSelect?.(filteredAndSortedAssets[selectedIndex + 1]);
    }
  };

  // When a user selects a row, that should be the main highlight.
  // The initial `highlightedAssetId` should only apply if nothing is selected.
  const isSelected = (assetId: number) => selectedChildAsset?.id === assetId;
  const isHighlighted = (assetId: number) => 
    !selectedChildAsset && highlightedAssetId === assetId;

  // Ref for scrolling to highlighted row
  const highlightedRowRef = useRef<HTMLElement>(null);
  const selectedRowRef = useRef<HTMLElement>(null);

  // Effect to scroll to highlighted asset
  useEffect(() => {
    if (highlightedAssetId && highlightedRowRef.current) {
      // Small delay to ensure rendering is complete
      setTimeout(() => {
        highlightedRowRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 100);
    }
  }, [highlightedAssetId, viewMode]);

  // Effect to scroll to selected asset
  useEffect(() => {
    if (selectedChildAsset && selectedRowRef.current) {
      // Small delay to ensure rendering is complete
      setTimeout(() => {
        selectedRowRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 100);
    }
  }, [selectedChildAsset, viewMode]);

  
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleRowClick = (childAsset: AssetRead) => {
    onChildAssetSelect?.(childAsset);
  };

  const renderSortIcon = (field: string) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  // Check if highlighted asset is in filtered results
  const isHighlightedInView = highlightedAssetId 
    ? filteredAndSortedAssets.some(asset => asset.id === highlightedAssetId)
    : false;

  const handleCopyRowData = (childAsset: AssetRead) => {
    const rowData = childAsset.source_metadata?.original_row_data;
    if (rowData) {
      const csvString = Object.values(rowData).join(',');
      navigator.clipboard.writeText(csvString);
      toast.success('Row data copied to clipboard');
    } else {
      navigator.clipboard.writeText(childAsset.text_content || '');
      toast.success('Row content copied to clipboard');
    }
  };

  const renderTableView = () => (
    <div className="border rounded-md max-h-64 max-w-full overflow-auto  scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-muted-foreground/10">
      <div className="overflow-auto h-full">
        <Table className="text-sm w-full" style={{ tableLayout: 'fixed', width: '100%' }}>
          <TableHeader className="sticky top-0 bg-muted z-10">
            <TableRow>
              <TableHead 
                className="w-[100px] cursor-pointer hover:bg-muted-foreground/10"
                onClick={() => handleSort('part_index')}
              >
                <div className="flex items-center gap-1">
                  Row #
                  {renderSortIcon('part_index')}
                </div>
              </TableHead>
              <TableHead 
                className="w-[250px] cursor-pointer hover:bg-muted-foreground/10"
                onClick={() => handleSort('title')}
              >
                <div className="flex items-center gap-1">
                  Title
                  {renderSortIcon('title')}
                </div>
              </TableHead>
              <TableHead>Content Preview</TableHead>
              <TableHead 
                className="w-[150px] cursor-pointer hover:bg-muted-foreground/10"
                onClick={() => handleSort('created_at')}
              >
                <div className="flex items-center gap-1">
                  Created
                  {renderSortIcon('created_at')}
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedAssets.length > 0 ? (
              filteredAndSortedAssets.map((childAsset) => {
                const selected = isSelected(childAsset.id);
                const highlighted = isHighlighted(childAsset.id);
                
                return (
                  <TableRow
                    key={childAsset.id}
                    ref={
                      selected ? (selectedRowRef as React.RefObject<HTMLTableRowElement>) :
                      highlighted ? (highlightedRowRef as React.RefObject<HTMLTableRowElement>) : 
                      undefined
                    }
                    onClick={() => handleRowClick(childAsset)}
                    className={cn(
                      "cursor-pointer hover:bg-muted/50 transition-colors",
                      (selected || highlighted) && "bg-yellow-50 hover:bg-yellow-100 border-l-4 border-yellow-400 dark:bg-yellow-900 dark:hover:bg-yellow-800"
                    )}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2 truncate">
                        {childAsset.part_index !== null ? childAsset.part_index + 1 : childAsset.id}
                        {selected && <Eye className="h-3 w-3 text-yellow-800 dark:text-yellow-300 flex-shrink-0" />}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium truncate" title={childAsset.title || ''}>
                      {childAsset.title || `Row ${childAsset.part_index !== null ? childAsset.part_index + 1 : childAsset.id}`}
                    </TableCell>
                    <TableCell className="max-w-0">
                      <div className="truncate" title={childAsset.text_content || 'No content'}>
                        {childAsset.text_content || 
                         (childAsset.source_metadata ? JSON.stringify(childAsset.source_metadata).substring(0, 100) + '...' : 'No content')}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs truncate">
                      {formatDistanceToNow(new Date(childAsset.created_at), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground italic">
                  {searchTerm ? 'No rows found matching your search.' : 'No CSV rows found.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const renderCardsView = () => (
    <div className="max-h-[calc(100vh-400px)] overflow-auto">
      <div className="space-y-3 pr-2">
        {filteredAndSortedAssets.length > 0 ? (
          filteredAndSortedAssets.map((childAsset) => {
            const selected = isSelected(childAsset.id);
            const highlighted = isHighlighted(childAsset.id);
            
            return (
              <Card
                key={childAsset.id}
                ref={
                  selected ? (selectedRowRef as React.RefObject<HTMLDivElement>) :
                  highlighted ? (highlightedRowRef as React.RefObject<HTMLDivElement>) : 
                  undefined
                }
                className={cn(
                  "cursor-pointer transition-colors hover:bg-muted/50",
                  selected && "bg-yellow-50 border-yellow-500 border-2",
                  highlighted && "bg-yellow-50 border-yellow-400 border-l-4"
                )}
                onClick={() => handleRowClick(childAsset)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold flex-shrink-0",
                      selected && "bg-yellow-400 text-yellow-900",
                      highlighted && "bg-yellow-100 text-yellow-800"
                    )}>
                      {childAsset.part_index !== null ? childAsset.part_index + 1 : childAsset.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate flex items-center gap-2">
                        {childAsset.title || `Row ${childAsset.part_index !== null ? childAsset.part_index + 1 : childAsset.id}`}
                        {selected && <Eye className="h-4 w-4 text-yellow-800" />}
                      </h4>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                        <Badge variant="outline" className="capitalize">{childAsset.kind}</Badge>
                        <span>ID: {childAsset.id}</span>
                        <span>{formatDistanceToNow(new Date(childAsset.created_at), { addSuffix: true })}</span>
                        {highlighted && (
                          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-400">
                            Highlighted
                          </Badge>
                        )}
                      </div>
                      {childAsset.text_content && (
                        <div className="mt-2 max-h-16 overflow-hidden">
                          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                            {childAsset.text_content}
                          </p>
                        </div>
                      )}
                      {childAsset.source_metadata && Object.keys(childAsset.source_metadata).length > 0 && (
                        <div className="mt-2">
                          <ScrollArea className="max-h-20">
                            <pre className="text-xs bg-muted/50 p-2 rounded overflow-auto">
                              {JSON.stringify(childAsset.source_metadata, null, 2)}
                            </pre>
                          </ScrollArea>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="text-center py-8 text-muted-foreground italic">
            {searchTerm ? 'No rows found matching your search.' : 'No CSV rows found.'}
          </div>
        )}
      </div>
    </div>
  );

  const renderSelectedRowDetail = () => {
    if (!selectedChildAsset) return null;

    const rowData = selectedChildAsset.source_metadata?.original_row_data || {};
    const columnNames = Object.keys(rowData);

    return (
      <Card className="mt-4 border-primary/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              Row Details: {selectedChildAsset.title || `Row ${selectedChildAsset.part_index !== null ? selectedChildAsset.part_index + 1 : selectedChildAsset.id}`}
            </CardTitle>
            <div className="flex items-center gap-1">
              {/* Navigation */}
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={handleGoToPrevious}
                disabled={!canGoToPrevious}
                title="Previous Row"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={handleGoToNext}
                disabled={!canGoToNext}
                title="Next Row"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              <Separator orientation="vertical" className="h-5 mx-1" />

              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopyRowData(selectedChildAsset)}
                className="h-7 px-2"
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onChildAssetSelect?.(selectedChildAsset)}
                className="h-7 w-7 text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Basic Asset Information */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <strong className="text-muted-foreground">Asset ID:</strong>
              <div className="font-mono">{selectedChildAsset.id}</div>
            </div>
            <div>
              <strong className="text-muted-foreground">UUID:</strong>
              <div className="font-mono text-xs truncate">{selectedChildAsset.uuid}</div>
            </div>
            <div>
              <strong className="text-muted-foreground">Kind:</strong>
              <div><Badge variant="outline">{selectedChildAsset.kind}</Badge></div>
            </div>
            <div>
              <strong className="text-muted-foreground">Row Position:</strong>
              <div className="font-semibold">{selectedChildAsset.part_index !== null ? selectedChildAsset.part_index + 1 : 'N/A'}</div>
            </div>
          </div>

          <Separator />

          {/* Column Data */}
          {columnNames.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-3 text-muted-foreground flex items-center gap-2">
                <TableIcon className="h-4 w-4" />
                Column Data ({columnNames.length} columns)
              </h4>
              <div className="grid gap-3">
                {columnNames.map((columnName, index) => (
                  <div key={index} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <strong className="text-sm text-muted-foreground truncate" title={columnName}>{columnName}</strong>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(String(rowData[columnName] || ''));
                          toast.success(`Copied "${columnName}" value`);
                        }}
                        className="h-6 px-2 text-xs"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="text-sm bg-muted/30 p-2 rounded font-mono break-all max-w-full overflow-x-auto">
                      {String(rowData[columnName] || '')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full Text Content */}
          {selectedChildAsset.text_content && (
            <div>
              <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Full Content</h4>
              <ScrollArea className="h-32 p-3 bg-muted/30 rounded text-sm font-mono">
                {selectedChildAsset.text_content}
              </ScrollArea>
            </div>
          )}

          {/* Timestamps */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <strong className="text-muted-foreground">Created:</strong>
              <div>{format(new Date(selectedChildAsset.created_at), "PPp")}</div>
            </div>
            {selectedChildAsset.updated_at && (
              <div>
                <strong className="text-muted-foreground">Updated:</strong>
                <div>{format(new Date(selectedChildAsset.updated_at), "PPp")}</div>
              </div>
            )}
            {selectedChildAsset.event_timestamp ? (
              <div>
                <strong className="text-muted-foreground">Event Timestamp:</strong>
                <div>{format(new Date(selectedChildAsset.event_timestamp), "PPp")}</div>
              </div>
            ) : (
              <div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>This field is the time reference point of what is discussed for this asset.
                      It can be annotated with a timestamp, but it can also be a time reference point for the asset.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <strong className="text-muted-foreground">Event Timestamp:</strong>
                <div>N/A</div>
              </div>
            )}
          </div>

          {/* Raw Metadata */}
          {selectedChildAsset.source_metadata && Object.keys(selectedChildAsset.source_metadata).length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Raw Metadata</h4>
              <ScrollArea className="h-24 p-3 bg-muted/30 rounded">
                <pre className="text-xs">
                  {JSON.stringify(selectedChildAsset.source_metadata, null, 2)}
                </pre>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">CSV Rows</h3>
          <Badge variant="outline">
            {filteredAndSortedAssets.length} of {childAssets.length} rows
          </Badge>
          {selectedChildAsset && (
            <Badge variant="default" className="bg-primary/10 text-primary border-primary">
              Row {selectedChildAsset.part_index !== null ? selectedChildAsset.part_index + 1 : selectedChildAsset.id} Selected
            </Badge>
          )}
          {highlightedAssetId && (
            <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-400">
              Highlighting Row ID: {highlightedAssetId}
            </Badge>
          )}
          {highlightedAssetId && !isHighlightedInView && (
            <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-400">
              Highlighted row not in current view
            </Badge>
          )}
          {highlightedAssetId && !isHighlightedInView && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchTerm('')}
              className="h-7 px-2 text-xs"
            >
              Show Highlighted
            </Button>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === 'table' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('table')}
          >
            <TableIcon className="h-4 w-4 mr-1" />
            Table
          </Button>
          <Button
            variant={viewMode === 'cards' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('cards')}
          >
            <List className="h-4 w-4 mr-1" />
            Cards
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md border border-primary/20 rounded-md p-1">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search CSV rows..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto max-w-4xl mx-auto">
        {isLoadingChildren ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Loading CSV rows...</span>
          </div>
        ) : childrenError ? (
          <div className="text-center py-8 text-red-600">
            Error loading CSV rows: {childrenError}
          </div>
        ) : (
          <>
            {viewMode === 'table' ? renderTableView() : renderCardsView()}
            {renderSelectedRowDetail()}
          </>
        )}
      </div>
    </div>
  );
};

export default AssetDetailViewCsv;