/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { pageNodeIds, pageQuery, pinDoc, pinNode, type PinPage } from './pins';
import type { GraphNode } from '../graphTypes';

const node = (id: string, label: string) => ({ id, label } as GraphNode);

const page = (pins: PinPage['pins'], pinnedNodeIds: string[] = []): PinPage =>
  ({ id: 'p', label: 'Pins', pins, pinnedNodeIds });

describe('a document is one pin', () => {
  test('pinning a filing that names eight things is ONE pin', () => {
    // The regression this exists to stop: the docs pane handed up the node ids
    // its rows had minted and the board made a pin per id, so pinning one
    // document produced "exhibits #1 … #8" and said nothing a reader could act
    // on. A document is a single thing.
    const p = pinDoc(847020, 'EFTA00963525.pdf',
                     ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']);
    expect(p.kind).toBe('doc');
    expect(p.label).toBe('EFTA00963525.pdf');
    expect(pageQuery(page([p]))).toBe('doc.asset_id:847020');
  });

  test('the ids it carries are a highlight HINT, not the definition', () => {
    // The term is what survives a re-run; the ids are what the canvas can light
    // up immediately without resolving anything.
    const p = pinDoc(1, 'a.pdf', ['n1', 'n2']);
    expect(p.term).toBe('doc.asset_id:1');
    expect([...pageNodeIds(page([p]))]).toEqual(['n1', 'n2']);
  });

  test('a document with no title still reads as something', () => {
    expect(pinDoc(42, undefined).label).toBe('document 42');
    expect(pinDoc(42, '   ').label).toBe('document 42');
  });

  test('re-pinning the same document is the same pin', () => {
    // Idempotency is carried by the id, so the caller can filter-then-append
    // without growing the board.
    expect(pinDoc(7, 'x.pdf').id).toBe(pinDoc(7, 'renamed.pdf').id);
  });
});

describe('term-pins and node-pins coexist', () => {
  test('a page unions both kinds for the highlight', () => {
    // This is what lets the doc pin land without rewriting every pin site:
    // the two forms live side by side and `pageNodeIds` is the one place the
    // union happens.
    const p = page([pinDoc(9, 'd.pdf', ['a', 'b'])], ['c']);
    expect([...pageNodeIds(p)].sort()).toEqual(['a', 'b', 'c']);
  });

  test('several pins union into ANY(...) — a page is still a query', () => {
    const p = page([pinDoc(1, 'a.pdf'), pinNode(node('n2', 'Merkel'))]);
    expect(pageQuery(p)).toBe('ANY(doc.asset_id:1, label=="Merkel")');
  });

  test('one pin needs no wrapper — the bare form is the readable one', () => {
    expect(pageQuery(page([pinNode(node('n', 'Merkel'))]))).toBe('label=="Merkel"');
  });

  test('an empty page is no query, not an empty ANY()', () => {
    expect(pageQuery(page([]))).toBe('');
  });
});
