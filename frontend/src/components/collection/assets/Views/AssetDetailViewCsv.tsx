// frontend/src/components/collection/assets/Views/AssetDetailViewCsv.tsx
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Loader2, Search, ArrowUp, ArrowDown, X, Copy, Eye, HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from "@/lib/utils";
import { AssetRead } from '@/client';
import { format } from 'date-fns';
import { Separator } from "@/components/ui/separator";
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FragmentDisplay, FragmentSectionHeader, FragmentCountBadge } from './Fragments';
import type { CsvRowListItem } from './AssetDetailView';

function csvRowPreviewFromItem(item: CsvRowListItem, maxLen = 220): string {
  const data = item.originalRowData;
  if (!data || Object.keys(data).length === 0) return item.name || '';
  const parts = Object.entries(data).map(([k, v]) => `${k}: ${v}`);
  const full = parts.join(' · ');
  return full.length > maxLen ? full.slice(0, maxLen) + '…' : full;
}

interface AssetDetailViewCsvProps {
  asset: AssetRead;
  items: CsvRowListItem[];
  total: number | null;
  hasMore: boolean;
  isLoading: boolean;
  childrenError: string | null;
  onRowSelect: (item: CsvRowListItem) => void;
  onLoadMore: () => void;
  selectedChildAsset?: AssetRead | null;
  highlightedAssetId?: number | null;
  rowListSearchTerm: string;
  onRowListSearchTermChange: (value: string) => void;
}

const AssetDetailViewCsv: React.FC<AssetDetailViewCsvProps> = ({
  asset,
  items = [],
  total,
  hasMore,
  isLoading,
  childrenError,
  onRowSelect,
  onLoadMore,
  selectedChildAsset,
  highlightedAssetId,
  rowListSearchTerm,
  onRowListSearchTermChange,
}) => {
  const [sortField, setSortField] = useState<string>('part_index');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnSearchTerm, setColumnSearchTerm] = useState('');
  const [columnMatchIndex, setColumnMatchIndex] = useState(0);
  const columnCardRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const rowSearchTermRef = useRef(rowListSearchTerm);
  rowSearchTermRef.current = rowListSearchTerm;

  // Items come pre-filtered from backend; only do local sort
  const sortedItems = useMemo(() => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      let aVal: string | number = sortField === 'part_index' ? a.partIndex : a.name;
      let bVal: string | number = sortField === 'part_index' ? b.partIndex : b.name;
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [items, sortField, sortDirection]);

  const selectedIndex = useMemo(() => {
    if (!selectedChildAsset) return -1;
    return sortedItems.findIndex(item => item.assetId === selectedChildAsset.id);
  }, [selectedChildAsset, sortedItems]);

  const canGoToPrevious = selectedIndex > 0;
  const canGoToNext = selectedIndex !== -1 && selectedIndex < sortedItems.length - 1;

  const isNavigatingRef = useRef(false);

  const handleGoToPrevious = () => {
    if (canGoToPrevious) {
      isNavigatingRef.current = true;
      onRowSelect(sortedItems[selectedIndex - 1]);
    }
  };

  const handleGoToNext = () => {
    if (canGoToNext) {
      isNavigatingRef.current = true;
      onRowSelect(sortedItems[selectedIndex + 1]);
    }
  };

  const isSelected = (assetId: number) => selectedChildAsset?.id === assetId;
  const isHighlighted = (assetId: number) =>
    !selectedChildAsset && highlightedAssetId === assetId;

  const highlightedTableRowRef = useRef<HTMLTableRowElement>(null);
  const selectedTableRowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (highlightedAssetId && highlightedTableRowRef.current) {
      setTimeout(() => {
        highlightedTableRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [highlightedAssetId]);

  useEffect(() => {
    if (selectedChildAsset) {
      if (isNavigatingRef.current) { isNavigatingRef.current = false; return; }
      if (selectedTableRowRef.current) {
        setTimeout(() => {
          selectedTableRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    }
  }, [selectedChildAsset]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const renderSortIcon = (field: string) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  // Carry over row search term to column search when a new row is selected
  useEffect(() => {
    if (selectedChildAsset?.id != null) {
      setColumnSearchTerm(rowSearchTermRef.current);
      setColumnMatchIndex(0);
    }
  }, [selectedChildAsset?.id]);

  // Reset match index when column search changes
  useEffect(() => { setColumnMatchIndex(0); }, [columnSearchTerm]);

  // Compute matching column indices
  const columnMatches = useMemo(() => {
    if (!selectedChildAsset || !columnSearchTerm.trim()) return [];
    const rowData = (selectedChildAsset.file_info?.original_row_data as Record<string, unknown>) || {};
    const columns = Object.keys(rowData);
    const term = columnSearchTerm.toLowerCase();
    return columns.reduce<number[]>((acc, col, i) => {
      if (col.toLowerCase().includes(term) || String(rowData[col] ?? '').toLowerCase().includes(term)) acc.push(i);
      return acc;
    }, []);
  }, [selectedChildAsset, columnSearchTerm]);

  // Scroll active column match into view
  useEffect(() => {
    if (columnMatches.length > 0) {
      const el = columnCardRefs.current.get(columnMatches[columnMatchIndex]);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [columnMatchIndex, columnMatches]);

  const highlightText = useCallback((text: string, term: string): React.ReactNode => {
    if (!term.trim()) return text;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === term.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded-sm px-0.5">{part}</mark>
        : part
    );
  }, []);

  const handleColumnSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && columnMatches.length > 0) {
      e.preventDefault();
      setColumnMatchIndex((prev) => (prev + 1) % columnMatches.length);
    }
  }, [columnMatches]);

  const handleRowSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && sortedItems.length > 0) {
      e.preventDefault();
      const nextIdx = selectedIndex === -1 ? 0 : (selectedIndex + 1) % sortedItems.length;
      isNavigatingRef.current = true;
      onRowSelect(sortedItems[nextIdx]);
    }
  }, [sortedItems, selectedIndex, onRowSelect]);

  const handleCopyRowData = (childAsset: AssetRead) => {
    const rowData = childAsset.file_info?.original_row_data as Record<string, unknown> | undefined;
    if (rowData) {
      const csvString = Object.values(rowData).join(',');
      navigator.clipboard.writeText(csvString);
      toast.success('Row data copied to clipboard');
    } else {
      navigator.clipboard.writeText(childAsset.text_content || '');
      toast.success('Row content copied to clipboard');
    }
  };

  const renderRowListTable = () => (
    <div className="mt-2 w-full min-w-0 max-h-[min(22vh,11rem)] overflow-auto rounded-md border border-border bg-background sm:max-h-[min(26vh,13rem)] scrollbar-hide">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
          <tr>
            <th
              className="w-14 shrink-0 cursor-pointer whitespace-nowrap border-b px-2 py-2 text-left text-xs font-medium hover:bg-muted-foreground/10"
              onClick={() => handleSort('part_index')}
            >
              <div className="flex items-center gap-1">
                #
                {renderSortIcon('part_index')}
              </div>
            </th>
            <th className="min-w-0 border-b px-2 py-2 text-left text-xs font-medium">Row preview</th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.length > 0 ? (
            sortedItems.map((item) => {
              const selected = isSelected(item.assetId);
              const highlighted = isHighlighted(item.assetId);

              return (
                <tr
                  key={item.assetId}
                  ref={
                    selected
                      ? selectedTableRowRef
                      : highlighted
                        ? highlightedTableRowRef
                        : undefined
                  }
                  onClick={() => onRowSelect(item)}
                  className={cn(
                    'cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/50',
                    (selected || highlighted) &&
                      'bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900 dark:hover:bg-yellow-800'
                  )}
                  style={
                    selected || highlighted
                      ? { boxShadow: 'inset 4px 0 0 0 rgb(250 204 21)' }
                      : undefined
                  }
                >
                  <td className="w-14 shrink-0 whitespace-nowrap border-r border-border/50 px-2 py-2 font-medium">
                    <div className="flex items-center gap-1">
                      <span>{item.partIndex + 1}</span>
                      {selected && (
                        <Eye className="h-3 w-3 shrink-0 text-yellow-800 dark:text-yellow-300" />
                      )}
                    </div>
                  </td>
                  <td className="min-w-0 max-w-0 px-2 py-2">
                    <div className="truncate text-muted-foreground" title={csvRowPreviewFromItem(item, 500)}>
                      {item.highlight ? (
                        <span dangerouslySetInnerHTML={{ __html: item.highlight }} />
                      ) : (
                        csvRowPreviewFromItem(item, 220)
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={2} className="h-24 px-2 py-2 text-center italic text-muted-foreground">
                {rowListSearchTerm.trim() ? 'No rows found matching your search.' : 'No CSV rows found.'}
              </td>
            </tr>
          )}
          {/* Load more */}
          {hasMore && (
            <tr>
              <td colSpan={2} className="px-2 py-2 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLoadMore}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Loading...</>
                  ) : (
                    `Load more (showing ${items.length}${total != null ? ` of ${total}` : ''})`
                  )}
                </Button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderSelectedRowDetail = () => {
    if (!selectedChildAsset) return null;

    const rowData = (selectedChildAsset.file_info?.original_row_data as Record<string, unknown>) || {};
    const columnNames = Object.keys(rowData);

    return (
      <Card className="mx-auto border-none">
        <CardHeader className="!p-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 absolute bottom-3 right-4 z-10 bg-background/95 backdrop-blur-sm py-2 px-3 rounded-lg shadow-sm">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={handleGoToPrevious} disabled={!canGoToPrevious} title="Previous Row">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={handleGoToNext} disabled={!canGoToNext} title="Next Row">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleCopyRowData(selectedChildAsset)} className="h-7 px-2">
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </Button>
              <Button variant="ghost" size="icon" onClick={() => { /* deselect by clicking same row */ }} className="h-7 w-7 text-muted-foreground">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 !p-0">
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

          {columnNames.length > 0 && (
            <div>
              <div className="relative w-full min-w-0 max-w-full shrink-0 sm:max-w-md">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search columns…"
                  value={columnSearchTerm}
                  onChange={(e) => setColumnSearchTerm(e.target.value)}
                  onKeyDown={handleColumnSearchKeyDown}
                  className="h-9 bg-background pl-8 pr-16 shadow-none focus-visible:ring-0"
                />
                {columnSearchTerm.trim() && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    {columnMatches.length > 0
                      ? `${columnMatchIndex + 1}/${columnMatches.length}`
                      : 'No matches'}
                  </span>
                )}
              </div>
              <div className="grid gap-3 w-full mt-3">
                {columnNames.map((columnName, index) => {
                  const isMatch = columnMatches.includes(index);
                  const colTerm = columnSearchTerm.trim();

                  return (
                    <div
                      key={index}
                      ref={(el) => { columnCardRefs.current.set(index, el); }}
                      className={cn(
                        "border rounded-lg p-3 min-w-0 transition-all",
                        colTerm && !isMatch && "opacity-40",
                        isMatch && "border-yellow-400 dark:border-yellow-600 bg-yellow-50/50 dark:bg-yellow-900/20"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <strong className="text-sm text-muted-foreground truncate flex-1 min-w-0" title={columnName}>
                          {colTerm ? highlightText(columnName, colTerm) : columnName}
                        </strong>
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
                      <div className="text-sm bg-muted/30 p-2 rounded break-all w-full overflow-x-auto">
                        {colTerm ? highlightText(String(rowData[columnName] || ''), colTerm) : String(rowData[columnName] || '')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm px-2">
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
                        <p>This field is the time reference point of what is discussed for this asset.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <strong className="text-muted-foreground">Event Timestamp:</strong>
                </div>
                <div>N/A</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden">
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        {isLoading && items.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Loading CSV rows...</span>
          </div>
        ) : childrenError ? (
          <div className="py-8 text-center text-red-600">
            Error loading CSV rows: {childrenError}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
            <div className="relative w-full min-w-0 max-w-full shrink-0 sm:max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search rows…"
                value={rowListSearchTerm}
                onChange={(e) => onRowListSearchTermChange(e.target.value)}
                onKeyDown={handleRowSearchKeyDown}
                className="h-9 bg-background pl-8 shadow-none focus-visible:ring-0"
              />
            </div>
            {(total == null || total > 0) && (
              <div className="mt-1 text-xs text-muted-foreground px-1">
                {total == null
                  ? `${items.length} rows loaded...`
                  : rowListSearchTerm.trim()
                    ? `${total} result${total !== 1 ? 's' : ''} found`
                    : `${items.length} of ${total} rows loaded`}
              </div>
            )}
            {renderRowListTable()}
            {renderSelectedRowDetail()}
          </div>
        )}
      </div>
    </div>
  );
};

export default AssetDetailViewCsv;
