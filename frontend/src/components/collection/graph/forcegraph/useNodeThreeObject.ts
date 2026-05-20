'use client';

import { useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { resolveEntityColor, type ColorOverrides } from '@/lib/annotations/colors';
import { resolveNodeStyle, type NodeSelectionState, type ThemeTokens } from './resolveNodeStyle';
import { nodeRadius, type GraphNode, type GraphViewConfig } from '../graphTypes';

// =============================================================================
// useNodeThreeObject — returns ``nodeThreeObject(node)`` callback for
// react-force-graph-3d. Each node renders as a THREE.Group containing:
//   1. Sphere mesh (entity-color material, brightened/dimmed by selection)
//   2. Label sprite (CanvasTexture-backed Sprite, scaled to face the camera)
//
// Sphere geometry is shared across all nodes (one geometry, many instances).
// Materials are cached per (color, opacity) by the caller's material cache.
// Label sprites use the texture cache for (text, color, halo) reuse.
// =============================================================================

interface ThreeObjectDeps {
  theme: ThemeTokens;
  colorOverrides?: ColorOverrides;
  selection: NodeSelectionState;
  config: GraphViewConfig;
  degreeMap: Map<string, number>;
  /** Top-N anchor nodes — labels always render, sized at 1.3×. */
  pinnedNodeIds: ReadonlySet<string>;
  materialCache: { getOrCreate: (color: string, opacity: number) => THREE.Material };
  labelCache: { getSprite: (k: { text: string; color: string; haloColor: string }) => { texture: THREE.CanvasTexture; material: THREE.SpriteMaterial; width: number; height: number } };
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
    const sphereMat = deps.materialCache.getOrCreate(style.fillColor, opacity);
    const sphere = new THREE.Mesh(sphereGeometry, sphereMat);
    sphere.scale.setScalar(r * 0.4 * style.scale); // 0.4 = world-units-to-radius factor
    group.add(sphere);

    // ---- Selection ring (camera-facing) ----
    if (style.ringColor && (isHi || deps.selection.connectedNodeIds.has(node.id) || deps.selection.mergeSelectedNodeIds.has(node.id) || deps.selection.groupSelectedIds.has(node.id))) {
      const ringMat = deps.materialCache.getOrCreate(style.ringColor, 1);
      const ring = new THREE.Mesh(ringGeometry, ringMat);
      ring.scale.setScalar(r * 0.4 * style.scale);
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
