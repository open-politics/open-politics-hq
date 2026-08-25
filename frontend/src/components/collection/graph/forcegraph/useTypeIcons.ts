'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getIconNode,
  iconNodeToPathData,
  loadIconNode,
  resolveEntityIcon,
} from '@/lib/annotations/icons';

// =============================================================================
// useTypeIcons — node type → drawable glyph, for both renderers.
//
// The 2D painter and the 3D object builder used to disagree about icons in the
// worst possible way: 2D looked them up in a thirteen-entry table that no
// authored name could hit, and 3D did not look at all. Neither was wrong about
// *how* to draw a glyph — they simply had no shared answer to *which*.
//
// This is that answer, resolved once per (types present × declarations) and
// handed to both as ready `Path2D`s. Resolution is the shared
// `resolveEntityIcon` chain, so an icon and a colour can never come from
// different declarations of the same type.
//
// Loading is the only subtlety. Builtin glyphs are in hand synchronously and
// paint on the first frame; anything the author picked from the full lucide
// set arrives one microtask later, and `version` bumps so the canvas repaints.
// A frame without the glyph is a frame with a plain node — never a stall and
// never a wrong picture.
// =============================================================================

/** Path2D per icon name, built once. Module scope: geometry is immutable and
 *  independent of any graph, so remounting must not re-parse it. */
const path2dCache = new Map<string, Path2D[]>();

function pathsFor(iconName: string): Path2D[] | null {
  const cached = path2dCache.get(iconName);
  if (cached) return cached;

  const node = getIconNode(iconName);
  if (!node) return null;

  try {
    const paths = iconNodeToPathData(node).map(d => new Path2D(d));
    if (!paths.length) return null;
    path2dCache.set(iconName, paths);
    return paths;
  } catch {
    // Malformed path data — degrade to no icon rather than killing the frame.
    return null;
  }
}

export interface TypeIcons {
  /** The glyph for a node type, or null when it has none. Case-insensitive,
   *  so the hot path does not have to think about how a type was spelled. */
  get(type: string | null | undefined): Path2D[] | null;
  /** Which glyph that is, by canonical lucide name. Callers that CACHE a
   *  rendering of it must key on this rather than on the node type: re-pick a
   *  type's icon with a graph open and the type is unchanged while the glyph
   *  is not, which is exactly the case a type-keyed cache gets wrong. */
  nameFor(type: string | null | undefined): string | null;
  /** Bumps whenever a lazily-loaded glyph lands. Include it in the paint
   *  callback's dep list so the canvas re-renders with the new geometry. */
  version: number;
}

interface Deps {
  /** Every distinct node type on the canvas, spelled as the nodes spell it. */
  nodeTypes: readonly string[];
  /** What the contract declared, keyed by node type (upper-cased). */
  typeIcons?: Record<string, string>;
  /**
   * Whether types the author said nothing about get the palette's default
   * glyph. **A declaration always paints** — an icon in the contract is part
   * of what the schema means, not a view preference — so this governs only the
   * defaults, which is what the `showNodeIcons` toggle has always been about.
   */
  includeDefaults: boolean;
}

const EMPTY: TypeIcons = { get: () => null, nameFor: () => null, version: 0 };

export function useTypeIcons({ nodeTypes, typeIcons, includeDefaults }: Deps): TypeIcons {
  const [version, setVersion] = useState(0);

  // Type → icon name. Resolution is upper-case, matching `resolveEntityColor`,
  // but the map keeps each type's ORIGINAL spelling alongside so the paint
  // callback's lookup is a hash hit rather than an allocation per node per
  // frame.
  const byType = useMemo(() => {
    const out = new Map<string, string>();
    for (const raw of nodeTypes) {
      const type = String(raw ?? '');
      const key = type.toUpperCase();
      if (!key || out.has(key)) continue;
      const name = resolveEntityIcon(key, { schemaIcons: typeIcons }, { includeDefaults });
      if (!name) continue;
      out.set(key, name);
      if (type !== key) out.set(type, name);
    }
    return out;
  }, [nodeTypes, typeIcons, includeDefaults]);

  // Fetch whatever is not in hand yet. One pass per distinct icon name; the
  // registry dedupes concurrent requests for the same barrel.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    const missing = [...new Set(byType.values())].filter(n => !getIconNode(n));
    if (!missing.length) return;
    let live = true;
    Promise.all(missing.map(loadIconNode)).then(results => {
      if (!live || !mounted.current) return;
      if (results.some(Boolean)) setVersion(v => v + 1);
    });
    return () => { live = false; };
  }, [byType]);

  return useMemo(() => {
    if (!byType.size) return EMPTY;
    const resolved = new Map<string, Path2D[]>();
    for (const [type, name] of byType) {
      const paths = pathsFor(name);
      if (paths) resolved.set(type, paths);
    }
    if (!resolved.size) return EMPTY;
    /** Both maps are keyed the same way, so one lookup rule serves both. */
    const pick = <V,>(map: Map<string, V>, type: string | null | undefined): V | null => {
      if (!type) return null;
      // Only pay for the uppercase when the node's spelling was not one of the
      // ones seen while building the map.
      return map.get(type) ?? map.get(type.toUpperCase()) ?? null;
    };
    return {
      get: (type) => pick(resolved, type),
      nameFor: (type) => pick(byType, type),
      version,
    };
    // `version` is a real input: a glyph that was missing last render may be
    // in `path2dCache` now.
  }, [byType, version]);
}
