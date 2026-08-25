import { describe, expect, test } from 'bun:test';
import {
  REGION_AXIS, REGION_DEFAULT, REGION_MAX, REGION_MIN, clampRegion,
} from './paneTypes';

describe('a region cannot be dragged into uselessness', () => {
  test('never narrower than its minimum', () => {
    // A column dragged to nothing is a column you cannot drag back: the handle
    // goes with it.
    expect(clampRegion('right', 0)).toBe(REGION_MIN.right);
    expect(clampRegion('left', -400)).toBe(REGION_MIN.left);
  });

  test('never wide enough to hide the canvas', () => {
    expect(clampRegion('right', 5000)).toBe(REGION_MAX.right);
    expect(clampRegion('bottom', 5000)).toBe(REGION_MAX.bottom);
  });

  test('and a size in range is the size you asked for', () => {
    expect(clampRegion('right', 420)).toBe(420);
  });

  test('rounded — a fractional pixel is a blurry border', () => {
    expect(clampRegion('right', 420.6)).toBe(421);
  });
});

describe('each region grows the way it is anchored', () => {
  test('the left column follows the pointer', () => {
    const { axis, sign } = REGION_AXIS.left;
    expect(axis).toBe('x');
    expect(300 + 50 * sign).toBe(350);     // drag right → wider
  });

  test('the right column grows against it', () => {
    // Anchored to the right edge, so dragging LEFT makes it wider. Getting this
    // sign wrong reads as the handle being broken rather than inverted.
    const { sign } = REGION_AXIS.right;
    expect(300 + -50 * sign).toBe(350);
  });

  test('the bottom strip grows upward', () => {
    const { axis, sign } = REGION_AXIS.bottom;
    expect(axis).toBe('y');
    expect(144 + -40 * sign).toBe(184);
  });
});

describe('defaults', () => {
  test('every region has one, and it is inside its own bounds', () => {
    for (const r of ['left', 'right', 'bottom'] as const) {
      expect(REGION_DEFAULT[r]).toBeGreaterThanOrEqual(REGION_MIN[r]);
      expect(REGION_DEFAULT[r]).toBeLessThanOrEqual(REGION_MAX[r]);
      expect(clampRegion(r, REGION_DEFAULT[r])).toBe(REGION_DEFAULT[r]);
    }
  });

  test('the right column can hold a table', () => {
    // Eight columns of an observations table do not fit in 300px, which is what
    // the region was fixed at before it could be resized at all.
    expect(REGION_MAX.right).toBeGreaterThanOrEqual(800);
  });
});
