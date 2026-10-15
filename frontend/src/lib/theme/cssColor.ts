'use client';

/**
 * CSS custom properties → colours a canvas, WebGL or a map style can use.
 *
 * Canvas, Three.js, deck.gl and MapLibre all need literal colours, and none of
 * them re-read the page when the theme flips. Two problems, one module:
 *
 * - **Resolution.** ``getComputedStyle(el).getPropertyValue('--x')`` returns
 *   the unresolved literal, and a probe element's computed ``color`` may come
 *   back as ``oklch(…)`` / ``lab(…)`` (CSS Color 4 preserves the source space).
 *   Most WebGL colour parsers silently turn those into black. So the value is
 *   rasterised through a 1×1 canvas, which always yields sRGB bytes.
 * - **Staleness.** :func:`useThemeVersion` bumps whenever next-themes flips
 *   the class on ``<html>``, so dependents re-read.
 *
 * Lifted out of the graph's ``useThemeReads`` so the map and the graph read
 * the theme the same way.
 */
import { useEffect, useState } from 'react';

let probeEl: HTMLDivElement | null = null;
function probe(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (probeEl && probeEl.isConnected) return probeEl;
  probeEl = document.createElement('div');
  probeEl.setAttribute('aria-hidden', 'true');
  probeEl.style.cssText =
    'position:absolute;left:-9999px;top:-9999px;width:0;height:0;pointer-events:none;visibility:hidden;';
  document.body.appendChild(probeEl);
  return probeEl;
}

let rasterCtx: CanvasRenderingContext2D | null = null;
function rasterise(color: string): [number, number, number, number] | null {
  if (typeof document === 'undefined') return null;
  if (!rasterCtx) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    rasterCtx = c.getContext('2d', { willReadFrequently: true });
  }
  if (!rasterCtx) return null;
  rasterCtx.clearRect(0, 0, 1, 1);
  rasterCtx.fillStyle = color;
  rasterCtx.fillRect(0, 0, 1, 1);
  try {
    const d = rasterCtx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  } catch {
    return null;
  }
}

/** A CSS variable as ``[r, g, b, a]`` bytes — alpha included, so translucent
 *  tokens (``--hud-line`` is 11% black) survive the trip. */
export function resolveVarToRgba(
  varName: string,
  fallback: [number, number, number, number],
): [number, number, number, number] {
  const el = probe();
  if (!el) return fallback;
  el.style.color = `var(${varName})`;
  const computed = getComputedStyle(el).color;
  if (!computed) return fallback;
  return rasterise(computed) ?? fallback;
}

/** A CSS variable as an opaque ``rgb(r, g, b)`` string. */
export function resolveVarToRgb(varName: string, fallback: string): string {
  const el = probe();
  if (!el) return fallback;
  el.style.color = `var(${varName}, ${fallback})`;
  const computed = getComputedStyle(el).color;
  if (!computed || computed === 'rgba(0, 0, 0, 0)') return fallback;
  if (/^rgba?\(/i.test(computed)) return computed;
  const px = rasterise(computed);
  return px ? `rgb(${px[0]}, ${px[1]}, ${px[2]})` : fallback;
}

/** ``[r, g, b, a]`` bytes → a CSS ``rgba()`` string, for map styles. */
export function rgbaCss([r, g, b, a]: [number, number, number, number]): string {
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

/**
 * A counter that changes whenever the theme does. Put it in a dependency list
 * to re-resolve colours after a flip. The read is deferred one frame so
 * next-themes has committed its class before anything computes a style.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const bump = () => requestAnimationFrame(() => setVersion((v) => v + 1));
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === 'class' || m.attributeName === 'data-theme'
          || m.attributeName === 'style')) bump();
    });
    observer.observe(document.documentElement, {
      attributes: true, attributeFilter: ['class', 'data-theme', 'style'],
    });
    bump();
    return () => observer.disconnect();
  }, []);
  return version;
}
