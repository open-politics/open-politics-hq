'use client';

import { useEffect, useState } from 'react';
import type { ThemeTokens } from './resolveNodeStyle';
import { resolveVarToRgb } from '@/lib/theme/cssColor';

// =============================================================================
// useThemeReads — bridges CSS custom properties into JS state for the canvas
// and Three.js renderers. SVG inherited ``currentColor`` and CSS vars natively;
// canvas/three need literal color strings, and they don't auto-update on
// theme flips. We read the vars on mount, install a MutationObserver on
// <html class="..."> (this is how next-themes / shadcn flips dark mode), and
// re-read whenever the class flips. Components that depend on the returned
// object re-render when it changes — same identity stability as a useState.
//
// Each var resolves to plain ``rgb(…)`` through ``lib/theme/cssColor`` — see
// there for why a probe element and a canvas round-trip are needed (oklch and
// color-mix reach canvas and Three.js parsers as black otherwise).
// =============================================================================

const FALLBACKS: ThemeTokens = {
  edgeStroke: '#999999',
  nodeStroke: '#ffffff',
  nodeLabel: '#333333',
  edgeLabel: '#666666',
  labelHalo: 'rgba(255,255,255,0.75)',
};

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
