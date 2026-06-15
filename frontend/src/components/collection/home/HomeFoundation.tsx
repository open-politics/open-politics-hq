'use client';

import Link from 'next/link';
import { FileText, FolderOpen, Microscope, Plus, Star } from 'lucide-react';
import { HomePanel, HomeRow, HomeEmpty, relTime } from './HomePanel';
import type { AnnotationSchemaRead, BundleRead } from '@/client';
import type { AssetFeedItem } from '@/components/collection/assets/Feed/types';

/**
 * Foundation tier — the load-bearing materials. Assets (your data) and Schemas
 * (how you read it) get `emphasis` weight so they sit above the work modules.
 */

const ASSETS_HREF = '/hq/infospaces/asset-manager';
const SCHEMAS_HREF = '/hq/infospaces/annotation-schemes';

export function HomeAssetsPanel({ items, total, isLoading, favoriteBundles = [], onAssetClick, onBundleClick }: { items: AssetFeedItem[]; total: number | null; isLoading: boolean; favoriteBundles?: BundleRead[]; onAssetClick?: (assetId: number) => void; onBundleClick?: (bundleId: number) => void }) {
  return (
    <HomePanel icon={FileText} tone="green" title="Assets" subtitle="Your documents & data" count={total} href={ASSETS_HREF} action={{ label: 'all', href: ASSETS_HREF }} emphasis>
      <div className="space-y-0.5">
        {/* Favorited bundles lead the card */}
        {favoriteBundles.slice(0, 3).map((b) => (
          <HomeRow
            key={`bundle-${b.id}`}
            href={onBundleClick ? undefined : ASSETS_HREF}
            onClick={onBundleClick ? () => onBundleClick(b.id) : undefined}
            leading={
              <span className="relative shrink-0">
                <FolderOpen className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                <Star className="absolute -right-1 -top-1 h-2 w-2 fill-amber-400 text-amber-500" />
              </span>
            }
            label={b.name}
            meta={b.asset_count != null ? b.asset_count.toLocaleString() : undefined}
          />
        ))}
        {/* Most-recent assets */}
        {items.slice(0, 4).map((it) => (
          <HomeRow
            key={it.asset.id}
            href={onAssetClick ? undefined : ASSETS_HREF}
            onClick={onAssetClick ? () => onAssetClick(it.asset.id) : undefined}
            label={it.asset.title || `Asset ${it.asset.id}`}
            meta={relTime(it.asset.created_at)}
          />
        ))}
        {!isLoading && items.length === 0 && favoriteBundles.length === 0 && <HomeEmpty action={{ label: 'Add data', href: ASSETS_HREF }}>No assets yet.</HomeEmpty>}
      </div>
      <FoundationAction href={ASSETS_HREF} label="Add data" />
    </HomePanel>
  );
}

export function HomeSchemasPanel({ items, total, isLoading, onSchemaClick }: { items: AnnotationSchemaRead[]; total: number; isLoading: boolean; onSchemaClick?: (schema: AnnotationSchemaRead) => void }) {
  return (
    <HomePanel icon={Microscope} tone="sky" title="Schemas" subtitle="How you read your data" count={total} href={SCHEMAS_HREF} action={{ label: 'all', href: SCHEMAS_HREF }} emphasis>
      <div className="space-y-0.5">
        {items.slice(0, 4).map((s) => (
          <HomeRow
            key={s.id}
            href={onSchemaClick ? undefined : SCHEMAS_HREF}
            onClick={onSchemaClick ? () => onSchemaClick(s) : undefined}
            label={s.name}
            meta={relTime(s.created_at)}
          />
        ))}
        {!isLoading && items.length === 0 && <HomeEmpty action={{ label: 'New schema', href: SCHEMAS_HREF }}>No schemas yet.</HomeEmpty>}
      </div>
      <FoundationAction href={SCHEMAS_HREF} label="New schema" />
    </HomePanel>
  );
}

function FoundationAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-mx-1.5 mt-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <Plus className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}
