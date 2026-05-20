'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { GraphNode } from '../graphTypes';

// =============================================================================
// useMarqueeSelection — Alt+drag rectangle selection over the 2D canvas.
//
// Renders an overlay <div> that sits above the canvas. When idle, the overlay
// has ``pointer-events: none`` so the canvas receives drags/clicks normally.
// When the user holds Alt, a global keydown handler flips it to
// ``pointer-events: auto`` so it captures the next drag. Hit-test uses the
// graph2ScreenCoords method on the lib's imperative ref to project node
// world-coordinates into screen-space.
//
// 3D mode disables this entirely (the camera makes screen-space hit-test
// infeasible without raycasting). The hook returns ``overlay: null`` then.
// =============================================================================

interface MarqueeRef {
  current: {
    graph2ScreenCoords: (x: number, y: number) => { x: number; y: number };
  } | undefined | null;
}

interface UseMarqueeOptions {
  enabled: boolean;
  graphRef: MarqueeRef | { current: any };
  containerRef: React.RefObject<HTMLDivElement | null>;
  nodes: GraphNode[];
  onSelectionChange: (ids: string[]) => void;
  onClear: () => void;
  /** Tiny-movement alt+click hit-test. The marquee overlay captures
   *  pointer-down whenever Alt is held, which would otherwise swallow
   *  alt-click-on-node events meant for the pin handler. We hit-test
   *  ourselves on pointer-up and dispatch via this callback when a node
   *  is hit; falls through to ``onClear`` for empty-space alt-clicks. */
  onAltClickNode?: (node: GraphNode) => void;
}

export function useMarqueeSelection({
  enabled,
  graphRef,
  containerRef,
  nodes,
  onSelectionChange,
  onClear,
  onAltClickNode,
}: UseMarqueeOptions) {
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const draggingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  // Track Alt key globally so the overlay knows when to capture pointer events.
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) setAltHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey) setAltHeld(false);
    };
    const onBlur = () => setAltHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || !e.altKey) return;
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const r = container.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    startRef.current = { x, y };
    draggingRef.current = true;
    setRect({ x0: x, y0: y, x1: x, y1: y });
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [enabled, containerRef]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !startRef.current) return;
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const r = container.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    setRect({ x0: startRef.current.x, y0: startRef.current.y, x1: x, y1: y });
  }, [containerRef]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !startRef.current) return;
    e.preventDefault();
    const fg = (graphRef as MarqueeRef).current;
    const container = containerRef.current;
    if (!fg || !container) {
      setRect(null);
      draggingRef.current = false;
      startRef.current = null;
      return;
    }

    const r = rect ?? { x0: startRef.current.x, y0: startRef.current.y, x1: startRef.current.x, y1: startRef.current.y };
    const minX = Math.min(r.x0, r.x1);
    const minY = Math.min(r.y0, r.y1);
    const maxX = Math.max(r.x0, r.x1);
    const maxY = Math.max(r.y0, r.y1);
    const w = maxX - minX;
    const h = maxY - minY;

    setRect(null);
    draggingRef.current = false;
    startRef.current = null;

    // Tiny rect = click. The overlay swallowed the canvas's onNodeClick
    // because Alt was held, so we hit-test for a node ourselves and route
    // it to ``onAltClickNode``. Empty-space click falls through to clear.
    if (w < 5 && h < 5) {
      if (onAltClickNode) {
        const HIT_RADIUS_PX = 14; // generous click target across degree sizes
        let hit: GraphNode | null = null;
        let hitDist = HIT_RADIUS_PX;
        for (const node of nodes) {
          if (node.x == null || node.y == null) continue;
          try {
            const p = fg.graph2ScreenCoords(node.x, node.y);
            if (!p) continue;
            const d = Math.hypot(p.x - r.x0, p.y - r.y0);
            if (d <= hitDist) {
              hitDist = d;
              hit = node;
            }
          } catch {
            // graph2ScreenCoords can throw before first paint — skip.
          }
        }
        if (hit) {
          onAltClickNode(hit);
          return;
        }
      }
      onClear();
      return;
    }

    // Hit-test in screen coordinates using the lib's projection.
    const selected: string[] = [];
    for (const node of nodes) {
      if (node.x == null || node.y == null) continue;
      try {
        const p = fg.graph2ScreenCoords(node.x, node.y);
        if (!p) continue;
        if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
          selected.push(node.id);
        }
      } catch {
        // Defensive: graph2ScreenCoords can throw if called before first paint.
      }
    }
    onSelectionChange(selected);
  }, [rect, graphRef, containerRef, nodes, onClear, onSelectionChange, onAltClickNode]);

  if (!enabled) {
    return { overlay: null, altHeld: false };
  }

  // Overlay: pointer-events flip from 'none' (so canvas receives clicks) to
  // 'auto' only while Alt is held or a drag is in progress.
  const captureEvents = altHeld || draggingRef.current;
  const overlay = (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 25,
        pointerEvents: captureEvents ? 'auto' : 'none',
        cursor: captureEvents ? 'crosshair' : undefined,
      }}
    >
      {rect && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(rect.x0, rect.x1),
            top: Math.min(rect.y0, rect.y1),
            width: Math.abs(rect.x1 - rect.x0),
            height: Math.abs(rect.y1 - rect.y0),
            border: '1.5px dashed #06b6d4',
            background: 'rgba(6, 182, 212, 0.08)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );

  return { overlay, altHeld };
}
