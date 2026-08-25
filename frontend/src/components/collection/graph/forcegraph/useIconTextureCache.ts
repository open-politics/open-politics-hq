'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// =============================================================================
// useIconTextureCache — bakes a node type's glyph into a CanvasTexture, so 3D
// can wear the same icon 2D strokes onto the canvas.
//
// Same shape as ``useLabelTextureCache``: one texture per distinct key, reused
// across every node of that type. Unlike labels there is no per-node text, so
// the cache is bounded by the number of *types* in the graph — a handful —
// rather than by node count.
//
// The glyph is baked white with a soft dark rim. White reads on every entity
// colour the palette produces and on both themes, which a coloured glyph does
// not, and the rim keeps it legible against the pale end of the palette.
// =============================================================================

const TEXTURE_PX = 128;
/** Lucide glyphs are drawn in a 24×24 box with ~2px strokes; at 128px that is
 *  a 10.7px stroke, which fills in the tighter icons. 1.75 keeps the weight
 *  proportional to what 2D draws. */
const STROKE = (TEXTURE_PX / 24) * 1.75;

interface IconEntry {
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
}

export function useIconTextureCache() {
  const cacheRef = useRef<Map<string, IconEntry>>(new Map());

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const entry of cache.values()) {
        entry.texture.dispose();
        entry.material.dispose();
      }
      cache.clear();
    };
  }, []);

  /**
   * The baked texture for a glyph. ``key`` must identify the GEOMETRY — the
   * canonical icon name, not the node type wearing it, or re-picking a type's
   * icon would return the previous bake forever. ``paths`` is what to draw on
   * a miss, and is ignored on a hit.
   */
  const getTexture = (key: string, paths: Path2D[]): THREE.CanvasTexture | null => {
    const hit = cacheRef.current.get(key);
    if (hit) return hit.texture;
    if (!paths.length) return null;

    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_PX;
    canvas.height = TEXTURE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const scale = TEXTURE_PX / 24;
    ctx.scale(scale, scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Rim first, glyph over it — one pass each, so the rim never lightens the
    // stroke it is meant to separate from the sphere.
    ctx.lineWidth = (STROKE * 1.9) / scale;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    for (const p of paths) ctx.stroke(p);

    ctx.lineWidth = STROKE / scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    for (const p of paths) ctx.stroke(p);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    cacheRef.current.set(key, { texture, material });
    return texture;
  };

  return { getTexture };
}
