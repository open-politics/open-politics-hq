'use client';

/**
 * AssetCard — shared presentation for an AssetNode across tree/search/feed.
 *
 * Single component, three contexts:
 *
 * * **Tree**   — no match chips, structural info (children count, sealed, etc.)
 * * **Search** — per-match chip ribbon showing which fields matched
 * * **Feed**   — timestamp-forward, match chips empty
 *
 * The component reads the unified ``AssetNode`` shape and renders the same
 * visual structure everywhere. Callers hand it an ``onSelect`` / ``onOpen``
 * pair and let the card handle its own click semantics.
 */

import type { AssetNode, AssetMatch } from '@/client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { FileText, Folder, FolderOpen, Link as LinkIcon, ImageIcon, Table as TableIcon, File } from 'lucide-react';

export interface AssetCardProps {
  node: AssetNode;
  /** Selection state — highlighted ring, no action change. */
  selected?: boolean;
  /** Hide matches even when present (use for tree/feed contexts). */
  hideMatches?: boolean;
  /** Handler for card click — used to preview / open inline. */
  onClick?: (node: AssetNode) => void;
  /** Handler for open — double-click or primary action. */
  onOpen?: (node: AssetNode) => void;
  /** Custom content rendered in the footer (actions, badges, etc.) */
  footer?: React.ReactNode;
  className?: string;
}


const kindIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  web: LinkIcon,
  image: ImageIcon,
  csv: TableIcon,
  csv_row: TableIcon,
  text: FileText,
  article: FileText,
};


function nodeIcon(node: AssetNode) {
  if (node.type === 'bundle') return FolderOpen;
  if (node.type === 'virtual_folder') return Folder;
  if (node.kind && kindIcon[node.kind]) return kindIcon[node.kind];
  return File;
}


function MatchChip({ match }: { match: AssetMatch }) {
  const label = match.field;
  const pct = typeof match.score === 'number' ? Math.round(match.score * 100) : null;
  return (
    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
      {label}{pct !== null ? ` ${pct}` : ''}
    </Badge>
  );
}


export function AssetCard({
  node,
  selected = false,
  hideMatches = false,
  onClick,
  onOpen,
  footer,
  className,
}: AssetCardProps) {
  const Icon = nodeIcon(node);
  const showMatches = !hideMatches && node.matches && node.matches.length > 0;
  const snippet = node.matches?.find((m) => m.snippet)?.snippet;

  return (
    <div
      onClick={() => onClick?.(node)}
      onDoubleClick={() => onOpen?.(node)}
      className={cn(
        'group flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors',
        'hover:bg-accent/50 cursor-pointer',
        selected && 'ring-2 ring-primary',
        className,
      )}
      role="button"
      tabIndex={0}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="text-sm font-medium truncate">{node.name || 'Untitled'}</h4>
          {node.type === 'bundle' && typeof node.children_count === 'number' && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {node.children_count}
            </Badge>
          )}
          {node.sealed && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              sealed
            </Badge>
          )}
          {node.stub && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              stub
            </Badge>
          )}
        </div>

        {snippet && (
          <p
            className="text-xs text-muted-foreground line-clamp-2 mt-1"
            // Highlights from ts_headline contain <mark> tags
            dangerouslySetInnerHTML={{ __html: snippet }}
          />
        )}

        {showMatches && (
          <div className="flex flex-wrap gap-1 mt-2">
            {node.matches!.map((m, i) => (
              <MatchChip key={i} match={m} />
            ))}
          </div>
        )}

        {footer && <div className="mt-2">{footer}</div>}
      </div>
    </div>
  );
}
