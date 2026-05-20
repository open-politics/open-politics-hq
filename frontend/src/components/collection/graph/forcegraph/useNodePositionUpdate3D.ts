'use client';

import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { GraphViewConfig } from '../graphTypes';

// =============================================================================
// useNodePositionUpdate3D — per-frame opacity update for 3D node label sprites.
//
// Visibility model:
//   - Anchor (group.userData.isAnchor=true): always opacity 1 (top-N + select)
//   - Otherwise: only when ``showAllLabels`` is on AND camera is near enough.
//     Threshold scales with the bbox diagonal so small graphs always show
//     labels and huge graphs only show the cluster the camera is on.
//
// Like ``linkPositionUpdate``, this runs once per node per frame. Bbox is
// cached on a slow timer (otherwise the per-call ``getGraphBbox()`` walk would
// dominate frame time). ``visible`` is toggled with opacity so hidden sprites
// don't dispatch draw calls.
// =============================================================================

interface NodeUpdateDeps {
  config: GraphViewConfig;
  getCamera: () => THREE.Camera | undefined;
  getGraphBbox: () => { x: [number, number]; y: [number, number]; z: [number, number] } | null;
}

export function useNodePositionUpdate3D(deps: NodeUpdateDeps) {
  const stateRef = useRef(deps);
  stateRef.current = deps;

  const bboxRef = useRef<{ x: [number, number]; y: [number, number]; z: [number, number] } | null>(null);
  useEffect(() => {
    const refresh = () => {
      try { bboxRef.current = stateRef.current.getGraphBbox(); } catch { /* not ready */ }
    };
    refresh();
    const timer = setInterval(refresh, 250);
    return () => clearInterval(timer);
  }, []);

  return useCallback((obj: THREE.Object3D, coords: { x: number; y: number; z?: number }): boolean => {
    const group = obj as THREE.Group;
    const sprite = group.userData?.labelSprite as THREE.Sprite | undefined;
    if (!sprite) return false;
    const isAnchor = !!group.userData?.isAnchor;
    const s = stateRef.current;

    let opacity = 0;
    if (isAnchor) {
      opacity = 1;
    } else if (s.config.showNodeLabels && s.config.showAllLabels) {
      // Rich-detail short-circuit: ``labelMinScale === 0`` is the 2D analogue
      // for "always render labels". Honour the same intent in 3D by skipping
      // the camera-distance gate entirely — otherwise labels still fade out
      // at orbit distance even when the user explicitly asked for everything.
      if (s.config.labelMinScale === 0) {
        opacity = 1;
      } else {
      const camera = s.getCamera();
      if (camera) {
        const dx = camera.position.x - coords.x;
        const dy = camera.position.y - coords.y;
        const dz = camera.position.z - (coords.z ?? 0);
        const d = Math.hypot(dx, dy, dz);
        const bbox = bboxRef.current;
        let threshold = 250;
        if (bbox) {
          const bx = bbox.x[1] - bbox.x[0];
          const by = bbox.y[1] - bbox.y[0];
          const bz = bbox.z[1] - bbox.z[0];
          threshold = Math.max(80, Math.hypot(bx, by, bz) * 0.45);
        }
        // Smooth fade: full opacity within 60% of threshold, fade to 0 over
        // the remaining 40%. Avoids the flicker of a hard binary cutoff
        // when the camera is near the threshold radius.
        const fadeStart = threshold * 0.6;
        if (d <= fadeStart) opacity = 1;
        else if (d < threshold) opacity = 1 - (d - fadeStart) / (threshold - fadeStart);
        else opacity = 0;
      }
      }
    }

    if (group.userData.spriteOpacity !== opacity) {
      group.userData.spriteOpacity = opacity;
      (sprite.material as THREE.SpriteMaterial).opacity = opacity;
      sprite.visible = opacity > 0.01;
    }

    // Falsy → lib still positions the group itself (we only updated the
    // child sprite's material).
    return false;
  }, []);
}
