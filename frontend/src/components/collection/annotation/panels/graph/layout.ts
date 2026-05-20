/**
 * Graph-layout dispatcher.
 *
 * v1 implements `force_directed` only. The other variants are declared in the
 * discriminated union so the UI can surface "coming soon" copy via a caught
 * `NotImplementedError`. When a layout mode is wired, drop the stub and
 * return the computed positions.
 */
import type { GraphNode, GraphEdge } from '@/components/collection/graph';

export type GraphLayout =
  | { kind: 'force_directed' }
  | { kind: 'spatial'; xField: string; yField: string }
  | { kind: 'radial'; centerField?: string }
  | { kind: 'hierarchical'; rootField?: string };

export class NotImplementedError extends Error {
  readonly code = 'LAYOUT_NOT_IMPLEMENTED';
  constructor(readonly layoutKind: GraphLayout['kind'], hint?: string) {
    super(
      hint ?? `Graph layout '${layoutKind}' is not implemented yet.`,
    );
  }
}

export interface LayoutResult {
  /** node_id → absolute (x, y). `null` lets D3 free-simulate that node. */
  positions: Map<string, { x: number; y: number } | null>;
  /** True when the caller should let D3's force sim run; false = positions are authoritative. */
  runSimulation: boolean;
}

/**
 * Compute (or prepare) positions for the given layout. `force_directed`
 * returns an empty map + `runSimulation=true` so D3 owns the layout; other
 * modes throw `NotImplementedError` until wired.
 */
export function computeLayout(
  _nodes: GraphNode[],
  _edges: GraphEdge[],
  layout: GraphLayout,
): LayoutResult {
  switch (layout.kind) {
    case 'force_directed':
      return { positions: new Map(), runSimulation: true };
    case 'spatial':
      throw new NotImplementedError(
        'spatial',
        'Spatial layout requires layout_x and layout_y fields; coming soon.',
      );
    case 'radial':
      throw new NotImplementedError('radial');
    case 'hierarchical':
      throw new NotImplementedError('hierarchical');
  }
}

export const DEFAULT_GRAPH_LAYOUT: GraphLayout = { kind: 'force_directed' };
