'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// =============================================================================
// useMaterialCache — shared THREE materials keyed by color+opacity. With ~30k
// nodes naively each gets its own MeshBasicMaterial, exploding draw calls. By
// caching, all nodes of the same entity-type+state share one material.
//
// The cache lives in a ref so identity is stable across renders; old materials
// are disposed on unmount to avoid GPU leaks.
// =============================================================================

type MaterialFactory = (color: string, opacity: number) => THREE.Material;

export function useMaterialCache() {
  const cacheRef = useRef<Map<string, THREE.Material>>(new Map());

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const mat of cache.values()) mat.dispose();
      cache.clear();
    };
  }, []);

  const getOrCreate = (color: string, opacity: number, factory?: MaterialFactory): THREE.Material => {
    const key = `${color}|${opacity.toFixed(2)}`;
    let mat = cacheRef.current.get(key);
    if (!mat) {
      mat = factory ? factory(color, opacity) : new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
      });
      cacheRef.current.set(key, mat);
    }
    return mat;
  };

  const invalidateAll = () => {
    for (const mat of cacheRef.current.values()) mat.dispose();
    cacheRef.current.clear();
  };

  return { getOrCreate, invalidateAll };
}
