import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Loader2, Save, Download, FileSpreadsheet, Undo2, Search, ChevronUp, ChevronDown, Eye } from 'lucide-react';
import { cn } from "@/lib/utils";
import { toast } from 'sonner';
import { AssetsService } from '@/client/sdk.gen';
import type { AssetRead } from '@/client';
import {
  gridDataRowIndexToPartIndex,
  isBackendNonEmptyCsvGridRow,
  partIndexToGridDataRowIndex,
} from './csvChildHelpers';

interface EditableCsvViewerProps {
  blobPath: string;
  title: string;
  assetId: number;
  infospaceId: number;
  className?: string;
  onSaveSuccess?: () => void;
  fetchMediaBlob: (blobPath: string) => Promise<string | null>;
  /** csv_row children — used to scroll/highlight the grid row when opening from Rows tab (part_index ↔ data row index). */
  rowChildAssets?: AssetRead[];
  /** Backend `part_index` for the row’s csv_row child (non-empty data rows only; see CSV processor). */
  onOpenCsvRow?: (partIndex: number) => void;
  /**
   * If set, must be a **csv_row child** id present in `rowChildAssets` (not the parent CSV id).
   * Scrolls the grid to that row’s `part_index`.
   */
  workspaceHighlightChildId?: number | null;
}

interface ColumnDef {
  key: string;
  name: string;
  width?: number;
}

const EditableCsvViewer: React.FC<EditableCsvViewerProps> = ({
  blobPath,
  title,
  assetId,
  infospaceId,
  className,
  onSaveSuccess,
  fetchMediaBlob,
  rowChildAssets = [],
  onOpenCsvRow,
  workspaceHighlightChildId = null,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [csvText, setCsvText] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [originalCsvText, setOriginalCsvText] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ rowIdx: number; columnKey: string } | null>(null);
  const [cellEditValue, setCellEditValue] = useState<string>('');
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; columnKey: string } | null>(null);
  /** Data row index for “Rows tab” when user clicks # column (no cell editor). */
  const [workspaceRowIdx, setWorkspaceRowIdx] = useState<number | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  const [matchCursor, setMatchCursor] = useState(0);
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});

  const { matchRowIndices, matchColumnKeysByRow, matchCount } = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q || rows.length === 0) {
      return {
        matchRowIndices: [] as number[],
        matchColumnKeysByRow: {} as Record<number, string[]>,
        matchCount: 0,
      };
    }
    const dataCols = columns.filter((c) => c.key !== 'rowNum');
    const indices: number[] = [];
    const colByRow: Record<number, string[]> = {};
    rows.forEach((row, rowIdx) => {
      const matchingCols: string[] = [];
      for (const c of dataCols) {
        if (String(row[c.key] ?? '').toLowerCase().includes(q)) matchingCols.push(c.key);
      }
      if (matchingCols.length > 0) {
        indices.push(rowIdx);
        colByRow[rowIdx] = matchingCols;
      }
    });
    return { matchRowIndices: indices, matchColumnKeysByRow: colByRow, matchCount: indices.length };
  }, [rows, columns, tableSearch]);

  useEffect(() => {
    setMatchCursor(0);
  }, [tableSearch]);

  useEffect(() => {
    if (matchRowIndices.length === 0) return;
    const safe = Math.min(matchCursor, matchRowIndices.length - 1);
    const rowIdx = matchRowIndices[safe];
    rowRefs.current[rowIdx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [matchRowIndices, matchCursor]);

  const rowEmptinessKey = useMemo(
    () =>
      rows
        .map((r) => (isBackendNonEmptyCsvGridRow(r as Record<string, unknown>) ? '1' : '0'))
        .join(''),
    [rows]
  );

  useEffect(() => {
    if (!workspaceHighlightChildId || rowChildAssets.length === 0 || rows.length === 0) return;
    const child = rowChildAssets.find((c) => c.id === workspaceHighlightChildId);
    if (!child || child.part_index == null) return;
    const partIdx = Number(child.part_index);
    if (!Number.isFinite(partIdx) || partIdx < 0) return;
    const gridIdx = partIndexToGridDataRowIndex(rows as Record<string, unknown>[], partIdx);
    if (gridIdx == null) return;
    setWorkspaceRowIdx(gridIdx);
    requestAnimationFrame(() => {
      rowRefs.current[gridIdx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mapping uses only emptiness pattern; omit `rows` to avoid re-scroll on every cell edit
  }, [workspaceHighlightChildId, rowChildAssets, rows.length, rowEmptinessKey]);

  // Load and parse CSV
  useEffect(() => {
    const loadCSV = async () => {
      console.log(`[EditableCsvViewer] Loading CSV from blobPath: ${blobPath}`);
      setIsLoading(true);
      setHasError(false);
      setErrorMessage('');
      
      try {
        const blobUrl = await fetchMediaBlob(blobPath);
        if (!blobUrl) {
          throw new Error('Failed to create blob URL');
        }

        // Fetch the actual CSV content
        const response = await fetch(blobUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch CSV: ${response.status}`);
        }

        const text = await response.text();
        setCsvText(text);
        setOriginalCsvText(text);
        parseCSV(text);
        
        console.log(`[EditableCsvViewer] Successfully loaded and parsed CSV`);
      } catch (error) {
        console.error(`[EditableCsvViewer] Error loading CSV:`, error);
        setHasError(true);
        setErrorMessage(error instanceof Error ? error.message : 'Unknown error loading CSV');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadCSV();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobPath]); // Only re-run when blobPath changes, not fetchMediaBlob (stable via useCallback)

  // Parse CSV text into rows and columns
  const parseCSV = (text: string) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      setHasError(true);
      setErrorMessage('CSV file is empty');
      return;
    }

    // Auto-detect delimiter
    const detectDelimiter = (line: string): string => {
      const delimiters = [',', ';', '\t', '|'];
      let bestDelimiter = ',';
      let maxCount = 0;

      for (const delim of delimiters) {
        const count = line.split(delim).length;
        if (count > maxCount) {
          maxCount = count;
          bestDelimiter = delim;
        }
      }
      return bestDelimiter;
    };

    const delimiter = detectDelimiter(lines[0]);

    // Parse header
    const headerLine = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
    
    // Create columns with better default widths
    const cols: ColumnDef[] = headerLine.map((header, idx) => ({
      key: `col_${idx}`,
      name: header || `Column ${idx + 1}`,
      width: Math.max(150, Math.min(300, header.length * 12))
    }));
    
    // Add row number column
    cols.unshift({
      key: 'rowNum',
      name: '#',
      width: 50
    });

    setColumns(cols);

    // Parse data rows
    const dataRows = lines.slice(1).map((line, idx) => {
      const cells = line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''));
      const row: any = { rowNum: idx + 1 };
      
      headerLine.forEach((_, colIdx) => {
        row[`col_${colIdx}`] = cells[colIdx] || '';
      });
      
      return row;
    });

    setRows(dataRows);
  };

  // Handle cell value change
  const handleCellChange = useCallback((rowIdx: number, columnKey: string, value: string) => {
    const newRows = [...rows];
    newRows[rowIdx] = {
      ...newRows[rowIdx],
      [columnKey]: value
    };
    setRows(newRows);
    setHasChanges(true);
    
    // Update cell edit value if we're editing this cell
    if (selectedCell?.rowIdx === rowIdx && selectedCell?.columnKey === columnKey) {
      setCellEditValue(value);
    }
  }, [rows, selectedCell]);

  // Handle cell selection
  const handleCellClick = useCallback((rowIdx: number, columnKey: string) => {
    setWorkspaceRowIdx(rowIdx);

    if (columnKey === 'rowNum') {
      setSelectedCell(null);
      setCellEditValue('');
      return;
    }

    setSelectedCell({ rowIdx, columnKey });
    setCellEditValue(rows[rowIdx]?.[columnKey] || '');
  }, [rows]);

  // Handle text area edit
  const handleTextAreaChange = useCallback((value: string) => {
    setCellEditValue(value);
    
    if (selectedCell) {
      const newRows = [...rows];
      newRows[selectedCell.rowIdx] = {
        ...newRows[selectedCell.rowIdx],
        [selectedCell.columnKey]: value
      };
      setRows(newRows);
      setHasChanges(true);
    }
  }, [selectedCell, rows]);

  // Convert rows back to CSV
  const rowsToCSV = useCallback((): string => {
    if (columns.length === 0 || rows.length === 0) return '';

    // Get header (exclude row number column)
    const dataColumns = columns.filter(col => col.key !== 'rowNum');
    const header = dataColumns.map(col => `"${col.name}"`).join(',');

    // Get data rows
    const dataRows = rows.map(row => {
      return dataColumns.map(col => {
        const value = row[col.key] || '';
        // Escape quotes and wrap in quotes if contains comma or quote
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
    });

    return [header, ...dataRows].join('\n');
  }, [columns, rows]);

  // Save changes
  const handleSave = async () => {
    if (!hasChanges) return;

    setIsSaving(true);
    try {
      // Convert rows to CSV
      const newCsvText = rowsToCSV();
      
      // Create a blob and upload it
      const blob = new Blob([newCsvText], { type: 'text/csv' });
      const file = new File([blob], title || 'updated.csv', { type: 'text/csv' });

      // OpenAPI schema types multipart `file` as string; client runtime accepts Blob/File (see request.ts getFormData).
      const result = await AssetsService.updateAssetContent({
        infospaceId,
        assetId,
        formData: {
          file: file as unknown as string,
        },
      });
      
      console.log('[EditableCsvViewer] Save successful:', result);
      toast.success('CSV updated! Reprocessing rows...');
      setHasChanges(false);
      setCsvText(newCsvText);
      setOriginalCsvText(newCsvText);
      
      if (onSaveSuccess) {
        // Give backend more time to process and create new child assets
        // Then trigger multiple refreshes to ensure UI updates
        setTimeout(async () => {
          await onSaveSuccess();
          toast.success('Rows reprocessed successfully!');
        }, 2500);
      }
    } catch (error) {
      console.error('Error saving CSV:', error);
      toast.error(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Discard changes
  const handleDiscard = () => {
    if (!originalCsvText) return;
    parseCSV(originalCsvText);
    setHasChanges(false);
    toast.info('Changes discarded');
  };

  // Download current CSV
  const handleDownload = () => {
    const csvContent = hasChanges ? rowsToCSV() : csvText;
    if (!csvContent) return;

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title || 'export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full text-muted-foreground p-8", className)}>
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <span className="text-sm">Loading CSV data...</span>
      </div>
    );
  }

  const dataRowForWorkspace =
    selectedCell?.rowIdx ?? workspaceRowIdx ?? null;
  const showRowOpenColumn = !!onOpenCsvRow;

  const currentMatchRowIdx =
    matchRowIndices.length > 0
      ? matchRowIndices[Math.min(matchCursor, matchRowIndices.length - 1)]
      : null;
  const currentMatchColumnKeys =
    currentMatchRowIdx != null
      ? matchColumnKeysByRow[currentMatchRowIdx] ?? []
      : [];
  /** Primary column for the current search match (first in grid order). */
  const currentMatchPrimaryCol =
    currentMatchColumnKeys.length > 0 && columns.length > 0
      ? columns
          .filter((c) => c.key !== 'rowNum')
          .find((c) => currentMatchColumnKeys.includes(c.key))?.key ?? currentMatchColumnKeys[0]
      : null;

  if (hasError || !csvText) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full text-muted-foreground p-8", className)}>
        <FileSpreadsheet className="h-16 w-16 opacity-50 mb-4" />
        <p className="text-center mb-2">Failed to load CSV</p>
        {errorMessage && <p className="text-xs text-red-600 text-center">{errorMessage}</p>}
      </div>
    );
  }

  return (
    <div className={cn('relative flex h-full min-h-0 w-full flex-col overflow-hidden', className)}>
      {/* Compact Header with actions */}
      <div className="flex-none px-3 py-2 bg-muted/30 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge variant="outline" className="text-xs flex-shrink-0">
            {rows.length} rows × {columns.length - 1} columns
          </Badge>
          {hasChanges && (
            <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 border-yellow-300 flex-shrink-0">
              Unsaved
            </Badge>
          )}
        </div>
        
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:flex-nowrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            className="h-7 px-2"
          >
            <Download className="h-3 w-3 mr-1" />
            Download
          </Button>

          {hasChanges && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDiscard}
                disabled={isSaving}
                className="h-7 px-2"
              >
                <Undo2 className="h-3 w-3 mr-1" />
                Discard
              </Button>
              
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="h-7 px-2 bg-primary hover:bg-primary/90"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-3 w-3 mr-1" />
                    Save
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* In-table search (same grid; highlights matches, does not duplicate row list) */}
      {rows.length > 0 && (
        <div className="flex-none border-b bg-muted/20 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] max-w-md flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || matchCount === 0) return;
                  e.preventDefault();
                  setMatchCursor((c) => (c + 1) % matchCount);
                }}
                placeholder="Search in table…"
                className="h-8 pl-8 text-xs"
                aria-label="Search rows in CSV table"
              />
            </div>
            {tableSearch.trim() && (
              <>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {matchCount} match{matchCount !== 1 ? 'es' : ''}
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={matchCount === 0}
                    onClick={() =>
                      setMatchCursor((c) => (c - 1 + matchCount) % matchCount)
                    }
                    title="Previous match"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={matchCount === 0}
                    onClick={() => setMatchCursor((c) => (c + 1) % matchCount)}
                    title="Next match"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Data Table */}
      <div className={cn("overflow-auto", selectedCell ? "flex-none max-h-[38vh] md:max-h-[52vh]" : "flex-1")}>
        <div className="min-w-full inline-block align-middle">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/90 sticky top-0 z-10">
              <tr>
                {showRowOpenColumn && (
                  <th
                    className="w-9 shrink-0 border-r border-border px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    title="Open row in Rows tab"
                  >
                    <Eye className="mx-auto h-3.5 w-3.5 opacity-70" aria-hidden />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.key}
                    style={{ width: col.width ? `${col.width}px` : undefined, minWidth: col.width ? `${col.width}px` : undefined }}
                    className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-r border-border"
                  >
                    {col.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {rows.map((row, rowIdx) => {
                const isMatch =
                  tableSearch.trim() &&
                  matchRowIndices.includes(rowIdx);
                const isCurrentMatch =
                  isMatch &&
                  matchRowIndices[matchCursor] === rowIdx;
                const isWorkspaceRow = dataRowForWorkspace === rowIdx;
                const rowMatchCols = matchColumnKeysByRow[rowIdx] ?? [];
                return (
                <tr
                  key={rowIdx}
                  ref={(el) => {
                    rowRefs.current[rowIdx] = el;
                  }}
                  className={cn(
                    'hover:bg-muted/30',
                    isMatch && 'bg-amber-500/10',
                    isCurrentMatch && 'ring-1 ring-inset ring-amber-500/60',
                    isWorkspaceRow && !isCurrentMatch && 'bg-primary/5'
                  )}
                >
                  {showRowOpenColumn && (
                    <td className="w-9 shrink-0 border-r border-border px-0.5 py-0 text-center align-middle">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Open this row in Rows tab"
                        onClick={(e) => {
                          e.stopPropagation();
                          const partIdx = gridDataRowIndexToPartIndex(
                            rows as Record<string, unknown>[],
                            rowIdx
                          );
                          if (partIdx == null) {
                            toast.message('No row asset for an all-blank line', {
                              description: 'Add cell values or reprocess after editing.',
                            });
                            return;
                          }
                          onOpenCsvRow?.(partIdx);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                  {columns.map((col) => {
                    const cellMatches =
                      col.key !== 'rowNum' &&
                      tableSearch.trim() &&
                      rowMatchCols.includes(col.key);
                    const isPrimaryHit =
                      isCurrentMatch &&
                      cellMatches &&
                      currentMatchPrimaryCol === col.key;
                    return (
                    <td
                      key={`${rowIdx}-${col.key}`}
                      className={cn(
                        'px-2 py-1 text-sm border-r border-border whitespace-nowrap overflow-hidden',
                        cellMatches && 'bg-amber-500/15',
                        cellMatches &&
                          !isPrimaryHit &&
                          'ring-1 ring-inset ring-amber-600/60 dark:ring-amber-400/45',
                        isPrimaryHit &&
                          'z-[1] ring-[3px] ring-inset ring-amber-700 dark:ring-amber-300'
                      )}
                      style={{ maxWidth: col.width ? `${col.width}px` : undefined }}
                    >
                      {col.key === 'rowNum' ? (
                        <div
                          className="cursor-pointer text-center font-medium text-muted-foreground hover:bg-muted/50 rounded px-1"
                          onClick={() => handleCellClick(rowIdx, 'rowNum')}
                          title="Select row for Rows tab"
                        >
                          {row.rowNum}
                        </div>
                      ) : editingCell?.rowIdx === rowIdx && editingCell?.columnKey === col.key ? (
                        <Input
                          autoFocus
                          value={row[col.key] || ''}
                          onChange={(e) => handleCellChange(rowIdx, col.key, e.target.value)}
                          onBlur={() => setEditingCell(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setEditingCell(null);
                            } else if (e.key === 'Escape') {
                              setEditingCell(null);
                            }
                          }}
                          className="h-7 px-2 py-1 text-sm border-primary"
                        />
                      ) : (
                        <div
                          className={cn(
                            "cursor-pointer px-2 py-1 rounded hover:bg-muted/50 truncate",
                            selectedCell?.rowIdx === rowIdx && selectedCell?.columnKey === col.key && "bg-primary/10 ring-1 ring-primary"
                          )}
                          onClick={() => handleCellClick(rowIdx, col.key)}
                          onDoubleClick={() => setEditingCell({ rowIdx, columnKey: col.key })}
                          title={row[col.key]}
                        >
                          {row[col.key] || '\u00A0'}
                        </div>
                      )}
                    </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cell Editor Panel - shows when a cell is selected */}
      {selectedCell && (
        <div className="flex flex-1 flex-col min-h-0 border-t bg-muted/20">
          <Textarea
              value={cellEditValue}
              onChange={(e) => handleTextAreaChange(e.target.value)}
              className="min-h-[7rem] w-full flex-1 resize-none font-mono text-sm !rounded-none !border-none !shadow-none"
              placeholder="Enter cell content..."
              autoFocus
            />
        </div>
      )}

    </div>
  );
};

export default EditableCsvViewer;
