'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { resolveEntityColor } from '@/lib/annotations/colors';
import { highlightTextInValue } from '@/lib/annotations/search';

import type { Density } from './types';

/* Entity rendering — same visual primitive whether the field is a top-level
 * vocabulary (`firmen`) or a nested participant slot (`evidenz_einheiten[*].
 * beguenstigte_firmen`). Both expand to the same `{name, type?}` shape via
 * `x-entityField`/`x-ref`, so a single component keeps identity coherent
 * across the table.
 *
 * Visual: a small type-tinted swatch + the name + a muted uppercase type.
 * Text-forward — reads as a tagged piece of data rather than a heavy pill —
 * so entity arrays flow naturally alongside the other protagonist fields in
 * the strings/first column, instead of competing visually with enum chips
 * in the lists section. Density tiers only adjust truncation, never layout. */

export interface EntityValue {
  name?: string | null;
  type?: string | null;
}

/* ── Single entity ──────────────────────────────────────────────────────── */

interface EntityCellProps {
  value: EntityValue;
  density: Density;
  searchTerm?: string;
}

export const EntityCell: React.FC<EntityCellProps> = ({ value, density, searchTerm }) => {
  const name = typeof value?.name === 'string' ? value.name : '';
  const type = typeof value?.type === 'string' ? value.type : '';
  if (!name) {
    return <span className="text-muted-foreground/50 text-xs" title="No value">×</span>;
  }
  const hex = type ? resolveEntityColor(type) : undefined;
  const displayName = searchTerm ? highlightTextInValue(name, searchTerm) : name;
  const isCompact = density === 'compact';

  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 max-w-full min-w-0 align-baseline',
        isCompact ? 'text-xs' : 'text-sm',
      )}
      title={[name, type].filter(Boolean).join(' · ')}
    >
      <span
        className="inline-block h-2 w-2 rounded-sm shrink-0 self-center"
        style={{
          backgroundColor: hex ?? 'currentColor',
          opacity: hex ? 0.9 : 0.3,
        }}
        aria-hidden
      />
      <span className="font-medium truncate text-foreground">{displayName}</span>
      {type && (
        <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/70 shrink-0">
          {type}
        </span>
      )}
    </span>
  );
};

/* ── Array of entities ──────────────────────────────────────────────────── */

interface EntityArrayCellProps {
  values: EntityValue[];
  density: Density;
  searchTerm?: string;
  /** Click handler — opens the row's full detail view. */
  onSelect?: () => void;
}

export const EntityArrayCell: React.FC<EntityArrayCellProps> = ({
  values,
  density,
  searchTerm,
  onSelect,
}) => {
  const meaningful = values.filter(
    (v) => v && typeof v === 'object' && typeof v.name === 'string' && v.name.length > 0,
  );
  if (meaningful.length === 0) {
    return <span className="text-muted-foreground/50 text-xs" title="No value">×</span>;
  }

  if (density === 'compact') {
    // Terse: count + first 2 names. Click opens detail.
    const preview = meaningful.slice(0, 2).map((v) => v.name).join(', ');
    return (
      <button
        type="button"
        className="inline-flex items-baseline gap-1 text-xs hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
        title={meaningful.map((v) => v.name).filter(Boolean).join(', ')}
      >
        <span className="text-[10px] text-muted-foreground/80 tabular-nums shrink-0">
          {meaningful.length}
        </span>
        <span className="text-muted-foreground truncate max-w-[28ch]">{preview}</span>
        {meaningful.length > 2 && (
          <span className="text-[10px] text-muted-foreground">+{meaningful.length - 2}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 items-baseline min-w-0">
      {meaningful.map((v, i) => (
        <EntityCell key={`${v.name}-${i}`} value={v} density={density} searchTerm={searchTerm} />
      ))}
    </div>
  );
};

export default EntityCell;
