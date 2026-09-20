'use client';

/**
 * The layer stack — what the graph is made of, in the model's own order.
 *
 * Replaces `GraphSourcesPopover`, which listed arrays and let you bind a time
 * and a place to each. That was the right instinct and the wrong altitude: the
 * projections are not a flat list of sources, they are the four tiers of the
 * observation model, and reading them in that order tells you what the graph
 * IS before you touch anything.
 *
 * ```
 *   GROUNDS      evidence          on whose word
 *   CLAIMS       observations · attributes · relations
 *   REFERENTS    events            the occasion
 *   POPULATIONS  actors · instruments · places · interests
 * ```
 *
 * Everything shown is **resolved by the engine and returned on the wire**
 * (`meta.layers`), never re-derived here. A configuration surface that
 * re-derives what it is configuring will eventually describe a projection set
 * that is not the one in play — which is precisely the bug this replaces, where
 * the axis popover wrote `cfg.source` and the engine ignored it whenever
 * derivation succeeded.
 *
 * Counts are live. `evidence 0` and `instruments 0` should be visible at a
 * glance, because an empty layer is the most common reason a pane is blank and
 * the least visible from the canvas.
 */
import React, { useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Layers, Eye, EyeOff, PanelRight, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  HUD_LABEL, HUD_PROSE, HUD_SURFACE, HudButton, HudGroup, HudOverline,
  HudReadout,
} from '@/components/ui/chrome';

/** One resolved projection, as the engine ran it. Mirrors `_graph_meta`. */
export interface GraphLayer {
  path: string;
  about: string | null;
  node_kind: 'occurrence' | 'entity';
  roles: string[];
  bound: string[];
  nodes: number;
  edges: number;
}

/** How a layer participates. Each maps onto machinery that already exists. */
export type LayerShow = 'canvas' | 'pane' | 'linked' | 'off';

export interface LayerView {
  [path: string]: LayerShow;
}

interface Props {
  layers: GraphLayer[];
  view: LayerView;
  onViewChange: (next: LayerView) => void;
  /** The legacy single-array field, shown only when nothing resolved. */
  legacyField?: string | null;
}

// ─── The model's own order ───────────────────────────────────────────────────

const TIERS: Array<{ id: string; label: string; hint: string; match: (l: GraphLayer) => boolean }> = [
  {
    id: 'grounds', label: 'GROUNDS', hint: 'On whose word. Not positioned — an exhibit belongs in a pane, on hover, in the drawer.',
    match: l => l.node_kind === 'entity' && l.about === 'self',
  },
  {
    id: 'claims', label: 'CLAIMS', hint: 'What is asserted. The connective tissue — numerous, and it connects rather than sits.',
    match: l => l.about === 'self' || l.about === 'between'
      || (!!l.about && l.about !== 'self' && l.about !== 'between'),
  },
  {
    id: 'populations', label: 'POPULATIONS', hint: 'Who, what, where and why. Declared once; every name used anywhere refers to these.',
    match: l => l.about === null,
  },
];

/** `about` in words. The one authoring choice, and the thing that decides
 *  whether a row becomes a node, a property or a connection. */
function aboutLabel(l: GraphLayer): string {
  if (l.about === null) return 'roster';
  if (l.about === 'self') return l.node_kind === 'entity' ? 'grounds' : 'act';
  if (l.about === 'between') return 'edge';
  return `property of ${l.about}`;
}

const SHOW: Array<{ id: LayerShow; icon: React.ElementType; label: string; hint: string }> = [
  { id: 'canvas', icon: Eye, label: 'Canvas', hint: 'Drawn in the graph.' },
  { id: 'pane', icon: PanelRight, label: 'Pane',
    hint: 'Read as a list beside the canvas rather than drawn in it.' },
  { id: 'linked', icon: Link2, label: 'Linked',
    hint: 'In the data but not on screen — still counts for degree, still routes a traversal, still fills panes.' },
  { id: 'off', icon: EyeOff, label: 'Off',
    hint: 'Not fetched at all. The scan never happens.' },
];

const isEmpty = (l: GraphLayer) => l.nodes === 0 && l.edges === 0;

export function GraphLayersPopover({
  layers, view, onViewChange, legacyField,
}: Props) {
  const tiered = useMemo(() => {
    const seen = new Set<string>();
    return TIERS.map(t => {
      const rows = layers.filter(l => !seen.has(l.path) && t.match(l));
      rows.forEach(l => seen.add(l.path));
      return { ...t, rows };
    }).filter(t => t.rows.length);
  }, [layers]);

  const live = layers.filter(l => (view[l.path] ?? 'canvas') !== 'off').length;
  const blank = layers.filter(isEmpty).length;

  const set = (path: string, show: LayerShow) =>
    onViewChange({ ...view, [path]: show });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <HudButton
          icon={Layers}
          count={live || layers.length || 1}
          tone={blank > 0 ? 'warn' : 'neutral'}
          title={blank > 0
            ? `${blank} layer${blank === 1 ? '' : 's'} produced nothing`
            : 'What the graph is made of'}
        >
          Layers
        </HudButton>
      </PopoverTrigger>

      <PopoverContent align="end" className={cn(HUD_SURFACE, 'w-[26rem] p-0')}>
        <div className="flex items-baseline gap-2 border-b border-hud-line px-3 py-2">
          <span className="text-[11px] font-medium text-hud-fg">Layers</span>
          <span className={cn(HUD_PROSE, 'text-hud-dimmer')}>
            what the graph is made of
          </span>
        </div>

        <div className="space-y-3 p-2.5">
          {layers.length === 0 && (
            <p className={cn(HUD_PROSE, 'rounded-lg border border-hud-line px-2.5 py-2 text-hud-dim')}>
              Nothing resolved yet. A schema written in the observation model
              graphs itself — its sections become layers with no configuration.
              {legacyField && (
                <> This panel is on the pre-projections field{' '}
                  <code className="font-mono text-hud-fg">{legacyField}</code>.</>
              )}
            </p>
          )}

          <TooltipProvider delayDuration={200}>
            {tiered.map(t => (
              <section key={t.id} className="space-y-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="cursor-help">
                      <HudOverline>{t.label}</HudOverline>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[16rem] text-xs">
                    {t.hint}
                  </TooltipContent>
                </Tooltip>

                <div className="space-y-1">
                  {t.rows.map(l => {
                    const show = view[l.path] ?? 'canvas';
                    const empty = isEmpty(l);
                    return (
                      <div
                        key={l.path}
                        className={cn('rounded-lg border border-hud-line px-2.5 py-2',
                                      empty && 'opacity-60')}
                      >
                        <div className="flex items-center gap-1.5">
                          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-hud-fg">
                            {l.path.replace(/^document\./, '').replace('[*]', '')}
                          </code>
                          <span className={cn(HUD_LABEL, 'shrink-0 text-hud-dimmer')}>
                            {aboutLabel(l)}
                          </span>
                          <HudReadout>{l.nodes}n {l.edges}e</HudReadout>
                        </div>

                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            {l.roles.slice(0, 6).map(r => (
                              <span key={r} className="text-[10px] text-hud-dim">{r}</span>
                            ))}
                            {l.roles.length > 6 && (
                              <span className="text-[10px] text-hud-dimmer">
                                +{l.roles.length - 6}
                              </span>
                            )}
                            {l.bound.map(bnd => (
                              <span key={bnd}
                                className="rounded border border-hud-line px-1 text-[9px] text-hud-dimmer">
                                {bnd}
                              </span>
                            ))}
                          </div>

                          <HudGroup size="sm" className="shrink-0">
                            {SHOW.map(s => (
                              <HudButton
                                key={s.id}
                                icon={s.icon}
                                active={show === s.id}
                                onClick={() => set(l.path, s.id)}
                                aria-label={s.label}
                                title={`${s.label} — ${s.hint}`}
                              />
                            ))}
                          </HudGroup>
                        </div>

                        {empty && (
                          <p className={cn(HUD_PROSE, 'mt-1.5 text-amber-600 dark:text-amber-400')}>
                            Produced nothing — the section is declared and the
                            rows are empty.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </TooltipProvider>
        </div>
      </PopoverContent>
    </Popover>
  );
}
