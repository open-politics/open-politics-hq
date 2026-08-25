'use client';

import { useCallback, useMemo } from 'react';
import { resolveEntityColor, type ColorOverrides } from '@/lib/annotations/colors';
import { resolveNodeStyle, type NodeSelectionState, type ThemeTokens } from './resolveNodeStyle';
import type { TypeIcons } from './useTypeIcons';
import { nodeRadius, nodeRadiusFor, type GraphNode, type GraphViewConfig } from '../graphTypes';

// =============================================================================
// useNodePainter2D — returns a ``nodeCanvasObject`` callback for
// react-force-graph-2d. Handles the full visual cascade:
//  1. Outer ring (selection state)
//  2. Filled circle (entity color brightened/darkened by selection)
//  3. Optional white-stroke icon in the circle (Path2D from ``useTypeIcons``)
//  4. Label below circle (with halo, gated by zoom + ``labelMinScale``)
//  5. Optional sub-property labels (config.showNodeProperties)
//
// Icon geometry is resolved and cached upstream by ``useTypeIcons`` — shared
// with the 3D builder, so both renderers draw the same glyph for a type.
// =============================================================================

type Painter = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => void;

/** Occurrences render at a fixed small size rather than by degree. Their
 *  degree is an artefact of how many participants the row had, not a measure
 *  of importance — sizing by it would make a five-passenger flight look more
 *  significant than a two-party payment of ten million. */
const OCCURRENCE_R = 5;

/** Zoom below which occurrence labels are suppressed entirely. They are
 *  numerous by design; labelling them at overview zoom is illegible noise. */
const OCCURRENCE_LABEL_SCALE = 1.6;

/** Node radius below which an icon has nowhere legible to go. A 24×24 glyph
 *  scaled under ~9px reads as a smudge, and a smudge on every node is worse
 *  than no glyph on any. */
const ICON_MIN_R = 4.5;

interface PainterDeps {
  theme: ThemeTokens;
  colorOverrides?: ColorOverrides;
  /** Resolved glyph per node type. Whether undeclared types get a default one
   *  is decided upstream, so the painter just draws what it is handed. */
  icons: TypeIcons;
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
  icons,
  selection,
  hoveredNodeId,
  config,
  degreeMap,
  pinnedNodeIds,
}: PainterDeps): Painter {
  // Stable closure deps — re-create only when something visible changes.
  const closure = useMemo(() => ({
    theme,
    colorOverrides,
    icons,
    selection,
    hoveredNodeId,
    config,
    degreeMap,
    pinnedNodeIds,
  }), [theme, colorOverrides, icons, selection, hoveredNodeId, config, degreeMap, pinnedNodeIds]);

  return useCallback<Painter>((rawNode, ctx, globalScale) => {
    const node = rawNode as GraphNode;
    if (!node || node.x == null || node.y == null) return;

    const c = closure;
    const baseColor = resolveEntityColor(node.type, c.colorOverrides);
    const style = resolveNodeStyle(node, c.selection, baseColor, c.theme);
    const isHovered = c.hoveredNodeId === node.id;
    const deg = c.degreeMap.get(node.id) ?? 0;
    const isHighlighted = c.selection.highlightedNodeId === node.id;

    // ---- Entities and occurrences get OPPOSITE treatment ----
    //
    // An entity is a noun you recognise: labelled, sized by how connected it
    // is, few. An occurrence is something that happened: small, uniform,
    // numerous, and deliberately recessive — it is connective tissue, and a
    // corpus of 400 payments must read as structure rather than as 400 shouting
    // labels. You don't read occurrences on the canvas; you read them in the
    // item pane, and use the canvas to choose which.
    const isOccurrence = node.kind === 'occurrence';
    // An occurrence stays uniform unless a measure was bound to it — the point
    // of the recessive treatment is that 400 payments read as structure, and a
    // measure is the analyst saying which of them they want to see.
    const r = isOccurrence && node.size == null
      ? (isHighlighted ? OCCURRENCE_R * 1.6 : OCCURRENCE_R)
      : nodeRadiusFor(node, deg, isHighlighted);

    ctx.save();
    ctx.globalAlpha = style.opacity;

    // ---- Body: diamond for occurrences, circle for entities ----
    // Shape carries the distinction on its own, so it survives colour-blindness
    // and any palette the user picks.
    ctx.beginPath();
    if (isOccurrence) {
      ctx.moveTo(node.x, node.y - r);
      ctx.lineTo(node.x + r, node.y);
      ctx.lineTo(node.x, node.y + r);
      ctx.lineTo(node.x - r, node.y);
      ctx.closePath();
    } else {
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    }
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

    // ---- Icon ----
    // Sized to the node rather than floored at 10px: an occurrence diamond is
    // 5px across, and a glyph that ignores that spills over the shape it is
    // supposed to be inside. Below ICON_MIN_R there is no room for a legible
    // one at all, so nothing is drawn.
    const paths = r >= ICON_MIN_R ? c.icons.get(node.type) : null;
    if (paths) {
      const iconSize = r * (isOccurrence ? 1.0 : 1.15);
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

    // ---- Label ----
    // Visibility model:
    //   - Anchor labels (pinned top-N + selection state + hover) always paint
    //   - When ``showAllLabels`` is on, *all* labels paint (subject to the
    //     zoom-min gate so dense regions decongest at low zoom)
    //   - When ``showNodeLabels`` is off, no labels at all
    // Pinned anchors render slightly larger — they're the orientation map.
    const isPinned = c.pinnedNodeIds.has(node.id);
    const isAnchor = isPinned || style.labelAlwaysVisible || isHovered;
    // Occurrences stay mute until you zoom in or engage one. They are the
    // numerous half of the graph, and labelling them at overview zoom buries
    // the entities — which are the labels you actually navigate by.
    // Selection and hover always win: engaging a thing must always name it.
    const occurrenceMuted = isOccurrence
      && !style.labelAlwaysVisible
      && !isHovered
      && globalScale < OCCURRENCE_LABEL_SCALE;
    const showLabel = c.config.showNodeLabels && !occurrenceMuted && (
      isAnchor
      || (c.config.showAllLabels && globalScale >= c.config.labelMinScale)
      // An occurrence you have zoomed into is worth naming even when
      // ``showAllLabels`` is off — at that zoom you are reading, not scanning.
      || (isOccurrence && globalScale >= OCCURRENCE_LABEL_SCALE)
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
