import type { Geo } from './Geo';
import { PLANET_RADIUS } from './Geo';

/**
 * **How far `to` rises above the tangent plane at `from` — the height a foot
 * actually has to lift to get from one standing place to the other.**
 *
 * This is the one owner of "is that a step up?", and it exists because on a
 * ball there is no such thing as a per-place height that two neighbours can be
 * differenced against. That is worth stating plainly, because two obvious
 * candidates were tried on `eng/radial-collide` and both are wrong:
 *
 * - **A radius from the planet's centre** cancels the planet only between two
 *   points in the same column, or between two points both on the ground. Two
 *   points at the same world `y`, 1.3 m apart radially at 90 m out, differ by
 *   **0.54 m** of radius while a foot lifts nothing.
 * - **An altitude above the ground** reads a level bridge deck over falling
 *   ground as a continuous climb, and would refuse the deck end to end.
 *
 * So a step is irreducibly a question about a *pair* of places, and this is it:
 * project the vector between them onto the local up. Level ground reads zero
 * whatever the lean; a real ledge reads its own real height whatever the lean.
 *
 * ## Why the midpoint's up and not `from`'s
 *
 * So that the answer is **exactly symmetric**: the rise from A to B is the
 * negation of the rise from B to A, to the last bit. A lattice gate that is not
 * symmetric admits an edge in one direction and refuses it in the other, which
 * A* is entitled to assume cannot happen — and the asymmetry from using
 * `from`'s own up is real (second order, ~`d²/2R`), small enough to hide, and
 * exactly the kind of thing that surfaces as one unreachable cell on one seed.
 *
 * ## What it is measured against
 *
 * `scratch/nav-step-frame.mts`, which runs the same expression on a flat world
 * as its control and prints both frames for level ground and for a real ledge.
 * Against `BUILDING_STEP_UP` (0.62 m), on the bare cap:
 *
 * | case | world-`y` difference | this |
 * |---|---|---|
 * | level ground, diagonal step at d = 157 m | −0.724 m (**refused**) | −0.000 m (ok) |
 * | level ground, diagonal step at d = 184 m | −1.092 m (**refused**) | 0.000 m (ok) |
 * | a real 0.70 m ledge at d = 40 m | 0.595 m (**admitted**) | 0.700 m (refused) |
 * | a real 0.70 m ledge at d = 157 m | −0.022 m (**admitted**) | 0.700 m (refused) |
 *
 * One wrong datum, two opposite symptoms: tap-to-move silently refusing to path
 * outward, and a child routed up a ledge she cannot climb.
 *
 * ## Sentinels do not come here
 *
 * Both arguments are *positions*. There is deliberately no overload taking a
 * height, and nothing in this file calls `Math.hypot` on a caller's scalar —
 * because `Math.hypot` is unsigned, so a `-Infinity` sentinel through a
 * magnitude function comes back `+Infinity` with its sign lost, which on
 * `eng/radial-collide` made **every collider in the game non-solid** while
 * typechecking cleanly. A sentinel is not a coordinate; keep it out of the
 * geometry rather than guarding it inside.
 */
export function riseBetween(from: Readonly<Geo>, to: Readonly<Geo>): number {
  const mx = (from.cx + to.cx) / 2;
  const my = (from.cy + to.cy) / 2;
  const mz = (from.cz + to.cz) / 2;
  const r = Math.hypot(mx, my, mz);
  if (r === 0) return to.cy - from.cy;
  return ((to.cx - from.cx) * mx + (to.cy - from.cy) * my + (to.cz - from.cz) * mz) / r;
}

/**
 * The same question asked of two world-space points, for the hot paths that
 * hold their coordinates as loose numbers and must not allocate.
 *
 * Exactly `riseBetween` on the two `Geo`s those coordinates name — the planet's
 * offset cancels in the difference, and enters only through the midpoint's own
 * up, which is why this can be written without building either `Geo`.
 * `test/geo/step.test.ts` asserts the two agree rather than leaving the claim
 * to this sentence.
 */
export function riseBetweenWorld(
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
): number {
  const mx = (fromX + toX) / 2;
  const my = (fromY + toY) / 2 + PLANET_RADIUS;
  const mz = (fromZ + toZ) / 2;
  const r = Math.hypot(mx, my, mz);
  if (r === 0) return toY - fromY;
  return ((toX - fromX) * mx + (toY - fromY) * my + (toZ - fromZ) * mz) / r;
}

/**
 * **How much world `y` is `metres` of real height, here** — the inverse of
 * {@link riseBetweenWorld} taken straight down the same column.
 *
 * For the callers that must go *looking* for the next surface down rather than
 * compare two they already hold: a sampler is asked "what is under me, starting
 * from a world `y`", and the `y` it is handed has to be the one that is a real
 * step below. Out at the park's reach that is `1/cos θ` bigger than the step
 * itself — 0.62 m of height is 0.88 m of world `y` at 45.5° of lean — so a
 * search that hands the sampler the step verbatim stops short and misses the
 * level it was looking for.
 *
 * A short fixed point, because the midpoint the rise is taken about depends on
 * the answer. It contracts hard — the residual against `riseBetweenWorld` over
 * d = 0..184.3 m is 5e-3 m after one pass, 3e-6 after two and under 1e-8 after
 * three — so three it is, on a path walked once per cell per lattice build and
 * never per frame. `test/geo/step.test.ts` measures that residual rather than
 * leaving this paragraph to be believed.
 */
export function columnYForRise(x: number, y: number, z: number, metres: number): number {
  let dy = metres;
  for (let pass = 0; pass < 3; pass += 1) {
    const my = y + dy / 2 + PLANET_RADIUS;
    const r = Math.hypot(x, my, z);
    if (my === 0) return metres;
    dy = (metres * r) / my;
  }
  return dy;
}
