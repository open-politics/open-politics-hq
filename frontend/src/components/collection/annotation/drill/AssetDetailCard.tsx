'use client';

/**
 * One asset, opened from the overview's list — the asset manager's own detail
 * view, then what this run made of it, in one scrolling column.
 *
 * A panel on the map rather than a sheet over it: the place or name you came
 * from stays in view above. The run's annotations follow the document instead
 * of leading it (the runner's detail column leads with them): here the reader
 * arrives from *where* or *who*, and reads the source before the extraction.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import type { AnnotationSchemaRead } from '@/client';
import { cn } from '@/lib/utils';
import AssetDetailView from '@/components/collection/assets/Views/AssetDetailView';
import AnnotationResultDisplay from '@/components/collection/annotation/AnnotationResultDisplay';
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { HUD_PROSE, HudOverline } from '@/components/ui/chrome';
import { useAssetRunResults } from '@/lib/annotations/ledger';

export function AssetDetailCard({
  assetId, runId, infospaceId, schemas, highlight, onBack, onClose, className,
}: {
  assetId: number;
  runId: number;
  infospaceId: number;
  schemas: AnnotationSchemaRead[];
  /** The place or name the asset was opened for, marked where it appears. */
  highlight?: string | null;
  onBack: () => void;
  onClose: () => void;
  className?: string;
}) {
  const results = useAssetRunResults(assetId, runId, infospaceId);

  return (
    <section
      aria-label="Asset"
      className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border border-hud-line bg-background', className)}
    >
      <TextSpanHighlightProvider>
        <div className="scroll-edges min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <AssetDetailView
            selectedAssetId={assetId}
            schemas={schemas}
            onEdit={() => {}}
            highlightAssetIdOnOpen={null}
            enableHighlighting
            onBack={onBack}
            onClose={onClose}
          />
          <div className="space-y-2 border-t border-hud-line px-4 pb-4 pt-3">
            <HudOverline>This run</HudOverline>
            {results == null ? (
              <p className={cn(HUD_PROSE, 'flex items-center gap-2 text-hud-dimmer')}>
                <Loader2 className="size-3 animate-spin" /> Reading this run&apos;s annotations…
              </p>
            ) : results.length === 0 ? (
              <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>Not annotated by this run yet.</p>
            ) : (
              results.map((result) => {
                const schema = schemas.find((s) => s.id === result.schema_id);
                if (!schema) return null;
                return (
                  <div key={result.id} className="rounded-lg border border-hud-line p-2.5">
                    <AnnotationResultDisplay
                      result={result}
                      schema={schema}
                      compact={false}
                      renderContext="enhanced"
                      highlightValue={highlight ?? null}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </TextSpanHighlightProvider>
    </section>
  );
}
