/**
 * Catalogue Renderer
 *
 * The operator's `catalogue` meta-tool — browse operations/scenarios/docs, or read a
 * doc. A compact card (scenarios + operation paths), not a JSON dump.
 */

import React from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps } from '../shared/types';
import { Badge } from '@/components/ui/badge';
import { BookOpen, FileText, Compass } from 'lucide-react';

interface Op { path: string; name?: string; summary?: string; needs_setup?: string[] }
interface Scenario { name: string; summary?: string }

export const CatalogueRenderer: ToolResultRenderer = {
  toolName: 'catalogue',

  canHandle: (r: any) => !!r && (r.kind === 'catalogue' || r.kind === 'doc'),

  getSummary: (r: any) => {
    if (r?.kind === 'doc') return `read ${r.path}`;
    const n = r?.operations?.length ?? 0;
    return n ? `catalogue · ${n} ops` : 'catalogue';
  },

  render: ({ result }: ToolResultRenderProps) => {
    // A doc read (or missing doc) — one quiet line.
    if (result?.kind === 'doc' || result?.error === 'doc_not_found') {
      const missing = result?.error === 'doc_not_found';
      return (
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
          <FileText className={`h-4 w-4 shrink-0 ${missing ? 'text-muted-foreground' : 'text-primary/70'}`} />
          <span className="min-w-0 truncate">
            {missing ? 'No doc at ' : 'Read '}<span className="font-mono text-xs">{result?.path}</span>
          </span>
        </div>
      );
    }

    const operations: Op[] = result?.operations ?? [];
    const scenarios: Scenario[] = result?.scenarios ?? [];

    return (
      <div className="space-y-2.5 rounded-md border bg-card p-3 text-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Compass className="h-4 w-4 text-primary/70" />
          <span className="font-medium">Catalogue</span>
          {operations.length > 0 && <Badge variant="secondary" className="h-5">{operations.length} ops</Badge>}
          {scenarios.length > 0 && <Badge variant="secondary" className="h-5">{scenarios.length} scenarios</Badge>}
        </div>

        {scenarios.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <BookOpen className="h-3 w-3" /> Scenarios
            </div>
            {scenarios.map((sc) => (
              <div key={sc.name} className="flex gap-2 text-xs leading-snug">
                <span className="shrink-0 font-mono text-primary/80">{sc.name}</span>
                <span className="min-w-0 truncate text-muted-foreground">{sc.summary}</span>
              </div>
            ))}
          </div>
        )}

        {operations.length > 0 && (
          <div className="space-y-0.5">
            {operations.slice(0, 12).map((o) => (
              <div key={o.path} className="flex items-center gap-2 text-xs leading-snug">
                <span className="shrink-0 font-mono text-muted-foreground">{o.path}</span>
                <span className="min-w-0 flex-1 truncate">{o.summary}</span>
                {o.needs_setup && o.needs_setup.length > 0 && (
                  <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">needs setup</span>
                )}
              </div>
            ))}
            {operations.length > 12 && (
              <div className="pt-0.5 text-[11px] text-muted-foreground">+{operations.length - 12} more</div>
            )}
          </div>
        )}
      </div>
    );
  },
};
