/**
 * Conversational Asset Explorer
 * ==============================
 * 
 * DESIGN PHILOSOPHY:
 * The backend constructs beautiful text summaries for the model.
 * We render those summaries as rich previews + an interactive tree.
 * 
 * PRIMARY: Interactive file tree (user can explore)
 * SECONDARY: Rich summary text (provides context/preview)
 * 
 * Pattern:
 * 1. Show expandable tree of nodes (like AssetSelector)
 * 2. Parse backend summary text for inline previews (ASCII tables → HTML)
 * 3. Keep it simple: nodes render nodes, previews are inline
 */

import React, { useState, useMemo, useCallback } from 'react';
import { NavigateResult } from '../shared/types';
import { EmptyResult } from '../shared/ResultComponents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  FileText, 
  FolderIcon, 
  Database,
  ChevronDown,
  ChevronRight,
  Table as TableIcon,
  FileSpreadsheet,
  Globe,
  Mail,
  Image as ImageIcon,
  List,
  Ellipsis,
  RectangleEllipsis
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConversationalAssetExplorerProps {
  result: NavigateResult;
  compact?: boolean;
  onAssetClick?: (assetId: number) => void;
  onBundleClick?: (bundleId: number) => void;
}

// Asset icon mapping
const getAssetIcon = (kind: string, isContainer?: boolean) => {
  const iconClass = "h-4 w-4";
  switch (kind) {
    case 'pdf': return <FileText className={`${iconClass} text-red-500`} />;
    case 'csv': 
      return isContainer ? (
        <FileSpreadsheet className={`${iconClass} text-green-600`} />
      ) : (
        <FileSpreadsheet className={`${iconClass} text-green-500`} />
      );
    case 'csv_row': 
      return <RectangleEllipsis className={`${iconClass} text-green-400`} />;
    case 'web': 
    case 'article': return <Globe className={`${iconClass} text-blue-500`} />;
    case 'email': return <Mail className={`${iconClass} text-purple-500`} />;
    case 'image': return <ImageIcon className={`${iconClass} text-pink-500`} />;
    default: return <FileText className={`${iconClass} text-muted-foreground`} />;
  }
};

/**
 * Parse ASCII table from backend summary text
 * Converts:
 *   | Name | Email |
 *   |------|-------|
 *   | Bob  | bob@  |
 * 
 * Into: { columns: ['Name', 'Email'], rows: [['Bob', 'bob@']] }
 */
function parseAsciiTable(text: string): { columns: string[], rows: string[][] } | null {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
  if (lines.length < 3) return null;
  
  const [headerLine, separatorLine, ...dataLines] = lines;
  
  // Verify separator line
  if (!separatorLine.includes('---')) return null;
  
  // Parse header
  const columns = headerLine
    .split('|')
    .map(c => c.trim())
    .filter(c => c.length > 0);
  
  // Parse rows
  const rows = dataLines
    .filter(l => !l.includes('...'))  // Skip "... and X more" lines
    .map(line => 
      line
        .split('|')
        .map(c => c.trim())
        .filter((c, i) => i > 0 && i <= columns.length)  // Skip leading/trailing |
    );
  
  return { columns, rows };
}

/**
 * Render ASCII table as HTML table
 */
function AsciiTablePreview({ text }: { text: string }) {
  const parsed = parseAsciiTable(text);
  if (!parsed) return <pre className="text-xs whitespace-pre-wrap">{text}</pre>;
  
  const { columns, rows } = parsed;
  
  return (
    <div className="mt-2">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col, i) => (
              <th key={i} className="text-left py-1 px-2 font-medium text-muted-foreground">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 5).map((row, i) => (
            <tr key={i} className="border-b border-border/30 hover:bg-muted/20">
              {row.map((cell, j) => (
                <td key={j} className="py-1 px-2 max-w-[200px] truncate" title={cell}>
                  {cell || '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 5 && (
        <div className="text-xs text-muted-foreground mt-1">
          ... and {rows.length - 5} more rows
        </div>
      )}
    </div>
  );
}

/**
 * Parse CSV row title into columns
 * Format: "1 | Queeres Zentrum ... | Address | Email"
 */
function parseCSVRowTitle(title: string): string[] {
  return title.split('|').map(col => col.trim());
}

/**
 * CSV Rows Table - Special display for CSV row children
 */
function CSVRowsTable({
  nodes,
  onAssetClick
}: {
  nodes: any[];
  onAssetClick?: (assetId: number) => void;
}) {
  // Parse first row to get column structure
  const firstRow = nodes[0];
  if (!firstRow) return null;
  
  const columns = parseCSVRowTitle(firstRow.name);
  
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <tbody>
          {nodes.map((node: any, idx: number) => {
            const cells = parseCSVRowTitle(node.name);
            // Safely extract asset ID - handle both string ("asset-123") and numeric (123) formats
            const nodeId = String(node.id);
            const assetId = nodeId.includes('-') 
              ? parseInt(nodeId.split('-')[1]) 
              : parseInt(nodeId);
            
            return (
              <tr
                key={node.id}
                className="border-b border-border/30 hover:bg-accent/30 cursor-pointer transition-colors"
                onClick={() => {
                  if (!isNaN(assetId) && onAssetClick) {
                    onAssetClick(assetId);
                  }
                }}
              >
                {cells.map((cell: string, cellIdx: number) => (
                  <td
                    key={cellIdx}
                    className={cn(
                      "py-2 px-3 max-w-[250px] truncate",
                      cellIdx === 0 && "text-muted-foreground font-mono w-12"
                    )}
                    title={cell}
                  >
                    {cell || '-'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Simple Tree Item - Clean hierarchy display
 * Bundles = folders, Assets = files with appropriate icons
 */
function SimpleTreeItem({ 
  node, 
  level = 0,
  summaryText = '',
  onAssetClick,
  onBundleClick
}: { 
  node: any; 
  level?: number;
  summaryText?: string;
  onAssetClick?: (assetId: number) => void;
  onBundleClick?: (bundleId: number) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const isBundle = node.type === 'bundle';
  const isAsset = node.type === 'asset';
  const hasChildren = node.children && node.children.length > 0;
  const canExpand = hasChildren;
  
  // Check if children are CSV rows
  const hasCSVRowChildren = hasChildren && node.children.every((child: any) => child.kind === 'csv_row');
  
  const handleClick = () => {
    if (canExpand) {
      setIsExpanded(!isExpanded);
    } else if (isBundle && onBundleClick) {
      // Safely extract bundle ID - handle both string ("bundle-123") and numeric (123) formats
      const nodeId = String(node.id);
      const bundleId = nodeId.includes('-') 
        ? parseInt(nodeId.split('-')[1]) 
        : parseInt(nodeId);
      if (!isNaN(bundleId)) onBundleClick(bundleId);
    } else if (isAsset && onAssetClick) {
      // Safely extract asset ID - handle both string ("asset-123") and numeric (123) formats
      const nodeId = String(node.id);
      const assetId = nodeId.includes('-') 
        ? parseInt(nodeId.split('-')[1]) 
        : parseInt(nodeId);
      if (!isNaN(assetId)) onAssetClick(assetId);
    }
  };
  
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1 text-sm hover:bg-accent/50 cursor-pointer transition-colors border-b border-border/20 last:border-b-0",
          level === 0 && "font-medium"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        {canExpand ? (
          <ChevronRight 
            className={cn("h-3 w-3 shrink-0 transition-transform", isExpanded && "rotate-90")}
          />
        ) : (
          <span className="w-3" />
        )}
        
        <span className="shrink-0">
          {isBundle ? (
            <FolderIcon className="h-4 w-4 text-blue-500" />
          ) : (
            getAssetIcon(node.kind || 'text', hasChildren)
          )}
        </span>
        
        <span className="flex-1 truncate">{node.name}</span>
        
        {/* Show hierarchical breadcrumb path for search results */}
        {isAsset && node.hierarchy_path && node.hierarchy_path.length > 0 && (
          <div className="flex items-center gap-1 shrink-0 flex-wrap max-w-[400px]">
            {/* Render path from root to immediate parent (reverse order) */}
            {[...node.hierarchy_path].reverse().map((pathItem: any, idx: number) => (
              <React.Fragment key={`${pathItem.type}-${pathItem.id}`}>
                {pathItem.type === 'bundle' ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onBundleClick) {
                        onBundleClick(pathItem.id);
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                    title={`Open bundle: ${pathItem.name}`}
                  >
                    <FolderIcon className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                    <span className="text-[10px] text-blue-700 dark:text-blue-300 max-w-[100px] truncate">
                      {pathItem.name}
                    </span>
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onAssetClick) {
                        onAssetClick(pathItem.id);
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                    title={`Open: ${pathItem.name}`}
                  >
                    {pathItem.kind === 'csv' ? (
                      <FileSpreadsheet className="h-3 w-3 text-green-600 dark:text-green-400" />
                    ) : pathItem.kind === 'pdf' ? (
                      <FileText className="h-3 w-3 text-green-600 dark:text-green-400" />
                    ) : (
                      <FileText className="h-3 w-3 text-green-600 dark:text-green-400" />
                    )}
                    <span className="text-[10px] text-green-700 dark:text-green-300 max-w-[100px] truncate">
                      {pathItem.name}
                    </span>
                  </button>
                )}
                {idx < node.hierarchy_path.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                )}
              </React.Fragment>
            ))}
          </div>
        )}
        
        {hasChildren && (
          <Badge variant="secondary" className="text-xs h-5 px-1.5 bg-muted/50">
            {node.children.length}
          </Badge>
        )}
        
        {/* Show kind badge for standalone assets (no hierarchy) */}
        {isAsset && node.kind && !hasChildren && (!node.hierarchy_path || node.hierarchy_path.length === 0) && (
          <Badge variant="outline" className="text-[10px] h-4 px-1">
            {node.kind}
          </Badge>
        )}
      </div>
      
      {/* Children - Special table display for CSV rows */}
      {isExpanded && hasChildren && (
        <div>
          {hasCSVRowChildren ? (
            <CSVRowsTable nodes={node.children} onAssetClick={onAssetClick} />
          ) : (
            node.children.map((child: any) => (
              <SimpleTreeItem
                key={child.id}
                node={child}
                level={level + 1}
                summaryText={summaryText}
                onAssetClick={onAssetClick}
                onBundleClick={onBundleClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Main Explorer - Tree with Context Headers + Auto CSV Previews
 * 
 * PRIMARY: Interactive tree (user explores nodes)
 * SECONDARY: Rich previews (CSV tables, bundle context)
 */
export function ConversationalAssetExplorer({
  result,
  compact = false,
  onAssetClick,
  onBundleClick
}: ConversationalAssetExplorerProps) {
  // Get summary text from backend
  const summaryText = useMemo(() => {
    return result.message || result.summary || '';
  }, [result]);
  
  // Get nodes
  const nodes = useMemo(() => {
    let rawNodes: any[] = [];
    if (result.nodes) rawNodes = result.nodes;
    else if (result.children) rawNodes = result.children;
    else if (result.items) rawNodes = result.items;
    
    // Normalize node format
    return rawNodes.map((node: any) => ({
      ...node,
      name: node.name || node.title || 'Untitled',
      type: node.type || 'asset',
    }));
  }, [result]);
  
  // Check if we're viewing a CSV parent (both 'view' and legacy 'expand' mode)
  const isCSVView = (result.mode === 'view' || result.mode === 'expand') && result.parent_kind === 'csv';
  
  // Extract ASCII table from summary if present
  const asciiTable = useMemo(() => {
    if (!summaryText || !summaryText.includes('|---')) return null;
    const tableSection = summaryText.split('\n\n').find(s => s.includes('|---'));
    return tableSection || null;
  }, [summaryText]);
  
  if (nodes.length === 0) {
    return <EmptyResult resource={result.resource || 'items'} />;
  }
  
  // Compact mode
  if (compact) {
    return (
      <div className="space-y-1 text-sm p-2">
        <div className="text-muted-foreground">
          {nodes.length} {result.resource || 'items'}
        </div>
        <div className="space-y-0.5">
          {nodes.slice(0, 3).map((node: any) => {
            const isBundle = node.type === 'bundle';
            const icon = isBundle ? (
              <FolderIcon className="h-3 w-3 text-blue-500" />
            ) : (
              <span className="scale-75">{getAssetIcon(node.kind || 'text', false)}</span>
            );
            
            return (
              <div key={node.id} className="text-xs truncate flex items-center gap-1.5">
                {icon}
                <span>{node.name}</span>
              </div>
            );
          })}
          {nodes.length > 3 && (
            <div className="text-xs text-muted-foreground">
              ... {nodes.length - 3} more
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Full mode: Header + CSV Preview (if applicable) + Tree
  return (
    <div className="overflow-y-auto">
      {/* Parent Header - Show context when viewing node contents */}
      {(result.mode === 'view' || result.mode === 'expand') && result.parent_name && (
        <div className="px-3 py-2 bg-muted/20 ">
          <div className="flex items-center gap-2">
            {result.parent_type === 'bundle' ? (
              <FolderIcon className="h-5 w-5 text-blue-500" />
            ) : result.parent_kind === 'csv' ? (
              <FileSpreadsheet className="h-5 w-5 text-green-600" />
            ) : (
              <FileText className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="font-medium text-sm">{result.parent_name}</span>
            <Badge variant="secondary" className="text-xs h-5 px-1.5">
              {nodes.length} items
            </Badge>
          </div>
        </div>
      )}
      
      {/* CSV Table Preview - Auto-show for CSV views */}
      {isCSVView && asciiTable && (
        <div className="px-3 py-3 border-b bg-muted/5">
          <AsciiTablePreview text={asciiTable} />
        </div>
      )}
      
      {/* Context Header for tree/list/search modes */}
      {result.mode !== 'view' && result.mode !== 'expand' && (result.query || result.resource) && (
        <div className="px-3 py-2 bg-muted/20 border-b">
          <div className="flex items-center gap-2">
            {result.mode === 'tree' && (
              <FolderIcon className="h-5 w-5 text-blue-500" />
            )}
            {result.mode === 'search' && (
              <Database className="h-5 w-5 text-purple-500" />
            )}
            <div className="text-sm flex items-center gap-2">
              {result.query ? (
                <>
                  <span>Found <strong>{nodes.length}</strong> results for</span>
                  <Badge variant="secondary" className="text-xs font-mono">
                    {result.query}
                  </Badge>
                </>
              ) : (
                <span className="font-medium">{nodes.length} {result.resource || 'items'}</span>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Main content - CSV rows get special table treatment */}
      <div className="h-full max-h-96 max-w-[80vw] md:max-w-[70vw] lg:max-w-[55vw] max-w-[65vw] ">
        {isCSVView && nodes.every((n: any) => n.kind === 'csv_row') ? (
          <CSVRowsTable nodes={nodes} onAssetClick={onAssetClick} />
        ) : (
          nodes.map((node: any) => (
            <SimpleTreeItem
              key={node.id}
              node={node}
              level={0}
              summaryText={summaryText}
              onAssetClick={onAssetClick}
              onBundleClick={onBundleClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
