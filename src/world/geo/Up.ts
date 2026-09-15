import type { Vector3 } from 'three';

/**
 * **An up is not a direction somebody chose. It is the one the planet has at
 * that point.**
 *
 * The second of the exactly two mistakes `RADIAL-INVENTORY.md` is a list of:
 * a world `+Y` axis standing in for a local up. At the park's reach those are
 * **45.5 degrees** apart, which is a tap marker sliced through the grass, a
 * rainbow lying at 45 degrees to the ground it is drawn on, and a fill light
 * 17 degrees below the local horizon lighting every toy from underneath.
 *
 * ## What this can and cannot do, measured rather than hoped
 *
 * A brand on an **object** type behaves differently from a brand on a `number`,
 * and that difference is the whole reason this file is worth having while
 * `Altitude` had to be opaque instead.
 *
 * - `Up` is assignable **to** `Vector3`, so every existing call site that wants
 *   a direction keeps working, and returning one costs nothing. Purely
 *   additive: nothing that compiles today stops compiling.
 * - A plain `Vector3` is **not** assignable to `Up`. So a function that
 *   declares `up: Up` cannot be handed `new Vector3(0, 1, 0)`, and that is a
 *   compile error at the call site rather than a lean a child notices.
 *
 * That is a real boundary and it is the one that matters, because the defect is
 * always the *same shape*: some helper takes an axis, and somebody passes the
 * world one. Declare the parameter `Up` and the mistake stops being
 * expressible.
 *
 * ## The rule for producing one
 *
 * **Only `Geo.up`, `Frame.up` and `Chart.upAt` may mint an `Up`.** Each of
 * those derives it from a position on the planet, which is what makes it true.
 * {@link asUp} exists because they need it; it is deliberately not exported
 * from `geo/index.ts`, so the vocabulary is the only supplier. If you find
 * yourself wanting it outside this directory, what you want is one of those
 * three.
 *
 * Erasable: a `type` and a `declare const`, both erased entirely. At runtime an
 * `Up` *is* the `Vector3`, so there is no wrapper and no allocation.
 */
declare const UP: unique symbol;

/** A unit vector along the local radial — the same in world and planet-centred space. */
export type Up = Vector3 & { readonly [UP]: true };

/**
 * Vouch for a vector as a local up. **Internal to `geo/`** — the three
 * functions that derive one from a position are the only honest callers, and
 * they are the reason this is not exported from the directory's index.
 */
export function asUp(v: Vector3): Up {
  return v as Up;
}
