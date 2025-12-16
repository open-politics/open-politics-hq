'use client';

import React, { useMemo } from 'react';
import { CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import { AssetCardBase } from '../AssetCardBase';
import { CardHeroFallback } from './CardHeroFallback';
import type { TypeSpecificCardProps, CardOrientation } from '../types';
import { 
  getAssetKindConfig, 
  getAssetBadgeClass, 
  formatAssetKind 
} from '../../assetKindConfig';
import { RelevanceBadge } from '../../RelevanceBadge';

/**
 * CsvAssetCard - Card for parent CSV assets
 * 
 * Features:
 * - Mini table preview in the hero area (zoomed out spreadsheet look)
 * - Shows column headers and sample data rows when metadata is available
 * - Falls back to CardHeroFallback when no metadata
 * - Row/column count badges
 * - Maintains CSV green color scheme
 * - Supports horizontal orientation for bento layouts
 */

interface CsvMetadata {
  column_names?: string[];
  row_count?: number;
  preview_rows?: string[][];
  delimiter?: string;
}

interface CsvAssetCardProps extends TypeSpecificCardProps {
  /** Card orientation */
  orientation?: CardOrientation;
  /** Whether this card is featured */
  isFeatured?: boolean;
}

export function CsvAssetCard({
  asset,
  score,
  onClick,
  size = 'md',
  orientation = 'vertical',
  isFeatured = false,
  showMeta = true,
  className,
}: CsvAssetCardProps) {
  const metadata = asset.source_metadata as CsvMetadata | null;
  const fragmentCount = asset.fragments ? Object.keys(asset.fragments).length : 0;
  
  // Extract CSV metadata
  const columnNames = metadata?.column_names || [];
  const rowCount = metadata?.row_count || 0;
  const previewRows = metadata?.preview_rows || [];
  
  // Check if we have actual data to display
  const hasTableData = columnNames.length > 0 || previewRows.length > 0;
  
  // Size configurations for the mini table
  const tableConfig = {
    sm: { maxCols: 3, maxRows: 2, cellWidth: 'w-12', textSize: 'text-[7px]', headerHeight: 'h-4', rowHeight: 'h-3' },
    md: { maxCols: 5, maxRows: 4, cellWidth: 'w-16', textSize: 'text-[9px]', headerHeight: 'h-6', rowHeight: 'h-5' },
    lg: { maxCols: 6, maxRows: 5, cellWidth: 'w-20', textSize: 'text-[10px]', headerHeight: 'h-7', rowHeight: 'h-6' },
  };
  
  const config = tableConfig[size];
  
  // Prepare display data - only when we have actual data
  const displayData = useMemo(() => {
    if (!hasTableData) return null;
    
    const headers = columnNames.slice(0, config.maxCols);
    const data = previewRows.slice(0, config.maxRows).map(row => 
      row.slice(0, config.maxCols)
    );
    
    // If we have column names but no preview rows, show headers only with empty indicator
    if (headers.length > 0 && data.length === 0) {
      return {
        headers,
        data: [],
        hasMore: {
          cols: columnNames.length > config.maxCols,
          rows: rowCount > 0,
        }
      };
    }
    
    return {
      headers,
      data,
      hasMore: {
        cols: columnNames.length > config.maxCols,
        rows: rowCount > config.maxRows || previewRows.length > config.maxRows,
      }
    };
  }, [hasTableData, columnNames, previewRows, rowCount, config.maxCols, config.maxRows]);

  const titleSizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  // Horizontal layout - compact preview with metadata
  if (orientation === 'horizontal') {
    const isCompact = size === 'sm';
    
    return (
      <AssetCardBase
        onClick={onClick ? () => onClick(asset) : undefined}
        size={size}
        orientation="horizontal"
        className={className}
      >
        {/* Left side - Mini table preview */}
        <div className={cn(
          'relative shrink-0 overflow-hidden',
          'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/50 dark:to-emerald-900/40',
          size === 'sm' ? 'w-[100px]' : size === 'md' ? 'w-[180px]' : 'w-[240px]'
        )}>
          {displayData ? (
            <div className="absolute inset-0 p-1.5 flex items-center justify-center">
              <div className="transform scale-75 origin-center">
                {/* Mini table preview */}
                <div className={cn(
                  "rounded overflow-hidden shadow-sm",
                  "border border-emerald-300/60 dark:border-emerald-700/60",
                  "bg-white/90 dark:bg-black/40"
                )}>
                  {/* Header row */}
                  <div className={cn(
                    "flex",
                    "bg-emerald-100 dark:bg-emerald-900/50",
                    "border-b border-emerald-300/60 dark:border-emerald-700/60"
                  )}>
                    {displayData.headers.slice(0, 3).map((header, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "flex items-center justify-center px-0.5 truncate",
                          "w-10 h-4",
                          idx < 2 && "border-r border-emerald-300/40 dark:border-emerald-700/40",
                          "text-[7px]",
                          "font-semibold text-emerald-800 dark:text-emerald-200",
                          "uppercase tracking-tight"
                        )}
                      >
                        {header.slice(0, 6)}
                      </div>
                    ))}
                  </div>
                  {/* Sample rows */}
                  {displayData.data.slice(0, 2).map((row, rowIdx) => (
                    <div key={rowIdx} className="flex">
                      {row.slice(0, 3).map((cell, cellIdx) => (
                        <div
                          key={cellIdx}
                          className={cn(
                            "flex items-center px-0.5 truncate",
                            "w-10 h-3",
                            cellIdx < 2 && "border-r border-emerald-200/30 dark:border-emerald-800/30",
                            "text-[6px]",
                            "text-emerald-900 dark:text-emerald-100",
                            "font-mono"
                          )}
                        >
                          {cell.slice(0, 6)}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              {React.createElement(getAssetKindConfig(asset.kind).icon, {
                className: "h-8 w-8 text-emerald-600/40"
              })}
            </div>
          )}
          
          {score !== undefined && (
            <RelevanceBadge 
              score={score}
              className="absolute top-1 right-1 bg-background/90 px-1 py-0.5 rounded text-[10px]"
            />
          )}
        </div>
        
        {/* Content section */}
        <div className={cn(
          'flex-1 flex flex-col min-w-0 overflow-hidden',
          isCompact ? 'p-2' : 'p-3'
        )}>
          {isCompact ? (
            <>
              <h3 className="font-semibold text-sm leading-tight line-clamp-1 mb-1">
                {asset.title || 'Untitled CSV'}
              </h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-auto">
                {(rowCount > 0 || columnNames.length > 0) && (
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {rowCount > 0 ? rowCount : '?'} × {columnNames.length > 0 ? columnNames.length : '?'}
                  </span>
                )}
                <span className="ml-auto">
                  {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Badge 
                  variant="outline"
                  className={cn("text-xs h-5 shrink-0", getAssetBadgeClass(asset.kind, 'card'))}
                >
                  {React.createElement(getAssetKindConfig(asset.kind).icon, {
                    className: "h-3 w-3 mr-1"
                  })}
                  {formatAssetKind(asset.kind)}
                </Badge>
                {(rowCount > 0 || columnNames.length > 0) && (
                  <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
                    {rowCount > 0 ? rowCount : '?'} × {columnNames.length > 0 ? columnNames.length : '?'}
                  </span>
                )}
              </div>
              
              <h3 className="font-semibold text-base leading-tight line-clamp-2 mb-2">
                {asset.title || 'Untitled CSV'}
              </h3>
              
              {columnNames.length > 0 && (
                <p className="text-xs text-muted-foreground line-clamp-1 font-mono">
                  {columnNames.slice(0, 5).join(' | ')}
                  {columnNames.length > 5 && ` +${columnNames.length - 5}`}
                </p>
              )}
              
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-auto pt-2">
                <span>
                  {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
                {fragmentCount > 0 && (
                  <Badge variant="secondary" className="ml-auto text-xs h-5 px-2">
                    {fragmentCount} analysis
                  </Badge>
                )}
              </div>
            </>
          )}
        </div>
      </AssetCardBase>
    );
  }

  // Vertical layout - original mini table preview
  // If no table data, use the standard CardHeroFallback
  if (!displayData) {
    return (
      <AssetCardBase
        onClick={onClick ? () => onClick(asset) : undefined}
        size={size}
        className={className}
      >
        <div className="flex flex-col h-full">
          {/* Fallback Hero */}
          <div className="flex-1 min-h-[150px] relative overflow-hidden">
            <CardHeroFallback
              title={asset.title || 'Untitled CSV'}
              kind={asset.kind}
              size={size}
            />
            
            {/* Relevance score badge */}
            {score !== undefined && (
              <RelevanceBadge 
                score={score}
                className="absolute top-2 right-2 bg-background/80 px-1.5 py-0.5 rounded z-10"
              />
            )}
            
            {/* Fragment count badge */}
            {fragmentCount > 0 && (
              <Badge 
                variant="secondary"
                className="absolute bottom-2 right-2 bg-black/60 text-white border-0 z-10"
              >
                {fragmentCount} analysis
              </Badge>
            )}
          </div>
          
          {/* Content - compact footer */}
          <CardContent className="p-3 flex flex-col gap-1">
            {/* Meta row */}
            {showMeta && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                
                {/* Kind badge inline */}
                <Badge 
                  variant="outline"
                  className={cn(
                    "mr-auto text-xs h-5",
                    getAssetBadgeClass(asset.kind, 'card')
                  )}
                >
                  {React.createElement(getAssetKindConfig(asset.kind).icon, {
                    className: "h-3 w-3 mr-1"
                  })}
                  {formatAssetKind(asset.kind)}
                </Badge>
                <span>
                  {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
              </div>
            )}
          </CardContent>
        </div>
      </AssetCardBase>
    );
  }

  // Render mini table when we have data
  return (
    <AssetCardBase
      onClick={onClick ? () => onClick(asset) : undefined}
      size={size}
      className={className}
    >
      <div className="flex flex-col h-full">
        {/* Mini Table Preview - Hero Area */}
        <div className="flex-1 min-h-[150px] bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/40 dark:to-emerald-900/30 relative overflow-hidden p-3">
          {/* Zoomed out table container */}
          <div className="absolute inset-3 flex items-center justify-center">
            <div className="transform scale-90 origin-center">
              {/* Mini table */}
              <div className={cn(
                "rounded-md overflow-hidden shadow-sm",
                "border border-emerald-300/60 dark:border-emerald-700/60",
                "bg-white/90 dark:bg-black/40"
              )}>
                {/* Header row */}
                <div className={cn(
                  "flex",
                  "bg-emerald-100 dark:bg-emerald-900/50",
                  "border-b border-emerald-300/60 dark:border-emerald-700/60"
                )}>
                  {/* Row number header */}
                  <div className={cn(
                    "flex items-center justify-center px-1",
                    "w-6 shrink-0",
                    config.headerHeight,
                    "border-r border-emerald-300/60 dark:border-emerald-700/60",
                    config.textSize,
                    "font-semibold text-emerald-700 dark:text-emerald-300"
                  )}>
                    #
                  </div>
                  {/* Column headers */}
                  {displayData.headers.map((header, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "flex items-center justify-center px-1 truncate",
                        config.cellWidth,
                        config.headerHeight,
                        idx < displayData.headers.length - 1 && "border-r border-emerald-300/40 dark:border-emerald-700/40",
                        config.textSize,
                        "font-semibold text-emerald-800 dark:text-emerald-200",
                        "uppercase tracking-tight"
                      )}
                      title={header}
                    >
                      {header.length > 12 ? `${header.slice(0, 10)}...` : header}
                    </div>
                  ))}
                  {/* More columns indicator */}
                  {displayData.hasMore.cols && (
                    <div className={cn(
                      "flex items-center justify-center px-1",
                      "w-4 shrink-0",
                      config.headerHeight,
                      config.textSize,
                      "text-emerald-600/60 dark:text-emerald-400/60"
                    )}>
                      …
                    </div>
                  )}
                </div>
                
                {/* Data rows */}
                {displayData.data.length > 0 ? (
                  displayData.data.map((row, rowIdx) => (
                    <div
                      key={rowIdx}
                      className={cn(
                        "flex",
                        rowIdx < displayData.data.length - 1 && "border-b border-emerald-200/50 dark:border-emerald-800/50",
                        rowIdx % 2 === 1 && "bg-emerald-50/50 dark:bg-emerald-900/20"
                      )}
                    >
                      {/* Row number */}
                      <div className={cn(
                        "flex items-center justify-center px-1",
                        "w-6 shrink-0",
                        config.rowHeight,
                        "border-r border-emerald-300/40 dark:border-emerald-700/40",
                        "bg-emerald-50 dark:bg-emerald-900/30",
                        config.textSize,
                        "text-emerald-600 dark:text-emerald-400"
                      )}>
                        {rowIdx + 1}
                      </div>
                      {/* Cell values */}
                      {row.map((cell, cellIdx) => (
                        <div
                          key={cellIdx}
                          className={cn(
                            "flex items-center px-1 truncate",
                            config.cellWidth,
                            config.rowHeight,
                            cellIdx < row.length - 1 && "border-r border-emerald-200/30 dark:border-emerald-800/30",
                            config.textSize,
                            "text-emerald-900 dark:text-emerald-100",
                            "font-mono"
                          )}
                          title={cell}
                        >
                          {cell.length > 12 ? `${cell.slice(0, 10)}…` : cell}
                        </div>
                      ))}
                      {/* More columns indicator */}
                      {displayData.hasMore.cols && (
                        <div className={cn(
                          "flex items-center justify-center px-1",
                          "w-4 shrink-0",
                          config.rowHeight,
                          config.textSize,
                          "text-emerald-600/40 dark:text-emerald-400/40"
                        )}>
                          …
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  /* Empty rows indicator when we only have headers */
                  <div className={cn(
                    "flex items-center justify-center py-2",
                    config.textSize,
                    "text-emerald-600/60 dark:text-emerald-400/60 italic"
                  )}>
                    {rowCount > 0 ? `${rowCount} rows` : 'No preview available'}
                  </div>
                )}
                
                {/* More rows indicator */}
                {displayData.hasMore.rows && displayData.data.length > 0 && (
                  <div className={cn(
                    "flex items-center justify-center",
                    "h-4",
                    "bg-emerald-50/80 dark:bg-emerald-900/30",
                    "border-t border-emerald-200/50 dark:border-emerald-800/50",
                    config.textSize,
                    "text-emerald-600/60 dark:text-emerald-400/60"
                  )}>
                    +{rowCount > 0 ? rowCount - displayData.data.length : '...'} more rows
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Relevance score badge */}
          {score !== undefined && (
            <RelevanceBadge 
              score={score}
              className="absolute top-2 right-2 bg-background/80 px-1.5 py-0.5 rounded z-10"
            />
          )}
          
          {/* Fragment count badge */}
          {fragmentCount > 0 && (
            <Badge 
              variant="secondary"
              className="absolute bottom-2 right-2 bg-black/60 text-white border-0 z-10"
            >
              {fragmentCount} analysis
            </Badge>
          )}
        </div>
        
        {/* Content - Title and metadata footer */}
        <CardContent className="p-3 flex flex-col gap-1">
          {/* Title */}
          <h3 className={cn('font-semibold line-clamp-1', titleSizes[size])}>
            {asset.title || 'Untitled CSV'}
          </h3>
          
          {/* Meta row */}
          {showMeta && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {/* Dimensions */}
              {(rowCount > 0 || columnNames.length > 0) && (
                <>
                  <span className="font-mono">
                    {rowCount > 0 ? rowCount : '?'} × {columnNames.length > 0 ? columnNames.length : '?'}
                  </span>
                  <span>•</span>
                </>
              )}
              <span>
                {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
              </span>
              {/* Kind badge inline */}
              <Badge 
                variant="outline"
                className={cn(
                  "ml-auto text-xs h-5",
                  getAssetBadgeClass(asset.kind, 'card')
                )}
              >
                {React.createElement(getAssetKindConfig(asset.kind).icon, {
                  className: "h-3 w-3 mr-1"
                })}
                {formatAssetKind(asset.kind)}
              </Badge>
            </div>
          )}
        </CardContent>
      </div>
    </AssetCardBase>
  );
}
