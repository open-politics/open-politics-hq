// frontend/src/components/collection/infospaces/documents/AssetDetailViewCsv.tsx
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, ArrowUp, ArrowDown, FileSpreadsheet, Table as TableIcon, List, X, Copy, Eye, HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from "@/lib/utils";
import { AssetRead } from '@/client';
import { formatDistanceToNow, format } from 'date-fns';
import { Separator } from "@/components/ui/separator";
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FragmentDisplay, FragmentSectionHeader, FragmentCountBadge } from './Fragments';

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
      isNavigatingRef.current = true;
      onChildAssetSelect?.(filteredAndSortedAssets[selectedIndex - 1]);
    }
  };

  const handleGoToNext = () => {
    if (canGoToNext) {
      isNavigatingRef.current = true;
      onChildAssetSelect?.(filteredAndSortedAssets[selectedIndex + 1]);
    }
  };

  // When a user selects a row, that should be the main highlight.
  // The initial `highlightedAssetId` should only apply if nothing is selected.
  const isSelected = (assetId: number) => selectedChildAsset?.id === assetId;
  const isHighlighted = (assetId: number) => 
    !selectedChildAsset && highlightedAssetId === assetId;

  // Refs for scrolling to highlighted/selected rows - separate refs for different view modes
  const highlightedTableRowRef = useRef<HTMLTableRowElement>(null);
  const selectedTableRowRef = useRef<HTMLTableRowElement>(null);
  const highlightedCardRef = useRef<HTMLDivElement>(null);
  const selectedCardRef = useRef<HTMLDivElement>(null);
  
  // Track if navigation came from prev/next buttons to skip auto-scroll
  const isNavigatingRef = useRef(false);

  // Effect to scroll to highlighted asset
  useEffect(() => {
    if (highlightedAssetId) {
      const targetRef = viewMode === 'table' ? highlightedTableRowRef.current : highlightedCardRef.current;
      if (targetRef) {
        // Small delay to ensure rendering is complete
        setTimeout(() => {
          targetRef.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 100);
      }
    }
  }, [highlightedAssetId, viewMode]);

  // Effect to scroll to selected asset (skip if navigating via prev/next buttons)
  useEffect(() => {
    if (selectedChildAsset) {
      // Skip scrolling if navigation came from prev/next buttons
      if (isNavigatingRef.current) {
        isNavigatingRef.current = false;
        return;
      }
      
      const targetRef = viewMode === 'table' ? selectedTableRowRef.current : selectedCardRef.current;
      if (targetRef) {
        // Small delay to ensure rendering is complete
        setTimeout(() => {
          targetRef.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 100);
      }
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

  // Effect to clear search when a new highlight is requested and not visible
  useEffect(() => {
    if (highlightedAssetId && !isHighlightedInView && searchTerm) {
      setSearchTerm('');
      toast.info('Search cleared to show highlighted row.');
    }
  }, [highlightedAssetId, isHighlightedInView, searchTerm]);

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
    <div className="max-h-40 md:max-h-80 w-full overflow-auto">
      <table className="text-sm border-collapse w-full table-fixed" style={{ minWidth: '500px' }}>
        <colgroup>
          <col style={{ width: '50px' }} />
          <col />
        </colgroup>
        <thead className="sticky top-0 bg-muted z-10">
          <tr>
            <th 
              className="px-2 py-2 text-left font-medium text-xs cursor-pointer hover:bg-muted-foreground/10 border-b"
              onClick={() => handleSort('part_index')}
            >
              <div className="flex items-center gap-1 truncate">
                Row
                {renderSortIcon('part_index')}
              </div>
            </th>
            <th className="px-2 py-2 text-left font-medium text-xs border-b"> Aggregated Text Content Preview</th>
          </tr>
        </thead>
        <tbody>
          {filteredAndSortedAssets.length > 0 ? (
            filteredAndSortedAssets.map((childAsset) => {
              const selected = isSelected(childAsset.id);
              const highlighted = isHighlighted(childAsset.id);
              
              return (
                <tr
                  key={childAsset.id}
                  ref={
                    selected ? selectedTableRowRef :
                    highlighted ? highlightedTableRowRef : 
                    undefined
                  }
                  onClick={() => handleRowClick(childAsset)}
                  className={cn(
                    "cursor-pointer hover:bg-muted/50 transition-colors border-b border-border/50",
                    (selected || highlighted) && "bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900 dark:hover:bg-yellow-800"
                  )}
                  style={(selected || highlighted) ? { boxShadow: 'inset 4px 0 0 0 rgb(250 204 21)' } : undefined}
                >
                <td className="px-2 py-2 font-medium border-r border-border/70">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="truncate">{childAsset.part_index !== null ? childAsset.part_index + 1 : childAsset.id}</span>
                    {selected && <Eye className="h-3 w-3 text-yellow-800 dark:text-yellow-300 flex-shrink-0" />}
                    {childAsset.fragments && Object.keys(childAsset.fragments).length > 0 && (
                      <FragmentCountBadge 
                        count={Object.keys(childAsset.fragments).length}
                        className="flex-shrink-0"
                      />
                    )}
                  </div>
                </td>
                  <td className="px-2 py-2">
                    <div className="w-full overflow-hidden">
                      <div className="truncate" title={childAsset.text_content || 'No content'}>
                        {childAsset.text_content || 
                         (childAsset.source_metadata ? JSON.stringify(childAsset.source_metadata).substring(0, 150) + '...' : 'No content')}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={4} className="h-24 text-center text-muted-foreground italic px-2 py-2">
                {searchTerm ? 'No rows found matching your search.' : 'No CSV rows found.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderCardsView = () => (
    <div className="w-full">
      <div className="space-y-3 max-h-80 overflow-auto w-full">
        {filteredAndSortedAssets.length > 0 ? (
          filteredAndSortedAssets.map((childAsset) => {
            const selected = isSelected(childAsset.id);
            const highlighted = isHighlighted(childAsset.id);
            
            return (
              <Card
                key={childAsset.id}
                ref={
                  selected ? selectedCardRef :
                  highlighted ? highlightedCardRef : 
                  undefined
                }
                className={cn(
                  "cursor-pointer transition-colors hover:bg-muted/50 w-full",
                  selected && "border-yellow-500 border-2",
                  highlighted && "border-yellow-400 border-l-4"
                )}
                onClick={() => handleRowClick(childAsset)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={cn(
                      "w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold flex-shrink-0",
                      selected && "bg-yellow-400 text-yellow-900",
                      highlighted && "bg-yellow-100 text-yellow-800"
                    )}>
                      {childAsset.part_index !== null ? childAsset.part_index + 1 : childAsset.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate flex items-center gap-2">
                        <span className="truncate">{childAsset.title || `Row ${childAsset.part_index !== null ? childAsset.part_index + 1 : childAsset.id}`}</span>
                        {selected && <Eye className="h-4 w-4 text-yellow-800 flex-shrink-0" />}
                      </h4>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                        <Badge variant="outline" className="capitalize">{childAsset.kind}</Badge>
                        <span className="whitespace-nowrap">ID: {childAsset.id}</span>
                        <span className="truncate">{formatDistanceToNow(new Date(childAsset.created_at), { addSuffix: true })}</span>
                        {childAsset.fragments && Object.keys(childAsset.fragments).length > 0 && (
                          <FragmentCountBadge 
                            count={Object.keys(childAsset.fragments).length}
                          />
                        )}
                        {highlighted && (
                          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-400">
                            Highlighted
                          </Badge>
                        )}
                      </div>
                      {childAsset.text_content && (
                        <div className="mt-2 max-h-16 overflow-hidden">
                          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed break-words">
                            {childAsset.text_content}
                          </p>
                        </div>
                      )}
                      {childAsset.source_metadata && Object.keys(childAsset.source_metadata).length > 0 && (
                        <div className="mt-2 min-w-0">
                          <ScrollArea className="max-h-20 w-full">
                            <pre className="text-xs bg-muted/50 p-2 rounded overflow-auto break-all">
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
      <Card className="mt-4 max-w-5xl mx-auto border-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 absolute bottom-3 right-4 z-10 bg-background/95 backdrop-blur-sm py-2 px-3 rounded-lg shadow-sm">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div className="min-w-0">
              <strong className="text-muted-foreground">Asset ID:</strong>
              <div className="font-mono truncate">{selectedChildAsset.id}</div>
            </div>
            <div className="min-w-0">
              <strong className="text-muted-foreground">UUID:</strong>
              <div className="font-mono text-xs truncate" title={selectedChildAsset.uuid}>{selectedChildAsset.uuid}</div>
            </div>
            <div className="min-w-0">
              <strong className="text-muted-foreground">Kind:</strong>
              <div><Badge variant="outline">{selectedChildAsset.kind}</Badge></div>
            </div>
            <div className="min-w-0">
              <strong className="text-muted-foreground">Row Position:</strong>
              <div className="font-semibold">{selectedChildAsset.part_index !== null ? selectedChildAsset.part_index + 1 : 'N/A'}</div>
            </div>
          </div>




          {/* Fragments Data */}
          {selectedChildAsset.fragments && Object.keys(selectedChildAsset.fragments).length > 0 && (
            <div>
              <FragmentSectionHeader count={Object.keys(selectedChildAsset.fragments).length} />
              <FragmentDisplay 
                fragments={selectedChildAsset.fragments as Record<string, any>}
                viewMode="full"
              />
            </div>
          )}

          <Separator />

          {/* Column Data */}
          {columnNames.length > 0 && (
            <div>
              <div className="grid gap-3 w-full">
                {columnNames.map((columnName, index) => (
                  <div key={index} className="border rounded-lg p-3 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <strong className="text-sm text-muted-foreground truncate flex-1 min-w-0" title={columnName}>{columnName}</strong>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(String(rowData[columnName] || ''));
                          toast.success(`Copied "${columnName}" value`);
                        }}
                        className="h-6 px-2 text-xs flex-shrink-0"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="text-sm bg-muted/30 p-2 rounded font-mono break-all w-full overflow-x-auto">
                      {String(rowData[columnName] || '')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          

          {/* Timestamps */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="min-w-0">
              <strong className="text-muted-foreground">Created:</strong>
              <div className="truncate" title={format(new Date(selectedChildAsset.created_at), "PPp")}>
                {format(new Date(selectedChildAsset.created_at), "PPp")}
              </div>
            </div>
            {selectedChildAsset.updated_at && (
              <div className="min-w-0">
                <strong className="text-muted-foreground">Updated:</strong>
                <div className="truncate" title={format(new Date(selectedChildAsset.updated_at), "PPp")}>
                  {format(new Date(selectedChildAsset.updated_at), "PPp")}
                </div>
              </div>
            )}
            {selectedChildAsset.event_timestamp ? (
              <div className="min-w-0">
                <strong className="text-muted-foreground">Event Timestamp:</strong>
                <div className="truncate" title={format(new Date(selectedChildAsset.event_timestamp), "PPp")}>
                  {format(new Date(selectedChildAsset.event_timestamp), "PPp")}
                </div>
              </div>
            ) : (
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3 w-3 flex-shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>This field is the time reference point of what is discussed for this asset.
                        It can be annotated with a timestamp, but it can also be a time reference point for the asset.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <strong className="text-muted-foreground">Event Timestamp:</strong>
                </div>
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
    <div className="space-y-4 h-full flex flex-col max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-end gap-4">
        <div className="flex items-center gap-2">
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
      <div className="relative w-full max-w-md border border-primary/20 rounded-md p-1">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search CSV rows..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 w-full max-w-4xl mx-auto">
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
          <div className="w-full max-w-full">
            {viewMode === 'table' ? renderTableView() : renderCardsView()}
            {renderSelectedRowDetail()}
          </div>
        )}
      </div>
    </div>
  );
};

export default AssetDetailViewCsv;