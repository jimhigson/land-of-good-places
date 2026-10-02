import { describe, expect, it } from 'vitest';
import { buildBug } from '../scripts/lib/attemptError.mts';

// `paths.ts` reads the park's restart at import; with none given a Node process
// runs the whole acceptance loop to find one, which a pure geometry test must
// not wait on. `routeCurve` reads no park at all.
process.env['LGP_PARK_RESTART'] ??= '0';
const { routeCurve } = await import('../src/world/paths');

/**
 * A park build that throws is either a park this stream cannot make (start
 * again) or a bug (stop, and say so). `buildBug` decides by error class; these
 * hold it to both halves, and hold the seed 15 restart 7 route it was found on.
 */
describe('buildBug', () => {
  it('calls a TypeError a bug, even wrapped the way the plan driver wraps it', () => {
    const inner = new TypeError("Cannot read properties of undefined (reading 'x')");
    const wrapped = new Error(`${inner.message}\n--- park-solve trace ---`, { cause: inner });
    expect(buildBug(wrapped)).toBe(inner);
  });

  it('calls a RangeError, ReferenceError and SyntaxError bugs', () => {
    for (const error of [new RangeError('r'), new ReferenceError('f'), new SyntaxError('s')]) {
      expect(buildBug(error)).toBe(error);
    }
  });

  it('does not call a solver giving up a bug — whatever its message says', () => {
    class RailRouteUnsolvable extends Error {}
    expect(buildBug(new Error('park solve: seed 3: decision zero exhausted (1 attempts)'))).toBeNull();
    expect(buildBug(new RailRouteUnsolvable('rail route did not solve'))).toBeNull();
    // The message of a TypeError, on an ordinary Error, is still an ordinary failure: class, not text.
    expect(buildBug(new Error("TypeError: Cannot read properties of undefined (reading 'x')"))).toBeNull();
    expect(buildBug('a string')).toBeNull();
  });
});

describe('routeCurve', () => {
  it('draws the seed 15 restart 7 out-and-back detour instead of throwing', () => {
    // repairRouteOffBridges' detour on seed 15 restart 7: out 0.86 m and straight back.
    const points: (readonly [number, number])[] = [
      [-69.28663795146504, 2.47640654050344],
      [-70, 2],
      [-69.28663795146504, 2.47640654050344],
    ];
    const curve = routeCurve({ name: 'arch-feet-screen', width: 2.4, closed: false, points });
    expect(curve.points.length).toBeGreaterThanOrEqual(2);
    expect(curve.getLength()).toBeGreaterThan(1);
  });

  it('refuses a route that draws one point with a RangeError, which buildBug calls a bug', () => {
    let thrown: unknown = null;
    try {
      routeCurve({ name: 'one-point', width: 2.4, closed: false, points: [[1, 1], [1.01, 1]] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    expect(buildBug(thrown)).toBe(thrown);
  });
});
