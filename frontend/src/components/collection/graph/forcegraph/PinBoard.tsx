'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Waypoints, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GraphNode } from '../graphTypes';

// =============================================================================
// PinBoard — slim single-row overlay anchored top-left, between view controls
// (toolbar above) and the focused-node title pill (top-center). Each tab is a
// labelled, persistent grouping of pinned nodes; the active tab drives an
// optional combined "lens" that highlights the inter-pin network in the
// canvas AND filters the right-rail evidence — same affordance as the asset
// card's waypoints icon, one click does both.
//
// Layout (all in one horizontal row):
//   [Tab1] [Tab2] [+]  [— pin chips / placeholder dots —]  [⚡ lens] [×]
//
// Empty state shows ``SLOT_COUNT`` dotted-circle placeholders so the bar
// reads as "ready to fill". Past ``SLOT_COUNT``, the chip area scrolls
// horizontally — soft cap, not a hard one.
// =============================================================================

const SLOT_COUNT = 5;

export interface PinBoardPage {
  id: string;
  label: string;
  pinnedNodeIds: string[];
}

export interface PinBoardState {
  pages: PinBoardPage[];
  activePageId: string;
  /** Single combined lens — highlights pin-network in the canvas + filters
   *  evidence rail to pinned peers. */
  showLens: boolean;
}

interface PinBoardProps {
  pinBoard: PinBoardState;
  nodes: GraphNode[];
  onSetActivePage: (pageId: string) => void;
  onAddPage: (label: string) => void;
  onRenamePage: (pageId: string, label: string) => void;
  onDeletePage: (pageId: string) => void;
  onUnpin: (nodeId: string) => void;
  onClearPage: () => void;
  onPeerClick: (node: GraphNode) => void;
  onToggleLens: () => void;
}

export const PinBoard: React.FC<PinBoardProps> = ({
  pinBoard, nodes, onSetActivePage, onAddPage, onRenamePage, onDeletePage,
  onUnpin, onClearPage, onPeerClick, onToggleLens,
}) => {
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [addingPage, setAddingPage] = useState(false);
  const [newPageDraft, setNewPageDraft] = useState('');

  const activePage = pinBoard.pages.find(p => p.id === pinBoard.activePageId)
    ?? pinBoard.pages[0];
  const pinIds = activePage?.pinnedNodeIds ?? [];
  const pinnedCount = pinIds.length;
  const lensAvailable = pinnedCount >= 2;

  return (
    <div
      className="absolute bottom-2 left-2 flex items-center gap-2 bg-background/90 backdrop-blur-sm border rounded-md px-2 py-1 max-w-[60%]"
      style={{ pointerEvents: 'auto' }}
    >
      {/* ===== Tabs ===== */}
      <div className="flex items-center gap-0.5 shrink-0">
        {pinBoard.pages.map(page => {
          const isActive = page.id === pinBoard.activePageId;
          if (renamingPageId === page.id) {
            return (
              <Input
                key={page.id}
                autoFocus
                className="h-5 text-[10px] px-1 w-24"
                value={renameDraft}
                onChange={e => setRenameDraft(e.target.value)}
                onBlur={() => {
                  if (renameDraft.trim()) onRenamePage(page.id, renameDraft.trim());
                  setRenamingPageId(null);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (renameDraft.trim()) onRenamePage(page.id, renameDraft.trim());
                    setRenamingPageId(null);
                  }
                  if (e.key === 'Escape') setRenamingPageId(null);
                }}
              />
            );
          }
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => onSetActivePage(page.id)}
              onDoubleClick={() => {
                setRenamingPageId(page.id);
                setRenameDraft(page.label);
              }}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1',
                isActive
                  ? 'bg-amber-100 dark:bg-amber-950 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100'
                  : 'bg-muted/50 border-transparent hover:bg-muted text-muted-foreground',
              )}
              title={`${page.label} (${page.pinnedNodeIds.length}). Double-click to rename.`}
            >
              <span className="truncate max-w-[80px]">{page.label}</span>
              {page.pinnedNodeIds.length > 0 && (
                <span className="text-muted-foreground tabular-nums">
                  {page.pinnedNodeIds.length}
                </span>
              )}
            </button>
          );
        })}
        {addingPage ? (
          <Input
            autoFocus
            className="h-5 text-[10px] px-1 w-24"
            placeholder="Page name"
            value={newPageDraft}
            onChange={e => setNewPageDraft(e.target.value)}
            onBlur={() => {
              if (newPageDraft.trim()) onAddPage(newPageDraft.trim());
              setNewPageDraft('');
              setAddingPage(false);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (newPageDraft.trim()) onAddPage(newPageDraft.trim());
                setNewPageDraft('');
                setAddingPage(false);
              }
              if (e.key === 'Escape') {
                setNewPageDraft('');
                setAddingPage(false);
              }
            }}
          />
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground"
            onClick={() => setAddingPage(true)}
            title="Add page"
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Vertical divider */}
      <div className="w-px h-4 bg-border shrink-0" />

      {/* ===== Slots / pin chips (scrolls horizontally past SLOT_COUNT) ===== */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide flex-1 min-w-0">
        {pinIds.length === 0
          ? Array.from({ length: SLOT_COUNT }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/30 shrink-0"
              />
            ))
          : (
            <>
              {pinIds.map(id => {
                const node = nodes.find(n => n.id === id);
                const label = node?.label ?? id;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-0.5 pl-1.5 pr-0.5 py-0 rounded border bg-blue-50/95 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-[10px] shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => node && onPeerClick(node)}
                      className="font-medium hover:underline max-w-[120px] truncate text-left"
                      title={node ? `Focus ${label}` : `${label} (not in current graph)`}
                    >
                      {label}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                      onClick={() => onUnpin(id)}
                      title="Unpin"
                    >
                      <X className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                );
              })}
              {pinIds.length < SLOT_COUNT
                && Array.from({ length: SLOT_COUNT - pinIds.length }).map((_, i) => (
                  <div
                    key={`tail-${i}`}
                    className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/30 shrink-0"
                  />
                ))}
            </>
          )}
      </div>

      {/* ===== Actions: combined lens + clear / delete-page ===== */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-5 w-5',
            pinBoard.showLens
              ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950'
              : 'text-muted-foreground hover:text-foreground',
            !lensAvailable && 'opacity-40',
          )}
          disabled={!lensAvailable}
          onClick={onToggleLens}
          title={lensAvailable
            ? (pinBoard.showLens
                ? 'Hide pin-set network + evidence'
                : 'Show pin-set network + evidence')
            : 'Pin at least 2 nodes to view their network'}
        >
          <Waypoints className="h-3 w-3" />
        </Button>
        {pinnedCount > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-destructive"
            onClick={onClearPage}
            title="Clear all pins on this page"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
        {pinBoard.pages.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-destructive"
            onClick={() => onDeletePage(pinBoard.activePageId)}
            title="Delete this page"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
};
