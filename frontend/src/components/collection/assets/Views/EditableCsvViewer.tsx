import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DataGrid, Column, RenderEditCellProps } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, X, Download, FileSpreadsheet, AlertCircle, Undo2, Type } from 'lucide-react';
import { cn } from "@/lib/utils";
import { toast } from 'sonner';
import { AssetsService } from '@/client/sdk.gen';

interface EditableCsvViewerProps {
  blobPath: string;
  title: string;
  assetId: number;
  infospaceId: number;
  className?: string;
  onSaveSuccess?: () => void;
  fetchMediaBlob: (blobPath: string) => Promise<string | null>;
}

// Custom text editor component
function TextEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<any>) {
  return (
    <input
      className="w-full h-full px-2 py-1 border-0 focus:outline-none focus:ring-2 focus:ring-primary"
      autoFocus
      value={row[column.key] as string}
      onChange={(e) => onRowChange({ ...row, [column.key]: e.target.value })}
      onBlur={() => onClose(false)}
    />
  );
}

const EditableCsvViewer: React.FC<EditableCsvViewerProps> = ({
  blobPath,
  title,
  assetId,
  infospaceId,
  className,
  onSaveSuccess,
  fetchMediaBlob
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [csvText, setCsvText] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<Column<any>[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [originalCsvText, setOriginalCsvText] = useState<string | null>(null);
  const [showInfoAlert, setShowInfoAlert] = useState(true);
  const [selectedCell, setSelectedCell] = useState<{ rowIdx: number; columnKey: string } | null>(null);
  const [cellEditValue, setCellEditValue] = useState<string>('');

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
  }, [blobPath, fetchMediaBlob]);

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
    
    // Create columns for react-data-grid with better default widths
    const cols: Column<any>[] = headerLine.map((header, idx) => ({
      key: `col_${idx}`,
      name: header || `Column ${idx + 1}`,
      resizable: true,
      sortable: true,
      editable: true,
      renderEditCell: TextEditor,
      // More generous default widths - 150-300px range
      width: Math.max(150, Math.min(300, header.length * 12))
    }));
    
    // Add row number column
    cols.unshift({
      key: 'rowNum',
      name: '#',
      width: 50,
      frozen: true,
      resizable: false,
      renderCell: ({ row }) => <div className="text-center text-muted-foreground">{row.rowNum}</div>
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

  // Handle row updates
  const handleRowsChange = useCallback((newRows: any[]) => {
    setRows(newRows);
    setHasChanges(true);
    
    // Update cell edit value if we're editing the changed row
    if (selectedCell) {
      const updatedRow = newRows[selectedCell.rowIdx];
      if (updatedRow) {
        setCellEditValue(updatedRow[selectedCell.columnKey] || '');
      }
    }
  }, [selectedCell]);

  // Handle cell selection
  const handleCellClick = useCallback((args: { row: any; column: Column<any>; rowIdx: number }) => {
    // Don't track row number column
    if (args.column.key === 'rowNum') {
      setSelectedCell(null);
      setCellEditValue('');
      return;
    }
    
    setSelectedCell({ rowIdx: args.rowIdx, columnKey: args.column.key });
    setCellEditValue(args.row[args.column.key] || '');
  }, []);

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

      // Call API to update asset content and reprocess
      // SDK returns a promise that resolves directly to the response data
      const result = await AssetsService.updateAssetContent({
        infospaceId,
        assetId,
        formData: {
          file: file
        }
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
    <div className={cn("relative w-full h-full flex flex-col", className)}>
      {/* Compact Header with actions */}
      <div className="flex-none px-3 py-2 bg-muted/30 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileSpreadsheet className="h-4 w-4 text-green-600 flex-shrink-0" />
          <span className="text-sm font-medium truncate">{title}</span>
          <Badge variant="outline" className="text-xs flex-shrink-0">
            {rows.length} × {columns.length - 1}
          </Badge>
          {hasChanges && (
            <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 border-yellow-300 flex-shrink-0">
              Unsaved
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-1.5 flex-shrink-0">
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

      {/* Dismissable Info alert - only shows when no changes and not dismissed */}
      {!hasChanges && showInfoAlert && (
        <div className="flex-none px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-blue-800 dark:text-blue-200">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Click any cell to open the editor below • Double-click to edit inline</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowInfoAlert(false)}
            className="h-5 w-5 p-0 hover:bg-blue-100 dark:hover:bg-blue-900"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Data Grid */}
      <div className={cn("overflow-hidden", selectedCell ? "flex-none max-h-[50vh]" : "flex-1")}>
        <DataGrid
          columns={columns}
          rows={rows}
          onRowsChange={handleRowsChange}
          onCellClick={handleCellClick}
          className="rdg-light fill-grid"
        />
      </div>

      {/* Cell Editor Panel - shows when a cell is selected */}
      {selectedCell && (
        <div className="flex-1 border-t bg-muted/20 flex flex-col min-h-0">
          <div className="flex-none px-3 py-2 border-b bg-background flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Type className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                Cell Editor
              </span>
              <span className="text-xs text-muted-foreground">
                Row {selectedCell.rowIdx + 1} • {columns.find(c => c.key === selectedCell.columnKey)?.name}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedCell(null);
                setCellEditValue('');
              }}
              className="h-6 w-6 p-0"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex-1 p-3 overflow-auto">
            <Textarea
              value={cellEditValue}
              onChange={(e) => handleTextAreaChange(e.target.value)}
              className="w-full h-full min-h-[100px] font-mono text-sm resize-none"
              placeholder="Enter cell content..."
              autoFocus
            />
          </div>
        </div>
      )}

      <style jsx global>{`
        .fill-grid {
          block-size: 100%;
        }
        .rdg {
          font-size: 12px;
          line-height: 1.4;
        }
        .rdg-cell {
          padding: 6px 8px;
          border-right: 1px solid hsl(var(--border));
        }
        .rdg-header-row {
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }
        .rdg-header-row .rdg-cell {
          padding: 8px;
        }
        /* Compact row height */
        .rdg-row {
          min-height: 35px;
        }
      `}</style>
    </div>
  );
};

export default EditableCsvViewer;
