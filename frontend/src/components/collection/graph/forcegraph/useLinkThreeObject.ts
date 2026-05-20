'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { resolvePredicateColor, type ColorOverrides } from '@/lib/annotations/colors';
import type { ActiveSubNetwork, GraphEdge, GraphViewConfig } from '../graphTypes';
import type { ThemeTokens } from './resolveNodeStyle';

// =============================================================================
// useLinkThreeObject — adds a label sprite to every 3D edge, paired with a
// per-frame ``linkPositionUpdate`` callback that:
//   1. Centers the sprite on the edge midpoint.
//   2. Updates opacity by the same cascade we use in 2D:
//        - Hovered edge → opacity 1
//        - Edge incident to highlighted node → opacity 1
//        - Camera near enough → opacity 1 (subject to ``showEdgeLabels``)
//        - Otherwise → opacity 0
//      Plus a 0.15 dim-factor when a highlight is active and this edge is
//      neither hovered nor incident.
//
// The lib calls ``linkThreeObject`` once per edge to build the object, then
// ``linkPositionUpdate`` every frame to reposition. We use a stable callback
// (mutates a ref) so the lib doesn't tear down per-edge sprites every render.
// =============================================================================

interface LinkThreeDeps {
  theme: ThemeTokens;
  colorOverrides?: ColorOverrides;
  config: GraphViewConfig;
  hoveredLinkId: string | null;
  /** Active sub-networks (node-focus, asset-lens, edge-nav, future pin
   *  board). Edge labels for any member of any sub-network paint at full
   *  opacity; amber-coloured ones additionally get a sprite-scale boost
   *  so explicit lenses pop against the dimmed ambient. */
  activeSubNetworks: ActiveSubNetwork[];
  /** Returns the active 3D camera. Undefined until the lib mounts. */
  getCamera: () => THREE.Camera | undefined;
  /** Returns the rendered graph bounding box, or null if not ready. Used to
   *  scale the camera-distance threshold to the actual graph size. */
  getGraphBbox: () => { x: [number, number]; y: [number, number]; z: [number, number] } | null;
}

interface SpriteState {
  opacity: number;
  baseScaleX: number;
  baseScaleY: number;
  /** Last applied scale boost — used to skip per-frame scale writes when
   *  the boost hasn't changed. */
  appliedBoost: number;
}

const FONT_SIZE = 24; // px in source canvas; sprite scaled at render time
const PADDING = 4;
const LABEL_WORLD_HEIGHT = 6; // world units; scale.x derived from aspect

function buildLabelTexture(text: string, color: string, haloColor: string): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${FONT_SIZE}px sans-serif`;
  const m = ctx.measureText(text);
  const w = Math.max(8, Math.ceil(m.width)) + PADDING * 2;
  const h = FONT_SIZE + PADDING * 2;
  canvas.width = w;
  canvas.height = h;
  // Re-set after canvas resize (clears state)
  ctx.font = `${FONT_SIZE}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = haloColor;
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { texture, aspect: w / h };
}

export function useLinkThreeObject(deps: LinkThreeDeps) {
  // Mutable mirror of deps so ``linkPositionUpdate`` can stay identity-stable
  // (the lib doesn't reattach handlers every render this way).
  const stateRef = useRef(deps);
  stateRef.current = deps;

  // Cache textures by (predicate, color, theme.haloColor). Predicate text
  // rarely changes, so this stays small and dramatically cheaper than the
  // re-bake-per-edge alternative.
  const textureCacheRef = useRef<Map<string, { texture: THREE.CanvasTexture; aspect: number }>>(new Map());

  // Theme flips invalidate the cache (halo + label color rebake).
  const themeKey = `${deps.theme.edgeLabel}|${deps.theme.labelHalo}`;
  const lastThemeKeyRef = useRef(themeKey);
  if (lastThemeKeyRef.current !== themeKey) {
    for (const entry of textureCacheRef.current.values()) entry.texture.dispose();
    textureCacheRef.current.clear();
    lastThemeKeyRef.current = themeKey;
  }

  // ===========================================================================
  // Bbox cache. ``getGraphBbox()`` walks every node — calling it per-edge
  // per-frame on a 1k-node graph is millions of ops per second, which on
  // mid-tier laptops drops the JS-side frame rate hard enough that the GPU
  // sits idle waiting for new draw lists. Refresh on a slow timer instead;
  // the camera-distance threshold has plenty of slack for an outdated bbox.
  // ===========================================================================
  const bboxRef = useRef<{ x: [number, number]; y: [number, number]; z: [number, number] } | null>(null);
  useEffect(() => {
    const refresh = () => {
      try { bboxRef.current = stateRef.current.getGraphBbox(); } catch { /* not ready */ }
    };
    refresh();
    const timer = setInterval(refresh, 250);
    return () => clearInterval(timer);
  }, []);

  const linkThreeObject = useCallback((rawLink: any): THREE.Object3D => {
    const link = rawLink as GraphEdge;
    const color = stateRef.current.config.edgeColorMode === 'predicate'
      ? resolvePredicateColor(link.predicate, stateRef.current.colorOverrides)
      : stateRef.current.theme.edgeLabel;
    const cacheKey = `${link.predicate}|${color}|${stateRef.current.theme.labelHalo}`;
    let entry = textureCacheRef.current.get(cacheKey);
    if (!entry) {
      entry = buildLabelTexture(link.predicate, color, stateRef.current.theme.labelHalo);
      textureCacheRef.current.set(cacheKey, entry);
    }
    const material = new THREE.SpriteMaterial({
      map: entry.texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(material);
    const baseScaleX = LABEL_WORLD_HEIGHT * entry.aspect;
    const baseScaleY = LABEL_WORLD_HEIGHT;
    sprite.scale.set(baseScaleX, baseScaleY, 1);
    sprite.visible = false; // start hidden — linkPositionUpdate flips on demand
    // Force the label to paint *after* the cylinder geometry it sits on.
    // Within Three.js's transparent render pass, ties on depth are broken
    // by ``renderOrder``: a higher value renders later (i.e. on top). The
    // line/cylinder defaults to 0; setting the sprite to 10 keeps the
    // text legible when the camera angle aligns sprite + edge geometry.
    sprite.renderOrder = 10;
    (sprite.userData as SpriteState) = { opacity: 0, baseScaleX, baseScaleY, appliedBoost: 1 };
    sprite.name = `edge-label-${link.id}`;
    return sprite;
  }, []);

  // Position + opacity per frame. Hot path — runs once per edge per frame.
  // Optimizations vs the naive version:
  //   - bbox is cached (above) instead of recomputed per-call
  //   - opacity writes are skipped when unchanged
  //   - sprite.visible is toggled with opacity → invisible labels don't even
  //     dispatch a draw call. On a 1k-node graph this turns the sprite cost
  //     from O(E) to O(visible labels), which is the difference between a
  //     CPU-bound stutter and a smooth orbit.
  const linkPositionUpdate = useCallback((obj: THREE.Object3D, coords: { start: { x: number; y: number; z?: number }; end: { x: number; y: number; z?: number } }, rawLink: any): boolean => {
    const link = rawLink as GraphEdge & { source?: any; target?: any };
    const sprite = obj as THREE.Sprite;
    const s = stateRef.current;

    const isHovered = s.hoveredLinkId === link.id;
    // Sub-network membership lookup. ``memberSn`` carries the colour so
    // amber lenses can drive the scale boost while blue stays at base size.
    let memberSn: ActiveSubNetwork | null = null;
    for (const sn of s.activeSubNetworks) {
      if (sn.edgeIds.has(link.id)) { memberSn = sn; break; }
    }
    const isPromoted = isHovered || memberSn !== null;
    const anySnActive = s.activeSubNetworks.length > 0;

    // Fast hidden path: when labels are off globally AND this edge isn't
    // promoted, skip every other op for this frame. Promoted edges always
    // render their label — the asset-lens / keyboard-nav highlights are
    // useless if the user can't read what predicate they cover.
    if (!isPromoted && !s.config.showEdgeLabels) {
      const ud = sprite.userData as SpriteState;
      if (ud.opacity !== 0) {
        ud.opacity = 0;
        (sprite.material as THREE.SpriteMaterial).opacity = 0;
        sprite.visible = false;
      }
      return false;
    }

    const { start, end } = coords;
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const mz = ((start.z ?? 0) + (end.z ?? 0)) / 2;
    sprite.position.set(mx, my, mz);

    let opacity = 0;
    if (isPromoted) {
      opacity = 1;
    } else if (s.config.showEdgeLabels) {
      // Rich-detail short-circuit: ``edgeLabelMinScale === 0`` means "render
      // labels at any zoom". Mirror it in 3D by skipping the camera-distance
      // gate so the user sees every predicate name even when zoomed out.
      if (s.config.edgeLabelMinScale === 0) {
        opacity = 1;
      } else {
        // Camera-distance gate. Reads cached bbox (refreshed on a 250 ms
        // timer) — the threshold has enough slack that a slightly stale bbox
        // doesn't visibly mis-gate labels.
        const camera = s.getCamera();
        if (camera) {
          const cx = camera.position.x;
          const cy = camera.position.y;
          const cz = camera.position.z;
          const d = Math.hypot(cx - mx, cy - my, cz - mz);
          const bbox = bboxRef.current;
          let threshold = 220; // sane fallback before bbox is computed
          if (bbox) {
            const dx = bbox.x[1] - bbox.x[0];
            const dy = bbox.y[1] - bbox.y[0];
            const dz = bbox.z[1] - bbox.z[0];
            const diag = Math.hypot(dx, dy, dz);
            threshold = Math.max(60, diag * 0.4);
          }
          if (d < threshold) opacity = 1;
        }
      }
    }

    // Sub-network-active dim cascade: ambient labels fade out so the
    // focal ones read clearly. Promoted edges sit at full opacity.
    if (anySnActive && !isPromoted) {
      opacity *= 0.15;
    }

    const ud = sprite.userData as SpriteState;
    if (ud.opacity !== opacity) {
      ud.opacity = opacity;
      (sprite.material as THREE.SpriteMaterial).opacity = opacity;
      sprite.visible = opacity > 0;
    }

    // Scale boost — amber sub-network labels render ~35% larger when
    // rich-detail is on, so explicit lenses (asset / keyboard-nav / future
    // pin board) pop against the dim backdrop. Blue node-focus stays at
    // base — the colour cue is enough, scale boost would compete.
    const wantBoost = memberSn?.color === 'amber' && s.config.showEdgeLabels ? 1.35 : 1;
    if (ud.appliedBoost !== wantBoost) {
      ud.appliedBoost = wantBoost;
      sprite.scale.set(ud.baseScaleX * wantBoost, ud.baseScaleY * wantBoost, 1);
    }

    // Falsy return → lib still runs its default (line position update). The
    // sprite isn't lib-managed, so this just lets the line draw.
    return false;
  }, []);

  // Dispose textures on hook unmount.
  useMemo(() => {
    return () => {
      for (const entry of textureCacheRef.current.values()) entry.texture.dispose();
      textureCacheRef.current.clear();
    };
  }, []);

  return { linkThreeObject, linkPositionUpdate };
}
