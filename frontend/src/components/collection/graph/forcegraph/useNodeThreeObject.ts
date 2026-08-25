'use client';

import { useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { resolveEntityColor, type ColorOverrides } from '@/lib/annotations/colors';
import { resolveNodeStyle, type NodeSelectionState, type ThemeTokens } from './resolveNodeStyle';
import type { TypeIcons } from './useTypeIcons';
import { nodeRadius, type GraphNode, type GraphViewConfig } from '../graphTypes';

// =============================================================================
// useNodeThreeObject — returns ``nodeThreeObject(node)`` callback for
// react-force-graph-3d. Each node renders as a THREE.Group containing:
//   1. Sphere mesh (entity-color material, brightened/dimmed by selection)
//   2. Icon sprite (the type's glyph, baked to a CanvasTexture)
//   3. Label sprite (CanvasTexture-backed Sprite, scaled to face the camera)
//
// Sphere geometry is shared across all nodes (one geometry, many instances).
// Materials are cached per (color, opacity) by the caller's material cache.
// Label sprites use the texture cache for (text, color, halo) reuse.
//
// The icon sprite is a billboard, so it must sit *in front of* the sphere or
// it renders inside it and is never seen. Where "in front" is depends on the
// camera, so it is recomputed per frame — see ``faceCamera`` below. Depth
// testing stays on, so a node behind another node hides properly instead of
// floating its glyph through everything in front of it.
// =============================================================================

interface ThreeObjectDeps {
  theme: ThemeTokens;
  colorOverrides?: ColorOverrides;
  /** Resolved glyph per node type — the same object 2D paints from. */
  icons: TypeIcons;
  selection: NodeSelectionState;
  config: GraphViewConfig;
  degreeMap: Map<string, number>;
  /** Top-N anchor nodes — labels always render, sized at 1.3×. */
  pinnedNodeIds: ReadonlySet<string>;
  materialCache: { getOrCreate: (color: string, opacity: number) => THREE.Material };
  labelCache: { getSprite: (k: { text: string; color: string; haloColor: string }) => { texture: THREE.CanvasTexture; material: THREE.SpriteMaterial; width: number; height: number } };
  iconCache: { getTexture: (key: string, paths: Path2D[]) => THREE.CanvasTexture | null };
}

/** Scratch vectors. Shared because `onBeforeRender` is synchronous, called one
 *  object at a time on the render thread, and never re-entrant — so the
 *  alternative is two allocations per icon per frame for no gain. */
const CAM = new THREE.Vector3();
const NODE = new THREE.Vector3();

/**
 * Keep a sprite hovering between its node and the camera.
 *
 * **Why not `nodePositionUpdate`.** That is where the label opacity cascade
 * lives, and it looks like the natural home for this too — but 3d-force-graph
 * only calls it from inside `layoutTick`, which stops the moment the
 * simulation cools (`3d-force-graph.js`: `if (state.engineRunning) {
 * layoutTick(); }`). On a settled graph the offset would freeze at whatever
 * direction the camera happened to be in when the layout finished, and
 * orbiting would slide every glyph behind its own sphere. Which reads exactly
 * like the bug this whole change is fixing: icons that are simply not there.
 *
 * `onBeforeRender` is driven by three.js instead, so it runs on every frame the
 * sprite is actually drawn. The world matrix is recomputed by hand afterwards
 * because the renderer derives `modelViewMatrix` from `matrixWorld` *after*
 * this hook — without it the glyph would trail the camera by one frame.
 */
function faceCamera(sprite: THREE.Sprite, offset: number): void {
  sprite.onBeforeRender = (_renderer, _scene, camera) => {
    const parent = sprite.parent;
    if (!parent) return;
    camera.getWorldPosition(CAM);
    parent.getWorldPosition(NODE);
    CAM.sub(NODE);
    const d = CAM.length();
    // Degenerate only when the camera is inside the node, where leaving the
    // sprite at the centre is the right answer anyway.
    if (d < 1e-6) return;
    sprite.position.copy(CAM.multiplyScalar(offset / d));
    sprite.updateMatrix();
    sprite.matrixWorld.multiplyMatrices(parent.matrixWorld, sprite.matrix);
  };
}

export function useNodeThreeObject(deps: ThreeObjectDeps) {
  // Shared sphere geometry — built once per (segments) and reused.
  const sphereGeometry = useMemo(
    () => new THREE.SphereGeometry(1, deps.config.sphereWidthSegments, Math.max(6, Math.floor(deps.config.sphereWidthSegments * 0.7))),
    [deps.config.sphereWidthSegments],
  );

  // Stable ring geometry for selection overlay.
  const ringGeometry = useMemo(() => new THREE.RingGeometry(1.05, 1.2, 32), []);

  return useCallback((rawNode: any): THREE.Object3D => {
    const node = rawNode as GraphNode;
    const baseColor = resolveEntityColor(node.type, deps.colorOverrides);
    const style = resolveNodeStyle(node, deps.selection, baseColor, deps.theme);
    const deg = deps.degreeMap.get(node.id) ?? 0;
    const isHi = deps.selection.highlightedNodeId === node.id;
    const r = nodeRadius(deg, isHi);

    const group = new THREE.Group();
    group.name = `node-${node.id}`;

    // ---- Sphere ----
    const opacity = deps.config.nodeOpacity3D * style.opacity;
    const worldRadius = r * 0.4 * style.scale; // 0.4 = world-units-to-radius factor
    const sphereMat = deps.materialCache.getOrCreate(style.fillColor, opacity);
    const sphere = new THREE.Mesh(sphereGeometry, sphereMat);
    sphere.scale.setScalar(worldRadius);
    group.add(sphere);

    // ---- Icon ----
    // Same declaration, same glyph, same rule about when it appears as 2D —
    // the type's icon is a property of the schema, not of a renderer.
    const iconPaths = deps.icons.get(node.type);
    const iconName = iconPaths ? deps.icons.nameFor(node.type) : null;
    if (iconPaths && iconName) {
      // Keyed by the GLYPH, not the type: re-picking a type's icon leaves the
      // type unchanged, and a type-keyed cache would keep serving the old bake.
      const texture = deps.iconCache.getTexture(iconName, iconPaths);
      if (texture) {
        // Per-sprite material: opacity follows the node's dim state, which the
        // shared texture must not carry.
        const iconMat = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          opacity: style.opacity,
        });
        const icon = new THREE.Sprite(iconMat);
        icon.scale.setScalar(worldRadius * 1.25);
        // A hair over the radius: closer and the sphere's silhouette clips the
        // glyph's edges as the camera moves around it.
        faceCamera(icon, worldRadius * 1.02);
        group.add(icon);
      }
    }

    // ---- Selection ring (camera-facing) ----
    if (style.ringColor && (isHi || deps.selection.connectedNodeIds.has(node.id) || deps.selection.mergeSelectedNodeIds.has(node.id) || deps.selection.groupSelectedIds.has(node.id))) {
      const ringMat = deps.materialCache.getOrCreate(style.ringColor, 1);
      const ring = new THREE.Mesh(ringGeometry, ringMat);
      ring.scale.setScalar(worldRadius);
      // RingGeometry is flat — orient toward camera each frame is expensive
      // for many rings; instead we let it face +Z and accept that orbit
      // around the back of the node will hide it. Acceptable for v1.
      group.add(ring);
    }

    // ---- Label sprite ----
    // Visibility model mirrors 2D: anchors (pinned + selection state) always
    // visible; the rest gated by ``showAllLabels`` and faded by camera
    // distance via ``nodePositionUpdate``. We always *build* the sprite so
    // toggling ``showAllLabels`` doesn't require rebuilding node objects —
    // visibility flips per-frame in the position-update callback. Per-sprite
    // material (texture is shared) so opacity writes don't bleed across nodes.
    if (deps.config.showNodeLabels && node.label) {
      const isPinned = deps.pinnedNodeIds.has(node.id);
      const isHi = deps.selection.highlightedNodeId === node.id;
      const isConn = deps.selection.connectedNodeIds.has(node.id);
      const isMerge = deps.selection.mergeSelectedNodeIds.has(node.id);
      const isGroup = deps.selection.groupSelectedIds.has(node.id);
      const isAnchor = isPinned || isHi || isConn || isMerge || isGroup;

      const cached = deps.labelCache.getSprite({
        text: node.label,
        color: style.labelColor,
        haloColor: deps.theme.labelHalo,
      });
      // Per-sprite material — texture is shared, opacity is per-node.
      const material = new THREE.SpriteMaterial({
        map: cached.texture,
        transparent: true,
        depthWrite: false,
        opacity: 1,
      });
      const spriteObj = new THREE.Sprite(material);
      // Anchor labels render larger so the orientation hierarchy reads at a
      // glance; non-anchor labels scale gently with degree (capped) when
      // ``showAllLabels`` is on.
      const sizeBoost = isPinned ? 1.3 : isAnchor ? 1.15 : Math.min(1.05, 0.85 + deg * 0.012);
      const labelWorldHeight = r * 0.6 * sizeBoost;
      const labelWorldWidth = labelWorldHeight * (cached.width / cached.height);
      spriteObj.scale.set(labelWorldWidth, labelWorldHeight, 1);
      spriteObj.position.set(0, -(r * 0.5 + labelWorldHeight * 0.6), 0);
      // Initial visibility — non-anchors hidden until nodePositionUpdate
      // promotes them when ``showAllLabels`` + camera-near.
      const initiallyVisible = isAnchor || deps.config.showAllLabels;
      spriteObj.visible = initiallyVisible;
      material.opacity = initiallyVisible ? 1 : 0;
      // Stash refs so nodePositionUpdate can flip visibility cheaply.
      group.userData.labelSprite = spriteObj;
      group.userData.isAnchor = isAnchor;
      group.userData.spriteOpacity = initiallyVisible ? 1 : 0;
      group.add(spriteObj);
    }

    return group;
  }, [deps, sphereGeometry, ringGeometry]);
}
