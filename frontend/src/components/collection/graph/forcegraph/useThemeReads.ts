'use client';

import { useEffect, useState } from 'react';
import type { ThemeTokens } from './resolveNodeStyle';

// =============================================================================
// useThemeReads — bridges CSS custom properties into JS state for the canvas
// and Three.js renderers. SVG inherited ``currentColor`` and CSS vars natively;
// canvas/three need literal color strings, and they don't auto-update on
// theme flips. We read the vars on mount, install a MutationObserver on
// <html class="..."> (this is how next-themes / shadcn flips dark mode), and
// re-read whenever the class flips. Components that depend on the returned
// object re-render when it changes — same identity stability as a useState.
//
// Browser-compat note:
//   ``getComputedStyle(root).getPropertyValue('--var')`` returns the var's
//   *unresolved* literal text. In dark mode our graph vars are stored as
//   ``oklch(…)``. Canvas 2D's color parser handles raw oklch reasonably in
//   recent browsers, but ``color-mix(in srgb, oklch(…) X%, transparent)`` —
//   our alpha-modulated form — has historically been worse-supported in
//   Chrome's canvas pipeline than in Firefox's. The symptom is "everything
//   works on Firefox but edges/labels disappear or render wrong on Chrome".
//   To make this universal, we resolve each var through a hidden probe
//   element: its ``color`` is set to ``var(--name, fallback)`` and we read
//   ``getComputedStyle(probe).color``, which always returns ``rgb(R, G, B)``
//   regardless of the source colour space. Canvas then sees plain rgb and
//   ``withAlpha`` produces ``rgba(...)``, both of which every browser's
//   canvas implementation accepts.
// =============================================================================

const FALLBACKS: ThemeTokens = {
  edgeStroke: '#999999',
  nodeStroke: '#ffffff',
  nodeLabel: '#333333',
  edgeLabel: '#666666',
  labelHalo: 'rgba(255,255,255,0.75)',
};

let probeEl: HTMLDivElement | null = null;
function getProbeEl(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (probeEl && probeEl.isConnected) return probeEl;
  probeEl = document.createElement('div');
  probeEl.setAttribute('aria-hidden', 'true');
  probeEl.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;pointer-events:none;visibility:hidden;';
  document.body.appendChild(probeEl);
  return probeEl;
}

let rasterCanvas: HTMLCanvasElement | null = null;
let rasterCtx: CanvasRenderingContext2D | null = null;
function rasterizeToRgb(color: string): string | null {
  if (typeof document === 'undefined') return null;
  if (!rasterCanvas) {
    rasterCanvas = document.createElement('canvas');
    rasterCanvas.width = 1;
    rasterCanvas.height = 1;
    rasterCtx = rasterCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!rasterCtx) return null;
  // Painting through Canvas 2D forces the browser to rasterise the colour
  // into the canvas's sRGB byte buffer regardless of the source colour
  // space (oklch / lab / color-mix all collapse here). Reading the pixel
  // back gives us a portable ``rgb(R, G, B)`` string that every Three.js
  // / tinycolor parser accepts.
  rasterCtx.clearRect(0, 0, 1, 1);
  rasterCtx.fillStyle = color;
  rasterCtx.fillRect(0, 0, 1, 1);
  try {
    const data = rasterCtx.getImageData(0, 0, 1, 1).data;
    return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
  } catch {
    return null; // tainted canvas / cross-origin issue — should not happen for synthetic colours
  }
}

function resolveVarToRgb(varName: string, fallback: string): string {
  const probe = getProbeEl();
  if (!probe) return fallback;
  // ``getComputedStyle(probe).color`` already resolves ``var()`` and
  // ``color-mix()``, but in modern Chrome/Firefox it can return ``lab(...)``
  // or ``oklch(...)`` directly — preserving the source colour space per
  // CSS Color Level 4. Three.js (via tinycolor) doesn't parse those forms
  // and silently substitutes black, which manifests as black 3D edges.
  // Rasterise through a 1×1 canvas to force the conversion to sRGB rgb.
  probe.style.color = `var(${varName}, ${fallback})`;
  const computed = getComputedStyle(probe).color;
  if (!computed || computed === 'rgba(0, 0, 0, 0)') return fallback;
  // Already in rgb() form — skip the rasterise round-trip.
  if (/^rgba?\(/i.test(computed)) return computed;
  const rasterised = rasterizeToRgb(computed);
  return rasterised ?? fallback;
}

function readThemeTokens(): ThemeTokens {
  if (typeof document === 'undefined') return FALLBACKS;
  return {
    edgeStroke: resolveVarToRgb('--graph-edge-stroke', FALLBACKS.edgeStroke),
    nodeStroke: resolveVarToRgb('--graph-node-stroke', FALLBACKS.nodeStroke),
    nodeLabel: resolveVarToRgb('--graph-node-label', FALLBACKS.nodeLabel),
    edgeLabel: resolveVarToRgb('--graph-edge-label', FALLBACKS.edgeLabel),
    labelHalo: resolveVarToRgb('--graph-label-halo', FALLBACKS.labelHalo),
  };
}

export function useThemeReads(): ThemeTokens {
  const [theme, setTheme] = useState<ThemeTokens>(() => readThemeTokens());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    // Re-read on mount in case SSR initial state was stale.
    setTheme(readThemeTokens());

    const root = document.documentElement;
    const update = () => {
      // RAF lets next-themes commit its class change before we read computed
      // styles — without it, the first read after a theme flip can return the
      // pre-flip value because the MutationObserver fires synchronously.
      requestAnimationFrame(() => setTheme(readThemeTokens()));
    };

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class' || m.attributeName === 'data-theme' || m.attributeName === 'style') {
          update();
          return;
        }
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });

    return () => observer.disconnect();
  }, []);

  return theme;
}
