'use client';

import { useCallback, useRef } from 'react';
import type { GraphNode } from '../graphTypes';

// =============================================================================
// useGroupDrag — multi-node drag. The lib only fires onNodeDrag for the
// dragged node; if multiple nodes are group-selected, we want them all to
// translate by the same delta. This hook returns ``onNodeDragStart``,
// ``onNodeDrag``, and ``onNodeDragEnd`` handlers that:
//
//  1. On start: capture offsets (groupedNode.x - draggedNode.x) for each
//     selected sibling. Pin all simulation nodes (set fx/fy) so the layout
//     can't push them around mid-drag.
//  2. On drag: set fx/fy on each sibling based on the dragged node's new
//     position + its captured offset.
//  3. On end: unpin all (clear fx/fy → x/y) so the simulation can re-settle.
//
// Mirrors D3ForceGraph.tsx:648–689 verbatim.
// =============================================================================

interface UseGroupDragOptions {
  groupSelectedIds: ReadonlySet<string>;
  /** Callback to access the live nodes array — typically a ref to the same
   * memoized array passed to the renderer. */
  getNodes: () => GraphNode[];
}

export function useGroupDrag({ groupSelectedIds, getNodes }: UseGroupDragOptions) {
  // Capture offsets keyed by node id — only populated when the dragged node
  // is part of the group selection.
  const offsetsRef = useRef<Map<string, { dx: number; dy: number }>>(new Map());
  const groupDragRef = useRef(false);

  const onNodeDragStart = useCallback((node: any) => {
    const isGroupDrag = groupSelectedIds.has(node.id);
    groupDragRef.current = isGroupDrag;
    offsetsRef.current.clear();

    if (isGroupDrag) {
      const dx0 = node.x ?? 0;
      const dy0 = node.y ?? 0;
      for (const sibling of getNodes()) {
        if (sibling.id === node.id) continue;
        if (groupSelectedIds.has(sibling.id) && sibling.x != null && sibling.y != null) {
          offsetsRef.current.set(sibling.id, {
            dx: sibling.x - dx0,
            dy: sibling.y - dy0,
          });
        }
      }
    }

    // Pin all nodes so forces can't push anything during the drag.
    // The lib still adjusts fx/fy on the dragged node automatically.
    for (const sn of getNodes() as any[]) {
      if (sn.x != null && sn.y != null) {
        sn.fx = sn.x;
        sn.fy = sn.y;
      }
    }
  }, [groupSelectedIds, getNodes]);

  const onNodeDrag = useCallback((node: any) => {
    if (!groupDragRef.current) return;
    const baseX = node.x ?? 0;
    const baseY = node.y ?? 0;
    for (const sibling of getNodes() as any[]) {
      const off = offsetsRef.current.get(sibling.id);
      if (!off) continue;
      sibling.fx = baseX + off.dx;
      sibling.fy = baseY + off.dy;
    }
  }, [getNodes]);

  const onNodeDragEnd = useCallback(() => {
    groupDragRef.current = false;
    offsetsRef.current.clear();
    // Unpin all — copy fx/fy → x/y, then clear the pins so the sim can
    // re-settle around the new positions.
    for (const sn of getNodes() as any[]) {
      if (sn.fx != null && sn.fy != null) {
        sn.x = sn.fx;
        sn.y = sn.fy;
        sn.fx = null;
        sn.fy = null;
        // 3D: also unpin Z if present
        if (sn.fz != null) {
          sn.z = sn.fz;
          sn.fz = null;
        }
      }
    }
  }, [getNodes]);

  return { onNodeDragStart, onNodeDrag, onNodeDragEnd };
}
