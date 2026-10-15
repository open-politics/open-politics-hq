/**
 * The overview's deck.gl layers. One mark per place, two treatments:
 *
 *   ●  row rung — rows that STATED this place ("the meeting was in Valletta")
 *   ○  doc rung — rows placed here only by their document ("a filing about Malta")
 *
 * Never drawn alike (`annotation/overview.py`, D7). A place with both shows
 * the dot inside its ring. Size is √count against the largest mark on
 * screen, so the eye compares areas, not radii.
 *
 * No GPU attribute transitions: deck runs them through a transform-feedback
 * shader that fails to compile on some drivers (Apple/ANGLE), and a failed
 * compile paints the shader source over the page. Counts change rarely
 * enough that a snap reads fine.
 *
 * Ink only. Hue is held back until a mark has something to say with it — the
 * section chips already say which sections are being counted.
 */
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { Marker } from '@/lib/overview/derive';

export type RGBA = [number, number, number, number];

export interface OverviewInk {
  fg: RGBA;
  dim: RGBA;
  halo: RGBA;
}

const R_MIN = 2.5;
const R_MAX = 26;

function radius(n: number, max: number): number {
  return max > 0 ? R_MIN + (R_MAX - R_MIN) * Math.sqrt(n / max) : R_MIN;
}

function alpha([r, g, b]: RGBA, a: number): RGBA {
  return [r, g, b, Math.round(a * 255)];
}

export function overviewLayers(args: {
  markers: Marker[];
  ink: OverviewInk;
  hovered: number | null;
  selected: number | null;
  labels: number;
  onHover: (info: PickingInfo<Marker>) => void;
  onClick: (info: PickingInfo<Marker>) => void;
}): Layer[] {
  const { markers, ink, hovered, selected, labels, onHover, onClick } = args;
  const max = markers.reduce((m, x) => Math.max(m, x.total), 0);
  const focus = (p: number) => p === hovered || p === selected;
  const anyFocus = hovered != null || selected != null;
  const triggers = [hovered, selected, max];

  const doc = new ScatterplotLayer<Marker>({
    id: 'overview-doc',
    data: markers.filter((m) => m.doc > 0),
    getPosition: (m) => [m.lon, m.lat],
    getRadius: (m) => radius(m.total, max),
    radiusUnits: 'pixels',
    filled: false,
    stroked: true,
    getLineColor: (m) => alpha(ink.fg, focus(m.p) ? 0.95 : anyFocus ? 0.18 : 0.42),
    getLineWidth: (m) => (focus(m.p) ? 1.5 : 1),
    lineWidthUnits: 'pixels',
    pickable: true,
    onHover,
    onClick,
    updateTriggers: { getRadius: triggers, getLineColor: triggers, getLineWidth: triggers },
  });

  const row = new ScatterplotLayer<Marker>({
    id: 'overview-row',
    data: markers.filter((m) => m.row > 0),
    getPosition: (m) => [m.lon, m.lat],
    // The dot is the share of the place's rows that stated it; the ring
    // around it is the whole.
    getRadius: (m) => radius(m.row, max),
    radiusUnits: 'pixels',
    filled: true,
    stroked: false,
    getFillColor: (m) => alpha(ink.fg, focus(m.p) ? 0.95 : anyFocus ? 0.2 : 0.72),
    pickable: true,
    onHover,
    onClick,
    updateTriggers: { getRadius: triggers, getFillColor: triggers },
  });

  const named = markers.slice(0, labels).concat(
    markers.filter((m) => focus(m.p) && markers.indexOf(m) >= labels),
  );
  const text = new TextLayer<Marker>({
    id: 'overview-labels',
    data: named,
    getPosition: (m) => [m.lon, m.lat],
    getText: (m) => m.name,
    getSize: 11,
    sizeUnits: 'pixels',
    getColor: (m) => alpha(ink.fg, focus(m.p) || !anyFocus ? 0.88 : 0.35),
    getPixelOffset: (m) => [radius(m.total, max) + 5, 0],
    getTextAnchor: 'start',
    getAlignmentBaseline: 'center',
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
    fontWeight: 500,
    characterSet: 'auto',
    outlineWidth: 3,
    outlineColor: ink.halo,
    fontSettings: { sdf: true },
    updateTriggers: { getColor: triggers, getPixelOffset: triggers },
  });

  return [doc, row, text];
}
