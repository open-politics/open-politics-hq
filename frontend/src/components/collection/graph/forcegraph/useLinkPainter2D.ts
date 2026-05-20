'use client';

import { useCallback, useMemo } from 'react';
import { resolvePredicateColor, type ColorOverrides } from '@/lib/annotations/colors';
import { nodeRadius, type ActiveSubNetwork, type GraphEdge, type GraphNode, type GraphViewConfig, type SubNetworkColor } from '../graphTypes';
import type { ThemeTokens } from './resolveNodeStyle';

const SUB_NETWORK_HEX: Record<SubNetworkColor, string> = {
  amber: '#f59e0b',
  blue: '#3b82f6',
};

// =============================================================================
// useLinkPainter2D — returns a ``linkCanvasObject`` callback that paints, in
// the ``after`` layer (after the stock line + forward arrow), three things:
//   1. Backward arrow (when ``predicateArrows[predicate]`` is 'backward' or 'both')
//   2. Edge label at midpoint (when ``config.showEdgeLabels`` is on)
//   3. Hover halo (slight thickening when ``hoveredLinkId`` matches)
//
// The stock ``linkColor`` / ``linkWidth`` / ``linkDirectionalArrowLength`` /
// ``linkDirectionalArrowColor`` props handle the line itself + forward arrow.
// =============================================================================

type LinkPainter = (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => void;

interface PainterDeps {
  theme: ThemeTokens;
  colorOverrides?: ColorOverrides;
  predicateArrows?: Record<string, 'forward' | 'backward' | 'both' | 'none'>;
  config: GraphViewConfig;
  hoveredLinkId: string | null;
  /** Active sub-networks (node-focus, asset-lens, edge-nav, future pin
   *  board). Painter checks edge membership against each in order — first
   *  match wins for colour + halo. Empty array ⇒ ambient render. */
  activeSubNetworks: ActiveSubNetwork[];
  degreeMap: Map<string, number>;
  edgeWidthFn: (edge: GraphEdge) => number;
}

function getArrowDir(
  predicate: string,
  predicateArrows: Record<string, 'forward' | 'backward' | 'both' | 'none'> | undefined,
  showEdgeArrows: boolean,
): 'forward' | 'backward' | 'both' | 'none' {
  if (!showEdgeArrows) return 'none';
  if (!predicateArrows) return 'forward';
  const lower = predicate?.toLowerCase?.() ?? '';
  for (const [k, v] of Object.entries(predicateArrows)) {
    if (k.toLowerCase() === lower) return v;
  }
  return 'forward';
}

export function useLinkPainter2D({
  theme,
  colorOverrides,
  predicateArrows,
  config,
  hoveredLinkId,
  activeSubNetworks,
  degreeMap,
  edgeWidthFn,
}: PainterDeps): LinkPainter {
  const closure = useMemo(() => ({
    theme, colorOverrides, predicateArrows, config, hoveredLinkId, activeSubNetworks, degreeMap, edgeWidthFn,
  }), [theme, colorOverrides, predicateArrows, config, hoveredLinkId, activeSubNetworks, degreeMap, edgeWidthFn]);

  return useCallback<LinkPainter>((rawLink, ctx, globalScale) => {
    const link = rawLink as GraphEdge & {
      source?: GraphNode | string;
      target?: GraphNode | string;
    };
    const c = closure;

    // After the lib's first paint, ``link.source`` / ``link.target`` have
    // been replaced with full node references. Fall back to the original
    // string IDs if present.
    const src = typeof link.source === 'object' ? link.source : null;
    const tgt = typeof link.target === 'object' ? link.target : null;
    if (!src || !tgt || src.x == null || src.y == null || tgt.x == null || tgt.y == null) return;

    const dir = getArrowDir(link.predicate, c.predicateArrows, c.config.showEdgeArrows);
    // Sub-network membership lookup. First match wins for colour + halo;
    // mirrors ``linkColor`` in ForceGraph.tsx so the line, backward arrow,
    // halo, and label all agree on what's focal.
    let memberSn: ActiveSubNetwork | null = null;
    for (const sn of c.activeSubNetworks) {
      if (sn.edgeIds.has(link.id)) { memberSn = sn; break; }
    }
    const isMember = memberSn !== null;
    const anySnActive = c.activeSubNetworks.length > 0;
    const edgeColor = memberSn
      ? SUB_NETWORK_HEX[memberSn.color]
      : c.config.edgeColorMode === 'predicate'
        ? resolvePredicateColor(link.predicate, c.colorOverrides)
        : c.theme.edgeStroke;
    const baseOpacity = anySnActive ? (isMember ? 1 : 0.2) : 1;

    // Backward arrow (paint after the stock forward arrow). The lib's stock
    // forward-arrow renders only when linkDirectionalArrowLength > 0, which
    // we set conditionally based on `dir === 'forward' || dir === 'both'`.
    // Skip on curved edges — the straight-line geometry below would point
    // the arrow off the bezier path. (Most parallel edges share predicate
    // direction so the loss is rare.)
    const curvature = (link as any).__curvature ?? 0;
    if ((dir === 'backward' || dir === 'both') && curvature === 0) {
      ctx.save();
      ctx.globalAlpha = baseOpacity;
      drawArrowAtNodeEdge(ctx, tgt.x, tgt.y, src.x, src.y, edgeColor, nodeRadius(c.degreeMap.get(src.id) ?? 0));
      ctx.restore();
    }

    // Edge label at midpoint. Visibility tiers (highest priority first):
    //   1. Hovered edge → always paint, full opacity
    //   2. Edge in any active sub-network → always paint, full opacity
    //   3. ``showEdgeLabels`` is on AND zoom ≥ edgeLabelMinScale → paint
    //   4. Otherwise → skip
    const isHoveredLink = c.hoveredLinkId === link.id;
    const isPromoted = isHoveredLink || isMember;
    const zoomAllowed = c.config.showEdgeLabels && globalScale >= c.config.edgeLabelMinScale;
    const showLabel = isPromoted || zoomAllowed;
    if (showLabel) {
      const labelOpacity = isPromoted ? 1 : anySnActive ? 0.15 : 1;
      // Bezier midpoint when curved; straight midpoint otherwise.
      const curvature = (link as any).__curvature ?? 0;
      let mx: number, my: number;
      if (curvature !== 0) {
        const dx = tgt.x - src.x, dy = tgt.y - src.y;
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len, py = dx / len;
        const cx = (src.x + tgt.x) / 2 + px * curvature * len;
        const cy = (src.y + tgt.y) / 2 + py * curvature * len;
        mx = (src.x + 2 * cx + tgt.x) / 4;
        my = (src.y + 2 * cy + tgt.y) / 4;
      } else {
        mx = (src.x + tgt.x) / 2;
        my = (src.y + tgt.y) / 2;
      }
      const fontSize = (c.config.labelFontSize - 2) / globalScale;
      ctx.save();
      ctx.globalAlpha = labelOpacity;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.5 / globalScale;
      ctx.strokeStyle = c.theme.labelHalo;
      ctx.lineJoin = 'round';
      ctx.strokeText(link.predicate, mx, my);
      ctx.fillStyle = isHoveredLink ? c.theme.nodeLabel : c.theme.edgeLabel;
      ctx.fillText(link.predicate, mx, my);
      ctx.restore();
    }

    // Hover halo — slight glow on top of the link. Skip on curved edges:
    // the straight-line halo would diverge from the lib's bezier path.
    if (c.hoveredLinkId === link.id && curvature === 0) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = c.edgeWidthFn(link) + 4;
      ctx.strokeStyle = edgeColor;
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.stroke();
      ctx.restore();
    }

    // Sub-network halo — amber lenses (asset / nav / future pin board) get
    // the prominent halo so they read against busy graphs. Blue node-focus
    // skips this — colour alone is enough, halo would compete with amber.
    // Skip on curved edges (straight halo would diverge from the bezier).
    if (memberSn?.color === 'amber' && curvature === 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = c.edgeWidthFn(link) + 6;
      ctx.strokeStyle = SUB_NETWORK_HEX.amber;
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.stroke();
      ctx.restore();
    }
  }, [closure]);
}

// Draws an arrow at the edge of node (sx, sy), pointing AWAY FROM (tx, ty).
// Used for backward arrows: src is the receiver, tgt is the source of the
// edge line; we want the arrowhead at the source-node's perimeter.
function drawArrowAtNodeEdge(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  color: string,
  nodeR: number,
): void {
  const dx = sx - tx;
  const dy = sy - ty;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;
  // Pull the arrowhead in to sit on the source-node's edge.
  const ax = tx + (dx / len) * (len - nodeR - 4);
  const ay = ty + (dy / len) * (len - nodeR - 4);
  // Arrow geometry — small triangle, ~6px wide
  const arrowLen = 8;
  const arrowWidth = 4;
  const angle = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-arrowLen, -arrowWidth);
  ctx.lineTo(-arrowLen, arrowWidth);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}
