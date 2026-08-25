'use client';

/**
 * ResizeHandle — drag a region wider.
 *
 * The side columns were fixed at 300px and 240px, which is enough for a name
 * and a count. It is not enough for a table of eight columns, and the table is
 * now the surface a reader actually spends time in — so the width has to be
 * theirs, not the stylesheet's.
 *
 * Pointer events rather than mouse events, and `setPointerCapture` rather than
 * window listeners: capture keeps the drag attached to this element even when
 * the pointer crosses the canvas underneath, which is exactly what happens
 * every time (the canvas is a `<canvas>` that swallows events). Without it a
 * fast drag detaches halfway and the column stops following the hand.
 *
 * The handle is 5px of hit area around a 1px line. A grab target the width of
 * its own border is a target people miss.
 */
import React, { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { REGION_AXIS, clampRegion, type PaneRegion } from './paneTypes';

export interface ResizeHandleProps {
  region: PaneRegion;
  /** Current size in px — width for the side columns, height for `bottom`. */
  size: number;
  /** Live, on every move: the layout follows the hand. */
  onResize: (px: number) => void;
  /** On release. Separate because persisting every frame writes the panel
   *  config sixty times a second, and a drag is one decision. */
  onCommit?: (px: number) => void;
  className?: string;
}

export function ResizeHandle({
  region, size, onResize, onCommit, className,
}: ResizeHandleProps) {
  const start = useRef<{ at: number; from: number } | null>(null);
  const { axis, sign } = REGION_AXIS[region];
  const vertical = axis === 'x';

  const down = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { at: vertical ? e.clientX : e.clientY, from: size };
  }, [size, vertical]);

  const move = useCallback((e: React.PointerEvent) => {
    if (!start.current) return;
    const now = vertical ? e.clientX : e.clientY;
    onResize(clampRegion(region, start.current.from + (now - start.current.at) * sign));
  }, [onResize, region, sign, vertical]);

  const up = useCallback((e: React.PointerEvent) => {
    if (!start.current) return;
    const now = vertical ? e.clientX : e.clientY;
    const px = clampRegion(region, start.current.from + (now - start.current.at) * sign);
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit?.(px);
  }, [onCommit, region, sign, vertical]);

  /** Keyboard, because a drag-only control is unusable to anyone who cannot
   *  drag — and because 16px steps are more precise than a hand anyway. */
  const key = useCallback((e: React.KeyboardEvent) => {
    const map: Record<string, number> = vertical
      ? { ArrowLeft: -16, ArrowRight: 16 }
      : { ArrowUp: -16, ArrowDown: 16 };
    const d = map[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const px = clampRegion(region, size + d * sign);
    onResize(px);
    onCommit?.(px);
  }, [onCommit, onResize, region, sign, size, vertical]);


  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={`Resize the ${region} panel`}
      aria-valuenow={size}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      // `touch-none` or a touch drag scrolls the page instead of resizing.
      className={cn(
        'pointer-events-auto absolute z-20 touch-none',
        'focus-visible:outline-none',
        vertical
          ? cn('top-0 bottom-0 w-[5px] cursor-col-resize',
               region === 'left' ? '-right-[3px]' : '-left-[3px]')
          : '-top-[3px] left-0 right-0 h-[5px] cursor-row-resize',
        className,
      )}
    />
  );
}

export default ResizeHandle;
