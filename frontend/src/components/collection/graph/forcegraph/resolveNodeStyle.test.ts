/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { resolveNodeStyle, type NodeSelectionState, type ThemeTokens } from './resolveNodeStyle';
import type { GraphNode } from '../graphTypes';

// =============================================================================
// 16-combo selection-precedence snapshot. Pins the cascade order so future
// edits to resolveNodeStyle can't silently swap which selection set "wins"
// when a node sits in multiple sets.
//
// Combos: highlighted × connected × merge × group  →  16 cells.
// =============================================================================

const NODE: GraphNode = { id: 'n1', label: 'Test', type: 'PERSON' };
const BASE_COLOR = '#3B82F6';
const THEME: ThemeTokens = {
  edgeStroke: '#999999',
  nodeStroke: '#ffffff',
  nodeLabel: '#333333',
  edgeLabel: '#666666',
  labelHalo: 'rgba(255,255,255,0.75)',
};

function selection(opts: { hi?: boolean; conn?: boolean; merge?: boolean; group?: boolean }): NodeSelectionState {
  return {
    highlightedNodeId: opts.hi ? 'n1' : (opts.conn || opts.merge || opts.group) ? 'other' : null,
    connectedNodeIds: new Set(opts.conn ? ['n1'] : []),
    mergeSelectedNodeIds: new Set(opts.merge ? ['n1'] : []),
    groupSelectedIds: new Set(opts.group ? ['n1'] : []),
  };
}

describe('resolveNodeStyle — selection-precedence cascade', () => {
  test('plain node with no selection state', () => {
    const r = resolveNodeStyle(NODE, selection({}), BASE_COLOR, THEME);
    expect(r.ringColor).toBe(THEME.nodeStroke);
    expect(r.ringWidth).toBe(1.25);
    expect(r.ringDash).toBeNull();
    expect(r.opacity).toBe(1);
    expect(r.scale).toBe(1);
    expect(r.labelColor).toBe(THEME.nodeLabel);
    expect(r.labelAlwaysVisible).toBe(false);
  });

  test('highlighted alone — blue ring, scale 1.6, brighter fill', () => {
    const r = resolveNodeStyle(NODE, selection({ hi: true }), BASE_COLOR, THEME);
    expect(r.ringColor).toBe('#2563eb');
    expect(r.ringWidth).toBe(3);
    expect(r.scale).toBe(1.6);
    expect(r.opacity).toBe(1);
  });

  test('connected alone — green ring', () => {
    const r = resolveNodeStyle(NODE, selection({ conn: true }), BASE_COLOR, THEME);
    expect(r.ringColor).toBe('#10b981');
    expect(r.ringWidth).toBe(1.25);
  });

  test('merge alone — amber ring, width 4', () => {
    const r = resolveNodeStyle(NODE, selection({ merge: true }), BASE_COLOR, THEME);
    expect(r.ringColor).toBe('#f59e0b');
    expect(r.ringWidth).toBe(4);
    expect(r.labelColor).toBe('#f59e0b');
  });

  test('group alone — cyan ring, dashed', () => {
    const r = resolveNodeStyle(NODE, selection({ group: true }), BASE_COLOR, THEME);
    expect(r.ringColor).toBe('#06b6d4');
    expect(r.ringWidth).toBe(3);
    expect(r.ringDash).toEqual([4, 2]);
  });

  test('merge beats group', () => {
    const r = resolveNodeStyle(NODE, selection({ merge: true, group: true }), BASE_COLOR, THEME);
    expect(r.ringColor).toBe('#f59e0b');
    expect(r.ringWidth).toBe(4);
  });

  test('merge beats highlighted', () => {
    const r = resolveNodeStyle(NODE, selection({ merge: true, hi: true }), BASE_COLOR, THEME);
    expect(r.ringColor).toBe('#f59e0b');
    expect(r.ringWidth).toBe(4);
    // Note: highlighted still wins for fill cascade in the ORIGINAL D3 code
    // because the fill `else if` chain checks merge first then hi.
    // resolveNodeStyle mirrors that: merge fill cascade wins.
  });

  test('group beats highlighted (ring), highlighted still drives scale', () => {
    const r = resolveNodeStyle(NODE, selection({ group: true, hi: true }), BASE_COLOR, THEME);
    expect(r.ringColor).toBe('#06b6d4');
    expect(r.ringWidth).toBe(3);
    expect(r.scale).toBe(1.6); // highlighted always sets scale regardless of ring winner
  });

  test('highlighted beats connected', () => {
    const r = resolveNodeStyle(NODE, selection({ hi: true, conn: true }), BASE_COLOR, THEME);
    expect(r.ringColor).toBe('#2563eb');
  });

  test('connected with active highlight elsewhere — not dimmed', () => {
    const r = resolveNodeStyle(NODE, selection({ conn: true }), BASE_COLOR, THEME);
    expect(r.opacity).toBe(1);
    expect(r.ringColor).toBe('#10b981');
  });

  test('plain node with active highlight elsewhere — dimmed', () => {
    const sel: NodeSelectionState = {
      highlightedNodeId: 'somewhere-else',
      connectedNodeIds: new Set(),
      mergeSelectedNodeIds: new Set(),
      groupSelectedIds: new Set(),
    };
    const r = resolveNodeStyle(NODE, sel, BASE_COLOR, THEME);
    expect(r.opacity).toBe(0.4);
    expect(r.labelColor).toBe(THEME.edgeLabel);
  });

  test('merge + group + highlighted + connected — merge wins ring, hi wins scale', () => {
    const r = resolveNodeStyle(NODE, selection({ merge: true, group: true, hi: true, conn: true }), BASE_COLOR, THEME);
    expect(r.ringColor).toBe('#f59e0b'); // merge beats all
    expect(r.ringWidth).toBe(4);
    expect(r.scale).toBe(1.6); // highlighted always sets scale
    expect(r.labelAlwaysVisible).toBe(true);
  });

  test('selected nodes (any kind) always show label regardless of zoom', () => {
    expect(resolveNodeStyle(NODE, selection({ hi: true }), BASE_COLOR, THEME).labelAlwaysVisible).toBe(true);
    expect(resolveNodeStyle(NODE, selection({ conn: true }), BASE_COLOR, THEME).labelAlwaysVisible).toBe(true);
    expect(resolveNodeStyle(NODE, selection({ merge: true }), BASE_COLOR, THEME).labelAlwaysVisible).toBe(true);
    expect(resolveNodeStyle(NODE, selection({ group: true }), BASE_COLOR, THEME).labelAlwaysVisible).toBe(true);
  });
});
