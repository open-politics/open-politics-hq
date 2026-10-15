'use client';

/**
 * DrillColumn — the right-hand column a canvas opens when you click into it:
 * the assets behind the click, then one of them.
 *
 * The overview opens it for a place or a name, the network panel for a node.
 * Both are the same reading move — from *where* or *who* to the documents that
 * said so — so it is one component: the list (`AssetListCard`) on top, and
 * once an asset is open the asset manager's own detail view under it
 * (`AssetDetailCard`), with the list shrinking to make room.
 *
 * Floats over its canvas; the canvas keeps its pointer events everywhere the
 * column is not.
 */
import React from 'react';
import type { AnnotationSchemaRead } from '@/client';
import { cn } from '@/lib/utils';
import type { AssetPages } from '@/hooks/useAssetPages';
import { AssetListCard, type DrillSubject } from './AssetListCard';
import { AssetDetailCard } from './AssetDetailCard';

export const DRILL_W = 400;

export function DrillColumn({
  subject, context, pages, openAsset, onOpenAsset, onClose, actions,
  infospaceId, runId, schemas, className,
}: {
  subject: DrillSubject;
  context: string[];
  pages: AssetPages;
  openAsset: number | null;
  onOpenAsset: (id: number | null) => void;
  onClose: () => void;
  actions?: React.ReactNode;
  infospaceId: number;
  runId: number;
  schemas: AnnotationSchemaRead[];
  className?: string;
}) {
  return (
    <div
      className={cn('pointer-events-none absolute inset-y-3 right-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-col gap-2', className)}
      style={{ width: DRILL_W }}
    >
      <AssetListCard
        className={cn('pointer-events-auto', openAsset != null ? 'max-h-[40%] shrink-0' : 'max-h-full')}
        subject={subject}
        context={context}
        items={pages.items}
        total={pages.total}
        loading={pages.loading}
        stale={pages.stale}
        error={pages.error}
        hasMore={pages.hasMore}
        onMore={pages.more}
        openId={openAsset}
        onOpen={(id) => onOpenAsset(openAsset === id ? null : id)}
        onClose={onClose}
        actions={actions}
      />
      {openAsset != null && (
        <AssetDetailCard
          className="pointer-events-auto min-h-0 flex-1"
          assetId={openAsset}
          runId={runId}
          infospaceId={infospaceId}
          schemas={schemas}
          highlight={subject.name}
          onBack={() => onOpenAsset(null)}
          onClose={onClose}
        />
      )}
    </div>
  );
}
