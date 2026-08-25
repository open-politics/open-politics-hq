import { describe, expect, test } from 'bun:test';
import { clusterCells, effectiveAnchors } from './anchors';

const R = 100;

describe('clusters get cells, not points on a circle', () => {
  test('every group gets an interior', () => {
    // A circle of label positions puts every group the same distance from every
    // other and leaves the middle a contested void. A grid gives each group an
    // interior, and an interior is what lets the LOCAL forces read again.
    const cells = clusterCells(new Map([['a', 10], ['b', 5], ['c', 2]]), R);
    expect(cells.size).toBe(3);
    for (const c of cells.values()) expect(c.r).toBeGreaterThan(0);
  });

  test('cells do not overlap', () => {
    const cells = [...clusterCells(
      new Map([['a', 9], ['b', 9], ['c', 9], ['d', 9]]), R, 40,
    ).values()];
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const dx = cells[i].at[0] - cells[j].at[0];
        const dy = cells[i].at[1] - cells[j].at[1];
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(cells[i].r + cells[j].r);
      }
    }
  });

  test('area tracks membership, because area is what the eye compares', () => {
    const cells = clusterCells(new Map([['big', 100], ['small', 1]]), R, 40);
    const big = cells.get('big')!, small = cells.get('small')!;
    // √ scaling: 100× the members is 10× the radius, so 100× the AREA. Linear
    // radius would make the big pile 100× wider and unreadable beside it.
    expect(big.r / small.r).toBeCloseTo(10, 0);
  });

  test('a group of one is still a place, not a point', () => {
    const cells = clusterCells(new Map([['lonely', 1], ['crowd', 500]]), R);
    expect(cells.get('lonely')!.r).toBeGreaterThan(0);
  });

  test('the largest pile lands first, where reading starts', () => {
    const cells = clusterCells(new Map([['small', 1], ['big', 50]]), R);
    const big = cells.get('big')!, small = cells.get('small')!;
    expect(big.at[0]).toBeLessThanOrEqual(small.at[0]);
  });

  test('order does not depend on insertion order', () => {
    const a = clusterCells(new Map([['x', 3], ['y', 3]]), R);
    const b = clusterCells(new Map([['y', 3], ['x', 3]]), R);
    expect(a.get('x')!.at).toEqual(b.get('x')!.at);
  });

  test('nothing to cluster, nothing to place', () => {
    expect(clusterCells(new Map(), R).size).toBe(0);
  });
});

describe('a binding written in the bar reaches the layout', () => {
  test('CLUSTER: in the query installs a cluster anchor', () => {
    // FAULTS F1: `effectiveAnchors` read only `config.anchors`, written by the
    // old axis-budget popover, and had never heard of the query string.
    // Writing `CLUSTER:place` and writing nothing produced identical pictures.
    // Strength above the 0.9 link ceiling: at 0.6 any edge crossing two cells
    // dragged both endpoints out of them.
    expect(effectiveAnchors({}, 'CLUSTER:place')).toEqual([
      { kind: 'cluster', strength: 0.95 },
    ]);
  });

  test('case-insensitively, like every other clause', () => {
    expect(effectiveAnchors({}, 'type:Person cluster:place').length).toBe(1);
  });

  test('the query outranks a stored config', () => {
    // The bar is what the analyst just typed; a layout that ignores it in
    // favour of a popover setting from last week is indistinguishable from a
    // bug.
    const anchors = effectiveAnchors(
      { anchors: [{ kind: 'geo', strength: 1 }] }, 'CLUSTER:type',
    );
    expect(anchors.map(a => a.kind)).toEqual(['cluster']);
  });

  test('a stored config still applies when the query says nothing', () => {
    expect(effectiveAnchors({ anchors: [{ kind: 'geo' }] }, 'type:Person'))
      .toEqual([{ kind: 'geo' }]);
    expect(effectiveAnchors({ clusterByType: true }, ''))
      .toEqual([{ kind: 'type', strength: 0.3 }]);
  });

  test('no binding, no anchors — an unconfigured panel stays force-directed', () => {
    // A grouping that appears on its own is indistinguishable from a finding.
    expect(effectiveAnchors({}, '')).toEqual([]);
  });
});

describe('a cell is sized from what is inside it', () => {
  const NODE_R = 60;

  test('a pile fits in its own cell', () => {
    // The first pass sized cells as a fraction of an arbitrary layout radius:
    // 33 nodes at a 60px collision radius need r ≈ √33 × 60 ≈ 345 and the cell
    // was 194, so collision blew every pile out through its own boundary and
    // into its neighbours — which reads exactly like no clustering at all.
    const cells = clusterCells(new Map([['big', 33]]), R, NODE_R);
    const cell = cells.get('big')!;
    expect(cell.r).toBeGreaterThanOrEqual(Math.sqrt(33) * NODE_R * 0.95);
  });

  test('and still cannot reach its neighbour, whatever the counts', () => {
    const cells = [...clusterCells(
      new Map([['a', 40], ['b', 1], ['c', 12], ['d', 3]]), R, NODE_R,
    ).values()];
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const d = Math.hypot(
          cells[i].at[0] - cells[j].at[0], cells[i].at[1] - cells[j].at[1],
        );
        expect(d).toBeGreaterThanOrEqual(cells[i].r + cells[j].r);
      }
    }
  });

  test('bigger nodes need bigger cells', () => {
    const small = clusterCells(new Map([['x', 10]]), R, 20).get('x')!;
    const large = clusterCells(new Map([['x', 10]]), R, 80).get('x')!;
    expect(large.r).toBeGreaterThan(small.r * 3);
  });
});
