import { describe, expect, it } from 'vitest';
import { tangentRange, writeLeaf, type LeafGrid } from '../../src/world/library/reader/pageCurl.ts';

/**
 * **Does a turning page behave like paper?** (#717)
 *
 * `pageCurl.ts` claims three things about every frame of a turn, and a page
 * that broke any of them would look wrong in a way no screenshot reliably
 * catches — a stretch of a few percent, a corner dipping a millimetre into the
 * stack it is turning over. So they are measured here, on the positions the
 * reader actually writes into its mesh, at many points through the turn.
 */

const GRID: LeafGrid = { columns: 28, rows: 10, width: 0.45, height: 0.6 };
const Z_RIGHT = 0.02;
const Z_LEFT = 0.015;

function leafAt(t: number): Float32Array {
  const out = new Float32Array((GRID.columns + 1) * (GRID.rows + 1) * 3);
  writeLeaf(t, GRID, Z_RIGHT, Z_LEFT, out);
  return out;
}

function vertex(leaf: Float32Array, ix: number, iy: number): [number, number, number] {
  const i = (iy * (GRID.columns + 1) + ix) * 3;
  return [leaf[i] ?? NaN, leaf[i + 1] ?? NaN, leaf[i + 2] ?? NaN];
}

const STEPS = Array.from({ length: 41 }, (_, i) => i / 40);

describe('a turning page', () => {
  it('lies flat on the right at the start and flat on the left at the end', () => {
    const start = leafAt(0);
    const end = leafAt(1);
    for (let iy = 0; iy <= GRID.rows; iy += 1) {
      for (let ix = 0; ix <= GRID.columns; ix += 1) {
        const s = (ix / GRID.columns) * GRID.width;
        const [x0, , z0] = vertex(start, ix, iy);
        const [x1, , z1] = vertex(end, ix, iy);
        expect(x0, `start x at column ${ix}`).toBeCloseTo(s, 6);
        expect(z0, `start z at column ${ix}`).toBeCloseTo(Z_RIGHT, 6);
        expect(x1, `end x at column ${ix}`).toBeCloseTo(-s, 6);
        expect(z1, `end z at column ${ix}`).toBeCloseTo(Z_LEFT, 6);
      }
    }
  });

  it('never stretches: every row stays exactly one page wide, all the way through', () => {
    let worst = 0;
    for (const t of STEPS) {
      const leaf = leafAt(t);
      for (let iy = 0; iy <= GRID.rows; iy += 1) {
        let length = 0;
        for (let ix = 0; ix < GRID.columns; ix += 1) {
          const [ax, ay, az] = vertex(leaf, ix, iy);
          const [bx, by, bz] = vertex(leaf, ix + 1, iy);
          length += Math.hypot(bx - ax, by - ay, bz - az);
        }
        worst = Math.max(worst, Math.abs(length - GRID.width) / GRID.width);
      }
    }
    // Real numbers, not a NaN that compares false to everything.
    expect(Number.isFinite(worst)).toBe(true);
    expect(worst, `worst row stretch ${(worst * 100).toFixed(4)}%`).toBeLessThan(1e-5);
  });

  it('never dips below the paper it is turning over', () => {
    let lowest = Infinity;
    for (const t of STEPS) {
      const leaf = leafAt(t);
      for (let i = 2; i < leaf.length; i += 3) lowest = Math.min(lowest, leaf[i] ?? NaN);
      const { min, max } = tangentRange(t);
      expect(min, `tangent at t=${t}`).toBeGreaterThanOrEqual(0);
      expect(max, `tangent at t=${t}`).toBeLessThanOrEqual(Math.PI);
    }
    expect(lowest).toBeGreaterThanOrEqual(Math.min(Z_LEFT, Z_RIGHT) - 1e-9);
  });

  it('really curls mid-turn, and lifts the bottom corner first', () => {
    // A rigid swing would leave the fore-edge on the straight line through the
    // spine; paper bends away from it. Measured at the quarter turn.
    const leaf = leafAt(0.25);
    const [sx, , sz] = vertex(leaf, 1, GRID.rows);
    const [ex, , ez] = vertex(leaf, GRID.columns, GRID.rows);
    const spineAngle = Math.atan2(sz - Z_RIGHT, sx);
    const edgeAngle = Math.atan2(ez - Z_RIGHT, ex);
    expect(edgeAngle - spineAngle, 'the fore-edge leads the spine by a real bend').toBeGreaterThan(0.3);
    const [, , bottomZ] = vertex(leaf, GRID.columns, GRID.rows);
    const [, , topZ] = vertex(leaf, GRID.columns, 0);
    expect(bottomZ, 'the bottom corner is higher than the top one').toBeGreaterThan(topZ);
  });
});
