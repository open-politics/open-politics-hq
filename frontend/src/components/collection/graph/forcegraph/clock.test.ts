/// <reference types="bun-types" />
/**
 * The two clocks, and the invariant that the bars and the cursor read the same
 * one.
 *
 * `TimeScrubber` used to histogram `a0`/`a1` whenever an item carried them
 * while `filterByCursor` read `t0`/`t1` unconditionally, so with any `activity`
 * binding in play the bars counted the period items were *about* and the canvas
 * filtered on when they *happened* — under a docstring promising the two could
 * not disagree. These tests are that docstring, executable.
 */
import { describe, expect, test } from 'bun:test';
import { activityCoverage, clockOf, filterByCursor } from '../graphTypes';
import type { GraphEdge, GraphNode } from '../graphTypes';

/** A deposition: given in 2020, describing 2004–2006. The two clocks disagree
 *  by fifteen years, which is exactly when the distinction is the finding. */
const deposition: GraphNode = {
  id: 'dep', label: 'deposition', type: 'Statement', kind: 'occurrence',
  t0: '2020-05-01', t1: '2020-05-01',
  a0: '2004-01-01', a1: '2006-12-31',
};

/** A payment with one clock only. */
const payment: GraphNode = {
  id: 'pay', label: 'payment', type: 'Transfer', kind: 'occurrence',
  t0: '2015-03-01', t1: null,
};

describe('clockOf', () => {
  test('`time` is when it happened', () => {
    expect(clockOf(deposition, 'time')).toEqual({ t0: '2020-05-01', t1: '2020-05-01' });
  });

  test('`activity` is the period it is about', () => {
    expect(clockOf(deposition, 'activity')).toEqual({ t0: '2004-01-01', t1: '2006-12-31' });
  });

  test('`activity` FALLS BACK when nothing bound a second clock', () => {
    // Most corpora bind `activity` on some sections and not others. Dropping
    // the rest would make choosing the clock look like it broke the panel.
    expect(clockOf(payment, 'activity')).toEqual({ t0: '2015-03-01', t1: null });
  });

  test('a half-bound second clock still counts as bound', () => {
    const openEnded = { t0: '2020-01-01', t1: null, a0: '1999-01-01', a1: null };
    expect(clockOf(openEnded, 'activity')).toEqual({ t0: '1999-01-01', t1: null });
  });
});

describe('activityCoverage', () => {
  test('counts what could answer on the second clock', () => {
    expect(activityCoverage([deposition, payment])).toBe(1);
  });

  test('zero means the control has nothing to offer', () => {
    expect(activityCoverage([payment])).toBe(0);
  });
});

describe('filterByCursor reads the clock it is given', () => {
  const nodes = [deposition, payment];
  const edges: GraphEdge[] = [];

  test('in 2005 the deposition is absent on `time` and present on `covers`', () => {
    const cursor = '2005-06-01';
    expect(filterByCursor(nodes, edges, cursor, 'time').nodes.map(n => n.id))
      .toEqual([]);                       // neither had happened yet
    expect(filterByCursor(nodes, edges, cursor, 'activity').nodes.map(n => n.id))
      .toEqual(['dep']);                  // but the deposition is ABOUT 2005
  });

  test('in 2020 that reverses — this is the disagreement, made choosable', () => {
    const cursor = '2020-05-01';
    expect(filterByCursor(nodes, edges, cursor, 'time').nodes.map(n => n.id))
      .toEqual(['dep', 'pay']);           // payment is open-ended from 2015
    expect(filterByCursor(nodes, edges, cursor, 'activity').nodes.map(n => n.id))
      .toEqual(['pay']);                  // the deposition covers 2004–2006
  });

  test('defaults to `time`, so an unconfigured panel is unchanged', () => {
    const cursor = '2005-06-01';
    expect(filterByCursor(nodes, edges, cursor).nodes)
      .toEqual(filterByCursor(nodes, edges, cursor, 'time').nodes);
  });

  test('no cursor returns everything untouched on either clock', () => {
    for (const c of ['time', 'activity'] as const) {
      expect(filterByCursor(nodes, edges, null, c).nodes).toBe(nodes);
    }
  });

  test('an edge survives only when both endpoints and its own interval do', () => {
    const withEdge: GraphEdge[] = [
      { id: 'e', sourceId: 'dep', targetId: 'pay', predicate: 'cites',
        t0: '2020-05-01', t1: null },
    ];
    // On the day it was given: both endpoints live, and so does the edge.
    expect(filterByCursor(nodes, withEdge, '2020-05-01', 'time').edges).toHaveLength(1);
    // On `covers` the deposition is about 2004–2006 and drops out, so its edge
    // cannot survive either — an edge is never left dangling.
    expect(filterByCursor(nodes, withEdge, '2020-05-01', 'activity').edges).toHaveLength(0);
    // A day later the deposition's own instant has passed on either clock.
    expect(filterByCursor(nodes, withEdge, '2020-06-01', 'time').edges).toHaveLength(0);
  });
});
