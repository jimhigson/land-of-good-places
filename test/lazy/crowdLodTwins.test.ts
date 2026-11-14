import { describe, expect, it } from 'vitest';
import { BoxGeometry, SphereGeometry } from 'three';
import { lowDetailGeometry, triangleCount } from '../../src/core/instancedLod';

/**
 * **A far level is derived once per content, not once per geometry object.**
 *
 * The great hall's banquet builds its own crowd prototype (`KidCrowd`), part
 * for part the same drawing as the park crowd's but in separate geometry
 * objects — measured in a real page, 30 of the 44 parts are separate objects
 * with byte-identical arrays. With the far levels cached by object, the
 * banquet simplified all 30 again: 59 ms of the castle interior's 105 ms
 * build, on the frame the iris closes on her first walk in (#759).
 *
 * Proved red against the identity-only cache (main bb7e9c99's
 * `src/core/instancedLod.ts` copied over the fix, the same two spheres):
 * `Tests  2 failed | 2 passed (4)` — the first and third clauses, each
 * "AssertionError: expected BufferGeometry{ …(17) } to be BufferGeometry{
 * …(17) } // Object.is equality": the twin came back with a far level of its
 * own, a second object, simplified a second time. The two that passed there
 * are the ones that must hold either way.
 */
describe('lowDetailGeometry shares far levels between geometries of the same content', () => {
  // 48 × 32 segments: 2,976 triangles, which a 2 cm bound on a unit sphere
  // simplifies well past `LOD_MIN_SAVING`.
  const TOLERANCE = 0.02;

  it('hands a twin the far level already derived, not a second one', () => {
    const first = new SphereGeometry(1, 48, 32);
    const twin = new SphereGeometry(1, 48, 32);
    expect(twin).not.toBe(first);

    const low = lowDetailGeometry(first, TOLERANCE, false);
    // A real far level, so the clause below is about sharing one.
    expect(low).not.toBe(first);
    expect(triangleCount(low)).toBeLessThan(triangleCount(first));

    expect(lowDetailGeometry(twin, TOLERANCE, false)).toBe(low);
  });

  it('gives a geometry of different content its own far level', () => {
    const first = new SphereGeometry(1, 48, 32);
    const other = new SphereGeometry(1.01, 48, 32);
    const low = lowDetailGeometry(first, TOLERANCE, false);
    const otherLow = lowDetailGeometry(other, TOLERANCE, false);
    expect(otherLow).not.toBe(low);
    expect(otherLow).not.toBe(other);
  });

  it('keeps tolerance and texturing apart, for twins as for one geometry', () => {
    const first = new SphereGeometry(1, 48, 32);
    const twin = new SphereGeometry(1, 48, 32);
    const untextured = lowDetailGeometry(first, TOLERANCE, false);
    const textured = lowDetailGeometry(twin, TOLERANCE, true);
    expect(textured).not.toBe(untextured);
    // Each question asked of one twin is answered for the other.
    expect(lowDetailGeometry(first, TOLERANCE, true)).toBe(textured);
    expect(lowDetailGeometry(twin, TOLERANCE, false)).toBe(untextured);
    expect(lowDetailGeometry(twin, TOLERANCE * 2, false)).not.toBe(untextured);
  });

  it('answers "no second level" with each twin\'s own source, never the other one', () => {
    // 12 triangles: under `LOD_MIN_TRIANGLES`, so the source is its own far level.
    const box = new BoxGeometry(1, 1, 1);
    const twin = new BoxGeometry(1, 1, 1);
    expect(lowDetailGeometry(box, TOLERANCE, false)).toBe(box);
    expect(lowDetailGeometry(twin, TOLERANCE, false)).toBe(twin);
  });
});
