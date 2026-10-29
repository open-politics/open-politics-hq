'use client';

/**
 * RoomReading — what a room is about, in words: the names inside it that
 * carry its meaning, and its passages, both read apart from the rest of the
 * run (`network.describe`). A name starts a meaning of its own; a passage
 * opens its document.
 */
import React from 'react';
import { SquareDashed } from 'lucide-react';
import type { Reading } from '@/client';
import { cn } from '@/lib/utils';
import { HUD_GLASS, HUD_LABEL, HUD_NUM, HUD_PROSE } from '@/components/ui/chrome';

export function RoomReading({
  title, hue, reading, current, loudest, onTerm, onPassage, className,
}: {
  title: string;
  hue: string;
  reading: Reading | undefined;
  /** The reading is of what the room holds now — else the next one loads. */
  current: boolean;
  /** The loudest inside, read at once. */
  loudest: readonly string[];
  onTerm: (text: string) => void;
  onPassage: (assetId: number) => void;
  className?: string;
}) {
  return (
    <section className={cn(HUD_GLASS, 'flex min-h-0 flex-col gap-1.5 overflow-y-auto px-2 py-1.5 [scrollbar-width:thin]', className)}>
      <div className="flex items-center gap-1.5">
        <SquareDashed className="size-3 shrink-0" style={{ color: hue }} />
        <span className={cn(HUD_LABEL, 'min-w-0 flex-1 truncate text-hud-dim')}>{title} · reading</span>
        {!current && <span className={cn(HUD_NUM, 'text-hud-dimmer')}>reading…</span>}
      </div>
      {loudest.length > 0 && (
        <p className={cn(HUD_PROSE, 'text-hud-dim')}>
          <span className="text-hud-dimmer">Loudest </span>{loudest.join(' · ')}
        </p>
      )}
      {reading && reading.terms.length > 0 && (
        <div className="space-y-0.5">
          <span className={cn(HUD_LABEL, 'text-hud-dimmer')}>About — the names that carry it</span>
          <div className="flex flex-wrap gap-0.5">
            {reading.terms.map((t) => (
              <button key={t.text} type="button" onClick={() => onTerm(t.text)}
                      title={`${t.similarity.toFixed(2)} toward what sets the room apart — click: a set of what is like it`}
                      className="inline-flex max-w-full items-center gap-1 rounded bg-hud-sunken px-1 py-px text-[10.5px] text-hud-fg hover:bg-hud-line">
                <span className="truncate">{t.text}</span>
                <span className={cn(HUD_NUM, 'text-hud-dimmer')}>{t.similarity.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {reading && reading.passages.length > 0 && (
        <div className="space-y-0.5">
          <span className={cn(HUD_LABEL, 'text-hud-dimmer')}>In its documents</span>
          {reading.passages.map((p) => (
            <button key={p.asset_id} type="button" onClick={() => onPassage(p.asset_id)}
                    title="Open the document"
                    className="block w-full rounded px-1 py-0.5 text-left hover:bg-hud-sunken">
              <span className="block truncate text-[10.5px] font-medium text-hud-fg">{p.title || 'Untitled'}</span>
              <span className={cn(HUD_PROSE, 'line-clamp-2 text-hud-dim')}>{p.text}</span>
            </button>
          ))}
        </div>
      )}
      <p className={cn(HUD_PROSE, 'text-[10px] text-hud-dimmer')}>
        {!reading ? 'Reading what is inside…'
          : reading.documents === 0 ? 'No document is mostly about what is inside.'
            : reading.embedded === 0 ? `None of its ${reading.documents.toLocaleString()} documents is embedded yet.`
              : `Read from ${reading.embedded.toLocaleString()} of ${reading.documents.toLocaleString()} documents, apart from the rest of the run.`}
      </p>
    </section>
  );
}
