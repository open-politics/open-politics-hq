'use client';

import React from 'react';
import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBundleStore } from '@/zustand_stores/storeBundles';

/**
 * Inline rendering for a `{{bundle:ID}}` marker — the bundle counterpart to
 * AssetEmbed. Resolves the name from the bundle store (falls back to the id).
 */
export default function BundleEmbed({
  bundleId,
  onBundleClick,
  interactive = true,
}: {
  bundleId: number;
  onBundleClick?: (id: number) => void;
  interactive?: boolean;
}) {
  const bundles = useBundleStore((s) => s.bundles);
  const bundle = bundles.find((b) => b.id === bundleId);

  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={() => onBundleClick?.(bundleId)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-sm',
        interactive && onBundleClick && 'cursor-pointer hover:bg-muted/60',
      )}
    >
      <FolderOpen className="size-3.5 text-amber-600" />
      <span className="font-medium">{bundle?.name ?? `Bundle #${bundleId}`}</span>
      {typeof bundle?.asset_count === 'number' && (
        <span className="text-xs text-muted-foreground">· {bundle.asset_count}</span>
      )}
    </button>
  );
}
