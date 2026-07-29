/**
 * Load Renderer
 *
 * The operator's `load` meta-tool pulls operations/sets/a scenario into its tool set.
 * That's plumbing — barely worth a line. One quiet row: "↧ Loaded analysis_hub".
 */

import React from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps } from '../shared/types';
import { Download, Play } from 'lucide-react';

export const LoadRenderer: ToolResultRenderer = {
  toolName: 'load',

  canHandle: (r: any) =>
    !!r && (r.kind === 'load' || r.kind === 'scenario' || Array.isArray(r.loaded)),

  getSummary: (r: any) => {
    if (r?.kind === 'scenario' && r?.scenario) return `loaded scenario ${r.scenario}`;
    return `loaded ${(r?.loaded ?? []).join(', ') || '(none)'}`;
  },

  render: ({ result }: ToolResultRenderProps) => {
    const loaded: string[] = result?.loaded ?? [];
    const unknown: string[] = result?.unknown ?? [];
    const isScenario = result?.kind === 'scenario';
    const Icon = isScenario ? Play : Download;
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary/70" />
        <span className="min-w-0 truncate">
          {isScenario ? (
            <>Loaded scenario <span className="text-foreground">{result?.scenario}</span></>
          ) : loaded.length ? (
            <>Loaded <span className="text-foreground">{loaded.join(', ')}</span></>
          ) : (
            'Loaded (nothing new)'
          )}
          {unknown.length > 0 && (
            <span className="text-amber-600 dark:text-amber-400"> · unknown: {unknown.join(', ')}</span>
          )}
        </span>
      </div>
    );
  },
};
