'use client';

import { useCallback, useMemo, useRef } from 'react';
import { resolveEntityColor, type ColorOverrides } from '@/lib/annotations/colors';
import { getEntityIconPaths } from '../entityTypeIcons';
import { resolveNodeStyle, type NodeSelectionState, type ThemeTokens } from './resolveNodeStyle';
import { nodeRadius, type GraphNode, type GraphViewConfig } from '../graphTypes';

// =============================================================================
// useNodePainter2D — returns a ``nodeCanvasObject`` callback for
// react-force-graph-2d. Handles the full visual cascade:
//  1. Outer ring (selection state)
//  2. Filled circle (entity color brightened/darkened by selection)
//  3. Optional white-stroke icon in the circle (Path2D from entityTypeIcons)
//  4. Label below circle (with halo, gated by zoom + ``labelMinScale``)
//  5. Optional sub-property labels (config.showNodeProperties)
//
// Caches Path2D icon objects per (type-key, icon-set) so the same icon isn't
// re-parsed every frame for every node of that type.
// =============================================================================

type Painter = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => void;

interface PainterDeps {
  theme: ThemeTokens;
  colorOverrides?: ColorOverrides;
  typeIcons?: Record<string, string>;
  selection: NodeSelectionState;
  hoveredNodeId: string | null;
  config: GraphViewConfig;
  /** Build a degree map once at the call site to avoid per-frame O(N) work. */
  degreeMap: Map<string, number>;
  /** Node ids whose label should always render regardless of zoom level — used
   *  for the top-N highest-degree "anchor" nodes so the user can always orient
   *  themselves at any zoom. */
  pinnedNodeIds: ReadonlySet<string>;
}

export function useNodePainter2D({
  theme,
  colorOverrides,
  typeIcons,
  selection,
  hoveredNodeId,
  config,
  degreeMap,
  pinnedNodeIds,
}: PainterDeps): Painter {
  // Persistent Path2D cache keyed by `${typeUpper}:${iconKey}`. SVG path
  // strings parse to Path2D once; reused across every paint of that type.
  const iconPathCache = useRef<Map<string, Path2D[]>>(new Map());

  // Stable closure deps — re-create only when something visible changes.
  const closure = useMemo(() => ({
    theme,
    colorOverrides,
    typeIcons,
    selection,
    hoveredNodeId,
    config,
    degreeMap,
    pinnedNodeIds,
  }), [theme, colorOverrides, typeIcons, selection, hoveredNodeId, config, degreeMap, pinnedNodeIds]);

  return useCallback<Painter>((rawNode, ctx, globalScale) => {
    const node = rawNode as GraphNode;
    if (!node || node.x == null || node.y == null) return;

    const c = closure;
    const baseColor = resolveEntityColor(node.type, c.colorOverrides);
    const style = resolveNodeStyle(node, c.selection, baseColor, c.theme);
    const isHovered = c.hoveredNodeId === node.id;
    const deg = c.degreeMap.get(node.id) ?? 0;
    const isHighlighted = c.selection.highlightedNodeId === node.id;
    const r = nodeRadius(deg, isHighlighted);

    ctx.save();
    ctx.globalAlpha = style.opacity;

    // ---- Filled circle ----
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = style.fillColor;
    ctx.fill();

    // ---- Ring / stroke ----
    if (style.ringDash) {
      ctx.setLineDash(style.ringDash);
    } else {
      ctx.setLineDash([]);
    }
    ctx.lineWidth = style.ringWidth;
    ctx.strokeStyle = style.ringColor;
    ctx.stroke();
    ctx.setLineDash([]);

    // Hover highlight — outer halo ring, paint after the selection ring so it
    // doesn't get stomped on by the strict-mode selection cascade.
    if (isHovered && !isHighlighted) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = c.theme.nodeStroke;
      ctx.globalAlpha = style.opacity * 0.6;
      ctx.stroke();
      ctx.globalAlpha = style.opacity;
    }

    // ---- Icon (config.showNodeIcons; skipped when icon paths missing) ----
    if (c.config.showNodeIcons) {
      const typeKey = (node.type || '').toUpperCase();
      const iconCacheKey = `${typeKey}:${(c.typeIcons?.[typeKey] ?? c.typeIcons?.[node.type] ?? '')}`;
      let paths = iconPathCache.current.get(iconCacheKey);
      if (!paths) {
        const rawPaths = getEntityIconPaths(node.type, c.typeIcons);
        if (rawPaths) {
          try {
            paths = rawPaths.map(d => new Path2D(d));
            iconPathCache.current.set(iconCacheKey, paths);
          } catch {
            paths = [];
          }
        }
      }
      if (paths && paths.length > 0) {
        const iconSize = Math.max(10, r * 0.9);
        const iconScale = iconSize / 24; // icons are 24x24 viewBox
        ctx.save();
        ctx.translate(node.x - iconSize / 2, node.y - iconSize / 2);
        ctx.scale(iconScale, iconScale);
        ctx.lineWidth = 2 / iconScale;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const p of paths) ctx.stroke(p);
        ctx.restore();
      }
    }

    // ---- Label ----
    // Visibility model:
    //   - Anchor labels (pinned top-N + selection state + hover) always paint
    //   - When ``showAllLabels`` is on, *all* labels paint (subject to the
    //     zoom-min gate so dense regions decongest at low zoom)
    //   - When ``showNodeLabels`` is off, no labels at all
    // Pinned anchors render slightly larger — they're the orientation map.
    const isPinned = c.pinnedNodeIds.has(node.id);
    const isAnchor = isPinned || style.labelAlwaysVisible || isHovered;
    const showLabel = c.config.showNodeLabels && (
      isAnchor
      || (c.config.showAllLabels && globalScale >= c.config.labelMinScale)
    );
    if (showLabel) {
      // Anchors get a 1.25× boost so they read as the top tier of orientation
      // points. Non-anchor labels (when ``showAllLabels`` is on) scale gently
      // with degree — bigger nodes get bigger labels — capped to keep the
      // hierarchy readable.
      const sizeBoost = isPinned
        ? 1.3
        : isAnchor
        ? 1.15
        : Math.min(1.05, 0.85 + deg * 0.012);
      const fontSize = (c.config.labelFontSize * sizeBoost) / globalScale; // counter zoom so font size stays steady on screen
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelY = node.y + r + 2;

      // S2: truncate long labels — full text stays in the hover tooltip.
      // Anchor (selected/hovered/pinned) labels get a longer ellipsis budget.
      const limit = isAnchor ? 32 : 22;
      const displayLabel = (node.label?.length ?? 0) > limit
        ? node.label.slice(0, limit - 1) + '…'
        : node.label;

      // Halo (softer than legacy 3px → 2.25px — keeps text legible on both
      // dark and light themes without the heavy "comicy" outline).
      ctx.lineWidth = 2.25 / globalScale;
      ctx.strokeStyle = c.theme.labelHalo;
      ctx.lineJoin = 'round';
      ctx.strokeText(displayLabel, node.x, labelY);

      // Fill
      ctx.fillStyle = style.labelColor;
      ctx.fillText(displayLabel, node.x, labelY);

      // ---- Sub-property labels (config.showNodeProperties) ----
      if (c.config.showNodeProperties && node.properties && typeof node.properties === 'object') {
        const entries = Object.entries(node.properties).filter(([, v]) => v != null && v !== '');
        if (entries.length > 0) {
          const propFontSize = Math.max(8, c.config.labelFontSize - 3) / globalScale;
          ctx.font = `${propFontSize}px sans-serif`;
          ctx.fillStyle = c.theme.edgeLabel;
          ctx.lineWidth = 2 / globalScale;
          ctx.strokeStyle = c.theme.labelHalo;
          for (let i = 0; i < Math.min(entries.length, 4); i++) {
            const [key, val] = entries[i];
            const display = String(val).length > 30 ? String(val).slice(0, 30) + '...' : String(val);
            const text = `${key}: ${display}`;
            const y = labelY + (i + 1) * (propFontSize + 2);
            ctx.strokeText(text, node.x, y);
            ctx.fillText(text, node.x, y);
          }
        }
      }
    }

    ctx.restore();
  }, [closure]);
}
