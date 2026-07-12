'use client';

import * as React from 'react';
import { useDock } from '@/zustand_stores/storeDock';
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import AssetDetailView from '@/components/collection/assets/Views/AssetDetailView';
import BundleDetailView from '@/components/collection/assets/Views/BundleDetailView';
import ArticleComposer from '@/components/collection/assets/Composer/ArticleComposer';
import { DiscoverPanel } from './discover/DiscoverPanel';
import { SourceForm } from './sources/SourceForm';
import { RunDock } from '@/components/collection/chat/observe/RunDock';
import { useChatStore } from '@/zustand_stores/storeChat';

/**
 * Renders whatever the dock store currently holds. The dock owns NO chrome row of
 * its own — navigation (← back / × close) is handed to each content, which renders
 * it inside its own top row (search bar, title field, detail header). So there's
 * never a dead title bar. The single place that knows the key→component map.
 */
export function DockHost() {
  const entry = useDock((s) => s.entry);
  const back = useDock((s) => s.back);
  const close = useDock((s) => s.close);
  const openAsset = useDock((s) => s.openAsset);
  const openComposer = useDock((s) => s.openComposer);

  if (!entry) return null;

  // Intake / authoring content is container-agnostic — `mode: 'panel'` tells it
  // it's docked (so it renders the back/close in its own header).
  const contentProps = { mode: 'panel' as const, fullscreen: false, close, back, escalate: () => {} };

  let body: React.ReactNode = null;
  switch (entry.key) {
    case 'assetDetail':
      body = (
        <TextSpanHighlightProvider>
          <AssetDetailView
            selectedAssetId={entry.init.assetId}
            highlightAssetIdOnOpen={entry.init.assetId}
            fromBundleId={entry.init.fromBundleId ?? null}
            schemas={[]}
            onEdit={(asset) => { if (asset?.kind === 'article') openComposer({ mode: 'edit', assetId: asset.id }); }}
            onBack={back}
            onClose={close}
          />
        </TextSpanHighlightProvider>
      );
      break;
    case 'bundleDetail':
      body = (
        <TextSpanHighlightProvider>
          <BundleDetailView
            selectedBundleId={entry.init.bundleId}
            selectedAssetId={null}
            onAssetSelect={(id) => { if (id) openAsset(id, entry.init.bundleId); }}
            highlightAssetId={null}
            onBack={back}
            onClose={close}
          />
        </TextSpanHighlightProvider>
      );
      break;
    case 'discover':
      body = <DiscoverPanel init={entry.init} {...contentProps} />;
      break;
    case 'sourceForm': {
      // Stage-then-confirm: if the chat staged this form (carries a return token),
      // resolve it on commit/cancel so the model resumes with the outcome.
      const returnToken = (entry.init as any)?.__returnToken as string | undefined;
      const finish = (status: string) => {
        if (returnToken) useChatStore.getState().resolveReturn(returnToken, { status });
        close();
      };
      body = (
        <SourceForm
          init={entry.init}
          {...contentProps}
          close={() => finish('cancelled')}
          onSuccess={() => finish('created')}
        />
      );
      break;
    }
    case 'composer':
      body = <ArticleComposer init={entry.init} {...contentProps} />;
      break;
    case 'runDashboard':
      body = <RunDock runId={entry.init.runId} onBack={back} onClose={close} />;
      break;
  }

  return <div className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-background/60">{body}</div>;
}
