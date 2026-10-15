'use client';

import React, { useEffect, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import type { AnnotationRunRead, AnnotationSchemaRead } from '@/client';
import AssetDetailView from '@/components/collection/assets/Views/AssetDetailView';
import AnnotationResultDisplay from '@/components/collection/annotation/AnnotationResultDisplay';
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { HudButton, HudOverline, HudReadout, HUD_PROSE } from '@/components/ui/chrome';
import { useAssetRunResults } from '@/lib/annotations/ledger';
import { cn } from '@/lib/utils';

/**
 * One asset, opened beside the list it was picked from: what this run made of
 * it first — the reason you are looking — then the asset itself. It comes and
 * goes with the pick, and scrolls itself into view when it comes, the way a
 * new window opens into the strip next to the one that asked for it.
 */
export function RunAssetDetailColumn({
  assetId,
  run,
  schemas,
  onClose,
}: {
  assetId: number;
  run: AnnotationRunRead;
  schemas: AnnotationSchemaRead[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const results = useAssetRunResults(assetId, run.id, run.infospace_id);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [assetId]);

  return (
    <section
      ref={ref}
      aria-label="Asset"
      data-run-column="detail"
      className="flex h-full w-[28rem] shrink-0 snap-start flex-col border-r border-hud-line bg-background"
    >
      <div className="px-4 pb-2 pt-4">
        <HudOverline
          trailing={
            <HudButton size="sm" icon={X} onClick={onClose} title="Close" aria-label="Close the asset" className="border-transparent" />
          }
        >
          Asset <HudReadout className="ml-1">{assetId}</HudReadout>
        </HudOverline>
      </div>

      <TextSpanHighlightProvider>
        <div className="scroll-edges min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-2 px-4 pb-4">
            {results == null ? (
              <p className={cn(HUD_PROSE, 'flex items-center gap-2 text-hud-dimmer')}>
                <Loader2 className="h-3 w-3 animate-spin" /> Reading this run's annotations…
              </p>
            ) : results.length === 0 ? (
              <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>Not annotated by this run yet.</p>
            ) : (
              results.map((result) => {
                const schema = schemas.find((s) => s.id === result.schema_id);
                if (!schema) return null;
                return (
                  <div key={result.id} className="rounded-lg border border-hud-line p-2.5">
                    <AnnotationResultDisplay result={result} schema={schema} compact={false} renderContext="enhanced" />
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-hud-line">
            <AssetDetailView
              selectedAssetId={assetId}
              schemas={schemas}
              onEdit={() => {}}
              highlightAssetIdOnOpen={null}
              enableHighlighting
              onClose={onClose}
            />
          </div>
        </div>
      </TextSpanHighlightProvider>
    </section>
  );
}
