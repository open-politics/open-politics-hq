'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ThemeTokens } from './resolveNodeStyle';

// =============================================================================
// useLabelTextureCache — bakes node label text into CanvasTextures, then wraps
// them in THREE.Sprite materials. Cached by (text, fillColor, theme.bg) so
// theme flips invalidate the cache. Falls back to a fresh bake on any miss.
//
// In a 5k+ node graph each node having its own texture is the typical bound;
// caching collapses identical (label, color, theme) combos. For dramatic
// scale we'd swap to a shared atlas + InstancedMesh; that's a future optimi-
// zation flagged in the migration plan.
// =============================================================================

interface SpriteEntry {
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
  width: number;
  height: number;
}

interface CacheKey {
  text: string;
  color: string;
  haloColor: string;
}

const FONT_SIZE = 32; // pixels in the texture; the sprite is scaled at render time
const PADDING = 6;

export function useLabelTextureCache(theme: ThemeTokens) {
  const cacheRef = useRef<Map<string, SpriteEntry>>(new Map());

  // Invalidate on theme flip — colors in the texture are baked, so they need
  // to be re-rasterized.
  const themeKey = `${theme.nodeLabel}|${theme.labelHalo}`;
  useEffect(() => {
    const cache = cacheRef.current;
    for (const entry of cache.values()) {
      entry.texture.dispose();
      entry.material.dispose();
    }
    cache.clear();
  }, [themeKey]);

  // Dispose on unmount.
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

  const getSprite = (key: CacheKey): SpriteEntry => {
    const ck = `${key.text}|${key.color}|${key.haloColor}`;
    let entry = cacheRef.current.get(ck);
    if (entry) return entry;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = `bold ${FONT_SIZE}px sans-serif`;
    const metrics = ctx.measureText(key.text);
    const w = Math.ceil(metrics.width) + PADDING * 2;
    const h = FONT_SIZE + PADDING * 2;
    canvas.width = w;
    canvas.height = h;

    // Background halo
    ctx.font = `bold ${FONT_SIZE}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = key.haloColor;
    ctx.strokeText(key.text, w / 2, h / 2);

    // Foreground
    ctx.fillStyle = key.color;
    ctx.fillText(key.text, w / 2, h / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    entry = { texture, material, width: w, height: h };
    cacheRef.current.set(ck, entry);
    return entry;
  };

  return { getSprite };
}
