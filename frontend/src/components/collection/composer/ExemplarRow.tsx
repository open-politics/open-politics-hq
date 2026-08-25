'use client';

/**
 * ExemplarRow — one row, as filled as the data allows, edited in place.
 *
 * **What you toggle is what you get.** The cells are drawn by the surface's own
 * renderer — `TypedCell` for the table, `Value` for the graph — so a date reads
 * as a date, an entity as a badge, a list as a mini-table. A picker that shows
 * field *names* asks you to imagine the result; this one shows it.
 *
 * **It is deliberately not a true row.** Row 1 may leave `via` empty where row 4
 * fills it, and a picker built on row 1 would understate the schema. Each cell
 * takes the first loaded row that HAS a value, so the composite answers *what
 * could a result look like* rather than *what does this one happen to say*.
 * That is also why it is labelled as composite rather than presented as a
 * record — it is a template, and mistaking it for a document would be the one
 * way this surface could mislead.
 *
 * Fields no loaded row filled are stated underneath instead of drawn as empty
 * cells: an empty cell reads as "this field is broken", a named absence reads
 * as "nothing here said this", and only the second is true.
 */
import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { GripVertical, Plus } from 'lucide-react';
import type { ComposerField } from './composerModel';

interface Props {
  /** Every field of the grain, in palette order. */
  fields: ComposerField[];
  /** Selected ids, in display order — the row's columns. */
  selected: string[];
  onToggle: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  renderCell: (field: ComposerField, value: unknown) => React.ReactNode;
  /** Refuse to remove the last column, where the surface cannot store "none". */
  atFloor?: boolean;
  /** The surface's OWN whole-row rendering, when it has one. The table groups a
   *  schema's fields into a single cell — three sections, strings | numerics |
   *  lists — and slicing that into per-field columns would preview a layout the
   *  table never draws. Given this, the columnar fallback is not used and the
   *  rail below becomes the control surface. */
  preview?: React.ReactNode;
}

export function ExemplarRow({
  fields, selected, onToggle, onReorder, renderCell, atFloor, preview,
}: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const byId = new Map(fields.map(f => [f.id, f]));
  const shown = selected
    .map(id => byId.get(id))
    .filter((f): f is ComposerField => Boolean(f));

  const off = fields.filter(f => !selected.includes(f.id));
  // Two different absences, and conflating them is what makes a picker lie.
  const offWithValues = off.filter(f => f.filled > 0);
  const neverFilled = off.filter(f => f.filled === 0);

  // The surface draws its own row — show exactly that, and control it from the
  // rail beneath rather than by carving the cell into columns.
  if (preview !== undefined) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border bg-background p-2">{preview}</div>
        <FieldRail
          fields={fields}
          selected={selected}
          onToggle={onToggle}
          atFloor={atFloor}
        />
        <NeverFilled fields={neverFilled} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── The row ── */}
      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {shown.map((f, i) => (
                <th
                  key={f.id}
                  draggable
                  onDragStart={() => setDragFrom(i)}
                  onDragOver={e => { e.preventDefault(); setOver(i); }}
                  onDragEnd={() => { setDragFrom(null); setOver(null); }}
                  onDrop={() => {
                    if (dragFrom != null) onReorder(dragFrom, i);
                    setDragFrom(null); setOver(null);
                  }}
                  className={cn(
                    'group cursor-grab select-none border-b border-r px-2 py-1 text-left align-bottom last:border-r-0',
                    dragFrom === i && 'opacity-40',
                    over === i && dragFrom !== i && 'border-l-2 border-l-primary',
                  )}
                  title="Drag to reorder · click × to hide"
                >
                  <div className="flex items-center gap-1">
                    <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-60" />
                    <span className="truncate text-[11px] font-medium">{f.label}</span>
                    {f.source === 'shape' && (
                      <span
                        className="shrink-0 text-[9px] text-amber-600 dark:text-amber-400"
                        title="Found in the data — the schema did not declare this field"
                      >
                        ~
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={atFloor}
                      onClick={() => onToggle(f.id)}
                      className={cn(
                        'ml-auto shrink-0 rounded px-1 text-[11px] leading-none text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground',
                        atFloor && 'cursor-not-allowed opacity-0',
                      )}
                      title={atFloor ? 'Keep at least one field' : 'Hide this field'}
                    >
                      ×
                    </button>
                  </div>
                  <div className="pl-4 text-[9px] font-normal text-muted-foreground">
                    {f.filled}/{f.sampled}
                  </div>
                </th>
              ))}
              {shown.length === 0 && (
                <th className="px-3 py-6 text-center text-[11px] font-normal italic text-muted-foreground">
                  Nothing selected.
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            <tr>
              {shown.map(f => (
                <td
                  key={f.id}
                  className="max-w-[260px] border-r px-2 py-1.5 align-top last:border-r-0"
                >
                  {f.exemplar === undefined ? (
                    <span className="text-[11px] italic text-muted-foreground/60">
                      empty in every loaded row
                    </span>
                  ) : (
                    renderCell(f, f.exemplar)
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── What is off. Click to add — the same gesture, the other way. ── */}
      {offWithValues.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Hidden
          </span>
          {offWithValues.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => onToggle(f.id)}
              title={f.samples.length ? f.samples.slice(0, 3).join(' · ') : undefined}
              className="inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-solid hover:text-foreground"
            >
              <Plus className="h-2.5 w-2.5" />
              {f.label}
              <span className="opacity-50">{f.filled}</span>
            </button>
          ))}
        </div>
      )}

      <NeverFilled fields={neverFilled} />
    </div>
  );
}

/** Every field, shown or not — the control surface when the preview is the
 *  surface's own. Solid = drawn, dashed = hidden; the fill count is the reason
 *  to care about either. */
function FieldRail({
  fields, selected, onToggle, atFloor,
}: {
  fields: ComposerField[];
  selected: string[];
  onToggle: (id: string) => void;
  atFloor?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {fields.map(f => {
        const on = selected.includes(f.id);
        const locked = Boolean(atFloor) && on;
        return (
          <button
            key={f.id}
            type="button"
            disabled={locked}
            onClick={() => onToggle(f.id)}
            title={[
              `${f.filled}/${f.sampled} loaded rows`,
              f.source === 'shape' ? 'found in the data, not declared' : null,
              f.samples.slice(0, 3).join(' · ') || null,
              locked ? 'keep at least one field' : null,
            ].filter(Boolean).join(' — ')}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors',
              on
                ? 'border bg-muted/60 text-foreground'
                : 'border border-dashed text-muted-foreground hover:text-foreground',
              locked && 'cursor-not-allowed opacity-60',
            )}
          >
            {f.label}
            {f.source === 'shape' && (
              <span className="text-[9px] text-amber-600 dark:text-amber-400">~</span>
            )}
            <span className="tabular-nums opacity-50">{f.filled}</span>
          </button>
        );
      })}
    </div>
  );
}

function NeverFilled({ fields }: { fields: ComposerField[] }) {
  if (fields.length === 0) return null;
  return (
    <p className="text-[10px] leading-relaxed text-muted-foreground">
      <span className="uppercase tracking-wide">Empty in all loaded rows</span>
      {' — '}
      {fields.map(f => f.label).join(' · ')}
      {'. '}
      <span className="italic opacity-70">
        Declared, but nothing loaded filled them.
      </span>
    </p>
  );
}
